// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./DeployBase.s.sol";
import {MachineRegistry} from "../src/MachineRegistry.sol";
import {PinelyAccountFactory} from "../src/PinelyAccountFactory.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";
import {SurplusSweeper} from "../src/SurplusSweeper.sol";

/**
 * @title DeployStage2
 * @notice Stage 2 deploy (BurnVault, CreatorFeeSplitter, PinelyStake, FleetSubscription, PinelyHook,
 *         PinelyRouter, PoolSeeder) on top of an existing Stage 1.
 *
 *         Stage 2 is a testnet rehearsal until the official $PINELY token launches. Running it on mainnet
 *         additionally requires `ALLOW_STAGE2_MAINNET=true` (explicit owner go-ahead) and a real
 *         `PINELY_TOKEN_ADDRESS`. On mainnet the registry is already owned by the Safe, so the wiring calls
 *         are printed for execution from the Safe instead of being sent.
 *
 *         Required env: REGISTRY_ADDRESS, PAYMASTER_ADDRESS, POOL_MANAGER (+ the Stage 1 variables).
 */
contract DeployStage2 is DeployBase {
    function run() external returns (Stage2 memory ext) {
        Config memory cfg = _loadConfig();
        if (_isMainnet()) {
            require(
                vm.envOr("ALLOW_STAGE2_MAINNET", false), "Mainnet guard: Stage 2 requires ALLOW_STAGE2_MAINNET=true"
            );
            _guardMainnet(cfg);
        }
        Stage2Config memory s2 = _loadStage2Config(cfg);

        Stage1 memory s1;
        s1.registry = MachineRegistry(vm.envAddress("REGISTRY_ADDRESS"));
        s1.paymaster = PinelyPaymaster(payable(vm.envAddress("PAYMASTER_ADDRESS")));
        s1.accountFactory = PinelyAccountFactory(vm.envOr("ACCOUNT_FACTORY_ADDRESS", address(0)));
        s1.sweeper = SurplusSweeper(vm.envOr("SWEEPER_ADDRESS", address(0)));
        _requireContract(address(s1.registry), "REGISTRY_ADDRESS");
        _requireContract(address(s1.paymaster), "PAYMASTER_ADDRESS");

        vm.startBroadcast(cfg.deployer);
        console.log("=== PINELY Stage 2 deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", cfg.deployer);

        ext = _deployStage2(cfg, s2, s1);
        _wireStage2(cfg, s1, ext);
        _handOverStage2Ownership(cfg, ext);
        vm.stopBroadcast();

        console.log("=== Stage 2 complete ===");
    }
}
