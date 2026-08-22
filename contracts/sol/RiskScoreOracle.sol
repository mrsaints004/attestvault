// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IRiskScoreOracle {
    function scoreOf(address borrower) external view returns (uint16);
}

/// @notice Persistent, portable per-borrower risk/credit score, deliberately kept separate from
/// CollateralManager so it survives across portfolios/loans and could be read by other protocols
/// later — the "portable credit history" idea, applied to verified collateral behavior instead of
/// self-reported repayment history.
///
/// Scores are written by an off-chain risk engine (worker/riskEngine.ts) using a transparent,
/// published formula over CollateralManager's verified on-chain state (see the README for why this
/// is a plain auditable formula rather than an opaque model for the hackathon build).
contract RiskScoreOracle is Ownable, IRiskScoreOracle {
    uint16 public constant MIN_SCORE = 0;
    uint16 public constant MAX_SCORE = 1000;
    uint16 public constant DEFAULT_SCORE = 500; // neutral starting score for a first-time borrower

    mapping(address => uint16) private _scores;
    mapping(address => bool) private _hasScore;

    /// @dev Separate from `owner` so the deployer key and the risk-engine's operational key can be
    /// rotated independently — the risk engine runs continuously off-chain and its key shouldn't
    /// also be the contract admin key.
    address public scorer;

    event ScorerUpdated(address indexed newScorer);
    event ScoreUpdated(address indexed borrower, uint16 oldScore, uint16 newScore);

    constructor(address _scorer) Ownable(msg.sender) {
        require(_scorer != address(0), "zero address");
        scorer = _scorer;
        emit ScorerUpdated(_scorer);
    }

    modifier onlyScorer() {
        require(msg.sender == scorer, "not authorized scorer");
        _;
    }

    function setScorer(address _scorer) external onlyOwner {
        require(_scorer != address(0), "zero address");
        scorer = _scorer;
        emit ScorerUpdated(_scorer);
    }

    function setScore(address borrower, uint16 newScore) external onlyScorer {
        require(newScore <= MAX_SCORE, "score out of range");

        uint16 oldScore = _hasScore[borrower] ? _scores[borrower] : DEFAULT_SCORE;
        _scores[borrower] = newScore;
        _hasScore[borrower] = true;

        emit ScoreUpdated(borrower, oldScore, newScore);
    }

    function scoreOf(address borrower) external view returns (uint16) {
        return _hasScore[borrower] ? _scores[borrower] : DEFAULT_SCORE;
    }
}
