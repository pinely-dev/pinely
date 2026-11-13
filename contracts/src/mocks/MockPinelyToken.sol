// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPinelyToken
 * @notice Testnet-only stand-in for $PINELY so Stage 2 (BurnVault, PinelyStake) can be rehearsed
 *         before the real token launches. Never deploy on mainnet; the mainnet deploy guards reject it.
 */
contract MockPinelyToken is ERC20, Ownable {
    constructor(address initialOwner) ERC20("PINELY Testnet", "PINELY") Ownable(initialOwner) {
        _mint(initialOwner, 1_000_000_000 * 1e18);
    }

    /// @dev Marker used by deploy guards to detect mock tokens on-chain.
    function isMockToken() external pure returns (bool) {
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
