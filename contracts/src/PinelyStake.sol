// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPinelyStake} from "./interfaces/IPinelyStake.sol";

/**
 * @title PinelyStake
 * @notice Staking of the $PINELY token by fleet operators to:
 *         1. Unlock the Gold fee tier (0.05% swap fee) in the Uniswap v4 Hook.
 *         2. Back fleet reputation, with slashing in case of a serious violation.
 *         3. Slashed tokens are sent straight to the BurnVault to be destroyed.
 *         4. A 7-day unbonding period prevents front-running when a slash happens.
 */
contract PinelyStake is IPinelyStake, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable pinelyToken;
    address public immutable burnVault;

    // Stake threshold for the Gold tier (10,000 $PINELY, standard 18 decimals)
    uint256 public constant MIN_STAKE_GOLD = 10_000 * 1e18;

    // Unbonding period before a stake can be withdrawn (7 days)
    uint256 public constant UNBONDING_PERIOD = 7 days;

    address public slashingAuthority;
    mapping(address => uint256) private _stakes;
    mapping(address => UnbondRequest) private _unbondRequests;

    event SlashingAuthorityUpdated(address indexed oldAuthority, address indexed newAuthority);

    constructor(address _pinelyToken, address _burnVault, address _slashingAuthority, address _owner) Ownable(_owner) {
        if (
            _pinelyToken == address(0) || _burnVault == address(0) || _slashingAuthority == address(0)
                || _owner == address(0)
        ) {
            revert ZeroAddress();
        }

        if (_pinelyToken.code.length > 0) {
            try IERC20Metadata(_pinelyToken).decimals() returns (uint8 dec) {
                if (dec != 18) revert InvalidToken();
            } catch {
                revert InvalidToken();
            }
        }

        pinelyToken = IERC20(_pinelyToken);
        burnVault = _burnVault;
        slashingAuthority = _slashingAuthority;
    }

    function setSlashingAuthority(address newAuthority) external onlyOwner {
        if (newAuthority == address(0)) revert ZeroAddress();
        address oldAuthority = slashingAuthority;
        slashingAuthority = newAuthority;
        emit SlashingAuthorityUpdated(oldAuthority, newAuthority);
    }

    function stake(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        _stakes[msg.sender] += amount;
        pinelyToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    function requestUnstake(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();
        if (_stakes[msg.sender] < amount) revert InsufficientStake();

        _stakes[msg.sender] -= amount;

        UnbondRequest storage req = _unbondRequests[msg.sender];
        req.amount += amount;
        // forge-lint: disable-next-line(block-timestamp)
        req.unlockTime = uint64(block.timestamp + UNBONDING_PERIOD);

        emit UnstakeRequested(msg.sender, amount, req.unlockTime);
    }

    function cancelUnstake() external override {
        UnbondRequest storage req = _unbondRequests[msg.sender];
        uint256 amount = req.amount;
        if (amount == 0) revert NoActiveUnbond();

        delete _unbondRequests[msg.sender];
        _stakes[msg.sender] += amount;

        emit UnstakeCancelled(msg.sender, amount);
    }

    function withdrawUnstaked() external override {
        UnbondRequest memory req = _unbondRequests[msg.sender];
        if (req.amount == 0) revert NoActiveUnbond();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < req.unlockTime) revert UnbondingNotMatured();

        uint256 amount = req.amount;
        delete _unbondRequests[msg.sender];

        pinelyToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function slash(address operator, uint256 amount, bytes32 evidenceHash) external override {
        if (msg.sender != slashingAuthority && msg.sender != owner()) revert NotSlashingAuthority();
        if (amount == 0) revert ZeroAmount();

        uint256 active = _stakes[operator];
        if (active >= amount) {
            _stakes[operator] -= amount;
        } else {
            uint256 remainder = amount - active;
            _stakes[operator] = 0;

            UnbondRequest storage req = _unbondRequests[operator];
            if (req.amount < remainder) revert InsufficientStake();
            req.amount -= remainder;
        }

        pinelyToken.safeTransfer(burnVault, amount);
        emit Slashed(operator, amount, evidenceHash);
    }

    function hasMinStakeGold(address operator) external view override returns (bool) {
        return _stakes[operator] >= MIN_STAKE_GOLD;
    }

    function stakeOf(address operator) external view override returns (uint256) {
        return _stakes[operator];
    }

    function unbondRequestOf(address operator) external view override returns (uint256 amount, uint64 unlockTime) {
        UnbondRequest memory req = _unbondRequests[operator];
        return (req.amount, req.unlockTime);
    }
}
