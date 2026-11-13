// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPaymaster, PostOpMode} from "./interfaces/erc4337/IPaymaster.sol";
import {IEntryPoint} from "./interfaces/erc4337/IEntryPoint.sol";
import {PackedUserOperation} from "./interfaces/erc4337/PackedUserOperation.sol";
import {IMachineRegistry} from "./interfaces/IMachineRegistry.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/**
 * @title PinelyPaymaster
 * @notice ERC-4337 v0.7 Paymaster for the PINELY ecosystem.
 *         Pays machines' native-token gas and bills a prepaid quota in the settlement stablecoin.
 *         Machines do not need to hold any native token.
 */
contract PinelyPaymaster is IPaymaster, Ownable {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    IEntryPoint public immutable entryPoint;
    IMachineRegistry public immutable registry;
    IERC20 public immutable stablecoin;
    uint8 public immutable stablecoinDecimals;

    address public treasury;
    IPriceFeed public priceFeed;

    // Owner-set rate (stablecoin per one native token) used when priceFeed == address(0). Same decimals as oracleDecimals (default 8).
    // Zero until the owner sets it: the paymaster is fail-closed until a rate is published.
    uint256 public fixedNativePrice;
    uint256 public lastPriceUpdate; // block.timestamp of the last owner-set rate
    uint256 public minPrice; // Circuit breaker lower bound
    uint256 public maxPrice; // Circuit breaker upper bound
    uint256 public maxCostStablecoinPerUserOp; // Upper bound on the stablecoin gas cost per UserOp (e.g. 0.50 stablecoin units)
    uint256 public maxPriceStaleness; // Maximum tolerated oracle staleness (default: 3600 seconds)
    uint8 public oracleDecimals; // Cached oracle feed decimals to save gas

    struct PendingWithdrawal {
        uint256 amount;
        uint256 unlockTimestamp;
    }

    uint256 public constant WITHDRAWAL_COOLDOWN = 15 minutes;

    mapping(address => uint256) public creditOf;
    mapping(address => PendingWithdrawal) public pendingWithdrawals;
    uint256 public totalCollectedStablecoin;

    // --- Events ---

    event CreditDeposited(address indexed account, address indexed depositor, uint256 amount, uint256 newBalance);
    event CreditWithdrawn(address indexed account, address indexed to, uint256 amount, uint256 newBalance);
    event CreditWithdrawRequested(address indexed account, uint256 amount, uint256 unlockTimestamp);
    event CreditWithdrawCancelled(address indexed account, uint256 amount);
    event GasCharged(address indexed account, uint256 stablecoinCharged, uint256 actualGasCostWei, PostOpMode mode);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event PriceFeedUpdated(address indexed oldFeed, address indexed newFeed);
    event FixedPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event MaxCostPerUserOpUpdated(uint256 oldMax, uint256 newMax);
    event PriceBoundsUpdated(uint256 minPrice, uint256 maxPrice);
    event MaxPriceStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);

    // --- Custom Errors ---

    error NotEntryPoint();
    error NotAuthorized();
    error ZeroAddress();
    error MachineNotRegistered();
    error MachineFrozen();
    error InsufficientCredit();
    error UserOpCostExceedsCap();
    error AmountExceedsCollected();
    error StalePrice();
    error InvalidPriceBounds();
    error InvalidPrice();
    error TimelockRequired();
    error WithdrawalCooldownActive();
    error NoPendingWithdrawal();
    error InvalidToken();

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        _;
    }

    constructor(address _entryPoint, address _registry, address _stablecoin, address _treasury, address _initialOwner)
        Ownable(_initialOwner)
    {
        if (
            _entryPoint == address(0) || _registry == address(0) || _stablecoin == address(0) || _treasury == address(0)
                || _initialOwner == address(0)
        ) {
            revert ZeroAddress();
        }

        entryPoint = IEntryPoint(_entryPoint);
        registry = IMachineRegistry(_registry);
        stablecoin = IERC20(_stablecoin);
        treasury = _treasury;

        if (_stablecoin.code.length == 0) revert InvalidToken();

        uint8 dec;
        try IERC20Metadata(_stablecoin).decimals() returns (uint8 d) {
            dec = d;
        } catch {
            revert InvalidToken();
        }
        stablecoinDecimals = dec;

        // No default rate: the owner must publish one via setNativePrice() (fail-closed until then).
        // Placeholder circuit-breaker bounds (8-decimal USD per native token, $1 to $500). They do not fit every
        // native token, so the deploy script sets the real bounds with setPriceBounds() before ownership moves.
        minPrice = 1e8; // $1
        maxPrice = 500e8; // $500
        maxCostStablecoinPerUserOp = 50 * (10 ** (dec > 2 ? dec - 2 : 0)); // Equivalent to 0.50 stablecoin units
        maxPriceStaleness = 3600; // 1 hour
        oracleDecimals = 8;
    }

    receive() external payable {}

    // --- Prepaid Credit Management ---

    /**
     * @notice Deposits stablecoin credit for a Machine Account.
     * @param account Machine Account that receives the credit.
     * @param amount Amount of stablecoin deposited.
     */
    function depositCredit(address account, uint256 amount) external {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) return;

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        creditOf[account] += amount;

        emit CreditDeposited(account, msg.sender, amount, creditOf[account]);
    }

    /**
     * @notice Withdraws a machine account's remaining stablecoin credit directly (protocol owner/admin only).
     *         Machine operators must use requestWithdrawCredit and executeWithdrawCredit
     *         to prevent mempool front-running of gas fees still owed.
     * @param account Machine Account.
     * @param amount Amount of stablecoin credit to withdraw.
     * @param to Destination address of the token transfer.
     */
    /**
     * @notice Direct withdrawal of a machine account's remaining stablecoin credit is disabled.
     *         Prevents a backdoor or rug-pull by the protocol owner.
     *         Machine operators must use requestWithdrawCredit and executeWithdrawCredit
     *         with a 15-minute timelock cooldown.
     */
    function withdrawCredit(address, uint256, address) external pure {
        // Disabled so an admin or owner cannot instantly drain users' prepaid credit.
        // Every credit withdrawal must go through requestWithdrawCredit -> timelock -> executeWithdrawCredit by the operator.
        revert TimelockRequired();
    }

    /**
     * @notice Starts a stablecoin credit withdrawal request by the operator, with an anti-front-running delay.
     * @param account Machine Account.
     * @param amount Amount of credit to withdraw.
     */
    function requestWithdrawCredit(address account, uint256 amount) external {
        if (amount == 0) return;
        bytes32 machineId = registry.machineIdOf(account);
        if (machineId == bytes32(0)) revert MachineNotRegistered();

        IMachineRegistry.Machine memory m = registry.getMachine(machineId);
        if (msg.sender != m.operator) revert NotAuthorized();

        if (creditOf[account] < amount) revert InsufficientCredit();
        creditOf[account] -= amount;

        PendingWithdrawal storage pending = pendingWithdrawals[account];
        pending.amount += amount;
        // forge-lint: disable-next-line(block-timestamp)
        pending.unlockTimestamp = block.timestamp + WITHDRAWAL_COOLDOWN;

        emit CreditWithdrawRequested(account, amount, pending.unlockTimestamp);
    }

    /**
     * @notice Executes a credit withdrawal whose timelock delay has elapsed.
     * @param account Machine Account.
     * @param to Destination address of the stablecoin transfer.
     */
    function executeWithdrawCredit(address account, address to) external {
        if (to == address(0)) revert ZeroAddress();
        bytes32 machineId = registry.machineIdOf(account);
        if (machineId == bytes32(0)) revert MachineNotRegistered();

        IMachineRegistry.Machine memory m = registry.getMachine(machineId);
        if (msg.sender != m.operator) revert NotAuthorized();

        PendingWithdrawal storage pending = pendingWithdrawals[account];
        uint256 amount = pending.amount;
        if (amount == 0) revert NoPendingWithdrawal();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < pending.unlockTimestamp) revert WithdrawalCooldownActive();

        delete pendingWithdrawals[account];
        stablecoin.safeTransfer(to, amount);

        emit CreditWithdrawn(account, to, amount, creditOf[account]);
    }

    /**
     * @notice Cancels a withdrawal request and returns the funds to the active credit balance.
     * @param account Machine Account.
     */
    function cancelWithdrawCredit(address account) external {
        bytes32 machineId = registry.machineIdOf(account);
        if (machineId == bytes32(0)) revert MachineNotRegistered();

        IMachineRegistry.Machine memory m = registry.getMachine(machineId);
        if (msg.sender != m.operator) revert NotAuthorized();

        PendingWithdrawal storage pending = pendingWithdrawals[account];
        uint256 amount = pending.amount;
        if (amount == 0) revert NoPendingWithdrawal();

        delete pendingWithdrawals[account];
        creditOf[account] += amount;

        emit CreditWithdrawCancelled(account, amount);
    }

    // --- EntryPoint Gas Deposit & Staking Management (ERC-7562) ---

    /**
     * @notice Deposits native token into the Paymaster's deposit at the EntryPoint.
     */
    function depositGasToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Withdraws native token from the EntryPoint to the given destination.
     */
    function withdrawGasFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        entryPoint.withdrawTo(to, amount);
    }

    /**
     * @notice Stakes native token in EntryPoint v0.7 to satisfy the ERC-7562 validation rules.
     * @param unstakeDelaySec Minimum delay before the stake can be withdrawn (e.g. 86400 = 1 day).
     */
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    /**
     * @notice Starts unlocking the stake in the EntryPoint.
     */
    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    /**
     * @notice Withdraws the native token stake from the EntryPoint once unstakeDelaySec has elapsed.
     * @param to Destination address of the stake.
     */
    function withdrawStake(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        entryPoint.withdrawStake(to);
    }

    // --- ERC-4337 IPaymaster Interface ---

    /**
     * @notice Validates that the Paymaster is willing to sponsor this UserOperation.
     *         Debits the estimated gas cost upfront (escrow) to prevent parallel multi-op attacks.
     */
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        external
        override
        onlyEntryPoint
        returns (bytes memory context, uint256 validationData)
    {
        bytes32 machineId = registry.machineIdOf(userOp.sender);
        if (machineId == bytes32(0)) revert MachineNotRegistered();
        if (registry.isFrozen(machineId)) revert MachineFrozen();

        (uint256 estimatedStablecoinCost, uint48 priceValidUntil) = _weiToStablecoinAndValidUntil(maxCost);
        if (maxCostStablecoinPerUserOp > 0 && estimatedStablecoinCost > maxCostStablecoinPerUserOp) {
            revert UserOpCostExceedsCap();
        }

        if (creditOf[userOp.sender] < estimatedStablecoinCost) {
            revert InsufficientCredit();
        }

        // UPFRONT ESCROW: debit the gas quota upfront to prevent multi-op double-spend
        creditOf[userOp.sender] -= estimatedStablecoinCost;

        context = abi.encode(userOp.sender, estimatedStablecoinCost);

        // ERC-7562 rule [OP-011]:
        // Pack the price oracle expiry into the EntryPoint validUntil
        // forge-lint: disable-next-line(block-timestamp)
        uint48 defaultValidUntil = uint48(block.timestamp + 300);
        uint48 validUntil = priceValidUntil < defaultValidUntil ? priceValidUntil : defaultValidUntil;
        validationData = _packValidationData(false, validUntil, 0);
        return (context, validationData);
    }

    /**
     * @notice Charges the gas actually used in stablecoin after the UserOp has run.
     *         Refunds the unused part of the estimate to the account's credit.
     */
    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256)
        external
        override
        onlyEntryPoint
    {
        (address account, uint256 escrowedStablecoin) = abi.decode(context, (address, uint256));

        uint256 actualStablecoinCost = _weiToStablecoin(actualGasCost);
        if (actualStablecoinCost > escrowedStablecoin) {
            actualStablecoinCost = escrowedStablecoin;
        }

        // REFUND: return the escrowed excess gas quota to the account's credit balance
        uint256 refund = escrowedStablecoin - actualStablecoinCost;
        if (refund > 0) {
            creditOf[account] += refund;
        }
        totalCollectedStablecoin += actualStablecoinCost;

        emit GasCharged(account, actualStablecoinCost, actualGasCost, mode);
    }

    // --- Treasury & Administration ---

    /**
     * @notice Withdraws accumulated stablecoin gas fees to the treasury address.
     */
    function withdrawStablecoinToTreasury(uint256 amount) external onlyOwner {
        if (amount > totalCollectedStablecoin) revert AmountExceedsCollected();
        totalCollectedStablecoin -= amount;

        stablecoin.safeTransfer(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
    }

    function setPriceFeed(address newFeed) external onlyOwner {
        address oldFeed = address(priceFeed);
        priceFeed = IPriceFeed(newFeed);
        if (newFeed != address(0)) {
            try IPriceFeed(newFeed).decimals() returns (uint8 d) {
                oracleDecimals = d;
            } catch {
                oracleDecimals = 8;
            }
        } else {
            oracleDecimals = 8;
        }
        emit PriceFeedUpdated(oldFeed, newFeed);
    }

    function setNativePrice(uint256 newPrice) external onlyOwner {
        if (newPrice < minPrice || newPrice > maxPrice) revert InvalidPriceBounds();
        uint256 oldPrice = fixedNativePrice;
        fixedNativePrice = newPrice;
        lastPriceUpdate = block.timestamp;
        emit FixedPriceUpdated(oldPrice, newPrice);
    }

    function setPriceBounds(uint256 _minPrice, uint256 _maxPrice) external onlyOwner {
        if (_minPrice == 0 || _minPrice >= _maxPrice) revert InvalidPriceBounds();
        minPrice = _minPrice;
        maxPrice = _maxPrice;
        emit PriceBoundsUpdated(_minPrice, _maxPrice);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setMaxCostStablecoinPerUserOp(uint256 newMax) external onlyOwner {
        uint256 oldMax = maxCostStablecoinPerUserOp;
        maxCostStablecoinPerUserOp = newMax;
        emit MaxCostPerUserOpUpdated(oldMax, newMax);
    }

    function setMaxPriceStaleness(uint256 newStaleness) external onlyOwner {
        uint256 oldStaleness = maxPriceStaleness;
        maxPriceStaleness = newStaleness;
        emit MaxPriceStalenessUpdated(oldStaleness, newStaleness);
    }

    // --- Internal Price Conversion ---

    function _weiToStablecoinAndValidUntil(uint256 weiAmount) internal view returns (uint256, uint48) {
        if (weiAmount == 0) return (0, type(uint48).max);

        uint256 price;
        uint48 priceValidUntil;

        if (address(priceFeed) != address(0)) {
            // forge-lint: disable-next-line(unused-return)
            (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();

            if (answer <= 0) revert InvalidPrice();

            // ERC-7562 rule [OP-011]: do not branch on block.timestamp to revert during bundler validation!
            // Pack the oracle expiry into the EntryPoint validUntil
            priceValidUntil = uint48(updatedAt + maxPriceStaleness);
            // forge-lint: disable-next-line(unsafe-typecast)
            price = uint256(answer);
        } else {
            price = fixedNativePrice;
            if (price == 0) revert InvalidPrice();
            // ERC-7562 OP-011: expose expiry through validUntil instead of branching on block.timestamp.
            priceValidUntil = uint48(lastPriceUpdate + maxPriceStaleness);
        }

        uint256 cost = _calculateStablecoinFromPrice(weiAmount, price);
        return (cost, priceValidUntil);
    }

    function _weiToStablecoin(uint256 weiAmount) internal view returns (uint256) {
        (uint256 cost,) = _weiToStablecoinAndValidUntil(weiAmount);
        return cost;
    }

    function _calculateStablecoinFromPrice(uint256 weiAmount, uint256 price) internal view returns (uint256) {
        uint256 cost;
        if (stablecoinDecimals >= oracleDecimals) {
            uint256 numerator = weiAmount * price * (10 ** (stablecoinDecimals - oracleDecimals));
            uint256 denominator = 1e18;
            // Ceiling division so the result never rounds down
            cost = (numerator + denominator - 1) / denominator;
        } else {
            uint256 numerator = weiAmount * price;
            uint256 denominator = 1e18 * (10 ** (oracleDecimals - stablecoinDecimals));
            // Ceiling division so the result never rounds down
            cost = (numerator + denominator - 1) / denominator;
        }

        // Minimum gas fee: if gas used > 0, the fee is at least 1 stablecoin unit
        if (weiAmount > 0 && cost == 0) {
            cost = 1;
        }

        return cost;
    }

    function _packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
    }
}
