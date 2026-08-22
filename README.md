# AttestVault

**Cross-chain RWA collateral engine with AI-assisted risk scoring, built on the Attestcoin Protocol.**

Submission for BUIDL CTC 2026 Fall (Creditcoin / Credit Labs) — Tracks: **RWA** + **AI** (+ **DeFi**).

---

## 1. The problem

Real-world assets are being tokenized everywhere — invoices on one chain, tokenized real estate on
another, carbon credits on a third — but a lender on Creditcoin has no trustless way to see all of
a borrower's collateral at once. Today that means either:

- a centralized price/valuation oracle vouching for each asset (a single point of failure and trust), or
- collateral being siloed per-chain, so a borrower can't use their *whole* portfolio to back one loan.

## 2. What AttestVault does

AttestVault lets a borrower pledge real-world assets on multiple source chains and pool them into
**one portfolio** on Creditcoin. Every pledge, value update, and release is verified directly from
the source chain's own block data via the **Attestcoin Protocol** — no price oracle, no centralized
attestor. A transparent risk-scoring engine turns that verified portfolio into a persistent,
portable **risk/credit score** per borrower, which sets how much they can borrow and against how
much collateral.

```
 Source Chain A (e.g. Sepolia)      Source Chain B (e.g. another USC source chain)
 ┌───────────────────────┐          ┌───────────────────────┐
 │ AuxiliaryAssetVault    │          │ AuxiliaryAssetVault    │
 │  pledgeAsset()         │          │  pledgeAsset()         │
 │  updateAssetValue()    │          │  updateAssetValue()    │
 │  releaseAsset()        │          │  releaseAsset()        │
 └──────────┬─────────────┘          └──────────┬─────────────┘
            │ emits AssetPledged / AssetValueUpdated / AssetReleased
            ▼                                    ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  off-chain worker (worker/index.ts)                         │
 │  - polls both vaults for new events                         │
 │  - waits for Attestcoin attestation of the block             │
 │  - fetches a proof via @gluwa/usc-sdk (single or BATCH)      │
 └───────────────────────────┬───────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  Creditcoin testnet                                          │
 │  CollateralManager.execute() / .executeBatch()                │
 │   -> verifies proof(s) against the Native Query Verifier      │
 │      precompile (0x...FD2) — no oracle call                   │
 │   -> updates the borrower's Portfolio                         │
 │  RiskScoreOracle.setScore()                                   │
 │   -> risk engine (worker/riskEngine.ts) writes a portable,     │
 │      persistent score per borrower from verified portfolio     │
 │      data                                                     │
 └─────────────────────────────────────────────────────────────┘
```

## 3. How this uses the Attestcoin Protocol (the required integration)

This is the part judges will grep for, so it's stated explicitly:

