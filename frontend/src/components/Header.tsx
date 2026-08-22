import { ConnectButton } from './ConnectButton';
import { NetworkChip } from './NetworkChip';

export function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">AV</span>
        <span className="name">AttestVault</span>
        <span className="tagline">cross-chain RWA collateral, proven not promised</span>
      </div>
      <div className="topbar-right">
        <NetworkChip />
        <ConnectButton />
      </div>
    </header>
  );
}
