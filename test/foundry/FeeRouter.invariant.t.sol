// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {FeeRouter} from "../../contracts/FeeRouter.sol";

/// @notice Handler performing random valid routeFee calls, tracking ghost state.
contract FeeRouterHandler is Test {
    FeeRouter public fr;
    address public burnSink;
    address public cruzibleSink;
    uint256 public ghost_routed;

    constructor(FeeRouter _fr, address _burn, address _cruzible) {
        fr = _fr;
        burnSink = _burn;
        cruzibleSink = _cruzible;
    }

    function routeFee(uint96 amount) external {
        uint256 amt = bound(amount, 1, 1e24);
        vm.deal(address(this), amt);
        fr.routeFee{value: amt}(keccak256(abi.encode(amt, ghost_routed)), "inv");
        ghost_routed += amt;
    }
}

/// @title FeeRouter Invariant Tests
contract FeeRouterInvariantTest is Test {
    FeeRouter internal fr;
    FeeRouterHandler internal handler;
    address internal admin = address(0xA11CE);
    address internal burnSink;
    address internal cruzibleSink;

    function setUp() public {
        burnSink = makeAddr("burn");
        cruzibleSink = makeAddr("cruzible");
        fr = new FeeRouter(admin, burnSink, cruzibleSink, 5000);
        handler = new FeeRouterHandler(fr, burnSink, cruzibleSink);
        targetContract(address(handler));
    }

    /// @notice Accounting is always conserved: routed == burned + cruzible ==
    ///         sink balances == the ghost total. No value is created or lost.
    function invariant_accountingConserved() public view {
        assertEq(fr.totalRouted(), fr.totalBurned() + fr.totalToCruzible());
        assertEq(fr.totalRouted(), handler.ghost_routed());
        assertEq(burnSink.balance + cruzibleSink.balance, fr.totalRouted());
    }
}
