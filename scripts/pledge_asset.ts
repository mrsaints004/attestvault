import dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';
import vaultAbi from '../out/AuxiliaryAssetVault.sol/AuxiliaryAssetVault.json';

dotenv.config({ override: true });

// AssetCategory enum order — must match contracts/sol/AssetTypes.sol
const CATEGORIES = ['invoice', 'realestate', 'carboncredit', 'other'] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const category = (get('--category') ?? 'invoice').toLowerCase();
  const value = get('--value');
  const chain = get('--chain') ?? '1';
  if (!CATEGORIES.includes(category as any)) {
    throw new Error(`--category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (!value || isNaN(Number(value))) {
    throw new Error('--value <usd amount> is required, e.g. --value 25000');
  }
  if (chain !== '1' && chain !== '2') {
    throw new Error('--chain must be 1 or 2 (2 requires SOURCE_CHAIN_2_RPC_URL / AUXILIARY_ASSET_VAULT_2_ADDRESS)');
  }
  return {
    categoryIndex: CATEGORIES.indexOf(category as any),
    valueUSD: BigInt(Math.floor(Number(value) * 1e8)),
    chain,
  };
}

async function main() {
  const { categoryIndex, valueUSD, chain } = parseArgs();

  const sourceChainRpcUrl =
    chain === '2' ? process.env.SOURCE_CHAIN_2_RPC_URL : process.env.SOURCE_CHAIN_RPC_URL;
  const vaultAddress =
    chain === '2' ? process.env.AUXILIARY_ASSET_VAULT_2_ADDRESS : process.env.AUXILIARY_ASSET_VAULT_ADDRESS;
  const lenderKey = process.env.LENDER_WALLET_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;

  if (!sourceChainRpcUrl) throw new Error(`SOURCE_CHAIN${chain === '2' ? '_2' : ''}_RPC_URL not set`);
  if (!vaultAddress) {
    throw new Error(
      chain === '2'
        ? 'AUXILIARY_ASSET_VAULT_2_ADDRESS not set (deploy a second chain first, see .env.example)'
        : 'AUXILIARY_ASSET_VAULT_ADDRESS not set (run scripts/deploy.ts first)'
    );
  }
  if (!lenderKey) throw new Error('LENDER_WALLET_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY not set');

  const provider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const wallet = new ethers.Wallet(lenderKey, provider);
  const vault = new Contract(vaultAddress, vaultAbi.abi, wallet);

  console.log(`Pledging ${CATEGORIES[categoryIndex]} worth $${Number(valueUSD) / 1e8} on chain ${chain} as ${wallet.address}...`);
  const tx = await vault.pledgeAsset(categoryIndex, valueUSD);
  const receipt = await tx.wait();
  console.log(`Pledged. tx hash: ${tx.hash} (block ${receipt.blockNumber})`);
  console.log('The worker (worker/index.ts) will pick this up, prove it via Attestcoin, and submit it to CollateralManager.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
