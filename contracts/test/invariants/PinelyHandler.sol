// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyRouter} from "../../src/PinelyRouter.sol";
import {PinelyHook} from "../../src/PinelyHook.sol";
import {PinelyPaymaster} from "../../src/PinelyPaymaster.sol";
import {MachineRegistry, IPinelyStake} from "../../src/MachineRegistry.sol";
import {IMachineRegistry} from "../../src/interfaces/IMachineRegistry.sol";
import {IPinelyRouter} from "../../src/interfaces/IPinelyRouter.sol";
import {IPinelyHook} from "../../src/interfaces/IPinelyHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MockTestTokenInv is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockStakeInv is IPinelyStake {
    mapping(address => bool) public hasStake;

    function setStake(address op, bool val) external {
        hasStake[op] = val;
    }

    function hasMinStakeGold(address op) external view override returns (bool) {
        return hasStake[op];
    }
}

contract MockPoolManagerInv {
    PinelyHook public hook;

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
        hook.beforeSwap(msg.sender, key, params, hookData);

        uint128 inAmount = uint128(uint256(-params.amountSpecified));
        uint128 outAmount = inAmount; // 1:1 rate

        int128 delta0 = params.zeroForOne ? -int128(inAmount) : int128(outAmount);
        int128 delta1 = params.zeroForOne ? int128(outAmount) : -int128(inAmount);
        BalanceDelta delta = toBalanceDelta(delta0, delta1);

        hook.afterSwap(msg.sender, key, params, delta, hookData);
        return delta;
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        ERC20(Currency.unwrap(currency)).transfer(to, amount);
    }

    fallback() external payable {}
    receive() external payable {}
}

struct HandlerConfig {
    MachineRegistry registry;
    PinelyRouter router;
    PinelyHook hook;
    PinelyPaymaster paymaster;
    MockStakeInv stakeContract;
    MockPoolManagerInv poolManager;
    MockTestTokenInv tokenIn;
    MockTestTokenInv usdc;
    address owner;
    address operator;
    address machineAccount;
    address treasury;
    address burnVault;
    uint256 signerPk;
    bytes32 machineId;
    PoolKey poolKey;
}

contract PinelyHandler is Test {
    using PoolIdLibrary for PoolKey;
    using MessageHashUtils for bytes32;

    MachineRegistry public registry;
    PinelyRouter public router;
    PinelyHook public hook;
    PinelyPaymaster public paymaster;
    MockStakeInv public stakeContract;
    MockPoolManagerInv public poolManager;
    MockTestTokenInv public tokenIn;
    MockTestTokenInv public usdc;

    address public owner;
    address public operator;
    address public machineAccount;
    address public treasury;
    address public burnVault;

    uint256 public signerPk;
    address public machineSigner;

    bytes32 public machineId;
    PoolKey public poolKey;

    uint256 public currentNonce = 1;

    // Ghost Tracking
    uint256 public ghostTotalSwapsSuccessful;
    uint256 public ghostTotalVolumeUsdc;
    uint256 public ghostTotalProtocolFees;
    uint256 public ghostTotalTreasuryFees;
    uint256 public ghostTotalBurnFees;

    constructor(HandlerConfig memory cfg) {
        registry = cfg.registry;
        router = cfg.router;
        hook = cfg.hook;
        paymaster = cfg.paymaster;
        stakeContract = cfg.stakeContract;
        poolManager = cfg.poolManager;
        tokenIn = cfg.tokenIn;
        usdc = cfg.usdc;
        owner = cfg.owner;
        operator = cfg.operator;
        machineAccount = cfg.machineAccount;
        treasury = cfg.treasury;
        burnVault = cfg.burnVault;
        signerPk = cfg.signerPk;
        machineSigner = vm.addr(cfg.signerPk);
        machineId = cfg.machineId;
        poolKey = cfg.poolKey;
    }

    function executeSwap(uint128 amountIn) public {
        // Bound swap amount: [1 USDC, 60 USDC]
        amountIn = uint128(bound(uint256(amountIn), 1e18, 60e18));

        // Ensure machine account has tokens and approval
        tokenIn.mint(machineAccount, amountIn);
        vm.prank(machineAccount);
        tokenIn.approve(address(router), amountIn);

        uint256 nonce = currentNonce++;
        bool zeroForOne = Currency.unwrap(poolKey.currency0) == address(tokenIn);

        IPinelyRouter.SwapIntent memory intent = IPinelyRouter.SwapIntent({
            machineId: machineId,
            poolId: PoolId.unwrap(poolKey.toId()),
            tokenIn: address(tokenIn),
            tokenOut: address(usdc),
            amountIn: amountIn,
            minAmountOut: uint128((uint256(amountIn) * 95) / 100), // 5% slippage tolerance
            nonce: nonce,
            // forge-lint: disable-next-line(block-timestamp)
            deadline: uint64(block.timestamp + 3600),
            chainId: block.chainid
        });

        bytes memory sig = _signIntent(intent);
        bytes memory hookData = abi.encode(intent, sig);

        IPinelyRouter.SwapRequest memory req = IPinelyRouter.SwapRequest({
            key: poolKey,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            minAmountOut: uint128(intent.minAmountOut),
            hookData: hookData
        });

        vm.prank(machineAccount);
        try router.swap(req) returns (uint256 out) {
            ghostTotalSwapsSuccessful++;
            ghostTotalVolumeUsdc += out;
            uint256 protocolFee = (uint256(amountIn) * 500) / 1_000_000;
            uint256 burnFee = (protocolFee * 2000) / 10000;
            uint256 treasuryFee = protocolFee - burnFee;
            ghostTotalProtocolFees += protocolFee;
            ghostTotalTreasuryFees += treasuryFee;
            ghostTotalBurnFees += burnFee;
        } catch {
            // Reverts are expected when frozen, asset disallowed, or cap exceeded
        }
    }

    function toggleFreezeMachine(bool freeze) public {
        vm.prank(operator);
        if (freeze) {
            registry.freezeMachine(machineId);
        } else {
            registry.unfreezeMachine(machineId);
        }
    }

    function toggleFreezeFleet(bool freeze) public {
        vm.prank(operator);
        if (freeze) {
            registry.freezeFleet();
        } else {
            registry.unfreezeFleet();
        }
    }

    function warpDays(uint8 daysToWarp) public {
        uint256 jump = bound(uint256(daysToWarp), 1, 30);
        vm.warp(vm.getBlockTimestamp() + jump * 1 days);
    }

    function toggleStake(bool hasMinStake) public {
        stakeContract.setStake(operator, hasMinStake);
    }

    function depositPaymasterCredit(uint64 amount) public {
        uint256 amt = bound(uint256(amount), 1e6, 500e6);
        usdc.mint(operator, amt);
        vm.startPrank(operator);
        usdc.approve(address(paymaster), amt);
        paymaster.depositCredit(machineAccount, amt);
        vm.stopPrank();
    }

    function _signIntent(IPinelyRouter.SwapIntent memory intent) internal view returns (bytes memory) {
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
}
