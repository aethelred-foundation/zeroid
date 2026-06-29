// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {FeeRouter} from "../../contracts/FeeRouter.sol";

/// @dev Sink that reverts on receipt — exercises the TransferFailed path.
contract RevertingSink {
    receive() external payable {
        revert("rejects value");
    }
}

/// @dev Malicious sink that attempts to re-enter routeFee on receipt.
contract ReentrantSink {
    FeeRouter public immutable fr;

    constructor(FeeRouter _fr) {
        fr = _fr;
    }

    receive() external payable {
        fr.routeFee{value: 1}(keccak256("reenter"), "reenter");
    }
}

contract FeeRouterTest is Test {
    FeeRouter internal fr;

    address internal admin = address(0xA11CE);
    address internal burnSink = address(0xB0B);
    address internal cruzibleSink = address(0xC0FFEE);
    address internal payer;

    bytes32 internal constant OP = keccak256("op:1");

    function setUp() public {
        payer = makeAddr("payer");
        fr = new FeeRouter(admin, burnSink, cruzibleSink, 5000); // 50% burn
        vm.deal(payer, 100 ether);
    }

    // ── Core routing ────────────────────────────────────────────────────────

    function test_routes50_50() public {
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "eligibility_check");
        assertEq(burnSink.balance, 0.5 ether);
        assertEq(cruzibleSink.balance, 0.5 ether);
        assertEq(fr.totalBurned(), 0.5 ether);
        assertEq(fr.totalToCruzible(), 0.5 ether);
        assertEq(fr.totalRouted(), 1 ether);
    }

    function test_emitsFeeRouted() public {
        vm.expectEmit(true, false, false, true, address(fr));
        emit FeeRouter.FeeRouted(OP, "eligibility_check", 1 ether, 0.5 ether, 0.5 ether);
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "eligibility_check");
    }

    function test_remainderGoesToCruzible() public {
        vm.prank(payer);
        fr.routeFee{value: 3}(OP, "x");
        assertEq(burnSink.balance, 1);
        assertEq(cruzibleSink.balance, 2);
    }

    function test_configurableSplit() public {
        vm.prank(admin);
        fr.setBurnBps(3000);
        assertEq(fr.burnBps(), 3000);
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "x");
        assertEq(burnSink.balance, 0.3 ether);
        assertEq(cruzibleSink.balance, 0.7 ether);
    }

    // ── Access control / validation ──────────────────────────────────────────

    function test_onlyAdminSetsSplit() public {
        vm.prank(payer);
        vm.expectRevert();
        fr.setBurnBps(3000);
    }

    function test_rejectsBpsOver10000() public {
        vm.prank(admin);
        vm.expectRevert(FeeRouter.InvalidBps.selector);
        fr.setBurnBps(10001);
    }

    function test_rejectsZeroFee() public {
        vm.prank(payer);
        vm.expectRevert(FeeRouter.ZeroFee.selector);
        fr.routeFee{value: 0}(OP, "x");
    }

    // ── Security: pause ───────────────────────────────────────────────────────

    function test_pausedBlocksRouting() public {
        vm.prank(admin);
        fr.pause();
        vm.prank(payer);
        vm.expectRevert(); // OZ Pausable: EnforcedPause
        fr.routeFee{value: 1 ether}(OP, "x");
    }

    function test_unpauseResumesRouting() public {
        vm.startPrank(admin);
        fr.pause();
        fr.unpause();
        vm.stopPrank();
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "x");
        assertEq(fr.totalRouted(), 1 ether);
    }

    function test_onlyPauserCanPause() public {
        vm.prank(payer);
        vm.expectRevert();
        fr.pause();
    }

    // ── Security: reentrancy & failed transfers ───────────────────────────────

    function test_reentrantSinkIsBlocked() public {
        ReentrantSink evil = new ReentrantSink(fr);
        vm.prank(admin);
        fr.setSinks(address(evil), cruzibleSink);
        vm.deal(address(evil), 1 ether); // fund its reentrancy attempt
        vm.prank(payer);
        vm.expectRevert(FeeRouter.TransferFailed.selector);
        fr.routeFee{value: 1 ether}(OP, "x");
    }

    function test_revertingSinkRevertsAndRollsBack() public {
        RevertingSink bad = new RevertingSink();
        vm.prank(admin);
        fr.setSinks(burnSink, address(bad));
        vm.prank(payer);
        vm.expectRevert(FeeRouter.TransferFailed.selector);
        fr.routeFee{value: 1 ether}(OP, "x");
        // whole tx reverted → no partial accounting
        assertEq(fr.totalRouted(), 0);
        assertEq(burnSink.balance, 0);
    }

    function test_rejectsZeroAddressSinks() public {
        vm.prank(admin);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        fr.setSinks(address(0), cruzibleSink);
    }
}
