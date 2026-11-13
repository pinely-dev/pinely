// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DeployBase} from "../script/DeployBase.s.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockPinelyToken} from "../src/mocks/MockPinelyToken.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";

/// @dev Minimal Safe lookalike exposing only what the deploy guard inspects.
contract FakeSafe {
    uint256 public threshold;
    address[] internal _owners;

    constructor(uint256 t, address[] memory o) {
        threshold = t;
        _owners = o;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }
}

contract Token18 is ERC20 {
    constructor() ERC20("T18", "T18") {}
}

contract NotASafe {}

contract Harness is DeployBase {
    mapping(bytes32 => address) internal _addrs;
    mapping(bytes32 => bool) internal _bools;
    mapping(bytes32 => uint256) internal _uints;

    function setAddr(string memory key, address value) external {
        _addrs[keccak256(bytes(key))] = value;
    }

    function setBool(string memory key, bool value) external {
        _bools[keccak256(bytes(key))] = value;
    }

    function setUint(string memory key, uint256 value) external {
        _uints[keccak256(bytes(key))] = value;
    }

    function _envAddr(string memory key, address fallbackValue) internal view override returns (address) {
        address v = _addrs[keccak256(bytes(key))];
        return v == address(0) ? fallbackValue : v;
    }

    function _envBool(string memory key, bool fallbackValue) internal view override returns (bool) {
        return _bools[keccak256(bytes(key))] || fallbackValue;
    }

    function _envUint(string memory key, uint256 fallbackValue) internal view override returns (uint256) {
        uint256 v = _uints[keccak256(bytes(key))];
        return v == 0 ? fallbackValue : v;
    }

    function guardMainnet(Config memory c) external view {
        _guardMainnet(c);
    }

    function resolveDeployer() external view returns (address) {
        return _resolveDeployer();
    }

    function requireSupportedChain() external view {
        _requireSupportedChain();
    }

    function loadConfig() external view returns (Config memory) {
        return _loadConfig();
    }

    function loadStage2Config(Config memory c) external view returns (Stage2Config memory) {
        return _loadStage2Config(c);
    }

    function requireCanonicalStablecoin(address t) external view {
        _requireCanonicalStablecoin(t);
    }

    function requirePriceBounds(Config memory c) external pure {
        _requirePriceBounds(c);
    }

    /// @dev Runs the Stage 1 deployment as `c.deployer`, the way `vm.startBroadcast(deployer)` does in the script.
    function deployStage1AsDeployer(Config memory c) external returns (Stage1 memory s1) {
        vm.startPrank(c.deployer);
        s1 = _deployStage1(c);
        vm.stopPrank();
    }
}

