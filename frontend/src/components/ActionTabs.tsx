import { useState } from 'react';
import { PledgeForm } from './PledgeForm';
import { BorrowPanel } from './BorrowPanel';

export function ActionTabs({ onChanged }: { onChanged?: () => void }) {
  const [tab, setTab] = useState<'pledge' | 'borrow'>('pledge');

  return (
    <div className="panel">
      <div className="tab-bar">
        <button className={'tab' + (tab === 'pledge' ? ' active' : '')} onClick={() => setTab('pledge')}>
          Pledge asset
        </button>
        <button className={'tab' + (tab === 'borrow' ? ' active' : '')} onClick={() => setTab('borrow')}>
          Borrow / repay
        </button>
      </div>
      {tab === 'pledge' ? <PledgeForm onPledged={onChanged} /> : <BorrowPanel onChanged={onChanged} />}
    </div>
  );
}
