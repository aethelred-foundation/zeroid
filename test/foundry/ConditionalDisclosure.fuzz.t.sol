// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ConditionalDisclosure} from "../../contracts/ConditionalDisclosure.sol";

/// @title ConditionalDisclosure Fuzz Tests
/// @notice Property: a disclosure authorizes iff the number of distinct officer
///         approvals reaches the quorum snapshotted at request time — never
///         below, regardless of the threshold or how many officers approve.
contract ConditionalDisclosureFuzzTest is Test {
    ConditionalDisclosure internal cd;
    address internal admin = address(0xA11CE);
    address internal operator = address(0x09E4A704);
    address[5] internal officers;

    bytes32 internal constant COMMITMENT = keccak256("c");
    bytes32 internal constant NULLIFIER = keccak256("n");
    bytes32 internal constant WARRANT = keccak256("w");

    function setUp() public {
        cd = new ConditionalDisclosure(admin, 1);
        vm.startPrank(admin);
        cd.grantRole(cd.ESCROW_ISSUER_ROLE(), operator);
        for (uint256 i = 0; i < 5; i++) {
            officers[i] = makeAddr(string(abi.encodePacked("officer", i)));
            cd.grantRole(cd.COMPLIANCE_OFFICER_ROLE(), officers[i]);
        }
        vm.stopPrank();
    }

    function testFuzz_authorizedIffQuorumMet(uint8 thresholdSeed, uint8 approveSeed) public {
        uint256 threshold = bound(thresholdSeed, 1, 5);
        uint256 toApprove = bound(approveSeed, 0, 5);

        vm.prank(admin);
        cd.setDisclosureThreshold(threshold);

        bytes32 eid = keccak256(abi.encode(thresholdSeed, approveSeed));
        vm.prank(operator);
        cd.registerEscrow(eid, COMMITMENT, NULLIFIER);
        vm.prank(officers[0]);
        cd.requestDisclosure(eid, WARRANT);

        for (uint256 i = 0; i < toApprove; i++) {
            if (cd.isDisclosureAuthorized(eid)) break; // further approvals would revert
            vm.prank(officers[i]);
            cd.approveDisclosure(eid);
        }

        assertEq(
            cd.isDisclosureAuthorized(eid),
            toApprove >= threshold,
            "authorized iff distinct approvals reach the snapshot quorum"
        );
    }
}
