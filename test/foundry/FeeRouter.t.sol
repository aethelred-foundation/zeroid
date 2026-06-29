// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {FeeRouter} from "../../contracts/FeeRouter.sol";

contract FeeRouterTest is Test {
    FeeRouter internal fr;

    address internal admin = address(0xA11CE);
    address internal burnSink = address(0xB0B); // protocol burn address
    address internal cruzibleSink = address(0xC0FFEE); // Cruzible staking sink
    address internal payer;

    bytes32 internal constant OP = keccak256("op:1");

    function setUp() public {
        payer = makeAddr("payer");
        fr = new FeeRouter(admin, burnSink, cruzibleSink, 5000); // 50% burn
        vm.deal(payer, 10 ether);
    }

    function test_routes50_50() public {
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "eligibility_check");
        assertEq(burnSink.balance, 0.5 ether);
        assertEq(cruzibleSink.balance, 0.5 ether);
        assertEq(fr.totalBurned(), 0.5 ether);
        assertEq(fr.totalToCruzible(), 0.5 ether);
    }

    function test_emitsFeeRouted() public {
        vm.expectEmit(true, false, false, true, address(fr));
        emit FeeRouter.FeeRouted(OP, "eligibility_check", 1 ether, 0.5 ether, 0.5 ether);
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "eligibility_check");
    }

    function test_remainderGoesToCruzible() public {
        // 3 wei @ 50%: burn = 1, cruzible = 2 (remainder avoids dust loss)
        vm.prank(payer);
        fr.routeFee{value: 3}(OP, "x");
        assertEq(burnSink.balance, 1);
        assertEq(cruzibleSink.balance, 2);
    }

    function test_configurableSplit() public {
        vm.prank(admin);
        fr.setBurnBps(3000); // 30% burn
        assertEq(fr.burnBps(), 3000);
        vm.prank(payer);
        fr.routeFee{value: 1 ether}(OP, "x");
        assertEq(burnSink.balance, 0.3 ether);
        assertEq(cruzibleSink.balance, 0.7 ether);
    }

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
}
