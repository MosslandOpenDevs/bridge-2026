// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title OracleGovernance
 * @notice Main governance contract for BRIDGE 2026 / ORACLE
 * @dev Implements proposal creation, voting, and outcome proof recording
 */
contract OracleGovernance is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum ProposalStatus {
        Pending,
        Active,
        Passed,
        Rejected,
        Executed,
        Cancelled
    }

    enum VoteChoice {
        For,
        Against,
        Abstain
    }

    struct Proposal {
        uint256 id;
        address proposer;
        bytes32 decisionPacketHash;
        string metadataURI;
        uint256 votingStartTime;
        uint256 votingEndTime;
        uint256 quorum;
        uint256 threshold;
        ProposalStatus status;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
    }

    struct SignalAttestation {
        bytes32 merkleRoot;
        uint256 signalCount;
        uint256 timestamp;
        address attestor;
    }

    struct OutcomeProof {
        uint256 proposalId;
        bytes32 proofHash;
        uint256 successRate;
        bool overallSuccess;
        uint256 recordedAt;
    }

    // State variables
    uint256 public proposalCount;
    uint256 public defaultQuorum = 100;
    uint256 public defaultThreshold = 50; // 50%
    uint256 public defaultVotingPeriod = 7 days;
    uint256 public executionDelay = 2 days; // Timelock between pass and execution

    // Per-proposal earliest execution timestamp (set when finalized as Passed)
    mapping(uint256 => uint256) public executionEta;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => VoteChoice)) public votes;
    mapping(bytes32 => SignalAttestation) public signalAttestations;
    mapping(uint256 => OutcomeProof) public outcomeProofs;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 decisionPacketHash,
        string metadataURI
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        VoteChoice choice,
        uint256 weight
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event SignalAttested(bytes32 indexed merkleRoot, uint256 signalCount);
    event OutcomeRecorded(
        uint256 indexed proposalId,
        bytes32 proofHash,
        bool success
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PROPOSER_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /// @notice Pause governance mutations in case of emergency.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume governance after pause.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Create a new governance proposal
     * @param decisionPacketHash Hash of the off-chain decision packet
     * @param metadataURI URI pointing to proposal metadata
     * @param quorum Minimum votes required (0 for default)
     * @param threshold Percentage required to pass (0 for default)
     * @param votingPeriod Duration in seconds (0 for default)
     */
    function createProposal(
        bytes32 decisionPacketHash,
        string calldata metadataURI,
        uint256 quorum,
        uint256 threshold,
        uint256 votingPeriod
    ) external onlyRole(PROPOSER_ROLE) whenNotPaused returns (uint256) {
        proposalCount++;
        uint256 proposalId = proposalCount;

        uint256 _quorum = quorum > 0 ? quorum : defaultQuorum;
        uint256 _threshold = threshold > 0 ? threshold : defaultThreshold;
        uint256 _votingPeriod = votingPeriod > 0
            ? votingPeriod
            : defaultVotingPeriod;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            decisionPacketHash: decisionPacketHash,
            metadataURI: metadataURI,
            votingStartTime: block.timestamp,
            votingEndTime: block.timestamp + _votingPeriod,
            quorum: _quorum,
            threshold: _threshold,
            status: ProposalStatus.Active,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0
        });

        emit ProposalCreated(
            proposalId,
            msg.sender,
            decisionPacketHash,
            metadataURI
        );

        return proposalId;
    }

    /**
     * @notice Cast a vote on a proposal
     * @param proposalId The proposal to vote on
     * @param choice The vote choice (For, Against, Abstain)
     * @param weight The voting power (typically token balance)
     */
    function castVote(
        uint256 proposalId,
        VoteChoice choice,
        uint256 weight
    ) external nonReentrant whenNotPaused onlyRole(ORACLE_ROLE) {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.id != 0, "Proposal does not exist");
        require(
            proposal.status == ProposalStatus.Active,
            "Proposal not active"
        );
        require(
            block.timestamp <= proposal.votingEndTime,
            "Voting period ended"
        );
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(weight > 0, "Weight must be positive");

        hasVoted[proposalId][msg.sender] = true;
        votes[proposalId][msg.sender] = choice;

        if (choice == VoteChoice.For) {
            proposal.forVotes += weight;
        } else if (choice == VoteChoice.Against) {
            proposal.againstVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, choice, weight);
    }

    /**
     * @notice Finalize a proposal after voting ends
     * @param proposalId The proposal to finalize
     */
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.id != 0, "Proposal does not exist");
        require(
            proposal.status == ProposalStatus.Active,
            "Proposal not active"
        );
        require(
            block.timestamp > proposal.votingEndTime,
            "Voting still ongoing"
        );

        uint256 totalVotes = proposal.forVotes +
            proposal.againstVotes +
            proposal.abstainVotes;
        uint256 decisiveVotes = proposal.forVotes + proposal.againstVotes;

        bool quorumReached = totalVotes >= proposal.quorum;
        uint256 forPercentage = decisiveVotes > 0
            ? (proposal.forVotes * 100) / decisiveVotes
            : 0;
        bool passed = quorumReached && forPercentage >= proposal.threshold;

        proposal.status = passed
            ? ProposalStatus.Passed
            : ProposalStatus.Rejected;

        if (passed) {
            // Lock execution behind a timelock window so MOC holders can react
            // (e.g., trigger pause) if a malicious proposal slipped through.
            executionEta[proposalId] = block.timestamp + executionDelay;
        }
    }

    /**
     * @notice Execute a passed proposal
     * @param proposalId The proposal to execute
     */
    function executeProposal(
        uint256 proposalId
    ) external onlyRole(EXECUTOR_ROLE) whenNotPaused {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.id != 0, "Proposal does not exist");
        require(proposal.status == ProposalStatus.Passed, "Proposal not passed");
        require(
            executionEta[proposalId] != 0 && block.timestamp >= executionEta[proposalId],
            "Timelock not elapsed"
        );

        proposal.status = ProposalStatus.Executed;

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Attest to a batch of signals (Merkle root)
     * @param merkleRoot Root of the signal Merkle tree
     * @param signalCount Number of signals in the batch
     */
    function attestSignals(
        bytes32 merkleRoot,
        uint256 signalCount
    ) external onlyRole(ORACLE_ROLE) {
        signalAttestations[merkleRoot] = SignalAttestation({
            merkleRoot: merkleRoot,
            signalCount: signalCount,
            timestamp: block.timestamp,
            attestor: msg.sender
        });

        emit SignalAttested(merkleRoot, signalCount);
    }

    /**
     * @notice Record outcome proof for a proposal
     * @param proposalId The proposal ID
     * @param proofHash Hash of the outcome proof data
     * @param successRate Percentage of KPIs met (0-100)
     * @param overallSuccess Whether the outcome was successful
     */
    function recordOutcome(
        uint256 proposalId,
        bytes32 proofHash,
        uint256 successRate,
        bool overallSuccess
    ) external onlyRole(ORACLE_ROLE) {
        require(proposals[proposalId].id != 0, "Proposal does not exist");
        require(
            proposals[proposalId].status == ProposalStatus.Executed,
            "Proposal not executed"
        );

        outcomeProofs[proposalId] = OutcomeProof({
            proposalId: proposalId,
            proofHash: proofHash,
            successRate: successRate,
            overallSuccess: overallSuccess,
            recordedAt: block.timestamp
        });

        emit OutcomeRecorded(proposalId, proofHash, overallSuccess);
    }

    /**
     * @notice Update default governance parameters
     */
    function updateDefaults(
        uint256 _quorum,
        uint256 _threshold,
        uint256 _votingPeriod
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_quorum > 0) defaultQuorum = _quorum;
        if (_threshold > 0 && _threshold <= 100) defaultThreshold = _threshold;
        if (_votingPeriod > 0) defaultVotingPeriod = _votingPeriod;
    }

    /// @notice Update the execution timelock window. Set to 0 to disable.
    function updateExecutionDelay(uint256 _delay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_delay <= 30 days, "Delay too long");
        executionDelay = _delay;
    }

    /// @notice Cancel a proposal that has not yet been executed (admin escape hatch).
    function cancelProposal(uint256 proposalId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Proposal does not exist");
        require(
            proposal.status != ProposalStatus.Executed && proposal.status != ProposalStatus.Cancelled,
            "Cannot cancel"
        );
        proposal.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    /**
     * @notice Get proposal details
     */
    function getProposal(
        uint256 proposalId
    ) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /**
     * @notice Check if voting is still active for a proposal
     */
    function isVotingActive(uint256 proposalId) external view returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        return
            proposal.status == ProposalStatus.Active &&
            block.timestamp <= proposal.votingEndTime;
    }
}
