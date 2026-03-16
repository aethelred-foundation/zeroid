// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

/// @notice Mock CredentialRegistry for SD tests
contract MockCredentialRegistrySD {
    mapping(bytes32 => bool) public validCreds;
    mapping(bytes32 => Credential) public creds;

    function setValid(bytes32 credHash, bool valid_) external {
        validCreds[credHash] = valid_;
    }

    function setCred(bytes32 credHash, Credential memory cred) external {
        creds[credHash] = cred;
    }

    function isCredentialValid(bytes32 credHash) external view returns (bool) {
        return validCreds[credHash];
    }

    function getCredential(bytes32 credHash) external view returns (Credential memory) {
        return creds[credHash];
    }
}

/// @notice Mock ZK Verifier for SD tests
contract MockZKVerifierSD {
    bool public returnValue = true;

    function setReturnValue(bool v) external {
        returnValue = v;
    }

    function verifyProof(
        bytes32,
        Groth16Proof calldata,
        uint256[] calldata
    ) external view returns (bool) {
        return returnValue;
    }

    function isCircuitRegistered(bytes32) external pure returns (bool) {
        return true;
    }

    function setVerificationKey(
        bytes32,
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2][2] calldata,
        uint256[2][2] calldata,
        uint256[2][] calldata
    ) external {}
}

