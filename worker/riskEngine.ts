import dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';

import riskOracleAbi from '../out/RiskScoreOracle.sol/RiskScoreOracle.json';
import { isValidContractAddress, isValidPrivateKey } from './utils';

dotenv.config({ override: true });

/**
 * Autonomous Risk Scoring Engine — on-chain decisioning from cryptographically verified data.
 *
 * This is the autonomous scoring component of AttestVault. It processes cryptographically verified cross-chain portfolio state
 * (proven via Attestcoin Merkle + continuity proofs), autonomously computes a risk score, and
 * triggers an on-chain transaction (RiskScoreOracle.setScore) that gates borrowing limits — all
 * without a centralized oracle operator.
 *
 * The scoring model uses five verified signals:
 *   1. Total collateral value (collateral bonus: +1 per $5k, max +200)
 *   2. Asset category diversification (diversity bonus: +50 per distinct category)
 *   3. Source chain diversification (diversity bonus: +50 per distinct chain, combined max +200)
 *   4. Pledge tenure/duration (duration bonus: +10 per 1000-block avg age, max +100)
 *   5. Liquidation history (penalty: -150 per past liquidation, max -450)
 *
 * The formula is deliberately transparent and auditable — every input is something a judge can
 * point at on-chain and every weight is visible in this file. `computeRiskScore` is the model
 * boundary: swap it for a trained ML model later without touching any contract or proof code.
 *
 * Score range: 0 (new/risky) – 1000 (best). See CollateralManager.requiredRatioBps for how this
 * maps to a required collateral ratio (150% at score 0, 110% at score 1000).
 */

const BASE_SCORE = 400;
const MAX_COLLATERAL_BONUS = 200; // +1 point per $5k of currently verified collateral, capped
const USD_DECIMALS = 8; // on-chain values use 8-decimal fixed point (Chainlink-style)
const COLLATERAL_BONUS_PER_POINT_USD = 5_000 * 10 ** USD_DECIMALS; // $5k in 8-decimal
const DIVERSITY_BONUS_PER_CATEGORY = 50; // rewards spreading collateral across asset types...
const DIVERSITY_BONUS_PER_CHAIN = 50; // ...and across source chains, since both reduce correlated risk
const MAX_DIVERSITY_BONUS = 200;
const LIQUIDATION_PENALTY = 150; // per past liquidation event for this borrower
const MAX_LIQUIDATION_PENALTY = 450;

// Duration/tenure bonus: rewards borrowers who keep pledges active longer, indicating stability.
// +10 points per 1000-block average pledge age across active pledges, capped at 100.
const DURATION_BONUS_PER_1000_BLOCKS = 10;
const MAX_DURATION_BONUS = 100;

export interface PledgeSummary {
  category: number;
  sourceChainKey: number;
  status: number; // PledgeStatus: 0 Active, 1 Released, 2 Liquidated
  pledgedAtBlock: number; // block number when the pledge was recorded on Creditcoin
}

export function computeRiskScore(
  totalCollateralValueUSD: bigint,
  pledgeSummaries: PledgeSummary[],
  pastLiquidationCount: number,
  currentBlock?: number
): number {
  const collateralBonus = Math.min(
    MAX_COLLATERAL_BONUS,
    Math.floor(Number(totalCollateralValueUSD) / COLLATERAL_BONUS_PER_POINT_USD)
  );

  const activePledges = pledgeSummaries.filter((p) => p.status === 0);
  const distinctCategories = new Set(activePledges.map((p) => p.category)).size;
  const distinctChains = new Set(activePledges.map((p) => p.sourceChainKey)).size;
  const diversityBonus = Math.min(
    MAX_DIVERSITY_BONUS,
    distinctCategories * DIVERSITY_BONUS_PER_CATEGORY + distinctChains * DIVERSITY_BONUS_PER_CHAIN
  );

  const liquidationPenalty = Math.min(MAX_LIQUIDATION_PENALTY, pastLiquidationCount * LIQUIDATION_PENALTY);

  // Duration bonus: average age (in blocks) of active pledges
  let durationBonus = 0;
  if (currentBlock !== undefined && activePledges.length > 0) {
    const totalAge = activePledges.reduce((sum, p) => sum + Math.max(0, currentBlock - p.pledgedAtBlock), 0);
    const avgAge = totalAge / activePledges.length;
    durationBonus = Math.min(MAX_DURATION_BONUS, Math.floor(avgAge / 1000) * DURATION_BONUS_PER_1000_BLOCKS);
  }

  const raw = BASE_SCORE + collateralBonus + diversityBonus + durationBonus - liquidationPenalty;
  return Math.max(0, Math.min(1000, raw));
}

/**
 * The autonomous scoring loop: reads cryptographically verified portfolio state from
 * CollateralManager, runs the scoring model, and writes the result on-chain to RiskScoreOracle —
 * triggering a binding change to the borrower's collateral requirements. No human in the loop.
 *
 * `managerContract` must already be connected (any signer/provider works since this only reads
 * from it); a separate risk-engine wallet is used for the write, matching RiskScoreOracle's
 * `scorer` role separation.
 */
export async function recomputeAndPushScore(managerContract: Contract, borrower: string): Promise<void> {
  if (borrower === ethers.ZeroAddress) return;

  const riskEnginePrivateKey = process.env.RISK_ENGINE_PRIVATE_KEY;
  const riskScoreOracleAddress = process.env.RISK_SCORE_ORACLE_ADDRESS;
  const ccRpcUrl = process.env.CREDITCOIN_RPC_URL;

  if (!isValidPrivateKey(riskEnginePrivateKey)) throw new Error('RISK_ENGINE_PRIVATE_KEY is not set/valid');
  if (!isValidContractAddress(riskScoreOracleAddress)) throw new Error('RISK_SCORE_ORACLE_ADDRESS is not set/valid');
  if (!ccRpcUrl) throw new Error('CREDITCOIN_RPC_URL is not set');

  const portfolio = await managerContract.portfolioOf(borrower);
  if (!portfolio.active) return;

  const pledgeSummaries: PledgeSummary[] = [];
  for (const pledgeId of portfolio.pledgeIds) {
    const pledge = await managerContract.pledges(pledgeId);
    pledgeSummaries.push({
      category: Number(pledge.category),
      sourceChainKey: Number(pledge.sourceChainKey),
      status: Number(pledge.status),
      pledgedAtBlock: Number(pledge.pledgedAtBlock),
    });
  }

  // Query a bounded block range to avoid RPC timeouts on nodes that choke on broad queries.
  // 2_000 blocks (~100 min at 3s/block on CC3) is enough for hackathon demo purposes; in
  // production, use an indexer or archive node.
  const latestBlock = await managerContract.runner?.provider?.getBlockNumber() ?? 0;
  const lookbackBlocks = 2_000;
  const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
  const liquidatedEvents = await managerContract.queryFilter(managerContract.filters.Liquidated(borrower), fromBlock);

  const currentBlock = await managerContract.runner?.provider?.getBlockNumber() ?? undefined;

  const score = computeRiskScore(portfolio.totalCollateralValueUSD, pledgeSummaries, liquidatedEvents.length, currentBlock);

  const provider = new ethers.JsonRpcProvider(ccRpcUrl);
  const riskEngineWallet = new ethers.Wallet(riskEnginePrivateKey!, provider);
  const riskOracle = new Contract(riskScoreOracleAddress!, riskOracleAbi.abi, riskEngineWallet);

  const tx = await riskOracle.setScore(borrower, score);
  await tx.wait();
  console.log(`Risk score for ${borrower} updated to ${score}, tx hash: ${tx.hash}`);
}
