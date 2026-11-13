// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title IFleetSubscription
 * @notice On-chain interface for recurring billing of
 *         the Pinely SDK licence ($1/device/month) and the Fleet Pro subscription ($99/fleet/month).
 */
interface IFleetSubscription {
    struct FleetSubscriptionInfo {
        uint256 validUntil;
        uint256 activeDevices;
        uint256 totalPaidStable;
    }

    event SubscribedFleetPro(
        bytes32 indexed fleetId, address indexed operator, uint256 months, uint256 validUntil, uint256 amountPaid
    );

    event SubscribedDevices(
        bytes32 indexed fleetId,
        address indexed operator,
        uint256 deviceCount,
        uint256 months,
        uint256 validUntil,
        uint256 amountPaid
    );

    event FeesDistributed(uint256 indexed burnAmount, uint256 indexed treasuryAmount);

    error ZeroAddress();
    error InvalidAmount();
    error SubscriptionExpired();
    error Unauthorized();
    error NotFleetOwner();
    error CannotDecreaseActiveDevices();

    function subscribeFleetPro(bytes32 fleetId, uint256 months) external;
    function subscribeDevices(bytes32 fleetId, uint256 deviceCount, uint256 months) external;
    function isFleetProActive(bytes32 fleetId) external view returns (bool);
    function isDeviceCovered(bytes32 fleetId) external view returns (bool);
    function getFleetProSubscription(bytes32 fleetId) external view returns (FleetSubscriptionInfo memory);
    function getSdkSubscription(bytes32 fleetId) external view returns (FleetSubscriptionInfo memory);
}
