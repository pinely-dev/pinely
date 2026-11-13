// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title ISurplusSweeper
 * @notice Interface for SurplusSweeper, the module that moves machine revenue
 *         above the operating reserve threshold to the operator's vault/treasury.
 */
interface ISurplusSweeper {
    struct SweepConfig {
        address token;
        uint256 reserveThreshold;
        address destination;
        bool enabled;
    }

    event MachineConfigSet(
        bytes32 indexed machineId,
        address indexed token,
        uint256 reserveThreshold,
        address indexed destination,
        bool enabled
    );
    event FleetConfigSet(
        address indexed operator,
        address indexed token,
        uint256 reserveThreshold,
        address indexed destination,
        bool enabled
    );
    event SurplusSwept(
        bytes32 indexed machineId,
        address indexed account,
        address indexed destination,
        address token,
        uint256 surplusAmount,
        uint256 reserveRemaining
    );

    error ZeroAddress();
    error NotOperator();
    error MachineNotFound();
    error MachineIsFrozen();
    error SweeperNotConfigured();
    error NoSurplusToSweep();
    error InsufficientAllowance();
    error EmptyBatch();

    function registry() external view returns (address);
    function defaultToken() external view returns (address);

    function getMachineConfig(bytes32 machineId) external view returns (SweepConfig memory);
    function getFleetConfig(address operator) external view returns (SweepConfig memory);
    function getEffectiveConfig(bytes32 machineId) external view returns (SweepConfig memory config, bool isCustom);
    function getSweepableSurplus(bytes32 machineId)
        external
        view
        returns (uint256 surplus, address token, address destination);

    function setMachineConfig(
        bytes32 machineId,
        address token,
        uint256 reserveThreshold,
        address destination,
        bool enabled
    ) external;

    function setFleetConfig(address token, uint256 reserveThreshold, address destination, bool enabled) external;

    function sweep(bytes32 machineId) external returns (uint256 surplusSwept);
    function sweepAccount(address account) external returns (uint256 surplusSwept);
    function sweepBatch(bytes32[] calldata machineIds) external returns (uint256 totalSwept);
}
