// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMachineRegistry} from "./interfaces/IMachineRegistry.sol";
import {ISurplusSweeper} from "./interfaces/ISurplusSweeper.sol";

/**
 * @title SurplusSweeper
 * @notice Canonical PINELY contract that automates moving machine revenue surplus.
 *         Revenue above the operating reserve (reserve threshold) is moved
 *         to the stablecoin vault / treasury the operator has configured.
 *
 * Properties & security guarantees:
 * 1. Non-custodial: the contract never holds machine funds.
 *    Funds flow straight from the Machine Account to the destination vault.
 * 2. Immutable & ownerless: parameters can only be set by the operator of the machine fleet itself.
 * 3. Kill switch integration: frozen machines or fleets (kill switch) are rejected from sweeping.
 * 4. Dual configuration: supports per-machine configuration or a fleet-wide fallback.
 */
contract SurplusSweeper is ISurplusSweeper, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    address public immutable override registry;
    address public immutable override defaultToken;

    mapping(bytes32 => SweepConfig) private _machineConfigs;
    mapping(address => SweepConfig) private _fleetConfigs;

    // --- Constructor ---

    constructor(address _registry, address _defaultToken) {
        if (_registry == address(0) || _defaultToken == address(0)) revert ZeroAddress();
        registry = _registry;
        defaultToken = _defaultToken;
    }

    // --- Operator Configuration ---

    /**
     * @notice Sets the auto-sweep configuration for a specific machine.
     * @param machineId On-chain machine ID in the MachineRegistry.
     * @param token ERC-20 token to sweep (if address(0), defaults to defaultToken/stablecoin).
     * @param reserveThreshold Minimum reserve that must stay in the machine account.
     * @param destination Vault / cold wallet address that receives the surplus.
     * @param enabled Whether auto-sweep is on or off.
     */
    function setMachineConfig(
        bytes32 machineId,
        address token,
        uint256 reserveThreshold,
        address destination,
        bool enabled
    ) external override {
        IMachineRegistry.Machine memory m = IMachineRegistry(registry).getMachine(machineId);
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();
        if (destination == address(0)) revert ZeroAddress();

        address actualToken = token == address(0) ? defaultToken : token;

        _machineConfigs[machineId] = SweepConfig({
            token: actualToken, reserveThreshold: reserveThreshold, destination: destination, enabled: enabled
        });

        emit MachineConfigSet(machineId, actualToken, reserveThreshold, destination, enabled);
    }

    /**
     * @notice Sets the default auto-sweep configuration for the operator's whole fleet.
     * @param token ERC-20 token to sweep (if address(0), defaults to defaultToken/stablecoin).
     * @param reserveThreshold Minimum reserve that must stay in the machine account.
     * @param destination Vault / cold wallet address that receives the surplus.
     * @param enabled Whether fleet-wide auto-sweep is on or off.
     */
    function setFleetConfig(address token, uint256 reserveThreshold, address destination, bool enabled)
        external
        override
    {
        if (destination == address(0)) revert ZeroAddress();

        address actualToken = token == address(0) ? defaultToken : token;

        _fleetConfigs[msg.sender] = SweepConfig({
            token: actualToken, reserveThreshold: reserveThreshold, destination: destination, enabled: enabled
        });

        emit FleetConfigSet(msg.sender, actualToken, reserveThreshold, destination, enabled);
    }

    // --- Sweeping Execution ---

    /**
     * @notice Sweeps the revenue surplus of a given machine above reserveThreshold.
     * @dev Can be called by a keeper bot, the operator, or the machine itself.
     * @param machineId On-chain machine ID in the MachineRegistry.
     * @return surplusSwept Amount of tokens swept to the destination vault.
     */
    function sweep(bytes32 machineId) external override nonReentrant returns (uint256 surplusSwept) {
        (SweepConfig memory config,) = getEffectiveConfig(machineId);
        if (!config.enabled) revert SweeperNotConfigured();

        if (IMachineRegistry(registry).isFrozen(machineId)) revert MachineIsFrozen();

        IMachineRegistry.Machine memory m = IMachineRegistry(registry).getMachine(machineId);

        uint256 balance = IERC20(config.token).balanceOf(m.account);
        if (balance <= config.reserveThreshold) revert NoSurplusToSweep();

        surplusSwept = balance - config.reserveThreshold;

        uint256 allowance = IERC20(config.token).allowance(m.account, address(this));
        if (allowance < surplusSwept) revert InsufficientAllowance();

        // forge-lint: disable-next-line(arbitrary-send-erc20)
        IERC20(config.token).safeTransferFrom(m.account, config.destination, surplusSwept);

        emit SurplusSwept(machineId, m.account, config.destination, config.token, surplusSwept, config.reserveThreshold);
    }

    /**
     * @notice Sweeps a machine's revenue surplus by its smart account address.
     * @param account Machine Account address (ERC-4337).
     * @return surplusSwept Amount of tokens swept to the destination vault.
     */
    function sweepAccount(address account) external override nonReentrant returns (uint256 surplusSwept) {
        bytes32 machineId = IMachineRegistry(registry).machineIdOf(account);
        if (machineId == bytes32(0)) revert MachineNotFound();

        (SweepConfig memory config,) = getEffectiveConfig(machineId);
        if (!config.enabled) revert SweeperNotConfigured();

        if (IMachineRegistry(registry).isFrozen(machineId)) revert MachineIsFrozen();

        IMachineRegistry.Machine memory m = IMachineRegistry(registry).getMachine(machineId);

        uint256 balance = IERC20(config.token).balanceOf(m.account);
        if (balance <= config.reserveThreshold) revert NoSurplusToSweep();

        surplusSwept = balance - config.reserveThreshold;

        uint256 allowance = IERC20(config.token).allowance(m.account, address(this));
        if (allowance < surplusSwept) revert InsufficientAllowance();

        // forge-lint: disable-next-line(arbitrary-send-erc20)
        IERC20(config.token).safeTransferFrom(m.account, config.destination, surplusSwept);

        emit SurplusSwept(machineId, m.account, config.destination, config.token, surplusSwept, config.reserveThreshold);
    }

    /**
     * @notice Sweeps the revenue surplus of many machines in one transaction.
     * @dev Machines with no surplus yet, or that are frozen, are skipped without reverting the others.
     * @param machineIds List of on-chain machine IDs.
     * @return totalSwept Total amount of tokens swept.
     */
    // forge-lint: disable-next-line(calls-loop)
    function sweepBatch(bytes32[] calldata machineIds) external override nonReentrant returns (uint256 totalSwept) {
        uint256 len = machineIds.length;
        if (len == 0) revert EmptyBatch();

        for (uint256 i = 0; i < len; i++) {
            bytes32 mId = machineIds[i];

            // Skip frozen machines
            // forge-lint: disable-next-line(calls-loop)
            if (IMachineRegistry(registry).isFrozen(mId)) continue;

            (SweepConfig memory config,) = _resolveEffectiveConfig(mId);
            if (!config.enabled) continue;

            IMachineRegistry.Machine memory m;
            // forge-lint: disable-next-line(calls-loop)
            try IMachineRegistry(registry).getMachine(mId) returns (IMachineRegistry.Machine memory machine) {
                m = machine;
            } catch {
                continue;
            }

            if (m.account == address(0)) continue;

            // forge-lint: disable-next-line(calls-loop)
            uint256 balance = IERC20(config.token).balanceOf(m.account);
            if (balance <= config.reserveThreshold) continue;

            uint256 surplus = balance - config.reserveThreshold;

            // forge-lint: disable-next-line(calls-loop)
            uint256 allowance = IERC20(config.token).allowance(m.account, address(this));
            if (allowance < surplus) continue;

            // forge-lint: disable-next-line(arbitrary-send-erc20,calls-loop)
            IERC20(config.token).safeTransferFrom(m.account, config.destination, surplus);

            emit SurplusSwept(mId, m.account, config.destination, config.token, surplus, config.reserveThreshold);

            totalSwept += surplus;
        }
    }

    // --- View Functions ---

    /**
     * @notice Reads a machine's explicit configuration.
     */
    function getMachineConfig(bytes32 machineId) external view override returns (SweepConfig memory) {
        return _machineConfigs[machineId];
    }

    /**
     * @notice Reads the operator's fleet configuration.
     */
    function getFleetConfig(address operator) external view override returns (SweepConfig memory) {
        return _fleetConfigs[operator];
    }

    /**
     * @notice Reads a machine's effective configuration (machine-specific first, then fleet).
     */
    function getEffectiveConfig(bytes32 machineId)
        public
        view
        override
        returns (SweepConfig memory config, bool isCustom)
    {
        return _resolveEffectiveConfig(machineId);
    }

    /**
     * @notice Computes the surplus that could be swept right now.
     */
    function getSweepableSurplus(bytes32 machineId)
        external
        view
        override
        returns (uint256 surplus, address token, address destination)
    {
        (SweepConfig memory config,) = _resolveEffectiveConfig(machineId);
        if (!config.enabled) return (0, address(0), address(0));

        if (IMachineRegistry(registry).isFrozen(machineId)) return (0, config.token, config.destination);

        IMachineRegistry.Machine memory m = IMachineRegistry(registry).getMachine(machineId);
        if (m.account == address(0)) return (0, config.token, config.destination);

        uint256 balance = IERC20(config.token).balanceOf(m.account);
        if (balance <= config.reserveThreshold) return (0, config.token, config.destination);

        return (balance - config.reserveThreshold, config.token, config.destination);
    }

    // --- Internal Helpers ---

    function _resolveEffectiveConfig(bytes32 machineId)
        internal
        view
        returns (SweepConfig memory config, bool isCustom)
    {
        SweepConfig memory machineCfg = _machineConfigs[machineId];
        if (machineCfg.enabled) {
            config = machineCfg;
            isCustom = true;
            return (config, isCustom);
        }

        IMachineRegistry.Machine memory m;
        // forge-lint: disable-next-line(calls-loop)
        try IMachineRegistry(registry).getMachine(machineId) returns (IMachineRegistry.Machine memory machine) {
            m = machine;
        } catch {
            config = machineCfg;
            isCustom = false;
            return (config, isCustom);
        }

        SweepConfig memory fleetCfg = _fleetConfigs[m.operator];
        if (fleetCfg.enabled) {
            config = fleetCfg;
            isCustom = false;
            return (config, isCustom);
        }

        config = machineCfg;
        isCustom = false;
        return (config, isCustom);
    }
}
