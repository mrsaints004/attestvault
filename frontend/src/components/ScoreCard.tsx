import { Gauge } from './Gauge';
import { Skeleton } from './Skeleton';
import type { usePortfolioData } from '../hooks/usePortfolioData';

export function ScoreCard({ data }: { data: ReturnType<typeof usePortfolioData> }) {
  const { isLoading, score } = data;

  return (
    <div className="panel gauge-card">
      <h3>Risk score</h3>
      {isLoading ? (
        <Skeleton height={150} />
      ) : (
        <>
          <Gauge score={score} />
          <div className="gauge-readout mono">
            {score}
            <span> / 1000</span>
          </div>
        </>
      )}
      <p className="panel-note">
        Persists across loans — collateral size, diversification, and liquidation history, computed
        by a published formula, not a black box.
      </p>
    </div>
  );
}
