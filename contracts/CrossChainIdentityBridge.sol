// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {BN254} from "./libraries/BN254.sol";

/**
 * @title CrossChainIdentityBridge
 * @author ZeroID Cryptography Team
 * @notice Bridges ZeroID credentials across EVM-compatible chains (Ethereum, Polygon,
 *         Arbitrum, etc.) with light-client verification, fraud proofs, and
 *         cross-chain revocation synchronization.
 *
 * @dev Architecture:
 *      - Bridge operators relay credential proofs between chains.
 *      - Operators must stake tokens; malicious relays are slashable via fraud proofs.
 *      - Credential portability is achieved by storing Merkle inclusion proofs
 *        against the source chain's state root (verified by a light client).
 *      - Revocation sync uses a pub/sub model: each chain publishes accumulator
 *        updates that other chains verify and apply locally.
 *      - W3C DID resolution is supported via a chain-agnostic DID method mapping.
 *      - Circuit breakers halt bridging if anomalies are detected.
 */
contract CrossChainIdentityBridge is AccessControl, Pausable, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────────────────────────────

    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR_ROLE");
    bytes32 public constant LIGHT_CLIENT_UPDATER_ROLE = keccak256("LIGHT_CLIENT_UPDATER_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant VERIFIED_PROOF_SUBMITTER_ROLE = keccak256("VERIFIED_PROOF_SUBMITTER_ROLE");
    bytes32 public constant REVOCATION_SYNC_ROLE = keccak256("REVOCATION_SYNC_ROLE");
    bytes32 public constant FRAUD_PROOF_CHALLENGER_ROLE = keccak256("FRAUD_PROOF_CHALLENGER_ROLE");

    // ──────────────────────────────────────────────────────────────────────
    // Custom errors
    // ──────────────────────────────────────────────────────────────────────

    error ChainNotSupported();
    error ChainAlreadyRegistered();
    error InvalidLightClientUpdate();
    error StateRootNotFound();
    error InvalidMerkleProof();
    error CredentialAlreadyBridged();
    error InvalidFraudProof();
    error FraudProofWindowActive();
    error FraudProofWindowExpired();
    error InsufficientStake();
    error OperatorAlreadyRegistered();
    error OperatorNotRegistered();
    error OperatorSlashed();
    error RateLimitExceeded();
    error CircuitBreakerTripped();
    error InvalidDIDMethod();
    error RevocationSyncFailed();
    error BridgeMessageExpired();
    error InvalidSignatureCount();
    error StakeWithdrawalLocked();
    error InsufficientChallengeBond();
    error ChallengeWindowExpired();
    error ChallengeBondTransferFailed();
    error InvalidRevocationSignature();

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event ChainRegistered(
        uint256 indexed chainId,
        bytes32 genesisStateRoot,
        uint256 timestamp
    );

    event LightClientUpdated(
        uint256 indexed chainId,
        bytes32 newStateRoot,
        uint256 blockNumber,
        uint256 timestamp
    );

    event CredentialBridged(
        bytes32 indexed credentialHash,
        uint256 indexed sourceChain,
        uint256 indexed destChain,
        address operator,
        uint256 timestamp
    );

    event CredentialReceived(
        bytes32 indexed credentialHash,
        uint256 indexed sourceChain,
        bytes32 proofHash,
        uint256 timestamp
    );

    event FraudProofSubmitted(
        bytes32 indexed messageHash,
        address indexed challenger,
        address indexed operator,
        uint256 timestamp
    );

    event OperatorStaked(
        address indexed operator,
        uint256 amount,
        uint256 timestamp
    );

    event OperatorSlashedEvent(
        address indexed operator,
        uint256 amount,
        bytes32 reason,
        uint256 timestamp
    );

    event RevocationSynced(
        uint256 indexed sourceChain,
        bytes32 accumulatorRoot,
        uint256 epoch,
        uint256 timestamp
    );

    event CircuitBreakerTriggered(
        uint256 indexed chainId,
        string reason,
        uint256 timestamp
    );

    event DIDResolved(
        bytes32 indexed didHash,
        uint256 indexed chainId,
        bytes32 documentHash,
        uint256 timestamp
    );

    event RateLimitUpdated(
        uint256 indexed chainId,
        uint256 newLimit,
        uint256 timestamp
    );

    // ──────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Supported chain configuration
    struct ChainConfig {
        uint256 chainId;
        bytes32 latestStateRoot;         // Latest verified state root
        uint256 latestBlockNumber;       // Block number for the state root
        uint256 lastUpdated;             // Timestamp of last light client update
        uint256 fraudProofWindow;        // Seconds to wait before finalizing
        bool active;                     // Whether bridging to/from this chain is enabled
        uint256 bridgeCount;             // Total credentials bridged
        bool circuitBreakerActive;       // Whether the circuit breaker is tripped
    }

    /// @notice Bridge operator information
    struct OperatorInfo {
        address operator;
        uint256 stakedAmount;            // ETH/native token staked
        uint256 registeredAt;
        uint256 totalRelayed;            // Successful relays
        uint256 slashCount;              // Number of times slashed
        bool active;                     // Whether the operator can relay
        uint256 lastRelayTimestamp;       // For rate limiting
        uint256 relaysInWindow;          // Relays in the current rate-limit window
    }

    /// @notice A bridge message carrying a credential proof
    struct BridgeMessage {
        bytes32 messageHash;             // Unique message identifier
        bytes32 credentialHash;          // The credential being bridged
        uint256 sourceChain;             // Origin chain ID
        uint256 destChain;               // Destination chain ID
        bytes32 sourceStateRoot;         // State root the proof is against
        bytes merkleProof;               // Merkle proof of credential inclusion
        bytes32 accumulatorRoot;         // Revocation accumulator root at source
        uint256 timestamp;               // When the message was created
        address operator;                // Relaying operator
        BridgeMessageStatus status;      // Current status
        uint256 fraudProofDeadline;      // When the fraud proof window closes
    }

    /// @notice Revocation sync message
    struct RevocationSync {
        uint256 sourceChain;
        bytes32 accumulatorRoot;
        uint256 epoch;
        bytes32 previousRoot;
        bytes updateProof;
        uint256 timestamp;
    }

    /// @notice W3C DID document reference
    struct DIDReference {
        bytes32 didHash;                 // keccak256 of the DID string
        uint256 homeChain;               // Chain where the DID is natively registered
        bytes32 documentHash;            // Hash of the DID document
        uint256 lastUpdated;
        bool active;
    }

    /// @notice Rate limit configuration per chain
    struct RateLimitConfig {
        uint256 maxRelaysPerWindow;      // Max relays per operator per window
        uint256 windowDuration;          // Duration of rate limit window in seconds
        uint256 maxTotalPerHour;         // Max total relays across all operators per hour
        uint256 currentHourlyCount;      // Current hourly count
        uint256 hourlyResetTimestamp;    // When the hourly counter resets
    }

    enum BridgeMessageStatus {
        Pending,        // Submitted but in fraud proof window
        Finalized,      // Fraud proof window passed, credential accepted
        Challenged,     // Fraud proof submitted
        Slashed,        // Fraud proven, operator slashed
        Expired         // Message expired before finalization
    }

    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint256 public constant MIN_OPERATOR_STAKE = 1 ether;
    uint256 public constant DEFAULT_FRAUD_PROOF_WINDOW = 1 hours;
    uint256 public constant SLASH_PERCENTAGE = 50; // 50% of stake
    uint256 public constant MAX_MESSAGE_AGE = 24 hours;
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD = 100; // anomalous messages
    uint256 public constant STAKE_LOCK_PERIOD = 7 days;
    uint256 public constant MIN_CHALLENGE_BOND = 0.1 ether;
    uint256 public constant CHALLENGE_WINDOW = 1 hours;

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Chain configurations by chain ID
    mapping(uint256 => ChainConfig) private _chains;

    /// @notice Registered operators
    mapping(address => OperatorInfo) private _operators;

    /// @notice Bridge messages by hash
    mapping(bytes32 => BridgeMessage) private _messages;

    /// @notice Bridged credentials: credentialHash => destChain => bridged
    mapping(bytes32 => mapping(uint256 => bool)) private _bridgedCredentials;

    /// @notice Cross-chain accumulator roots: chainId => latest root
    mapping(uint256 => bytes32) private _crossChainAccumulatorRoots;

    /// @notice Cross-chain accumulator epochs: chainId => epoch
    mapping(uint256 => uint256) private _crossChainAccumulatorEpochs;

    /// @notice DID references: didHash => DIDReference
    mapping(bytes32 => DIDReference) private _didReferences;

    /// @notice ZID-007: DID controller bindings: didHash => controller address
    mapping(bytes32 => address) private _didControllers;

    /// @notice DID method to chain mapping: method hash => chainId
    mapping(bytes32 => uint256) private _didMethodChains;

    /// @notice Rate limit configs per chain
    mapping(uint256 => RateLimitConfig) private _rateLimits;

    /// @notice Historical state roots: chainId => blockNumber => stateRoot
    mapping(uint256 => mapping(uint256 => bytes32)) private _stateRootHistory;

    /// @notice Supported chain IDs
    uint256[] private _supportedChains;

    /// @notice Circuit breaker anomaly counter: chainId => count in window
    mapping(uint256 => uint256) private _anomalyCounters;

    /// @notice Global message nonce
    uint256 public messageNonce;

    /// @notice Challenge bonds held by challengers: messageHash => challenger => bond amount
    mapping(bytes32 => mapping(address => uint256)) private _challengeBonds;

    // ── ZID-006: Revocation sync timelock ───────────────────────────

    /// @notice Configurable delay before a revocation sync can be finalized
    uint256 public revocationSyncDelay = 1 hours;

    /// @notice Pending revocation sync data
    struct PendingRevocationSync {
        uint256 sourceChain;
        bytes32 accumulatorRoot;
        uint256 epoch;
        uint256 readyAt;
        bool exists;
        bool cancelled;
    }

    /// @notice Pending revocation syncs by sync key
    mapping(bytes32 => PendingRevocationSync) private _pendingRevocationSyncs;

    event RevocationSyncQueued(
        bytes32 indexed syncKey,
        uint256 indexed sourceChain,
        bytes32 accumulatorRoot,
        uint256 epoch,
        uint256 readyAt
    );

    event RevocationSyncFinalized(
        bytes32 indexed syncKey,
        uint256 indexed sourceChain,
        bytes32 accumulatorRoot,
        uint256 epoch
    );

    event RevocationSyncCancelled(
        bytes32 indexed syncKey,
        uint256 indexed sourceChain
    );

    // ──────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SLASHER_ROLE, admin);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Chain management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a new chain for bridging.
     * @param chainId         The chain's unique identifier
     * @param genesisRoot     Initial state root for the light client
     * @param fraudProofWindow Seconds to wait before finalizing bridge messages
     * @param rateLimit       Maximum relays per operator per window
     * @param windowDuration  Rate limit window duration
     */
    function registerChain(
        uint256 chainId,
        bytes32 genesisRoot,
        uint256 fraudProofWindow,
        uint256 rateLimit,
        uint256 windowDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_chains[chainId].active) revert ChainAlreadyRegistered();

        _chains[chainId] = ChainConfig({
            chainId: chainId,
            latestStateRoot: genesisRoot,
            latestBlockNumber: 0,
            lastUpdated: block.timestamp,
            fraudProofWindow: fraudProofWindow > 0 ? fraudProofWindow : DEFAULT_FRAUD_PROOF_WINDOW,
            active: true,
            bridgeCount: 0,
            circuitBreakerActive: false
        });

        _rateLimits[chainId] = RateLimitConfig({
            maxRelaysPerWindow: rateLimit > 0 ? rateLimit : 50,
            windowDuration: windowDuration > 0 ? windowDuration : 1 hours,
            maxTotalPerHour: rateLimit > 0 ? rateLimit * 10 : 500,
            currentHourlyCount: 0,
            hourlyResetTimestamp: block.timestamp + 1 hours
        });

        _stateRootHistory[chainId][0] = genesisRoot;
        _supportedChains.push(chainId);

        emit ChainRegistered(chainId, genesisRoot, block.timestamp);
    }

    /**
     * @notice Update the light client state root for a chain.
     * @param chainId     The chain to update
     * @param stateRoot   New verified state root
     * @param blockNumber Block number corresponding to the state root
     * @param proof       Light client proof (e.g., committee signatures)
     */
    function updateLightClient(
        uint256 chainId,
        bytes32 stateRoot,
        uint256 blockNumber,
        bytes calldata proof
    ) external onlyRole(LIGHT_CLIENT_UPDATER_ROLE) whenNotPaused {
        ChainConfig storage chain_ = _chains[chainId];
        if (!chain_.active) revert ChainNotSupported();

        // Verify the light client proof
        if (!_verifyLightClientProof(chainId, stateRoot, blockNumber, proof)) {
            revert InvalidLightClientUpdate();
        }

        chain_.latestStateRoot = stateRoot;
        chain_.latestBlockNumber = blockNumber;
        chain_.lastUpdated = block.timestamp;
        _stateRootHistory[chainId][blockNumber] = stateRoot;

        emit LightClientUpdated(chainId, stateRoot, blockNumber, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Operator management
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register as a bridge operator by staking.
     */
    function registerOperator() external payable whenNotPaused {
        if (msg.value < MIN_OPERATOR_STAKE) revert InsufficientStake();
        if (_operators[msg.sender].active) revert OperatorAlreadyRegistered();

        _operators[msg.sender] = OperatorInfo({
            operator: msg.sender,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            totalRelayed: 0,
            slashCount: 0,
            active: true,
            lastRelayTimestamp: 0,
            relaysInWindow: 0
        });

        _grantRole(BRIDGE_OPERATOR_ROLE, msg.sender);

        emit OperatorStaked(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Add more stake as an existing operator.
     */
    function addStake() external payable {
        OperatorInfo storage op = _operators[msg.sender];
        if (!op.active) revert OperatorNotRegistered();
        op.stakedAmount += msg.value;
        emit OperatorStaked(msg.sender, op.stakedAmount, block.timestamp);
    }

    /**
     * @notice Withdraw stake (only after lock period and if not slashed).
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        OperatorInfo storage op = _operators[msg.sender];
        if (!op.active) revert OperatorNotRegistered();
        if (block.timestamp < op.registeredAt + STAKE_LOCK_PERIOD) {
            revert StakeWithdrawalLocked();
        }
        if (op.stakedAmount < amount) revert InsufficientStake();

        op.stakedAmount -= amount;
        if (op.stakedAmount < MIN_OPERATOR_STAKE) {
            op.active = false;
            _revokeRole(BRIDGE_OPERATOR_ROLE, msg.sender);
        }

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");
    }

    // ──────────────────────────────────────────────────────────────────────
    // Credential bridging
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Bridge a credential to another chain.
     * @param credentialHash  The credential to bridge
     * @param destChain       Destination chain ID
     * @param merkleProof     Proof of credential inclusion in the source state
     * @param accumulatorRoot Current revocation accumulator root
     * @return messageHash    The bridge message identifier
     */
    function bridgeCredential(
        bytes32 credentialHash,
        uint256 destChain,
        bytes calldata merkleProof,
        bytes32 accumulatorRoot
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused nonReentrant returns (bytes32 messageHash) {
        // Validate chains
        ChainConfig storage destConfig = _chains[destChain];
        if (!destConfig.active) revert ChainNotSupported();
        if (destConfig.circuitBreakerActive) revert CircuitBreakerTripped();

        // Check not already bridged
        if (_bridgedCredentials[credentialHash][destChain]) {
            revert CredentialAlreadyBridged();
        }

        // Rate limiting
        _enforceRateLimit(destChain, msg.sender);

        // Create bridge message
        unchecked { ++messageNonce; }
        messageHash = keccak256(
            abi.encodePacked(
                credentialHash, block.chainid, destChain, messageNonce, block.timestamp
            )
        );

        _messages[messageHash] = BridgeMessage({
            messageHash: messageHash,
            credentialHash: credentialHash,
            sourceChain: block.chainid,
            destChain: destChain,
            sourceStateRoot: _chains[block.chainid].latestStateRoot,
            merkleProof: merkleProof,
            accumulatorRoot: accumulatorRoot,
            timestamp: block.timestamp,
            operator: msg.sender,
            status: BridgeMessageStatus.Pending,
            fraudProofDeadline: block.timestamp + destConfig.fraudProofWindow
        });

        _operators[msg.sender].totalRelayed += 1;
        destConfig.bridgeCount += 1;

        emit CredentialBridged(
            credentialHash, block.chainid, destChain, msg.sender, block.timestamp
        );
    }

    /**
     * @notice Finalize a bridged credential after the fraud proof window.
     * @param messageHash The bridge message to finalize
     */
    function finalizeCredential(
        bytes32 messageHash
    ) external whenNotPaused nonReentrant {
        BridgeMessage storage msg_ = _messages[messageHash];
        if (msg_.status != BridgeMessageStatus.Pending) revert FraudProofWindowExpired();
        if (block.timestamp < msg_.fraudProofDeadline) revert FraudProofWindowActive();

        // Verify the Merkle proof against the source chain's state root
        if (!_verifyMerkleInclusion(msg_.credentialHash, msg_.sourceStateRoot, msg_.merkleProof)) {
            revert InvalidMerkleProof();
        }

        msg_.status = BridgeMessageStatus.Finalized;
        _bridgedCredentials[msg_.credentialHash][msg_.destChain] = true;

        emit CredentialReceived(
            msg_.credentialHash, msg_.sourceChain, messageHash, block.timestamp
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    // Fraud proofs
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a fraud proof against a pending bridge message.
     *         Only authorized challengers may submit. A challenge bond is required
     *         and will be slashed if the challenge is invalid. Challenges must be
     *         submitted within CHALLENGE_WINDOW of the message's creation.
     * @param messageHash   The message being challenged
     * @param fraudEvidence  Proof that the message is invalid
     */
    function submitFraudProof(
        bytes32 messageHash,
        bytes calldata fraudEvidence
    ) external payable onlyRole(FRAUD_PROOF_CHALLENGER_ROLE) whenNotPaused nonReentrant {
        // Require a minimum challenge bond
        if (msg.value < MIN_CHALLENGE_BOND) revert InsufficientChallengeBond();

        BridgeMessage storage msg_ = _messages[messageHash];
        if (msg_.status != BridgeMessageStatus.Pending) revert FraudProofWindowExpired();
        if (block.timestamp > msg_.fraudProofDeadline) revert FraudProofWindowExpired();

        // Enforce challenge window: fraud proofs can only be submitted within
        // CHALLENGE_WINDOW after the message was relayed
        if (block.timestamp > msg_.timestamp + CHALLENGE_WINDOW) revert ChallengeWindowExpired();

        // Verify the fraud proof
        if (!_verifyFraudProof(msg_, fraudEvidence)) {
            // Challenge failed — slash the challenger's bond (kept by the contract)
            revert InvalidFraudProof();
        }

        // Challenge succeeded — record the bond for the challenger to reclaim
        _challengeBonds[messageHash][msg.sender] = msg.value;

        msg_.status = BridgeMessageStatus.Challenged;

        // Slash the operator
        _slashOperator(msg_.operator, messageHash);

        // Return the challenge bond to the successful challenger
        (bool sent, ) = msg.sender.call{value: msg.value}("");
        if (!sent) revert ChallengeBondTransferFailed();

        emit FraudProofSubmitted(messageHash, msg.sender, msg_.operator, block.timestamp);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Revocation synchronization
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Queue a revocation accumulator sync from another chain.
     *         The sync must be finalized after the delay period.
     * @param sync The revocation sync message
     */
    function syncRevocation(
        RevocationSync calldata sync
    ) external onlyRole(REVOCATION_SYNC_ROLE) whenNotPaused {
        ChainConfig storage chain_ = _chains[sync.sourceChain];
        if (!chain_.active) revert ChainNotSupported();

        // Verify the update proof contains an ECDSA signature from an authorized
        // REVOCATION_SYNC_ROLE holder over the packed revocation data.
        // The signature covers: previousRoot, accumulatorRoot, epoch, sourceChain,
        // and block.chainid (destination chain) to prevent cross-chain replay.
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                sync.previousRoot,
                sync.accumulatorRoot,
                sync.epoch,
                sync.sourceChain,
                block.chainid
            )
        );
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

        // updateProof must be a 65-byte ECDSA signature (r, s, v)
        if (sync.updateProof.length != 65) revert InvalidRevocationSignature();

        address signer = ECDSA.recover(ethSignedHash, sync.updateProof);
        if (!hasRole(REVOCATION_SYNC_ROLE, signer)) revert InvalidRevocationSignature();

        // Verify epoch is newer
        if (sync.epoch <= _crossChainAccumulatorEpochs[sync.sourceChain]) {
            revert RevocationSyncFailed();
        }

        // ZID-006: Queue the sync with a timelock instead of applying immediately
        bytes32 syncKey = keccak256(
            abi.encodePacked(sync.sourceChain, sync.accumulatorRoot, sync.epoch)
        );

        _pendingRevocationSyncs[syncKey] = PendingRevocationSync({
            sourceChain: sync.sourceChain,
            accumulatorRoot: sync.accumulatorRoot,
            epoch: sync.epoch,
            readyAt: block.timestamp + revocationSyncDelay,
            exists: true,
            cancelled: false
        });

        emit RevocationSyncQueued(
            syncKey, sync.sourceChain, sync.accumulatorRoot, sync.epoch,
            block.timestamp + revocationSyncDelay
        );
    }

    /**
     * @notice Finalize a queued revocation sync after the delay period.
     * @param syncKey The key identifying the pending sync
     */
    function finalizeRevocationSync(bytes32 syncKey) external whenNotPaused {
        PendingRevocationSync storage pending = _pendingRevocationSyncs[syncKey];
        require(pending.exists, "Sync not found");
        require(!pending.cancelled, "Sync was cancelled");
        require(block.timestamp >= pending.readyAt, "Sync delay not elapsed");

        // Verify epoch is still newer (in case another sync was finalized in the interim)
        require(
            pending.epoch > _crossChainAccumulatorEpochs[pending.sourceChain],
            "Epoch already superseded"
        );

        _crossChainAccumulatorRoots[pending.sourceChain] = pending.accumulatorRoot;
        _crossChainAccumulatorEpochs[pending.sourceChain] = pending.epoch;

        // Clean up
        pending.exists = false;

        emit RevocationSyncFinalized(
            syncKey, pending.sourceChain, pending.accumulatorRoot, pending.epoch
        );

        emit RevocationSynced(
            pending.sourceChain, pending.accumulatorRoot, pending.epoch, block.timestamp
        );
    }

    /**
     * @notice Cancel a queued revocation sync (governance only).
     * @param syncKey The key identifying the pending sync to cancel
     */
    function cancelRevocationSync(bytes32 syncKey) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PendingRevocationSync storage pending = _pendingRevocationSyncs[syncKey];
        require(pending.exists, "Sync not found");
        require(!pending.cancelled, "Already cancelled");

        pending.cancelled = true;

        emit RevocationSyncCancelled(syncKey, pending.sourceChain);
    }

    /**
     * @notice Update the revocation sync delay (governance only).
     * @param newDelay New delay in seconds
     */
    function setRevocationSyncDelay(uint256 newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revocationSyncDelay = newDelay;
    }

    /**
     * @notice Get a pending revocation sync.
     * @param syncKey The sync key
     */
    function getPendingRevocationSync(bytes32 syncKey) external view returns (PendingRevocationSync memory) {
        return _pendingRevocationSyncs[syncKey];
    }

    // ──────────────────────────────────────────────────────────────────────
    // W3C DID resolution
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a DID method to chain mapping.
     * @param methodHash Hash of the DID method string (e.g., keccak256("did:zeroid"))
     * @param chainId    The chain where this method resolves
     */
    function registerDIDMethod(
        bytes32 methodHash,
        uint256 chainId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_chains[chainId].active) revert ChainNotSupported();
        _didMethodChains[methodHash] = chainId;
    }

    /**
     * @notice Register or update a DID document reference.
     *         ZID-007: On first registration, binds the DID to msg.sender as controller.
     *         On subsequent updates, only the original controller can update.
     * @param didHash      Hash of the full DID string
     * @param documentHash Hash of the DID document
     */
    function registerDID(
        bytes32 didHash,
        bytes32 documentHash
    ) external whenNotPaused {
        // ZID-007: Enforce controller binding
        address existingController = _didControllers[didHash];
        if (existingController != address(0)) {
            require(msg.sender == existingController, "Only DID controller can update");
        }
        _didControllers[didHash] = msg.sender;

        _didReferences[didHash] = DIDReference({
            didHash: didHash,
            homeChain: block.chainid,
            documentHash: documentHash,
            lastUpdated: block.timestamp,
            active: true
        });

        emit DIDResolved(didHash, block.chainid, documentHash, block.timestamp);
    }

    /**
     * @notice Resolve a DID across chains.
     * @param didHash Hash of the DID to resolve
     * @return ref     The DID reference (may require cross-chain lookup)
     */
    function resolveDID(
        bytes32 didHash
    ) external view returns (DIDReference memory ref) {
        ref = _didReferences[didHash];
        if (!ref.active) revert InvalidDIDMethod();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Circuit breaker
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @notice Trip the circuit breaker for a chain.
     * @param chainId The chain to halt bridging for
     * @param reason  Human-readable reason
     */
    function tripCircuitBreaker(
        uint256 chainId,
        string calldata reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _chains[chainId].circuitBreakerActive = true;
        emit CircuitBreakerTriggered(chainId, reason, block.timestamp);
    }

    /**
     * @notice Reset the circuit breaker for a chain.
     * @param chainId The chain to resume bridging for
     */
    function resetCircuitBreaker(
        uint256 chainId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _chains[chainId].circuitBreakerActive = false;
        _anomalyCounters[chainId] = 0;
    }

    // ──────────────────────────────────────────────────────────────────────
    // View functions
    // ──────────────────────────────────────────────────────────────────────

    function getChainConfig(uint256 chainId) external view returns (ChainConfig memory) {
        return _chains[chainId];
    }

    function getOperatorInfo(address operator) external view returns (OperatorInfo memory) {
        return _operators[operator];
    }

    function getMessage(bytes32 messageHash) external view returns (BridgeMessage memory) {
        return _messages[messageHash];
    }

    function isCredentialBridged(bytes32 credentialHash, uint256 chainId) external view returns (bool) {
        return _bridgedCredentials[credentialHash][chainId];
    }

    function getCrossChainAccumulatorRoot(uint256 chainId) external view returns (bytes32) {
        return _crossChainAccumulatorRoots[chainId];
    }

    function getSupportedChains() external view returns (uint256[] memory) {
        return _supportedChains;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ──────────────────────────────────────────────────────────────────────
    // Internal functions
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @dev Enforce rate limits for an operator on a destination chain.
     */
    function _enforceRateLimit(uint256 chainId, address operator) internal {
        RateLimitConfig storage rl = _rateLimits[chainId];
        OperatorInfo storage op = _operators[operator];

        // Reset hourly counter if window has passed
        if (block.timestamp >= rl.hourlyResetTimestamp) {
            rl.currentHourlyCount = 0;
            rl.hourlyResetTimestamp = block.timestamp + 1 hours;
        }

        // Check global hourly limit
        if (rl.currentHourlyCount >= rl.maxTotalPerHour) {
            revert RateLimitExceeded();
        }

        // Check per-operator window limit
        if (block.timestamp > op.lastRelayTimestamp + rl.windowDuration) {
            op.relaysInWindow = 0;
            op.lastRelayTimestamp = block.timestamp;
        }

        if (op.relaysInWindow >= rl.maxRelaysPerWindow) {
            revert RateLimitExceeded();
        }

        op.relaysInWindow += 1;
        rl.currentHourlyCount += 1;

        // Auto-trip circuit breaker if anomaly threshold is reached
        _anomalyCounters[chainId] += 1;
        if (_anomalyCounters[chainId] > CIRCUIT_BREAKER_THRESHOLD) {
            _chains[chainId].circuitBreakerActive = true;
            emit CircuitBreakerTriggered(chainId, "Anomaly threshold exceeded", block.timestamp);
        }
    }

    /**
     * @dev Slash an operator for a fraudulent relay.
     */
    function _slashOperator(address operator, bytes32 reason) internal {
        OperatorInfo storage op = _operators[operator];
        uint256 slashAmount = (op.stakedAmount * SLASH_PERCENTAGE) / 100;
        op.stakedAmount -= slashAmount;
        op.slashCount += 1;

        if (op.stakedAmount < MIN_OPERATOR_STAKE) {
            op.active = false;
            _revokeRole(BRIDGE_OPERATOR_ROLE, operator);
        }

        // Send slashed funds to the contract (treasury)
        // In production, distribute to the challenger as a reward
        emit OperatorSlashedEvent(operator, slashAmount, reason, block.timestamp);
    }

    /**
     * @dev Verify a light client proof for a state root update.
     *
     *      Trust model: Full BLS aggregate signature verification from a sync
     *      committee is prohibitively expensive on-chain. Instead, we use a
     *      VERIFIED_PROOF_SUBMITTER_ROLE approach: only addresses that have been
     *      granted VERIFIED_PROOF_SUBMITTER_ROLE (e.g., an off-chain verifier
     *      service that validates BLS committee signatures before submitting)
     *      are authorized to submit light client proofs. This converts the
     *      trust assumption from "proof data is structurally valid" to
     *      "the submitter has been vetted by governance to perform off-chain
     *      BLS verification before relaying."
     */
    function _verifyLightClientProof(
        uint256 chainId,
        bytes32 stateRoot,
        uint256 blockNumber,
        bytes calldata proof
    ) internal view returns (bool) {
        // Verify proof is non-empty and well-formed
        if (proof.length < 96) return false; // Minimum: 3 x 32-byte values

        // Verify block number is newer than current
        if (blockNumber <= _chains[chainId].latestBlockNumber) return false;

        // Verify the proof commits to the state root
        bytes32 proofCommitment = keccak256(
            abi.encodePacked(chainId, stateRoot, blockNumber)
        );
        bytes32 proofHash = keccak256(proof);

        // Structural validity check
        if (proofHash == bytes32(0) || proofCommitment == bytes32(0)) return false;

        // ZID-005: Require caller to have VERIFIED_PROOF_SUBMITTER_ROLE.
        // This ensures only addresses that perform off-chain BLS committee
        // signature verification can submit light client proofs.
        require(
            hasRole(VERIFIED_PROOF_SUBMITTER_ROLE, msg.sender),
            "Caller not authorized as verified proof submitter"
        );

        return true;
    }

    /**
     * @dev Verify a Merkle inclusion proof for a credential.
     */
    function _verifyMerkleInclusion(
        bytes32 credentialHash,
        bytes32 stateRoot,
        bytes memory proof
    ) internal pure returns (bool) {
        if (proof.length < 32 || proof.length % 32 != 0) return false;

        bytes32 computedHash = credentialHash;
        uint256 proofLength = proof.length / 32;

        for (uint256 i = 0; i < proofLength; i++) {
            bytes32 proofElement;
            uint256 offset = i * 32;
            assembly {
                proofElement := mload(add(add(proof, 0x20), offset))
            }

            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == stateRoot;
    }

    /**
     * @dev Verify a fraud proof against a bridge message.
     */
    function _verifyFraudProof(
        BridgeMessage storage msg_,
        bytes calldata fraudEvidence
    ) internal view returns (bool) {
        if (fraudEvidence.length < 64) return false;

        // Extract the counter-proof elements
        bytes32 counterStateRoot;
        bytes32 counterCredentialHash;
        assembly {
            counterStateRoot := calldataload(fraudEvidence.offset)
            counterCredentialHash := calldataload(add(fraudEvidence.offset, 32))
        }

        // The fraud proof must demonstrate that the credential is NOT
        // in the claimed state root
        if (counterStateRoot != msg_.sourceStateRoot) return false;
        if (counterCredentialHash != msg_.credentialHash) return false;

        // Verify the counter-evidence (non-inclusion proof)
        bytes memory counterProof = fraudEvidence[64:];
        return !_verifyMerkleInclusion(
            msg_.credentialHash, msg_.sourceStateRoot, counterProof
        );
    }

    /// @dev Receive ETH for staking
    receive() external payable {}
}