- **SDK used:** [`@gluwa/usc-sdk`](https://www.npmjs.com/package/@gluwa/usc-sdk) v0.18.0 —
  `proof-provider/service` (`ProofBuilder`), `chain-info` (`PrecompileChainInfoProvider`),
  `block-prover` (`PrecompileBlockProver`).
- **Precompile used:** the Native Query Verifier / Block Prover precompile at
  `0x0000000000000000000000000000000000000FD2` on Creditcoin (CC3 Testnet).
- **Two verification paths, both real, both wired up:**
  1. **Single-transaction path** (`execute`) — same pattern as the official
     `usc-testnet-bridge-examples/loan-flow` reference: one transaction, one Merkle proof, one
     continuity proof, verified via `VERIFIER.verifyAndEmit(chainKey, height, tx, merkleProof, continuityProof)`.
  2. **Batch path** (`executeBatch`) — the deeper integration this project is built around. The
     precompile exposes an *overload* of `verifyAndEmit` that accepts **arrays** of heights,
     encoded transactions, and Merkle proofs, plus **one shared `ContinuityProof`** for the whole
     batch (`verifyAndEmit(chainKey, heights[], encodedTransactions[], merkleProofs[], sharedContinuityProof)`).
     AttestVault uses this to verify up to `MAX_BATCH_SIZE = 10` pledge/value-update events from a
     single source chain in one call, fetched off-chain via `ProofBuilder.getBatchProof(txHashes)`.
     This is what lets a borrower's whole multi-asset portfolio update get verified cheaply and
     atomically instead of one attestation per asset.
- **No centralized oracle anywhere in the value path.** `CollateralManager` never calls out to a
  price feed; every `valueUSD` it stores was asserted on a source chain and proven to exist there
  via the precompile before it's trusted.

> **Verification note for reviewers:** the batch ABI above (`verify`/`verifyAndEmit` overloads
> taking `uint64[] heights`, `bytes[] encodedTransactions`, `MerkleProof[] merkleProofs`, one shared
> `ContinuityProof`) was pulled directly from the published `block_prover.json` ABI shipped inside
> `@gluwa/usc-sdk@0.18.0` (`dist/block-prover/block_prover.json`), not guessed. `contracts/sol/USCBase.sol`
> reproduces that ABI in `VerifierInterface.sol`. **Before demo day**, run the batch path once
> end-to-end against CC3 Testnet to confirm real-world gas cost and any precompile-side batch-size
> limits beyond what's documented (see `TODO` markers in `worker/utils.ts`).

## 4. The "touch of credit scoring" (why this isn't just a vault)

A collateral pool alone is a DeFi primitive. What ties it back to Creditcoin's actual thesis
(portable, verifiable credit history) is `RiskScoreOracle`: every time a portfolio's verified
collateral changes, `worker/riskEngine.ts` recomputes a **transparent, auditable** score
(0–1000) from:

- total verified collateral value and its diversification across asset categories/chains,
- how long assets have stayed pledged without being pulled right before a value drop,
- past liquidation history for that borrower address.

That score is written on-chain and persists across loans — a borrower who behaves well gets a
better collateral ratio next time, the same way a credit score works, except every input to it is
independently verifiable instead of self-reported. The formula is deliberately a plain weighted
function, not an opaque model, so it can be audited and defended live during judging; the
interface (`worker/riskEngine.ts:computeRiskScore`) is written so the formula can be swapped for a
trained model later without touching the contracts.

## 5. Repo layout

```
attestvault/
├── contracts/sol/
│   ├── VerifierInterface.sol   # INativeQueryVerifier — single + batch ABI, precompile at 0x...FD2
│   ├── USCBase.sol             # adapted from the reference USCBase: adds chainKey routing + executeBatch
│   ├── AssetTypes.sol          # AssetCategory, PledgeStatus, AssetPledge, Portfolio
│   ├── AuxiliaryAssetVault.sol # deployed per source chain; where assets get pledged
│   ├── RiskScoreOracle.sol     # persistent per-borrower score registry
│   └── CollateralManager.sol   # deployed on Creditcoin; the core protocol contract
├── worker/
│   ├── utils.ts                # proof fetching/submission helpers (adapted from usc-testnet-bridge-examples/utils)
│   ├── index.ts                # off-chain worker: watches source vaults, proves + submits events
│   └── riskEngine.ts           # computes and pushes risk scores
├── scripts/
│   ├── deploy.ts                # deploys AuxiliaryAssetVault(s) (source chain 1, optionally 2) +
│   │                             #   RiskScoreOracle/CollateralManager (Creditcoin)
│   ├── pledge_asset.ts          # CLI: pledge a demo RWA (--chain 1|2)
│   ├── inspect_portfolio.ts     # CLI: print a borrower's verified portfolio + score
│   └── demo_batch_proof.ts      # CLI: pledges N assets then verifies all of them with ONE batch
│                                 #   proof + ONE tx — the "one call, not ten" demo moment
├── foundry.toml
├── remappings.txt
├── package.json
└── .env.example
```

## 6. Setup

Prerequisites match the official Attestcoin examples: `yarn`, `foundry` (contracts), `node`/`ts-node`
(worker + scripts).

```bash
cd attestvault
yarn install             # also pulls @openzeppelin/contracts + @gluwa/usc-contracts into
                          # node_modules, which remappings.txt points Foundry at
cp .env.example .env     # fill in RPC URLs, private keys, chain keys — see below
forge build
```

> `package.json` pins `@gluwa/usc-sdk@^0.18.0` and `@gluwa/usc-contracts@^0.2.0` — both confirmed
> against the real published npm registry (an earlier draft of this file guessed `^0.18.0` for
> `usc-contracts` too; that version doesn't exist, it tops out at `0.2.0`). `forge build` has been
> run against these exact versions and compiles clean (Solc 0.8.28, `via_ir = true` — required, see
> the compiler notes in §9). `EvmV1Decoder` is imported from
> `@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol`, confirmed by reading the
> installed package, not `contracts/decoding/...` as an earlier draft assumed.

Fill in `.env`:

| Variable | What it is |
|---|---|
| `SOURCE_CHAIN_RPC_URL` | RPC for the source chain (e.g. Ethereum Sepolia) |
| `SOURCE_CHAIN_KEY` | Attestcoin chain key for that source chain (Sepolia = `1` per current CC3 Testnet config) |
| `CREDITCOIN_RPC_URL` | CC3 Testnet RPC |
| `PROOF_BUILDER_URL` | `https://proof-gen-api.cc3-testnet.creditcoin.network/` |
| `DEPLOYER_PRIVATE_KEY` | deploys all contracts |
| `RISK_ENGINE_PRIVATE_KEY` | separate key authorized to write to `RiskScoreOracle` |
| `SOURCE_CHAIN_2_RPC_URL` / `SOURCE_CHAIN_2_KEY` | *optional* — second source chain; leave blank to run single-chain (see honesty note below) |
| `AUXILIARY_ASSET_VAULT_ADDRESS` / `AUXILIARY_ASSET_VAULT_2_ADDRESS` / `COLLATERAL_MANAGER_ADDRESS` / `RISK_SCORE_ORACLE_ADDRESS` | filled in after `scripts/deploy.ts` |

Deploy, then run the worker:

```bash
yarn ts-node scripts/deploy.ts
yarn ts-node worker/index.ts
```

`scripts/deploy.ts` deploys a second `AuxiliaryAssetVault` and registers it on `CollateralManager`
automatically if `SOURCE_CHAIN_2_RPC_URL`/`SOURCE_CHAIN_2_KEY` are set in `.env`; otherwise it
deploys single-chain. `worker/index.ts` mirrors this — it polls a second chain's vault only if
`AUXILIARY_ASSET_VAULT_2_ADDRESS` is also present. Each chain gets its own event queue, since a
batch proof can only cover transactions from one chain at a time.

Pledge a demo asset and watch it flow through:

```bash
yarn ts-node scripts/pledge_asset.ts --category invoice --value 25000           # chain 1 (default)
yarn ts-node scripts/pledge_asset.ts --category carboncredit --value 8000 --chain 2
yarn ts-node scripts/inspect_portfolio.ts --borrower 0xYourAddress
```

To make the batch-proof "one call, not ten" moment visible for a live demo/recording, without
waiting on the worker's poll loop:

```bash
yarn ts-node scripts/demo_batch_proof.ts --count 3
```

This pledges `--count` assets back to back, then explicitly requests **one** continuity proof
covering all of them and submits **one** `executeBatch` transaction, printing each step (tx hashes,
proof shape, gas used) so the contrast with "one proof per asset" is obvious on screen.

> **Honesty note on "multi-chain":** as of writing, CC3 Testnet's published source-chain config
> (`docs.creditcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments`) clearly lists
> Ethereum Sepolia (chain key `1`); a second testnet entry in that table is ambiguous in the current
> docs. The contracts, worker, deploy script, and pledge script are all wired to support a second
> source chain (`SOURCE_CHAIN_2_RPC_URL`/`SOURCE_CHAIN_2_KEY`) — but confirm the second chain key
> with the Creditcoin team (`#buidl-ctc-qna` on Discord) before promising judges a live two-chain
> demo, and fall back to "two different asset types pledged on the one confirmed source chain" (or
> the `demo_batch_proof.ts` single-chain batch demo above) if a second testnet source isn't
> available in time.

## 7. What's a real, working reference vs. what's original here

To keep this honest for judges:

- `worker/utils.ts`'s single-proof helpers (`generateProofFor`, `pollEvents`, gas estimation
  pattern) are adapted directly from Attestcoin's official `usc-testnet-bridge-examples/loan-flow`
  reference — same pattern proven to work for `USCLoanManager`.
- `contracts/sol/USCBase.sol`'s single-tx `execute()` path is adapted from that same reference, with
  `chainKey` threaded through `_processAndEmitEvent` (the reference only supports one hardcoded
  source contract; AttestVault supports many, keyed by chain). Its verifier interface is no longer a
  hand-written copy — `USCBase.sol` imports `INativeQueryVerifier`/`NativeQueryVerifierLib` directly
  from `@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`, the officially
  published source. That package's interface includes both single-tx and batch
  `verify`/`verifyAndEmit` overloads, byte-identical to what this project had independently
  reconstructed from the SDK's `block_prover.json` earlier — the reconstruction was correct, and
  importing the real source now removes any residual risk of drift.
- `executeBatch`, `worker/utils.ts`'s `getBatchProof` integration, `AssetTypes.sol`,
  `AuxiliaryAssetVault.sol`, `RiskScoreOracle.sol`, and `CollateralManager.sol` are original to this
  project.

## 8. Track fit

- **RWA** — multi-source-chain real-world asset collateral, verified without a centralized oracle.
- **AI** — the risk-scoring engine consuming attested cross-chain data to autonomously set
  borrowing terms and trigger rebalancing/liquidation.
- **DeFi** — the lending/collateral-ratio mechanics on top.

## 9. What's verified vs. what still needs a real test run

Updated after an actual audit pass: dependencies were installed for real, Foundry was installed and
`forge build` was actually run, `tsc --noEmit` was actually run against every TypeScript file
(worker, scripts, and frontend), and every contract/ABI signature quoted below was checked against
the files as installed from npm — not recalled from memory. That pass found and fixed several real
bugs; they're listed below rather than swept away, since knowing what *was* wrong is as useful as
knowing what's right now.

**Now confirmed by actually running the tools, not just reading docs:**
- `forge build` succeeds (Solc 0.8.28, `via_ir = true`) — zero errors, zero warnings. This had never
  been run before; it does not mean the contracts are correct, only that they compile.
- `npx tsc --noEmit` is clean across `worker/`, `scripts/`, and `frontend/`.
- `@gluwa/usc-sdk@0.18.0` and `@gluwa/usc-contracts@0.2.0` are the real, resolvable versions
  (`package.json` previously pinned `usc-contracts@^0.18.0`, which doesn't exist).
- `EvmV1Decoder`'s real path is
  `@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol` — its actual API
  (`getTransactionType`, `isValidTransactionType`, `decodeReceiptFields`, `getLogsByEventSignature`,
  the `LogEntry`/`ReceiptFields` struct field names) matches what `CollateralManager.sol` already
  assumed; only the import path was wrong.
- The batch verifier interface is real: `@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`
  ships both single-tx and batch `verify`/`verifyAndEmit` overloads, and `USCBase.sol` now imports it
  directly instead of a hand-written copy.
- Precompile address (`0x...FD2`) and `MerkleProofEntry {bytes32 hash, bool isLeft}` — confirmed
  identical across the reference repo, the SDK, and the on-chain interface package.

**Bugs an actual audit pass found and fixed (previously undetected because nothing had been run):**
1. `@gluwa/usc-contracts` version pin was wrong (`^0.18.0` → `^0.2.0`) — install would have failed outright.
2. `EvmV1Decoder` import path was wrong (`contracts/decoding/...` → `contracts/write-ability/common/...`).
3. `foundry.toml` pinned Solc `0.8.23`, but the real `usc-contracts` package requires `^0.8.28` —
   bumped, plus `via_ir = true` added (`executeBatch` hits a "stack too deep" error without it).
4. NatSpec doc comments containing literal `@gluwa/...` package names broke the Solidity parser
   (`@` is a NatSpec tag prefix) — reworded to avoid `@`-prefixed text in `///` comments.
5. `CollateralManager._handleReleased` checked a release against `p.riskScore`, a value only ever
   refreshed inside `borrow()` — so a release could use a stale, more favorable score than the
   borrower currently has (e.g. after a liquidation elsewhere lowered it). Now fetches
   `riskOracle.scoreOf()` live.
6. `worker/utils.ts`'s gas estimation passed an unresolved `Promise<string>` (`contract.getAddress()`)
   as a transaction's `to` field instead of awaiting it first.
7. Five files (`worker/index.ts`, `worker/riskEngine.ts`, `scripts/pledge_asset.ts`,
   `scripts/inspect_portfolio.ts`, `scripts/demo_batch_proof.ts`) constructed `ethers.Contract` with
   the *entire* Foundry artifact JSON (`{abi, bytecode, ...}`) instead of just `.abi` — would have
   thrown at runtime on the first contract call. `scripts/deploy.ts` was already correct.
8. The worker tracked pledge owners locally for risk-score recomputation, but
   `AssetValueUpdated`/`AssetReleased` events don't carry an owner address — those recomputes were
   silently firing against the zero address, meaning a score never actually updated after a
   value-drop-triggered liquidation. Fixed to read the real borrower back from
   `CollateralManager`'s own `PortfolioValueChanged` event after each submission.
9. The frontend fired reads/writes at the configured contract addresses regardless of whether they
   were still the zero address (pre-deployment) — fixed to gate every query and write behind
   `isDeployed`.

**Still needs your own verification — a clean compile doesn't prove runtime behavior:**
1. `executeBatch`'s on-chain call into the precompile's batch `verifyAndEmit` overload — the
   interface is now confirmed real and byte-identical to the published package, but nobody has
   called it against the live CC3 Testnet precompile yet. Test this first, in isolation
   (`yarn demo:batch --count 2`), before building a demo around it.
2. Whether CC3 Testnet currently exposes a second source chain (see §6's honesty note) — wired
   mechanically, but no real second chain key has been confirmed.
3. `worker/index.ts`'s batch-flush thresholds (2 events / 30s) are illustrative defaults, untuned for
   your actual demo pacing.
