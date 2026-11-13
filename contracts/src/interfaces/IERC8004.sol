// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IERC8004 - Autonomous Agent Identity Standard
 * @notice On-chain interface standard for autonomous agent identity and robotics hardware (including peaq DID).
 */
interface IERC8004 {
    event AgentRegistered(bytes32 indexed agentId, address indexed owner, address indexed account, string agentUri);
    event AgentUriUpdated(bytes32 indexed agentId, string newUri);

    /**
     * @notice Returns the identity information of a registered agent.
     * @param agentId Unique agent identifier (machineId).
     * @return account The agent's smart account or on-chain address.
     * @return owner The agent's operator or primary owner.
     * @return agentUri Metadata URI or peaq DID (e.g. did:peaq:... or https://...).
     */
    function getAgent(bytes32 agentId) external view returns (address account, address owner, string memory agentUri);

    /**
     * @notice Verifies a cryptographic signature from the agent's official signer.
     * @param agentId Unique agent identifier.
     * @param digest Message hash being verified.
     * @param signature ECDSA secp256k1 cryptographic signature.
     * @return valid True if the signature is valid and the machine is not frozen.
     */
    function verifyAgentSignature(bytes32 agentId, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool valid);
}
