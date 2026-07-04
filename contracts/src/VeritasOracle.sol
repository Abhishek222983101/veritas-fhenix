// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title VeritasOracle — Autonomous AI Agent Oracle with FHE-weighted Voting
/// @notice 5 AI agents submit encrypted votes on yes/no questions. The contract
///         computes a weighted tally homomorphically; only aggregate scores are decrypted.
contract VeritasOracle is Ownable {
    // ═══════════════════════════════════════════════════════════════
    //  ENUMS
    // ═══════════════════════════════════════════════════════════════

    enum Status {
        Pending,    // 0 — question submitted, accepting votes
        Voting,     // 1 — at least one vote received
        Resolving,  // 2 — allowPublic called on tallies
        Resolved    // 3 — result published
    }

    enum Vote {
        No,         // 0
        Yes,        // 1
        Unsure      // 2
    }

    // ═══════════════════════════════════════════════════════════════
    //  STRUCTS
    // ═══════════════════════════════════════════════════════════════

    struct Agent {
        address wallet;
        string name;
        string personality;
        uint256 reputation;
        bool isActive;
    }

    struct Question {
        uint256 id;
        string text;
        address submitter;
        Status status;
        uint256 createdAt;
        uint256 voteCount;
        Vote result;
        uint256 yesScorePlain;
        uint256 noScorePlain;
        uint256 resolvedAt;
    }

    struct VoteReceipt {
        bool hasVoted;
        bytes32 reasonHash;
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Backend oracle that publishes decrypted results and reputation deltas
    address public backend;

    /// @notice Total questions submitted
    uint256 public questionCounter;

    /// @notice Registered agents by wallet
    mapping(address => Agent) public agents;

    /// @notice Ordered list of registered agents
    address[] public agentList;

    /// @notice Questions by id
    mapping(uint256 => Question) public questions;

    /// @notice Plaintext proof that an agent voted (NOT what they voted)
    mapping(uint256 => mapping(address => VoteReceipt)) public voteReceipts;

    /// @notice Encrypted per-agent votes
    mapping(uint256 => mapping(address => euint8)) public encryptedVotes;

    /// @notice Encrypted per-agent confidence scores
    mapping(uint256 => mapping(address => euint8)) public encryptedConfidences;

    /// @notice Encrypted weighted YES tally
    mapping(uint256 => euint16) public yesScore;

    /// @notice Encrypted weighted NO tally
    mapping(uint256 => euint16) public noScore;

    // Encrypted constants — created in constructor so they can be compared against inputs
    euint8 public YES_CONST;
    euint8 public NO_CONST;
    euint8 public ZERO;
    euint16 public ZERO16;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event AgentRegistered(address indexed wallet, string name, uint256 reputation);
    event QuestionSubmitted(uint256 indexed qid, address indexed submitter, string text);
    event VoteSubmitted(uint256 indexed qid, address indexed agent);
    event ReadyToResolve(uint256 indexed qid);
    event ResolutionTriggered(uint256 indexed qid);
    event QuestionResolved(
        uint256 indexed qid,
        Vote result,
        uint256 yesScore,
        uint256 noScore
    );
    event ReputationUpdated(address indexed agent, int256 delta, uint256 newReputation);

    // ═══════════════════════════════════════════════════════════════
    //  MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier onlyBackend() {
        require(msg.sender == backend, "Not backend");
        _;
    }

    modifier onlyRegisteredAgent() {
        require(agents[msg.sender].wallet != address(0), "Not registered agent");
        _;
    }

    modifier onlyActiveAgent() {
        require(agents[msg.sender].isActive, "Agent not active");
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(address _backend) Ownable(msg.sender) {
        require(_backend != address(0), "Invalid backend");
        backend = _backend;

        // Encrypted constants MUST be allowThis'd immediately
        YES_CONST = FHE.asEuint8(1);
        FHE.allowThis(YES_CONST);

        NO_CONST = FHE.asEuint8(0);
        FHE.allowThis(NO_CONST);

        ZERO = FHE.asEuint8(0);
        FHE.allowThis(ZERO);

        ZERO16 = FHE.asEuint16(0);
        FHE.allowThis(ZERO16);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN / SETUP
    // ═══════════════════════════════════════════════════════════════

    function setBackend(address _backend) external onlyOwner {
        require(_backend != address(0), "Invalid backend");
        backend = _backend;
    }

    function registerAgent(
        address _wallet,
        string calldata _name,
        string calldata _personality
    ) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        require(bytes(_name).length > 0 && bytes(_name).length <= 32, "Invalid name");
        require(agents[_wallet].wallet == address(0), "Already registered");

        agents[_wallet] = Agent({
            wallet: _wallet,
            name: _name,
            personality: _personality,
            reputation: 1000,
            isActive: true
        });
        agentList.push(_wallet);

        emit AgentRegistered(_wallet, _name, 1000);
    }

    function deactivateAgent(address _wallet) external onlyOwner {
        require(agents[_wallet].wallet != address(0), "Not registered");
        agents[_wallet].isActive = false;
    }

    function activateAgent(address _wallet) external onlyOwner {
        require(agents[_wallet].wallet != address(0), "Not registered");
        agents[_wallet].isActive = true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  QUESTION LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    function submitQuestion(string calldata _text) external returns (uint256 qid) {
        require(bytes(_text).length > 0 && bytes(_text).length <= 256, "Invalid question");

        qid = questionCounter++;

        questions[qid] = Question({
            id: qid,
            text: _text,
            submitter: msg.sender,
            status: Status.Pending,
            createdAt: block.timestamp,
            voteCount: 0,
            result: Vote.Unsure,
            yesScorePlain: 0,
            noScorePlain: 0,
            resolvedAt: 0
        });

        // Initialize encrypted accumulators with fresh ciphertexts + ACL
        yesScore[qid] = FHE.asEuint16(0);
        FHE.allowThis(yesScore[qid]);

        noScore[qid] = FHE.asEuint16(0);
        FHE.allowThis(noScore[qid]);

        emit QuestionSubmitted(qid, msg.sender, _text);
    }

    /// @notice Submit an encrypted vote + confidence. The contract updates the
    ///         encrypted weighted tallies without ever learning the plaintext vote.
    function submitVote(
        uint256 _qid,
        InEuint8 calldata _encVote,
        InEuint8 calldata _encConfidence,
        bytes32 _reasonHash
    ) external onlyRegisteredAgent onlyActiveAgent {
        Question storage q = questions[_qid];
        require(q.status == Status.Pending || q.status == Status.Voting, "Invalid status");
        require(!voteReceipts[_qid][msg.sender].hasVoted, "Already voted");
        require(q.voteCount < 5, "All votes received");

        // Verify encrypted inputs and grant this contract access
        euint8 vote = FHE.asEuint8(_encVote);
        FHE.allowThis(vote);

        euint8 confidence = FHE.asEuint8(_encConfidence);
        FHE.allowThis(confidence);

        // Store ciphertexts and plaintext receipt
        encryptedVotes[_qid][msg.sender] = vote;
        encryptedConfidences[_qid][msg.sender] = confidence;
        voteReceipts[_qid][msg.sender] = VoteReceipt(true, _reasonHash);
        q.voteCount++;

        // ═══ Homomorphic YES tally ═══
        // Step 1: isYes = (vote == YES)
        ebool isYes = FHE.eq(vote, YES_CONST);
        FHE.allowThis(isYes);

        // Step 2: yes contribution = isYes ? confidence : 0
        euint8 yesContrib = FHE.select(isYes, confidence, ZERO);
        FHE.allowThis(yesContrib);

        // Step 3: add to YES tally (upcast to euint16 to prevent overflow)
        yesScore[_qid] = FHE.add(yesScore[_qid], FHE.asEuint16(yesContrib));
        FHE.allowThis(yesScore[_qid]);

        // ═══ Homomorphic NO tally ═══
        ebool isNo = FHE.eq(vote, NO_CONST);
        FHE.allowThis(isNo);

        euint8 noContrib = FHE.select(isNo, confidence, ZERO);
        FHE.allowThis(noContrib);

        noScore[_qid] = FHE.add(noScore[_qid], FHE.asEuint16(noContrib));
        FHE.allowThis(noScore[_qid]);

        // State transitions
        if (q.status == Status.Pending) {
            q.status = Status.Voting;
        }

        emit VoteSubmitted(_qid, msg.sender);

        if (q.voteCount == 5) {
            emit ReadyToResolve(_qid);
        }
    }

    /// @notice Authorize the Fhenix threshold network to decrypt the aggregate tallies.
    function triggerResolution(uint256 _qid) external {
        Question storage q = questions[_qid];
        require(q.status == Status.Voting, "Not voting");
        require(q.voteCount == 5, "Not all votes");

        FHE.allowPublic(yesScore[_qid]);
        FHE.allowPublic(noScore[_qid]);

        q.status = Status.Resolving;

        emit ResolutionTriggered(_qid);
    }

    /// @notice Publish the decrypted aggregate scores and finalize the result.
    ///         Fhenix signatures are verified on-chain by publishDecryptResult.
    function publishResult(
        uint256 _qid,
        uint16 _yesVal,
        bytes calldata _yesSig,
        uint16 _noVal,
        bytes calldata _noSig
    ) external onlyBackend {
        Question storage q = questions[_qid];
        require(q.status == Status.Resolving, "Not resolving");

        FHE.publishDecryptResult(yesScore[_qid], _yesVal, _yesSig);
        FHE.publishDecryptResult(noScore[_qid], _noVal, _noSig);

        q.yesScorePlain = _yesVal;
        q.noScorePlain = _noVal;

        if (_yesVal > _noVal) {
            q.result = Vote.Yes;
        } else if (_noVal > _yesVal) {
            q.result = Vote.No;
        } else {
            q.result = Vote.Unsure;
        }

        q.status = Status.Resolved;
        q.resolvedAt = block.timestamp;

        emit QuestionResolved(_qid, q.result, _yesVal, _noVal);
    }

    /// @notice Update agent reputations after resolution. The backend computes
    ///         deltas from its local plaintext knowledge (it encrypted the votes),
    ///         keeping the on-chain votes permanently encrypted.
    function updateReputations(
        uint256 _qid,
        address[] calldata _agents,
        int256[] calldata _deltas
    ) external onlyBackend {
        require(_agents.length == _deltas.length, "Length mismatch");
        require(questions[_qid].status == Status.Resolved, "Not resolved");

        for (uint256 i = 0; i < _agents.length; i++) {
            address agentAddr = _agents[i];
            require(voteReceipts[_qid][agentAddr].hasVoted, "Did not vote");

            int256 delta = _deltas[i];
            uint256 oldRep = agents[agentAddr].reputation;
            uint256 newRep;

            if (delta >= 0) {
                newRep = oldRep + uint256(delta);
            } else {
                uint256 absDelta = uint256(-delta);
                newRep = oldRep > absDelta ? oldRep - absDelta : 0;
            }

            // Reputation cap
            if (newRep > 10000) newRep = 10000;

            agents[agentAddr].reputation = newRep;

            emit ReputationUpdated(agentAddr, delta, newRep);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function getQuestion(uint256 _qid) external view returns (Question memory) {
        return questions[_qid];
    }

    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    function getAgents() external view returns (Agent[] memory) {
        Agent[] memory result = new Agent[](agentList.length);
        for (uint256 i = 0; i < agentList.length; i++) {
            result[i] = agents[agentList[i]];
        }
        return result;
    }

    function getAgent(address _wallet) external view returns (Agent memory) {
        return agents[_wallet];
    }

    function getVoteReceipt(uint256 _qid, address _agent) external view returns (VoteReceipt memory) {
        return voteReceipts[_qid][_agent];
    }

    receive() external payable {}
}
