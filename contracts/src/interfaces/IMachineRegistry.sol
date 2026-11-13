// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC8004} from "./IERC8004.sol";

interface IMachineRegistry is IERC8004 {
    enum Tier {
        Bronze,
        Silver,
        Gold
    }

    struct SpendPolicy {
        uint128 maxStableOutPerSwap; // 0 = no per-swap limit
        uint128 dailyStableOutCap; // 0 = no daily limit
        bool enabled;
    }

    struct Machine {
        address account; // Machine Account (ERC-4337)
        address operator; // Owner
        address signer; // Session key / hardware signer
        bytes32 attestationHash; // Hardware attestation hash
        uint64 registeredAt;
        uint64 lastActiveAt;
        uint64 lastViolationAt; // 0 if none
        bool attestationValid; // Attestation verification flag
        bool frozen; // Machine-specific freeze flag
    }

    // --- Events ---
    event MachineRegistered(
        bytes32 indexed machineId,
        address indexed operator,
        address indexed account,
        address signer,
        bytes32 attestationHash
    );
    event SignerUpdated(bytes32 indexed machineId, address indexed oldSigner, address indexed newSigner);
    event PolicyUpdated(
        bytes32 indexed machineId, uint128 maxStableOutPerSwap, uint128 dailyStableOutCap, bool enabled
    );
    event AssetAllowlistUpdated(bytes32 indexed machineId, address indexed asset, bool allowed);
    event MachineFrozen(bytes32 indexed machineId, address indexed by);
    event MachineUnfrozen(bytes32 indexed machineId, address indexed by);
    event FleetFrozen(address indexed operator, address indexed by);
    event FleetUnfrozen(address indexed operator, address indexed by);
    event GuardianUpdated(address indexed operator, address indexed guardian);
    event AttestationUpdated(bytes32 indexed machineId, bytes32 attestationHash, bool valid);
    event ViolationReported(bytes32 indexed machineId, bytes32 evidenceHash, address indexed by);
    event SpendConsumed(bytes32 indexed machineId, uint64 day, uint256 stablecoinOut, uint256 totalToday);
    event MachineOperatorTransferred(
        bytes32 indexed machineId, address indexed oldOperator, address indexed newOperator
    );
    event MachineDeregistered(bytes32 indexed machineId, address indexed account, address indexed operator);
    event HookUpdated(address indexed oldHook, address indexed newHook);
    event AttestorUpdated(address indexed oldAttestor, address indexed newAttestor);
    event StakeContractUpdated(address indexed oldStakeContract, address indexed newStakeContract);
    event RegistrationConfigUpdated(
        address indexed stablecoin, address indexed treasury, address indexed burnVault, uint256 fee
    );

    // --- Custom Errors ---
    error NotOperator();
    error NotGuardianOrOperator();
    error NotHook();
    error NotAttestor();
    error MachineNotFound();
    error MachineIsFrozen();
    error FleetIsFrozen();
    error AssetNotAllowed();
    error PerSwapCapExceeded();
    error DailyCapExceeded();
    error PolicyDisabled();
    error InvalidSigner();
    error ZeroAddress();
    error AccountAlreadyRegistered();
    error UnauthorizedAccountRegistration();
    error ExpiredSignature();
    error InvalidSpendPolicy();
    error InvalidAmount();

    // --- State-changing Methods ---
    function registerMachineWithAuth(
        address account,
        address signer,
        bytes32 attestationHash,
        SpendPolicy calldata policy,
        uint256 deadline,
        bytes calldata accountSignature
    ) external returns (bytes32 machineId);

    function registerMachineWithAuthAndAgent(
        address account,
        address signer,
        bytes32 attestationHash,
        string calldata agentUri,
        SpendPolicy calldata policy,
        uint256 deadline,
        bytes calldata accountSignature
    ) external returns (bytes32 machineId);

    function registerMachine(address account, address signer, bytes32 attestationHash, SpendPolicy calldata policy)
        external
        returns (bytes32 machineId);

    function registerMachineWithAgent(
        address account,
        address signer,
        bytes32 attestationHash,
        string calldata agentUri,
        SpendPolicy calldata policy
    ) external returns (bytes32 machineId);

    function transferMachineOperator(bytes32 machineId, address newOperator) external;

    function deregisterMachine(bytes32 machineId) external;

    function setAgentUri(bytes32 machineId, string calldata newUri) external;

    function setSigner(bytes32 machineId, address newSigner) external;

    function setPolicy(bytes32 machineId, SpendPolicy calldata policy) external;

    function setAssetAllowed(bytes32 machineId, address asset, bool allowed) external;

    function setGuardian(address guardian) external;

    function freezeMachine(bytes32 machineId) external;

    function unfreezeMachine(bytes32 machineId) external;

    function freezeFleet() external;

    function freezeFleet(address operator) external;

    function unfreezeFleet() external;

    function setAttestation(bytes32 machineId, bytes32 attestationHash, bool valid) external;

    function reportViolation(bytes32 machineId, bytes32 evidenceHash) external;

    function setRegistrationConfig(address _stablecoin, address _treasury, address _burnVault, uint256 _fee) external;

    function consumeSpend(bytes32 machineId, uint256 stablecoinOut) external returns (Tier tier);

    // --- View Methods ---
    function registrationFee() external view returns (uint256);

    function getMachine(bytes32 machineId) external view returns (Machine memory);

    function getPolicy(bytes32 machineId) external view returns (SpendPolicy memory);

    function isFrozen(bytes32 machineId) external view returns (bool);

    function isAssetAllowed(bytes32 machineId, address asset) external view returns (bool);

    function tierOf(bytes32 machineId) external view returns (Tier);

    function machineIdOf(address account) external view returns (bytes32);

    function accountNonces(address account) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function dailySpent(bytes32 machineId, uint64 day) external view returns (uint256);
}
