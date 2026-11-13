// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PackedUserOperation} from "./PackedUserOperation.sol";

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

/**
 * @title IPaymaster
 * @notice ERC-4337 v0.7 Paymaster interface.
 */
interface IPaymaster {
    /**
     * @notice Validates whether the Paymaster is willing to pay gas for this UserOperation.
     * @param userOp UserOperation being validated.
     * @param userOpHash Hash of the UserOperation.
     * @param maxCost Maximum gas cost that may be covered (in wei).
     * @return context Contextual data passed on to `postOp`.
     * @return validationData Packed validation data (authorizer, validUntil, validAfter).
     */
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData);

    /**
     * @notice Charges the gas cost after the UserOp has been executed by the EntryPoint.
     * @param mode Execution status of the UserOp (succeeded or reverted).
     * @param context Context data from `validatePaymasterUserOp`.
     * @param actualGasCost Actual gas cost incurred (in wei).
     * @param actualUserOpFeePerGas Actual gas price per unit of gas.
     */
    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        external;
}
