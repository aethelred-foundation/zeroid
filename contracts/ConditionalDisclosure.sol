// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ConditionalDisclosure
 * @author ZeroID Cryptography Team
 * @notice On-chain authority for FATF travel-rule conditional disclosure. Pairs
 *         with ZeroID's off-chain key-split escrow (`src/lib/aethelred/disclosure.ts`):
 *         the encrypted disclosure payload and its Shamir-split key live off-chain;
 *         this contract anchors only the ciphertext `commitment` (no PII) and gates
 *         reconstitution behind a compliance-officer quorum acting under a warrant.
 *
 * @dev Flow:
 *      1. An issuer registers an escrow: `commitment` (sha256 of ciphertext) +
 *         an un-linkable `subjectNullifier`. No PII is ever stored.
 *      2. A compliance officer opens a disclosure request bound to a `warrantHash`.
 *         The quorum threshold is SNAPSHOTTED at request time (`requiredApprovals`)
 *         so a later change to `disclosureThreshold` cannot retroactively raise or
 *         lower the bar for an in-flight request (governance-race safety).
 *      3. Officers approve; once `requiredApprovals` distinct approvals are
 *         reached, disclosure is authorised (the off-chain quorum may then
 *         reconstitute the key from its shares).
 *      4. Erasure marks an escrow un-disclosable on-chain; combined with off-chain
 *         key-shred, the commitment becomes permanently un-linkable
 *         (GDPR / ADGM DPR-2021 right-to-be-forgotten on an immutable ledger).
 *         Erasure remains available even while paused.
 */
