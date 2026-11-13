// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBurnVault} from "./interfaces/IBurnVault.sol";

/**
 * @title BurnVault
 * @notice Canonical burn vault for the $PINELY token.
 *         Receives $PINELY directly or pair assets (stablecoin) from creator fees & protocol fees,
 *         and facilitates a permanent buyback & burn to the Dead Address.
 *         Every burn emits the event `Burned(uint256 amount)`.
 *         Protected by ReentrancyGuard because of third-party swap callbacks.
 */
contract BurnVault is IBurnVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable pinelyToken;
    uint256 public override totalBurned;

    constructor(address _pinelyToken, address initialOwner) Ownable(initialOwner) {
        if (_pinelyToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        pinelyToken = IERC20(_pinelyToken);
    }

    /**
     * @notice Burns an amount of $PINELY tokens held in the vault.
     * @param amount Amount of $PINELY tokens to burn.
     */
    function burn(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        totalBurned += amount;
        pinelyToken.safeTransfer(DEAD_ADDRESS, amount);

        emit Burned(amount);
    }

    /**
     * @notice Burns the entire $PINELY balance held in the vault.
     */
    function burnAll() external override nonReentrant {
        uint256 balance = pinelyToken.balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();

        totalBurned += balance;
        pinelyToken.safeTransfer(DEAD_ADDRESS, balance);

        emit Burned(balance);
    }

    /**
     * @notice Executes a $PINELY buyback using fee assets (such as stablecoin)
     *         and burns the result permanently in a single transaction, without holding funds.
     * @param swapRouter Swap router/pool address (e.g. Uniswap v4 / launchpad).
     * @param tokenIn Address of the asset token used for the buyback (e.g. stablecoin).
     * @param amountIn Amount of input tokens used.
     * @param minPinelyOut Minimum amount of $PINELY that must be received (slippage protection).
     * @param swapData Swap transaction calldata.
     * @return pinelyBurned Amount of $PINELY bought and burned.
     */
    function buybackAndBurn(
        address swapRouter,
        address tokenIn,
        uint256 amountIn,
        uint256 minPinelyOut,
        bytes calldata swapData
    ) external override nonReentrant onlyOwner returns (uint256 pinelyBurned) {
        if (swapRouter == address(0) || tokenIn == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();

        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        if (balance < amountIn) revert InsufficientBalance();

        uint256 pinelyBefore = pinelyToken.balanceOf(address(this));

        // Grant the swap router an allowance
        IERC20(tokenIn).forceApprove(swapRouter, amountIn);

        // Execute the swap
        (bool success,) = swapRouter.call(swapData);
        if (!success) revert SwapFailed();

        uint256 pinelyAfter = pinelyToken.balanceOf(address(this));
        if (pinelyAfter <= pinelyBefore) revert ZeroTokenBought();

        pinelyBurned = pinelyAfter - pinelyBefore;
        if (pinelyBurned < minPinelyOut) revert SlippageExceeded();

        totalBurned += pinelyBurned;
        pinelyToken.safeTransfer(DEAD_ADDRESS, pinelyBurned);

        emit Burned(pinelyBurned);
    }
}
