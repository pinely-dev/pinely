# PINELY Python SDK

Python package for autonomous machine finance on Robinhood Chain (testnet `46630`, mainnet `4663`). It mirrors the
TypeScript SDK (`@pinely-protocol/sdk`):

- Machine key store abstraction (`DevKeyStore`, `KeyStore`).
- EIP-712 signing for revenue swaps (`SwapIntent`) and HTTP 402 payments (`Payment402Intent`).
- `hookData` encoding for the PinelyHook (Stage 2).

## Install

```bash
pip install -e sdk-python
```

## Usage

```python
from pinely_sdk import Pinely

pinely = Pinely.connect(
    private_key="0x...",
    chain_id=46630,
    registry_address="0x...",  # MachineRegistry, from the deployment address book
    stablecoin_address="0x...",      # canonical stablecoin, from the official Robinhood Chain documentation
    paymaster_address="0x...", # PinelyPaymaster, required for payments
)
machine = pinely.machines.create(name="autonomous-delivery-01", operator="0x...")

result = machine.pay(
    "https://facilitator.example/v1/charge/dock-001",
    max_amount=250_000,  # 0.25 stablecoin (6 decimals): an upper bound, the challenge amount is what is paid
    facilitator_url="https://facilitator.example",
)
```

## Behaviour you can rely on

- **No default addresses and no default network.** A missing address or an unsupported chain raises.
- **Payments are never simulated.** Without `facilitator_url`, with a 402 challenge for another asset,
  network or a larger amount, or without a Facilitator confirmation carrying a transaction hash and an
  access token, the result is `failed`.
- **Never signs blindly.** The prepared UserOperation is rebuilt and compared field by field (recipient,
  amount, token, paymaster, gas, fee cap) before its hash is signed.
- **Swaps need Stage 2.** `prepare_swap` raises until a `hook_address` is configured.
- **Replay isolation.** The domains are `PINELY` and `PINELYFacilitator`, bound to the chain id. Tests assert
  digests identical to the TypeScript SDK and the contract's type hash, so signatures from any earlier
  deployment never verify.

## Tests

```bash
python -m unittest discover -s sdk-python/tests -t sdk-python
```
