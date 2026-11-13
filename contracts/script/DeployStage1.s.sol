// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./DeployBase.s.sol";

/**
 * @title DeployStage1
 * @notice Stage 1 deploy (MachineRegistry, PinelyAccountFactory, PinelyPaymaster, SurplusSweeper) for
 *         Robinhood Chain testnet (46630) and mainnet (4663).
 *
 *         On mainnet the script refuses mock tokens, zero addresses, the default Anvil key, a treasury that
 *         is not a Safe 2-of-3, and any chain id other than 4663. Registry and Paymaster ownership is handed
 *         to the Safe at the end. SurplusSweeper is permissionless and has no owner.
 *
 *         Required env: NATIVE_PRICE_MIN and NATIVE_PRICE_MAX (8-decimal USD per native token, at most 10x apart).
 *         The script sets them on the Paymaster before ownership moves, so a mistyped price is rejected later.
 *
 *         The Paymaster has no default native-token rate: after deployment the owner (the Safe on mainnet) must
 *         call `setNativePrice`, deposit gas into the EntryPoint and `addStake` before any UserOp is sponsored.
 *
 *         Usage (dry run first, no --broadcast):
 *           forge script script/DeployStage1.s.sol:DeployStage1 --rpc-url robinhood_mainnet \
 *             --account deployer-robinhood --sender $DEPLOYER_ADDRESS
 */
contract DeployStage1 is DeployBase {
    function run() external returns (Stage1 memory s1) {
        Config memory cfg = _loadConfig();
        _requirePriceBounds(cfg);
        if (_isMainnet()) _guardMainnet(cfg);

        vm.startBroadcast(cfg.deployer);
        console.log("=== PINELY Stage 1 deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", cfg.deployer);
        console.log("Treasury:", cfg.treasury);
        console.log("EntryPoint:", cfg.entryPoint);

        _maybeDeployMockStablecoin(cfg);
        console.log("Stablecoin:", cfg.stablecoin);

        s1 = _deployStage1(cfg);
        _handOverStage1Ownership(cfg, s1);
        vm.stopBroadcast();

        console.log("=== Stage 1 complete. Next: bun run sync, then publish addresses and start block. ===");
    }
}
