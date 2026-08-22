import dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';

import riskOracleAbi from '../out/RiskScoreOracle.sol/RiskScoreOracle.json';
import { isValidContractAddress, isValidPrivateKey } from './utils';

dotenv.config({ override: true });

/**
 * Transparent, auditable risk-scoring formula over CollateralManager's *already-verified* on-chain
 * state. Deliberately not an opaque/trained model for this hackathon build: every input here is
 * something a judge can point at on-chain and every weight is visible in this file, which matters
 * more for a lending-decision demo than model sophistication would. `computeRiskScore` is the one
 * function to swap out if this becomes a trained model later — everything around it (reading
 * verified state, pushing the result on-chain) stays the same.
 *
 * Score range: 0 (new/risky) – 1000 (best). See CollateralManager.requiredRatioBps for how this
 * maps to a required collateral ratio.
 */

const BASE_SCORE = 400;
const MAX_COLLATERAL_BONUS = 200; // +1 point per $5k of currently verified collateral, capped
const COLLATERAL_BONUS_PER_POINT_USD = 5_000;
const DIVERSITY_BONUS_PER_CATEGORY = 50; // rewards spreading collateral across asset types...
const DIVERSITY_BONUS_PER_CHAIN = 50; // ...and across source chains, since both reduce correlated risk
const MAX_DIVERSITY_BONUS = 200;
const LIQUIDATION_PENALTY = 150; // per past liquidation event for this borrower
const MAX_LIQUIDATION_PENALTY = 450;

interface PledgeSummary {
  category: number;
  sourceChainKey: number;
  status: number; // PledgeStatus: 0 Active, 1 Released, 2 Liquidated
}

export function computeRiskScore(
  totalCollateralValueUSD: bigint,
  pledgeSummaries: PledgeSummary[],
  pastLiquidationCount: number
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

  const raw = BASE_SCORE + collateralBonus + diversityBonus - liquidationPenalty;
  return Math.max(0, Math.min(1000, raw));
}

/**
 * Reads verified state back from CollateralManager, computes the score, and writes it to
 * RiskScoreOracle. `managerContract` must already be connected (any signer/provider works since
 * this only reads from it); a separate risk-engine wallet is used for the write, matching
 * RiskScoreOracle's `scorer` role separation.
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
    });
  }

  const liquidatedEvents = await managerContract.queryFilter(managerContract.filters.Liquidated(borrower));

  const score = computeRiskScore(portfolio.totalCollateralValueUSD, pledgeSummaries, liquidatedEvents.length);

  const provider = new ethers.JsonRpcProvider(ccRpcUrl);
  const riskEngineWallet = new ethers.Wallet(riskEnginePrivateKey!, provider);
  const riskOracle = new Contract(riskScoreOracleAddress!, riskOracleAbi.abi, riskEngineWallet);

  const tx = await riskOracle.setScore(borrower, score);
  await tx.wait();
  console.log(`Risk score for ${borrower} updated to ${score}, tx hash: ${tx.hash}`);
}
