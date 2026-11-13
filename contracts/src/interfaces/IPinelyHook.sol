// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

interface IPinelyHook {
    event ProtocolFeeCollected(bytes32 indexed machineId, uint256 protocolFee);
    event LpAuthorized(address indexed lp, bool authorized);

    error NotRouter();
    error HookMismatch();
    error MachineFrozen();
    error AssetNotAllowed();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error IntentExpired();
    error InvalidChainId();
    error PoolMismatch();
    error MissingStablecoin();
    error ZeroAddress();
    error UnauthorizedLp();

    function setAuthorizedLp(address lp, bool authorized) external;
    function isAuthorizedLp(address lp) external view returns (bool);
    function treasury() external view returns (address);
    function burnVault() external view returns (address);
}
