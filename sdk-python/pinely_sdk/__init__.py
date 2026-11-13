"""PINELY Python SDK — autonomous machine finance on Robinhood Chain."""

from .client import SUPPORTED_CHAIN_IDS, MachineClient, Pinely
from .eip712 import (
    PAYMENT_402_TYPES,
    SWAP_INTENT_TYPES,
    compute_machine_id,
    compute_pool_id,
    encode_hook_data,
    get_pinely_domain,
    get_pinely_facilitator_domain,
)
from .keystore import DevKeyStore, KeyStore
from .userop import (
    ENTRY_POINT_V07,
    build_settlement_call_data,
    build_settlement_user_op,
    get_user_op_hash,
    verify_prepared_settlement,
)

__all__ = [
    "Pinely",
    "MachineClient",
    "SUPPORTED_CHAIN_IDS",
    "KeyStore",
    "DevKeyStore",
    "compute_machine_id",
    "compute_pool_id",
    "encode_hook_data",
    "get_pinely_domain",
    "get_pinely_facilitator_domain",
    "SWAP_INTENT_TYPES",
    "PAYMENT_402_TYPES",
    "ENTRY_POINT_V07",
    "build_settlement_call_data",
    "build_settlement_user_op",
    "get_user_op_hash",
    "verify_prepared_settlement",
]

__version__ = "0.1.0b1"
