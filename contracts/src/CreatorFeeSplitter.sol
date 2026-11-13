// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICreatorFeeSplitter} from "./interfaces/ICreatorFeeSplitter.sol";

/**
 * @title CreatorFeeSplitter
 * @notice Distributes the Creator Fee from the launchpad deterministically and without custody:
 *         - 30% to the BurnVault (for $PINELY buyback & burn)
 *         - 70% to the Treasury (for audit costs, hardware dev kits, and fleet pilots)
 */
contract CreatorFeeSplitter is ICreatorFeeSplitter {
    using SafeERC20 for IERC20;

    uint256 public constant BURN_BPS = 3000; // 30%
    uint256 public constant TREASURY_BPS = 7000; // 70%
    uint256 public constant BPS_DENOMINATOR = 10000;

    address public immutable override burnVault;
    address public immutable override treasury;

    constructor(address _burnVault, address _treasury) {
        if (_burnVault == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        burnVault = _burnVault;
        treasury = _treasury;
    }

    /**
     * @notice Distributes the contract's whole token balance in the 30/70 proportion.
     * @param token ERC-20 token address to distribute.
     */
    function distribute(address token) external override {
        if (token == address(0)) revert ZeroAddress();

        IERC20 erc20 = IERC20(token);
        uint256 balance = erc20.balanceOf(address(this));
        if (balance == 0) revert NothingToDistribute();

        uint256 burnAmount = (balance * BURN_BPS) / BPS_DENOMINATOR;
        uint256 treasuryAmount = balance - burnAmount;

        erc20.safeTransfer(burnVault, burnAmount);
        erc20.safeTransfer(treasury, treasuryAmount);

        emit FeeSplit(token, burnAmount, treasuryAmount);
    }
}
