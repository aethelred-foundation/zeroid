// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ConditionalDisclosure} from "../../contracts/ConditionalDisclosure.sol";

contract ConditionalDisclosureTest is Test {
    ConditionalDisclosure internal cd;

    address internal admin = address(0xA11CE);
    address internal operator = address(0x09E4A704);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal dave = address(0xDA7E);

    bytes32 internal constant ESCROW_ID = keccak256("escrow:1");
    bytes32 internal constant COMMITMENT = keccak256("ciphertext-commitment");
    bytes32 internal constant NULLIFIER = keccak256("subject-nullifier");
    bytes32 internal constant WARRANT = keccak256("warrant:adgm:123");

    function setUp() public {
        cd = new ConditionalDisclosure(admin, 2);
        vm.startPrank(admin);
        cd.grantRole(cd.ESCROW_ISSUER_ROLE(), operator);
        cd.grantRole(cd.COMPLIANCE_OFFICER_ROLE(), alice);
        cd.grantRole(cd.COMPLIANCE_OFFICER_ROLE(), bob);
        cd.grantRole(cd.COMPLIANCE_OFFICER_ROLE(), carol);
        vm.stopPrank();
    }

    function _register() internal {
        vm.prank(operator);
        cd.registerEscrow(ESCROW_ID, COMMITMENT, NULLIFIER);
    }

    function test_registerAndRead() public {
        _register();
        (bytes32 commitment, bytes32 nullifier, , bool erased) = cd.getEscrow(ESCROW_ID);
        assertEq(commitment, COMMITMENT);
        assertEq(nullifier, NULLIFIER);
        assertFalse(erased);
    }

    function test_duplicateRegisterReverts() public {
        _register();
        vm.prank(operator);
        vm.expectRevert(ConditionalDisclosure.EscrowAlreadyExists.selector);
        cd.registerEscrow(ESCROW_ID, COMMITMENT, NULLIFIER);
    }

    function test_quorumAuthorizesDisclosure() public {
        _register();
        vm.prank(alice);
        cd.requestDisclosure(ESCROW_ID, WARRANT);

        vm.prank(alice);
        cd.approveDisclosure(ESCROW_ID);
        assertFalse(cd.isDisclosureAuthorized(ESCROW_ID), "one approval is below threshold");

        vm.prank(bob);
        cd.approveDisclosure(ESCROW_ID);
        assertTrue(cd.isDisclosureAuthorized(ESCROW_ID), "threshold reached");
    }

    function test_cannotApproveTwice() public {
        _register();
        vm.prank(alice);
        cd.requestDisclosure(ESCROW_ID, WARRANT);
        vm.prank(alice);
        cd.approveDisclosure(ESCROW_ID);
        vm.prank(alice);
        vm.expectRevert(ConditionalDisclosure.AlreadyApproved.selector);
        cd.approveDisclosure(ESCROW_ID);
    }

    function test_nonOfficerCannotApprove() public {
        _register();
        vm.prank(alice);
        cd.requestDisclosure(ESCROW_ID, WARRANT);
        vm.prank(dave);
        vm.expectRevert();
        cd.approveDisclosure(ESCROW_ID);
    }

    function test_erasureBlocksDisclosure() public {
        _register();
        vm.prank(admin);
        cd.eraseEscrow(ESCROW_ID);
        (, , , bool erased) = cd.getEscrow(ESCROW_ID);
        assertTrue(erased);

        vm.prank(alice);
        vm.expectRevert(ConditionalDisclosure.EscrowIsErased.selector);
        cd.requestDisclosure(ESCROW_ID, WARRANT);
    }
}
