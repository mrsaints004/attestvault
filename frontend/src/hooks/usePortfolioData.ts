import { useReadContract, useReadContracts } from 'wagmi';
import { COLLATERAL_MANAGER_ABI } from '../abi/collateralManager';
import { RISK_SCORE_ORACLE_ABI } from '../abi/riskScoreOracle';
import { contracts, creditcoinChain, isDeployed } from '../config';

export function usePortfolioData(address: `0x${string}` | undefined) {
  const portfolioQuery = useReadContract({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    functionName: 'portfolioOf',
    args: address ? [address] : undefined,
    chainId: creditcoinChain.id,
    query: { enabled: isDeployed && !!address, refetchInterval: 8000 },
  });

  const scoreQuery = useReadContract({
    address: contracts.riskScoreOracle,
    abi: RISK_SCORE_ORACLE_ABI,
    functionName: 'scoreOf',
    args: address ? [address] : undefined,
    chainId: creditcoinChain.id,
    query: { enabled: isDeployed && !!address, refetchInterval: 8000 },
  });

  const score = scoreQuery.data ?? 500;

  const ratioQuery = useReadContract({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    functionName: 'requiredRatioBps',
    args: [score],
    chainId: creditcoinChain.id,
    query: { enabled: scoreQuery.data !== undefined },
  });

  const pledgeIds = portfolioQuery.data?.pledgeIds ?? [];
  const pledgesQuery = useReadContracts({
    contracts: pledgeIds.map((id) => ({
      address: contracts.collateralManager,
      abi: COLLATERAL_MANAGER_ABI,
      functionName: 'pledges' as const,
      args: [id] as const,
      chainId: creditcoinChain.id,
    })),
    query: { enabled: pledgeIds.length > 0 },
  });

  const collateral = portfolioQuery.data?.totalCollateralValueUSD ?? 0n;
  const borrowed = portfolioQuery.data?.borrowedAmountUSD ?? 0n;
  const ratioBps = ratioQuery.data ?? 15000;
  const currentRatioBps = borrowed > 0n ? (collateral * 10000n) / borrowed : null;
  const atRisk = currentRatioBps !== null && currentRatioBps < 10500n;

  const isLoading = !!address && (portfolioQuery.isLoading || scoreQuery.isLoading);

  return {
    isLoading,
    portfolio: portfolioQuery.data,
    score: Number(score),
    ratioBps: Number(ratioBps),
    collateral,
    borrowed,
    currentRatioBps,
    atRisk,
    pledgeIds,
    pledges: pledgesQuery.data,
    pledgesLoading: pledgesQuery.isLoading,
  };
}
