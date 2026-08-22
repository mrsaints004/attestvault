import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { COLLATERAL_MANAGER_ABI } from '../abi/collateralManager';
import { contracts, creditcoinChain, isDeployed } from '../config';
import { toUsdFixed, truncHash } from '../lib/units';
import { useToast } from '../lib/toast';
import { NetworkGate } from './NetworkGate';

export function BorrowPanel({ onChanged }: { onChanged?: () => void }) {
  const [amount, setAmount] = useState('5000');
  const [lastAction, setLastAction] = useState<'borrow' | 'repay' | null>(null);
  const toast = useToast();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

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
    if (error) toast({ kind: 'warn', title: 'Transaction failed', detail: error.message.split('\n')[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  function borrow() {
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
        Writes to <span className="mono">CollateralManager</span> on {creditcoinChain.name}. Borrowing beyond
        what your verified collateral and risk score allow reverts on-chain.
      </p>
      <NetworkGate chainId={creditcoinChain.id} chainName={creditcoinChain.name}>
        <div className="form-row">
          <div className="field" style={{ maxWidth: 160 }}>
            <label>Amount (USD)</label>
            <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button className="btn" disabled={isPending || isConfirming} onClick={borrow}>
            {(isPending || isConfirming) && lastAction === 'borrow' ? 'Working…' : 'Borrow'}
          </button>
          <button className="btn ghost" disabled={isPending || isConfirming} onClick={repay}>
            {(isPending || isConfirming) && lastAction === 'repay' ? 'Working…' : 'Repay'}
          </button>
        </div>
      </NetworkGate>
    </div>
  );
}
