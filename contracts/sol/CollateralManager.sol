// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

import {USCBase} from "./USCBase.sol";
import {AssetCategory, PledgeStatus, AssetPledge, Portfolio} from "./AssetTypes.sol";
import {IRiskScoreOracle} from "./RiskScoreOracle.sol";

/// @title CollateralManager
/// @notice The core AttestVault protocol contract, deployed on Creditcoin. Pools real-world-asset
/// collateral pledged across multiple source chains into one portfolio per borrower, verified
/// entirely through the Attestcoin Protocol (single-tx `execute` and batch `executeBatch`, both
/// inherited from USCBase) — no price oracle call happens anywhere in this contract.
contract CollateralManager is Ownable, ReentrancyGuard, USCBase {
    enum CollateralActions {
        AssetPledged, // 0
        AssetValueUpdated, // 1
        AssetReleased // 2
    }

    error InvalidAction(uint8 action);

    bytes32 public constant PLEDGED_EVENT_SIGNATURE = keccak256("AssetPledged(uint256,address,uint8,uint256)");
    bytes32 public constant VALUE_UPDATED_EVENT_SIGNATURE = keccak256("AssetValueUpdated(uint256,uint256)");
    bytes32 public constant RELEASED_EVENT_SIGNATURE = keccak256("AssetReleased(uint256)");

    /// @dev Basis points, i.e. 15000 = 150%.
    uint16 public constant BASE_COLLATERAL_RATIO_BPS = 15000; // required ratio at score 0
    uint16 public constant BEST_COLLATERAL_RATIO_BPS = 11000; // required ratio at score 1000
    uint16 public constant LIQUIDATION_RATIO_BPS = 10500; // below this, portfolio is liquidatable

    /// @dev chainKey => the one AuxiliaryAssetVault address trusted on that source chain. Events
    /// from any other address, even with a valid inclusion proof, are rejected — this is what
    /// stops someone deploying a lookalike contract and proving fake pledges.
    mapping(uint64 => address) public sourceVaults;

    mapping(bytes32 => AssetPledge) public pledges;
    mapping(address => Portfolio) private _portfolios;

    IRiskScoreOracle public riskOracle;

    event VaultRegistered(uint64 indexed chainKey, address indexed vault);
    event PledgeRecorded(bytes32 indexed globalId, address indexed owner, uint64 chainKey, uint256 valueUSD);
    event PledgeValueChanged(bytes32 indexed globalId, uint256 newValueUSD);
    event PledgeReleased(bytes32 indexed globalId);
    event PortfolioValueChanged(address indexed borrower, uint256 totalCollateralValueUSD);
    event Borrowed(address indexed borrower, uint256 amountUSD, uint256 collateralRatioBps);
    event Repaid(address indexed borrower, uint256 amountUSD);
    event Liquidated(address indexed borrower, bytes32 indexed globalId, uint256 valueUSD);

    constructor(address _riskOracle) Ownable(msg.sender) {
        require(_riskOracle != address(0), "zero address");
        riskOracle = IRiskScoreOracle(_riskOracle);
    }

    function registerSourceVault(uint64 chainKey, address vault) external onlyOwner {
        require(vault != address(0), "zero address");
        sourceVaults[chainKey] = vault;
        emit VaultRegistered(chainKey, vault);
    }

    // ---------------------------------------------------------------------
    // USCBase hook — called once per verified event, from either execute()
    // or executeBatch(). Business logic is identical either way; only how
    // the proof got verified differs.
    // ---------------------------------------------------------------------

    function _processAndEmitEvent(uint8 action, uint64 chainKey, bytes32, /* queryId, unused */ bytes memory encodedTransaction)
        internal
        override
    {
        if (action == uint8(CollateralActions.AssetPledged)) {
            _handlePledged(chainKey, encodedTransaction);
        } else if (action == uint8(CollateralActions.AssetValueUpdated)) {
            _handleValueUpdated(chainKey, encodedTransaction);
        } else if (action == uint8(CollateralActions.AssetReleased)) {
            _handleReleased(chainKey, encodedTransaction);
        } else {
            revert InvalidAction(action);
        }
    }

    function _handlePledged(uint64 chainKey, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry memory log = _extractLog(chainKey, encodedTransaction, PLEDGED_EVENT_SIGNATURE);

        require(log.topics.length == 3, "invalid AssetPledged topics");
        uint256 localPledgeId = uint256(log.topics[1]);
        address owner = address(uint160(uint256(log.topics[2])));
        (uint8 categoryRaw, uint256 valueUSD) = abi.decode(log.data, (uint8, uint256));

        bytes32 globalId = keccak256(abi.encodePacked(chainKey, localPledgeId));
        require(pledges[globalId].pledgedAtBlock == 0, "pledge already recorded");

        pledges[globalId] = AssetPledge({
            globalId: globalId,
            owner: owner,
            category: AssetCategory(categoryRaw),
            sourceChainKey: chainKey,
            valueUSD: valueUSD,
            status: PledgeStatus.Active,
            pledgedAtBlock: block.number
        });

        Portfolio storage p = _portfolios[owner];
        if (!p.active) {
            p.borrower = owner;
            p.active = true;
        }
        p.pledgeIds.push(globalId);
        p.totalCollateralValueUSD += valueUSD;

        emit PledgeRecorded(globalId, owner, chainKey, valueUSD);
        emit PortfolioValueChanged(owner, p.totalCollateralValueUSD);
    }

    function _handleValueUpdated(uint64 chainKey, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry memory log = _extractLog(chainKey, encodedTransaction, VALUE_UPDATED_EVENT_SIGNATURE);

        require(log.topics.length == 2, "invalid AssetValueUpdated topics");
        uint256 localPledgeId = uint256(log.topics[1]);
        uint256 newValueUSD = abi.decode(log.data, (uint256));

        bytes32 globalId = keccak256(abi.encodePacked(chainKey, localPledgeId));
        AssetPledge storage pledge = pledges[globalId];
        require(pledge.pledgedAtBlock != 0, "unknown pledge");
        require(pledge.status == PledgeStatus.Active, "pledge not active");

        Portfolio storage p = _portfolios[pledge.owner];
        p.totalCollateralValueUSD = p.totalCollateralValueUSD - pledge.valueUSD + newValueUSD;
        pledge.valueUSD = newValueUSD;

        emit PledgeValueChanged(globalId, newValueUSD);
        emit PortfolioValueChanged(pledge.owner, p.totalCollateralValueUSD);

        _checkLiquidation(pledge.owner);
    }

    function _handleReleased(uint64 chainKey, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry memory log = _extractLog(chainKey, encodedTransaction, RELEASED_EVENT_SIGNATURE);

        require(log.topics.length == 2, "invalid AssetReleased topics");
        uint256 localPledgeId = uint256(log.topics[1]);

        bytes32 globalId = keccak256(abi.encodePacked(chainKey, localPledgeId));
        AssetPledge storage pledge = pledges[globalId];
        require(pledge.pledgedAtBlock != 0, "unknown pledge");
        require(pledge.status == PledgeStatus.Active, "pledge not active");

        Portfolio storage p = _portfolios[pledge.owner];
        // Fetch the live score rather than trusting `p.riskScore` — that field is only refreshed
        // inside borrow(), so it can be stale (e.g. after a liquidation elsewhere dropped the
        // borrower's score) at the time of a release. A stale, more favorable cached score would
        // let a release pass a check it shouldn't.
        uint16 liveScore = riskOracle.scoreOf(pledge.owner);
        require(
            p.totalCollateralValueUSD - pledge.valueUSD >= _requiredCollateralUSD(p.borrowedAmountUSD, liveScore),
            "would break collateral ratio"
        );

        p.totalCollateralValueUSD -= pledge.valueUSD;
        pledge.status = PledgeStatus.Released;

        emit PledgeReleased(globalId);
        emit PortfolioValueChanged(pledge.owner, p.totalCollateralValueUSD);
    }

    function _extractLog(uint64 chainKey, bytes memory encodedTransaction, bytes32 eventSignature)
        internal
        view
        returns (EvmV1Decoder.LogEntry memory)
    {
        address vault = sourceVaults[chainKey];
        require(vault != address(0), "source vault not registered for chain");

        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "unsupported transaction type");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "transaction did not succeed");

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, eventSignature);
        require(logs.length > 0, "no matching event found");

        EvmV1Decoder.LogEntry memory log = logs[0];
        require(log.address_ == vault, "event not emitted by registered source vault");
        require(log.topics[0] == eventSignature, "unexpected event signature");

        return log;
    }

    // ---------------------------------------------------------------------
    // Risk-score-driven borrowing
    // ---------------------------------------------------------------------

    /// @dev Linear interpolation between BASE_COLLATERAL_RATIO_BPS (score 0) and
    /// BEST_COLLATERAL_RATIO_BPS (score 1000) — a borrower with a perfect verified track record
    /// needs less over-collateralization than a brand-new one.
    function requiredRatioBps(uint16 riskScore) public pure returns (uint16) {
        uint256 span = BASE_COLLATERAL_RATIO_BPS - BEST_COLLATERAL_RATIO_BPS;
        uint256 discount = (span * riskScore) / 1000;
        // safe: span <= 4000 and riskScore <= 1000, so discount <= 4000 and the result stays
        // within BASE_COLLATERAL_RATIO_BPS (15000), well inside uint16 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(BASE_COLLATERAL_RATIO_BPS - discount);
    }

    function _requiredCollateralUSD(uint256 borrowedAmountUSD, uint16 riskScore) internal pure returns (uint256) {
        return (borrowedAmountUSD * requiredRatioBps(riskScore)) / 10000;
    }

    function borrow(uint256 amountUSD) external nonReentrant {
        Portfolio storage p = _portfolios[msg.sender];
        require(p.active, "no collateral pledged");

        uint16 riskScore = riskOracle.scoreOf(msg.sender);
        uint256 newBorrowed = p.borrowedAmountUSD + amountUSD;
        uint256 requiredUSD = _requiredCollateralUSD(newBorrowed, riskScore);
        require(p.totalCollateralValueUSD >= requiredUSD, "insufficient verified collateral for this risk score");

        p.borrowedAmountUSD = newBorrowed;
        p.riskScore = riskScore;

        emit Borrowed(msg.sender, amountUSD, requiredRatioBps(riskScore));
    }

    function repay(uint256 amountUSD) external nonReentrant {
        Portfolio storage p = _portfolios[msg.sender];
        require(p.borrowedAmountUSD >= amountUSD, "repay exceeds borrowed amount");

        p.borrowedAmountUSD -= amountUSD;
        emit Repaid(msg.sender, amountUSD);
    }

    function _checkLiquidation(address borrower) internal {
        Portfolio storage p = _portfolios[borrower];
        if (p.borrowedAmountUSD == 0) return;

        uint256 currentRatioBps = (p.totalCollateralValueUSD * 10000) / p.borrowedAmountUSD;
        if (currentRatioBps < LIQUIDATION_RATIO_BPS && p.pledgeIds.length > 0) {
            bytes32 target = p.pledgeIds[p.pledgeIds.length - 1];
            AssetPledge storage pledge = pledges[target];
            if (pledge.status == PledgeStatus.Active) {
                p.totalCollateralValueUSD -= pledge.valueUSD;
                pledge.status = PledgeStatus.Liquidated;
                emit Liquidated(borrower, target, pledge.valueUSD);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function portfolioOf(address borrower) external view returns (Portfolio memory) {
        return _portfolios[borrower];
    }
}
