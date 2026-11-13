// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./DeployBase.s.sol";

/**
 * @title DeployTestnet
 * @notice Full 11-contract rehearsal on Robinhood Chain testnet (46630): Stage 1 + Stage 2 in one broadcast.
 *         Registry/Paymaster/BurnVault/PinelyStake are wired while the deployer still owns them, then handed
 *         to TREASURY_ADDRESS if that differs from the deployer.
 *
 *         Contracts (11): MachineRegistry, PinelyAccountFactory, PinelyPaymaster, SurplusSweeper, BurnVault,
 *         PinelyStake, FleetSubscription, CreatorFeeSplitter, PinelyHook, PinelyRouter, PoolSeeder.
 *         Optional testnet mocks: MockUSDG (ALLOW_MOCK_STABLECOIN=true) and MockPinelyToken
 *         (ALLOW_MOCK_PINELY_TOKEN=true) when canonical tokens are unavailable.
 *
 *         Refuses to run on any chain other than 46630 (or a local node for dry runs).
 */
contract DeployTestnet is DeployBase {
    function run() external returns (Stage1 memory s1, Stage2 memory ext) {
        require(block.chainid != ROBINHOOD_MAINNET_CHAIN_ID, "Testnet script: refusing to run on mainnet");
        Config memory cfg = _loadConfig();
        _requirePriceBounds(cfg);
        Stage2Config memory s2 = _loadStage2Config(cfg);

        vm.startBroadcast(cfg.deployer);
        console.log("=== PINELY testnet rehearsal (11 contracts) ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", cfg.deployer);

        _maybeDeployMockStablecoin(cfg);
        console.log("Stablecoin:", cfg.stablecoin);

        s1 = _deployStage1(cfg);
        ext = _deployStage2(cfg, s2, s1);
        _wireStage2(cfg, s1, ext);
        _handOverStage1Ownership(cfg, s1);
        _handOverStage2Ownership(cfg, ext);
        vm.stopBroadcast();

        console.log("=== Testnet rehearsal complete. Next: bun run sync, then the end-to-end drill. ===");
    }
}
