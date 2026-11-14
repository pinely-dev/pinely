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
 *
 * @dev Trust model of `buybackAndBurn` (audit finding C-30). The owner chooses the swap calldata, so the
 *      vault cannot prove that the swap output ends up in the vault. It therefore BOUNDS the owner instead:
 *        1. Only an allowlisted (router, selector) pair can be called. A pair is proposed first and becomes
 *           usable only after `ROUTE_DELAY`, so every route change is public (`RouteProposed`) for two days
 *           before it can touch funds. Removing a pair is immediate.
 *        2. At most `MAX_BUYBACK_BPS_PER_DAY` of the vault's balance of the sold token can be spent per
 *           `BUYBACK_WINDOW`, measured against the balance at the start of the window.
 *        3. The router can never be the vault, the $PINELY token or the token being sold, so the allowlist
 *           cannot be used to call `transfer` on a token. The allowance is reset to zero after every swap,
 *           and the swap may not spend more than `amountIn`.
 *        4. `lockRoutes()` permanently disables `proposeRoute`. Stage 2 allowlists exactly one route, the
 *           PinelyBuybackExecutor (fixed pool, recipient = this vault), and then locks. After the lock the
 *           owner can only REMOVE routes, never add one, so no router or calldata of the owner's choosing
 *           can ever be called.
 *      Residual risk: (a) before `lockRoutes()` the owner (a 2-of-3 Safe) can still propose another pair, but
 *      only after a two-day public delay and within the daily cap; (b) a router that is NOT a recipient-locked
 *      executor can be given calldata that sends part of the output elsewhere; (c) market risk: the swap runs
 *      at the pool price, so a thin or manipulated pool can give the vault a bad price (`minPinelyOut` and the
 *      daily cap bound it).
 *      All time limits use `block.timestamp`, never `block.number` (Robinhood Chain blocks are ~100 ms).
 */
