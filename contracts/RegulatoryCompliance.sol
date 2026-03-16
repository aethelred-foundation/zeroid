// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RegulatoryCompliance
 * @author ZeroID Cryptography Team
 * @notice On-chain regulatory compliance framework supporting multi-jurisdiction
 *         rules, eIDAS 2.0 qualified credentials, travel rule compliance,
 *         sanctions screening, and automated compliance attestations.
 *
 * @dev Architecture:
 *      - Jurisdictions register compliance rules (required credential types, KYC levels, etc.)
 *      - Credentials are mapped to jurisdictions with compliance status
 *      - Regulatory reports are committed as hashes (data stays off-chain)
 *      - Sanctions lists are committed as Merkle roots for privacy-preserving screening
 *      - Travel rule compliance is enforced for cross-border transfers
 *      - eIDAS 2.0 markers identify EU-qualified electronic attestations
 *
 *      Privacy: Only commitment hashes and compliance status are stored on-chain.
 *      The actual PII and credential data remain off-chain, referenced by hashes.
 */
contract RegulatoryCompliance is AccessControl, Pausable, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");
    bytes32 public constant JURISDICTION_ADMIN_ROLE = keccak256("JURISDICTION_ADMIN_ROLE");
    bytes32 public constant SANCTIONS_ORACLE_ROLE = keccak256("SANCTIONS_ORACLE_ROLE");
    bytes32 public constant TRAVEL_RULE_ROLE = keccak256("TRAVEL_RULE_ROLE");
    bytes32 public constant EIDAS_AUTHORITY_ROLE = keccak256("EIDAS_AUTHORITY_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error JurisdictionAlreadyRegistered();
    error JurisdictionNotRegistered();
    error JurisdictionNotActive();
    error InvalidCredentialType();
    error CredentialNotFound();
    error ComplianceCheckFailed();
    error SanctionsHit();
    error TravelRuleViolation();
    error InvalidMerkleProof();
    error ReportAlreadySubmitted();
    error ReportNotFound();
    error InvalidEIDASLevel();
    error QualifiedStatusRequired();
    error TransferAmountExceeded();
    error InvalidJurisdictionPair();
    error AttestationExpired();
    error InvalidKYCLevel();
    error RuleAlreadyExists();
    error RuleNotFound();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event JurisdictionRegistered(
        bytes32 indexed jurisdictionId,
        string isoCode,
        uint256 timestamp
    );

    event JurisdictionUpdated(
        bytes32 indexed jurisdictionId,
        uint256 timestamp
    );

    event ComplianceRuleAdded(
        bytes32 indexed jurisdictionId,
        bytes32 indexed ruleId,
        string ruleType,
        uint256 timestamp
    );

    event ComplianceAttestationIssued(
        bytes32 indexed credentialHash,
        bytes32 indexed jurisdictionId,
        ComplianceStatus status,
        uint256 timestamp
    );

    event RegulatoryReportCommitted(
        bytes32 indexed reportId,
        bytes32 indexed jurisdictionId,
        bytes32 reportHash,
        uint256 timestamp
    );

    event SanctionsListUpdated(
        bytes32 indexed jurisdictionId,
        bytes32 newMerkleRoot,
        uint256 listSize,
        uint256 timestamp
    );

    event SanctionsScreeningResult(
        bytes32 indexed subjectHash,
        bytes32 indexed jurisdictionId,
        bool hit,
        uint256 timestamp
    );

    event TravelRuleTransfer(
        bytes32 indexed transferId,
        bytes32 indexed originatorJurisdiction,
        bytes32 indexed beneficiaryJurisdiction,
        uint256 amount,
        bool compliant,
        uint256 timestamp
    );

    event EIDASCredentialMarked(
        bytes32 indexed credentialHash,
        EIDASLevel level,
        bytes32 indexed trustedListHash,
        uint256 timestamp
    );

    event ComplianceStatusChanged(
        bytes32 indexed credentialHash,
        bytes32 indexed jurisdictionId,
        ComplianceStatus oldStatus,
        ComplianceStatus newStatus,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────

    enum ComplianceStatus {
        Unknown,         // Not yet assessed
        Compliant,       // Meets all jurisdictional requirements
        NonCompliant,    // Fails one or more requirements
        Pending,         // Under review
        Expired,         // Attestation has expired
        Exempt           // Legally exempt from requirements
    }

    enum KYCLevel {
        None,            // No KYC
        Basic,           // Name + DOB
        Enhanced,        // Basic + address + document verification
        Full,            // Enhanced + source of funds + PEP screening
        Institutional    // Full + corporate structure + UBO verification
    }

    enum EIDASLevel {
        None,            // Not an eIDAS credential
        Low,             // eIDAS Low assurance
        Substantial,     // eIDAS Substantial assurance
        High,            // eIDAS High assurance
        Qualified        // eIDAS Qualified (highest — legally equivalent to handwritten)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Jurisdiction configuration
    struct Jurisdiction {
        bytes32 jurisdictionId;       // Unique ID (e.g., keccak256("US"), keccak256("EU"))
        string isoCode;               // ISO 3166-1 alpha-2 code
        string name;                  // Human-readable name
        bool active;
        uint256 registeredAt;
        KYCLevel minimumKYCLevel;     // Minimum KYC level required
        bool requiresEIDAS;           // Whether eIDAS credentials are required
        EIDASLevel minimumEIDASLevel; // Minimum eIDAS level if required
        uint256 travelRuleThreshold;  // Amount threshold for travel rule (in wei)
        uint256 ruleCount;            // Number of compliance rules
    }

    /// @notice Compliance rule within a jurisdiction
    struct ComplianceRule {
        bytes32 ruleId;
        bytes32 jurisdictionId;
        string ruleType;              // e.g., "KYC", "AML", "SANCTIONS", "TRAVEL_RULE"
        string description;
        bytes32 requiredCredentialType; // Type of credential needed
        uint256 validityPeriod;       // How long a compliance attestation is valid (seconds)
        bool mandatory;               // Whether this rule must be satisfied
        bool active;
    }

    /// @notice Compliance attestation for a credential in a jurisdiction
    struct ComplianceAttestation {
        bytes32 credentialHash;
        bytes32 jurisdictionId;
        ComplianceStatus status;
        uint256 issuedAt;
        uint256 expiresAt;
        bytes32 attestationHash;      // Hash of the full attestation data (off-chain)
        address issuedBy;
        KYCLevel kycLevel;
        bytes32[] satisfiedRules;     // Rule IDs that this attestation covers
    }

    /// @notice Regulatory report commitment
    struct RegulatoryReport {
        bytes32 reportId;
        bytes32 jurisdictionId;
        bytes32 reportHash;           // Hash of the actual report data (off-chain)
        string reportType;            // e.g., "SAR", "CTR", "STR"
        uint256 submittedAt;
        address submittedBy;
        uint256 periodStart;          // Reporting period start
        uint256 periodEnd;            // Reporting period end
    }

    /// @notice Sanctions list state
    struct SanctionsList {
        bytes32 merkleRoot;           // Merkle root of the sanctions list
        uint256 listSize;             // Number of entries
        uint256 lastUpdated;
        bytes32 sourceHash;           // Hash of the source (e.g., OFAC, EU, UN)
    }

    /// @notice Travel rule transfer record
    struct TravelRuleRecord {
        bytes32 transferId;
        bytes32 originatorHash;       // Hash of originator identity
        bytes32 beneficiaryHash;      // Hash of beneficiary identity
        bytes32 originatorJurisdiction;
        bytes32 beneficiaryJurisdiction;
        uint256 amount;
        bytes32 originatorVASPHash;   // Hash of originator VASP details
        bytes32 beneficiaryVASPHash;  // Hash of beneficiary VASP details
        uint256 timestamp;
        bool compliant;
    }

    /// @notice eIDAS credential marker
    struct EIDASMarker {
        bytes32 credentialHash;
        EIDASLevel level;
        bytes32 trustedListHash;      // Hash of the EU Trusted List entry
        bytes32 issuerHash;           // Hash of the qualified trust service provider
        uint256 issuedAt;
        uint256 expiresAt;
        bool active;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint256 public constant DEFAULT_ATTESTATION_VALIDITY = 365 days;
    uint256 public constant FATF_TRAVEL_RULE_THRESHOLD = 1000 ether; // ~$1000 equivalent
    uint256 public constant MAX_RULES_PER_JURISDICTION = 50;

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Jurisdictions by ID
    mapping(bytes32 => Jurisdiction) private _jurisdictions;

    /// @notice Compliance rules: jurisdictionId => ruleId => ComplianceRule
    mapping(bytes32 => mapping(bytes32 => ComplianceRule)) private _rules;

    /// @notice Rule IDs per jurisdiction for enumeration
    mapping(bytes32 => bytes32[]) private _jurisdictionRuleIds;

    /// @notice Compliance attestations: credentialHash => jurisdictionId => attestation
    mapping(bytes32 => mapping(bytes32 => ComplianceAttestation)) private _attestations;

    /// @notice Regulatory reports: reportId => RegulatoryReport
    mapping(bytes32 => RegulatoryReport) private _reports;

    /// @notice Sanctions lists: jurisdictionId => SanctionsList
    mapping(bytes32 => SanctionsList) private _sanctionsLists;

    /// @notice Travel rule transfers: transferId => TravelRuleRecord
    mapping(bytes32 => TravelRuleRecord) private _travelRuleTransfers;

    /// @notice eIDAS markers: credentialHash => EIDASMarker
    mapping(bytes32 => EIDASMarker) private _eidasMarkers;

    /// @notice All jurisdiction IDs
    bytes32[] private _jurisdictionIds;

    /// @notice Global counters
    uint256 public totalAttestations;
    uint256 public totalReports;
    uint256 public totalTravelRuleTransfers;

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_OFFICER_ROLE, admin);
        _grantRole(JURISDICTION_ADMIN_ROLE, admin);
        _grantRole(SANCTIONS_ORACLE_ROLE, admin);
        _grantRole(TRAVEL_RULE_ROLE, admin);
        _grantRole(EIDAS_AUTHORITY_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Jurisdiction management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new jurisdiction.
     * @param jurisdictionId     Unique identifier
     * @param isoCode            ISO 3166-1 alpha-2 country code
     * @param name               Human-readable jurisdiction name
     * @param minimumKYCLevel    Minimum KYC level required
     * @param requiresEIDAS      Whether eIDAS credentials are mandatory
     * @param minimumEIDASLevel  Minimum eIDAS level (if required)
     * @param travelRuleThreshold Amount threshold for travel rule
     */
    function registerJurisdiction(
        bytes32 jurisdictionId,
        string calldata isoCode,
        string calldata name,
        KYCLevel minimumKYCLevel,
        bool requiresEIDAS,
        EIDASLevel minimumEIDASLevel,
        uint256 travelRuleThreshold
    ) external onlyRole(JURISDICTION_ADMIN_ROLE) {
        if (_jurisdictions[jurisdictionId].active) revert JurisdictionAlreadyRegistered();

        _jurisdictions[jurisdictionId] = Jurisdiction({
            jurisdictionId: jurisdictionId,
            isoCode: isoCode,
            name: name,
            active: true,
            registeredAt: block.timestamp,
            minimumKYCLevel: minimumKYCLevel,
            requiresEIDAS: requiresEIDAS,
            minimumEIDASLevel: minimumEIDASLevel,
            travelRuleThreshold: travelRuleThreshold > 0
                ? travelRuleThreshold
                : FATF_TRAVEL_RULE_THRESHOLD,
            ruleCount: 0
        });

        _jurisdictionIds.push(jurisdictionId);

        emit JurisdictionRegistered(jurisdictionId, isoCode, block.timestamp);
    }

    /**
     * @notice Update jurisdiction parameters.
     */
    function updateJurisdiction(
        bytes32 jurisdictionId,
        KYCLevel minimumKYCLevel,
        bool requiresEIDAS,
        EIDASLevel minimumEIDASLevel,
        uint256 travelRuleThreshold
    ) external onlyRole(JURISDICTION_ADMIN_ROLE) {
        Jurisdiction storage j = _jurisdictions[jurisdictionId];
        if (!j.active) revert JurisdictionNotRegistered();

        j.minimumKYCLevel = minimumKYCLevel;
        j.requiresEIDAS = requiresEIDAS;
        j.minimumEIDASLevel = minimumEIDASLevel;
        if (travelRuleThreshold > 0) j.travelRuleThreshold = travelRuleThreshold;

        emit JurisdictionUpdated(jurisdictionId, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Compliance rules
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Add a compliance rule to a jurisdiction.
     * @param jurisdictionId        Target jurisdiction
     * @param ruleId                Unique rule identifier
     * @param ruleType              Rule category (e.g., "KYC", "AML")
     * @param description           Human-readable description
     * @param requiredCredentialType Credential type hash required by this rule
     * @param validityPeriod        How long compliance attestations last
     * @param mandatory             Whether this rule is mandatory
     */
    function addComplianceRule(
        bytes32 jurisdictionId,
        bytes32 ruleId,
        string calldata ruleType,
        string calldata description,
        bytes32 requiredCredentialType,
        uint256 validityPeriod,
        bool mandatory
    ) external onlyRole(JURISDICTION_ADMIN_ROLE) {
        Jurisdiction storage j = _jurisdictions[jurisdictionId];
        if (!j.active) revert JurisdictionNotRegistered();
        if (_rules[jurisdictionId][ruleId].active) revert RuleAlreadyExists();
        if (j.ruleCount >= MAX_RULES_PER_JURISDICTION) revert RuleAlreadyExists();

        _rules[jurisdictionId][ruleId] = ComplianceRule({
            ruleId: ruleId,
            jurisdictionId: jurisdictionId,
            ruleType: ruleType,
            description: description,
            requiredCredentialType: requiredCredentialType,
            validityPeriod: validityPeriod > 0 ? validityPeriod : DEFAULT_ATTESTATION_VALIDITY,
            mandatory: mandatory,
            active: true
        });

        _jurisdictionRuleIds[jurisdictionId].push(ruleId);
        j.ruleCount += 1;

        emit ComplianceRuleAdded(jurisdictionId, ruleId, ruleType, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Compliance attestations
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Issue a compliance attestation for a credential in a jurisdiction.
     * @param credentialHash  The credential being attested
     * @param jurisdictionId  The jurisdiction
     * @param status          Compliance status
     * @param attestationHash Hash of the full attestation data (off-chain)
     * @param kycLevel        KYC level achieved
     * @param satisfiedRules  Array of rule IDs satisfied by this attestation
     * @param validityPeriod  Custom validity period (0 for default)
     */
    function issueComplianceAttestation(
        bytes32 credentialHash,
        bytes32 jurisdictionId,
        ComplianceStatus status,
        bytes32 attestationHash,
        KYCLevel kycLevel,
        bytes32[] calldata satisfiedRules,
        uint256 validityPeriod
    ) external onlyRole(COMPLIANCE_OFFICER_ROLE) whenNotPaused nonReentrant {
        Jurisdiction storage j = _jurisdictions[jurisdictionId];
        if (!j.active) revert JurisdictionNotActive();

        // Validate KYC level meets jurisdiction minimum
        if (uint8(kycLevel) < uint8(j.minimumKYCLevel) && status == ComplianceStatus.Compliant) {
            revert InvalidKYCLevel();
        }

        uint256 validity = validityPeriod > 0 ? validityPeriod : DEFAULT_ATTESTATION_VALIDITY;

        ComplianceStatus oldStatus = _attestations[credentialHash][jurisdictionId].status;

        _attestations[credentialHash][jurisdictionId] = ComplianceAttestation({
            credentialHash: credentialHash,
            jurisdictionId: jurisdictionId,
            status: status,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + validity,
            attestationHash: attestationHash,
            issuedBy: msg.sender,
            kycLevel: kycLevel,
            satisfiedRules: satisfiedRules
        });

        unchecked { ++totalAttestations; }

        emit ComplianceAttestationIssued(credentialHash, jurisdictionId, status, block.timestamp);

        if (oldStatus != status && oldStatus != ComplianceStatus.Unknown) {
            emit ComplianceStatusChanged(
                credentialHash, jurisdictionId, oldStatus, status, block.timestamp
            );
        }
    }

    /**
     * @notice Check compliance status of a credential in a jurisdiction.
     * @param credentialHash The credential to check
     * @param jurisdictionId The jurisdiction
     * @return status  Current compliance status
     * @return kycLevel The KYC level
     * @return expiresAt When the attestation expires
     * @return valid   Whether the attestation is current and compliant
     */
    function checkCompliance(
        bytes32 credentialHash,
        bytes32 jurisdictionId
    ) external view returns (
        ComplianceStatus status,
        KYCLevel kycLevel,
        uint256 expiresAt,
        bool valid
    ) {
        ComplianceAttestation storage att = _attestations[credentialHash][jurisdictionId];
        status = att.status;
        kycLevel = att.kycLevel;
        expiresAt = att.expiresAt;

        valid = (status == ComplianceStatus.Compliant || status == ComplianceStatus.Exempt) &&
                (att.expiresAt == 0 || block.timestamp <= att.expiresAt);
    }

    /**
     * @notice Check compliance across multiple jurisdictions.
     * @param credentialHash  The credential
     * @param jurisdictionIds Array of jurisdictions to check
     * @return compliantCount Number of jurisdictions where compliant
     * @return results        Per-jurisdiction compliance status
     */
    function checkMultiJurisdictionCompliance(
        bytes32 credentialHash,
        bytes32[] calldata jurisdictionIds
    ) external view returns (uint256 compliantCount, ComplianceStatus[] memory results) {
        results = new ComplianceStatus[](jurisdictionIds.length);

        for (uint256 i = 0; i < jurisdictionIds.length; i++) {
            ComplianceAttestation storage att = _attestations[credentialHash][jurisdictionIds[i]];
            results[i] = att.status;

            bool isValid = (att.status == ComplianceStatus.Compliant ||
                           att.status == ComplianceStatus.Exempt) &&
                          (att.expiresAt == 0 || block.timestamp <= att.expiresAt);

            if (isValid) { unchecked { ++compliantCount; } }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Regulatory reporting
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Commit a regulatory report hash on-chain.
     * @dev The actual report data is stored off-chain. Only the hash is on-chain
     *      for auditability and non-repudiation.
     * @param reportId       Unique report identifier
     * @param jurisdictionId Target jurisdiction
     * @param reportHash     Hash of the report data
     * @param reportType     Report type (e.g., "SAR", "CTR", "STR")
     * @param periodStart    Reporting period start timestamp
     * @param periodEnd      Reporting period end timestamp
     */
    function commitReport(
        bytes32 reportId,
        bytes32 jurisdictionId,
        bytes32 reportHash,
        string calldata reportType,
        uint256 periodStart,
        uint256 periodEnd
    ) external onlyRole(COMPLIANCE_OFFICER_ROLE) whenNotPaused {
        if (_reports[reportId].submittedAt != 0) revert ReportAlreadySubmitted();
        if (!_jurisdictions[jurisdictionId].active) revert JurisdictionNotActive();

        _reports[reportId] = RegulatoryReport({
            reportId: reportId,
            jurisdictionId: jurisdictionId,
            reportHash: reportHash,
            reportType: reportType,
            submittedAt: block.timestamp,
            submittedBy: msg.sender,
            periodStart: periodStart,
            periodEnd: periodEnd
        });

        unchecked { ++totalReports; }

        emit RegulatoryReportCommitted(reportId, jurisdictionId, reportHash, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Sanctions screening
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the sanctions list Merkle root for a jurisdiction.
     * @param jurisdictionId The jurisdiction
     * @param merkleRoot     New Merkle root of the sanctions list
     * @param listSize       Number of entries in the list
     * @param sourceHash     Hash identifying the list source
     */
    function updateSanctionsList(
        bytes32 jurisdictionId,
        bytes32 merkleRoot,
        uint256 listSize,
        bytes32 sourceHash
    ) external onlyRole(SANCTIONS_ORACLE_ROLE) whenNotPaused {
        if (!_jurisdictions[jurisdictionId].active) revert JurisdictionNotActive();

        _sanctionsLists[jurisdictionId] = SanctionsList({
            merkleRoot: merkleRoot,
            listSize: listSize,
            lastUpdated: block.timestamp,
            sourceHash: sourceHash
        });

        emit SanctionsListUpdated(jurisdictionId, merkleRoot, listSize, block.timestamp);
    }

    /**
     * @notice Screen a subject against a jurisdiction's sanctions list.
     * @dev Uses a Merkle proof for privacy: the full list is never on-chain.
     * @param subjectHash    Hash of the subject's identity
     * @param jurisdictionId Jurisdiction to screen against
     * @param merkleProof    Merkle proof (if subject IS on the list)
     * @return hit           True if the subject is sanctioned
     */
    function screenSanctions(
        bytes32 subjectHash,
        bytes32 jurisdictionId,
        bytes32[] calldata merkleProof
    ) external whenNotPaused returns (bool hit) {
        SanctionsList storage sl = _sanctionsLists[jurisdictionId];
        if (sl.lastUpdated == 0) revert JurisdictionNotActive();

        // Verify Merkle proof of inclusion in sanctions list
        hit = _verifyMerkleProof(subjectHash, sl.merkleRoot, merkleProof);

        emit SanctionsScreeningResult(subjectHash, jurisdictionId, hit, block.timestamp);

        if (hit) revert SanctionsHit();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Travel rule
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Record a travel rule compliant cross-border transfer.
     * @param originatorHash        Hash of originator identity
     * @param beneficiaryHash       Hash of beneficiary identity
     * @param originatorJurisdiction Originator's jurisdiction
     * @param beneficiaryJurisdiction Beneficiary's jurisdiction
     * @param amount                Transfer amount in wei
     * @param originatorVASPHash    Hash of originator VASP info
     * @param beneficiaryVASPHash   Hash of beneficiary VASP info
     * @return transferId           Unique transfer identifier
     */
    function recordTravelRuleTransfer(
        bytes32 originatorHash,
        bytes32 beneficiaryHash,
        bytes32 originatorJurisdiction,
        bytes32 beneficiaryJurisdiction,
        uint256 amount,
        bytes32 originatorVASPHash,
        bytes32 beneficiaryVASPHash
    ) external onlyRole(TRAVEL_RULE_ROLE) whenNotPaused nonReentrant returns (bytes32 transferId) {
        Jurisdiction storage origJ = _jurisdictions[originatorJurisdiction];
        Jurisdiction storage beneJ = _jurisdictions[beneficiaryJurisdiction];

        if (!origJ.active || !beneJ.active) revert InvalidJurisdictionPair();

        // Check if travel rule applies (amount threshold)
        bool travelRuleApplies = amount >= origJ.travelRuleThreshold ||
                                  amount >= beneJ.travelRuleThreshold;

        // Verify both parties have valid compliance attestations
        bool originatorCompliant = _isCompliant(originatorHash, originatorJurisdiction);
        bool beneficiaryCompliant = _isCompliant(beneficiaryHash, beneficiaryJurisdiction);

        bool compliant = !travelRuleApplies || (originatorCompliant && beneficiaryCompliant);

        transferId = keccak256(
            abi.encodePacked(
                originatorHash,
                beneficiaryHash,
                amount,
                block.timestamp,
                msg.sender
            )
        );

        _travelRuleTransfers[transferId] = TravelRuleRecord({
            transferId: transferId,
            originatorHash: originatorHash,
            beneficiaryHash: beneficiaryHash,
            originatorJurisdiction: originatorJurisdiction,
            beneficiaryJurisdiction: beneficiaryJurisdiction,
            amount: amount,
            originatorVASPHash: originatorVASPHash,
            beneficiaryVASPHash: beneficiaryVASPHash,
            timestamp: block.timestamp,
            compliant: compliant
        });

        unchecked { ++totalTravelRuleTransfers; }

        emit TravelRuleTransfer(
            transferId,
            originatorJurisdiction,
            beneficiaryJurisdiction,
            amount,
            compliant,
            block.timestamp
        );

        if (travelRuleApplies && !compliant) revert TravelRuleViolation();
    }

    // ──────────────────────────────────────────────────────────────────────
    // eIDAS 2.0 qualified credentials
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Mark a credential with eIDAS 2.0 assurance level.
     * @param credentialHash  The credential
     * @param level           eIDAS assurance level
     * @param trustedListHash Hash of the EU Trusted List entry for the issuer
     * @param issuerHash      Hash of the qualified trust service provider (QTSP)
     * @param validityPeriod  How long the marker is valid
     */
    function markEIDASCredential(
        bytes32 credentialHash,
        EIDASLevel level,
        bytes32 trustedListHash,
        bytes32 issuerHash,
        uint256 validityPeriod
    ) external onlyRole(EIDAS_AUTHORITY_ROLE) whenNotPaused {
        if (level == EIDASLevel.None) revert InvalidEIDASLevel();

        _eidasMarkers[credentialHash] = EIDASMarker({
            credentialHash: credentialHash,
            level: level,
            trustedListHash: trustedListHash,
            issuerHash: issuerHash,
            issuedAt: block.timestamp,
            expiresAt: validityPeriod > 0
                ? block.timestamp + validityPeriod
                : block.timestamp + DEFAULT_ATTESTATION_VALIDITY,
            active: true
        });

        emit EIDASCredentialMarked(credentialHash, level, trustedListHash, block.timestamp);
    }

    /**
     * @notice Check if a credential has a valid eIDAS marker at or above a given level.
     * @param credentialHash The credential
     * @param minimumLevel   Minimum eIDAS level required
     * @return valid         Whether the credential meets the eIDAS requirement
     * @return actualLevel   The credential's actual eIDAS level
     */
    function checkEIDAS(
        bytes32 credentialHash,
        EIDASLevel minimumLevel
    ) external view returns (bool valid, EIDASLevel actualLevel) {
        EIDASMarker storage marker = _eidasMarkers[credentialHash];
        actualLevel = marker.level;

        valid = marker.active &&
                uint8(marker.level) >= uint8(minimumLevel) &&
                (marker.expiresAt == 0 || block.timestamp <= marker.expiresAt);
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    function getJurisdiction(bytes32 jurisdictionId) external view returns (Jurisdiction memory) {
        return _jurisdictions[jurisdictionId];
    }

    function getRule(bytes32 jurisdictionId, bytes32 ruleId) external view returns (ComplianceRule memory) {
        return _rules[jurisdictionId][ruleId];
    }

    function getAttestation(bytes32 credentialHash, bytes32 jurisdictionId) external view returns (ComplianceAttestation memory) {
        return _attestations[credentialHash][jurisdictionId];
    }

    function getReport(bytes32 reportId) external view returns (RegulatoryReport memory) {
        return _reports[reportId];
    }

    function getSanctionsList(bytes32 jurisdictionId) external view returns (SanctionsList memory) {
        return _sanctionsLists[jurisdictionId];
    }

    function getTravelRuleTransfer(bytes32 transferId) external view returns (TravelRuleRecord memory) {
        return _travelRuleTransfers[transferId];
    }

    function getEIDASMarker(bytes32 credentialHash) external view returns (EIDASMarker memory) {
        return _eidasMarkers[credentialHash];
    }

    function getJurisdictionRuleIds(bytes32 jurisdictionId) external view returns (bytes32[] memory) {
        return _jurisdictionRuleIds[jurisdictionId];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ──────────────────────────────────────────────────────────────────────
    // Internal functions
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Check if a subject has a valid compliance attestation in a jurisdiction.
     */
    function _isCompliant(
        bytes32 subjectHash,
        bytes32 jurisdictionId
    ) internal view returns (bool) {
        ComplianceAttestation storage att = _attestations[subjectHash][jurisdictionId];
        if (att.status != ComplianceStatus.Compliant && att.status != ComplianceStatus.Exempt) {
            return false;
        }
        if (att.expiresAt != 0 && block.timestamp > att.expiresAt) return false;
        return true;
    }

    /**
     * @dev Verify a Merkle proof of inclusion.
     */
    function _verifyMerkleProof(
        bytes32 leaf,
        bytes32 root,
        bytes32[] calldata proof
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            if (computedHash <= proof[i]) {
                computedHash = keccak256(abi.encodePacked(computedHash, proof[i]));
            } else {
                computedHash = keccak256(abi.encodePacked(proof[i], computedHash));
            }
        }

        return computedHash == root;
    }
}
