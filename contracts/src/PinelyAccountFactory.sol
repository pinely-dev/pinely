// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PinelyAccount} from "./PinelyAccount.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title PinelyAccountFactory
 * @notice Deterministic factory that deploys `PinelyAccount` via CREATE2.
 *         Lets the Machine Account address be predicted before on-chain deployment.
 */
contract PinelyAccountFactory {
    /// @dev Salt prefix isolates PINELY account addresses from any other deployment of the same bytecode.
    bytes32 public constant SALT_PREFIX = keccak256("PINELY_ACCOUNT_V1");

    address public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner, address sessionKey, uint256 salt);

    error ZeroAddress();

    constructor(address _entryPoint) {
        if (_entryPoint == address(0)) revert ZeroAddress();
        entryPoint = _entryPoint;
    }

    /**
     * @notice Computes the real salt using the PINELY_ACCOUNT_V1 prefix.
     */
    function computeActualSalt(uint256 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(SALT_PREFIX, salt));
    }

    /**
     * @notice Produces the init bytecode for the CREATE2 computation.
     */
    function getCreationCode(address owner, address initialSessionKey, uint48 validUntil, uint48 validAfter)
        public
        view
        returns (bytes memory)
    {
        return bytes.concat(
            type(PinelyAccount).creationCode, abi.encode(entryPoint, owner, initialSessionKey, validUntil, validAfter)
        );
    }

    /**
     * @notice Computes the deterministic account address before it is deployed.
     */
    function getAddress(address owner, address initialSessionKey, uint48 validUntil, uint48 validAfter, uint256 salt)
        external
        view
        returns (address)
    {
        bytes32 bytecodeHash = keccak256(getCreationCode(owner, initialSessionKey, validUntil, validAfter));
        return Create2.computeAddress(computeActualSalt(salt), bytecodeHash, address(this));
    }

    /**
     * @notice Deploys a new PinelyAccount instance, or returns the existing one if the salt is the same.
     */
    function createAccount(address owner, address initialSessionKey, uint48 validUntil, uint48 validAfter, uint256 salt)
        external
        returns (PinelyAccount account)
    {
        bytes memory code = getCreationCode(owner, initialSessionKey, validUntil, validAfter);
        bytes32 bytecodeHash = keccak256(code);
        bytes32 actualSalt = computeActualSalt(salt);
        address addr = Create2.computeAddress(actualSalt, bytecodeHash, address(this));

        if (addr.code.length > 0) {
            return PinelyAccount(payable(addr));
        }

        account = new PinelyAccount{salt: actualSalt}(entryPoint, owner, initialSessionKey, validUntil, validAfter);

        // forge-lint: disable-next-line(reentrancy-events)
        emit AccountCreated(address(account), owner, initialSessionKey, salt);
    }
}