contract SelectiveDisclosureTest is TestHelper {
    SelectiveDisclosure public sd;
    MockCredentialRegistrySD public mockCred;
    MockZKVerifierSD public mockZK;

    bytes32 constant SUBJECT_DID = keccak256("did:sd:subject");
    bytes32 constant CRED_HASH = keccak256("cred:sd:1");
    bytes32 constant CIRCUIT_ID = keccak256("circuit:sd:1");

    function setUp() public {
        mockCred = new MockCredentialRegistrySD();
        mockZK = new MockZKVerifierSD();
        sd = new SelectiveDisclosure(admin, address(mockCred), address(mockZK));

        // Grant VERIFIER_ROLE to alice
        bytes32 verifierRole = sd.VERIFIER_ROLE();
        vm.prank(admin);
        sd.grantRole(verifierRole, alice);

        // Set credential as valid
        mockCred.setValid(CRED_HASH, true);
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsState() public view {
        assertEq(address(sd.credentialRegistry()), address(mockCred));
        assertEq(address(sd.zkVerifier()), address(mockZK));
        assertEq(sd.totalRequests(), 0);
    }

    function test_Constructor_RevertsZeroAdmin() public {
        vm.expectRevert("Zero admin");
        new SelectiveDisclosure(address(0), address(mockCred), address(mockZK));
    }

    function test_Constructor_RevertsZeroCredRegistry() public {
        vm.expectRevert("Zero credential registry");
        new SelectiveDisclosure(admin, address(0), address(mockZK));
    }

    function test_Constructor_RevertsZeroZKVerifier() public {
        vm.expectRevert("Zero ZK verifier");
        new SelectiveDisclosure(admin, address(mockCred), address(0));
    }

    function test_Constants() public view {
        assertEq(sd.MIN_REQUEST_VALIDITY(), 5 minutes);
        assertEq(sd.MAX_REQUEST_VALIDITY(), 7 days);
        assertEq(sd.MAX_ATTRIBUTES_PER_REQUEST(), 32);
        assertEq(sd.MAX_MERKLE_PROOF_DEPTH(), 32);
    }

    // ════════════════════════════════════════════════════════════════
    // Disclosure Request
    // ════════════════════════════════════════════════════════════════

    function test_CreateDisclosureRequest_Success() public {
        bytes32[] memory attrs = new bytes32[](2);
        attrs[0] = keccak256("attr:age");
        attrs[1] = keccak256("attr:country");

        uint64 expiresAt = uint64(block.timestamp + 1 days);

        vm.prank(alice);
        bytes32 requestId = sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, expiresAt);

        assertEq(sd.totalRequests(), 1);

        (
            bytes32 subjectDid, bytes32 credHash, bytes32[] memory attrHashes,
            address verifier, , uint64 expAt, bool fulfilled, bool cancelled
        ) = sd.getDisclosureRequest(requestId);

        assertEq(subjectDid, SUBJECT_DID);
        assertEq(credHash, CRED_HASH);
        assertEq(attrHashes.length, 2);
        assertEq(verifier, alice);
        assertEq(expAt, expiresAt);
        assertFalse(fulfilled);
        assertFalse(cancelled);
    }

    function test_CreateDisclosureRequest_RevertsNoAttributes() public {
        bytes32[] memory attrs = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(SelectiveDisclosure.NoAttributesRequested.selector);
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    function test_CreateDisclosureRequest_RevertsTooManyAttributes() public {
        bytes32[] memory attrs = new bytes32[](33);
        for (uint256 i = 0; i < 33; i++) {
            attrs[i] = _hash("attr", i);
        }

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SelectiveDisclosure.TooManyAttributes.selector, uint32(33)));
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    function test_CreateDisclosureRequest_RevertsInvalidValidity() public {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr");

        // Too short
        vm.prank(alice);
        vm.expectRevert();
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 minutes));
    }

    function test_CreateDisclosureRequest_RevertsCredNotValid() public {
        mockCred.setValid(CRED_HASH, false);

        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SelectiveDisclosure.CredentialNotValid.selector, CRED_HASH));
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    function test_CreateDisclosureRequest_RevertsWithoutRole() public {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr");

        vm.prank(bob);
        vm.expectRevert();
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    // ════════════════════════════════════════════════════════════════
    // Cancel Request
    // ════════════════════════════════════════════════════════════════

    function test_CancelDisclosureRequest() public {
        bytes32 requestId = _createRequest();

        vm.prank(alice);
        sd.cancelDisclosureRequest(requestId);

        (, , , , , , , bool cancelled) = sd.getDisclosureRequest(requestId);
        assertTrue(cancelled);
    }

    function test_CancelDisclosureRequest_RevertsNotVerifier() public {
        bytes32 requestId = _createRequest();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SelectiveDisclosure.NotRequestVerifier.selector, requestId, bob));
        sd.cancelDisclosureRequest(requestId);
    }

    // ════════════════════════════════════════════════════════════════
    // View Functions
    // ════════════════════════════════════════════════════════════════

    function test_GetVerifierRequests() public {
        _createRequest();

        bytes32[] memory reqs = sd.getVerifierRequests(alice);
        assertEq(reqs.length, 1);
    }

    function test_GetSubjectDisclosures() public {
        _createRequest();

        bytes32[] memory discs = sd.getSubjectDisclosures(SUBJECT_DID);
        assertEq(discs.length, 1);
    }

    function test_GetDisclosureResult_NotFulfilled() public {
        bytes32 requestId = _createRequest();

        (bool verified, uint64 verifiedAt) = sd.getDisclosureResult(requestId);
        assertFalse(verified);
        assertEq(verifiedAt, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksCreateRequest() public {
        vm.prank(admin);
        sd.pause();

        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr");

        vm.prank(alice);
        vm.expectRevert();
        sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    // ════════════════════════════════════════════════════════════════
    // Helpers
    // ════════════════════════════════════════════════════════════════

    function _createRequest() internal returns (bytes32) {
        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr:age");

        vm.prank(alice);
        return sd.createDisclosureRequest(SUBJECT_DID, CRED_HASH, attrs, uint64(block.timestamp + 1 days));
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-010: Proof Context Binding
    // ════════════════════════════════════════════════════════════════

    function test_SubmitDisclosureProof_RevertsInsufficientPublicInputs() public {
        bytes32 requestId = _createRequest();

        // Set up credential with merkle root
        Credential memory cred = Credential({
            credentialHash: CRED_HASH,
            schemaHash: keccak256("schema"),
            issuerDid: keccak256("issuer"),
            subjectDid: SUBJECT_DID,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 365 days),
            status: CredentialStatus.Active,
            merkleRoot: keccak256("merkle_root")
        });
        mockCred.setCred(CRED_HASH, cred);

        Groth16Proof memory proof = _dummyProof();
        // Only 2 public inputs — should fail (needs >= 3)
        uint256[] memory publicInputs = new uint256[](2);
        publicInputs[0] = uint256(cred.merkleRoot);
        publicInputs[1] = uint256(keccak256("nullifier"));

        bytes32[] memory merkleProof = new bytes32[](0);

        vm.expectRevert("Insufficient public inputs");
        sd.submitDisclosureProof(requestId, CIRCUIT_ID, proof, publicInputs, merkleProof);
    }

    function test_SubmitDisclosureProof_RevertsWrongMerkleRootInput() public {
        bytes32 requestId = _createRequest();

        // Set up credential with merkle root
        bytes32 merkleRoot = keccak256("merkle_root");
        Credential memory cred = Credential({
            credentialHash: CRED_HASH,
            schemaHash: keccak256("schema"),
            issuerDid: keccak256("issuer"),
            subjectDid: SUBJECT_DID,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 365 days),
            status: CredentialStatus.Active,
            merkleRoot: merkleRoot
        });
        mockCred.setCred(CRED_HASH, cred);

        Groth16Proof memory proof = _dummyProof();
        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(keccak256("wrong_merkle_root")); // wrong!
        publicInputs[1] = uint256(keccak256("context"));
        publicInputs[2] = uint256(keccak256("nullifier"));

        // Use a merkle proof that results in the root matching
        bytes32[] memory attrHashes = new bytes32[](1);
        attrHashes[0] = keccak256("attr:age");
        // Build proof such that hash(attr) walks to merkleRoot
        bytes32[] memory merkleProofPath = new bytes32[](0);

        // The merkle proof will fail before we get to the public input check,
        // but let's test with a passing merkle proof scenario
        // Actually the merkle proof verification happens first. Let's make it pass
        // by setting merkleRoot = hash of the attribute
        cred.merkleRoot = keccak256("attr:age");
        mockCred.setCred(CRED_HASH, cred);

        vm.expectRevert("Public input[0] must match credential merkle root");
        sd.submitDisclosureProof(requestId, CIRCUIT_ID, proof, publicInputs, merkleProofPath);
    }
}