contract BurnVault is IBurnVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice Delay between proposing a (router, selector) pair and being able to use it.
    uint64 public constant ROUTE_DELAY = 2 days;
    /// @notice Length of the buyback spending window.
    uint64 public constant BUYBACK_WINDOW = 1 days;
    /// @notice Share of the sold token's balance (at the start of a window) that can be spent per window.
    uint256 public constant MAX_BUYBACK_BPS_PER_DAY = 2_500;
    uint256 private constant BPS = 10_000;

    struct BuybackWindow {
        uint64 start;
        uint256 base;
        uint256 spent;
    }

    IERC20 public immutable pinelyToken;
    uint256 public override totalBurned;
    /// @notice True once `lockRoutes()` was called. It can never be undone.
    bool public override routesLocked;

    /// @dev keccak256(router, selector) => timestamp at which the pair becomes usable (0 = not allowlisted).
    mapping(bytes32 => uint64) private _routeActiveAt;
    /// @dev Spending window per sold token.
    mapping(address => BuybackWindow) private _windows;

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

    // --- Route allowlist ---

    /**
     * @notice Proposes a (router, selector) pair for buybacks. It becomes usable after `ROUTE_DELAY`.
     * @dev The router cannot be the vault or the $PINELY token. The sold token is checked at buyback time.
     */
    function proposeRoute(address router, bytes4 selector) external override onlyOwner {
        if (routesLocked) revert RoutesAreLocked();
        if (router == address(0)) revert ZeroAddress();
        if (router == address(this) || router == address(pinelyToken)) revert InvalidRouter();

        bytes32 key = _routeKey(router, selector);
        if (_routeActiveAt[key] != 0) revert RouteAlreadyProposed();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 activeAt = uint64(block.timestamp) + ROUTE_DELAY;
        _routeActiveAt[key] = activeAt;

        emit RouteProposed(router, selector, activeAt);
    }

    /**
     * @notice Removes an allowlisted pair, or cancels a pending proposal. Takes effect immediately.
     */
    function revokeRoute(address router, bytes4 selector) external override onlyOwner {
        bytes32 key = _routeKey(router, selector);
        if (_routeActiveAt[key] == 0) revert RouteNotFound();

        delete _routeActiveAt[key];

        emit RouteRevoked(router, selector);
    }

    /**
     * @notice Permanently disables `proposeRoute`. Routes that are already proposed or active stay, and
     *         `revokeRoute` keeps working. Call it once the PinelyBuybackExecutor route is in place.
     * @dev Irreversible by design: if the allowlisted executor ever stops being usable, buybacks stop
     *      (the vault's funds stay in the vault) instead of the owner being able to add an arbitrary router.
     */
    function lockRoutes() external override onlyOwner {
        if (routesLocked) revert RoutesAreLocked();
        routesLocked = true;

        emit RoutesLocked();
    }

    function isRouteActive(address router, bytes4 selector) public view override returns (bool) {
        uint64 activeAt = _routeActiveAt[_routeKey(router, selector)];
        // forge-lint: disable-next-line(block-timestamp)
        return activeAt != 0 && block.timestamp >= activeAt;
    }

    function routeActiveAt(address router, bytes4 selector) external view override returns (uint64) {
        return _routeActiveAt[_routeKey(router, selector)];
    }

    // --- Buyback ---

    /**
     * @notice Executes a $PINELY buyback using fee assets (such as stablecoin)
     *         and burns the result permanently in a single transaction, without holding funds.
     * @dev See the contract-level trust model: the (router, selector) pair must be allowlisted and past its
     *      delay, and the spend is capped per day.
     * @param swapRouter Allowlisted swap router/pool address (e.g. Uniswap v4 / launchpad).
     * @param tokenIn Address of the asset token used for the buyback (e.g. stablecoin).
     * @param amountIn Amount of input tokens used.
     * @param minPinelyOut Minimum amount of $PINELY that must be received (slippage protection).
     * @param swapData Swap transaction calldata; its first four bytes must be an allowlisted selector.
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
        if (tokenIn == address(pinelyToken)) revert InvalidToken();
        // Never let the allowlist be used to call a token or the vault itself.
        if (swapRouter == tokenIn || swapRouter == address(this) || swapRouter == address(pinelyToken)) {
            revert InvalidRouter();
        }
        if (swapData.length < 4 || !isRouteActive(swapRouter, bytes4(swapData[:4]))) revert RouteNotActive();

        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        if (balance < amountIn) revert InsufficientBalance();

        _consumeBuybackAllowance(tokenIn, balance, amountIn);

        uint256 pinelyBefore = pinelyToken.balanceOf(address(this));

        // Grant the swap router an allowance for exactly this swap
        IERC20(tokenIn).forceApprove(swapRouter, amountIn);

        // Execute the swap
        (bool success,) = swapRouter.call(swapData);
        if (!success) revert SwapFailed();

        // A leftover allowance would outlive the swap, so it is always cleared.
        IERC20(tokenIn).forceApprove(swapRouter, 0);

        // The swap may only have spent what was approved.
        if (IERC20(tokenIn).balanceOf(address(this)) + amountIn < balance) revert SpentMoreThanApproved();

        uint256 pinelyAfter = pinelyToken.balanceOf(address(this));
        if (pinelyAfter <= pinelyBefore) revert ZeroTokenBought();

        pinelyBurned = pinelyAfter - pinelyBefore;
        if (pinelyBurned < minPinelyOut) revert SlippageExceeded();

        totalBurned += pinelyBurned;
        pinelyToken.safeTransfer(DEAD_ADDRESS, pinelyBurned);

        emit Burned(pinelyBurned);
    }

    /// @dev Opens a new window when none is running, then charges `amountIn` against the window's cap.
    function _consumeBuybackAllowance(address tokenIn, uint256 balance, uint256 amountIn) private {
        BuybackWindow storage window = _windows[tokenIn];
        // forge-lint: disable-next-line(block-timestamp)
        if (window.start == 0 || block.timestamp >= uint256(window.start) + BUYBACK_WINDOW) {
            // forge-lint: disable-next-line(unsafe-typecast)
            window.start = uint64(block.timestamp);
            window.base = balance;
            window.spent = 0;
        }

        uint256 cap = (window.base * MAX_BUYBACK_BPS_PER_DAY) / BPS;
        if (window.spent + amountIn > cap) revert BuybackCapExceeded();
        window.spent += amountIn;
    }

    function _routeKey(address router, bytes4 selector) private pure returns (bytes32) {
        return keccak256(abi.encode(router, selector));
    }
}
