// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AssetCategory} from "./AssetTypes.sol";

/// @notice Deployed on each source chain (e.g. Ethereum Sepolia). Plays the same role as
/// `AuxiliaryLoanContract` in the Attestcoin reference loan-flow example: it's the contract whose
/// events get proven cross-chain and acted on by `CollateralManager` on Creditcoin. Its address
/// per chain key must be registered on `CollateralManager` (`registerSourceVault`) so forged events
/// from unregistered contracts can never be used to fake a pledge.
///
/// In a production version, `valueUSD` would be supplied by whatever already attests to the
/// underlying RWA off-chain (an invoice factoring platform, a tokenized real-estate registrar, a
/// carbon registry) rather than the caller directly. For this hackathon build it's asserted
/// on-chain by the pledger so the cross-chain proof flow can be demonstrated end-to-end; swapping
/// in a real issuer/oracle-of-record for `valueUSD` is a source-chain-side change only and does not
/// touch CollateralManager or the Attestcoin integration.
contract AuxiliaryAssetVault {
    // keccak256("AssetPledged(uint256,address,uint8,uint256)")
    event AssetPledged(uint256 indexed pledgeId, address indexed owner, uint8 category, uint256 valueUSD);
    // keccak256("AssetValueUpdated(uint256,uint256)")
    event AssetValueUpdated(uint256 indexed pledgeId, uint256 newValueUSD);
    // keccak256("AssetReleased(uint256)")
    event AssetReleased(uint256 indexed pledgeId);

    struct LocalAsset {
        address owner;
        AssetCategory category;
        uint256 valueUSD;
        bool released;
    }

    mapping(uint256 => LocalAsset) public assets;
    uint256 public nextPledgeId = 1;

    function pledgeAsset(AssetCategory category, uint256 valueUSD) external returns (uint256 pledgeId) {
        require(valueUSD > 0, "value must be > 0");

        pledgeId = nextPledgeId++;
        assets[pledgeId] = LocalAsset({owner: msg.sender, category: category, valueUSD: valueUSD, released: false});

        emit AssetPledged(pledgeId, msg.sender, uint8(category), valueUSD);
    }

    function updateAssetValue(uint256 pledgeId, uint256 newValueUSD) external {
        LocalAsset storage a = assets[pledgeId];
        require(a.owner == msg.sender, "not owner");
        require(!a.released, "already released");
        require(newValueUSD > 0, "value must be > 0");

        a.valueUSD = newValueUSD;
        emit AssetValueUpdated(pledgeId, newValueUSD);
    }

    function releaseAsset(uint256 pledgeId) external {
        LocalAsset storage a = assets[pledgeId];
        require(a.owner == msg.sender, "not owner");
        require(!a.released, "already released");

        a.released = true;
        emit AssetReleased(pledgeId);
    }
}
