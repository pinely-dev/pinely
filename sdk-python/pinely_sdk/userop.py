"""ERC-4337 v0.7 UserOperation helpers (parity with `sdk/src/utils/userop.ts`).

The machine must never sign a UserOperation it has not checked. `verify_prepared_settlement` rebuilds the
expected call data from the payment requirements the machine itself validated and recomputes the
`userOpHash`, so a facilitator cannot slip in another recipient, a larger amount, a different paymaster or
inflated gas. Golden hashes in `tests/` pin this module to the TypeScript SDK byte for byte.
"""

from typing import Any, Dict, Optional

from eth_abi import encode
from web3 import Web3

#: Canonical ERC-4337 EntryPoint v0.7 (deterministic address). Present on Robinhood Chain testnet and mainnet.
ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"

# Static gas parameters (placeholders): production must use the bundler's estimate. Both SDKs pin the same
# values, so any deviation proposed by a facilitator is refused.
# verificationGasLimit (150,000) and callGasLimit (100,000), packed
SETTLEMENT_ACCOUNT_GAS_LIMITS = "0x000000000000000000000000000249f0000000000000000000000000000186a0"
# maxPriorityFeePerGas (0) and maxFeePerGas (0.1 gwei), packed. Robinhood Chain reports a priority fee of 0 and a
# base fee of 0.01 to 0.02 gwei, so the ceiling is 5 to 10 times the base fee. The previous 2 gwei made the
# prefund (450,000 gas) about $2.70 at an ETH price of $3,000, above the Paymaster's default cost cap, so every
# UserOperation would have been refused. Replace these with the bundler's estimate once a bundler is chosen.
SETTLEMENT_GAS_FEES = "0x0000000000000000000000000000000000000000000000000000000005f5e100"
SETTLEMENT_PRE_VERIFICATION_GAS = 50_000
# paymaster verificationGasLimit (100,000) and postOpGasLimit (50,000), 16 bytes each
_PAYMASTER_GAS_SUFFIX = "000000000000000000000000000186a0" + "0000000000000000000000000000c350"

#: Facilitator fee cap a machine accepts by default: 1.00% of the payment.
DEFAULT_MAX_FEE_BPS = 100


def _selector(signature: str) -> bytes:
    return Web3.keccak(text=signature)[:4]


def _transfer(to: str, amount: int) -> bytes:
    return _selector("transfer(address,uint256)") + encode(
        ["address", "uint256"], [Web3.to_checksum_address(to), amount]
    )


def _hex(data: bytes) -> str:
    return "0x" + data.hex()


def _bytes(value: str) -> bytes:
    return bytes.fromhex(value[2:] if value.startswith("0x") else value)


def _paymaster_and_data(paymaster: str) -> str:
    return "0x" + _bytes(Web3.to_checksum_address(paymaster)).hex() + _PAYMASTER_GAS_SUFFIX


def build_settlement_call_data(
    stablecoin: str,
    merchant: str,
    amount: int,
    fee_recipient: Optional[str] = None,
    fee_amount: int = 0,
) -> str:
    """`PinelyAccount.execute` for one stablecoin transfer, or `executeBatch` when a fee is paid in the same
    operation. `amount` is what the merchant receives."""
    token = Web3.to_checksum_address(stablecoin)
    if fee_recipient and fee_amount > 0:
        body = encode(
            ["address[]", "uint256[]", "bytes[]"],
            [
                [token, token],
                [0, 0],
                [_transfer(merchant, amount), _transfer(fee_recipient, fee_amount)],
            ],
        )
        return _hex(_selector("executeBatch(address[],uint256[],bytes[])") + body)

    body = encode(["address", "uint256", "bytes"], [token, 0, _transfer(merchant, amount)])
    return _hex(_selector("execute(address,uint256,bytes)") + body)


def build_settlement_user_op(
    sender: str,
    nonce: int,
    stablecoin: str,
    merchant: str,
    amount: int,
    paymaster: str,
    fee_recipient: Optional[str] = None,
    fee_amount: int = 0,
) -> Dict[str, Any]:
    """Builds the (unsigned) UserOperation that settles one x402 payment, in serialized form."""
    return {
        "sender": Web3.to_checksum_address(sender),
        "nonce": hex(nonce),
        "initCode": "0x",
        "callData": build_settlement_call_data(stablecoin, merchant, amount, fee_recipient, fee_amount),
        "accountGasLimits": SETTLEMENT_ACCOUNT_GAS_LIMITS,
        "preVerificationGas": hex(SETTLEMENT_PRE_VERIFICATION_GAS),
        "gasFees": SETTLEMENT_GAS_FEES,
        "paymasterAndData": _paymaster_and_data(paymaster),
        "signature": "0x",
    }


