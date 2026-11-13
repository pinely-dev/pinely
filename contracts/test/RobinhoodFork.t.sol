// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IEntryPoint} from "../src/interfaces/erc4337/IEntryPoint.sol";
import {MachineRegistry} from "../src/MachineRegistry.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/**
 * @title RobinhoodForkTest
 * @notice Checks the assumptions the deployment makes about Robinhood Chain testnet (46630) against the live chain.
 *
 *         The tests need a network, so they run only when `RPC_URL_ROBINHOOD_TESTNET` is set and are skipped
 *         otherwise (the rest of the suite stays offline). To run them:
 *           RPC_URL_ROBINHOOD_TESTNET=<endpoint> forge test --match-contract RobinhoodForkTest -vv
 *
 *         `STABLECOIN_ADDRESS` is optional. When it is set, the stablecoin is checked as well.
 */
contract RobinhoodForkTest is Test {
    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;

    /// @dev Runtime-code hash of the EntryPoint seen on Robinhood Chain (mainnet and testnet) and on the chain this
    ///      project came from. It shows the builds are identical; it is NOT a comparison with the official release.
    bytes32 internal constant OBSERVED_ENTRY_POINT_CODEHASH =
        0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58;

    address internal owner = address(0xB0B);

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL_ROBINHOOD_TESTNET", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, ROBINHOOD_TESTNET_CHAIN_ID, "the fork must be Robinhood Chain testnet");
    }

    function test_EntryPoint_V07_IsPresentWithTheObservedBuild() public view {
        assertGt(ENTRY_POINT.code.length, 0, "no bytecode at the canonical EntryPoint");
        assertEq(ENTRY_POINT.codehash, OBSERVED_ENTRY_POINT_CODEHASH);
    }

    function test_Multicall3_IsPresent() public view {
        assertGt(MULTICALL3.code.length, 0);
    }

    function test_SolidityBlockNumber_IsTheParentChainBlock() public view {
        // Documents why block.number must never be used as a clock or as the indexer start block here:
        // the chain's own block number (read by the RPC) is far larger than Solidity's block.number.
        // ArbSys is the Arbitrum precompile at 0x64.
        (bool ok, bytes memory data) = address(100).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        assertTrue(ok);
        uint256 chainBlock = abi.decode(data, (uint256));
        assertGt(chainBlock, block.number, "block.number is expected to be the parent-chain block");
    }

    function test_Paymaster_DepositsAndStakesAtTheRealEntryPoint() public {
        MockUSDG stablecoin = new MockUSDG();
        MachineRegistry registry = new MachineRegistry(owner);
        PinelyPaymaster paymaster =
            new PinelyPaymaster(ENTRY_POINT, address(registry), address(stablecoin), owner, owner);

        vm.deal(owner, 1 ether);
        vm.startPrank(owner);
        // The sequence the runbook performs after a deployment.
        paymaster.setPriceBounds(1_500e8, 6_000e8);
        paymaster.setNativePrice(3_000e8);
        paymaster.setMaxPriceStaleness(86_400);
        paymaster.depositGasToEntryPoint{value: 0.01 ether}();
        paymaster.addStake{value: 0.01 ether}(86_400);
        vm.stopPrank();

        (uint112 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec,) =
            IEntryPoint(ENTRY_POINT).getDepositInfo(address(paymaster));
        assertEq(deposit, 0.01 ether);
        assertTrue(staked);
        assertEq(stake, 0.01 ether);
        assertEq(unstakeDelaySec, 86_400);
        assertEq(paymaster.fixedNativePrice(), 3_000e8);
    }

    function test_Stablecoin_HasSixDecimals_WhenConfigured() public {
        address token = vm.envOr("STABLECOIN_ADDRESS", address(0));
        if (token == address(0)) {
            vm.skip(true);
            return;
        }
        assertGt(token.code.length, 0, "no bytecode at STABLECOIN_ADDRESS");
        assertEq(IERC20Metadata(token).decimals(), 6);
    }
}
