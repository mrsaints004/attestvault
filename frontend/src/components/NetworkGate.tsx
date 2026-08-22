import type { ReactNode } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';

/** Wraps an action panel that requires the wallet to be connected to a specific chain. Shows a
 * switch-network prompt instead of the panel's controls when the wallet is on the wrong chain —
 * mirrors the real constraint that pledges happen on the source chain and borrowing happens on
 * Creditcoin, two different networks. */
export function NetworkGate({ chainId, chainName, children }: { chainId: number; chainName: string; children: ReactNode }) {
  const { chainId: connectedId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return <div className="gate-note">Connect a wallet to continue.</div>;
  }

  if (connectedId !== chainId) {
    return (
      <div className="gate-note">
        <span>This action happens on {chainName}. Your wallet is on a different network.</span>
        <button className="btn small" disabled={isPending} onClick={() => switchChain({ chainId })}>
          {isPending ? 'Switching…' : `Switch to ${chainName}`}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
