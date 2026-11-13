// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";

import {MachineRegistry} from "../src/MachineRegistry.sol";
import {PinelyAccountFactory} from "../src/PinelyAccountFactory.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";
import {SurplusSweeper} from "../src/SurplusSweeper.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {CreatorFeeSplitter} from "../src/CreatorFeeSplitter.sol";
import {PinelyStake} from "../src/PinelyStake.sol";
import {FleetSubscription} from "../src/FleetSubscription.sol";
import {PinelyHook} from "../src/PinelyHook.sol";
import {PinelyRouter} from "../src/PinelyRouter.sol";
import {PoolSeeder} from "../src/PoolSeeder.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockPinelyToken} from "../src/mocks/MockPinelyToken.sol";

interface ISafeLike {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

interface IMockMarker {
    function isMockToken() external view returns (bool);
}

/**
 * @title DeployBase
 * @notice Shared configuration, guards and deployment steps for the Robinhood Chain deploy scripts.
 *
 *         One codebase serves testnet (46630) and mainnet (4663). Differences between the two networks
 *         live only in the environment and in the guards below; there is no per-chain branching of
 *         contract logic. No address is hardcoded here except the canonical ERC-4337 EntryPoint v0.7
 *         (a deterministic address) and well-known deployer sentinels that must be rejected.
 *
 *         Private keys are never read from the environment. Use a Foundry encrypted keystore:
 *         `cast wallet import deployer-robinhood --interactive` and pass `--account`.
 */
abstract contract DeployBase is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    address internal constant CANONICAL_ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;
    address internal constant ANVIL_DEFAULT_ACCOUNT_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    /// @dev The price bounds may span at most this factor. A wider window would not catch a mistyped price.
    uint256 internal constant MAX_PRICE_BOUNDS_RATIO = 10;

    uint256 internal constant DEFAULT_REGISTRATION_FEE = 2e6; // 2 stablecoin units (6 decimals), override with REGISTRATION_FEE

    struct Config {
        address deployer;
        address entryPoint;
        address stablecoin; // settlement stablecoin (6 decimals)
        address treasury; // Safe 2-of-3 on mainnet
        uint256 registrationFee;
        // Circuit-breaker bounds for the Paymaster's owner-set native-token price, in 8-decimal USD per native token.
        uint256 nativePriceMin;
        uint256 nativePriceMax;
    }

    struct Stage1 {
        MachineRegistry registry;
        PinelyAccountFactory accountFactory;
        PinelyPaymaster paymaster;
        SurplusSweeper sweeper;
    }

    struct Stage2Config {
        address poolManager;
        address pinelyToken;
        address slashingAuthority;
    }

    struct Stage2 {
        BurnVault burnVault;
        CreatorFeeSplitter feeSplitter;
        PinelyStake stake;
        FleetSubscription subscription;
        PinelyHook hook;
        PinelyRouter router;
        PoolSeeder poolSeeder;
    }

    // ---------------------------------------------------------------------
    // Environment access (virtual so tests can inject values without touching the shared process env)
    // ---------------------------------------------------------------------

    function _envAddr(string memory key, address fallbackValue) internal view virtual returns (address) {
        return vm.envOr(key, fallbackValue);
    }

    function _envUint(string memory key, uint256 fallbackValue) internal view virtual returns (uint256) {
        return vm.envOr(key, fallbackValue);
    }

    function _envBool(string memory key, bool fallbackValue) internal view virtual returns (bool) {
        return vm.envOr(key, fallbackValue);
    }

    // ---------------------------------------------------------------------
    // Guards
    // ---------------------------------------------------------------------

    function _isMainnet() internal view returns (bool) {
        return block.chainid == ROBINHOOD_MAINNET_CHAIN_ID;
    }

    function _isLocal() internal view returns (bool) {
        return block.chainid == LOCAL_CHAIN_ID;
    }

    /// @dev Only Robinhood Chain testnet/mainnet (and a local anvil node for dry runs) are allowed.
    function _requireSupportedChain() internal view {
        require(
            block.chainid == ROBINHOOD_TESTNET_CHAIN_ID || block.chainid == ROBINHOOD_MAINNET_CHAIN_ID || _isLocal(),
            "Chain guard: unsupported chain id (expected 46630 or 4663)"
        );
    }

