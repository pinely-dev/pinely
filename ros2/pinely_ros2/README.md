# pinely_ros2

ROS2 node that lets a robot pay for services through the PINELY Facilitator (HTTP 402) on Robinhood Chain.

## What it guarantees

- **Nothing is simulated.** Without a machine key, a Facilitator URL, the registry and stablecoin addresses and
  a configured daily cap, `/pinely/pay_service` refuses with an explicit error. It never returns a made-up
  success or transaction hash.
- **Telemetry is honest.** `tier` is `unknown`, `stable_balance` is `NaN` and `on_chain_state_known` is
  `false` until the node actually reads them. A controller must not treat the absence of a value as a
  safe value.
- **A payment succeeds only if the Facilitator confirms it** and returns a transaction hash and an access
  token. The daily cap is a local safety net; the Spend Policy and kill switch are enforced on-chain and
  by the Facilitator.
- **`/pinely/swap_revenue` is not implemented.** It answers `SwapSubmissionNotSupported`.

## Parameters

| Parameter | Required | Notes |
| :--- | :---: | :--- |
| `operator` | yes | Operator address of the machine |
| `registry_address`, `stablecoin_address` | yes | From the deployment address book and the official Robinhood Chain docs |
| `paymaster_address` | yes | `PinelyPaymaster`; the node refuses to sign a UserOperation that uses any other |
| `facilitator_url` | yes | Base URL of the Facilitator |
| `daily_cap_stable` | yes | `0` blocks every payment |
| `chain_id` | no | `46630` (testnet, default) or `4663` (mainnet) |
| `hook_address`, `router_address` | no | Stage 2 only |
| `key_file_path` | one of | File with the machine key, permissions `0600` |
| `PINELY_MACHINE_PRIVATE_KEY` | one of | Environment variable |
| `private_key` | discouraged | ROS2 parameters can be dumped by other processes |

## Key storage

The Python SDK keeps the key in memory (`DevKeyStore`). It is **not** a TPM or Secure Element. Do not
treat a physical device as hardware-protected until a real hardware key store is integrated.
