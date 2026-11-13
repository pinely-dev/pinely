"""EIP-712 typing, hashing, and encoding utilities for PINELY on Robinhood Chain.

The type definitions here must stay identical to the TypeScript SDK (`sdk/src/utils/eip712.ts`) and to
the on-chain typehash in `PinelyHook.sol`. A golden-digest test in `tests/` enforces that parity.
"""

from typing import Any, Dict
from eth_abi import encode
from web3 import Web3


_EIP712_DOMAIN = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

SWAP_INTENT_TYPES = {
    "EIP712Domain": _EIP712_DOMAIN,
    "SwapIntent": [
        {"name": "machineId", "type": "bytes32"},
        {"name": "poolId", "type": "bytes32"},
        {"name": "tokenIn", "type": "address"},
        {"name": "tokenOut", "type": "address"},
        {"name": "amountIn", "type": "uint256"},
        {"name": "minAmountOut", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        # uint64 like the contract's SWAP_INTENT_TYPEHASH. A uint256 here would produce a different
        # type hash and the on-chain signature check would always fail.
        {"name": "deadline", "type": "uint64"},
        {"name": "chainId", "type": "uint256"},
    ],
}

PAYMENT_402_TYPES = {
    "EIP712Domain": _EIP712_DOMAIN,
    "Payment402Intent": [
        {"name": "machineId", "type": "bytes32"},
        {"name": "resource", "type": "string"},
        {"name": "amountStable", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint64"},
    ],
}


def get_pinely_domain(verifying_contract: str, chain_id: int) -> Dict[str, Any]:
    """Returns the canonical PINELY Hook EIP-712 domain."""
    return {
        "name": "PINELY",
        "version": "1",
        "chainId": chain_id,
        "verifyingContract": Web3.to_checksum_address(verifying_contract),
    }


def get_pinely_facilitator_domain(verifying_contract: str, chain_id: int) -> Dict[str, Any]:
    """Returns the canonical PINELY Facilitator (HTTP 402) EIP-712 domain."""
    return {
        "name": "PINELYFacilitator",
        "version": "1",
        "chainId": chain_id,
        "verifyingContract": Web3.to_checksum_address(verifying_contract),
    }


def compute_machine_id(account: str) -> str:
    """Computes the canonical machineId: keccak256(abi.encode(account))."""
    encoded = encode(["address"], [Web3.to_checksum_address(account)])
    return Web3.to_hex(Web3.keccak(encoded))


def compute_pool_id(currency0: str, currency1: str, fee: int, tick_spacing: int, hooks: str) -> str:
    """Computes the canonical Uniswap v4 PoolId: keccak256(abi.encode(PoolKey))."""
    encoded = encode(
        ["address", "address", "uint24", "int24", "address"],
        [
            Web3.to_checksum_address(currency0),
            Web3.to_checksum_address(currency1),
            fee,
            tick_spacing,
            Web3.to_checksum_address(hooks),
        ],
    )
    return Web3.to_hex(Web3.keccak(encoded))


def encode_hook_data(intent: Dict[str, Any], signature: str) -> str:
    """Encodes hookData: abi.encode(SwapIntent intent, bytes signature)."""
    intent_tuple = (
        bytes.fromhex(intent["machineId"][2:] if intent["machineId"].startswith("0x") else intent["machineId"]),
        bytes.fromhex(intent["poolId"][2:] if intent["poolId"].startswith("0x") else intent["poolId"]),
        Web3.to_checksum_address(intent["tokenIn"]),
        Web3.to_checksum_address(intent["tokenOut"]),
        int(intent["amountIn"]),
        int(intent["minAmountOut"]),
        int(intent["nonce"]),
        int(intent["deadline"]),
        int(intent["chainId"]),
    )
    sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)

    # deadline is uint64 in the Solidity struct; the ABI encoding pads it to 32 bytes, so the encoded
    # bytes are identical to a uint256 here. The tuple type still mirrors the struct exactly.
    tuple_type = "(bytes32,bytes32,address,address,uint256,uint256,uint256,uint64,uint256)"
    encoded = encode([tuple_type, "bytes"], [intent_tuple, sig_bytes])
    return Web3.to_hex(encoded)
