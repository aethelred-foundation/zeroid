// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ISeal.sol";

/// @title SealAttestationRegistry — ZeroID's consensus-anchored identity layer
/// @notice The issuance side of Aethelred's seal-gated identity model, and the
///         reason ZeroID is the default identity layer for sovereign/regulated
///         clients: a ZeroID credential of the highest assurance tier is not an
///         issuer's on-chain signature — it is anchored to a **Digital Seal**
///         minted by the chain's own Proof-of-Useful-Work pipeline, verified by
///         the ISeal precompile (0x0900), i.e. by the SAME consensus logic that
///         minted the seal. No allowlist oracle, no off-chain KYC server sits in
///         the trust path at verification time.
///
///         Flow:
///           1. A PoUW compliance/KYC job runs for a subject with purpose
///              `zeroid:<schemaHex>:0x<subject>` and a CEAP confidentiality
///              policy (jurisdiction, backend, vendor-root); the validator
///              quorum mints the Digital Seal binding purpose + attestation.
///           2. The subject (or a relayer acting for them) calls {attest} with
///              the job id. The registry checks via ISeal that the seal is
///              ACTIVE, its purpose binds THIS subject and schema, and its
///              attestation satisfies the registry's CEAP policy — then records
///              a consensus-anchored credential.
///           3. Any dApp calls {isCredentialValid} / {requireCredential}; the
///              registry re-checks the seal's live ACTIVE status through ISeal,
///              so a seal revoked on-chain invalidates the credential instantly.
///
/// @dev    Complements the role-based {CredentialRegistry} (issuer-signed
///         credentials); this contract is the top assurance tier where the
///         chain itself is the attester. Immutable core + governed parameters;
///         two-step ownership; withdrawal-of-trust (revoke) always available.
contract SealAttestationRegistry is Ownable2Step, Pausable, ReentrancyGuard {
    /// @dev The ISeal precompile (see aethelred repo precompiles/seal).
    ISeal internal constant SEAL = ISeal(0x0000000000000000000000000000000000000900);

    /// @notice A consensus-anchored credential for (subject, schema).
    struct Attestation {
        string sealId; // the backing Digital Seal
        uint64 issuedAt; // block time of attestation
        bool exists; // record present
        bool revoked; // locally revoked by governance/subject
    }

    // subject => schema => attestation
    mapping(address => mapping(bytes32 => Attestation)) private _attestations;
    // a seal admits exactly one credential (replay protection)
    mapping(string => bool) public sealUsed;

    // CEAP policy every backing seal must satisfy (empty arrays = any).
    string[] private _allowedBackends;
    string private _minVerification;
    string[] private _allowedPlatforms;
    bool private _requireVendorRoot;
    string[] private _dataResidency;

    event CredentialAttested(
        address indexed subject, bytes32 indexed schema, string sealId, string jobId
    );
    event CredentialRevoked(address indexed subject, bytes32 indexed schema, address indexed by);
    event CompliancePolicySet(
        string[] allowedBackends,
        string minVerification,
        string[] allowedPlatforms,
        bool requireVendorRoot,
        string[] dataResidency
    );

    error ZeroSchema();
    error SealAlreadyUsed(string sealId);
    error SealNotActive(string sealId);
    error SealNotBoundToSubject(string expectedPurpose);
    error PolicyNotSatisfied(string reason);
    error NoSuchCredential();
    error NotSubjectOrOwner();

    constructor(address governance) Ownable(governance) {}

    // ── issuance (consensus-anchored) ────────────────────────────────────────

    /// @notice Record a consensus-anchored credential for msg.sender from a
    ///         PoUW job whose seal binds this subject + schema and satisfies the
    ///         registry's CEAP policy. The seal is self-authorizing (its purpose
    ///         binds the subject), so no issuer role is required — but each seal
    ///         admits exactly one credential.
    function attest(bytes32 schema, string calldata jobId)
        external
        whenNotPaused
        nonReentrant
    {
        _attestFor(msg.sender, schema, jobId);
    }

    /// @notice Relayer variant: record the credential for `subject`. Safe
    ///         because the seal's purpose binds `subject` — a relayer cannot
    ///         mis-attribute a credential to anyone the seal was not minted for.
    function attestFor(address subject, bytes32 schema, string calldata jobId)
        external
        whenNotPaused
        nonReentrant
    {
        _attestFor(subject, schema, jobId);
    }

    function _attestFor(address subject, bytes32 schema, string calldata jobId) internal {
        if (schema == bytes32(0)) revert ZeroSchema();

        // Resolve the seal for the PoUW job (reverts if the job is unsealed).
        string memory sealId = SEAL.getSealIdByJob(jobId);
        if (sealUsed[sealId]) revert SealAlreadyUsed(sealId);
        if (!SEAL.verifySeal(sealId)) revert SealNotActive(sealId);

        // The seal must have been minted FOR this subject AND this schema: the
        // PoUW job purpose binds both, so a credential cannot be replayed for a
        // different subject or re-scoped to a different credential type.
        (, , , , , , string memory purpose, , ) = SEAL.getSeal(sealId);
        string memory expected =
            string.concat("zeroid:", _toHexBytes32(schema), ":", _toHexAddress(subject));
        if (keccak256(bytes(purpose)) != keccak256(bytes(expected))) {
            revert SealNotBoundToSubject(expected);
        }

        // CEAP policy — consensus-parity Satisfies via the precompile.
        (bool ok, string memory reason) = SEAL.requireConfidentiality(
            sealId, _allowedBackends, _minVerification, _allowedPlatforms, _requireVendorRoot, _dataResidency
        );
        if (!ok) revert PolicyNotSatisfied(reason);

        sealUsed[sealId] = true;
        _attestations[subject][schema] = Attestation({
            sealId: sealId,
            issuedAt: uint64(block.timestamp),
            exists: true,
            revoked: false
        });
        emit CredentialAttested(subject, schema, sealId, jobId);
    }

    // ── verification (what other dApps call) ─────────────────────────────────

    /// @notice True iff the subject holds a live credential for the schema:
    ///         recorded, not locally revoked, AND its backing seal is still
    ///         ACTIVE on-chain (revocation propagates from consensus instantly).
    function isCredentialValid(address subject, bytes32 schema) public view returns (bool) {
        Attestation storage a = _attestations[subject][schema];
        if (!a.exists || a.revoked) return false;
        return SEAL.verifySeal(a.sealId);
    }

    /// @notice Reverting variant for integrators that want a hard gate.
    function requireCredential(address subject, bytes32 schema) external view {
        if (!isCredentialValid(subject, schema)) revert NoSuchCredential();
    }

    /// @notice Full attestation record (sealId, issuedAt, flags).
    function getAttestation(address subject, bytes32 schema)
        external
        view
        returns (Attestation memory)
    {
        return _attestations[subject][schema];
    }

    // ── revocation (withdrawal of trust) ─────────────────────────────────────

    /// @notice Revoke a credential. Callable by the subject (self-revoke) or by
    ///         governance. Note: revoking the underlying Digital Seal on-chain
    ///         already invalidates it via the live ISeal check in
    ///         {isCredentialValid}; this is the local, credential-scoped control.
    function revoke(address subject, bytes32 schema) external {
        if (msg.sender != subject && msg.sender != owner()) revert NotSubjectOrOwner();
        Attestation storage a = _attestations[subject][schema];
        if (!a.exists) revert NoSuchCredential();
        a.revoked = true;
        emit CredentialRevoked(subject, schema, msg.sender);
    }

    // ── governance ───────────────────────────────────────────────────────────

    /// @notice Set the CEAP policy every backing seal must satisfy.
    function setCompliancePolicy(
        string[] calldata allowedBackends,
        string calldata minVerification,
        string[] calldata allowedPlatforms,
        bool requireVendorRoot,
        string[] calldata dataResidency
    ) external onlyOwner {
        _allowedBackends = allowedBackends;
        _minVerification = minVerification;
        _allowedPlatforms = allowedPlatforms;
        _requireVendorRoot = requireVendorRoot;
        _dataResidency = dataResidency;
        emit CompliancePolicySet(
            allowedBackends, minVerification, allowedPlatforms, requireVendorRoot, dataResidency
        );
    }

    /// @notice Current CEAP policy (for transparency / UIs).
    function compliancePolicy()
        external
        view
        returns (string[] memory, string memory, string[] memory, bool, string[] memory)
    {
        return (_allowedBackends, _minVerification, _allowedPlatforms, _requireVendorRoot, _dataResidency);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice The exact PoUW job purpose a seal must carry to back a credential
    ///         for (subject, schema) — helper for issuers/relayers and UIs.
    function expectedPurpose(address subject, bytes32 schema) external pure returns (string memory) {
        return string.concat("zeroid:", _toHexBytes32(schema), ":", _toHexAddress(subject));
    }

    // ── hex helpers (lowercase, unchecksummed — purpose strings are canonical) ─

    function _toHexAddress(address account) private pure returns (string memory) {
        return _toHex(abi.encodePacked(account), 20);
    }

    function _toHexBytes32(bytes32 value) private pure returns (string memory) {
        return _toHex(abi.encodePacked(value), 32);
    }

    function _toHex(bytes memory data, uint256 len) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(2 + len * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < len; i++) {
            out[2 + i * 2] = alphabet[uint8(data[i]) >> 4];
            out[3 + i * 2] = alphabet[uint8(data[i]) & 0x0f];
        }
        return string(out);
    }
}
