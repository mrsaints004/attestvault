import { ConnectButton } from './ConnectButton';

export function EmptyHero() {
  return (
    <div className="empty-hero">
      <div className="eyebrow">RWA + DeFi + AI — Creditcoin BUIDL CTC 2026</div>
      <h1>
        Collateral, <em>proven</em> — not promised.
      </h1>
      <p>
        Pledge real-world assets across chains, verify each one directly from source-chain data via
        the Attestcoin Protocol, and let the AI risk agent score your portfolio so you can borrow
        against one pooled, transparently-scored position.
      </p>

      <div className="hero-steps">
        <div className="hero-step">
          <span className="hero-step-num">1</span>
          <div>
            <strong>Connect your wallet</strong>
            <span>MetaMask or any injected wallet</span>
          </div>
        </div>
        <div className="hero-step">
          <span className="hero-step-num">2</span>
          <div>
            <strong>Pledge assets</strong>
            <span>Invoices, real estate, carbon credits — verified via Attestcoin proofs</span>
          </div>
        </div>
        <div className="hero-step">
          <span className="hero-step-num">3</span>
          <div>
            <strong>AI scores &amp; you borrow</strong>
            <span>The AI agent computes your risk score and sets your borrowing limit automatically</span>
          </div>
        </div>
      </div>

      <ConnectButton />
    </div>
  );
}
