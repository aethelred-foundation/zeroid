// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

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
 * @dev Native-value routing. Burn is delegated to the configured `burnSink`
 *      (the protocol's burn address); actual supply reduction is the protocol's
 *      responsibility. `FeeRouted` events carry per-operation accounting so the
 *      flywheel is auditable (and embeddable in Digital Seals).
 */
contract FeeRouter is AccessControl {
    /// @notice Basis points of each fee routed to the burn sink (e.g. 5000 = 50%).
    uint256 public burnBps;
    /// @notice Protocol burn address.
    address public burnSink;
    /// @notice Cruzible staking liquidity sink.
    address public cruzibleSink;

    uint256 public totalBurned;
    uint256 public totalToCruzible;

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
        if (burnBps_ > 10000) revert InvalidBps();
        if (burnSink_ == address(0) || cruzibleSink_ == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        burnSink = burnSink_;
        cruzibleSink = cruzibleSink_;
        burnBps = burnBps_;
        emit ConfigUpdated(burnBps_, burnSink_, cruzibleSink_);
    }

    /// @notice Pay and route a per-operation fee. `value` = the fee in AETHEL.
    function routeFee(bytes32 operationId, string calldata operationType)
        external
        payable
    {
        if (msg.value == 0) revert ZeroFee();
        uint256 burned = (msg.value * burnBps) / 10000;
        uint256 toCruzible = msg.value - burned; // remainder avoids dust loss

        totalBurned += burned;
        totalToCruzible += toCruzible;

        if (burned > 0) {
            (bool okBurn, ) = burnSink.call{value: burned}("");
            if (!okBurn) revert TransferFailed();
        }
        if (toCruzible > 0) {
            (bool okCruzible, ) = cruzibleSink.call{value: toCruzible}("");
            if (!okCruzible) revert TransferFailed();
        }

        emit FeeRouted(operationId, operationType, msg.value, burned, toCruzible);
    }

    /// @notice Update the burn/Cruzible split.
    function setBurnBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > 10000) revert InvalidBps();
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
}
