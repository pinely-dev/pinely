// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PackedUserOperation} from "./PackedUserOperation.sol";

/**
 * @title IAccount
 * @notice ERC-4337 v0.7 Account interface.
 */
interface IAccount {
    /**
     * @notice Validates the user's signature and nonce for a UserOperation.
     * @param userOp UserOperation being validated.
     * @param userOpHash Hash of the UserOperation (produced by the EntryPoint).
     * @param missingAccountFunds Funds that must be paid to the EntryPoint to cover the gas deposit.
     * @return validationData Packed validation data (authorizer, validUntil, validAfter).
     */
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256 validationData);
}
