import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Contract, ethers } from 'ethers';

import vaultAbi from '../out/AuxiliaryAssetVault.sol/AuxiliaryAssetVault.json';
import managerAbi from '../out/CollateralManager.sol/CollateralManager.json';
import {
  generateBatchProofFor,
  generateProofFor,
  isValidContractAddress,
  isValidPrivateKey,
  MAX_PROCESSED_TXS,
  pollEvents,
  POLLING_INTERVAL_MS,
  submitBatchProof,
  submitSingleProof,
} from './utils';
import { recomputeAndPushScore } from './riskEngine';

dotenv.config({ override: true });

/**
 * Minimum queued events before we flush as a *batch* proof instead of waiting for one at a time.
 * Set low (2) so the batch path is easy to trigger and demo live, well under MAX_BATCH_SIZE (10).
 */
const BATCH_FLUSH_THRESHOLD = 2;
/** Force-flush whatever is queued after this long, so a single pledge doesn't wait forever. */
const BATCH_FLUSH_TIMEOUT_MS = 30_000;

// CollateralManager.CollateralActions
const ACTION_PLEDGED = 0;
const ACTION_VALUE_UPDATED = 1;
const ACTION_RELEASED = 2;

interface QueuedEvent {
  action: number;
  txHash: string;
  owner: string; // best-effort, used to trigger a risk-score recompute after processing
}

/**
 * Per-source-chain worker state. A batch proof's continuity proof only covers ONE chain
 * (see `CollateralManager.executeBatch` / the precompile's batch `verifyAndEmit`), so events from
 * different chains can never share a queue or a flush — each configured chain gets its own queue,
 * its own `processedTxs` cache, and its own poll cursor.
 */
interface ChainWorker {
  chainKey: number;
  provider: ethers.JsonRpcProvider;
  vaultContract: Contract;
  queue: QueuedEvent[];
  processedTxs: Set<string>;
  queueOpenedAt: number;
  fromBlock: number;
}

const CURSOR_FILE = path.resolve(__dirname, '..', '.worker-cursors.json');

interface CursorState {
  [chainKey: string]: number; // chainKey → fromBlock
}

function loadCursors(): CursorState {
  try {
    if (fs.existsSync(CURSOR_FILE)) {
      return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf-8'));
    }
  } catch {
    console.warn('Could not read cursor file, starting from latest block.');
  }
  return {};
}

function saveCursors(chains: ChainWorker[]) {
  const state: CursorState = {};
  for (const chain of chains) {
    state[String(chain.chainKey)] = chain.fromBlock;
  }
  try {
    fs.writeFileSync(CURSOR_FILE, JSON.stringify(state, null, 2));
  } catch (err: any) {
    console.warn('Could not persist cursors:', err.message);
  }
}

let isShuttingDown = false;
process.on('SIGINT', () => (isShuttingDown = true));
process.on('SIGTERM', () => (isShuttingDown = true));

async function buildChainWorker(
  label: string,
  rpcUrl: string,
  vaultAddress: string,
  chainKey: number,
  cursors: CursorState
): Promise<ChainWorker> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const vaultContract = new Contract(vaultAddress, vaultAbi.abi, provider);
  const latestBlock = await provider.getBlockNumber();
  const savedBlock = cursors[String(chainKey)];
  const fromBlock = savedBlock && savedBlock <= latestBlock ? savedBlock : latestBlock;
  const source = savedBlock ? 'persisted cursor' : 'latest block';
  console.log(`[chain ${chainKey}] (${label}) polling AuxiliaryAssetVault ${vaultAddress} from block ${fromBlock} (${source})`);
  return { chainKey, provider, vaultContract, queue: [], processedTxs: new Set(), queueOpenedAt: 0, fromBlock };
}

