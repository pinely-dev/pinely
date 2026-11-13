// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyRouter} from "../src/PinelyRouter.sol";
import {PinelyHook} from "../src/PinelyHook.sol";
import {PoolSeeder} from "../src/PoolSeeder.sol";
import {MachineRegistry, IPinelyStake} from "../src/MachineRegistry.sol";
import {IMachineRegistry} from "../src/interfaces/IMachineRegistry.sol";
import {IPinelyRouter} from "../src/interfaces/IPinelyRouter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ForkTestToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ForkStakeStub is IPinelyStake {
    function hasMinStakeGold(address) external pure override returns (bool) {
        return false;
    }
}

/**
 * @title Stage2RealPoolManagerFork
 * @notice Runs PinelyHook, PinelyRouter and PoolSeeder against the REAL Uniswap v4 PoolManager that is deployed on
 *         Robinhood Chain mainnet (forked), not against the hand-written MockPoolManager of
 *         PinelyRouterAndHook.t.sol. The hook is deployed through the same deterministic CREATE2 deployer the
 *         deploy script uses. Only fresh test tokens and a fresh registry are created; nothing is sent to the chain.
 *
 *         Needs a network, so it runs only when `RPC_URL_ROBINHOOD_MAINNET` is set and is skipped otherwise:
 *           RPC_URL_ROBINHOOD_MAINNET=<endpoint> forge test --match-contract Stage2RealPoolManagerFork -vv
 */
