// SPDX-License-Identifier: MIT
// @notice Pragma relaxed (^0.8.26, instead of exactly 0.8.34 like most contracts) so it compiles in the same
// unit as the Uniswap v4 PoolManager (=0.8.26) under test, exactly like PoolSeeder.
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/**
 * @title PinelyBuybackExecutor
 * @notice The only swap path the BurnVault uses for buybacks (audit finding C-30). It sells the vault's
 *         stablecoin for $PINELY in ONE fixed Uniswap v4 pool and sends every token of the result straight
 *         back to the vault. The pool, the payer and the recipient are all immutable.
 *
 * @dev Why this closes the exfiltration path. The BurnVault only allowlists the selector of `buyback`
 *      on this contract. The owner can therefore choose just two numbers, `amountIn` and `minPinelyOut`;
 *      there is no recipient, router, pool or calldata to choose, so no output can be sent anywhere but the
 *      vault. The contract is ownerless, has no setters and no upgrade path, and never holds a token:
 *      the input goes from the vault to the PoolManager and the output from the PoolManager to the vault.
 *
 *      Pool requirements. The pool must be a plain pool (no hooks, static fee) of exactly this pair. A hook
 *      could change swap behaviour, and the PinelyHook pool refuses every caller except PinelyRouter.
 *
 *      Residual risk (not removed by this contract): market risk. The owner still picks `minPinelyOut`
 *      and the swap executes at the pool price, so a manipulated or thin pool can give the vault a bad price.
 *      The vault's daily cap bounds that exposure, and `minPinelyOut` should come from a trusted quote.
 *      A time-weighted price check would need an oracle and is not part of this contract.
 *
 *      Tokens sent to this contract by mistake cannot be recovered: it has no owner and no rescue function.
 */
contract PinelyBuybackExecutor is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    /// @notice The only caller, the only payer and the only recipient.
    address public immutable burnVault;
    address public immutable pinelyToken;
    address public immutable stablecoin;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    address private immutable _currency0;
    address private immutable _currency1;
    bool private immutable _stablecoinIsCurrency0;

    event BuybackExecuted(uint256 stablecoinIn, uint256 pinelyOut);

    error ZeroAddress();
    error InvalidPoolConfig();
    error NotBurnVault();
    error NotAuthorized();
    error InvalidAmount();
    error ZeroMinOut();
    error SlippageExceeded();
    error UnexpectedDelta();

    constructor(
        address _poolManager,
        address _burnVault,
        address _pinelyToken,
        address _stablecoin,
        uint24 _fee,
        int24 _tickSpacing
    ) {
        if (
            _poolManager == address(0) || _burnVault == address(0) || _pinelyToken == address(0)
                || _stablecoin == address(0)
        ) {
            revert ZeroAddress();
        }
        if (_poolManager.code.length == 0) revert InvalidPoolConfig();
        if (_pinelyToken == _stablecoin) revert InvalidPoolConfig();
        // A static fee only: `MAX_LP_FEE` also rejects the dynamic-fee flag, which is larger.
        if (_fee > LPFeeLibrary.MAX_LP_FEE) revert InvalidPoolConfig();
        if (_tickSpacing < TickMath.MIN_TICK_SPACING || _tickSpacing > TickMath.MAX_TICK_SPACING) {
            revert InvalidPoolConfig();
        }

        poolManager = IPoolManager(_poolManager);
        burnVault = _burnVault;
        pinelyToken = _pinelyToken;
        stablecoin = _stablecoin;
        fee = _fee;
        tickSpacing = _tickSpacing;

        bool stableFirst = _stablecoin < _pinelyToken;
        _stablecoinIsCurrency0 = stableFirst;
        _currency0 = stableFirst ? _stablecoin : _pinelyToken;
        _currency1 = stableFirst ? _pinelyToken : _stablecoin;
    }

    /// @notice The one pool this contract can ever swap in. Currencies are sorted, hooks are the zero address.
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(_currency0),
            currency1: Currency.wrap(_currency1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });
    }

    /**
     * @notice Sells `amountIn` of the stablecoin from the BurnVault for $PINELY and sends it to the vault.
     * @dev Callable only by the BurnVault, which must have approved this contract for `amountIn`.
     * @param amountIn Stablecoin to sell (exact input).
     * @param minPinelyOut Minimum $PINELY the vault must receive. Zero is rejected.
     * @return pinelyOut $PINELY received by the vault.
     */
    function buyback(uint256 amountIn, uint256 minPinelyOut) external nonReentrant returns (uint256 pinelyOut) {
        if (msg.sender != burnVault) revert NotBurnVault();
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert InvalidAmount();
        if (minPinelyOut == 0) revert ZeroMinOut();

        // forge-lint: disable-next-line(reentrancy-no-eth)
        bytes memory result = poolManager.unlock(abi.encode(amountIn, minPinelyOut));
        uint256 stablecoinIn;
        (stablecoinIn, pinelyOut) = abi.decode(result, (uint256, uint256));

        emit BuybackExecuted(stablecoinIn, pinelyOut);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAuthorized();

        (uint256 amountIn, uint256 minPinelyOut) = abi.decode(data, (uint256, uint256));
        PoolKey memory key = poolKey();
        bool zeroForOne = _stablecoinIsCurrency0;

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        int128 rawIn = zeroForOne ? delta.amount0() : delta.amount1();
        int128 rawOut = zeroForOne ? delta.amount1() : delta.amount0();

        // PoolManager convention for an exact-input swap: the caller owes the input (negative delta) and is
        // owed the output (positive delta). Anything else is rejected instead of being "corrected".
        if (rawIn > 0 || rawOut < 0) revert UnexpectedDelta();
        uint256 stablecoinIn = uint256(uint128(-rawIn));
        uint256 pinelyOut = uint256(uint128(rawOut));
        if (stablecoinIn > amountIn) revert UnexpectedDelta();
        if (pinelyOut < minPinelyOut) revert SlippageExceeded();

        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = zeroForOne ? key.currency1 : key.currency0;

        // 1. Pay the input from the vault straight to the PoolManager.
        poolManager.sync(currencyIn);
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        IERC20(stablecoin).safeTransferFrom(burnVault, address(poolManager), stablecoinIn);
        // forge-lint: disable-next-line(unused-return)
        poolManager.settle();

        // 2. Take the whole output straight to the vault.
        poolManager.take(currencyOut, burnVault, pinelyOut);

        return abi.encode(stablecoinIn, pinelyOut);
    }
}
