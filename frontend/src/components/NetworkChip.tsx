import { useAccount } from 'wagmi';
import { sourceChain, creditcoinChain } from '../config';

export function NetworkChip() {
  const { chainId, isConnected } = useAccount();
  if (!isConnected) return null;

  const known = chainId === sourceChain.id ? sourceChain : chainId === creditcoinChain.id ? creditcoinChain : null;

  return (
    <span className="network-chip mono">
      <span className={'dot' + (known ? '' : ' dot-warn')} />
      {known ? known.name : `Unknown chain (${chainId})`}
    </span>
  );
}
