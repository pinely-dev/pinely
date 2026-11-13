// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IMachineRegistry} from "./interfaces/IMachineRegistry.sol";

interface IPinelyStake {
    function hasMinStakeGold(address operator) external view returns (bool);
}

/**
 * @title MachineRegistry
 * @notice On-chain source of truth for machine identity in the PINELY ecosystem.
 *         Stores the machine -> operator mapping, the session key (signer), the hardware attestation hash,
 *         the Spend Policy limits, and the freeze status (kill switch).
 * @dev The contract never holds custody of machine funds.
 */
contract MachineRegistry is IMachineRegistry, Ownable, EIP712 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    bytes32 public constant REGISTER_AUTHORIZATION_TYPEHASH = keccak256(
        "RegisterAuthorization(address account,address operator,address signer,bytes32 attestationHash,uint256 nonce,uint256 deadline,uint256 chainId)"
    );

    // --- State Variables ---
    mapping(bytes32 => Machine) private _machines;
    mapping(bytes32 => SpendPolicy) private _policies;
    mapping(bytes32 => string) private _agentUris;

    mapping(address => bytes32) public override machineIdOf;
    mapping(address => uint256) public override accountNonces;
    mapping(address => address) public guardianOf;
    mapping(address => bool) public fleetFrozenOf;

    mapping(bytes32 => mapping(address => bool)) public override isAssetAllowed;
    mapping(bytes32 => mapping(uint64 => uint256)) public override dailySpent;

    address public hook;
    address public attestor;
    address public stakeContract;

    address public stablecoin;
    address public treasury;
    address public burnVault;
    uint256 public override registrationFee;

    constructor(address initialOwner) Ownable(initialOwner) EIP712("PINELY", "1") {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    // --- Admin Configuration ---

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroAddress();
        address oldHook = hook;
        hook = newHook;
        emit HookUpdated(oldHook, newHook);
    }

    function setAttestor(address newAttestor) external onlyOwner {
        if (newAttestor == address(0)) revert ZeroAddress();
        address oldAttestor = attestor;
        attestor = newAttestor;
        emit AttestorUpdated(oldAttestor, newAttestor);
    }

    // forge-lint: disable-next-line(missing-zero-check)
    function setStakeContract(address newStakeContract) external onlyOwner {
        address oldStakeContract = stakeContract;
        stakeContract = newStakeContract;
        emit StakeContractUpdated(oldStakeContract, newStakeContract);
    }

    /**
     * @notice Configures the machine registration fee (default 2 stablecoin units) and its fee split.
     * @param _stablecoin stablecoin token contract address.
     * @param _treasury Protocol treasury address (receives 80%).
     * @param _burnVault BurnVault address (receives 20% for buyback & burn).
     * @param _fee Registration fee in the token's decimal units (e.g. 2 * 1e6).
     */
    function setRegistrationConfig(address _stablecoin, address _treasury, address _burnVault, uint256 _fee)
        external
        override
        onlyOwner
    {
        if (_fee > 0 && (_stablecoin == address(0) || _treasury == address(0))) revert ZeroAddress();
        stablecoin = _stablecoin;
        treasury = _treasury;
        burnVault = _burnVault;
        registrationFee = _fee;
        emit RegistrationConfigUpdated(_stablecoin, _treasury, _burnVault, _fee);
    }

    // --- Machine Registration & Management ---

    /**
     * @notice Registers a machine with a cryptographic signature authorisation from the account owner.
     *         Supports EIP-1271 for ERC-4337 Smart Accounts and ECDSA for EOAs, plus an expiry deadline.
     */
    function registerMachineWithAuth(
        address account,
        address signer,
        bytes32 attestationHash,
        SpendPolicy calldata policy,
        uint256 deadline,
        bytes calldata accountSignature
    ) external override returns (bytes32 machineId) {
        return registerMachineWithAuthAndAgent(account, signer, attestationHash, "", policy, deadline, accountSignature);
    }

    /**
     * @notice Registers a machine with an agent URI and a cryptographic signature authorisation from the account.
     */
    function registerMachineWithAuthAndAgent(
        address account,
        address signer,
        bytes32 attestationHash,
        string memory agentUri,
        SpendPolicy calldata policy,
        uint256 deadline,
        bytes calldata accountSignature
    ) public override returns (bytes32 machineId) {
        if (account == address(0) || signer == address(0)) revert ZeroAddress();
        if (machineIdOf[account] != bytes32(0)) revert AccountAlreadyRegistered();

        _verifyRegisterAuth(account, signer, attestationHash, deadline, accountSignature);

        return _registerMachine(account, signer, attestationHash, agentUri, policy);
    }

    function _verifyRegisterAuth(
        address account,
        address signer,
        bytes32 attestationHash,
        uint256 deadline,
        bytes calldata accountSignature
    ) private {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert ExpiredSignature();

        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_AUTHORIZATION_TYPEHASH,
                account,
                msg.sender,
                signer,
                attestationHash,
                accountNonces[account]++,
                deadline,
                block.chainid
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (account.code.length > 0) {
            // EIP-1271 Smart Contract Account Verification (ERC-4337)
            if (IERC1271(account).isValidSignature(digest, accountSignature) != 0x1626ba7e) {
                revert UnauthorizedAccountRegistration();
            }
        } else {
            // ECDSA recovery for EOAs
            address recovered = digest.recover(accountSignature);
            if (recovered != account) {
                revert UnauthorizedAccountRegistration();
            }
        }
    }

    /**
     * @notice Self-registration by the account owner without a signature intermediary (msg.sender == account).
     */
    function registerMachine(address account, address signer, bytes32 attestationHash, SpendPolicy calldata policy)
        external
        override
        returns (bytes32 machineId)
    {
        if (account == address(0) || signer == address(0)) revert ZeroAddress();
        if (msg.sender != account) revert UnauthorizedAccountRegistration();
        return _registerMachine(account, signer, attestationHash, "", policy);
    }

    function registerMachineWithAgent(
        address account,
        address signer,
        bytes32 attestationHash,
        string calldata agentUri,
        SpendPolicy calldata policy
    ) external override returns (bytes32 machineId) {
        if (account == address(0) || signer == address(0)) revert ZeroAddress();
        if (msg.sender != account) revert UnauthorizedAccountRegistration();
        return _registerMachine(account, signer, attestationHash, agentUri, policy);
    }

    function _registerMachine(
        address account,
        address signer,
        bytes32 attestationHash,
        string memory agentUri,
        SpendPolicy calldata policy
    ) internal returns (bytes32 machineId) {
        if (account == address(0) || signer == address(0)) revert ZeroAddress();
        if (machineIdOf[account] != bytes32(0)) revert AccountAlreadyRegistered();

        // Fail-closed Spend Policy validation
        if (policy.enabled) {
            if (policy.dailyStableOutCap == 0 || policy.maxStableOutPerSwap == 0) revert InvalidSpendPolicy();
            if (policy.maxStableOutPerSwap > policy.dailyStableOutCap) revert InvalidSpendPolicy();
        }

        // Collect the machine registration fee in the stablecoin
        if (registrationFee > 0 && stablecoin != address(0)) {
            _collectRegistrationFee();
        }

        // Deterministic canonical MachineId based on the permanent account
        machineId = keccak256(abi.encode(account));

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 currentTime = uint64(block.timestamp);

        _machines[machineId] = Machine({
            account: account,
            operator: msg.sender,
            signer: signer,
            attestationHash: attestationHash,
            registeredAt: currentTime,
            lastActiveAt: 0,
            lastViolationAt: 0,
            attestationValid: false,
            frozen: false
        });

        _policies[machineId] = policy;
        machineIdOf[account] = machineId;

        if (bytes(agentUri).length > 0) {
            _agentUris[machineId] = agentUri;
            emit AgentRegistered(machineId, msg.sender, account, agentUri);
        }

        emit MachineRegistered(machineId, msg.sender, account, signer, attestationHash);
        emit PolicyUpdated(machineId, policy.maxStableOutPerSwap, policy.dailyStableOutCap, policy.enabled);
    }

    function setAgentUri(bytes32 machineId, string calldata newUri) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();

        _agentUris[machineId] = newUri;
        emit AgentUriUpdated(machineId, newUri);
    }

    function getAgent(bytes32 machineId)
        external
        view
        override
        returns (address account, address owner, string memory agentUri)
    {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        return (m.account, m.operator, _agentUris[machineId]);
    }

    function verifyAgentSignature(bytes32 machineId, bytes32 digest, bytes calldata signature)
        external
        view
        override
        returns (bool valid)
    {
        Machine storage m = _machines[machineId];
        if (m.account == address(0) || m.frozen || fleetFrozenOf[m.operator]) {
            return false;
        }

        bytes32 ethSigned = digest.toEthSignedMessageHash();
        (address recovered, ECDSA.RecoverError err,) = ethSigned.tryRecover(signature);
        if (err != ECDSA.RecoverError.NoError) {
            return false;
        }
        return recovered == m.signer;
    }

    function setSigner(bytes32 machineId, address newSigner) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();
        if (newSigner == address(0)) revert InvalidSigner();

        address oldSigner = m.signer;
        m.signer = newSigner;
        emit SignerUpdated(machineId, oldSigner, newSigner);
    }

    function setPolicy(bytes32 machineId, SpendPolicy calldata policy) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();

        if (policy.enabled) {
            if (policy.dailyStableOutCap == 0 || policy.maxStableOutPerSwap == 0) revert InvalidSpendPolicy();
            if (policy.maxStableOutPerSwap > policy.dailyStableOutCap) revert InvalidSpendPolicy();
        }

        _policies[machineId] = policy;
        emit PolicyUpdated(machineId, policy.maxStableOutPerSwap, policy.dailyStableOutCap, policy.enabled);
    }

    function setAssetAllowed(bytes32 machineId, address asset, bool allowed) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();
        if (asset == address(0)) revert ZeroAddress();

        isAssetAllowed[machineId][asset] = allowed;
        emit AssetAllowlistUpdated(machineId, asset, allowed);
    }

    function setGuardian(address guardian) external override {
        guardianOf[msg.sender] = guardian;
        emit GuardianUpdated(msg.sender, guardian);
    }

    // --- Freeze / Kill Switch ---

    function freezeMachine(bytes32 machineId) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();

        address op = m.operator;
        if (msg.sender != op && msg.sender != guardianOf[op]) revert NotGuardianOrOperator();

        m.frozen = true;
        emit MachineFrozen(machineId, msg.sender);
    }

    function unfreezeMachine(bytes32 machineId) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (msg.sender != m.operator) revert NotOperator();

        m.frozen = false;
        emit MachineUnfrozen(machineId, msg.sender);
    }

    function freezeFleet() external override {
        fleetFrozenOf[msg.sender] = true;
        emit FleetFrozen(msg.sender, msg.sender);
    }

    function freezeFleet(address operator) external override {
        if (msg.sender != operator && msg.sender != guardianOf[operator]) revert NotGuardianOrOperator();
        fleetFrozenOf[operator] = true;
        emit FleetFrozen(operator, msg.sender);
    }

    function unfreezeFleet() external override {
        fleetFrozenOf[msg.sender] = false;
        emit FleetUnfrozen(msg.sender, msg.sender);
    }

    // --- Attestation & Reputation ---

    function setAttestation(bytes32 machineId, bytes32 attestationHash, bool valid) external override {
        if (msg.sender != attestor && msg.sender != owner()) revert NotAttestor();
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();

        m.attestationHash = attestationHash;
        m.attestationValid = valid;
        emit AttestationUpdated(machineId, attestationHash, valid);
    }

    function reportViolation(bytes32 machineId, bytes32 evidenceHash) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();

        address op = m.operator;
        if (msg.sender != op && msg.sender != guardianOf[op] && msg.sender != attestor && msg.sender != owner()) {
            revert NotGuardianOrOperator();
        }

        // forge-lint: disable-next-line(unsafe-typecast)
        m.lastViolationAt = uint64(block.timestamp);
        // Revoke attestation validity immediately when a violation occurs
        m.attestationValid = false;
        emit AttestationUpdated(machineId, m.attestationHash, false);
        emit ViolationReported(machineId, evidenceHash, msg.sender);
    }

    /**
     * @notice Transfers machine operator ownership to a new operator.
     * @param machineId Unique machine ID.
     * @param newOperator New operator address.
     */
    function transferMachineOperator(bytes32 machineId, address newOperator) external override {
        if (newOperator == address(0)) revert ZeroAddress();
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();

        address oldOperator = m.operator;
        m.operator = newOperator;
        emit MachineOperatorTransferred(machineId, oldOperator, newOperator);
    }

    /**
     * @notice Removes the registration of a retired/decommissioned machine.
     * @param machineId Unique machine ID.
     */
    function deregisterMachine(bytes32 machineId) external override {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.operator != msg.sender) revert NotOperator();

        address acct = m.account;
        delete machineIdOf[acct];
        delete _machines[machineId];
        delete _policies[machineId];
        delete _agentUris[machineId];

        emit MachineDeregistered(machineId, acct, msg.sender);
    }

    // --- Hook Interaction ---

    function consumeSpend(bytes32 machineId, uint256 stablecoinOut) external override returns (Tier tier) {
        if (msg.sender != hook) revert NotHook();

        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        if (m.frozen) revert MachineIsFrozen();
        if (fleetFrozenOf[m.operator]) revert FleetIsFrozen();

        SpendPolicy storage policy = _policies[machineId];
        if (!policy.enabled) revert PolicyDisabled();
        if (policy.maxStableOutPerSwap > 0 && stablecoinOut > policy.maxStableOutPerSwap) revert PerSwapCapExceeded();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 day = uint64(block.timestamp / 1 days);
        uint256 currentSpent = dailySpent[machineId][day];
        uint256 newSpent = currentSpent + stablecoinOut;

        // Fail-closed enforcement of the Spend Policy daily limit
        if (newSpent > policy.dailyStableOutCap) revert DailyCapExceeded();

        dailySpent[machineId][day] = newSpent;
        // forge-lint: disable-next-line(unsafe-typecast)
        m.lastActiveAt = uint64(block.timestamp);

        emit SpendConsumed(machineId, day, stablecoinOut, newSpent);
        return tierOf(machineId);
    }

    /**
     * @dev Collects the machine registration fee from msg.sender and distributes it:
     *      80% to the Treasury, 20% to the BurnVault.
     */
    function _collectRegistrationFee() internal {
        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), registrationFee);
        if (burnVault != address(0)) {
            uint256 burnAmount = (registrationFee * 2000) / 10000; // 20%
            uint256 treasuryAmount = registrationFee - burnAmount; // 80%
            IERC20(stablecoin).safeTransfer(burnVault, burnAmount);
            IERC20(stablecoin).safeTransfer(treasury, treasuryAmount);
        } else {
            IERC20(stablecoin).safeTransfer(treasury, registrationFee);
        }
    }

    // --- View Functions ---

    function getMachine(bytes32 machineId) external view override returns (Machine memory) {
        Machine memory m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        return m;
    }

    function getPolicy(bytes32 machineId) external view override returns (SpendPolicy memory) {
        if (_machines[machineId].account == address(0)) revert MachineNotFound();
        return _policies[machineId];
    }

    function isFrozen(bytes32 machineId) external view override returns (bool) {
        Machine memory m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();
        return m.frozen || fleetFrozenOf[m.operator];
    }

    function tierOf(bytes32 machineId) public view override returns (Tier) {
        Machine storage m = _machines[machineId];
        if (m.account == address(0)) revert MachineNotFound();

        // 1. Gold tier: valid hardware attestation, active >= 90 days, no violations in 90 days, and the operator has a stake
        // forge-lint: disable-next-line(block-timestamp)
        if (
            m.attestationValid && 
                // forge-lint: disable-next-line(block-timestamp)
                (block.timestamp - m.registeredAt) >= 90 days && 
                // forge-lint: disable-next-line(block-timestamp)
                (m.lastViolationAt == 0 || (block.timestamp - m.lastViolationAt) >= 90 days)
                && _hasMinStakeGold(m.operator)
        ) {
            return Tier.Gold;
        }

        // 2. Silver tier: valid hardware attestation OR (registered >= 30 days, has transacted, active in the last 30 days, no violations in 30 days)
        // forge-lint: disable-next-line(block-timestamp)
        if (
            (m.attestationValid
                    || ((block.timestamp - m.registeredAt) >= 30 days
                        && m.lastActiveAt > 0
                        && (block.timestamp - m.lastActiveAt) <= 30 days))
                && (m.lastViolationAt == 0 || (block.timestamp - m.lastViolationAt) >= 30 days)
        ) {
            return Tier.Silver;
        }

        // 3. Bronze tier: new machine / basic attestation
        return Tier.Bronze;
    }

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _hasMinStakeGold(address operator) internal view returns (bool) {
        if (stakeContract == address(0)) {
            return false;
        }
        try IPinelyStake(stakeContract).hasMinStakeGold(operator) returns (bool hasStake) {
            return hasStake;
        } catch {
            return false;
        }
    }
}
