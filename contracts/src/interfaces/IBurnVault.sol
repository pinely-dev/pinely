// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title IBurnVault
 * @notice Interface of the canonical $PINELY burn vault (BurnVault).
 *         Every burn emits the event `Burned(uint256 amount)`.
 */
interface IBurnVault {
    event Burned(uint256 amount);
    /// @notice A (router, selector) pair was proposed; it becomes usable at `activeAt`.
    event RouteProposed(address indexed router, bytes4 indexed selector, uint64 activeAt);
    /// @notice A (router, selector) pair was removed (or a pending proposal was cancelled).
    event RouteRevoked(address indexed router, bytes4 indexed selector);
    /// @notice `proposeRoute` was disabled for good. Routes can still be revoked.
    event RoutesLocked();

    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error SwapFailed();
    error SlippageExceeded();
    error ZeroTokenBought();
    error InsufficientBalance();
    error NotAuthorized();
    /// @notice The (router, selector) pair is not allowlisted, or its delay has not elapsed yet.
    error RouteNotActive();
    error RouteAlreadyProposed();
    error RouteNotFound();
    /// @notice The route list was locked: no new route can be proposed any more.
    error RoutesAreLocked();
    /// @notice The router is the vault itself, the $PINELY token, or the token being sold.
    error InvalidRouter();
    /// @notice The token being sold cannot be $PINELY itself (use `burn`).
    error InvalidToken();
    /// @notice The buyback would exceed the daily cap on the vault's balance of the sold token.
    error BuybackCapExceeded();
    /// @notice The swap moved more of the sold token than the approved amount.
    error SpentMoreThanApproved();

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

    /// @notice Proposes a (router, selector) pair for buybacks. Usable only after `ROUTE_DELAY`.
    function proposeRoute(address router, bytes4 selector) external;
    /// @notice Removes an allowlisted pair or cancels a pending one. Takes effect immediately.
    function revokeRoute(address router, bytes4 selector) external;
    /// @notice Permanently disables `proposeRoute`. Irreversible.
    function lockRoutes() external;
    /// @notice True once `lockRoutes()` was called.
    function routesLocked() external view returns (bool);
    /// @notice True once the pair is allowlisted and its delay has elapsed.
    function isRouteActive(address router, bytes4 selector) external view returns (bool);
    /// @notice Timestamp at which the pair becomes usable (0 if it was never proposed or was revoked).
    function routeActiveAt(address router, bytes4 selector) external view returns (uint64);
}