    function _resolveDeployer() internal view returns (address deployer) {
        deployer = _envAddr("DEPLOYER_ADDRESS", msg.sender);
        if (deployer == address(0) || deployer == FOUNDRY_DEFAULT_SENDER) {
            if (msg.sender != address(0) && msg.sender != FOUNDRY_DEFAULT_SENDER) {
                deployer = msg.sender;
            } else if (tx.origin != address(0) && tx.origin != FOUNDRY_DEFAULT_SENDER) {
                deployer = tx.origin;
            }
        }
        if (!_isLocal()) {
            require(
                deployer != FOUNDRY_DEFAULT_SENDER, "Deployer guard: pass --sender <address> or set DEPLOYER_ADDRESS"
            );
            require(deployer != ANVIL_DEFAULT_ACCOUNT_0, "Deployer guard: the default Anvil key must never be used");
        }
        require(deployer != address(0), "Deployer guard: zero deployer");
    }

    function _requireContract(address account, string memory what) internal view {
        require(account != address(0), string.concat("Guard: zero address for ", what));
        require(account.code.length > 0, string.concat("Guard: no bytecode at ", what));
    }

    function _isMock(address token) internal view returns (bool) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeCall(IMockMarker.isMockToken, ()));
        return ok && data.length == 32 && abi.decode(data, (bool));
    }

    function _requireSafe2of3(address safe, address deployer) internal view {
        _requireContract(safe, "TREASURY_ADDRESS (Safe)");
        require(safe != deployer, "Mainnet guard: treasury must not be the deployer EOA");
        try ISafeLike(safe).getThreshold() returns (uint256 threshold) {
            require(threshold == 2, "Mainnet guard: Safe threshold must be 2");
        } catch {
            revert("Mainnet guard: TREASURY_ADDRESS is not a Safe (getThreshold failed)");
        }
        try ISafeLike(safe).getOwners() returns (address[] memory owners) {
            require(owners.length == 3, "Mainnet guard: Safe must have exactly 3 owners");
            for (uint256 i = 0; i < owners.length; i++) {
                require(owners[i] != deployer, "Mainnet guard: deployer must not be a Safe owner");
            }
        } catch {
            revert("Mainnet guard: TREASURY_ADDRESS is not a Safe (getOwners failed)");
        }
    }

    function _requireCanonicalStablecoin(address token) internal view {
        _requireContract(token, "STABLECOIN_ADDRESS");
        require(IERC20Metadata(token).decimals() == 6, "Guard: stablecoin must have 6 decimals");
    }

    /// @dev The Paymaster's built-in bounds ($1 to $500) fit one native token only by accident, so the real bounds
    ///      are mandatory on every chain. They catch a mistyped price (an extra or missing zero), not market drift:
    ///      a window wider than 10x would protect against nothing.
    function _requirePriceBounds(Config memory cfg) internal pure {
        require(cfg.nativePriceMin > 0, "Config: NATIVE_PRICE_MIN is required");
        require(cfg.nativePriceMax > 0, "Config: NATIVE_PRICE_MAX is required");
        require(cfg.nativePriceMin < cfg.nativePriceMax, "Config: NATIVE_PRICE_MIN must be below NATIVE_PRICE_MAX");
        require(
            cfg.nativePriceMax <= cfg.nativePriceMin * MAX_PRICE_BOUNDS_RATIO,
            "Config: price bounds must not be wider than 10x"
        );
    }

    function _guardMainnet(Config memory cfg) internal view {
        require(block.chainid == ROBINHOOD_MAINNET_CHAIN_ID, "Mainnet guard: chain id must be 4663");
        require(block.number > 0, "Mainnet guard: start block must not be zero");
        require(
            cfg.entryPoint == CANONICAL_ENTRYPOINT_V07,
            "Mainnet guard: ENTRY_POINT must be the canonical ERC-4337 v0.7 address"
        );
        _requireContract(cfg.entryPoint, "ENTRY_POINT");
        require(cfg.stablecoin != address(0), "Mainnet guard: STABLECOIN_ADDRESS is required");
        require(!_isMock(cfg.stablecoin), "Mainnet guard: mock stablecoin rejected");
        _requireSafe2of3(cfg.treasury, cfg.deployer);
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    function _loadConfig() internal view returns (Config memory cfg) {
        _requireSupportedChain();
        cfg.deployer = _resolveDeployer();
        cfg.entryPoint = _envAddr("ENTRY_POINT", address(0));
        cfg.stablecoin = _envAddr("STABLECOIN_ADDRESS", address(0));
        cfg.treasury = _envAddr("TREASURY_ADDRESS", _isLocal() ? cfg.deployer : address(0));
        cfg.registrationFee = _envUint("REGISTRATION_FEE", DEFAULT_REGISTRATION_FEE);
        cfg.nativePriceMin = _envUint("NATIVE_PRICE_MIN", 0);
        cfg.nativePriceMax = _envUint("NATIVE_PRICE_MAX", 0);

        require(cfg.entryPoint != address(0), "Config: ENTRY_POINT is required");
        require(cfg.treasury != address(0), "Config: TREASURY_ADDRESS is required");

        if (cfg.stablecoin == address(0)) {
            // A mock stablecoin is a testnet rehearsal convenience only (use it only if the official testnet stablecoin is unavailable).
            require(!_isMainnet(), "Mainnet guard: STABLECOIN_ADDRESS is required");
            require(
                _envBool("ALLOW_MOCK_STABLECOIN", false), "Config: set STABLECOIN_ADDRESS or ALLOW_MOCK_STABLECOIN=true"
            );
        }
    }

    function _loadStage2Config(Config memory cfg) internal view returns (Stage2Config memory s2) {
        s2.poolManager = _envAddr("POOL_MANAGER", address(0));
        s2.pinelyToken = _envAddr("PINELY_TOKEN_ADDRESS", address(0));
        s2.slashingAuthority = _envAddr("SLASHING_AUTHORITY", cfg.treasury);
        _requireContract(s2.poolManager, "POOL_MANAGER");
        if (s2.pinelyToken == address(0)) {
            require(!_isMainnet(), "Mainnet guard: PINELY_TOKEN_ADDRESS is required");
            require(
                _envBool("ALLOW_MOCK_PINELY_TOKEN", false),
                "Config: set PINELY_TOKEN_ADDRESS or ALLOW_MOCK_PINELY_TOKEN=true"
            );
        } else {
            _requireContract(s2.pinelyToken, "PINELY_TOKEN_ADDRESS");
            require(IERC20Metadata(s2.pinelyToken).decimals() == 18, "Guard: $PINELY must have 18 decimals");
            if (_isMainnet()) require(!_isMock(s2.pinelyToken), "Mainnet guard: mock $PINELY rejected");
        }
    }

    // ---------------------------------------------------------------------
    // Deployment steps (must run between vm.startBroadcast and vm.stopBroadcast)
    // ---------------------------------------------------------------------

    function _maybeDeployMockStablecoin(Config memory cfg) internal {
        if (cfg.stablecoin == address(0)) {
            cfg.stablecoin = address(new MockUSDG());
            console.log("MockUSDG (testnet only) deployed at:", cfg.stablecoin);
        }
    }

    function _deployStage1(Config memory cfg) internal returns (Stage1 memory s1) {
        _requireContract(cfg.entryPoint, "ENTRY_POINT");
        _requireCanonicalStablecoin(cfg.stablecoin);
        _requirePriceBounds(cfg);

        // The deployer owns the registry/paymaster only while configuring; ownership is handed to the Safe afterwards.
        s1.registry = new MachineRegistry(cfg.deployer);
        s1.accountFactory = new PinelyAccountFactory(cfg.entryPoint);
        s1.paymaster =
            new PinelyPaymaster(cfg.entryPoint, address(s1.registry), cfg.stablecoin, cfg.treasury, cfg.deployer);
        s1.sweeper = new SurplusSweeper(address(s1.registry), cfg.stablecoin);

        // The real price bounds are set here, while the deployer still owns the Paymaster, so that ownership reaches
        // the Safe with the circuit breaker already configured. Only the price itself is left to the owner.
        s1.paymaster.setPriceBounds(cfg.nativePriceMin, cfg.nativePriceMax);

        // Registration fee goes 100% to the treasury until BurnVault exists (Stage 2).
        s1.registry.setRegistrationConfig(cfg.stablecoin, cfg.treasury, address(0), cfg.registrationFee);

        console.log("MachineRegistry:", address(s1.registry));
        console.log("PinelyAccountFactory:", address(s1.accountFactory));
        console.log("PinelyPaymaster:", address(s1.paymaster));
        console.log("SurplusSweeper:", address(s1.sweeper));
        console.log("Native price bounds (8 decimals):", cfg.nativePriceMin, cfg.nativePriceMax);
        // On Robinhood Chain (an Arbitrum Nitro chain) Solidity's block.number is the PARENT-chain block, far below the
        // chain's own block number. It must never be used as the indexer START_BLOCK.
        console.log("block.number (parent-chain block, NOT the indexer START_BLOCK):", block.number);
        console.log("Indexer START_BLOCK: use the block of the first deployment transaction in the broadcast receipts.");
    }

    function _deployStage2(Config memory cfg, Stage2Config memory s2, Stage1 memory s1)
        internal
        returns (Stage2 memory ext)
    {
        if (s2.pinelyToken == address(0)) {
            s2.pinelyToken = address(new MockPinelyToken(cfg.deployer));
            console.log("MockPinelyToken (testnet only) deployed at:", s2.pinelyToken);
        }

        ext.burnVault = new BurnVault(s2.pinelyToken, cfg.deployer);
        ext.feeSplitter = new CreatorFeeSplitter(address(ext.burnVault), cfg.treasury);
        ext.stake = new PinelyStake(s2.pinelyToken, address(ext.burnVault), s2.slashingAuthority, cfg.deployer);
        ext.subscription = new FleetSubscription(cfg.stablecoin, address(ext.burnVault), cfg.treasury);

        // The router address is predicted from the deployer nonce: the hook is deployed first through the
        // CREATE2 deployer (one deployer transaction), then the router.
        address routerAddress = vm.computeCreateAddress(cfg.deployer, vm.getNonce(cfg.deployer) + 1);
        uint160 hookFlags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );
        bytes memory constructorArgs = abi.encode(
            IPoolManager(s2.poolManager),
            routerAddress,
            address(s1.registry),
            cfg.stablecoin,
            cfg.treasury,
            address(ext.burnVault)
        );
        (, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, hookFlags, type(PinelyHook).creationCode, constructorArgs);

        ext.hook = new PinelyHook{salt: salt}(
            IPoolManager(s2.poolManager),
            routerAddress,
            address(s1.registry),
            cfg.stablecoin,
            cfg.treasury,
            address(ext.burnVault)
        );
        ext.router = new PinelyRouter(s2.poolManager, address(s1.registry), address(ext.hook), cfg.stablecoin);
        require(address(ext.router) == routerAddress, "Router address mismatch");

        ext.poolSeeder = new PoolSeeder(s2.poolManager, cfg.deployer);

        console.log("BurnVault:", address(ext.burnVault));
        console.log("CreatorFeeSplitter:", address(ext.feeSplitter));
        console.log("PinelyStake:", address(ext.stake));
        console.log("FleetSubscription:", address(ext.subscription));
        console.log("PinelyHook:", address(ext.hook));
        console.log("PinelyRouter:", address(ext.router));
        console.log("PoolSeeder:", address(ext.poolSeeder));
    }

    /// @dev Wires Stage 2 into the registry. Only possible while the deployer still owns the registry.
    function _wireStage2(Config memory cfg, Stage1 memory s1, Stage2 memory ext) internal {
        if (s1.registry.owner() == cfg.deployer) {
            s1.registry.setHook(address(ext.hook));
            s1.registry.setStakeContract(address(ext.stake));
            s1.registry.setRegistrationConfig(cfg.stablecoin, cfg.treasury, address(ext.burnVault), cfg.registrationFee);
            console.log("Registry wired to hook, stake and BurnVault fee split");
        } else {
            console.log("Registry is not owned by the deployer. Execute from the Safe:");
            console.log("  registry.setHook:", address(ext.hook));
            console.log("  registry.setStakeContract:", address(ext.stake));
            console.log("  registry.setRegistrationConfig burnVault:", address(ext.burnVault));
        }
    }

    function _handOverStage1Ownership(Config memory cfg, Stage1 memory s1) internal {
        if (cfg.treasury == cfg.deployer) return;
        if (s1.registry.owner() == cfg.deployer) s1.registry.transferOwnership(cfg.treasury);
        if (s1.paymaster.owner() == cfg.deployer) s1.paymaster.transferOwnership(cfg.treasury);
        console.log("Registry and Paymaster ownership transferred to:", cfg.treasury);
    }

    function _handOverStage2Ownership(Config memory cfg, Stage2 memory ext) internal {
        if (cfg.treasury == cfg.deployer) return;
        ext.burnVault.transferOwnership(cfg.treasury);
        ext.stake.transferOwnership(cfg.treasury);
        ext.poolSeeder.transferOwnership(cfg.treasury);
        console.log("BurnVault, PinelyStake and PoolSeeder ownership transferred to:", cfg.treasury);
    }
}
