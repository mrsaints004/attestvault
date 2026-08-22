import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { truncAddress } from '../lib/units';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="connect-row">
        <span className="pill mono">{truncAddress(address)}</span>
        <button className="btn ghost small" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];

  return (
    <button className="btn" disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })}>
      {isPending ? 'Connecting…' : injected ? 'Connect wallet' : 'No wallet found'}
    </button>
  );
}
