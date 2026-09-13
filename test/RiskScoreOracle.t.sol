// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RiskScoreOracle} from "../contracts/sol/RiskScoreOracle.sol";

contract RiskScoreOracleTest is Test {
    RiskScoreOracle oracle;
    address scorer = makeAddr("scorer");
    address borrower = makeAddr("borrower");
    address stranger = makeAddr("stranger");

    function setUp() public {
        oracle = new RiskScoreOracle(scorer);
    }

    // --- Constructor ---

    function test_constructorSetsScorer() public view {
        assertEq(oracle.scorer(), scorer);
    }

    function test_constructorRevertsZeroAddress() public {
        vm.expectRevert("zero address");
        new RiskScoreOracle(address(0));
    }

    // --- Default score ---

    function test_defaultScoreForUnknownBorrower() public view {
        assertEq(oracle.scoreOf(borrower), 500);
    }

    // --- setScore ---

    function test_setScorerCanSetScore() public {
        vm.prank(scorer);
        oracle.setScore(borrower, 750);
        assertEq(oracle.scoreOf(borrower), 750);
    }

    function test_setScoreEmitsEvent() public {
        vm.prank(scorer);
        vm.expectEmit(true, false, false, true);
        emit RiskScoreOracle.ScoreUpdated(borrower, 500, 750);
        oracle.setScore(borrower, 750);
    }

    function test_setScoreUpdateEmitsCorrectOldScore() public {
        vm.startPrank(scorer);
        oracle.setScore(borrower, 300);
        vm.expectEmit(true, false, false, true);
        emit RiskScoreOracle.ScoreUpdated(borrower, 300, 800);
        oracle.setScore(borrower, 800);
        vm.stopPrank();
    }

    function test_setScoreRevertsForNonScorer() public {
        vm.prank(stranger);
        vm.expectRevert("not authorized scorer");
        oracle.setScore(borrower, 500);
    }

    function test_setScoreRevertsAboveMax() public {
        vm.prank(scorer);
        vm.expectRevert("score out of range");
        oracle.setScore(borrower, 1001);
    }

    function test_setScoreAllowsZero() public {
        vm.prank(scorer);
        oracle.setScore(borrower, 0);
        assertEq(oracle.scoreOf(borrower), 0);
    }

    function test_setScoreAllowsMax() public {
        vm.prank(scorer);
        oracle.setScore(borrower, 1000);
        assertEq(oracle.scoreOf(borrower), 1000);
    }

    // --- setScorer ---

    function test_ownerCanChangeScorer() public {
        address newScorer = makeAddr("newScorer");
        oracle.setScorer(newScorer);
        assertEq(oracle.scorer(), newScorer);

        // Old scorer can no longer write
        vm.prank(scorer);
        vm.expectRevert("not authorized scorer");
        oracle.setScore(borrower, 100);

        // New scorer can
        vm.prank(newScorer);
        oracle.setScore(borrower, 100);
        assertEq(oracle.scoreOf(borrower), 100);
    }

    function test_setScorerRevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        oracle.setScorer(stranger);
    }

    function test_setScorerRevertsZeroAddress() public {
        vm.expectRevert("zero address");
        oracle.setScorer(address(0));
    }
}
