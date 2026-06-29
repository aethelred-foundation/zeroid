// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FeeRouter
 * @author ZeroID Cryptography Team
 * @notice The economic flywheel for ZeroID identity/compliance operations.
 *         Each metered operation (eligibility check, conditional disclosure,
 *         agent compliance scan) pays a fee in native AETHEL; the router splits
 *         it: a configurable share is sent to the protocol burn sink
 *         (deflation) and the remainder to the Cruzible staking sink (real
 *         yield). This ties ZeroID, Cruzible, and the Wallet into one economic
 *         system: identity/compliance traffic feeds token burn AND staking
 *         liquidity.
 *
 * @dev Security posture:
 *      - Checks-Effects-Interactions: all accounting is updated before any
 *        external value transfer.
 *      - `nonReentrant`: routing performs external calls to admin-configured
 *        sinks; the guard blocks reentrancy through a malicious sink.
 *      - `Pausable`: routing can be halted in an incident without touching
 *        configuration.
 *      - Failed transfers revert (no silent fund loss); a sink that rejects
 *        value is an operational (admin) concern, mitigated by `setSinks` +
 *        pause.
 *      - Burn is delegated to the configured `burnSink` (the protocol's burn
 *        address); actual supply reduction is the protocol's responsibility.
 */
contract FeeRouter is AccessControl, Pausable, ReentrancyGuard {
    /// @notice Role permitted to pause/unpause routing in an incident.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Basis points of each fee routed to the burn sink (e.g. 5000 = 50%).
    uint256 public burnBps;
    /// @notice Protocol burn address.
    address public burnSink;
    /// @notice Cruzible staking liquidity sink.
    address public cruzibleSink;

    uint256 public totalBurned;
    uint256 public totalToCruzible;
    uint256 public totalRouted;

    event FeeRouted(
        bytes32 indexed operationId,
        string operationType,
        uint256 total,
        uint256 burned,
        uint256 toCruzible
    );
    event ConfigUpdated(uint256 burnBps, address burnSink, address cruzibleSink);

    error InvalidBps();
    error ZeroFee();
    error ZeroAddress();
    error TransferFailed();

    constructor(
        address admin,
        address burnSink_,
        address cruzibleSink_,
        uint256 burnBps_
    ) {
        if (admin == address(0)) revert ZeroAddress();
        if (burnBps_ > BPS_DENOMINATOR) revert InvalidBps();
        if (burnSink_ == address(0) || cruzibleSink_ == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        burnSink = burnSink_;
        cruzibleSink = cruzibleSink_;
        burnBps = burnBps_;
        emit ConfigUpdated(burnBps_, burnSink_, cruzibleSink_);
    }

    /// @notice Pay and route a per-operation fee. `value` = the fee in AETHEL.
    function routeFee(bytes32 operationId, string calldata operationType)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        uint256 total = msg.value;
        if (total == 0) revert ZeroFee();

        uint256 burned = (total * burnBps) / BPS_DENOMINATOR;
        uint256 toCruzible = total - burned; // remainder avoids dust loss

        // Effects before interactions.
        totalBurned += burned;
        totalToCruzible += toCruzible;
        totalRouted += total;

        // Cache sinks so reads are consistent within the call.
        address burnTo = burnSink;
        address cruzibleTo = cruzibleSink;

        if (burned > 0) {
            (bool okBurn, ) = burnTo.call{value: burned}("");
            if (!okBurn) revert TransferFailed();
        }
        if (toCruzible > 0) {
            (bool okCruzible, ) = cruzibleTo.call{value: toCruzible}("");
            if (!okCruzible) revert TransferFailed();
        }

        emit FeeRouted(operationId, operationType, total, burned, toCruzible);
    }

    /// @notice Update the burn/Cruzible split.
    function setBurnBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        burnBps = bps;
        emit ConfigUpdated(bps, burnSink, cruzibleSink);
    }

    /// @notice Update the burn and Cruzible sink addresses.
    function setSinks(address burnSink_, address cruzibleSink_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (burnSink_ == address(0) || cruzibleSink_ == address(0)) {
            revert ZeroAddress();
        }
        burnSink = burnSink_;
        cruzibleSink = cruzibleSink_;
        emit ConfigUpdated(burnBps, burnSink_, cruzibleSink_);
    }

    /// @notice Halt fee routing (incident response). Does not change config.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume fee routing.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