def get_user_op_hash(op: Dict[str, Any], entry_point: str, chain_id: int) -> str:
    """EntryPoint v0.7 `getUserOpHash`. The signature is not part of the hash."""
    packed = Web3.keccak(
        encode(
            ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
            [
                Web3.to_checksum_address(op["sender"]),
                int(op["nonce"], 16),
                Web3.keccak(_bytes(op["initCode"])),
                Web3.keccak(_bytes(op["callData"])),
                _bytes(op["accountGasLimits"]),
                int(op["preVerificationGas"], 16),
                _bytes(op["gasFees"]),
                Web3.keccak(_bytes(op["paymasterAndData"])),
            ],
        )
    )
    return Web3.to_hex(
        Web3.keccak(
            encode(
                ["bytes32", "address", "uint256"],
                [packed, Web3.to_checksum_address(entry_point), chain_id],
            )
        )
    )


def _same(a: Any, b: Any) -> bool:
    return str(a).lower() == str(b).lower()


def verify_prepared_settlement(
    prepared: Dict[str, Any],
    *,
    sender: str,
    stablecoin: str,
    merchant: str,
    gross_amount: int,
    paymaster: str,
    entry_point: str,
    chain_id: int,
    max_fee_bps: int = DEFAULT_MAX_FEE_BPS,
) -> Dict[str, Any]:
    """Checks a prepared UserOperation field by field and returns it only if the machine can safely sign
    it. Raises `ValueError` with a descriptive message otherwise. Nothing here trusts the facilitator."""
    try:
        op = prepared["userOp"]
        for key in (
            "sender", "nonce", "initCode", "callData", "accountGasLimits",
            "preVerificationGas", "gasFees", "paymasterAndData", "signature",
        ):
            if not isinstance(op.get(key), str):
                raise ValueError(f"UserOperation.{key} is missing")
        int(op["nonce"], 16)
        int(op["preVerificationGas"], 16)
        declared_hash = str(prepared["userOpHash"])
        declared_entry_point = str(prepared["entryPoint"])
        declared_chain = int(prepared["chainId"])
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"Malformed prepared settlement ({e})") from e

    if not _same(declared_entry_point, entry_point):
        raise ValueError("EntryPoint differs from the expected canonical EntryPoint")
    if declared_chain != chain_id:
        raise ValueError("UserOperation is for another network")
    if not _same(op["sender"], sender):
        raise ValueError("UserOperation is not sent from the machine account")
    if op["initCode"] != "0x":
        raise ValueError("UserOperation deploys code (initCode must be empty)")
    if op["signature"] != "0x":
        raise ValueError("UserOperation must be unsigned")
    if not _same(op["paymasterAndData"], _paymaster_and_data(paymaster)):
        raise ValueError("UserOperation uses an unexpected paymaster or paymaster gas")
    if (
        not _same(op["accountGasLimits"], SETTLEMENT_ACCOUNT_GAS_LIMITS)
        or not _same(op["gasFees"], SETTLEMENT_GAS_FEES)
        or int(op["preVerificationGas"], 16) != SETTLEMENT_PRE_VERIFICATION_GAS
    ):
        raise ValueError("UserOperation gas parameters differ from the expected values")

    # Facilitator fee: bounded, and the machine still pays exactly the agreed gross amount.
    fee = int(prepared.get("facilitatorFee") or 0)
    if fee < 0 or fee >= gross_amount:
        raise ValueError("Facilitator fee is out of range")
    if fee * 10_000 > gross_amount * max_fee_bps:
        raise ValueError("Facilitator fee exceeds the accepted maximum")
    fee_recipient = prepared.get("feeRecipient")
    if fee > 0 and not (fee_recipient and Web3.is_address(fee_recipient)):
        raise ValueError("Facilitator fee has no valid recipient")

    expected_call_data = build_settlement_call_data(
        stablecoin, merchant, gross_amount - fee, fee_recipient if fee > 0 else None, fee
    )
    if not _same(op["callData"], expected_call_data):
        raise ValueError("UserOperation call data does not match the agreed payment")

    if not _same(get_user_op_hash(op, entry_point, chain_id), declared_hash):
        raise ValueError("userOpHash does not match the UserOperation")
    return op
