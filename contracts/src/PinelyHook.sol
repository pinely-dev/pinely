// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPinelyHook} from "./interfaces/IPinelyHook.sol";
import {IPinelyRouter} from "./interfaces/IPinelyRouter.sol";
import {IMachineRegistry} from "./interfaces/IMachineRegistry.sol";

/**
 * @title PinelyHook
 * @notice Canonical Uniswap v4 Hook for machine pools in the PINELY ecosystem.
 *         Immutable, ownerless, not upgradeable.
 *         Enforces 4 rules before a swap can happen:
 *         1. Machine Gate (PinelyRouter only, EIP-712 signature & nonce validation)
 *         2. Kill Switch (machine & fleet freeze status)
 *         3. Input token allowlist
 *         4. Dynamic Reputation Tier fee & 0.05% Protocol Fee
 */
contract PinelyHook is BaseHook, EIP712, IPinelyHook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    bytes32 public constant SWAP_INTENT_TYPEHASH = keccak256(
        "SwapIntent(bytes32 machineId,bytes32 poolId,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint64 deadline,uint256 chainId)"
    );

    // LP fee per tier (in 1e6 basis: 100% = 1_000_000)
    uint24 public constant FEE_BRONZE = 3000; // 0.30%
    uint24 public constant FEE_SILVER = 1500; // 0.15%
    uint24 public constant FEE_GOLD = 500; // 0.05%

    // Protocol Fee (0.05%)
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 0.05% in 1e6 basis

    address public immutable router;
    IMachineRegistry public immutable registry;
    address public immutable stablecoin;
    address public immutable treasury;
    address public immutable burnVault;

    mapping(bytes32 => mapping(uint256 => bool)) public isNonceUsed;
    mapping(address => bool) public override isAuthorizedLp;

    constructor(
        IPoolManager _manager,
        address _router,
        address _registry,
        address _stablecoin,
        address _treasury,
        address _burnVault
    ) BaseHook(_manager) EIP712("PINELY", "1") {
        if (
            _router == address(0) || _registry == address(0) || _stablecoin == address(0) || _treasury == address(0)
                || _burnVault == address(0)
        ) {
            revert ZeroAddress();
        }

        router = _router;
        registry = IMachineRegistry(_registry);
        stablecoin = _stablecoin;
        treasury = _treasury;
        burnVault = _burnVault;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // --- 1. Machine Gate ---
        if (sender != router) revert NotRouter();
        if (address(key.hooks) != address(this)) revert HookMismatch();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 != stablecoin && c1 != stablecoin) revert MissingStablecoin();

        (IPinelyRouter.SwapIntent memory intent, bytes memory signature) =
            abi.decode(hookData, (IPinelyRouter.SwapIntent, bytes));

        if (intent.chainId != block.chainid) revert InvalidChainId();

        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > intent.deadline) revert IntentExpired();

        if (intent.poolId != PoolId.unwrap(key.toId())) revert PoolMismatch();

        if (isNonceUsed[intent.machineId][intent.nonce]) revert NonceAlreadyUsed();
        isNonceUsed[intent.machineId][intent.nonce] = true;

        bytes32 structHash = keccak256(
            abi.encode(
                SWAP_INTENT_TYPEHASH,
                intent.machineId,
                intent.poolId,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.nonce,
                intent.deadline,
                intent.chainId
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);

        IMachineRegistry.Machine memory m = registry.getMachine(intent.machineId);
        if (recoveredSigner != m.signer) revert InvalidSignature();

        // --- 2. Kill Switch ---
        if (registry.isFrozen(intent.machineId)) revert MachineFrozen();

        // --- 3. Allowlist Input Token ---
        if (!registry.isAssetAllowed(intent.machineId, intent.tokenIn)) revert AssetNotAllowed();

        // --- 4. Dynamic Reputation Tier ---
        IMachineRegistry.Tier tier = registry.tierOf(intent.machineId);
        uint24 lpFee = _feeForTier(tier);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, lpFee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        (IPinelyRouter.SwapIntent memory intent,) = abi.decode(hookData, (IPinelyRouter.SwapIntent, bytes));

        int128 outAmount = params.zeroForOne ? delta.amount1() : delta.amount0();
        // Delta sign defence: handle both positive and negative sign conventions defensively
        uint128 absOut = outAmount < 0 ? uint128(-outAmount) : uint128(outAmount);
        uint256 stablecoinOut = uint256(absOut);

        // Record the spend in the registry (Spend Policy)
        // forge-lint: disable-next-line(unused-return)
        registry.consumeSpend(intent.machineId, stablecoinOut);

        // The protocol fee is computed and taken in PinelyRouter.unlockCallback
        // so the PoolManager transient delta settles to 0.
        uint256 protocolFee = (stablecoinOut * PROTOCOL_FEE_BPS) / 1_000_000;
        if (protocolFee > 0) {
            // forge-lint: disable-next-line(reentrancy-events)
            emit ProtocolFeeCollected(intent.machineId, protocolFee);
        }

        return (BaseHook.afterSwap.selector, 0);
    }

    function _feeForTier(IMachineRegistry.Tier tier) internal pure returns (uint24) {
        if (tier == IMachineRegistry.Tier.Gold) return FEE_GOLD;
        if (tier == IMachineRegistry.Tier.Silver) return FEE_SILVER;
        return FEE_BRONZE;
    }

    /**
     * @notice Authorises official liquidity provider (LP) addresses for the PINELY pool.
     */
    function setAuthorizedLp(address lp, bool authorized) external override {
        if (msg.sender != treasury && msg.sender != router) revert NotRouter();
        isAuthorizedLp[lp] = authorized;
        emit LpAuthorized(lp, authorized);
    }

    /**
     * @notice Enforces protection against JIT liquidity and MEV fee stealing.
     *         Only the protocol Treasury, the router, or an authorised LP may add liquidity.
     */
    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != treasury && sender != router && !isAuthorizedLp[sender]) {
            revert UnauthorizedLp();
        }
        return BaseHook.beforeAddLiquidity.selector;
    }

    /**
     * @notice Prevents liquidity removal by unauthorised parties.
     */
    function _beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != treasury && sender != router && !isAuthorizedLp[sender]) {
            revert UnauthorizedLp();
        }
        return BaseHook.beforeRemoveLiquidity.selector;
    }
}
