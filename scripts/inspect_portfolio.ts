import dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';
import managerAbi from '../out/CollateralManager.sol/CollateralManager.json';
import riskOracleAbi from '../out/RiskScoreOracle.sol/RiskScoreOracle.json';

dotenv.config({ override: true });

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--borrower');
  if (i < 0) throw new Error('--borrower <address> is required');
  return args[i + 1];
}

async function main() {
  const borrower = parseArgs();

  const ccRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const managerAddress = process.env.COLLATERAL_MANAGER_ADDRESS;
  const oracleAddress = process.env.RISK_SCORE_ORACLE_ADDRESS;

  if (!ccRpcUrl) throw new Error('CREDITCOIN_RPC_URL not set');
  if (!managerAddress) throw new Error('COLLATERAL_MANAGER_ADDRESS not set');
  if (!oracleAddress) throw new Error('RISK_SCORE_ORACLE_ADDRESS not set');

  const provider = new ethers.JsonRpcProvider(ccRpcUrl);
  const manager = new Contract(managerAddress, managerAbi.abi, provider);
  const oracle = new Contract(oracleAddress, riskOracleAbi.abi, provider);

  const portfolio = await manager.portfolioOf(borrower);
  const score = await oracle.scoreOf(borrower);
  const requiredRatioBps = await manager.requiredRatioBps(score);

  console.log(`Portfolio for ${borrower}`);
  console.log(`  active:                 ${portfolio.active}`);
  console.log(`  pledges:                ${portfolio.pledgeIds.length}`);
  console.log(`  totalCollateralValueUSD: $${Number(portfolio.totalCollateralValueUSD) / 1e8}`);
  console.log(`  borrowedAmountUSD:       $${Number(portfolio.borrowedAmountUSD) / 1e8}`);
  console.log(`  riskScore (on-chain):    ${score} / 1000`);
  console.log(`  requiredCollateralRatio: ${Number(requiredRatioBps) / 100}%`);

  for (const pledgeId of portfolio.pledgeIds) {
    const pledge = await manager.pledges(pledgeId);
    const statusNames = ['Active', 'Released', 'Liquidated'];
    const categoryNames = ['Invoice', 'RealEstate', 'CarbonCredit', 'Other'];
    console.log(
      `    - ${categoryNames[Number(pledge.category)]} on chain ${pledge.sourceChainKey}: ` +
        `$${Number(pledge.valueUSD) / 1e8} [${statusNames[Number(pledge.status)]}]`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
