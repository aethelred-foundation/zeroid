// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SealAttestationRegistry} from "../../contracts/SealAttestationRegistry.sol";

/// Mock ISeal at 0x0900 mirroring the precompile's observable behaviour so the
/// consensus-anchored identity layer can be tested without a live node. The
/// authentic proof against the REAL precompile lives in the aethelred repo's
/// evmhost integration test.
contract MockISeal {
    mapping(string => string) public jobToSeal;
    mapping(string => bool) public active;
    mapping(string => string) public purpose;
    bool public policyOk;
    string public policyReason;

    function setSeal(string calldata jobId, string calldata sealId, bool a, string calldata p) external {
        jobToSeal[jobId] = sealId;
        active[sealId] = a;
        purpose[sealId] = p;
    }

    function setActive(string calldata sealId, bool a) external {
        active[sealId] = a;
    }

    function setPolicy(bool ok, string calldata reason) external {
        policyOk = ok;
        policyReason = reason;
    }

    function getSealIdByJob(string calldata jobId) external view returns (string memory) {
        string memory s = jobToSeal[jobId];
        require(bytes(s).length != 0, "iseal: seal not found for job");
        return s;
    }

    function verifySeal(string calldata sealId) external view returns (bool) {
        return active[sealId];
    }

    function getSeal(string calldata sealId)
        external
        view
        returns (bytes32, bytes32, bytes32, int64, uint64, string memory, string memory, uint8, string memory)
    {
        return (bytes32(0), bytes32(0), bytes32(0), int64(0), uint64(0), "", purpose[sealId], uint8(2), sealId);
    }

    function requireConfidentiality(
        string calldata,
        string[] calldata,
        string calldata,
        string[] calldata,
        bool,
        string[] calldata
    ) external view returns (bool, string memory) {
        return (policyOk, policyReason);
    }
}

contract SealAttestationRegistryTest is Test {
    address constant ISEAL = 0x0000000000000000000000000000000000000900;

    SealAttestationRegistry reg;
    MockISeal seal;

    address gov = address(0x6087);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address relayer = address(0x5E1A1);
    bytes32 kyc = keccak256("kyc-tier-2");
    bytes32 accredited = keccak256("accredited-investor");

    function setUp() public {
        reg = new SealAttestationRegistry(gov);
        MockISeal impl = new MockISeal();
        vm.etch(ISEAL, address(impl).code);
        seal = MockISeal(ISEAL);
        seal.setPolicy(true, ""); // etch copies code, not storage

        vm.prank(gov);
        string[] memory backends = new string[](1);
        backends[0] = "fhe";
        string[] memory residency = new string[](1);
        residency[0] = "EU";
        reg.setCompliancePolicy(backends, "", new string[](0), false, residency);
    }

    function _mintSeal(string memory jobId, string memory sealId, address subject, bytes32 schema) internal {
        seal.setSeal(jobId, sealId, true, reg.expectedPurpose(subject, schema));
    }

    // ── issuance ────────────────────────────────────────────────────────────

    function test_attest_records_consensus_anchored_credential() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(alice);
        reg.attest(kyc, "job-1");

        assertTrue(reg.isCredentialValid(alice, kyc), "credential valid");
        SealAttestationRegistry.Attestation memory a = reg.getAttestation(alice, kyc);
        assertEq(a.sealId, "seal-1");
        assertTrue(a.exists && !a.revoked);
        assertTrue(reg.sealUsed("seal-1"), "seal marked used");
    }

    function test_relayer_can_attest_for_subject() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(relayer);
        reg.attestFor(alice, kyc, "job-1");
        assertTrue(reg.isCredentialValid(alice, kyc), "relayer-submitted credential valid for subject");
    }

    // ── binding / policy rejections ──────────────────────────────────────────

    function test_rejects_seal_bound_to_other_subject() public {
        _mintSeal("job-b", "seal-b", bob, kyc); // bound to bob
        vm.prank(alice);
        vm.expectRevert(); // SealNotBoundToSubject
        reg.attest(kyc, "job-b");
    }

    function test_rejects_seal_bound_to_other_schema() public {
        _mintSeal("job-1", "seal-1", alice, accredited); // bound to a different schema
        vm.prank(alice);
        vm.expectRevert(); // SealNotBoundToSubject (schema mismatch)
        reg.attest(kyc, "job-1");
    }

    function test_rejects_policy_violation() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        seal.setPolicy(false, "jurisdiction outside permitted residency");
        vm.prank(alice);
        vm.expectRevert();
        reg.attest(kyc, "job-1");
    }

    function test_rejects_inactive_seal() public {
        seal.setSeal("job-1", "seal-1", false, reg.expectedPurpose(alice, kyc));
        vm.prank(alice);
        vm.expectRevert(); // SealNotActive(string)
        reg.attest(kyc, "job-1");
    }

    function test_rejects_seal_replay() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(alice);
        reg.attest(kyc, "job-1");
        // Same seal exposed under a new job id, bob-bound — still rejected.
        seal.setSeal("job-2", "seal-1", true, reg.expectedPurpose(bob, kyc));
        vm.prank(bob);
        vm.expectRevert(); // SealAlreadyUsed(string)
        reg.attest(kyc, "job-2");
    }

    // ── revocation & liveness ────────────────────────────────────────────────

    function test_subject_can_self_revoke() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(alice);
        reg.attest(kyc, "job-1");
        vm.prank(alice);
        reg.revoke(alice, kyc);
        assertFalse(reg.isCredentialValid(alice, kyc), "revoked credential invalid");
    }

    function test_stranger_cannot_revoke() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(alice);
        reg.attest(kyc, "job-1");
        vm.prank(bob);
        vm.expectRevert(SealAttestationRegistry.NotSubjectOrOwner.selector);
        reg.revoke(alice, kyc);
    }

    function test_onchain_seal_revocation_invalidates_credential_live() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(alice);
        reg.attest(kyc, "job-1");
        assertTrue(reg.isCredentialValid(alice, kyc));

        // The chain revokes the Digital Seal → credential is invalid immediately,
        // with no ZeroID transaction (liveness flows from consensus).
        seal.setActive("seal-1", false);
        assertFalse(reg.isCredentialValid(alice, kyc), "seal revocation propagates live");
    }

    function test_requireCredential_reverts_when_invalid() public {
        vm.expectRevert(SealAttestationRegistry.NoSuchCredential.selector);
        reg.requireCredential(alice, kyc);
    }

    // ── governance & pause ───────────────────────────────────────────────────

    function test_two_step_ownership_transfer() public {
        vm.prank(gov);
        reg.transferOwnership(bob);
        assertEq(reg.owner(), gov, "owner unchanged before acceptance");
        vm.prank(bob);
        reg.acceptOwnership();
        assertEq(reg.owner(), bob, "owner handed over after acceptance");
    }

    function test_only_owner_sets_policy() public {
        vm.prank(alice);
        vm.expectRevert();
        reg.setCompliancePolicy(new string[](0), "", new string[](0), false, new string[](0));
    }

    function test_pause_blocks_attestation() public {
        _mintSeal("job-1", "seal-1", alice, kyc);
        vm.prank(gov);
        reg.pause();
        vm.prank(alice);
        vm.expectRevert();
        reg.attest(kyc, "job-1");
    }
}
