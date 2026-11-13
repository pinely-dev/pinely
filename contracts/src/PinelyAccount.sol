// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IAccount} from "./interfaces/erc4337/IAccount.sol";
import {PackedUserOperation} from "./interfaces/erc4337/PackedUserOperation.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PinelyAccount
 * @notice ERC-4337 Machine Account smart contract (EntryPoint v0.7).
 *         Separates the Operator (Owner) role from the machine's physical key (Session Key).
 *         The session key has limited rights only: swaps and paying for power;
 *         it cannot call owner functions or make arbitrary transfers.
 *         Supports EIP-1271 for smart contract signature verification.
 */
contract PinelyAccount is IAccount, IERC1271 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // --- State Variables ---

    address public immutable entryPoint;
    address public owner;

    address public sessionKey;
    uint48 public sessionKeyValidUntil;
    uint48 public sessionKeyValidAfter;

    bool public enforceAllowlist;
    mapping(address => bool) public isAllowedTarget;

    // Mapping of calldata hashes that marks owner UserOp authorisations, avoiding FIFO queue desync
    mapping(bytes32 => bool) private _ownerAuthorizedCallHash;

    // --- Events ---

    event SessionKeyUpdated(address indexed oldKey, address indexed newKey, uint48 validUntil, uint48 validAfter);
    event SessionKeyRevoked(address indexed revokedKey);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TargetAllowlistUpdated(address indexed target, bool allowed);
    event AllowlistEnforcementSet(bool enforced);
    event Executed(address indexed dest, uint256 value, bytes data);

    // --- Custom Errors ---

    error NotEntryPoint();
    error NotOwner();
    error NotAuthorized();
    error TargetNotAllowed();
    error TargetCannotBeSelf();
    error ArrayLengthMismatch();
    error ExecutionFailed();
    error ZeroAddress();

    // --- Modifiers ---

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyEntryPointOrOwner() {
        if (msg.sender != entryPoint && msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(
        address _entryPoint,
        address _owner,
        address _initialSessionKey,
        uint48 _validUntil,
        uint48 _validAfter
    ) {
        if (_entryPoint == address(0) || _owner == address(0)) revert ZeroAddress();
        entryPoint = _entryPoint;
        owner = _owner;

        if (_initialSessionKey != address(0)) {
            sessionKey = _initialSessionKey;
            sessionKeyValidUntil = _validUntil;
            sessionKeyValidAfter = _validAfter;
            emit SessionKeyUpdated(address(0), _initialSessionKey, _validUntil, _validAfter);
        }
    }

    receive() external payable {}

    // --- Execution Functions ---

    /**
     * @notice Executes a single transaction. Callable only by the Owner or the EntryPoint.
     * @param dest Target contract of the transaction.
     * @param value Amount of ETH/native token to send.
     * @param data Call payload (calldata).
     */
    function execute(address dest, uint256 value, bytes calldata data)
        external
        onlyEntryPointOrOwner
        returns (bytes memory result)
    {
        if (dest == address(0)) revert ZeroAddress();
        bytes32 callHash = keccak256(msg.data);
        bytes32 innerHash = keccak256(data);
        bool isOwnerCaller =
            (msg.sender == owner) || _ownerAuthorizedCallHash[callHash] || _ownerAuthorizedCallHash[innerHash];
        if (_ownerAuthorizedCallHash[callHash]) {
            delete _ownerAuthorizedCallHash[callHash];
        }
        if (_ownerAuthorizedCallHash[innerHash]) {
            delete _ownerAuthorizedCallHash[innerHash];
        }
        _validateDestination(dest, isOwnerCaller);

        bool success;
        (success, result) = dest.call{value: value}(data);
        if (!success) revert ExecutionFailed();

        // forge-lint: disable-next-line(reentrancy-events)
        emit Executed(dest, value, data);
    }

    /**
     * @notice Executes a batch of transactions in order.
     * @param dests List of target contracts.
     * @param values List of ETH/native token amounts.
     * @param datas List of calldata payloads.
     */
    // forge-lint: disable-next-line(calls-loop)
    function executeBatch(address[] calldata dests, uint256[] calldata values, bytes[] calldata datas)
        external
        onlyEntryPointOrOwner
    {
        if (dests.length != values.length || dests.length != datas.length) {
            revert ArrayLengthMismatch();
        }

        bytes32 callHash = keccak256(msg.data);
        bool isOwnerCaller = (msg.sender == owner) || _ownerAuthorizedCallHash[callHash];
        if (_ownerAuthorizedCallHash[callHash]) {
            delete _ownerAuthorizedCallHash[callHash];
        }

        for (uint256 i = 0; i < dests.length; i++) {
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (dests[i] == address(0)) revert ZeroAddress();
            _validateDestination(dests[i], isOwnerCaller);

            // forge-lint: disable-next-line(calls-loop)
            (bool success,) = dests[i].call{value: values[i]}(datas[i]);
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (!success) revert ExecutionFailed();

            // forge-lint: disable-next-line(reentrancy-events)
            emit Executed(dests[i], values[i], datas[i]);
        }
    }

    // --- ERC-4337 Validation ---

    /**
     * @notice Validates the UserOperation signature from the EntryPoint.
     * @param userOp UserOperation data.
     * @param userOpHash UserOp hash computed by the EntryPoint.
     * @param missingAccountFunds Funds the EntryPoint needs for gas.
     */
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        override
        returns (uint256 validationData)
    {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        (address signer, ECDSA.RecoverError err,) = ethSignedHash.tryRecover(userOp.signature);

        if (err == ECDSA.RecoverError.NoError && signer == owner) {
            // The owner EOA has full rights; mark the calldata hash to bypass the runtime allowlist
            _ownerAuthorizedCallHash[keccak256(userOp.callData)] = true;
            validationData = _packValidationData(false, 0, 0);
        } else if (owner.code.length > 0) {
            // EIP-1271 verification when the owner is a Safe Multisig / Smart Contract Wallet
            bool ownerSigValid = false;
            try IERC1271(owner).isValidSignature(userOpHash, userOp.signature) returns (bytes4 magic) {
                if (magic == 0x1626ba7e) ownerSigValid = true;
            } catch {}
            if (!ownerSigValid) {
                try IERC1271(owner).isValidSignature(ethSignedHash, userOp.signature) returns (bytes4 magic) {
                    if (magic == 0x1626ba7e) ownerSigValid = true;
                } catch {}
            }
            if (ownerSigValid) {
                _ownerAuthorizedCallHash[keccak256(userOp.callData)] = true;
                validationData = _packValidationData(false, 0, 0);
            } else if (err == ECDSA.RecoverError.NoError && signer == sessionKey && sessionKey != address(0)) {
                if (!_validateSessionKeyCallData(userOp.callData)) {
                    return _packValidationData(true, 0, 0);
                }
                validationData = _packValidationData(false, sessionKeyValidUntil, sessionKeyValidAfter);
            } else {
                return _packValidationData(true, 0, 0);
            }
        } else if (err == ECDSA.RecoverError.NoError && signer == sessionKey && sessionKey != address(0)) {
            // The session key is time-bound and its calldata is validated fail-closed
            if (!_validateSessionKeyCallData(userOp.callData)) {
                return _packValidationData(true, 0, 0);
            }
            validationData = _packValidationData(false, sessionKeyValidUntil, sessionKeyValidAfter);
        } else {
            // Invalid signature
            return _packValidationData(true, 0, 0);
        }

        // Sponsor/pay the deposit if funds are missing
        if (missingAccountFunds > 0) {
            (bool success,) = payable(entryPoint).call{value: missingAccountFunds}("");
            (success);
        }
    }

    // --- EIP-1271 Signature Verification ---

    /**
     * @notice Validates a signature per the EIP-1271 standard for Smart Contract Accounts.
     * @param hash Digest that was signed.
     * @param signature Cryptographic signature from the account owner.
     * @return magicValue 0x1626ba7e if valid, 0xffffffff if invalid.
     */
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        if (owner.code.length > 0) {
            // EIP-1271 recursive verification for a Smart Contract / Safe Multisig owner
            try IERC1271(owner).isValidSignature(hash, signature) returns (bytes4 magic) {
                if (magic == 0x1626ba7e) return 0x1626ba7e;
            } catch {}
            try IERC1271(owner).isValidSignature(hash.toEthSignedMessageHash(), signature) returns (bytes4 magic) {
                if (magic == 0x1626ba7e) return 0x1626ba7e;
            } catch {}
            return 0xffffffff;
        }

        (address recovered, ECDSA.RecoverError err,) = hash.tryRecover(signature);
        if (err == ECDSA.RecoverError.NoError && recovered == owner) {
            return 0x1626ba7e;
        }
        (recovered, err,) = hash.toEthSignedMessageHash().tryRecover(signature);
        if (err == ECDSA.RecoverError.NoError && recovered == owner) {
            return 0x1626ba7e;
        }
        return 0xffffffff;
    }

    // --- Operator Admin Functions ---

    /**
     * @notice Sets a new session key together with its validity window.
     * @param newKey Address of the new session key.
     * @param validUntil Timestamp at which validity ends.
     * @param validAfter Timestamp at which validity starts.
     */
    function setSessionKey(address newKey, uint48 validUntil, uint48 validAfter) external onlyOwner {
        if (newKey == address(0)) revert ZeroAddress();
        address oldKey = sessionKey;
        sessionKey = newKey;
        sessionKeyValidUntil = validUntil;
        sessionKeyValidAfter = validAfter;
        emit SessionKeyUpdated(oldKey, newKey, validUntil, validAfter);
    }

    /**
     * @notice Revokes the active session key immediately.
     */
    function revokeSessionKey() external onlyOwner {
        address oldKey = sessionKey;
        sessionKey = address(0);
        sessionKeyValidUntil = 0;
        sessionKeyValidAfter = 0;
        emit SessionKeyRevoked(oldKey);
    }

    /**
     * @notice Changes the allowlist status of a target contract.
     */
    function setTargetAllowed(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        isAllowedTarget[target] = allowed;
        emit TargetAllowlistUpdated(target, allowed);
    }

    /**
     * @notice Enables or disables enforcement of the target allowlist.
     */
    function setEnforceAllowlist(bool enforce) external onlyOwner {
        enforceAllowlist = enforce;
        emit AllowlistEnforcementSet(enforce);
    }

    /**
     * @notice Transfers account ownership to a new operator.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // --- Internal Helpers ---

    function _validateSessionKeyCallData(bytes calldata callData) internal view returns (bool) {
        if (callData.length == 0) return true;
        if (callData.length < 4) return false;

        bytes4 selector = bytes4(callData[:4]);
        if (selector == this.execute.selector) {
            if (callData.length < 36) return false;
            address dest = abi.decode(callData[4:36], (address));
            if (dest == address(this)) return false;
            if (enforceAllowlist && !isAllowedTarget[dest]) return false;
            return true;
        } else if (selector == this.executeBatch.selector) {
            (address[] memory dests,,) = abi.decode(callData[4:], (address[], uint256[], bytes[]));
            for (uint256 i = 0; i < dests.length; i++) {
                if (dests[i] == address(this)) return false;
                if (enforceAllowlist && !isAllowedTarget[dests[i]]) return false;
            }
            return true;
        }
        // Fail-closed: the machine's physical session key is NOT allowed to call anything other than execute/executeBatch
        return false;
    }

    function _validateDestination(address dest, bool isOwnerCaller) internal view {
        if (dest == address(this) && !isOwnerCaller) revert TargetCannotBeSelf();
        if (enforceAllowlist && !isOwnerCaller && !isAllowedTarget[dest]) revert TargetNotAllowed();
    }

    function _packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
    }
}
