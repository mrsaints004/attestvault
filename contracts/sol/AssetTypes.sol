// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum AssetCategory {
    Invoice,
    RealEstate,
    CarbonCredit,
    Other
}

enum PledgeStatus {
    Active,
    Released,
    Liquidated
}

struct AssetPledge {
    bytes32 globalId; // keccak256(sourceChainKey, localPledgeId) — unique across all source chains
    address owner;
    AssetCategory category;
    uint64 sourceChainKey;
    uint256 valueUSD; // fixed point, 8 decimals (matches Chainlink-style USD feeds for easy demo comparison)
    PledgeStatus status;
    uint256 pledgedAtBlock;
}

struct Portfolio {
    address borrower;
    bytes32[] pledgeIds;
    uint256 totalCollateralValueUSD;
    uint256 borrowedAmountUSD;
    uint16 riskScore; // 0-1000, written by RiskScoreOracle; higher = safer
    bool active;
}
