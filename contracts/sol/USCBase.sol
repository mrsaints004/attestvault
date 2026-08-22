// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INativeQueryVerifier, NativeQueryVerifierLib} from
    "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Adapted from the Attestcoin Protocol reference `USCBase`
/// (`usc-testnet-bridge-examples/contracts/sol/USCBase.sol`). Two changes from the reference:
///
///   1. `chainKey` is threaded through to `_processAndEmitEvent`. The reference only ever talks to
///      one hardcoded source contract, so it doesn't need this; AttestVault accepts pledges from
///      multiple source chains, so handlers need to know which chain an event came from.
///   2. `executeBatch` is added: it calls the precompile's *batch* `verifyAndEmit` overload
///      (arrays of heights/transactions/Merkle proofs + one shared continuity proof) instead of the
///      single-transaction one, then replays `_processAndEmitEvent` once per verified transaction.
///
/// The verifier interface below is imported directly from the officially published
/// the officially published "usc-contracts" package (`write-ability/common/INativeQueryVerifier.sol`,
/// see the import above) rather than a hand-reconstructed copy — confirmed to exist there with both
/// single-tx and batch verify/verifyAndEmit overloads, byte-identical in shape to what this project
/// had independently reconstructed from the SDK's block_prover.json ABI. That reconstruction was
/// correct; importing the real source removes any residual risk of drift.
abstract contract USCBase {
    /// @dev Matches the documented Attestcoin batch limit ("up to 10 queries which share a
    /// continuity proof"). Enforced here defensively even though the precompile presumably
    /// enforces its own limit too.
    uint256 public constant MAX_BATCH_SIZE = 10;

    /// @notice The Native Query Verifier / Block Prover precompile instance.
    /// @dev Address: 0x0000000000000000000000000000000000000FD2
    INativeQueryVerifier public immutable VERIFIER;

    mapping(bytes32 => bool) public processedQueries;

    constructor() {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    function _processAndEmitEvent(
        uint8 action,
        uint64 chainKey,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal virtual;

    /// @notice Single-transaction verify + process path. Identical in shape to the reference
    /// USCBase.execute, aside from passing `chainKey` down to the handler.
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleProof);
        require(!processedQueries[queryId], "Query already processed");

        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });

        bool verified =
            VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        require(verified, "Proof of inclusion verification failed");

        processedQueries[queryId] = true;
        _processAndEmitEvent(action, chainKey, queryId, encodedTransaction);

        return true;
    }

    /// @notice Batch verify + process path. All entries must come from the same `chainKey` and
    /// share one continuity proof, matching how the usc-sdk package's ProofBuilder.getBatchProof /
    /// PrecompileBlockProver.verifyAndEmitBatch build batches.
    function executeBatch(
        uint8[] calldata actions,
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        uint256 n = encodedTransactions.length;
        require(n > 0 && n <= MAX_BATCH_SIZE, "invalid batch size");
        require(actions.length == n && heights.length == n && merkleProofs.length == n, "batch length mismatch");

        INativeQueryVerifier.ContinuityProof memory sharedProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });

        bool verified =
            VERIFIER.verifyAndEmit(chainKey, heights, encodedTransactions, merkleProofs, sharedProof);
        require(verified, "Batch proof verification failed");

        for (uint256 i = 0; i < n; i++) {
            bytes32 queryId = _computeQueryId(chainKey, heights[i], merkleProofs[i]);
            if (processedQueries[queryId]) {
                continue; // already-processed entries are skipped, not reverted, so a resubmitted
                          // batch containing one stale entry doesn't fail the whole batch
            }
            processedQueries[queryId] = true;
            _processAndEmitEvent(actions[i], chainKey, queryId, encodedTransactions[i]);
        }

        return true;
    }

    function _computeQueryId(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProof memory merkleProof)
        internal
        view
        returns (bytes32 queryId)
    {
        uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        return keccak256(abi.encodePacked(chainKey, blockHeight, txIndex));
    }
}
