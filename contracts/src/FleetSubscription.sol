// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFleetSubscription} from "./interfaces/IFleetSubscription.sol";

/**
 * @title FleetSubscription
 * @notice On-chain billing infrastructure for recurring revenue:
 *         - Pinely SDK: $1/device/month
 *         - Fleet Pro: $99/fleet/month
 *         Revenue is split deterministically:
 *         - 20% to the BurnVault
 *         - 80% to the Treasury (for audit costs, hardware dev kits, pilots)
 */
contract FleetSubscription is IFleetSubscription, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FLEET_PRO_MONTHLY_RATE = 99; // $99 per fleet per month
    uint256 public constant SDK_DEVICE_MONTHLY_RATE = 1; // $1 per device per month
    uint256 public constant MONTH_DURATION = 30 days;

    uint256 public constant BURN_BPS = 2000; // 20%
    uint256 public constant TREASURY_BPS = 8000; // 80%
    uint256 public constant BPS_DENOMINATOR = 10000;

    IERC20 public immutable stablecoin;
    address public immutable burnVault;
    address public immutable treasury;
    uint256 public immutable unitScale;

    mapping(bytes32 => FleetSubscriptionInfo) public fleetProSubscriptions;
    mapping(bytes32 => FleetSubscriptionInfo) public sdkDeviceSubscriptions;
    mapping(bytes32 => address) public fleetOwners;

    constructor(address _stablecoin, address _burnVault, address _treasury) {
        if (_stablecoin == address(0) || _burnVault == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        stablecoin = IERC20(_stablecoin);
        burnVault = _burnVault;
        treasury = _treasury;

        uint256 scale = 1e6;
        if (_stablecoin.code.length > 0) {
            try IERC20Metadata(_stablecoin).decimals() returns (uint8 dec) {
                scale = 10 ** dec;
            } catch {}
        }
        unitScale = scale;
    }

    /**
     * @notice Subscribes to or renews the Fleet Pro plan ($99/fleet/month).
     * @param fleetId Unique fleet ID.
     * @param months Number of months paid upfront (minimum 1).
     */
    function subscribeFleetPro(bytes32 fleetId, uint256 months) external override nonReentrant {
        if (fleetId == bytes32(0) || months == 0) revert InvalidAmount();

        if (fleetOwners[fleetId] == address(0)) {
            fleetOwners[fleetId] = msg.sender;
        } else if (fleetOwners[fleetId] != msg.sender) {
            revert NotFleetOwner();
        }

        uint256 cost = months * FLEET_PRO_MONTHLY_RATE * unitScale;
        _chargeAndDistribute(cost);

        FleetSubscriptionInfo storage sub = fleetProSubscriptions[fleetId];
        uint256 startTimestamp = sub.validUntil > block.timestamp ? sub.validUntil : block.timestamp;
        sub.validUntil = startTimestamp + (months * MONTH_DURATION);
        sub.totalPaidStable += cost;

        emit SubscribedFleetPro(fleetId, msg.sender, months, sub.validUntil, cost);
    }

    /**
     * @notice Pays for or renews Pinely SDK device licence quota ($1/device/month).
     * @param fleetId Unique ID of the fleet that owns the devices.
     * @param deviceCount Number of licensed devices.
     * @param months Licence duration in months (minimum 1).
     */
    function subscribeDevices(bytes32 fleetId, uint256 deviceCount, uint256 months) external override nonReentrant {
        if (fleetId == bytes32(0) || deviceCount == 0 || months == 0) revert InvalidAmount();

        if (fleetOwners[fleetId] == address(0)) {
            fleetOwners[fleetId] = msg.sender;
        } else if (fleetOwners[fleetId] != msg.sender) {
            revert NotFleetOwner();
        }

        FleetSubscriptionInfo storage sub = sdkDeviceSubscriptions[fleetId];
        // Prevent downgrading activeDevices while the licence period has not ended
        // forge-lint: disable-next-line(block-timestamp)
        if (sub.validUntil > block.timestamp && deviceCount < sub.activeDevices) {
            revert CannotDecreaseActiveDevices();
        }

        uint256 proratedCost = 0;
        // forge-lint: disable-next-line(block-timestamp)
        if (sub.validUntil > block.timestamp && deviceCount > sub.activeDevices) {
            // forge-lint: disable-next-line(block-timestamp)
            uint256 remainingSeconds = sub.validUntil - block.timestamp;
            uint256 deltaDevices = deviceCount - sub.activeDevices;
            proratedCost = (deltaDevices * remainingSeconds * SDK_DEVICE_MONTHLY_RATE * unitScale) / MONTH_DURATION;
        }

        uint256 extensionCost = deviceCount * months * SDK_DEVICE_MONTHLY_RATE * unitScale;
        uint256 totalCost = proratedCost + extensionCost;
        _chargeAndDistribute(totalCost);

        // forge-lint: disable-next-line(block-timestamp)
        uint256 startTimestamp = sub.validUntil > block.timestamp ? sub.validUntil : block.timestamp;
        sub.validUntil = startTimestamp + (months * MONTH_DURATION);
        sub.activeDevices = deviceCount;
        sub.totalPaidStable += totalCost;

        emit SubscribedDevices(fleetId, msg.sender, deviceCount, months, sub.validUntil, totalCost);
    }

    /**
     * @notice Checks whether the Fleet Pro status is active for a given fleet.
     */
    function isFleetProActive(bytes32 fleetId) external view override returns (bool) {
        return fleetProSubscriptions[fleetId].validUntil >= block.timestamp;
    }

    /**
     * @notice Checks whether a fleet device is covered by an active Pinely SDK licence.
     */
    function isDeviceCovered(bytes32 fleetId) external view override returns (bool) {
        FleetSubscriptionInfo memory sub = sdkDeviceSubscriptions[fleetId];
        return sub.validUntil >= block.timestamp && sub.activeDevices > 0;
    }

    /**
     * @notice Reads the Fleet Pro subscription details.
     */
    function getFleetProSubscription(bytes32 fleetId) external view override returns (FleetSubscriptionInfo memory) {
        return fleetProSubscriptions[fleetId];
    }

    /**
     * @notice Reads the SDK licence quota details.
     */
    function getSdkSubscription(bytes32 fleetId) external view override returns (FleetSubscriptionInfo memory) {
        return sdkDeviceSubscriptions[fleetId];
    }

    /**
     * @dev Pulls the stablecoin fee from the sender and distributes it directly:
     *      20% to the BurnVault, 80% to the Treasury.
     */
    function _chargeAndDistribute(uint256 totalCost) internal {
        stablecoin.safeTransferFrom(msg.sender, address(this), totalCost);

        uint256 burnAmount = (totalCost * BURN_BPS) / BPS_DENOMINATOR;
        uint256 treasuryAmount = totalCost - burnAmount;

        stablecoin.safeTransfer(burnVault, burnAmount);
        stablecoin.safeTransfer(treasury, treasuryAmount);

        emit FeesDistributed(burnAmount, treasuryAmount);
    }
}
