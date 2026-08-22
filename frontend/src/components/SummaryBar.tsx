import { fmtUsd } from '../lib/units';
import { Skeleton } from './Skeleton';
import type { usePortfolioData } from '../hooks/usePortfolioData';

export function SummaryBar({ data }: { data: ReturnType<typeof usePortfolioData> }) {
  const { isLoading, collateral, borrowed, score, ratioBps, currentRatioBps, atRisk } = data;

  return (
    <div className="summary-bar">
      <div className="summary-stat">
        <div className="summary-k">Total collateral</div>
        {isLoading ? <Skeleton width={110} height={28} /> : <div className="summary-v mono">{fmtUsd(collateral)}</div>}
      </div>
      <div className="summary-divider" />
      <div className="summary-stat">
        <div className="summary-k">Borrowed</div>
        {isLoading ? <Skeleton width={90} height={28} /> : <div className="summary-v mono">{fmtUsd(borrowed)}</div>}
      </div>
      <div className="summary-divider" />
      <div className="summary-stat">
        <div className="summary-k">Risk score</div>
        {isLoading ? (
          <Skeleton width={70} height={28} />
        ) : (
          <div className="summary-v mono">
            {score}
            <span className="summary-v-sub"> / 1000</span>
          </div>
        )}
      </div>
      <div className="summary-divider" />
      <div className="summary-stat">
        <div className="summary-k">Required ratio</div>
        {isLoading ? (
          <Skeleton width={70} height={28} />
        ) : (
          <div className="summary-v mono">{(ratioBps / 100).toFixed(1)}%</div>
        )}
      </div>
      <div className="summary-divider" />
      <div className="summary-stat">
        <div className="summary-k">Health</div>
        {isLoading ? (
          <Skeleton width={90} height={28} />
        ) : (
          <div className={'summary-v mono' + (atRisk ? ' warn' : currentRatioBps !== null ? ' good' : '')}>
            {currentRatioBps !== null ? (Number(currentRatioBps) / 100).toFixed(1) + '%' : '—'}
            {atRisk && <span className="summary-v-sub"> at risk</span>}
          </div>
        )}
      </div>
    </div>
  );
}
