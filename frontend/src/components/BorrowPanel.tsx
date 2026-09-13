import { useEffect, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { COLLATERAL_MANAGER_ABI } from '../abi/collateralManager';
import { contracts, creditcoinChain, isDeployed } from '../config';
import { toUsdFixed, fmtUsd, truncHash } from '../lib/units';
import { useToast } from '../lib/toast';
import { usePortfolioData } from '../hooks/usePortfolioData';
import { NetworkGate } from './NetworkGate';
import { friendlyError } from '../lib/errors';

export function BorrowPanel({ onChanged }: { onChanged?: () => void }) {
  const { address } = useAccount();
  const data = usePortfolioData(address);
  const [amount, setAmount] = useState('5000');
  const [lastAction, setLastAction] = useState<'borrow' | 'repay' | null>(null);
  const toast = useToast();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Compute max borrowable from collateral and required ratio
  const maxBorrowable = data.ratioBps > 0
    ? (data.collateral * 10000n) / BigInt(data.ratioBps)
    : 0n;
  const remainingBorrowable = maxBorrowable > data.borrowed ? maxBorrowable - data.borrowed : 0n;

  useEffect(() => {
    if (isSuccess && hash) {
      toast({
        kind: 'good',
        title: (lastAction === 'repay' ? 'Repayment' : 'Borrow') + ' confirmed on ' + creditcoinChain.name,
        detail: truncHash(hash),
      });
      onChanged?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  useEffect(() => {
    if (error) toast({ kind: 'warn', title: 'Transaction failed', detail: friendlyError(error) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  function validate(): boolean {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      toast({ kind: 'warn', title: 'Invalid amount', detail: 'Enter a positive USD amount.' });
      return false;
    }
    return true;
  }

  function borrow() {
    if (!validate()) return;
    reset();
    setLastAction('borrow');
    writeContract({
      address: contracts.collateralManager,
      abi: COLLATERAL_MANAGER_ABI,
      functionName: 'borrow',
      args: [toUsdFixed(amount)],
      chainId: creditcoinChain.id,
    });
  }

  function repay() {
    if (!validate()) return;
    reset();
    setLastAction('repay');
    writeContract({
      address: contracts.collateralManager,
      abi: COLLATERAL_MANAGER_ABI,
      functionName: 'repay',
      args: [toUsdFixed(amount)],
      chainId: creditcoinChain.id,
    });
  }

  if (!isDeployed) {
    return (
      <div className="action-form">
        <p className="panel-note">Contracts aren't deployed yet — nothing to borrow against.</p>
      </div>
    );
  }

  return (
    <div className="action-form">
      <p className="panel-note">
        Borrow or repay against your verified collateral on {creditcoinChain.name}. Interest accrues
        at ~5% APR and is applied automatically when you borrow or repay.
      </p>

      {data.collateral > 0n && (
        <div className="borrow-stats">
          <div className="borrow-stat">
            <span className="borrow-stat-k">Collateral</span>
            <span className="borrow-stat-v mono">{fmtUsd(data.collateral)}</span>
          </div>
          <div className="borrow-stat">
            <span className="borrow-stat-k">Outstanding debt</span>
            <span className="borrow-stat-v mono">{fmtUsd(data.borrowed)}</span>
          </div>
          <div className="borrow-stat">
            <span className="borrow-stat-k">Available to borrow</span>
            <span className="borrow-stat-v mono good">{fmtUsd(remainingBorrowable)}</span>
          </div>
        </div>
      )}

      {data.collateral === 0n && (
        <div className="borrow-stats">
          <p className="panel-note">
            No collateral pledged yet. Pledge assets first to unlock borrowing.
          </p>
        </div>
      )}

      <NetworkGate chainId={creditcoinChain.id} chainName={creditcoinChain.name}>
        <div className="form-row">
          <div className="field" style={{ maxWidth: 160 }}>
            <label>Amount (USD)</label>
            <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button className="btn" disabled={isPending || isConfirming || data.collateral === 0n} onClick={borrow}>
            {(isPending || isConfirming) && lastAction === 'borrow' ? 'Working...' : 'Borrow'}
          </button>
          <button className="btn ghost" disabled={isPending || isConfirming || data.borrowed === 0n} onClick={repay}>
            {(isPending || isConfirming) && lastAction === 'repay' ? 'Working...' : 'Repay'}
          </button>
        </div>
      </NetworkGate>
    </div>
  );
}
