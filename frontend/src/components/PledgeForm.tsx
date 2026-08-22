import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { AUXILIARY_ASSET_VAULT_ABI } from '../abi/auxiliaryAssetVault';
import { ASSET_CATEGORIES, contracts, isDeployed, sourceChain } from '../config';
import { toUsdFixed, truncHash } from '../lib/units';
import { useToast } from '../lib/toast';
import { NetworkGate } from './NetworkGate';

const DEFAULTS = [25000, 180000, 6000, 12000];

export function PledgeForm({ onPledged }: { onPledged?: () => void }) {
  const [category, setCategory] = useState(0);
  const [value, setValue] = useState(String(DEFAULTS[0]));
  const toast = useToast();

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess && hash) {
      toast({ kind: 'good', title: 'Pledge confirmed on ' + sourceChain.name, detail: truncHash(hash) });
      onPledged?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, hash]);

  useEffect(() => {
    if (error) toast({ kind: 'warn', title: 'Pledge failed', detail: error.message.split('\n')[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  function submit() {
    reset();
    writeContract({
      address: contracts.auxiliaryAssetVault,
      abi: AUXILIARY_ASSET_VAULT_ABI,
      functionName: 'pledgeAsset',
      args: [category, toUsdFixed(value)],
      chainId: sourceChain.id,
    });
  }

  if (!isDeployed) {
    return (
      <div className="action-form">
        <p className="panel-note">Contracts aren't deployed yet — nothing to pledge against.</p>
      </div>
    );
  }

  return (
    <div className="action-form">
      <p className="panel-note">
        Writes to <span className="mono">AuxiliaryAssetVault</span> on {sourceChain.name}. The worker still
        needs to run separately to prove this into CollateralManager on Creditcoin.
      </p>
      <NetworkGate chainId={sourceChain.id} chainName={sourceChain.name}>
        <div className="form-row">
          <div className="field">
            <label>Asset category</label>
            <select
              value={category}
              onChange={(e) => {
                const c = Number(e.target.value);
                setCategory(c);
                setValue(String(DEFAULTS[c]));
              }}
            >
              {ASSET_CATEGORIES.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 160 }}>
            <label>Value (USD)</label>
            <input type="number" min="1" step="1" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <button className="btn" disabled={isPending || isConfirming} onClick={submit}>
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Mining…' : 'Pledge'}
          </button>
        </div>
      </NetworkGate>
    </div>
  );
}
