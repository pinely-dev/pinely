// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyRouter} from "../src/PinelyRouter.sol";
import {PinelyHook} from "../src/PinelyHook.sol";
import {MachineRegistry, IPinelyStake} from "../src/MachineRegistry.sol";
import {IMachineRegistry} from "../src/interfaces/IMachineRegistry.sol";
import {IPinelyRouter} from "../src/interfaces/IPinelyRouter.sol";
import {IPinelyHook} from "../src/interfaces/IPinelyHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MockTestToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockStakeForTier is IPinelyStake {
    mapping(address => bool) public hasStake;

    function setStake(address op, bool val) external {
        hasStake[op] = val;
    }

    function hasMinStakeGold(address op) external view override returns (bool) {
        return hasStake[op];
    }
}

contract MockPoolManager {
    PinelyHook public hook;
    mapping(address => uint256) public synced;
    bool public invertDelta;

    function setInvertDelta(bool _invert) external {
        invertDelta = _invert;
    }

    function setHook(PinelyHook _hook) external {
        hook = _hook;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta)
    {
        // 1. Invoke beforeSwap hook
        hook.beforeSwap(msg.sender, key, params, hookData);

        // 1:1 rate
        uint128 inAmount = uint128(uint256(-params.amountSpecified));
        uint128 outAmount = inAmount;

        int128 delta0;
        int128 delta1;

        if (invertDelta) {
            // Canonical Uniswap v4 PoolManager convention:
            // Input token (paid by user to pool) is positive delta.
            // Output token (paid by pool to user) is negative delta.
            delta0 = params.zeroForOne ? int128(inAmount) : -int128(outAmount);
            delta1 = params.zeroForOne ? -int128(outAmount) : int128(inAmount);
        } else {
            delta0 = params.zeroForOne ? -int128(inAmount) : int128(outAmount);
            delta1 = params.zeroForOne ? int128(outAmount) : -int128(inAmount);
        }

        BalanceDelta delta = toBalanceDelta(delta0, delta1);

        // 2. Invoke afterSwap hook
        hook.afterSwap(msg.sender, key, params, delta, hookData);

        return delta;
    }

    function sync(Currency currency) external {
        synced[Currency.unwrap(currency)] = 1;
    }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        ERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    fallback() external payable {}
    receive() external payable {}
}

