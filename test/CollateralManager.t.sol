// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {RiskScoreOracle} from "../contracts/sol/RiskScoreOracle.sol";
import {CollateralManager} from "../contracts/sol/CollateralManager.sol";
import {Portfolio} from "../contracts/sol/AssetTypes.sol";

/// @notice Tests for CollateralManager's pure/view functions. The precompile
/// (INativeQueryVerifier at 0x...FD2) doesn't exist in a standard Forge test
/// environment, so execute/executeBatch paths are tested via live testnet
/// integration (scripts/demo_batch_proof.ts). These tests cover the collateral
/// ratio math, which is the part that governs borrowing limits.
contract CollateralManagerMathTest is Test {
    CollateralManager manager;
    RiskScoreOracle oracle;
    address scorer = makeAddr("scorer");

    function setUp() public {
        oracle = new RiskScoreOracle(scorer);
        // CollateralManager's constructor only stores riskOracle — it doesn't
        // call the precompile, so this works in a standard Forge environment.
        // The VERIFIER immutable from USCBase will be set to address(0) since
        // the precompile doesn't exist here, but we never call execute/executeBatch
        // in these tests.
        manager = new CollateralManager(address(oracle));
    }

    // --- requiredRatioBps ---

    function test_requiredRatioBpsAtScoreZero() public view {
        // Score 0 → worst ratio → 150% (15000 bps)
        assertEq(manager.requiredRatioBps(0), 15000);
    }

    function test_requiredRatioBpsAtScoreMax() public view {
        // Score 1000 → best ratio → 110% (11000 bps)
        assertEq(manager.requiredRatioBps(1000), 11000);
    }

    function test_requiredRatioBpsAtScore500() public view {
        // Score 500 → midpoint → 150% - (40% * 500/1000) = 150% - 20% = 130% (13000 bps)
        assertEq(manager.requiredRatioBps(500), 13000);
    }

    function test_requiredRatioBpsLinearInterpolation() public view {
        // Score 250 → 150% - (40% * 250/1000) = 150% - 10% = 140% (14000 bps)
        assertEq(manager.requiredRatioBps(250), 14000);
        // Score 750 → 150% - (40% * 750/1000) = 150% - 30% = 120% (12000 bps)
        assertEq(manager.requiredRatioBps(750), 12000);
    }

    function test_requiredRatioBpsMonotonicallyDecreasing() public view {
        uint16 prev = manager.requiredRatioBps(0);
        for (uint16 score = 100; score <= 1000; score += 100) {
            uint16 current = manager.requiredRatioBps(score);
            assertTrue(current <= prev, "ratio should decrease as score increases");
            prev = current;
        }
    }

    // --- Constants ---

    function test_constantsAreConsistent() public view {
        // BASE > BEST > LIQUIDATION makes economic sense
        assertTrue(manager.BASE_COLLATERAL_RATIO_BPS() > manager.BEST_COLLATERAL_RATIO_BPS());
        assertTrue(manager.BEST_COLLATERAL_RATIO_BPS() > manager.LIQUIDATION_RATIO_BPS());
    }

    // --- registerSourceVault ---

    function test_registerSourceVault() public {
        address vault = makeAddr("vault");
        manager.registerSourceVault(1, vault);
        assertEq(manager.sourceVaults(1), vault);
    }

    function test_registerSourceVaultRevertsZeroAddress() public {
        vm.expectRevert("zero address");
        manager.registerSourceVault(1, address(0));
    }

    function test_registerSourceVaultRevertsForNonOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        manager.registerSourceVault(1, makeAddr("vault"));
    }

    // --- portfolioOf (empty) ---

    function test_emptyPortfolio() public {
        Portfolio memory p = manager.portfolioOf(makeAddr("nobody"));
        assertFalse(p.active);
        assertEq(p.totalCollateralValueUSD, 0);
        assertEq(p.borrowedAmountUSD, 0);
    }

    // --- borrow / repay without collateral ---

    function test_borrowRevertsWithoutCollateral() public {
        vm.prank(makeAddr("borrower"));
        vm.expectRevert("no collateral pledged");
        manager.borrow(1000);
    }

    // --- Pausable ---

    function test_pauseAndUnpause() public {
        manager.pause();
        assertTrue(manager.paused());
        manager.unpause();
        assertFalse(manager.paused());
    }

    function test_borrowRevertsWhenPaused() public {
        manager.pause();
        vm.prank(makeAddr("borrower"));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.borrow(1000);
    }

    function test_repayRevertsWhenPaused() public {
        manager.pause();
        vm.prank(makeAddr("borrower"));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.repay(1000);
    }

    function test_pauseRevertsForNonOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        manager.pause();
    }
}
