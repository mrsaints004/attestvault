# AttestVault

**Cross-chain RWA collateral engine with autonomous risk scoring, built on the Attestcoin Protocol.**

BUIDL CTC 2026 Fall — Track: **RWA** | Supporting: **DeFi**, **AI**

---

## The Problem

Tokenized real-world assets (invoices, real estate, carbon credits) are scattered across multiple blockchains. A lender on Creditcoin has no trustless way to see all of a borrower's collateral at once. Today that means either relying on a centralized oracle (single point of failure) or siloing collateral per-chain so a borrower can't use their full portfolio to back one loan.

## What AttestVault Does

AttestVault lets a borrower pledge RWAs on multiple source chains and pool them into **one portfolio** on Creditcoin. Every pledge, value update, and release is verified directly from the source chain's block data via the **Attestcoin Protocol** — no price oracle, no centralized attestor.

An **autonomous risk scoring engine** continuously reads the verified portfolio state and computes a portable **credit score** (0–1000) per borrower, which determines borrowing limits and triggers on-chain score updates — all without manual intervention.

```
 Source Chain A (e.g. Sepolia)      Source Chain B (optional)
 ┌───────────────────────┐          ┌───────────────────────┐
 │ AuxiliaryAssetVault    │          │ AuxiliaryAssetVault    │
 │  pledgeAsset()         │          │  pledgeAsset()         │
 │  pledgeAssetFor()      │          │  pledgeAssetFor()      │
 │  updateAssetValue()    │          │  updateAssetValue()    │
 │  releaseAsset()        │          │  releaseAsset()        │
 └──────────┬─────────────┘          └──────────┬─────────────┘
            │ emits AssetPledged / AssetValueUpdated / AssetReleased
            ▼                                    ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  Off-chain worker (worker/index.ts)                         │
 │  - polls vaults for new events                              │
 │  - waits for Attestcoin attestation of the block            │
 │  - fetches proof via @gluwa/usc-sdk (single or BATCH)       │
 └───────────────────────────┬───────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  Creditcoin (CC3 Testnet)                                    │
 │  CollateralManager.execute() / .executeBatch()               │
 │   → verifies proof(s) via Native Query Verifier precompile   │
 │   → updates the borrower's Portfolio                         │
 │                                                               │
 │  Autonomous Risk Scoring (worker/riskEngine.ts)              │
 │   → reads verified portfolio state                           │
 │   → computes risk score (0-1000)                             │
 │   → pushes score on-chain via RiskScoreOracle                │
 │   → score gates borrowing limits automatically               │
 └─────────────────────────────────────────────────────────────┘
```

## Attestcoin Protocol Integration

