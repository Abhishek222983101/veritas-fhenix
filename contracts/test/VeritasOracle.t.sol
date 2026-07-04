// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {CofheClient} from "@cofhe/foundry-plugin/contracts/CofheClient.sol";
import {euint8, euint16, InEuint8} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {VeritasOracle} from "../src/VeritasOracle.sol";

contract VeritasOracleTest is CofheTest {
    VeritasOracle public oracle;

    CofheClient public backend;
    CofheClient public alpha;
    CofheClient public beta;
    CofheClient public gamma;
    CofheClient public delta;
    CofheClient public epsilon;

    // Distinct private keys for each mock client
    uint256 constant BACKEND_PKEY = 0xBA3;
    uint256 constant ALPHA_PKEY = 0xA11;
    uint256 constant BETA_PKEY = 0xB22;
    uint256 constant GAMMA_PKEY = 0xC33;
    uint256 constant DELTA_PKEY = 0xD44;
    uint256 constant EPSILON_PKEY = 0xE55;

    function setUp() public {
        deployMocks();

        backend = createCofheClient();
        backend.connect(BACKEND_PKEY);

        alpha = createCofheClient();
        alpha.connect(ALPHA_PKEY);

        beta = createCofheClient();
        beta.connect(BETA_PKEY);

        gamma = createCofheClient();
        gamma.connect(GAMMA_PKEY);

        delta = createCofheClient();
        delta.connect(DELTA_PKEY);

        epsilon = createCofheClient();
        epsilon.connect(EPSILON_PKEY);

        vm.prank(backend.account());
        oracle = new VeritasOracle(backend.account());

        oracle.registerAgent(alpha.account(), "Oracle Alpha", "Conservative Bayesian");
        oracle.registerAgent(beta.account(), "Skeptic Beta", "Contrarian");
        oracle.registerAgent(gamma.account(), "Signal Gamma", "Data-driven");
        oracle.registerAgent(delta.account(), "Risk Delta", "Risk-averse");
        oracle.registerAgent(epsilon.account(), "Synthesis Epsilon", "Balanced synthesizer");
    }

    // ═══════════════════════════════════════════════════════════════
    //  BASIC REGISTRY / QUESTION TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_AgentCount() public view {
        assertEq(oracle.getAgentCount(), 5);
    }

    function test_AgentDetails() public view {
        VeritasOracle.Agent memory a = oracle.getAgent(alpha.account());
        assertEq(a.wallet, alpha.account());
        assertEq(a.name, "Oracle Alpha");
        assertEq(a.reputation, 1000);
        assertTrue(a.isActive);
    }

    function test_SubmitQuestion() public {
        uint256 qid = oracle.submitQuestion("Will ETH be above $4000 next week?");
        assertEq(qid, 0);

        VeritasOracle.Question memory q = oracle.getQuestion(qid);
        assertEq(q.text, "Will ETH be above $4000 next week?");
        assertEq(uint256(q.status), uint256(VeritasOracle.Status.Pending));
        assertEq(q.voteCount, 0);

        // Tallies start at zero
        expectPlaintext(oracle.yesScore(qid), uint16(0));
        expectPlaintext(oracle.noScore(qid), uint16(0));
    }

    function test_CannotVoteTwice() public {
        uint256 qid = oracle.submitQuestion("Will BTC be above $70k?");

        address alphaAddr = alpha.account();
        InEuint8 memory encVote = alpha.createInEuint8(1); // YES
        InEuint8 memory encConf = alpha.createInEuint8(80);

        vm.prank(alphaAddr);
        oracle.submitVote(qid, encVote, encConf, keccak256("reason1"));

        vm.expectRevert("Already voted");
        vm.prank(alphaAddr);
        oracle.submitVote(qid, encVote, encConf, keccak256("reason2"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  HOMOMORPHIC TALLY TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_SingleYesVote() public {
        uint256 qid = oracle.submitQuestion("Test question?");

        InEuint8 memory encVote = alpha.createInEuint8(1); // YES
        InEuint8 memory encConf = alpha.createInEuint8(80);

        vm.prank(alpha.account());
        oracle.submitVote(qid, encVote, encConf, keccak256("alpha reasons"));

        expectPlaintext(oracle.yesScore(qid), uint16(80));
        expectPlaintext(oracle.noScore(qid), uint16(0));
    }

    function test_SingleNoVote() public {
        uint256 qid = oracle.submitQuestion("Test question?");

        InEuint8 memory encVote = beta.createInEuint8(0); // NO
        InEuint8 memory encConf = beta.createInEuint8(65);

        vm.prank(beta.account());
        oracle.submitVote(qid, encVote, encConf, keccak256("beta reasons"));

        expectPlaintext(oracle.yesScore(qid), uint16(0));
        expectPlaintext(oracle.noScore(qid), uint16(65));
    }

    function test_UnsureVoteContributesZero() public {
        uint256 qid = oracle.submitQuestion("Test question?");

        InEuint8 memory encVote = gamma.createInEuint8(2); // UNSURE
        InEuint8 memory encConf = gamma.createInEuint8(99);

        vm.prank(gamma.account());
        oracle.submitVote(qid, encVote, encConf, keccak256("gamma reasons"));

        expectPlaintext(oracle.yesScore(qid), uint16(0));
        expectPlaintext(oracle.noScore(qid), uint16(0));
    }

    // ═══════════════════════════════════════════════════════════════
    //  FULL E2E RESOLUTION TEST
    // ═══════════════════════════════════════════════════════════════

    function test_FullResolutionYesWins() public {
        uint256 qid = _runFullVote();

        // Tallies encrypted, but mock can inspect plaintext
        expectPlaintext(oracle.yesScore(qid), uint16(140));
        expectPlaintext(oracle.noScore(qid), uint16(120));

        // Trigger decryption authorization
        oracle.triggerResolution(qid);

        // Off-chain: backend decrypts both tallies + signatures
        bytes32 yesCt = euint16.unwrap(oracle.yesScore(qid));
        bytes32 noCt = euint16.unwrap(oracle.noScore(qid));

        (, uint256 yesVal, bytes memory yesSig) = backend.decryptForTx_withoutPermit(yesCt);
        (, uint256 noVal, bytes memory noSig) = backend.decryptForTx_withoutPermit(noCt);

        assertEq(yesVal, 140);
        assertEq(noVal, 120);

        // On-chain: publish result
        vm.prank(backend.account());
        oracle.publishResult(qid, uint16(yesVal), yesSig, uint16(noVal), noSig);

        VeritasOracle.Question memory q = oracle.getQuestion(qid);
        assertEq(uint256(q.status), uint256(VeritasOracle.Status.Resolved));
        assertEq(uint256(q.result), uint256(VeritasOracle.Vote.Yes));
        assertEq(q.yesScorePlain, 140);
        assertEq(q.noScorePlain, 120);
    }

    function test_ReputationUpdateAfterResolution() public {
        uint256 qid = _runFullVote();
        oracle.triggerResolution(qid);

        bytes32 yesCt = euint16.unwrap(oracle.yesScore(qid));
        bytes32 noCt = euint16.unwrap(oracle.noScore(qid));

        (, uint256 yesVal, bytes memory yesSig) = backend.decryptForTx_withoutPermit(yesCt);
        (, uint256 noVal, bytes memory noSig) = backend.decryptForTx_withoutPermit(noCt);

        vm.prank(backend.account());
        oracle.publishResult(qid, uint16(yesVal), yesSig, uint16(noVal), noSig);

        // YES voters: alpha, gamma (+10). NO voters: beta, delta (-5). Unsure: epsilon (0).
        address[] memory voters = new address[](5);
        voters[0] = alpha.account();
        voters[1] = beta.account();
        voters[2] = gamma.account();
        voters[3] = delta.account();
        voters[4] = epsilon.account();

        int256[] memory deltas = new int256[](5);
        deltas[0] = 10;
        deltas[1] = -5;
        deltas[2] = 10;
        deltas[3] = -5;
        deltas[4] = 0;

        vm.prank(backend.account());
        oracle.updateReputations(qid, voters, deltas);

        assertEq(oracle.getAgent(alpha.account()).reputation, 1010);
        assertEq(oracle.getAgent(beta.account()).reputation, 995);
        assertEq(oracle.getAgent(gamma.account()).reputation, 1010);
        assertEq(oracle.getAgent(delta.account()).reputation, 995);
        assertEq(oracle.getAgent(epsilon.account()).reputation, 1000);
    }

    // ═══════════════════════════════════════════════════════════════
    //  EDGE CASE / ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════════════════════════

    function test_NonRegisteredCannotVote() public {
        uint256 qid = oracle.submitQuestion("Test?");

        CofheClient stranger = createCofheClient();
        stranger.connect(0x999);
        address strangerAddr = stranger.account();

        InEuint8 memory encVote = stranger.createInEuint8(1);
        InEuint8 memory encConf = stranger.createInEuint8(50);

        vm.expectRevert("Not registered agent");
        vm.prank(strangerAddr);
        oracle.submitVote(qid, encVote, encConf, keccak256("x"));
    }

    function test_CannotTriggerResolutionEarly() public {
        uint256 qid = oracle.submitQuestion("Test?");
        _castVote(qid, alpha, 1, 80, "alpha");

        vm.expectRevert("Not all votes");
        oracle.triggerResolution(qid);
    }

    function test_CannotPublishResultIfNotResolving() public {
        uint256 qid = oracle.submitQuestion("Test?");
        _runFullVote();
        // Did NOT call triggerResolution, so status is Voting

        address backendAddr = backend.account();

        vm.expectRevert("Not resolving");
        vm.prank(backendAddr);
        oracle.publishResult(qid, 0, "", 0, "");
    }

    function test_OnlyBackendCanPublishResult() public {
        uint256 qid = _runFullVote();
        oracle.triggerResolution(qid);

        bytes32 yesCt = euint16.unwrap(oracle.yesScore(qid));
        bytes32 noCt = euint16.unwrap(oracle.noScore(qid));
        (, uint256 yesVal, bytes memory yesSig) = backend.decryptForTx_withoutPermit(yesCt);
        (, uint256 noVal, bytes memory noSig) = backend.decryptForTx_withoutPermit(noCt);

        CofheClient stranger = createCofheClient();
        stranger.connect(0x999);
        address strangerAddr = stranger.account();

        vm.expectRevert("Not backend");
        vm.prank(strangerAddr);
        oracle.publishResult(qid, uint16(yesVal), yesSig, uint16(noVal), noSig);
    }

    function test_OnlyOwnerCanRegisterAgent() public {
        CofheClient stranger = createCofheClient();
        stranger.connect(0x999);
        address strangerAddr = stranger.account();

        vm.expectRevert();
        vm.prank(strangerAddr);
        oracle.registerAgent(strangerAddr, "Fake", "Fake");
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _runFullVote() internal returns (uint256 qid) {
        qid = oracle.submitQuestion("Will ETH be above $4000 next week?");

        // alpha: YES 80, gamma: YES 60 -> YES total 140
        // beta: NO 70, delta: NO 50 -> NO total 120
        // epsilon: UNSURE 30 -> contributes 0
        _castVote(qid, alpha, 1, 80, "alpha");
        _castVote(qid, beta, 0, 70, "beta");
        _castVote(qid, gamma, 1, 60, "gamma");
        _castVote(qid, delta, 0, 50, "delta");
        _castVote(qid, epsilon, 2, 30, "epsilon");
    }

    function _castVote(
        uint256 _qid,
        CofheClient _agent,
        uint8 _vote,
        uint8 _confidence,
        string memory _label
    ) internal {
        InEuint8 memory encVote = _agent.createInEuint8(_vote);
        InEuint8 memory encConf = _agent.createInEuint8(_confidence);
        bytes32 reasonHash = keccak256(abi.encodePacked(_label, " reasoning"));

        vm.prank(_agent.account());
        oracle.submitVote(_qid, encVote, encConf, reasonHash);
    }
}
