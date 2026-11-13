// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title IPinelyStake
 * @notice Interface for $PINELY staking by fleet operators for Gold tier access and a safety bond.
 */
interface IPinelyStake {
    struct UnbondRequest {
        uint256 amount;
        uint64 unlockTime;
    }

    event Staked(address indexed operator, uint256 amount);
    event UnstakeRequested(address indexed operator, uint256 amount, uint64 unlockTime);
    event UnstakeCancelled(address indexed operator, uint256 amount);
    event Withdrawn(address indexed operator, uint256 amount);
    event Slashed(address indexed operator, uint256 amount, bytes32 indexed evidenceHash);

    error ZeroAmount();
    error InsufficientStake();
    error NotSlashingAuthority();
    error ZeroAddress();
    error NoActiveUnbond();
    error UnbondingNotMatured();
    error InvalidToken();

    function stake(uint256 amount) external;
    function requestUnstake(uint256 amount) external;
    function cancelUnstake() external;
    function withdrawUnstaked() external;
    function slash(address operator, uint256 amount, bytes32 evidenceHash) external;
    function stakeOf(address operator) external view returns (uint256);
    function unbondRequestOf(address operator) external view returns (uint256 amount, uint64 unlockTime);
    function hasMinStakeGold(address operator) external view returns (bool);
}