const main = async () => {
  console.log('Starting AttestVault worker (proof relay + autonomous risk scoring)...');

  const proofBuilderUrl = process.env.PROOF_BUILDER_URL;
  const ccRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const ccWalletPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const collateralManagerAddress = process.env.COLLATERAL_MANAGER_ADDRESS;

  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const auxiliaryAssetVaultAddress = process.env.AUXILIARY_ASSET_VAULT_ADDRESS;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);

  if (!proofBuilderUrl) throw new Error('PROOF_BUILDER_URL is not set');
  if (!ccRpcUrl) throw new Error('CREDITCOIN_RPC_URL is not set');
  if (!isValidPrivateKey(ccWalletPrivateKey)) throw new Error('DEPLOYER_PRIVATE_KEY is not set/valid');
  if (!isValidContractAddress(collateralManagerAddress)) throw new Error('COLLATERAL_MANAGER_ADDRESS is not set/valid');
  if (!sourceChainRpcUrl) throw new Error('SOURCE_CHAIN_RPC_URL is not set');
  if (!isValidContractAddress(auxiliaryAssetVaultAddress)) throw new Error('AUXILIARY_ASSET_VAULT_ADDRESS is not set/valid');
  if (isNaN(sourceChainKey)) throw new Error('SOURCE_CHAIN_KEY is not set/valid');

  const ccProvider = new ethers.JsonRpcProvider(ccRpcUrl);
  const ccWallet = new ethers.Wallet(ccWalletPrivateKey!, ccProvider);
  const managerContract = new Contract(collateralManagerAddress!, managerAbi.abi, ccWallet);

  const cursors = loadCursors();
  const chains: ChainWorker[] = [
    await buildChainWorker('chain 1', sourceChainRpcUrl, auxiliaryAssetVaultAddress!, sourceChainKey, cursors),
  ];

  // Second source chain is entirely optional — only started if all three vars are present. See the
  // README "Honesty note on multi-chain" section before relying on this in a live demo.
  const sourceChain2RpcUrl = process.env.SOURCE_CHAIN_2_RPC_URL;
  const auxiliaryAssetVault2Address = process.env.AUXILIARY_ASSET_VAULT_2_ADDRESS;
  const sourceChain2Key = Number(process.env.SOURCE_CHAIN_2_KEY);
  if (sourceChain2RpcUrl && isValidContractAddress(auxiliaryAssetVault2Address) && !isNaN(sourceChain2Key)) {
    chains.push(
      await buildChainWorker('chain 2', sourceChain2RpcUrl, auxiliaryAssetVault2Address!, sourceChain2Key, cursors)
    );
  } else {
    console.log('Second source chain not configured — running single-chain. See .env.example to add one.');
  }

  const enqueue = (chain: ChainWorker, event: QueuedEvent) => {
    if (chain.queue.length === 0) chain.queueOpenedAt = Date.now();
    chain.queue.push(event);
  };

  const shouldFlush = (chain: ChainWorker) =>
    chain.queue.length >= BATCH_FLUSH_THRESHOLD ||
    (chain.queue.length > 0 && Date.now() - chain.queueOpenedAt >= BATCH_FLUSH_TIMEOUT_MS);

  // `AssetValueUpdated`/`AssetReleased` events don't carry the owner's address (see AuxiliaryAssetVault.sol),
  // so `batch[i].owner` is a placeholder (ethers.ZeroAddress) for those. Recomputing a score for the
  // zero address would be a no-op that silently skips the real borrower — including after a
  // value-update-triggered liquidation, which is exactly when the score most needs updating. Instead,
  // read the real borrower(s) back from CollateralManager's own `PortfolioValueChanged` event, which
  // every one of _handlePledged/_handleValueUpdated/_handleReleased emits with the true owner.
  const extractAffectedOwners = (receipt: { logs: readonly unknown[] }): Set<string> => {
    const owners = new Set<string>();
    for (const log of receipt.logs as any[]) {
      let parsed;
      try {
        parsed = managerContract.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === 'PortfolioValueChanged') owners.add(parsed.args.borrower as string);
    }
    return owners;
  };

  const flushQueue = async (chain: ChainWorker) => {
    if (chain.queue.length === 0) return;
    const batch = chain.queue.splice(0, chain.queue.length);

    let receipt: any;
    try {
      if (batch.length === 1) {
        console.log(`[chain ${chain.chainKey}] Flushing single proof for tx ${batch[0].txHash} (action ${batch[0].action})`);
        const proofResult = await generateProofFor(
          batch[0].txHash,
          chain.chainKey,
          proofBuilderUrl!,
          ccProvider,
          chain.provider
        );
        if (!proofResult.success || !proofResult.data) {
          throw new Error(`Proof generation failed: ${proofResult.error}`);
        }
        const tx = await submitSingleProof(
          ccProvider,
          managerContract,
          batch[0].action,
          chain.chainKey,
          proofResult.data,
          ccWallet.address
        );
        receipt = await tx.wait();
        console.log(`[chain ${chain.chainKey}] Submitted single proof, tx hash: ${tx.hash}`);
      } else {
        console.log(
          `[chain ${chain.chainKey}] Flushing BATCH proof for ${batch.length} txs: ${batch.map((e) => e.txHash).join(', ')}`
        );
        const flat = await generateBatchProofFor(
          batch.map((e) => e.txHash),
          chain.chainKey,
          proofBuilderUrl!,
          ccProvider,
          chain.provider
        );
        // `flat.encodedTransactions[i]` is NOT guaranteed to be in the same order as `batch` — the
        // SDK's Map iteration order is what it is. Map each flattened entry back to its action via
        // `flat.txHashes[i]`, which the batch queue may legitimately mix (a pledge and a release in
        // the same flush both work fine on-chain since each is processed independently).
        const actionByTxHash = new Map(batch.map((e) => [e.txHash, e.action]));
        const actions = flat.txHashes.map((txHash) => {
          const action = actionByTxHash.get(txHash);
          if (action === undefined) throw new Error(`Batch proof returned unknown tx hash ${txHash}`);
          return action;
        });
        const tx = await submitBatchProof(ccProvider, managerContract, actions, flat, ccWallet.address);
        receipt = await tx.wait();
        console.log(`[chain ${chain.chainKey}] Submitted batch proof (${batch.length} entries), tx hash: ${tx.hash}`);
      }

      batch.forEach((e) => chain.processedTxs.add(e.txHash));
      const affectedOwners = extractAffectedOwners(receipt);
      for (const owner of affectedOwners) {
        await recomputeAndPushScore(managerContract, owner).catch((err) =>
          console.error(`Risk score recompute failed for ${owner}:`, err)
        );
      }
    } catch (error: any) {
      console.error(`[chain ${chain.chainKey}] Error flushing proof batch:`, error.shortMessage ?? error.message ?? error);
    }
  };

  console.log(`Worker + autonomous risk scoring started! Listening for AuxiliaryAssetVault events on ${chains.length} chain(s)...`);

  while (!isShuttingDown) {
    for (const chain of chains) {
      const newFromBlock = await pollEvents(chain.vaultContract, 'AssetPledged', chain.fromBlock, async (event) => {
        const txHash = event.transactionHash;
        if (chain.processedTxs.has(txHash)) return;
        const [pledgeId, owner] = event.args;
        console.log(`[chain ${chain.chainKey}] Detected AssetPledged (pledgeId ${pledgeId}) from ${owner}, tx ${txHash}`);
        enqueue(chain, { action: ACTION_PLEDGED, txHash, owner });
      });

      await pollEvents(chain.vaultContract, 'AssetValueUpdated', chain.fromBlock, async (event) => {
        const txHash = event.transactionHash;
        if (chain.processedTxs.has(txHash)) return;
        console.log(`[chain ${chain.chainKey}] Detected AssetValueUpdated, tx ${txHash}`);
        // owner isn't in this event's args (see AuxiliaryAssetVault.sol); risk recompute for the
        // affected borrower still happens because the pledge event that created it already queued one.
        enqueue(chain, { action: ACTION_VALUE_UPDATED, txHash, owner: ethers.ZeroAddress });
      });

      await pollEvents(chain.vaultContract, 'AssetReleased', chain.fromBlock, async (event) => {
        const txHash = event.transactionHash;
        if (chain.processedTxs.has(txHash)) return;
        console.log(`[chain ${chain.chainKey}] Detected AssetReleased, tx ${txHash}`);
        enqueue(chain, { action: ACTION_RELEASED, txHash, owner: ethers.ZeroAddress });
      });

      chain.fromBlock = newFromBlock;

      if (shouldFlush(chain)) await flushQueue(chain);

      if (chain.processedTxs.size > MAX_PROCESSED_TXS) {
        console.log(`[chain ${chain.chainKey}] Clearing processed transactions cache (had ${chain.processedTxs.size} entries)`);
        chain.processedTxs.clear();
      }
    }

    saveCursors(chains);
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  saveCursors(chains);
  console.log('Worker stopped.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
