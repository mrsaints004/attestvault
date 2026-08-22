import { Contract, EventLog, JsonRpcApiProvider } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';

/**
 * Single-transaction proof fetch. Adapted directly from Attestcoin's reference
 * `usc-testnet-bridge-examples/utils/index.ts::generateProofFor` — same pattern used by the
 * official loan-flow example, unchanged in behavior.
 */
export async function generateProofFor(
  txHash: string,
  chainKey: number,
  proofBuilderUrl: string,
  creditcoinRpc: JsonRpcApiProvider,
  sourceChainRpc: JsonRpcApiProvider
): Promise<proofProvider.ProofResult> {
  const transaction = await sourceChainRpc.getTransaction(txHash);
  if (!transaction) {
    throw new Error(`Transaction ${txHash} does not exist on source chain`);
  }

  const blockNumber = transaction.blockNumber;
  if (!blockNumber) {
    throw new Error(`Transaction ${txHash} is not yet mined on source chain`);
  }

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoinRpc);

  const latestAttested = await info.getLatestAttestedHeightAndHash(chainKey);
  console.log(`Latest attested height for chain key ${chainKey}: ${latestAttested.height}`);

  // Conservative 20 minute wait, matching the reference example.
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber, 15_000, 1_200_000);

  return proofBuilder.getProof(txHash);
}

export interface FlatBatchProof {
  chainKey: number;
  heights: number[];
  encodedTransactions: string[];
  merkleProofs: proofProvider.merkle.TransactionMerkleProof[];
  continuityProof: proofProvider.ContinuityProof;
  /** txHashes[i] is the original source-chain tx hash for entry i — use this, not array position,
   * to map each flattened entry back to the action it corresponds to (batch entries are not
   * guaranteed to come back in submission order; see BatchMerkleProofEntry.txHash). */
  txHashes: string[];
}

/**
 * Batch proof fetch + flatten — this is the "depth" integration path, not present in the
 * reference loan-flow example. `ProofBuilder.getBatchProof` returns a
 * `BatchContinuityResponse` whose `merkleProofs` field is a
 * `Map<headerNumber, Map<indexWithinHeader, BatchMerkleProofEntry>>` (confirmed from
 * `@gluwa/usc-sdk@0.18.0`'s `dist/proof-provider/index.d.ts`). We flatten it into the parallel
 * arrays `CollateralManager.executeBatch` / the precompile's batch `verifyAndEmit` overload expect.
 *
 * Waits for every source transaction's block to be individually attested before requesting the
 * batch proof — `waitUntilHeightAttested` only tracks one height at a time, so for a batch we wait
 * on the highest (most recent) height in the set, which implies all earlier ones are attested too
 * given Creditcoin attests source chains in height order.
 */
export async function generateBatchProofFor(
  txHashes: string[],
  chainKey: number,
  proofBuilderUrl: string,
  creditcoinRpc: JsonRpcApiProvider,
  sourceChainRpc: JsonRpcApiProvider
): Promise<FlatBatchProof> {
  if (txHashes.length === 0) throw new Error('generateBatchProofFor: empty batch');
  if (txHashes.length > 10) throw new Error('generateBatchProofFor: batch exceeds MAX_BATCH_SIZE (10)');

  let highestBlock = 0;
  for (const txHash of txHashes) {
    const tx = await sourceChainRpc.getTransaction(txHash);
    if (!tx) throw new Error(`Transaction ${txHash} does not exist on source chain`);
    if (!tx.blockNumber) throw new Error(`Transaction ${txHash} is not yet mined on source chain`);
    if (tx.blockNumber > highestBlock) highestBlock = tx.blockNumber;
  }

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  await proofBuilder.waitUntilHeightAttested(chainKey, highestBlock, 15_000, 1_200_000);

  const result = await proofBuilder.getBatchProof(txHashes);
  if (!result.success || !result.data) {
    throw new Error(`Batch proof generation failed: ${result.error ?? 'unknown error'}`);
  }

  const heights: number[] = [];
  const encodedTransactions: string[] = [];
  const merkleProofs: proofProvider.merkle.TransactionMerkleProof[] = [];
  const txHashesOut: string[] = [];

  for (const [header, byIndex] of result.data.merkleProofs) {
    for (const [, entry] of byIndex) {
      heights.push(header);
      encodedTransactions.push(entry.txBytes);
      merkleProofs.push(entry.merkleProof);
      txHashesOut.push(entry.txHash);
    }
  }

  // NOTE: the on-chain executeBatch expects `heights[i]`/`encodedTransactions[i]`/`merkleProofs[i]`
  // to be in the SAME order the caller wants events processed in. We don't have a hard guarantee
  // from the SDK's Map iteration order matching submission order requirements — if CollateralManager
  // ever needs a specific processing order (it currently doesn't; each pledge/update is independent),
  // sort these three arrays together by `heights[i]` before submitting.

  return {
    chainKey,
    heights,
    encodedTransactions,
    merkleProofs,
    continuityProof: result.data.continuityProof,
    txHashes: txHashesOut,
  };
}

