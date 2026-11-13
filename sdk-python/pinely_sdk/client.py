"""Pinely and MachineClient classes for the Python SDK (parity with the TypeScript SDK)."""

import time
from typing import Any, Dict, Optional
import requests
from web3 import Web3

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
from .userop import ENTRY_POINT_V07, verify_prepared_settlement

#: Robinhood Chain testnet and mainnet. Anything else is refused: the SDK never guesses a network.
SUPPORTED_CHAIN_IDS = (46630, 4663)

_nonce_counter = 0


def _generate_monotonic_nonce() -> int:
    """Generates a microsecond-resolution monotonic nonce preventing collisions."""
    global _nonce_counter
    _nonce_counter = (_nonce_counter + 1) % 1000
    return int(time.time() * 1000000) + _nonce_counter


def _require_supported_chain(chain_id: int) -> int:
    if chain_id not in SUPPORTED_CHAIN_IDS:
        raise ValueError(
            f"Unsupported chain id {chain_id} (expected one of {SUPPORTED_CHAIN_IDS})."
        )
    return chain_id


class MachineClient:
    """Public interface for a specific PINELY machine device."""

    def __init__(
        self,
        machine_id: str,
        name: str,
        operator: str,
        account: str,
        keystore: KeyStore,
        registry_address: str,
        stablecoin_address: str,
        chain_id: int,
        hook_address: Optional[str] = None,
        router_address: Optional[str] = None,
        paymaster_address: Optional[str] = None,
        entry_point_address: str = ENTRY_POINT_V07,
    ) -> None:
        self.machine_id = machine_id
        self.name = name
        self.operator = Web3.to_checksum_address(operator)
        self.account = Web3.to_checksum_address(account)
        self.keystore = keystore
        self.registry_address = Web3.to_checksum_address(registry_address)
        self.stablecoin_address = Web3.to_checksum_address(stablecoin_address)
        # PinelyHook and PinelyRouter only exist from Stage 2.
        self.hook_address = Web3.to_checksum_address(hook_address) if hook_address else None
        self.router_address = Web3.to_checksum_address(router_address) if router_address else None
        self.paymaster_address = (
            Web3.to_checksum_address(paymaster_address) if paymaster_address else None
        )
        self.entry_point_address = Web3.to_checksum_address(entry_point_address)
        self.chain_id = _require_supported_chain(chain_id)

    def _require_hook(self) -> str:
        if not self.hook_address:
            raise RuntimeError(
                f"PinelyHook is not deployed on chain {self.chain_id} (Stage 2). Swaps are unavailable."
            )
        return self.hook_address

    def quote_swap(self, token_in: str, amount_in: int) -> Dict[str, Any]:
        """Estimates the swap output with the Bronze fee tier.

        This is a local estimate: the on-chain tier is not read by the Python SDK.
        """
        lp_fee = (amount_in * 3000) // 1_000_000  # Bronze 0.30%
        protocol_fee = (amount_in * 500) // 1_000_000  # Protocol 0.05%
        amount_out = amount_in - lp_fee - protocol_fee

        return {
            "amountIn": amount_in,
            "amountOut": amount_out,
            "lpFee": lp_fee,
            "protocolFee": protocol_fee,
            "estimatedTier": 0,
        }

    def prepare_swap(
        self,
        token_in: str,
        amount_in: int,
        min_amount_out: int,
        token_out: Optional[str] = None,
        deadline_seconds: int = 300,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Prepares a signed EIP-712 SwapIntent and the encoded hookData."""
        if min_amount_out <= 0:
            raise ValueError("min_amount_out must be greater than 0 for slippage protection.")
        hook_address = self._require_hook()

        out_token = token_out or self.stablecoin_address
        resolved_nonce = nonce if nonce is not None else _generate_monotonic_nonce()
        deadline = int(time.time()) + deadline_seconds

        token_a = Web3.to_checksum_address(token_in)
        token_b = Web3.to_checksum_address(out_token)

        c0, c1 = (token_a, token_b) if token_a.lower() < token_b.lower() else (token_b, token_a)
        pool_id = compute_pool_id(c0, c1, 0x800000, 60, hook_address)

        intent = {
            "machineId": self.machine_id,
            "poolId": pool_id,
            "tokenIn": token_a,
            "tokenOut": token_b,
            "amountIn": amount_in,
            "minAmountOut": min_amount_out,
            "nonce": resolved_nonce,
            "deadline": deadline,
            "chainId": self.chain_id,
        }

        full_message = {
            "types": SWAP_INTENT_TYPES,
            "domain": get_pinely_domain(hook_address, self.chain_id),
            "primaryType": "SwapIntent",
            "message": intent,
        }

        signature = self.keystore.sign_typed_data(full_message)
        hook_data = encode_hook_data(intent, signature)

        return {
            "intent": intent,
            "signature": signature,
            "hookData": hook_data,
            "poolKey": {
                "currency0": c0,
                "currency1": c1,
                "fee": 0x800000,
                "tickSpacing": 60,
                "hooks": hook_address,
            },
        }

    def pay(
        self,
        url: str,
        max_amount: int,
        facilitator_url: Optional[str] = None,
        max_fee_bps: int = 100,
    ) -> Dict[str, Any]:
        """Executes the HTTP 402 (x402) payment protocol against a Facilitator.

        1. Reads the payment requirements from the resource's HTTP 402 challenge.
        2. Validates them against what this machine is willing to pay: the asset must be the configured
           stablecoin, the network must match, and the amount must not exceed `max_amount`.
        3. Signs an EIP-712 Payment402Intent, asks the Facilitator to prepare the sponsored UserOperation,
           verifies it field by field, signs its hash with the machine session key and submits it. A
           UserOperation that pays another recipient, a larger amount, uses another paymaster or inflated gas
           is never signed.

        Fail-closed: without a Facilitator URL, with an unexpected challenge, or without a Facilitator
        confirmation carrying both a transaction reference and an access token, the result is `failed`.
        Payments are never simulated.
        """

        def fail(error: str, amount: Optional[int] = None) -> Dict[str, Any]:
            return {"status": "failed", "resource": url, "amountStable": amount, "error": error}

        if not facilitator_url:
            return fail("facilitator_url is required: payments are never simulated.")

        # 1. HTTP 402 challenge
        try:
            challenge = requests.get(url, timeout=30)
        except Exception as e:  # network failure, timeout, ...
            return fail(str(e))
        if challenge.status_code != 402:
            return fail(f"Resource did not return HTTP 402 (got {challenge.status_code}).")
        try:
            accepts = challenge.json().get("accepts") or []
        except ValueError:
            accepts = []
        if not accepts:
            return fail("The 402 challenge contains no payment requirements.")
        accept = accepts[0]

        # 2. Validate the requirements before signing anything
        asset = str(accept.get("asset") or "")
        if not asset or asset.lower() != self.stablecoin_address.lower():
            return fail("The 402 challenge asks for an asset other than the configured stablecoin.")
        try:
            challenge_chain = int((accept.get("extra") or {}).get("chainId"))
        except (TypeError, ValueError):
            challenge_chain = None
        if challenge_chain != self.chain_id:
            return fail("The 402 challenge is for a different network.")
        pay_to = accept.get("payTo")
        if not pay_to or not Web3.is_address(pay_to):
            return fail("The 402 challenge has no valid payTo address.")
        try:
            amount = int(accept.get("maxAmountRequired"))
        except (TypeError, ValueError):
            return fail("The 402 challenge has no valid amount.")
        if amount <= 0 or amount > max_amount:
            return fail("The 402 challenge asks for more than max_amount.", amount)

        # 3. What the machine independently expects for the sponsored UserOperation
        if not self.paymaster_address:
            return fail("PinelyPaymaster address is required to verify the sponsored UserOperation.", amount)

        # 4. Sign the payment intent
        intent = {
            "machineId": self.machine_id,
            "resource": accept.get("resource") or url,
            "amountStable": amount,
            "nonce": _generate_monotonic_nonce(),
            "deadline": int(time.time()) + 300,
        }

        full_message = {
            "types": PAYMENT_402_TYPES,
            # The registry is deployed in Stage 1, so it is always available as the verifying contract.
            "domain": get_pinely_facilitator_domain(self.registry_address, self.chain_id),
            "primaryType": "Payment402Intent",
            "message": intent,
        }
        signature = self.keystore.sign_typed_data(full_message)

        base = facilitator_url.rstrip("/")
        request = {
            "intent": {
                "machineId": intent["machineId"],
                "resource": intent["resource"],
                "amountStable": str(amount),
                "nonce": str(intent["nonce"]),
                "deadline": str(intent["deadline"]),
            },
            "signature": signature,
            "machineAccount": self.account,
            "merchantAddress": Web3.to_checksum_address(pay_to),
        }

        try:
            # 5. The facilitator builds the unsigned UserOperation
            prepare_resp = requests.post(f"{base}/v1/settle/prepare", json=request, timeout=30)
            if prepare_resp.status_code != 200:
                return fail(
                    f"Facilitator returned HTTP {prepare_resp.status_code} while preparing", amount
                )
            prepared = prepare_resp.json()

            # 6. Never sign blindly: rebuild what the UserOperation must contain and compare
            try:
                verify_prepared_settlement(
                    prepared,
                    sender=self.account,
                    stablecoin=self.stablecoin_address,
                    merchant=pay_to,
                    gross_amount=amount,
                    paymaster=self.paymaster_address,
                    entry_point=self.entry_point_address,
                    chain_id=self.chain_id,
                    max_fee_bps=max_fee_bps,
                )
            except ValueError as e:
                return fail(f"Refused to sign the UserOperation: {e}", amount)

            # 7. PinelyAccount.validateUserOp recovers the signer from personal_sign over the raw hash
            user_op_signature = self.keystore.sign_message(bytes.fromhex(prepared["userOpHash"][2:]))

            # 8. Submit; the facilitator confirms on-chain before it answers
            resp = requests.post(
                f"{base}/v1/settle",
                json={**request, "userOp": prepared["userOp"], "userOpSignature": user_op_signature},
                timeout=60,
            )
        except Exception as e:  # network failure, timeout, malformed JSON ...
            return fail(str(e), amount)

        if resp.status_code != 200:
            return fail(f"Facilitator returned HTTP {resp.status_code}", amount)

        try:
            data = resp.json()
        except ValueError:
            data = {}
        if data.get("status") != "settled" or not data.get("txHash") or not data.get("accessToken"):
            return fail("Facilitator response did not confirm a settled payment.", amount)

        return {
            "status": "settled",
            "resource": url,
            "amountStable": amount,
            "txHash": data["txHash"],
            "accessToken": data["accessToken"],
        }


class MachineManager:
    """Factory helper for managing Pinely machines."""

    def __init__(self, client: "Pinely") -> None:
        self._client = client

    def create(
        self,
        name: str,
        operator: str,
        account: Optional[str] = None,
    ) -> MachineClient:
        """Creates a MachineClient.

        When `account` is omitted the signer address is used as the account, which is a development
        shortcut. Production machines pass the smart-account address predicted by the factory.
        """
        account_addr = account or self._client.keystore.address
        machine_id = compute_machine_id(account_addr)

        return MachineClient(
            machine_id=machine_id,
            name=name,
            operator=operator,
            account=account_addr,
            keystore=self._client.keystore,
            registry_address=self._client.registry_address,
            stablecoin_address=self._client.stablecoin_address,
            chain_id=self._client.chain_id,
            hook_address=self._client.hook_address,
            router_address=self._client.router_address,
            paymaster_address=self._client.paymaster_address,
            entry_point_address=self._client.entry_point_address,
        )


class Pinely:
    """Main client class for PINELY on Robinhood Chain.

    There are no default addresses: the registry and stablecoin addresses must be passed explicitly, taken
    from the deployment address book (`shared/contracts`) and the official Robinhood Chain documentation.
    """

    def __init__(
        self,
        keystore: KeyStore,
        chain_id: int,
        registry_address: str,
        stablecoin_address: str,
        hook_address: Optional[str] = None,
        router_address: Optional[str] = None,
        paymaster_address: Optional[str] = None,
        entry_point_address: str = ENTRY_POINT_V07,
    ) -> None:
        self.keystore = keystore
        self.chain_id = _require_supported_chain(chain_id)
        self.registry_address = Web3.to_checksum_address(registry_address)
        self.stablecoin_address = Web3.to_checksum_address(stablecoin_address)
        self.hook_address = Web3.to_checksum_address(hook_address) if hook_address else None
        self.router_address = Web3.to_checksum_address(router_address) if router_address else None
        self.paymaster_address = (
            Web3.to_checksum_address(paymaster_address) if paymaster_address else None
        )
        self.entry_point_address = Web3.to_checksum_address(entry_point_address)
        self.machines = MachineManager(self)

    @classmethod
    def connect(
        cls,
        private_key: str,
        chain_id: int,
        registry_address: str,
        stablecoin_address: str,
        hook_address: Optional[str] = None,
        router_address: Optional[str] = None,
        paymaster_address: Optional[str] = None,
        entry_point_address: str = ENTRY_POINT_V07,
    ) -> "Pinely":
        keystore = DevKeyStore(private_key)
        return cls(
            keystore=keystore,
            chain_id=chain_id,
            registry_address=registry_address,
            stablecoin_address=stablecoin_address,
            hook_address=hook_address,
            router_address=router_address,
            paymaster_address=paymaster_address,
            entry_point_address=entry_point_address,
        )