contract ConditionalDisclosure is AccessControl, Pausable {
    bytes32 public constant ESCROW_ISSUER_ROLE = keccak256("ESCROW_ISSUER_ROLE");
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Escrow {
        bytes32 commitment;
        bytes32 subjectNullifier;
        uint64 createdAt;
        bool erased;
        bool exists;
    }

    struct Disclosure {
        bytes32 warrantHash;
        uint256 approvals;
        uint256 requiredApprovals; // snapshot of the threshold at request time
        bool authorized;
        bool exists;
    }

    /// @notice Distinct officer approvals required to authorise a disclosure
    ///         (applies to NEW requests; in-flight requests keep their snapshot).
    uint256 public disclosureThreshold;

    mapping(bytes32 => Escrow) private _escrows;
    mapping(bytes32 => Disclosure) private _disclosures;
    mapping(bytes32 => mapping(address => bool)) private _approvedBy;

    event EscrowRegistered(bytes32 indexed escrowId, bytes32 commitment, bytes32 subjectNullifier);
    event DisclosureRequested(
        bytes32 indexed escrowId,
        bytes32 warrantHash,
        address indexed requester,
        uint256 requiredApprovals
    );
    event DisclosureApproved(bytes32 indexed escrowId, address indexed officer, uint256 approvals);
    event DisclosureAuthorized(bytes32 indexed escrowId);
    event EscrowErased(bytes32 indexed escrowId);
    event ThresholdUpdated(uint256 threshold);

    error InvalidThreshold();
    error EscrowAlreadyExists();
    error EscrowNotFound();
    error EscrowIsErased();
    error DisclosureAlreadyRequested();
    error DisclosureNotFound();
    error AlreadyApproved();
    error AlreadyAuthorized();
    error Unauthorized();

    constructor(address admin, uint256 threshold_) {
        if (admin == address(0)) revert Unauthorized();
        if (threshold_ == 0) revert InvalidThreshold();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        disclosureThreshold = threshold_;
        emit ThresholdUpdated(threshold_);
    }

    /// @notice Update the disclosure quorum threshold for FUTURE requests.
    function setDisclosureThreshold(uint256 threshold_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (threshold_ == 0) revert InvalidThreshold();
        disclosureThreshold = threshold_;
        emit ThresholdUpdated(threshold_);
    }

    /// @notice Anchor an escrow commitment (zero PII).
    function registerEscrow(bytes32 escrowId, bytes32 commitment, bytes32 subjectNullifier)
        external
        whenNotPaused
        onlyRole(ESCROW_ISSUER_ROLE)
    {
        if (_escrows[escrowId].exists) revert EscrowAlreadyExists();
        _escrows[escrowId] = Escrow({
            commitment: commitment,
            subjectNullifier: subjectNullifier,
            createdAt: uint64(block.timestamp),
            erased: false,
            exists: true
        });
        emit EscrowRegistered(escrowId, commitment, subjectNullifier);
    }

    /// @notice Open a warrant-bound disclosure request; snapshots the threshold.
    function requestDisclosure(bytes32 escrowId, bytes32 warrantHash)
        external
        whenNotPaused
        onlyRole(COMPLIANCE_OFFICER_ROLE)
    {
        Escrow storage e = _escrows[escrowId];
        if (!e.exists) revert EscrowNotFound();
        if (e.erased) revert EscrowIsErased();
        if (_disclosures[escrowId].exists) revert DisclosureAlreadyRequested();
        uint256 required = disclosureThreshold;
        _disclosures[escrowId] = Disclosure({
            warrantHash: warrantHash,
            approvals: 0,
            requiredApprovals: required,
            authorized: false,
            exists: true
        });
        emit DisclosureRequested(escrowId, warrantHash, msg.sender, required);
    }

    /// @notice Approve a pending disclosure; authorises it once its snapshot quorum is met.
    function approveDisclosure(bytes32 escrowId)
        external
        whenNotPaused
        onlyRole(COMPLIANCE_OFFICER_ROLE)
    {
        Escrow storage e = _escrows[escrowId];
        if (!e.exists) revert EscrowNotFound();
        if (e.erased) revert EscrowIsErased();
        Disclosure storage d = _disclosures[escrowId];
        if (!d.exists) revert DisclosureNotFound();
        if (d.authorized) revert AlreadyAuthorized();
        if (_approvedBy[escrowId][msg.sender]) revert AlreadyApproved();

        _approvedBy[escrowId][msg.sender] = true;
        d.approvals += 1;
        emit DisclosureApproved(escrowId, msg.sender, d.approvals);

        if (d.approvals >= d.requiredApprovals) {
            d.authorized = true;
            emit DisclosureAuthorized(escrowId);
        }
    }

    /// @notice Erase an escrow (issuer on the subject's behalf, or admin). Allowed while paused.
    function eraseEscrow(bytes32 escrowId) external {
        if (!hasRole(ESCROW_ISSUER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        Escrow storage e = _escrows[escrowId];
        if (!e.exists) revert EscrowNotFound();
        if (e.erased) revert EscrowIsErased();
        e.erased = true;
        emit EscrowErased(escrowId);
    }

    /// @notice Halt new escrows/requests/approvals during an incident (erasure stays open).
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume normal operation.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Whether a disclosure has reached its authorising quorum.
    function isDisclosureAuthorized(bytes32 escrowId) external view returns (bool) {
        return _disclosures[escrowId].authorized;
    }

    /// @notice Read an escrow's anchored commitment and status.
    function getEscrow(bytes32 escrowId)
        external
        view
        returns (bytes32 commitment, bytes32 subjectNullifier, uint64 createdAt, bool erased)
    {
        Escrow storage e = _escrows[escrowId];
        if (!e.exists) revert EscrowNotFound();
        return (e.commitment, e.subjectNullifier, e.createdAt, e.erased);
    }

    /// @notice Read a disclosure request's progress and snapshot quorum.
    function getDisclosure(bytes32 escrowId)
        external
        view
        returns (bytes32 warrantHash, uint256 approvals, uint256 requiredApprovals, bool authorized)
    {
        Disclosure storage d = _disclosures[escrowId];
        if (!d.exists) revert DisclosureNotFound();
        return (d.warrantHash, d.approvals, d.requiredApprovals, d.authorized);
    }
}
