// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

/**
 * @title DeployPoolManager
 * @notice Self-deploys the Uniswap v4 PoolManager on Robinhood Chain ONLY when no canonical deployment is published
 *         (prefer the official PoolManager when one is published; check the v4-core licence terms
 *         before a production self-deploy). Needed for the Stage 2 testnet rehearsal.
 *
 *         Initial owner is POOL_MANAGER_OWNER (a Safe on mainnet).
 */
contract DeployPoolManager is Script {
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;
    address internal constant ANVIL_DEFAULT_ACCOUNT_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() external returns (PoolManager manager) {
        require(
            block.chainid == 46630 || block.chainid == 4663 || block.chainid == 31337,
            "Chain guard: unsupported chain id (expected 46630 or 4663)"
        );
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (block.chainid != 31337) {
            require(deployer != FOUNDRY_DEFAULT_SENDER, "Deployer guard: pass --sender or set DEPLOYER_ADDRESS");
            require(deployer != ANVIL_DEFAULT_ACCOUNT_0, "Deployer guard: the default Anvil key must never be used");
        }

        address owner = vm.envOr("POOL_MANAGER_OWNER", block.chainid == 4663 ? address(0) : deployer);
        require(owner != address(0), "Config: POOL_MANAGER_OWNER is required");
        if (block.chainid == 4663) {
            require(owner != deployer, "Mainnet guard: PoolManager owner must not be the deployer EOA");
            require(owner.code.length > 0, "Mainnet guard: PoolManager owner must be a deployed Safe");
        }

        vm.startBroadcast(deployer);
        manager = new PoolManager(owner);
        console.log("PoolManager deployed at:", address(manager));
        console.log("Owner:", owner);
        vm.stopBroadcast();
    }
}
