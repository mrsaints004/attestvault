import { ASSET_CATEGORIES, PLEDGE_STATUS } from '../config';
import { fmtUsd } from '../lib/units';
import { Skeleton } from './Skeleton';
import type { usePortfolioData } from '../hooks/usePortfolioData';

export function PledgeList({ data }: { data: ReturnType<typeof usePortfolioData> }) {
  const { pledgeIds, pledges, pledgesLoading } = data;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Pledges</h3>
        <span className="pill mono">{pledgeIds.length}</span>
      </div>
      {pledgeIds.length === 0 && !pledgesLoading && (
        <p className="panel-note">No verified pledges yet — pledge an asset, then run the worker to prove it in.</p>
      )}
      {pledgeIds.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Chain</th>
                <th className="num">Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pledgesLoading &&
                pledgeIds.map((id) => (
                  <tr key={id}>
                    <td colSpan={4}>
                      <Skeleton height={14} />
                    </td>
                  </tr>
                ))}
              {!pledgesLoading &&
                pledges?.map((r, i) => {
                  if (r.status !== 'success') return null;
                  const p = r.result as readonly [string, string, number, bigint, bigint, number, bigint];
                  const [, , category, chainKey, valueUSD, pledgeStatus] = p;
                  const statusName = PLEDGE_STATUS[pledgeStatus] ?? 'Unknown';
                  return (
                    <tr key={i}>
                      <td>{ASSET_CATEGORIES[category] ?? 'Unknown'}</td>
                      <td className="mono">chain {chainKey.toString()}</td>
                      <td className="num mono">{fmtUsd(valueUSD)}</td>
                      <td>
                        <span className={'status-pill status-' + statusName.toLowerCase()}>{statusName}</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
