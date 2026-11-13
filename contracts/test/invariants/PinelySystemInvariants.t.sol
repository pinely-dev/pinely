// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PinelyHandler, HandlerConfig, MockTestTokenInv, MockStakeInv, MockPoolManagerInv} from "./PinelyHandler.sol";
import {PinelyRouter} from "../../src/PinelyRouter.sol";
import {PinelyHook} from "../../src/PinelyHook.sol";
import {PinelyPaymaster} from "../../src/PinelyPaymaster.sol";
import {MachineRegistry} from "../../src/MachineRegistry.sol";
import {IMachineRegistry} from "../../src/interfaces/IMachineRegistry.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";

contract PinelySystemInvariants is StdInvariant, Test {
    PinelyHandler public handler;

    MachineRegistry public registry;
    PinelyRouter public router;
    PinelyHook public hook;
    PinelyPaymaster public paymaster;
    MockStakeInv public stakeContract;
    MockPoolManagerInv public poolManager;
    MockTestTokenInv public tokenIn;
    MockTestTokenInv public usdc;

    address public owner = address(0xAA1);
    address public treasury = address(0xAA2);
    address public burnVault = address(0xAA3);
    address public operator = address(0xBB1);
    uint256 public machineAccountPk = 0xACC1;
    address public machineAccount;

    uint256 public signerPk = 0x516;
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
        machineSigner = vm.addr(signerPk);

        tokenIn = new MockTestTokenInv("Revenue Token", "REV");
        usdc = new MockTestTokenInv("USDC", "USDC");

        poolManager = new MockPoolManagerInv();

        vm.prank(owner);
        registry = new MachineRegistry(owner);

        stakeContract = new MockStakeInv();
        vm.prank(owner);
        registry.setStakeContract(address(stakeContract));

        // Sort currencies
        address c0 = address(tokenIn) < address(usdc) ? address(tokenIn) : address(usdc);
        address c1 = address(tokenIn) < address(usdc) ? address(usdc) : address(tokenIn);

        // Precompute Router address
        address routerAddress = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);

        // Mine Hook address
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

        router = new PinelyRouter(address(poolManager), address(registry), address(hook), address(usdc));

        poolManager.setHook(hook);

        vm.prank(owner);
        registry.setHook(address(hook));

        poolKey =
            PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 0, tickSpacing: 60, hooks: hook});

        // Register default machine
        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy({
            maxStableOutPerSwap: 50e18, // 50 USDC per swap
            dailyStableOutCap: 150e18, // 150 USDC per day
            enabled: true
        });

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

        // Allow input token
        vm.prank(operator);
        registry.setAssetAllowed(machineId, address(tokenIn), true);

        // Deploy Paymaster
        address mockEntryPoint = address(0xEEE7172);
        vm.prank(owner);
        paymaster = new PinelyPaymaster(mockEntryPoint, address(registry), address(usdc), treasury, owner);

        // Seed liquidity for poolManager
        usdc.mint(address(poolManager), 1_000_000e18);

        // Deploy handler and target it for invariants
        HandlerConfig memory cfg = HandlerConfig({
            registry: registry,
            router: router,
            hook: hook,
            paymaster: paymaster,
            stakeContract: stakeContract,
            poolManager: poolManager,
            tokenIn: tokenIn,
            usdc: usdc,
            owner: owner,
            operator: operator,
            machineAccount: machineAccount,
            treasury: treasury,
            burnVault: burnVault,
            signerPk: signerPk,
            machineId: machineId,
            poolKey: poolKey
        });

        handler = new PinelyHandler(cfg);

        targetContract(address(handler));
    }

    // --- Invariant 1: INV-08 Router Never Holds Funds ---
    function invariant_INV08_RouterNeverHoldsFunds() public view {
        assertEq(tokenIn.balanceOf(address(router)), 0, "INV-08: Router holds tokenIn");
        assertEq(usdc.balanceOf(address(router)), 0, "INV-08: Router holds USDC");
    }

    // --- Invariant 2: INV-03 Daily Spend Never Exceeds Daily Cap ---
    function invariant_INV03_DailySpendNeverExceedsCap() public view {
        uint64 day = uint64(block.timestamp / 1 days);
        uint256 spentToday = registry.dailySpent(machineId, day);
        IMachineRegistry.SpendPolicy memory policy = registry.getPolicy(machineId);

        if (policy.dailyStableOutCap > 0) {
            assertTrue(spentToday <= policy.dailyStableOutCap, "INV-03: daily spent exceeded cap");
        }
    }

    // --- Invariant 3: INV-05 Protocol Fees Split (80% Treasury, 20% BurnVault) ---
    function invariant_INV05_ProtocolFeesAccruedSplit() public view {
        uint256 treasuryBalance = usdc.balanceOf(treasury);
        assertEq(treasuryBalance, handler.ghostTotalTreasuryFees(), "INV-05: Treasury fee mismatch");
        uint256 burnVaultBalance = usdc.balanceOf(burnVault);
        assertEq(burnVaultBalance, handler.ghostTotalBurnFees(), "INV-05: BurnVault fee mismatch");
    }

    // --- Invariant 4: INV-10 Gold Tier Requires All Strict Criteria ---
    function invariant_INV10_GoldTierIntegrity() public view {
        IMachineRegistry.Tier tier = registry.tierOf(machineId);
        if (tier == IMachineRegistry.Tier.Gold) {
            IMachineRegistry.Machine memory m = registry.getMachine(machineId);
            assertTrue(m.attestationValid, "INV-10: Gold without valid attestation");
            assertTrue((block.timestamp - m.registeredAt) >= 90 days, "INV-10: Gold before 90 days");
            assertTrue(stakeContract.hasMinStakeGold(operator), "INV-10: Gold without operator stake");
        }
    }

    // --- Invariant 5: INV-11 Paymaster Credits Non-Negative ---
    function invariant_INV11_PaymasterCreditIntegrity() public view {
        uint256 credit = paymaster.creditOf(machineAccount);
        // creditOf is uint256 so cannot be negative, verify contract has sufficient USDC backing
        assertTrue(usdc.balanceOf(address(paymaster)) >= credit, "INV-11: USDC undercollateralized");
    }
}
