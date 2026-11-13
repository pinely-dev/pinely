// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/**
 * @title IEntryPoint
 * @notice Essential ERC-4337 v0.7 EntryPoint interface for Machine Accounts and Paymasters.
 */
interface IEntryPoint {
    function depositTo(address account) external payable;

    function withdrawTo(address payable withdrawAddress, uint256 amount) external;

    function getDepositInfo(address account)
        external
        view
        returns (uint112 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime);

    function balanceOf(address account) external view returns (uint256);

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;

    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);

    // --- Stake Management (ERC-7562) ---
    function addStake(uint32 unstakeDelaySec) external payable;

    function unlockStake() external;

    function withdrawStake(address payable withdrawAddress) external;
}
