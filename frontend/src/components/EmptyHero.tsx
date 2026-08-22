import { ConnectButton } from './ConnectButton';

export function EmptyHero() {
  return (
    <div className="empty-hero">
      <div className="eyebrow">RWA · AI · DeFi — Creditcoin BUIDL CTC 2026</div>
      <h1>
        Collateral, <em>proven</em> — not promised.
      </h1>
      <p>
        Pledge real-world assets across chains, verify each one directly from source-chain data via
        the Attestcoin Protocol, and borrow against one pooled, transparently-scored portfolio.
      </p>
      <ConnectButton />
    </div>
  );
}
