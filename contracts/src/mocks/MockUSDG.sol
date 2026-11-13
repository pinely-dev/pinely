// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDG
 * @notice Testnet mock of USDG (Global Dollar), the settlement stablecoin on Robinhood Chain. Never accepted on mainnet (the deploy guards reject it).
 *         Matches the 6-decimal precision of the production stablecoin.
 *         Includes a public faucet function so operators and testers can claim
 *         testnet tokens without needing external faucets.
 */
contract MockUSDG is ERC20 {
    uint8 private constant DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 100 * 10 ** DECIMALS; // 100 tokens per claim

    event FaucetClaimed(address indexed recipient, uint256 amount);

    constructor() ERC20("Mock USDG", "mUSDG") {
        // Mint initial supply to deployer for pool seeding and ecosystem setup
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    /// @dev Marker used by deploy guards to detect mock tokens on-chain.
    function isMockToken() external pure returns (bool) {
        return true;
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Public faucet for testers on testnet.
     *         Mints 100 tokens directly to the caller.
     */
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Mint tokens to a designated recipient (for seeding or test harnesses).
     * @param to Recipient address.
     * @param amount Amount in 6-decimal units.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an account.
     * @param from Address to burn from.
     * @param amount Amount in 6-decimal units.
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
