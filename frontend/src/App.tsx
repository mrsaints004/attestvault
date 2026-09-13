import { useState } from 'react';
import { useAccount } from 'wagmi';
import './App.css';
import { Header } from './components/Header';
import { EmptyHero } from './components/EmptyHero';
import { SummaryBar } from './components/SummaryBar';
import { ActionTabs } from './components/ActionTabs';
import { ScoreCard } from './components/ScoreCard';
import { PledgeList } from './components/PledgeList';
import { ActivityFeed } from './components/ActivityFeed';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './lib/toast';
import { usePortfolioData } from './hooks/usePortfolioData';
import { contracts, isDeployed, sourceChain, creditcoinChain } from './config';

function Dashboard() {
  const { address } = useAccount();
  const [refreshKey, setRefreshKey] = useState(0);
  const data = usePortfolioData(address);

  return (
    <>
      <SummaryBar key={'sb' + refreshKey} data={data} />
      <main className="grid">
        <div className="col-main">
          <ActionTabs onChanged={() => setRefreshKey((k) => k + 1)} />
          <PledgeList data={data} />
        </div>
        <div className="col-side">
          <ScoreCard data={data} />
          <ActivityFeed />
        </div>
      </main>
    </>
  );
}

function App() {
  const { isConnected } = useAccount();

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="app">
          <Header />

          {!isDeployed && (
            <div className="deploy-banner">
              <strong>Contracts not deployed yet.</strong> This UI is fully wired but has no addresses to
              talk to — run <span className="mono">npx ts-node scripts/deploy.ts</span> at the repo root, then fill in{' '}
              <span className="mono">frontend/.env</span> and restart <span className="mono">npm run dev</span>.
            </div>
          )}

          {isConnected ? <Dashboard /> : <EmptyHero />}

          <footer className="foot">
            <div>
              {sourceChain.name} (id {sourceChain.id}) · {creditcoinChain.name} (id {creditcoinChain.id})
            </div>
            <div className="mono addr-list">
              <div>Vault: {contracts.auxiliaryAssetVault}</div>
              <div>Manager: {contracts.collateralManager}</div>
              <div>Oracle: {contracts.riskScoreOracle}</div>
            </div>
          </footer>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
