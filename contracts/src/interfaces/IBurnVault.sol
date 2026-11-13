// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title IBurnVault
 * @notice Interface of the canonical $PINELY burn vault (BurnVault).
 *         Every burn emits the event `Burned(uint256 amount)`.
 */
interface IBurnVault {
    event Burned(uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error SwapFailed();
    error SlippageExceeded();
    error ZeroTokenBought();
    error InsufficientBalance();
    error NotAuthorized();

    function burn(uint256 amount) external;
    function burnAll() external;
    function buybackAndBurn(
        address swapRouter,
        address tokenIn,
        uint256 amountIn,
        uint256 minPinelyOut,
        bytes calldata swapData
    ) external returns (uint256 pinelyBurned);
    function totalBurned() external view returns (uint256);
}
