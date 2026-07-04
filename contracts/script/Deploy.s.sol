// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {VeritasOracle} from "../src/VeritasOracle.sol";

/// @notice Deploy VeritasOracle to Arbitrum Sepolia and register the 5 agents.
/// @dev Set these env vars before running:
///      BACKEND_ADDRESS, AGENT_1..AGENT_5, DEPLOYER_PRIVATE_KEY (used by forge)
contract Deploy is Script {
    function run() external returns (VeritasOracle oracle) {
        address backend = vm.envAddress("BACKEND_ADDRESS");

        address agent1 = vm.envAddress("AGENT_1");
        address agent2 = vm.envAddress("AGENT_2");
        address agent3 = vm.envAddress("AGENT_3");
        address agent4 = vm.envAddress("AGENT_4");
        address agent5 = vm.envAddress("AGENT_5");

        vm.startBroadcast();

        oracle = new VeritasOracle(backend);

        oracle.registerAgent(agent1, "Oracle Alpha", "Conservative Bayesian");
        oracle.registerAgent(agent2, "Skeptic Beta", "Contrarian");
        oracle.registerAgent(agent3, "Signal Gamma", "Data-driven");
        oracle.registerAgent(agent4, "Risk Delta", "Risk-averse");
        oracle.registerAgent(agent5, "Synthesis Epsilon", "Balanced synthesizer");

        vm.stopBroadcast();
    }
}