- **SDK:** [`@gluwa/usc-sdk`](https://www.npmjs.com/package/@gluwa/usc-sdk) v0.18.0 — `ProofBuilder`, `PrecompileChainInfoProvider`, `PrecompileBlockProver`
- **Precompile:** Native Query Verifier at `0x0000000000000000000000000000000000000FD2` on Creditcoin CC3 Testnet
- **Two verification paths:**
  1. **Single-transaction** (`execute`) — one tx, one Merkle proof, one continuity proof, verified via `VERIFIER.verifyAndEmit(chainKey, height, tx, merkleProof, continuityProof)`
  2. **Batch** (`executeBatch`) — verifies up to 10 transactions in one call using the precompile's array overload with a shared `ContinuityProof`. This lets a multi-asset portfolio update get verified atomically instead of one proof per asset.
- **No centralized oracle.** Every `valueUSD` stored by `CollateralManager` was asserted on a source chain and proven via the precompile before being trusted.

> The batch ABI (`verifyAndEmit` overloads taking `uint64[] heights`, `bytes[] encodedTransactions`, `MerkleProof[] merkleProofs`, one shared `ContinuityProof`) is from the published `block_prover.json` shipped in `@gluwa/usc-sdk@0.18.0`. `USCBase.sol` imports `INativeQueryVerifier` directly from `@gluwa/usc-contracts`.

## Autonomous Risk Scoring Engine

The risk engine (`worker/riskEngine.ts`) processes cryptographically verified cross-chain data and computes a score from five signals:

| Signal | Effect | Cap |
|--------|--------|-----|
| Total collateral value | +1 per $5k | +200 |
| Asset category diversity | +50 per distinct type | combined +200 |
| Source chain diversity | +50 per distinct chain | combined +200 |
| Pledge tenure | +10 per 1000-block avg age | +100 |
| Liquidation history | -150 per past liquidation | -450 |

**Base score: 400. Range: 0–1000.**

The score maps to a required collateral ratio: 150% at score 0, down to 110% at score 1000 (linear interpolation). After each batch of Attestcoin proofs is submitted, the worker autonomously recomputes the score and writes it on-chain via `RiskScoreOracle.setScore()`. The `computeRiskScore` function is the model boundary — it can be swapped for a trained ML model without changing any contract or proof code.

### Additional Features

- **Issuer-attested valuations:** `AuxiliaryAssetVault` supports both self-pledge (`pledgeAsset`) and issuer-attested pledge (`pledgeAssetFor`) where registered issuers attest to asset values.
- **Interest accrual:** ~5% APR simple interest, computed per-second, applied automatically on `borrow()` or `repay()`.
- **Smallest-value-first liquidation:** When collateral ratio drops below 105%, the smallest active pledge is liquidated first to minimize collateral destruction.
- **Emergency controls:** Owner can pause/unpause borrow and repay via OpenZeppelin `Pausable`.

## Deployed Contracts

| Contract | Chain | Address | Explorer |
|----------|-------|---------|----------|
| AuxiliaryAssetVault | Ethereum Sepolia | `0x0B127Ce506360e6e650e63415Df819C12E857f90` | [Etherscan](https://sepolia.etherscan.io/address/0x0B127Ce506360e6e650e63415Df819C12E857f90) |
| RiskScoreOracle | Creditcoin CC3 Testnet | `0x0B127Ce506360e6e650e63415Df819C12E857f90` | [Blockscout](https://creditcoin-testnet.blockscout.com/address/0x0B127Ce506360e6e650e63415Df819C12E857f90) |
| CollateralManager | Creditcoin CC3 Testnet | `0x55A8d53a9D3F960F40571d9647c14708bBB0b85A` | [Blockscout](https://creditcoin-testnet.blockscout.com/address/0x55A8d53a9D3F960F40571d9647c14708bBB0b85A) |

### Verified Transactions

| Action | Tx Hash | Explorer |
|--------|---------|----------|
| Pledge Invoice ($50k) | `0x9df0fad6...2f43a6` | [view](https://sepolia.etherscan.io/tx/0x9df0fad6db8ab974c3d76fa800013d0f513144c2c775c453fc001f744d2f43a6) |
| Pledge Real Estate ($200k) | `0x847cbaa0...517a25` | [view](https://sepolia.etherscan.io/tx/0x847cbaa0cd73e83e662f3f5f115070db403699b2469c3259378617e934517a25) |
| Pledge Carbon Credit ($15k) | `0x7053cfae...3195ac` | [view](https://sepolia.etherscan.io/tx/0x7053cfaecd980d3e74b01e8c27468a6e7714e80413cdd487b3356ce6bd3195ac) |
| Batch proof verification (3-in-1) | `0xc48c576d...621e7f` | [view](https://creditcoin-testnet.blockscout.com/tx/0xc48c576d0f03da30f2c3c6086483d9bb2473b2956dc1b61378feae8a4c621e7f) |
| Risk score update (653/1000) | `0x59877236...6252de` | [view](https://creditcoin-testnet.blockscout.com/tx/0x5987723db38176c9d9ae48462fdc2e0e86d70abb33727866ac92c509146252de) |
| Borrow $100k against collateral | `0x0f089707...379de8` | [view](https://creditcoin-testnet.blockscout.com/tx/0x0f0897071392701da04ecb891f38bff2196cfbab5c1f62926bf76cebaa379de8) |

## Repo Layout

```
attestvault/
├── contracts/sol/
│   ├── AssetTypes.sol            # data structures (AssetCategory, PledgeStatus, Portfolio)
│   ├── AuxiliaryAssetVault.sol   # deployed per source chain — asset pledge/release
│   ├── USCBase.sol               # Attestcoin verifier base — adds batch path (executeBatch)
│   ├── RiskScoreOracle.sol       # persistent per-borrower score registry
│   └── CollateralManager.sol     # core protocol contract on Creditcoin
├── test/
│   ├── AuxiliaryAssetVault.t.sol # 27 tests
│   ├── RiskScoreOracle.t.sol     # 13 tests
│   └── CollateralManager.t.sol   # 15 tests
├── worker/
│   ├── index.ts                  # event polling, proof relay, autonomous scoring loop
│   ├── utils.ts                  # proof generation/submission helpers
│   ├── riskEngine.ts             # scoring engine
│   └── riskEngine.test.ts        # 21 tests
├── scripts/
│   ├── deploy.ts                 # deploy all contracts
│   ├── verify.ts                 # verify on Blockscout/Etherscan
│   ├── pledge_asset.ts           # CLI: pledge an asset
│   ├── inspect_portfolio.ts      # CLI: view portfolio + score
│   ├── demo_batch_proof.ts       # CLI: batch proof demo
│   └── demo_full.ts              # CLI: end-to-end demo
├── frontend/                     # React + TypeScript + wagmi/viem dashboard
│   └── src/
│       ├── components/           # PledgeForm, BorrowPanel, ScoreCard, PledgeList, etc.
│       ├── hooks/                # usePortfolioData
│       ├── abi/                  # contract ABIs
│       ├── lib/                  # toast, errors, unit formatting
│       └── config.ts             # chain + contract config
├── web/
│   └── demo.html                # standalone demo console
├── docs/
│   └── pitch-deck.html          # project deck (open in browser, print to PDF)
├── assets/
│   └── logo.svg                 # project logo
├── foundry.toml
├── remappings.txt
├── package.json
└── .env.example
```

## Setup

**Prerequisites:** Node.js, npm (or yarn), [Foundry](https://book.getfoundry.sh/)

```bash
cd attestvault
npm install
forge install foundry-rs/forge-std --no-git
cp .env.example .env     # fill in RPC URLs and private keys
forge build
```

### Environment Variables

| Variable | Description |
|---|---|
| `SOURCE_CHAIN_RPC_URL` | RPC for the source chain (e.g. Ethereum Sepolia) |
| `SOURCE_CHAIN_KEY` | Attestcoin chain key (Sepolia = `1`) |
| `CREDITCOIN_RPC_URL` | CC3 Testnet RPC |
| `PROOF_BUILDER_URL` | `https://proof-gen-api.cc3-testnet.creditcoin.network/` |
| `DEPLOYER_PRIVATE_KEY` | deploys all contracts |
| `RISK_ENGINE_PRIVATE_KEY` | separate key for `RiskScoreOracle` writes |
| `SOURCE_CHAIN_2_RPC_URL` / `SOURCE_CHAIN_2_KEY` | *optional* — second source chain |

### Deploy and Run

```bash
# Deploy contracts
npx ts-node scripts/deploy.ts
# Copy printed addresses to .env, then verify on explorers
npx ts-node scripts/verify.ts

# Start the worker (polls events, proves, submits, scores)
npx ts-node worker/index.ts

# Pledge a demo asset on the source chain
npx ts-node scripts/pledge_asset.ts --category invoice --value 25000

# Inspect a portfolio
npx ts-node scripts/inspect_portfolio.ts --borrower 0xYourAddress

# Run the full end-to-end demo
npx ts-node scripts/demo_full.ts
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # fill in contract addresses
npm run dev            # starts on localhost:5173
```

## Tests

```bash
npm test              # all tests (Forge + TypeScript)
npm run test:sol      # Forge contract tests only (55 tests)
npm run test:risk     # risk engine tests only (21 tests)
```

**76 tests total, 100% passing.**

- **AuxiliaryAssetVault** (27 tests): pledge, issuer-attested pledge, value updates, release, issuer management, value bounds
- **RiskScoreOracle** (13 tests): access control, score get/set, events, scorer rotation
- **CollateralManager** (15 tests): collateral ratio math, vault registration, borrow/repay, pause/unpause
- **Risk engine** (21 tests): scoring formula validation — collateral bonus, diversity, duration, liquidation penalty, clamping

## Attribution

- `worker/utils.ts` single-proof helpers and `USCBase.sol` single-tx `execute()` are adapted from the official [`usc-testnet-bridge-examples/loan-flow`](https://github.com/gluwa/usc-testnet-bridge-examples) reference. The verifier interface is imported from `@gluwa/usc-contracts`.
- **Original to this project:** `executeBatch`, batch proof integration, `AssetTypes.sol`, `AuxiliaryAssetVault.sol`, `RiskScoreOracle.sol`, `CollateralManager.sol` (interest accrual, liquidation, risk-score-driven ratios, emergency pause), the autonomous risk scoring engine, the frontend dashboard, and all CLI scripts.

## License

MIT
