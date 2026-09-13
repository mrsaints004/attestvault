// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AssetCategory} from "./AssetTypes.sol";

/// @notice Deployed on each source chain (e.g. Ethereum Sepolia). Plays the same role as
/// `AuxiliaryLoanContract` in the Attestcoin reference loan-flow example: it's the contract whose
/// events get proven cross-chain and acted on by `CollateralManager` on Creditcoin.
///
/// Two pledge paths:
///   1. `pledgeAsset` — the asset owner pledges directly (demo/testing convenience).
///   2. `pledgeAssetFor` — a registered issuer (e.g. an invoice factoring platform, a tokenized
///      real-estate registrar, a carbon registry) pledges on behalf of the owner and attests to the
///      value. In production this is the expected path: the issuer already knows the asset's value
///      from its own off-chain process, so self-assertion is replaced by issuer attestation.
///
/// Both paths emit the same `AssetPledged` event with the same signature, so the Attestcoin proof
/// flow and `CollateralManager._handlePledged` don't change at all — only who is allowed to call
/// the function differs.
contract AuxiliaryAssetVault is Ownable {
    event AssetPledged(uint256 indexed pledgeId, address indexed owner, uint8 category, uint256 valueUSD);
    event AssetValueUpdated(uint256 indexed pledgeId, uint256 newValueUSD);
    event AssetReleased(uint256 indexed pledgeId);
    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);

    struct LocalAsset {
        address owner;
        AssetCategory category;
        uint256 valueUSD;
        bool released;
    }

    /// @dev Maximum pledge value: $100M in 8-decimal fixed point. Prevents absurd pledges that
    /// could overflow portfolio math or be used to game collateral ratios.
    uint256 public constant MAX_PLEDGE_VALUE_USD = 100_000_000 * 1e8;

    mapping(uint256 => LocalAsset) public assets;
    uint256 public nextPledgeId = 1;

    /// @dev Registered issuers — trusted entities that can pledge and value assets on behalf of
    /// owners. When no issuers are registered, anyone can pledge for themselves (demo mode).
    mapping(address => bool) public issuers;

    constructor() Ownable(msg.sender) {}

    // --- Issuer management (owner-only) ---

    function addIssuer(address issuer) external onlyOwner {
        require(issuer != address(0), "zero address");
        issuers[issuer] = true;
        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer) external onlyOwner {
        issuers[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    // --- Pledge paths ---

    /// @notice Owner pledges their own asset. Works in demo mode (no issuers registered) and
    /// when the caller is a registered issuer pledging for themselves.
    function pledgeAsset(AssetCategory category, uint256 valueUSD) external returns (uint256 pledgeId) {
        return _pledge(msg.sender, category, valueUSD);
    }

    /// @notice Issuer pledges on behalf of an owner — the production path. Only callable by
    /// registered issuers. The emitted event uses the real owner address, so
    /// CollateralManager credits the right portfolio.
    function pledgeAssetFor(address owner, AssetCategory category, uint256 valueUSD)
        external
        returns (uint256 pledgeId)
    {
        require(issuers[msg.sender], "not a registered issuer");
        require(owner != address(0), "zero owner");
        return _pledge(owner, category, valueUSD);
    }

    function _pledge(address owner, AssetCategory category, uint256 valueUSD) internal returns (uint256 pledgeId) {
        require(valueUSD > 0, "value must be > 0");
        require(valueUSD <= MAX_PLEDGE_VALUE_USD, "value exceeds maximum");

        pledgeId = nextPledgeId++;
        assets[pledgeId] = LocalAsset({owner: owner, category: category, valueUSD: valueUSD, released: false});

        emit AssetPledged(pledgeId, owner, uint8(category), valueUSD);
    }

    /// @notice Update value — callable by the asset owner OR a registered issuer.
    function updateAssetValue(uint256 pledgeId, uint256 newValueUSD) external {
        LocalAsset storage a = assets[pledgeId];
        require(a.owner == msg.sender || issuers[msg.sender], "not owner or issuer");
        require(!a.released, "already released");
        require(newValueUSD > 0, "value must be > 0");
        require(newValueUSD <= MAX_PLEDGE_VALUE_USD, "value exceeds maximum");

        a.valueUSD = newValueUSD;
        emit AssetValueUpdated(pledgeId, newValueUSD);
    }

    /// @notice Release — only the asset owner can release their own collateral.
    function releaseAsset(uint256 pledgeId) external {
        LocalAsset storage a = assets[pledgeId];
        require(a.owner == msg.sender, "not owner");
        require(!a.released, "already released");

        a.released = true;
        emit AssetReleased(pledgeId);
    }
}
