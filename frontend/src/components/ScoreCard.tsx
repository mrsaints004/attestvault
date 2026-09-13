import { Gauge } from './Gauge';
import { Skeleton } from './Skeleton';
import type { usePortfolioData } from '../hooks/usePortfolioData';

function scoreLabel(score: number): { text: string; className: string } {
  if (score >= 700) return { text: 'Excellent', className: 'good' };
  if (score >= 500) return { text: 'Good', className: '' };
  if (score >= 300) return { text: 'Fair', className: '' };
  return { text: 'Needs improvement', className: 'warn' };
}

export function ScoreCard({ data }: { data: ReturnType<typeof usePortfolioData> }) {
  const { isLoading, score, ratioBps } = data;
  const label = scoreLabel(score);

  return (
    <div className="panel gauge-card">
      <h3>AI Risk Score</h3>
      {isLoading ? (
        <Skeleton height={150} />
      ) : (
        <>
          <Gauge score={score} />
          <div className="gauge-readout mono">
            {score}
            <span> / 1000</span>
          </div>
          <div className={'score-label ' + label.className}>{label.text}</div>
        </>
      )}
      <div className="score-explainer">
        <div className="score-explainer-row">
          <span>Required collateral ratio</span>
          <span className="mono">{(ratioBps / 100).toFixed(0)}%</span>
        </div>
        <p className="panel-note">
          Computed autonomously by the AI risk agent from your verified on-chain data. Improves with
          more collateral, diverse asset types, longer pledge tenure, and clean liquidation history.
        </p>
      </div>
    </div>
  );
}
