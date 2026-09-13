// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AuxiliaryAssetVault} from "../contracts/sol/AuxiliaryAssetVault.sol";
import {AssetCategory} from "../contracts/sol/AssetTypes.sol";

contract AuxiliaryAssetVaultTest is Test {
    AuxiliaryAssetVault vault;
    address deployer;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address issuer = makeAddr("issuer");

    function setUp() public {
        deployer = address(this);
        vault = new AuxiliaryAssetVault();
    }

    // --- pledgeAsset (self-pledge) ---

    function test_pledgeAssetReturnsIncrementingIds() public {
        vm.startPrank(alice);
        uint256 id1 = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        uint256 id2 = vault.pledgeAsset(AssetCategory.RealEstate, 50000);
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
    }

    function test_pledgeAssetStoresCorrectData() public {
        vm.prank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.CarbonCredit, 7500);

        (address owner, AssetCategory category, uint256 valueUSD, bool released) = vault.assets(id);
        assertEq(owner, alice);
        assertEq(uint8(category), uint8(AssetCategory.CarbonCredit));
        assertEq(valueUSD, 7500);
        assertFalse(released);
    }

    function test_pledgeAssetEmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit AuxiliaryAssetVault.AssetPledged(1, alice, uint8(AssetCategory.Invoice), 25000);
        vault.pledgeAsset(AssetCategory.Invoice, 25000);
    }

    function test_pledgeAssetRevertsZeroValue() public {
        vm.prank(alice);
        vm.expectRevert("value must be > 0");
        vault.pledgeAsset(AssetCategory.Invoice, 0);
    }

    function test_pledgeAssetRevertsExceedsMaxValue() public {
        uint256 maxVal = vault.MAX_PLEDGE_VALUE_USD();
        vm.prank(alice);
        vm.expectRevert("value exceeds maximum");
        vault.pledgeAsset(AssetCategory.Invoice, maxVal + 1);
    }

    function test_pledgeAssetAtMaxValue() public {
        uint256 maxVal = vault.MAX_PLEDGE_VALUE_USD();
        vm.prank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, maxVal);
        (, , uint256 valueUSD, ) = vault.assets(id);
        assertEq(valueUSD, maxVal);
    }

    function test_updateAssetValueRevertsExceedsMax() public {
        uint256 maxVal = vault.MAX_PLEDGE_VALUE_USD();
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vm.expectRevert("value exceeds maximum");
        vault.updateAssetValue(id, maxVal + 1);
        vm.stopPrank();
    }

    // --- Issuer management ---

    function test_addIssuerOnlyOwner() public {
        vault.addIssuer(issuer);
        assertTrue(vault.issuers(issuer));
    }

    function test_addIssuerEmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit AuxiliaryAssetVault.IssuerAdded(issuer);
        vault.addIssuer(issuer);
    }

    function test_addIssuerRevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.addIssuer(issuer);
    }

    function test_addIssuerRevertsZeroAddress() public {
        vm.expectRevert("zero address");
        vault.addIssuer(address(0));
    }

    function test_removeIssuer() public {
        vault.addIssuer(issuer);
        vault.removeIssuer(issuer);
        assertFalse(vault.issuers(issuer));
    }

    function test_removeIssuerEmitsEvent() public {
        vault.addIssuer(issuer);
        vm.expectEmit(true, false, false, false);
        emit AuxiliaryAssetVault.IssuerRemoved(issuer);
        vault.removeIssuer(issuer);
    }

    // --- pledgeAssetFor (issuer-attested pledge) ---

    function test_pledgeAssetForByIssuer() public {
        vault.addIssuer(issuer);

        vm.prank(issuer);
        uint256 id = vault.pledgeAssetFor(alice, AssetCategory.RealEstate, 100000);

        (address owner, AssetCategory category, uint256 valueUSD, bool released) = vault.assets(id);
        assertEq(owner, alice);
        assertEq(uint8(category), uint8(AssetCategory.RealEstate));
        assertEq(valueUSD, 100000);
        assertFalse(released);
    }

    function test_pledgeAssetForEmitsEventWithRealOwner() public {
        vault.addIssuer(issuer);

        vm.prank(issuer);
        vm.expectEmit(true, true, false, true);
        emit AuxiliaryAssetVault.AssetPledged(1, alice, uint8(AssetCategory.Invoice), 50000);
        vault.pledgeAssetFor(alice, AssetCategory.Invoice, 50000);
    }

    function test_pledgeAssetForRevertsForNonIssuer() public {
        vm.prank(bob);
        vm.expectRevert("not a registered issuer");
        vault.pledgeAssetFor(alice, AssetCategory.Invoice, 10000);
    }

    function test_pledgeAssetForRevertsZeroOwner() public {
        vault.addIssuer(issuer);

        vm.prank(issuer);
        vm.expectRevert("zero owner");
        vault.pledgeAssetFor(address(0), AssetCategory.Invoice, 10000);
    }

    // --- updateAssetValue ---

    function test_updateAssetValue() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vault.updateAssetValue(id, 15000);
        vm.stopPrank();

        (, , uint256 valueUSD, ) = vault.assets(id);
        assertEq(valueUSD, 15000);
    }

    function test_updateAssetValueEmitsEvent() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vm.expectEmit(true, false, false, true);
        emit AuxiliaryAssetVault.AssetValueUpdated(id, 20000);
        vault.updateAssetValue(id, 20000);
        vm.stopPrank();
    }

    function test_updateAssetValueByIssuer() public {
        vm.prank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);

        vault.addIssuer(issuer);
        vm.prank(issuer);
        vault.updateAssetValue(id, 18000);

        (, , uint256 valueUSD, ) = vault.assets(id);
        assertEq(valueUSD, 18000);
    }

    function test_updateAssetValueRevertsForNonOwnerNonIssuer() public {
        vm.prank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);

        vm.prank(bob);
        vm.expectRevert("not owner or issuer");
        vault.updateAssetValue(id, 15000);
    }

    function test_updateAssetValueRevertsIfReleased() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vault.releaseAsset(id);
        vm.expectRevert("already released");
        vault.updateAssetValue(id, 15000);
        vm.stopPrank();
    }

    function test_updateAssetValueRevertsZeroValue() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vm.expectRevert("value must be > 0");
        vault.updateAssetValue(id, 0);
        vm.stopPrank();
    }

    // --- releaseAsset ---

    function test_releaseAsset() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.RealEstate, 50000);
        vault.releaseAsset(id);
        vm.stopPrank();

        (, , , bool released) = vault.assets(id);
        assertTrue(released);
    }

    function test_releaseAssetEmitsEvent() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.RealEstate, 50000);
        vm.expectEmit(true, false, false, false);
        emit AuxiliaryAssetVault.AssetReleased(id);
        vault.releaseAsset(id);
        vm.stopPrank();
    }

    function test_releaseAssetRevertsForNonOwner() public {
        vm.prank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);

        vm.prank(bob);
        vm.expectRevert("not owner");
        vault.releaseAsset(id);
    }

    function test_releaseAssetRevertsIfAlreadyReleased() public {
        vm.startPrank(alice);
        uint256 id = vault.pledgeAsset(AssetCategory.Invoice, 10000);
        vault.releaseAsset(id);
        vm.expectRevert("already released");
        vault.releaseAsset(id);
        vm.stopPrank();
    }
}
