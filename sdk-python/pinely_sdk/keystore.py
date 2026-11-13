"""Keystore abstraction for PINELY hardware & autonomous machines."""

from abc import ABC, abstractmethod
from typing import Any, Dict
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data


class KeyStore(ABC):
    """Abstract keystore interface for machine private keys."""

    @property
    @abstractmethod
    def address(self) -> str:
        """Returns the checksum Ethereum address of the signer."""
        pass

    @abstractmethod
    def sign_message(self, message: bytes) -> str:
        """Signs an arbitrary message using EIP-191 personal sign."""
        pass

    @abstractmethod
    def sign_typed_data(self, full_message: Dict[str, Any]) -> str:
        """Signs an EIP-712 structured typed data payload."""
        pass


class DevKeyStore(KeyStore):
    """
    In-memory developer keystore.
    WARNING: For local development and testing only. Do not use on production hardware!
    """

    def __init__(self, private_key: str) -> None:
        if private_key.startswith("0x"):
            self._account = Account.from_key(private_key)
        else:
            self._account = Account.from_key(f"0x{private_key}")

    @property
    def address(self) -> str:
        return self._account.address

    def sign_message(self, message: bytes) -> str:
        encoded = encode_defunct(message)
        signed = self._account.sign_message(encoded)
        sig = signed.signature.hex()
        return f"0x{sig}" if not sig.startswith("0x") else sig

    def sign_typed_data(self, full_message: Dict[str, Any]) -> str:
        encoded = encode_typed_data(full_message=full_message)
        signed = self._account.sign_message(encoded)
        sig = signed.signature.hex()
        return f"0x{sig}" if not sig.startswith("0x") else sig
