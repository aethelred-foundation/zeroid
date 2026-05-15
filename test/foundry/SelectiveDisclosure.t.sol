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

    function verifyProof(bytes32, Groth16Proof calldata, uint256[] calldata) external view returns (bool) {
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
    bytes32 constant OTHER_SUBJECT_DID = keccak256("did:sd:other-subject");
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

        vm.prank(admin);
        sd.setDisclosureCircuitPolicy(CIRCUIT_ID, 3, 0, 1, 2, true);

        // Set credential as valid
        mockCred.setValid(CRED_HASH, true);
        mockCred.setCred(CRED_HASH, _credentialForSubject(SUBJECT_DID));
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
            bytes32 subjectDid,
            bytes32 credHash,
            bytes32[] memory attrHashes,
            address verifier,,
            uint64 expAt,
            bool fulfilled,
            bool cancelled
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

    function test_CreateDisclosureRequest_RevertsSubjectMismatch() public {
        mockCred.setCred(CRED_HASH, _credentialForSubject(OTHER_SUBJECT_DID));

        bytes32[] memory attrs = new bytes32[](1);
        attrs[0] = keccak256("attr");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.CredentialSubjectMismatch.selector, CRED_HASH, SUBJECT_DID, OTHER_SUBJECT_DID
            )
        );
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

        (,,,,,,, bool cancelled) = sd.getDisclosureRequest(requestId);
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

    function _credentialForSubject(bytes32 subjectDid) internal view returns (Credential memory) {
        return Credential({
            credentialHash: CRED_HASH,
            schemaHash: keccak256("schema"),
            issuerDid: keccak256("issuer"),
            subjectDid: subjectDid,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 365 days),
            status: CredentialStatus.Active,
            merkleRoot: keccak256("merkle_root")
        });
    }

    function _requestContextHash(bytes32 requestId) internal view returns (bytes32) {
        bytes32 attributesHash = keccak256(abi.encodePacked(uint256(1)));
        attributesHash = keccak256(abi.encodePacked(attributesHash, keccak256("attr:age")));
        return keccak256(
            abi.encode(
                address(sd),
                block.chainid,
                requestId,
                alice,
                SUBJECT_DID,
                CRED_HASH,
                attributesHash
            )
        );
    }

    function _validPublicInputs(
        bytes32 requestId,
        bytes32 merkleRoot,
        bytes32 nullifier
    ) internal view returns (uint256[] memory publicInputs) {
        publicInputs = new uint256[](3);
        publicInputs[0] = uint256(merkleRoot);
        publicInputs[1] = uint256(_requestContextHash(requestId));
        publicInputs[2] = uint256(nullifier);
    }

    // ════════════════════════════════════════════════════════════════
    // ZID-010: Proof Context Binding
    // ════════════════════════════════════════════════════════════════

    function test_SetDisclosureCircuitPolicy_RevertsInvalidSchema() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.InvalidDisclosureCircuitPolicy.selector,
                CIRCUIT_ID
            )
        );
        sd.setDisclosureCircuitPolicy(CIRCUIT_ID, 2, 0, 1, 1, true);
    }

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

        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.PublicInputSchemaMismatch.selector,
                CIRCUIT_ID,
                uint256(3),
                uint256(2)
            )
        );
        sd.submitDisclosureProof(requestId, CIRCUIT_ID, proof, publicInputs, merkleProof);
    }

    function test_SubmitDisclosureProof_RevertsUnconfiguredCircuit() public {
        bytes32 requestId = _createRequest();
        bytes32 merkleRoot = keccak256("attr:age");
        Credential memory cred = _credentialForSubject(SUBJECT_DID);
        cred.merkleRoot = merkleRoot;
        mockCred.setCred(CRED_HASH, cred);

        uint256[] memory publicInputs = _validPublicInputs(
            requestId,
            merkleRoot,
            keccak256("nullifier")
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.DisclosureCircuitNotConfigured.selector,
                keccak256("circuit:unconfigured")
            )
        );
        sd.submitDisclosureProof(
            requestId,
            keccak256("circuit:unconfigured"),
            _dummyProof(),
            publicInputs,
            new bytes32[](0)
        );
    }

    function test_SubmitDisclosureProof_RevertsWrongMerkleRootInput() public {
        bytes32 requestId = _createRequest();

        bytes32 merkleRoot = keccak256("attr:age");
        Credential memory cred = _credentialForSubject(SUBJECT_DID);
        cred.merkleRoot = merkleRoot;
        mockCred.setCred(CRED_HASH, cred);

        Groth16Proof memory proof = _dummyProof();
        uint256[] memory publicInputs = _validPublicInputs(
            requestId,
            keccak256("wrong_merkle_root"),
            keccak256("nullifier")
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.PublicInputBindingMismatch.selector,
                CIRCUIT_ID,
                uint256(0),
                merkleRoot,
                keccak256("wrong_merkle_root")
            )
        );
        sd.submitDisclosureProof(requestId, CIRCUIT_ID, proof, publicInputs, new bytes32[](0));
    }

    function test_SubmitDisclosureProof_RevertsWrongContextInput() public {
        bytes32 requestId = _createRequest();
        bytes32 merkleRoot = keccak256("attr:age");
        Credential memory cred = _credentialForSubject(SUBJECT_DID);
        cred.merkleRoot = merkleRoot;
        mockCred.setCred(CRED_HASH, cred);

        uint256[] memory publicInputs = _validPublicInputs(
            requestId,
            merkleRoot,
            keccak256("nullifier")
        );
        publicInputs[1] = uint256(keccak256("wrong-context"));

        vm.expectRevert(
            abi.encodeWithSelector(
                SelectiveDisclosure.PublicInputBindingMismatch.selector,
                CIRCUIT_ID,
                uint256(1),
                _requestContextHash(requestId),
                keccak256("wrong-context")
            )
        );
        sd.submitDisclosureProof(
            requestId,
            CIRCUIT_ID,
            _dummyProof(),
            publicInputs,
            new bytes32[](0)
        );
    }

    function test_SubmitDisclosureProof_SuccessWithConfiguredCircuit() public {
        bytes32 requestId = _createRequest();
        bytes32 merkleRoot = keccak256("attr:age");
        bytes32 nullifier = keccak256("nullifier");
        Credential memory cred = _credentialForSubject(SUBJECT_DID);
        cred.merkleRoot = merkleRoot;
        mockCred.setCred(CRED_HASH, cred);

        uint256[] memory publicInputs = _validPublicInputs(
            requestId,
            merkleRoot,
            nullifier
        );

        assertTrue(sd.submitDisclosureProof(
            requestId,
            CIRCUIT_ID,
            _dummyProof(),
            publicInputs,
            new bytes32[](0)
        ));
        assertTrue(sd.isNullifierUsedInContext(requestId, nullifier));
    }
}
