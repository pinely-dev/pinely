// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title ICreatorFeeSplitter
 * @notice Interface of the launchpad creator fee splitter (30% BurnVault / 70% Treasury).
 */
interface ICreatorFeeSplitter {
    event FeeSplit(address indexed token, uint256 burnAmount, uint256 treasuryAmount);

    error ZeroAddress();
    error NothingToDistribute();
    error TransferFailed();

    function distribute(address token) external;
    function burnVault() external view returns (address);
    function treasury() external view returns (address);
}
