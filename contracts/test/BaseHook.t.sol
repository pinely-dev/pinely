// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @notice Smoke test: proves the v4 dependency + BaseHook compile
/// and deploy in Foundry. Not an implementation of PinelyHook.
contract SmokeHook is BaseHook {
    constructor(IPoolManager manager) BaseHook(manager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return permissions;
    }

    // Skip address validation so the smoke test does not need to mine an address.
    function validateHookAddress(BaseHook) internal pure override {}
}

contract BaseHookSmokeTest is Test {
    function test_BaseHookDeploys() public {
        SmokeHook hook = new SmokeHook(IPoolManager(address(0)));
        assertEq(address(hook.poolManager()), address(0));
    }
}