contract DeployGuardsTest is Test {
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant ANVIL_ACCOUNT_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Illustrative bounds (8-decimal USD per native token): a 4x window around a reference price of 3,000.
    uint256 internal constant NATIVE_MIN = 1_500e8;
    uint256 internal constant NATIVE_MAX = 6_000e8;

    Harness internal h;
    address internal deployer = address(0xDE91);
    address internal realUsdc;
    address internal goodSafe;

    function setUp() public {
        vm.chainId(4663);
        h = new Harness();
        vm.etch(ENTRY_POINT, hex"00");

        // A non-mock, 6-decimal token standing in for the official stablecoin.
        realUsdc = address(new SixDecimals());

        address[] memory owners = new address[](3);
        owners[0] = address(0xA1);
        owners[1] = address(0xA2);
        owners[2] = address(0xA3);
        goodSafe = address(new FakeSafe(2, owners));
    }

    function _cfg(address stablecoin, address treasury) internal view returns (DeployBase.Config memory c) {
        c = DeployBase.Config({
            deployer: deployer,
            entryPoint: ENTRY_POINT,
            stablecoin: stablecoin,
            treasury: treasury,
            registrationFee: 2e6,
            nativePriceMin: NATIVE_MIN,
            nativePriceMax: NATIVE_MAX
        });
    }

    // --- chain guard ---

    function test_RevertIf_UnsupportedChain() public {
        vm.chainId(1);
        vm.expectRevert(bytes("Chain guard: unsupported chain id (expected 46630 or 4663)"));
        h.requireSupportedChain();
    }

    function test_RevertIf_OtherUnsupportedChains() public {
        vm.chainId(12345);
        vm.expectRevert(bytes("Chain guard: unsupported chain id (expected 46630 or 4663)"));
        h.requireSupportedChain();
        vm.chainId(56789);
        vm.expectRevert(bytes("Chain guard: unsupported chain id (expected 46630 or 4663)"));
        h.requireSupportedChain();
    }

    function test_AllowsSupportedChains() public {
        h.requireSupportedChain();
        vm.chainId(46630);
        h.requireSupportedChain();
    }

    // --- deployer guard ---

    function test_RevertIf_DefaultAnvilDeployerOnMainnet() public {
        h.setAddr("DEPLOYER_ADDRESS", ANVIL_ACCOUNT_0);
        vm.expectRevert(bytes("Deployer guard: the default Anvil key must never be used"));
        h.resolveDeployer();
    }

    function test_RevertIf_DefaultAnvilDeployerOnTestnet() public {
        vm.chainId(46630);
        h.setAddr("DEPLOYER_ADDRESS", ANVIL_ACCOUNT_0);
        vm.expectRevert(bytes("Deployer guard: the default Anvil key must never be used"));
        h.resolveDeployer();
    }

    // --- mainnet guard ---

    function test_Mainnet_PassesWithSafeAndRealToken() public view {
        h.guardMainnet(_cfg(realUsdc, goodSafe));
    }

    function test_Mainnet_RevertIf_WrongChain() public {
        vm.chainId(46630);
        vm.expectRevert(bytes("Mainnet guard: chain id must be 4663"));
        h.guardMainnet(_cfg(realUsdc, goodSafe));
    }

    function test_Mainnet_RevertIf_MockUSDG() public {
        address mock = address(new MockUSDG());
        vm.expectRevert(bytes("Mainnet guard: mock stablecoin rejected"));
        h.guardMainnet(_cfg(mock, goodSafe));
    }

    function test_Mainnet_RevertIf_ZeroStablecoin() public {
        vm.expectRevert(bytes("Mainnet guard: STABLECOIN_ADDRESS is required"));
        h.guardMainnet(_cfg(address(0), goodSafe));
    }

    function test_Mainnet_RevertIf_NonCanonicalEntryPoint() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.entryPoint = address(0xE9);
        vm.expectRevert(bytes("Mainnet guard: ENTRY_POINT must be the canonical ERC-4337 v0.7 address"));
        h.guardMainnet(c);
    }

    function test_Mainnet_RevertIf_TreasuryIsEoa() public {
        vm.expectRevert(bytes("Guard: no bytecode at TREASURY_ADDRESS (Safe)"));
        h.guardMainnet(_cfg(realUsdc, address(0xBEEF)));
    }

    function test_Mainnet_RevertIf_TreasuryIsDeployer() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.deployer = goodSafe;
        vm.expectRevert(bytes("Mainnet guard: treasury must not be the deployer EOA"));
        h.guardMainnet(c);
    }

    function test_Mainnet_RevertIf_TreasuryIsNotASafe() public {
        address notSafe = address(new NotASafe());
        vm.expectRevert(bytes("Mainnet guard: TREASURY_ADDRESS is not a Safe (getThreshold failed)"));
        h.guardMainnet(_cfg(realUsdc, notSafe));
    }

    function test_Mainnet_RevertIf_SafeThresholdNotTwo() public {
        address[] memory owners = new address[](3);
        owners[0] = address(0xA1);
        owners[1] = address(0xA2);
        owners[2] = address(0xA3);
        address safe1 = address(new FakeSafe(1, owners));
        vm.expectRevert(bytes("Mainnet guard: Safe threshold must be 2"));
        h.guardMainnet(_cfg(realUsdc, safe1));
    }

    function test_Mainnet_RevertIf_SafeNotThreeOwners() public {
        address[] memory owners = new address[](2);
        owners[0] = address(0xA1);
        owners[1] = address(0xA2);
        address safe2 = address(new FakeSafe(2, owners));
        vm.expectRevert(bytes("Mainnet guard: Safe must have exactly 3 owners"));
        h.guardMainnet(_cfg(realUsdc, safe2));
    }

    function test_Mainnet_RevertIf_DeployerIsSafeOwner() public {
        address[] memory owners = new address[](3);
        owners[0] = deployer;
        owners[1] = address(0xA2);
        owners[2] = address(0xA3);
        address tainted = address(new FakeSafe(2, owners));
        vm.expectRevert(bytes("Mainnet guard: deployer must not be a Safe owner"));
        h.guardMainnet(_cfg(realUsdc, tainted));
    }

    // --- stablecoin / config ---

    function test_RevertIf_StablecoinNotSixDecimals() public {
        address t18 = address(new Token18());
        vm.expectRevert(bytes("Guard: stablecoin must have 6 decimals"));
        h.requireCanonicalStablecoin(t18);
    }

    function test_LoadConfig_Mainnet_RevertIf_StablecoinUnset() public {
        h.setAddr("DEPLOYER_ADDRESS", deployer);
        h.setAddr("ENTRY_POINT", ENTRY_POINT);
        h.setAddr("TREASURY_ADDRESS", goodSafe);
        h.setAddr("STABLECOIN_ADDRESS", address(0));
        vm.expectRevert(bytes("Mainnet guard: STABLECOIN_ADDRESS is required"));
        h.loadConfig();
    }

    function test_LoadConfig_Testnet_RequiresExplicitMockOptIn() public {
        vm.chainId(46630);
        h.setAddr("DEPLOYER_ADDRESS", deployer);
        h.setAddr("ENTRY_POINT", ENTRY_POINT);
        h.setAddr("TREASURY_ADDRESS", deployer);
        h.setAddr("STABLECOIN_ADDRESS", address(0));
        h.setBool("ALLOW_MOCK_STABLECOIN", false);
        vm.expectRevert(bytes("Config: set STABLECOIN_ADDRESS or ALLOW_MOCK_STABLECOIN=true"));
        h.loadConfig();
    }

    function test_Stage2Mainnet_RevertIf_MockPinelyToken() public {
        address mockToken = address(new MockPinelyToken(deployer));
        address pm = address(new NotASafe()); // any contract with bytecode
        h.setAddr("POOL_MANAGER", pm);
        h.setAddr("PINELY_TOKEN_ADDRESS", mockToken);
        vm.expectRevert(bytes("Mainnet guard: mock $PINELY rejected"));
        h.loadStage2Config(_cfg(realUsdc, goodSafe));
    }

    function test_Stage2Mainnet_RevertIf_TokenUnset() public {
        address pm = address(new NotASafe());
        h.setAddr("POOL_MANAGER", pm);
        h.setAddr("PINELY_TOKEN_ADDRESS", address(0));
        vm.expectRevert(bytes("Mainnet guard: PINELY_TOKEN_ADDRESS is required"));
        h.loadStage2Config(_cfg(realUsdc, goodSafe));
    }

    // --- Paymaster price bounds (D4) ---

    function test_PriceBounds_Accepts_AFourfoldWindow() public view {
        h.requirePriceBounds(_cfg(realUsdc, goodSafe));
    }

    function test_PriceBounds_Accepts_ExactlyTenfold() public view {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.nativePriceMax = c.nativePriceMin * 10;
        h.requirePriceBounds(c);
    }

    function test_PriceBounds_RevertIf_MinMissing() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.nativePriceMin = 0;
        vm.expectRevert(bytes("Config: NATIVE_PRICE_MIN is required"));
        h.requirePriceBounds(c);
    }

    function test_PriceBounds_RevertIf_MaxMissing() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.nativePriceMax = 0;
        vm.expectRevert(bytes("Config: NATIVE_PRICE_MAX is required"));
        h.requirePriceBounds(c);
    }

    function test_PriceBounds_RevertIf_MinNotBelowMax() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.nativePriceMax = c.nativePriceMin;
        vm.expectRevert(bytes("Config: NATIVE_PRICE_MIN must be below NATIVE_PRICE_MAX"));
        h.requirePriceBounds(c);
    }

    function test_PriceBounds_RevertIf_WiderThanTenfold() public {
        DeployBase.Config memory c = _cfg(realUsdc, goodSafe);
        c.nativePriceMax = c.nativePriceMin * 10 + 1;
        vm.expectRevert(bytes("Config: price bounds must not be wider than 10x"));
        h.requirePriceBounds(c);
    }

    function test_LoadConfig_ReadsPriceBoundsFromEnv() public {
        h.setAddr("DEPLOYER_ADDRESS", deployer);
        h.setAddr("ENTRY_POINT", ENTRY_POINT);
        h.setAddr("TREASURY_ADDRESS", goodSafe);
        h.setAddr("STABLECOIN_ADDRESS", realUsdc);
        h.setUint("NATIVE_PRICE_MIN", NATIVE_MIN);
        h.setUint("NATIVE_PRICE_MAX", NATIVE_MAX);
        DeployBase.Config memory c = h.loadConfig();
        assertEq(c.nativePriceMin, NATIVE_MIN);
        assertEq(c.nativePriceMax, NATIVE_MAX);
    }

    function test_LoadConfig_LeavesBoundsUnsetWhenEnvIsMissing() public {
        // The bounds are validated where they are used (Stage 1), so Stage 2 does not need them.
        h.setAddr("DEPLOYER_ADDRESS", deployer);
        h.setAddr("ENTRY_POINT", ENTRY_POINT);
        h.setAddr("TREASURY_ADDRESS", goodSafe);
        h.setAddr("STABLECOIN_ADDRESS", realUsdc);
        DeployBase.Config memory c = h.loadConfig();
        assertEq(c.nativePriceMin, 0);
        assertEq(c.nativePriceMax, 0);
    }

    function test_DeployStage1_SetsThePriceBoundsOnThePaymaster() public {
        vm.chainId(46630);
        DeployBase.Config memory c = _cfg(realUsdc, deployer);
        DeployBase.Stage1 memory s1 = h.deployStage1AsDeployer(c);
        PinelyPaymaster paymaster = s1.paymaster;
        assertEq(paymaster.minPrice(), NATIVE_MIN);
        assertEq(paymaster.maxPrice(), NATIVE_MAX);
        // The deployer owns the Paymaster until the script hands it over.
        assertEq(paymaster.owner(), deployer);
    }

    function test_DeployStage1_RevertIf_BoundsAreMissing() public {
        vm.chainId(46630);
        DeployBase.Config memory c = _cfg(realUsdc, deployer);
        c.nativePriceMin = 0;
        vm.expectRevert(bytes("Config: NATIVE_PRICE_MIN is required"));
        h.deployStage1AsDeployer(c);
    }

    function test_DeployStage1_AllowsAnEthSizedPrice_ThatThePlaceholderBoundsWouldRefuse() public {
        // The contract's placeholder window ($1 to $500) refuses a price like 3,000. After the script sets the real
        // bounds, the owner can publish it.
        vm.chainId(46630);
        DeployBase.Config memory c = _cfg(realUsdc, deployer);
        DeployBase.Stage1 memory s1 = h.deployStage1AsDeployer(c);
        vm.prank(deployer);
        s1.paymaster.setNativePrice(3_000e8);
        assertEq(s1.paymaster.fixedNativePrice(), 3_000e8);
    }
}

contract SixDecimals is ERC20 {
    constructor() ERC20("Six Decimal Token", "SIX6") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