contract PinelyRouterAndHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using MessageHashUtils for bytes32;

    MachineRegistry public registry;
    MockStakeForTier public stakeContract;
    MockPoolManager public poolManager;
    PinelyRouter public router;
    PinelyHook public hook;

    MockTestToken public tokenIn;
    MockTestToken public usdc;

    address public owner = address(0xAA1);
    address public treasury = address(0xAA2);
    address public burnVault = address(0xAA3);
    address public operator = address(0xBB1);
    uint256 public machineAccountPk = 0xACC1;
    address public machineAccount;
    address public stranger = address(0xFF1);

    uint256 public signerPrivateKey = 0x516;
    address public machineSigner;

    bytes32 public machineId;
    PoolKey public poolKey;

    function _signRegisterAuth(address acc, address op, address sig, bytes32 attestation, uint256 accPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                registry.REGISTER_AUTHORIZATION_TYPEHASH(),
                acc,
                op,
                sig,
                attestation,
                registry.accountNonces(acc),
                block.timestamp + 1 hours,
                block.chainid
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(accPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function setUp() public {
        vm.warp(1_700_000_000);

        machineAccount = vm.addr(machineAccountPk);
        machineSigner = vm.addr(signerPrivateKey);

        tokenIn = new MockTestToken("Revenue Token", "REV");
        usdc = new MockTestToken("USDC", "USDC");

        poolManager = new MockPoolManager();

        vm.prank(owner);
        registry = new MachineRegistry(owner);

        stakeContract = new MockStakeForTier();
        vm.prank(owner);
        registry.setStakeContract(address(stakeContract));

        // Sort currencies: currency0 < currency1
        address c0 = address(tokenIn) < address(usdc) ? address(tokenIn) : address(usdc);
        address c1 = address(tokenIn) < address(usdc) ? address(usdc) : address(tokenIn);

        // Precompute Router address to feed into Hook constructor
        address routerAddress = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);

        // Mine Hook address with BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG | BEFORE_REMOVE_LIQUIDITY_FLAG
        uint160 hookFlags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );
        bytes memory constructorArgs = abi.encode(
            IPoolManager(address(poolManager)), routerAddress, address(registry), address(usdc), treasury, burnVault
        );

        (, bytes32 salt) = HookMiner.find(address(this), hookFlags, type(PinelyHook).creationCode, constructorArgs);

        hook = new PinelyHook{salt: salt}(
            IPoolManager(address(poolManager)), routerAddress, address(registry), address(usdc), treasury, burnVault
        );

        // Deploy Router at precomputed address
        router = new PinelyRouter(address(poolManager), address(registry), address(hook), address(usdc));
        require(address(router) == routerAddress, "Router address mismatch");

        poolManager.setHook(hook);

        vm.prank(owner);
        registry.setHook(address(hook));

        poolKey =
            PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 0, tickSpacing: 60, hooks: hook});

        // Register default machine
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true});

        bytes memory sig = _signRegisterAuth(
            machineAccount, operator, machineSigner, keccak256("hardware-attestation-pinely"), machineAccountPk
        );
        vm.prank(operator);
        machineId = registry.registerMachineWithAuth(
            machineAccount,
            machineSigner,
            keccak256("hardware-attestation-pinely"),
            policy,
            block.timestamp + 1 hours,
            sig
        );

        // Allow input token in registry
        vm.prank(operator);
        registry.setAssetAllowed(machineId, address(tokenIn), true);

        // Fund accounts
        tokenIn.mint(machineAccount, 1_000e18);
        usdc.mint(address(poolManager), 10_000e18); // Pool liquidity
    }

    // --- Helper to build the EIP-712 SwapIntent signature ---

    function _signIntent(uint256 signerPk, IPinelyRouter.SwapIntent memory intent)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                hook.SWAP_INTENT_TYPEHASH(),
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

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PINELY")),
                keccak256(bytes("1")),
                block.chainid,
                address(hook)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _buildSwapRequest(uint128 amountIn, uint128 minOut, uint256 nonce, uint256 pk)
        internal
        view
        returns (IPinelyRouter.SwapRequest memory req)
    {
        bool zeroForOne = Currency.unwrap(poolKey.currency0) == address(tokenIn);

        IPinelyRouter.SwapIntent memory intent = IPinelyRouter.SwapIntent({
            machineId: machineId,
            poolId: PoolId.unwrap(poolKey.toId()),
            tokenIn: address(tokenIn),
            tokenOut: address(usdc),
            amountIn: amountIn,
            minAmountOut: minOut,
            nonce: nonce,
            deadline: uint64(vm.getBlockTimestamp() + 300),
            chainId: block.chainid
        });

        bytes memory sig = _signIntent(pk, intent);
        bytes memory hookData = abi.encode(intent, sig);

        return IPinelyRouter.SwapRequest({
            key: poolKey, zeroForOne: zeroForOne, amountIn: amountIn, minAmountOut: minOut, hookData: hookData
        });
    }

    // --- End-to-End Successful Swap ---

    function test_RouterAndHook_Swap_Success() public {
        uint128 swapAmount = 10e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(swapAmount, 9e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), swapAmount);
        uint256 amountOut = router.swap(req);
        vm.stopPrank();

        uint256 expectedProtocolFee = (uint256(swapAmount) * 500) / 1_000_000;
        uint256 expectedBurnFee = (expectedProtocolFee * 2000) / 10000; // 20% BurnVault
        uint256 expectedTreasuryFee = expectedProtocolFee - expectedBurnFee; // 80% Treasury
        uint256 expectedNetAmountOut = uint256(swapAmount) - expectedProtocolFee;

        assertEq(amountOut, expectedNetAmountOut);
        assertEq(usdc.balanceOf(machineAccount), expectedNetAmountOut);
        assertEq(tokenIn.balanceOf(machineAccount), 1_000e18 - swapAmount);

        // Check Spend Policy spend consumed in registry
        uint64 day = uint64(block.timestamp / 1 days);
        assertEq(registry.dailySpent(machineId, day), swapAmount);

        // Check protocol fee split: 80% treasury, 20% burnVault
        assertEq(usdc.balanceOf(treasury), expectedTreasuryFee);
        assertEq(usdc.balanceOf(burnVault), expectedBurnFee);
    }

    // --- Machine Gate Reverts ---

    function test_Hook_RevertIf_NotRouter() public {
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        // Call from poolManager, but sender is stranger (not router)
        vm.prank(address(poolManager));
        vm.expectRevert(IPinelyHook.NotRouter.selector);
        hook.beforeSwap(stranger, poolKey, SwapParams(true, -10e18, 0), req.hookData);
    }

    function test_Hook_RevertIf_InvalidSignature() public {
        uint256 fakePk = 0xBAD;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, fakePk);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyHook.InvalidSignature.selector);
        router.swap(req);
        vm.stopPrank();
    }

    function test_Hook_RevertIf_NonceReplayed() public {
        IPinelyRouter.SwapRequest memory req1 = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 20e18);
        router.swap(req1);

        // Same nonce 1 again reverts
        vm.expectRevert(IPinelyHook.NonceAlreadyUsed.selector);
        router.swap(req1);
        vm.stopPrank();
    }

    function test_Hook_RevertIf_IntentExpired() public {
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        // Warp time past deadline
        vm.warp(block.timestamp + 301);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyRouter.IntentExpired.selector);
        router.swap(req);
        vm.stopPrank();
    }

    // --- Kill Switch Reverts ---

    function test_Hook_RevertIf_MachineFrozen() public {
        vm.prank(operator);
        registry.freezeMachine(machineId);

        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyHook.MachineFrozen.selector);
        router.swap(req);
        vm.stopPrank();
    }

    function test_Hook_RevertIf_FleetFrozen() public {
        vm.prank(operator);
        registry.freezeFleet();

        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyHook.MachineFrozen.selector);
        router.swap(req);
        vm.stopPrank();
    }

    // --- Allowlist Reverts ---

    function test_Hook_RevertIf_AssetNotAllowed() public {
        vm.prank(operator);
        registry.setAssetAllowed(machineId, address(tokenIn), false);

        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyHook.AssetNotAllowed.selector);
        router.swap(req);
        vm.stopPrank();
    }

    // --- Router Validations ---

    function test_Router_RevertIf_MachineIdMismatch() public {
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);

        // Stranger calls router with machineAccount's intent
        vm.startPrank(stranger);
        tokenIn.mint(stranger, 10e18);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyRouter.MachineIdMismatch.selector);
        router.swap(req);
        vm.stopPrank();
    }

    function test_Router_RevertIf_AmountMismatch() public {
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);
        // Tamper req.amountIn so it doesn't match signed intent
        req.amountIn = 11e18;

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 20e18);
        vm.expectRevert(IPinelyRouter.AmountMismatch.selector);
        router.swap(req);
        vm.stopPrank();
    }

    function test_Router_RevertIf_SlippageExceeded() public {
        // Minimum out set higher than swap return (15 USDC for 10 input)
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 15e18, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyRouter.SlippageExceeded.selector);
        router.swap(req);
        vm.stopPrank();
    }

    // --- Dynamic Tier Fees Verification ---

    function test_DynamicTier_Fees() public {
        // 1. Bronze (initial state) -> Fee 0.30% (3000)
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 9e18, 1, signerPrivateKey);
        vm.prank(address(poolManager));
        (,, uint24 lpFeeBronze) = hook.beforeSwap(address(router), poolKey, SwapParams(true, -10e18, 0), req.hookData);
        assertEq(lpFeeBronze & 0xBFFFFF, hook.FEE_BRONZE());

        // Give the machine transaction activity so it counts as active within 30 days
        vm.prank(address(hook));
        registry.consumeSpend(machineId, 1e18);

        // 2. Warp 30 days -> Silver -> Fee 0.15% (1500)
        vm.warp(vm.getBlockTimestamp() + 30 days);
        IPinelyRouter.SwapRequest memory reqSilver = _buildSwapRequest(10e18, 9e18, 2, signerPrivateKey);
        vm.prank(address(poolManager));
        (,, uint24 lpFeeSilver) =
            hook.beforeSwap(address(router), poolKey, SwapParams(true, -10e18, 0), reqSilver.hookData);
        assertEq(lpFeeSilver & 0xBFFFFF, hook.FEE_SILVER());

        // 3. Set Gold criteria (attestation valid, stake operator, 90 days)
        vm.prank(owner);
        registry.setAttestation(machineId, keccak256("hardware-attestation-pinely"), true);
        stakeContract.setStake(operator, true);
        vm.warp(vm.getBlockTimestamp() + 60 days);

        IPinelyRouter.SwapRequest memory reqGold = _buildSwapRequest(10e18, 9e18, 3, signerPrivateKey);
        vm.prank(address(poolManager));
        (,, uint24 lpFeeGold) = hook.beforeSwap(address(router), poolKey, SwapParams(true, -10e18, 0), reqGold.hookData);
        assertEq(lpFeeGold & 0xBFFFFF, hook.FEE_GOLD());
    }

    // --- Anti-JIT Liquidity & LP Protection ---

    function test_Hook_UnauthorizedLpReverted() public {
        address attacker = address(0xDEAD);
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1000, salt: bytes32(0)});

        // An outsider (attacker) is rejected when adding liquidity to the PINELY pool
        vm.prank(address(poolManager));
        vm.expectRevert(IPinelyHook.UnauthorizedLp.selector);
        hook.beforeAddLiquidity(attacker, poolKey, params, "");

        // The attacker is rejected when removing liquidity
        vm.prank(address(poolManager));
        vm.expectRevert(IPinelyHook.UnauthorizedLp.selector);
        hook.beforeRemoveLiquidity(attacker, poolKey, params, "");
    }

    function test_Hook_AuthorizedLpSuccess() public {
        address authorizedLp = address(0x1122);
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1000, salt: bytes32(0)});

        // LP authorised by the treasury
        vm.prank(treasury);
        hook.setAuthorizedLp(authorizedLp, true);
        assertTrue(hook.isAuthorizedLp(authorizedLp));

        // The authorised LP successfully calls beforeAddLiquidity
        vm.prank(address(poolManager));
        bytes4 selector = hook.beforeAddLiquidity(authorizedLp, poolKey, params, "");
        assertEq(selector, hook.beforeAddLiquidity.selector);
    }

    // --- Slippage Griefing Zero minAmountOut Protection ---

    function test_Router_ZeroMinAmountOutReverts() public {
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(10e18, 0, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), 10e18);
        vm.expectRevert(IPinelyRouter.SlippageExceeded.selector);
        router.swap(req);
        vm.stopPrank();
    }

    // --- Canonical Uniswap v4 Negative Output Delta Convention ---

    function test_RouterAndHook_Swap_CanonicalUniswapV4NegativeDelta() public {
        poolManager.setInvertDelta(true);

        uint128 amountIn = 10e18;
        uint128 minOut = 9.9e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(amountIn, minOut, 1, signerPrivateKey);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), amountIn);
        uint256 out = router.swap(req);
        vm.stopPrank();

        uint256 grossOut = 10e18;
        uint256 protocolFee = (grossOut * 500) / 1_000_000;
        uint256 expectedNet = grossOut - protocolFee;

        assertEq(out, expectedNet, "Net amount out mismatch under canonical Uniswap v4 negative delta");
        assertEq(usdc.balanceOf(machineAccount), expectedNet, "USDC balance mismatch under negative delta");

        // Verify that the Spend Policy consume-spend is recorded exactly
        uint64 day = uint64(block.timestamp / 1 days);
        assertEq(registry.dailySpent(machineId, day), grossOut, "Daily spent mismatch in registry");
    }
}