contract Stage2RealPoolManagerFork is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2**96

    MachineRegistry internal registry;
    PinelyRouter internal router;
    PinelyHook internal hook;
    PoolSeeder internal seeder;
    ForkTestToken internal tokenIn;
    ForkTestToken internal usdc;

    address internal owner = address(0xAA1);
    address internal treasury = address(0xAA2);
    address internal burnVault = address(0xAA3);
    address internal operator = address(0xBB1);

    uint256 internal machineAccountPk = 0xACC1;
    address internal machineAccount;
    uint256 internal signerPrivateKey = 0x516;
    address internal machineSigner;

    bytes32 internal machineId;
    PoolKey internal poolKey;

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL_ROBINHOOD_MAINNET", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, ROBINHOOD_MAINNET_CHAIN_ID, "the fork must be Robinhood Chain mainnet");
        assertGt(POOL_MANAGER.code.length, 0, "no bytecode at the Uniswap v4 PoolManager");
        assertGt(CREATE2_DEPLOYER.code.length, 0, "no deterministic CREATE2 deployer on this chain");

        machineAccount = vm.addr(machineAccountPk);
        machineSigner = vm.addr(signerPrivateKey);

        tokenIn = new ForkTestToken("Revenue Token", "REV");
        usdc = new ForkTestToken("Stablecoin", "USDG");

        vm.prank(owner);
        registry = new MachineRegistry(owner);
        // The stub is created before the prank: `new` inside the call arguments would consume it.
        address stakeStub = address(new ForkStakeStub());
        vm.prank(owner);
        registry.setStakeContract(stakeStub);

        // Router address is predicted from this contract's nonce. Mining and deploying the hook through the CREATE2
        // deployer consumes one nonce of this contract (measured: 4 before, 5 at the router), as in the deploy script,
        // so the router is created at nonce + 1. The require below guards the prediction.
        address routerAddress = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);

        uint160 hookFlags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER), routerAddress, address(registry), address(usdc), treasury, burnVault
        );
        (address minedHook, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, hookFlags, type(PinelyHook).creationCode, constructorArgs);

        (bool ok,) = CREATE2_DEPLOYER.call(
            abi.encodePacked(salt, abi.encodePacked(type(PinelyHook).creationCode, constructorArgs))
        );
        require(ok, "hook deployment through the CREATE2 deployer failed");
        require(minedHook.code.length > 0, "no hook bytecode at the mined address");
        hook = PinelyHook(minedHook);

        router = new PinelyRouter(POOL_MANAGER, address(registry), address(hook), address(usdc));
        require(address(router) == routerAddress, "Router address mismatch");

        vm.prank(owner);
        registry.setHook(address(hook));

        seeder = new PoolSeeder(POOL_MANAGER, address(this));

        address c0 = address(tokenIn) < address(usdc) ? address(tokenIn) : address(usdc);
        address c1 = address(tokenIn) < address(usdc) ? address(usdc) : address(tokenIn);
        poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });

        // Register the default machine.
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
        vm.prank(operator);
        registry.setAssetAllowed(machineId, address(tokenIn), true);

        tokenIn.mint(machineAccount, 1_000e18);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

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

    function _buildSwapRequest(uint128 amountIn, uint128 minOut, uint256 nonce)
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
            deadline: uint64(block.timestamp + 300),
            chainId: block.chainid
        });
        bytes memory sig = _signIntent(signerPrivateKey, intent);
        return IPinelyRouter.SwapRequest({
            key: poolKey,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            minAmountOut: minOut,
            hookData: abi.encode(intent, sig)
        });
    }

    /// @dev Initialises the pool on the real PoolManager, authorises the seeder as an LP (as the Safe will do with
    ///      the treasury) and seeds liquidity around the 1:1 price.
    function _initialiseAndSeed() internal {
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_1_1);

        vm.prank(treasury);
        hook.setAuthorizedLp(address(seeder), true);

        tokenIn.mint(address(this), 1_000_000e18);
        usdc.mint(address(this), 1_000_000e18);
        tokenIn.approve(address(seeder), type(uint256).max);
        usdc.approve(address(seeder), type(uint256).max);
        seeder.seed(poolKey, -6000, 6000, 10_000e18, address(this), address(this));
    }

    // ---------------------------------------------------------------------
    // Tests against the real PoolManager
    // ---------------------------------------------------------------------

    function test_Fork_Hook_IsMinedAndPermissionsMatchTheRealPoolManager() public view {
        uint160 flags = uint160(address(hook)) & Hooks.ALL_HOOK_MASK;
        uint160 expected = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );
        assertEq(flags, expected, "the mined hook address must carry exactly the four hook flags");
    }

    function test_Fork_Initialize_PoolWithTheHookSucceedsOnTheRealPoolManager() public {
        int24 tick = IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_1_1);
        assertEq(tick, 0);
    }

    function test_Fork_Seed_RevertsBeforeTheSeederIsAuthorised() public {
        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_1_1);
        tokenIn.mint(address(this), 1_000_000e18);
        usdc.mint(address(this), 1_000_000e18);
        tokenIn.approve(address(seeder), type(uint256).max);
        usdc.approve(address(seeder), type(uint256).max);
        vm.expectRevert();
        seeder.seed(poolKey, -6000, 6000, 10_000e18, address(this), address(this));
    }

    function test_Fork_Swap_EndToEndThroughTheRealPoolManager() public {
        _initialiseAndSeed();

        uint128 swapAmount = 10e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(swapAmount, 9e18, 1);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), swapAmount);
        uint256 amountOut = router.swap(req);
        vm.stopPrank();

        // The machine received the net stablecoin amount and paid exactly the input.
        assertGt(amountOut, 9e18, "output below the signed minimum");
        assertEq(usdc.balanceOf(machineAccount), amountOut);
        assertEq(tokenIn.balanceOf(machineAccount), 1_000e18 - swapAmount);

        // The protocol fee (0.05% of the output) was split 80% treasury / 20% BurnVault.
        uint256 grossOut = amountOut * 1_000_000 / (1_000_000 - 500);
        uint256 protocolFee = grossOut * 500 / 1_000_000;
        assertApproxEqAbs(usdc.balanceOf(treasury) + usdc.balanceOf(burnVault), protocolFee, 2);
        assertGt(usdc.balanceOf(treasury), usdc.balanceOf(burnVault));

        // The Spend Policy recorded a spend for the day.
        assertGt(registry.dailySpent(machineId, uint64(block.timestamp / 1 days)), 0);

        // The router holds nothing and the PoolManager delta settled to zero (the swap did not revert).
        assertEq(tokenIn.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_Fork_Swap_ReplayedNonceReverts() public {
        _initialiseAndSeed();

        uint128 swapAmount = 10e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(swapAmount, 9e18, 7);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), uint256(swapAmount) * 2);
        router.swap(req);
        vm.expectRevert();
        router.swap(req);
        vm.stopPrank();
    }

    function test_Fork_Swap_FromAnotherCallerCannotUseTheMachineIntent() public {
        _initialiseAndSeed();

        uint128 swapAmount = 10e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(swapAmount, 9e18, 9);

        address stranger = address(0xFF1);
        tokenIn.mint(stranger, 100e18);
        vm.startPrank(stranger);
        tokenIn.approve(address(router), swapAmount);
        vm.expectRevert();
        router.swap(req);
        vm.stopPrank();
    }

    function test_Fork_Swap_FrozenMachineReverts() public {
        _initialiseAndSeed();

        vm.prank(operator);
        registry.freezeMachine(machineId);

        uint128 swapAmount = 10e18;
        IPinelyRouter.SwapRequest memory req = _buildSwapRequest(swapAmount, 9e18, 11);

        vm.startPrank(machineAccount);
        tokenIn.approve(address(router), swapAmount);
        vm.expectRevert();
        router.swap(req);
        vm.stopPrank();
    }
}