async function computeGasLimit(
  provider: JsonRpcApiProvider,
  contract: Contract,
  data: string,
  from: string,
  continuityLength: number
): Promise<bigint> {
  const GAS_BUFFER_MULTIPLIER = 135;

  try {
    const to = await contract.getAddress();
    const estimatedGas = await provider.estimateGas({ to, data, from });
    return (estimatedGas * BigInt(GAS_BUFFER_MULTIPLIER)) / BigInt(100);
  } catch (error: any) {
    const calculatedGas = 21000 + continuityLength * 5000 + 20000;
    console.warn(`Gas estimation failed (${error.shortMessage ?? error.message}); using fallback ${calculatedGas}`);
    return BigInt(calculatedGas);
  }
}

/** action indices must match CollateralManager.CollateralActions: 0=Pledged, 1=ValueUpdated, 2=Released */
export async function submitSingleProof(
  provider: JsonRpcApiProvider,
  contract: Contract,
  action: number,
  chainKey: number,
  proofData: proofProvider.ContinuityResponse,
  signerAddress: string
): Promise<any> {
  const merkleProof = { root: proofData.merkleProof.root, siblings: proofData.merkleProof.siblings };
  const continuityProof = proofData.continuityProof;

  const iface = contract.interface;
  const funcFragment = iface.getFunction(
    'execute(uint8,uint64,uint64,bytes,bytes32,tuple(bytes32,bool)[],bytes32,bytes32[])'
  );
  const params = [
    action,
    chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    merkleProof.root,
    merkleProof.siblings,
    continuityProof.lowerEndpointDigest,
    continuityProof.roots,
  ];
  const data = iface.encodeFunctionData(funcFragment!, params);
  const continuityBlocks = continuityProof.roots?.length || 1;
  const gasLimit = await computeGasLimit(provider, contract, data, signerAddress, continuityBlocks);

  return contract.execute(
    action,
    chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    merkleProof.root,
    merkleProof.siblings,
    continuityProof.lowerEndpointDigest,
    continuityProof.roots,
    { gasLimit }
  );
}

/** `actions[i]` must correspond 1:1 with `batch.encodedTransactions[i]` in the order you pass them in. */
export async function submitBatchProof(
  provider: JsonRpcApiProvider,
  contract: Contract,
  actions: number[],
  batch: FlatBatchProof,
  signerAddress: string
): Promise<any> {
  if (actions.length !== batch.encodedTransactions.length) {
    throw new Error('submitBatchProof: actions length must match batch entries');
  }

  const merkleProofs = batch.merkleProofs.map((mp) => ({ root: mp.root, siblings: mp.siblings }));

  const iface = contract.interface;
  const funcFragment = iface.getFunction(
    'executeBatch(uint8[],uint64,uint64[],bytes[],tuple(bytes32,tuple(bytes32,bool)[])[],bytes32,bytes32[])'
  );
  const params = [
    actions,
    batch.chainKey,
    batch.heights,
    batch.encodedTransactions,
    merkleProofs,
    batch.continuityProof.lowerEndpointDigest,
    batch.continuityProof.roots,
  ];
  const data = iface.encodeFunctionData(funcFragment!, params);
  const continuityBlocks = batch.continuityProof.roots?.length || 1;
  const gasLimit = await computeGasLimit(provider, contract, data, signerAddress, continuityBlocks);

  return contract.executeBatch(
    actions,
    batch.chainKey,
    batch.heights,
    batch.encodedTransactions,
    merkleProofs,
    batch.continuityProof.lowerEndpointDigest,
    batch.continuityProof.roots,
    { gasLimit }
  );
}

export const POLLING_INTERVAL_MS = 5000;
export const ERROR_BACKOFF_MS = 10000;
export const MAX_PROCESSED_TXS = 1000;

/** Identical pattern to the reference example's pollEvents — queryFilter-based to avoid RPC filter-expiry issues. */
export async function pollEvents(
  contract: Contract,
  eventName: string,
  fromBlock: number,
  handler: (event: EventLog) => Promise<void> | void
): Promise<number> {
  try {
    const currentBlock = await contract.runner?.provider?.getBlockNumber();
    if (!currentBlock || currentBlock < fromBlock) return fromBlock;

    const events = await contract.queryFilter(eventName, fromBlock, currentBlock);
    for (const event of events) {
      if (event instanceof EventLog) await handler(event);
    }
    return currentBlock + 1;
  } catch (error: any) {
    console.error(`Error polling ${eventName} events:`, error.shortMessage ?? error.message);
    await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    return fromBlock;
  }
}

export function isValidPrivateKey(key: string | undefined): boolean {
  return !!key && key.startsWith('0x') && key.length === 66;
}

export function isValidContractAddress(address: string | undefined): boolean {
  return !!address && address.startsWith('0x') && address.length === 42;
}
