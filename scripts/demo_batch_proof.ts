import dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';

import vaultAbi from '../out/AuxiliaryAssetVault.sol/AuxiliaryAssetVault.json';
import managerAbi from '../out/CollateralManager.sol/CollateralManager.json';
import { generateBatchProofFor, submitBatchProof } from '../worker/utils';

dotenv.config({ override: true });

/**
 * Live demo script for the "one call, not ten" moment: pledges N assets on the source chain back
 * to back, then — WITHOUT going through worker/index.ts's polling loop — explicitly requests a
 * single batch continuity proof covering all N transactions and submits ONE
 * `CollateralManager.executeBatch` call to verify all of them at once. Prints each step so it's
 * legible on camera. Run `yarn worker` separately if you want the normal always-on flow instead;
 * this script is for demoing/recording the batch path in isolation.
 */

const ACTION_PLEDGED = 0; // must match CollateralManager.CollateralActions.AssetPledged
const CATEGORIES = ['invoice', 'realestate', 'carboncredit', 'other'] as const;
const CATEGORY_NAMES = ['Invoice', 'RealEstate', 'CarbonCredit', 'Other'];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const count = Number(get('--count') ?? '3');
  if (isNaN(count) || count < 2 || count > 10) {
    throw new Error('--count must be between 2 and 10 (MAX_BATCH_SIZE)');
  }
  return { count };
}

async function main() {
  const { count } = parseArgs();

  const proofBuilderUrl = process.env.PROOF_BUILDER_URL;
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const ccRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const vaultAddress = process.env.AUXILIARY_ASSET_VAULT_ADDRESS;
  const managerAddress = process.env.COLLATERAL_MANAGER_ADDRESS;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);
  const lenderKey = process.env.LENDER_WALLET_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  const ccWalletKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!proofBuilderUrl) throw new Error('PROOF_BUILDER_URL not set');
  if (!sourceChainRpcUrl) throw new Error('SOURCE_CHAIN_RPC_URL not set');
  if (!ccRpcUrl) throw new Error('CREDITCOIN_RPC_URL not set');
  if (!vaultAddress) throw new Error('AUXILIARY_ASSET_VAULT_ADDRESS not set (run scripts/deploy.ts first)');
  if (!managerAddress) throw new Error('COLLATERAL_MANAGER_ADDRESS not set (run scripts/deploy.ts first)');
  if (isNaN(sourceChainKey)) throw new Error('SOURCE_CHAIN_KEY not set');
  if (!lenderKey) throw new Error('LENDER_WALLET_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY not set');
  if (!ccWalletKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');

  const sourceProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const ccProvider = new ethers.JsonRpcProvider(ccRpcUrl);
  const lenderWallet = new ethers.Wallet(lenderKey, sourceProvider);
  const ccWallet = new ethers.Wallet(ccWalletKey, ccProvider);

  const vault = new Contract(vaultAddress, vaultAbi.abi, lenderWallet);
  const manager = new Contract(managerAddress, managerAbi.abi, ccWallet);

  console.log('='.repeat(70));
  console.log(`ATTESTVAULT BATCH PROOF DEMO — pledging ${count} assets, verifying with ONE proof`);
  console.log('='.repeat(70));

  console.log(`\nStep 1/4 — Pledging ${count} assets on source chain (key ${sourceChainKey}) one at a time:\n`);
  const txHashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const categoryIndex = i % CATEGORIES.length;
    const valueUSD = BigInt((10_000 + i * 5_000) * 1e8);
    const tx = await vault.pledgeAsset(categoryIndex, valueUSD);
    await tx.wait();
    txHashes.push(tx.hash);
    console.log(`  [${i + 1}/${count}] ${CATEGORY_NAMES[categoryIndex]} $${Number(valueUSD) / 1e8} -> tx ${tx.hash}`);
  }

  console.log(`\nStep 2/4 — Requesting ONE continuity proof covering all ${count} transactions above...`);
  const flat = await generateBatchProofFor(txHashes, sourceChainKey, proofBuilderUrl, ccProvider, sourceProvider);
  console.log(`  Continuity proof spans ${flat.continuityProof.roots?.length ?? 0} block root(s).`);
  console.log(`  lowerEndpointDigest: ${flat.continuityProof.lowerEndpointDigest}`);
  console.log(`  ${flat.encodedTransactions.length} transactions bundled under this single proof.`);

  console.log(`\nStep 3/4 — Submitting ONE transaction to CollateralManager.executeBatch...`);
  const actions = txHashes.map(() => ACTION_PLEDGED);
  const submitTx = await submitBatchProof(ccProvider, manager, actions, flat, ccWallet.address);
  const receipt = await submitTx.wait();
  console.log(`  Submitted. tx hash: ${submitTx.hash} (gas used: ${receipt.gasUsed})`);

  console.log(`\nStep 4/4 — Result:`);
  console.log(`  ${count} asset pledges verified trustlessly via Attestcoin in 1 continuity proof + 1 on-chain call.`);
  console.log(`  Verifying these individually (the naive path) would have taken ${count} separate proofs`);
  console.log(`  and ${count} separate CollateralManager.execute() transactions instead of 1.`);

  const portfolio = await manager.portfolioOf(lenderWallet.address);
  console.log(`\nPortfolio for ${lenderWallet.address}:`);
  console.log(`  pledges: ${portfolio.pledgeIds.length}`);
  console.log(`  totalCollateralValueUSD: $${Number(portfolio.totalCollateralValueUSD) / 1e8}`);
  console.log('\n' + '='.repeat(70));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
