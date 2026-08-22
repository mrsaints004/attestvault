import { useState } from 'react';
import { useAccount, useWatchContractEvent } from 'wagmi';
import { AUXILIARY_ASSET_VAULT_ABI } from '../abi/auxiliaryAssetVault';
import { COLLATERAL_MANAGER_ABI } from '../abi/collateralManager';
import { contracts, sourceChain, creditcoinChain, isDeployed } from '../config';
import { fmtUsd, truncHash } from '../lib/units';

interface ActivityItem {
  id: string;
  label: string;
  detail: string;
  txHash: string;
  chainName: string;
  explorer: string;
}

export function ActivityFeed() {
  const { address } = useAccount();
  const [items, setItems] = useState<ActivityItem[]>([]);

  function push(item: ActivityItem) {
    setItems((prev) => [item, ...prev].slice(0, 25));
  }

  useWatchContractEvent({
    address: contracts.auxiliaryAssetVault,
    abi: AUXILIARY_ASSET_VAULT_ABI,
    eventName: 'AssetPledged',
    chainId: sourceChain.id,
    args: address ? { owner: address } : undefined,
    enabled: isDeployed && !!address,
    onLogs(logs) {
      logs.forEach((log) => {
        push({
          id: log.transactionHash + log.logIndex,
          label: 'Pledged',
          detail: fmtUsd(log.args.valueUSD ?? 0n),
          txHash: log.transactionHash,
          chainName: sourceChain.name,
          explorer: sourceChain.blockExplorers.default.url,
        });
      });
    },
  });

  useWatchContractEvent({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    eventName: 'PledgeRecorded',
    chainId: creditcoinChain.id,
    args: address ? { owner: address } : undefined,
    enabled: isDeployed && !!address,
    onLogs(logs) {
      logs.forEach((log) => {
        push({
          id: log.transactionHash + log.logIndex,
          label: 'Verified on Creditcoin',
          detail: fmtUsd(log.args.valueUSD ?? 0n),
          txHash: log.transactionHash,
          chainName: creditcoinChain.name,
          explorer: creditcoinChain.blockExplorers.default.url,
        });
      });
    },
  });

  useWatchContractEvent({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    eventName: 'Borrowed',
    chainId: creditcoinChain.id,
    args: address ? { borrower: address } : undefined,
    enabled: isDeployed && !!address,
    onLogs(logs) {
      logs.forEach((log) => {
        push({
          id: log.transactionHash + log.logIndex,
          label: 'Borrowed',
          detail: fmtUsd(log.args.amountUSD ?? 0n),
          txHash: log.transactionHash,
          chainName: creditcoinChain.name,
          explorer: creditcoinChain.blockExplorers.default.url,
        });
      });
    },
  });

  useWatchContractEvent({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    eventName: 'Repaid',
    chainId: creditcoinChain.id,
    args: address ? { borrower: address } : undefined,
    enabled: isDeployed && !!address,
    onLogs(logs) {
      logs.forEach((log) => {
        push({
          id: log.transactionHash + log.logIndex,
          label: 'Repaid',
          detail: fmtUsd(log.args.amountUSD ?? 0n),
          txHash: log.transactionHash,
          chainName: creditcoinChain.name,
          explorer: creditcoinChain.blockExplorers.default.url,
        });
      });
    },
  });

  useWatchContractEvent({
    address: contracts.collateralManager,
    abi: COLLATERAL_MANAGER_ABI,
    eventName: 'Liquidated',
    chainId: creditcoinChain.id,
    args: address ? { borrower: address } : undefined,
    enabled: isDeployed && !!address,
    onLogs(logs) {
      logs.forEach((log) => {
        push({
          id: log.transactionHash + log.logIndex,
          label: 'Liquidated',
          detail: fmtUsd(log.args.valueUSD ?? 0n),
          txHash: log.transactionHash,
          chainName: creditcoinChain.name,
          explorer: creditcoinChain.blockExplorers.default.url,
        });
      });
    },
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Activity</h3>
        <span className="pill mono">live</span>
      </div>
      <p className="panel-note">
        Watching contract events since you opened this page — not a full history. Refresh loses it.
      </p>
      <div className="activity-log">
        {items.length === 0 && <div className="panel-note">No activity yet.</div>}
        {items.map((it) => (
          <div className="activity-row" key={it.id}>
            <span className={'activity-dot activity-' + it.label.toLowerCase().split(' ')[0]} />
            <span className="activity-label">{it.label}</span>
            <span className="activity-detail mono">{it.detail}</span>
            <a
              className="activity-link mono"
              href={it.explorer + '/tx/' + it.txHash}
              target="_blank"
              rel="noreferrer"
            >
              {truncHash(it.txHash)}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
