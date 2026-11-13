// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {MachineRegistry} from "../src/MachineRegistry.sol";
import {IMachineRegistry} from "../src/interfaces/IMachineRegistry.sol";
import {SurplusSweeper} from "../src/SurplusSweeper.sol";
import {ISurplusSweeper} from "../src/interfaces/ISurplusSweeper.sol";
import {MockERC20} from "./utils/MockERC20.sol";

contract SurplusSweeperTest is Test {
    MachineRegistry public registry;
    SurplusSweeper public sweeper;
    MockERC20 public usdc;

    address public owner = address(0xAAAA);
    address public operator = address(0x0001);
    address public operatorVault = address(0x0002);
    uint256 public machineAccountPk = 0x0003;
    address public machineAccount;
    address public machineSigner = address(0x0004);
    address public stranger = address(0x9999);

    bytes32 public machineId;

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

    event MachineConfigSet(
        bytes32 indexed machineId,
        address indexed token,
        uint256 reserveThreshold,
        address indexed destination,
        bool enabled
    );
    event FleetConfigSet(
        address indexed operator,
        address indexed token,
        uint256 reserveThreshold,
        address indexed destination,
        bool enabled
    );
    event SurplusSwept(
        bytes32 indexed machineId,
        address indexed account,
        address indexed destination,
        address token,
        uint256 surplusAmount,
        uint256 reserveRemaining
    );

    function setUp() public {
        vm.warp(1_700_000_000);

        machineAccount = vm.addr(machineAccountPk);

        // 1. Deploy dependencies
        registry = new MachineRegistry(owner);
        usdc = new MockERC20("USDCLO Stablecoin", "USDC", 6);
        sweeper = new SurplusSweeper(address(registry), address(usdc));

        // 2. Register machine in registry
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 100_000e6, dailyStableOutCap: 500_000e6, enabled: true});

        bytes memory sig = _signRegisterAuth(
            machineAccount, operator, machineSigner, keccak256("hardware-attestation"), machineAccountPk
        );
        vm.prank(operator);
        machineId = registry.registerMachineWithAuth(
            machineAccount, machineSigner, keccak256("hardware-attestation"), policy, block.timestamp + 1 hours, sig
        );
    }

    // --- Constructor Tests ---

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(ISurplusSweeper.ZeroAddress.selector);
        new SurplusSweeper(address(0), address(usdc));

        vm.expectRevert(ISurplusSweeper.ZeroAddress.selector);
        new SurplusSweeper(address(registry), address(0));
    }

    // --- Configuration Tests ---

    function test_SetMachineConfig_Success() public {
        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit MachineConfigSet(machineId, address(usdc), 50e6, operatorVault, true);

        sweeper.setMachineConfig(machineId, address(0), 50e6, operatorVault, true);

        ISurplusSweeper.SweepConfig memory cfg = sweeper.getMachineConfig(machineId);
        assertEq(cfg.token, address(usdc));
        assertEq(cfg.reserveThreshold, 50e6);
        assertEq(cfg.destination, operatorVault);
        assertTrue(cfg.enabled);
    }

    function test_SetMachineConfig_RevertIf_NotOperator() public {
        vm.prank(stranger);
        vm.expectRevert(ISurplusSweeper.NotOperator.selector);
        sweeper.setMachineConfig(machineId, address(usdc), 50e6, operatorVault, true);
    }

    function test_SetMachineConfig_RevertIf_ZeroDestination() public {
        vm.prank(operator);
        vm.expectRevert(ISurplusSweeper.ZeroAddress.selector);
        sweeper.setMachineConfig(machineId, address(usdc), 50e6, address(0), true);
    }

    function test_SetMachineConfig_RevertIf_MachineNotFound() public {
        bytes32 unknownId = keccak256("unknown-machine");
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.MachineNotFound.selector);
        sweeper.setMachineConfig(unknownId, address(usdc), 50e6, operatorVault, true);
    }

    function test_SetFleetConfig_Success() public {
        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit FleetConfigSet(operator, address(usdc), 30e6, operatorVault, true);

        sweeper.setFleetConfig(address(0), 30e6, operatorVault, true);

        ISurplusSweeper.SweepConfig memory cfg = sweeper.getFleetConfig(operator);
        assertEq(cfg.token, address(usdc));
        assertEq(cfg.reserveThreshold, 30e6);
        assertEq(cfg.destination, operatorVault);
        assertTrue(cfg.enabled);
    }

    function test_SetFleetConfig_RevertIf_ZeroDestination() public {
        vm.prank(operator);
        vm.expectRevert(ISurplusSweeper.ZeroAddress.selector);
        sweeper.setFleetConfig(address(usdc), 30e6, address(0), true);
    }

    function test_EffectiveConfig_Priority() public {
        // Fleet config default
        vm.prank(operator);
        sweeper.setFleetConfig(address(usdc), 25e6, operatorVault, true);

        (ISurplusSweeper.SweepConfig memory cfgFleet, bool isCustom1) = sweeper.getEffectiveConfig(machineId);
        assertEq(cfgFleet.reserveThreshold, 25e6);
        assertFalse(isCustom1);

        // Machine specific config overrides fleet config
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 75e6, operatorVault, true);

        (ISurplusSweeper.SweepConfig memory cfgMachine, bool isCustom2) = sweeper.getEffectiveConfig(machineId);
        assertEq(cfgMachine.reserveThreshold, 75e6);
        assertTrue(isCustom2);
    }

    // --- Sweep Execution Tests ---

    function test_Sweep_Success() public {
        // Configure machine: reserve 20 USDC
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 20e6, operatorVault, true);

        // Mint 100 USDC to machine account, approve sweeper
        usdc.mint(machineAccount, 100e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        // Check sweepable surplus view
        (uint256 surplus, address token, address dest) = sweeper.getSweepableSurplus(machineId);
        assertEq(surplus, 80e6);
        assertEq(token, address(usdc));
        assertEq(dest, operatorVault);

        // Execute sweep (can be triggered by anyone, e.g. stranger / keeper)
        vm.expectEmit(true, true, true, true);
        emit SurplusSwept(machineId, machineAccount, operatorVault, address(usdc), 80e6, 20e6);

        vm.prank(stranger);
        uint256 swept = sweeper.sweep(machineId);

        assertEq(swept, 80e6);
        assertEq(usdc.balanceOf(machineAccount), 20e6); // The operating reserve stays safe
        assertEq(usdc.balanceOf(operatorVault), 80e6); // Surplus masuk ke vault operator
    }

    function test_Sweep_RevertIf_SweeperNotConfigured() public {
        usdc.mint(machineAccount, 100e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        vm.expectRevert(ISurplusSweeper.SweeperNotConfigured.selector);
        sweeper.sweep(machineId);
    }

    function test_Sweep_RevertIf_MachineFrozen() public {
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 20e6, operatorVault, true);

        usdc.mint(machineAccount, 100e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        // The operator freezes the machine via the Kill Switch
        vm.prank(operator);
        registry.freezeMachine(machineId);

        vm.expectRevert(ISurplusSweeper.MachineIsFrozen.selector);
        sweeper.sweep(machineId);
    }

    function test_Sweep_RevertIf_FleetFrozen() public {
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 20e6, operatorVault, true);

        usdc.mint(machineAccount, 100e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        // The operator freezes the fleet via the Kill Switch
        vm.prank(operator);
        registry.freezeFleet();

        vm.expectRevert(ISurplusSweeper.MachineIsFrozen.selector);
        sweeper.sweep(machineId);
    }

    function test_Sweep_RevertIf_NoSurplusToSweep() public {
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 50e6, operatorVault, true);

        // Balance 40 USDC <= threshold 50 USDC
        usdc.mint(machineAccount, 40e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        vm.expectRevert(ISurplusSweeper.NoSurplusToSweep.selector);
        sweeper.sweep(machineId);
    }

    function test_Sweep_RevertIf_InsufficientAllowance() public {
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 20e6, operatorVault, true);

        usdc.mint(machineAccount, 100e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), 10e6); // Less than 80e6

        vm.expectRevert(ISurplusSweeper.InsufficientAllowance.selector);
        sweeper.sweep(machineId);
    }

    function test_SweepAccount_Success() public {
        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), 15e6, operatorVault, true);

        usdc.mint(machineAccount, 50e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        uint256 swept = sweeper.sweepAccount(machineAccount);
        assertEq(swept, 35e6);
        assertEq(usdc.balanceOf(machineAccount), 15e6);
        assertEq(usdc.balanceOf(operatorVault), 35e6);
    }

    function test_SweepAccount_RevertIf_MachineNotFound() public {
        vm.expectRevert(ISurplusSweeper.MachineNotFound.selector);
        sweeper.sweepAccount(address(0x1234));
    }

    function test_SweepBatch_Success() public {
        // Register the 2nd machine
        uint256 account2Pk = 0x0005;
        address account2 = vm.addr(account2Pk);
        address signer2 = address(0x0006);
        bytes memory sig2 =
            _signRegisterAuth(account2, operator, signer2, keccak256("hardware-attestation-2"), account2Pk);
        vm.prank(operator);
        bytes32 machineId2 = registry.registerMachineWithAuth(
            account2,
            signer2,
            keccak256("hardware-attestation-2"),
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true}),
            block.timestamp + 1 hours,
            sig2
        );

        // Register the 3rd machine
        uint256 account3Pk = 0x0007;
        address account3 = vm.addr(account3Pk);
        address signer3 = address(0x0008);
        bytes memory sig3 =
            _signRegisterAuth(account3, operator, signer3, keccak256("hardware-attestation-3"), account3Pk);
        vm.prank(operator);
        bytes32 machineId3 = registry.registerMachineWithAuth(
            account3,
            signer3,
            keccak256("hardware-attestation-3"),
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true}),
            block.timestamp + 1 hours,
            sig3
        );

        // Use the default fleet config: reserve 10 USDC
        vm.prank(operator);
        sweeper.setFleetConfig(address(usdc), 10e6, operatorVault, true);

        // Machine 1: balance 50, surplus 40
        usdc.mint(machineAccount, 50e6);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        // Machine 2: balance 100, surplus 90
        usdc.mint(account2, 100e6);
        vm.prank(account2);
        usdc.approve(address(sweeper), type(uint256).max);

        // Machine 3: balance 5 (no surplus, balance <= 10)
        usdc.mint(account3, 5e6);
        vm.prank(account3);
        usdc.approve(address(sweeper), type(uint256).max);

        bytes32[] memory batch = new bytes32[](3);
        batch[0] = machineId;
        batch[1] = machineId2;
        batch[2] = machineId3;

        uint256 total = sweeper.sweepBatch(batch);

        // Total swept = 40 + 90 = 130 USDC
        assertEq(total, 130e6);
        assertEq(usdc.balanceOf(operatorVault), 130e6);
        assertEq(usdc.balanceOf(machineAccount), 10e6);
        assertEq(usdc.balanceOf(account2), 10e6);
        assertEq(usdc.balanceOf(account3), 5e6); // Intact, untouched
    }

    function test_SweepBatch_RevertIf_EmptyBatch() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(ISurplusSweeper.EmptyBatch.selector);
        sweeper.sweepBatch(empty);
    }

    // --- Fuzz Testing Invariant ---

    function testFuzz_Sweep(uint128 initialBalance, uint128 reserveThreshold) public {
        vm.assume(initialBalance > reserveThreshold);
        vm.assume(initialBalance < 1_000_000_000e6); // Below 1 billion USDC

        vm.prank(operator);
        sweeper.setMachineConfig(machineId, address(usdc), reserveThreshold, operatorVault, true);

        usdc.mint(machineAccount, initialBalance);
        vm.prank(machineAccount);
        usdc.approve(address(sweeper), type(uint256).max);

        uint256 expectedSurplus = uint256(initialBalance) - uint256(reserveThreshold);

        uint256 swept = sweeper.sweep(machineId);

        assertEq(swept, expectedSurplus, "Swept amount must match exact surplus");
        assertEq(usdc.balanceOf(machineAccount), reserveThreshold, "Machine balance must equal exact reserve threshold");
        assertEq(usdc.balanceOf(operatorVault), expectedSurplus, "Operator vault must receive exact swept surplus");
    }
}
