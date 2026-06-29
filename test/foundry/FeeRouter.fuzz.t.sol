// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {FeeRouter} from "../../contracts/FeeRouter.sol";

/// @title FeeRouter Fuzz Tests
/// @notice Property-based tests: routing conserves value and splits exactly for
///         any fee amount and any configured burn share.
contract FeeRouterFuzzTest is Test {
    FeeRouter internal fr;
    address internal admin = address(0xA11CE);
    address internal burnSink;
    address internal cruzibleSink;
    address internal payer;

    bytes32 internal constant OP = keccak256("op");

    function setUp() public {
        burnSink = makeAddr("burn");
        cruzibleSink = makeAddr("cruzible");
        payer = makeAddr("payer");
        fr = new FeeRouter(admin, burnSink, cruzibleSink, 5000);
    }

    function testFuzz_splitConservesValue(uint96 amount, uint16 bps) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        bps = uint16(bound(bps, 0, 10_000));

        vm.prank(admin);
        fr.setBurnBps(bps);

        uint256 b0 = burnSink.balance;
        uint256 c0 = cruzibleSink.balance;

        vm.deal(payer, amount);
        vm.prank(payer);
        fr.routeFee{value: amount}(OP, "fuzz");

        uint256 burned = burnSink.balance - b0;
        uint256 toCruzible = cruzibleSink.balance - c0;

        // Value conserved (no dust lost), split exact.
        assertEq(burned + toCruzible, amount, "value conserved");
        assertEq(burned, (uint256(amount) * bps) / 10_000, "burn share exact");
        assertEq(fr.totalRouted(), amount, "totalRouted");
        assertEq(fr.totalBurned(), burned, "totalBurned");
        assertEq(fr.totalToCruzible(), toCruzible, "totalToCruzible");
    }
}
