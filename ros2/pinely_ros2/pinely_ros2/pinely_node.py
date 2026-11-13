#!/usr/bin/env python3
"""
PINELY ROS2 node: autonomous machine payments on Robinhood Chain.

- Pays for power / compute services through the HTTP 402 Facilitator (/pinely/pay_service)
- Publishes honest machine telemetry periodically (/pinely/status, /pinely/balance)

Honesty rules (a robot controller may act on what this node reports):
- Nothing is simulated. Without a machine key, a configured Facilitator and a configured spend limit, a
  payment is refused rather than reported as successful.
- Values the node cannot know are reported as unknown (NaN balance, tier "unknown",
  `on_chain_state_known = false`), never as invented numbers.
- A transaction hash is only ever one returned by the Facilitator.
"""

import json
import math
import os
import stat
import time
from typing import Any, Dict, Optional

try:
    from pinely_sdk.client import Pinely

    HAS_PINELY_SDK = True
except ImportError:
    HAS_PINELY_SDK = False

try:
    import rclpy
    from rclpy.node import Node
    from std_msgs.msg import Float64, String
except ImportError:
    # Minimal stand-in for non-ROS2 environments / CI testing
    class Node:  # type: ignore
        def __init__(self, name: str) -> None:
            self.name = name
            self._params: Dict[str, Any] = {}

        def declare_parameter(self, name: str, default_value: Any) -> None:
            if name not in self._params:
                self._params[name] = default_value

        def get_parameter(self, name: str) -> Any:
            val = self._params.get(name)

            class Param:
                def __init__(self, v: Any):
                    self.value = v

            return Param(val)

        def get_logger(self) -> Any:
            class Logger:
                def info(self, msg: str) -> None:
                    print(f"[INFO] {msg}")

                def warn(self, msg: str) -> None:
                    print(f"[WARN] {msg}")

                def error(self, msg: str) -> None:
                    print(f"[ERROR] {msg}")

            return Logger()


SECONDS_PER_DAY = 86400

# Parameters and their defaults. Nothing that moves money has a usable default: the operator, the
# Facilitator, the addresses and the spend limit must all be configured explicitly.
PARAMETER_DEFAULTS: Dict[str, Any] = {
    "operator": "",
    "chain_id": 46630,
    "registry_address": "",
    "stablecoin_address": "",
    "hook_address": "",
    "router_address": "",
    "paymaster_address": "",
    "facilitator_url": "",
    # Local safety limit in stablecoin. 0 means "not configured", which blocks every payment (fail-closed).
    "daily_cap_stable": 0.0,
    "status_interval": 5.0,
    "key_file_path": "",
    "private_key": "",
}


class PinelyNode(Node):
    def __init__(self, parameter_overrides: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("pinely_node")
        logger = self.get_logger()
        logger.info("Initializing PINELY ROS2 Node on Robinhood Chain...")

        for name, value in {**PARAMETER_DEFAULTS, **(parameter_overrides or {})}.items():
            self.declare_parameter(name, value)

        self.operator = str(self.get_parameter("operator").value or "")
        self.chain_id = int(self.get_parameter("chain_id").value)
        self.facilitator_url = str(self.get_parameter("facilitator_url").value or "")
        self.status_interval = float(self.get_parameter("status_interval").value)
        self.daily_cap_stable = float(self.get_parameter("daily_cap_stable").value or 0.0)
        self.private_key = self._resolve_private_key()

        # --- Machine client binding ---
        self.client: Optional[Any] = None
        machine_id = ""
        registry = str(self.get_parameter("registry_address").value or "")
        stablecoin = str(self.get_parameter("stablecoin_address").value or "")
        if HAS_PINELY_SDK and self.private_key and self.operator and registry and stablecoin:
            try:
                pinely = Pinely.connect(
                    self.private_key,
                    chain_id=self.chain_id,
                    registry_address=registry,
                    stablecoin_address=stablecoin,
                    hook_address=str(self.get_parameter("hook_address").value or "") or None,
                    router_address=str(self.get_parameter("router_address").value or "") or None,
                    paymaster_address=str(self.get_parameter("paymaster_address").value or "") or None,
                )
                self.client = pinely.machines.create("ros2-device", self.operator)
                machine_id = self.client.machine_id
                logger.info(f"Pinely MachineClient active for machine: {machine_id}")
            except Exception as e:
                logger.error(f"Failed to create the MachineClient: {e}. Payments are disabled.")
        else:
            logger.warn(
                "MachineClient not created (needs the Python SDK, a machine key, operator, "
                "registry_address and stablecoin_address). Payments are disabled."
            )

        # --- Machine state: only what this node can actually know ---
        self._day = int(time.time() // SECONDS_PER_DAY)
        self.state: Dict[str, Any] = {
            "machine_id": machine_id,
            "tier": "unknown",
            "frozen": False,
            "on_chain_state_known": False,
            "stable_balance": math.nan,
            "daily_spent": 0.0,
            "daily_cap": self.daily_cap_stable,
            "last_error": "",
            "last_updated": time.time(),
        }

        # --- Publishers ---
        try:
            self.status_pub = self.create_publisher(String, "/pinely/status", 10)
            self.balance_pub = self.create_publisher(Float64, "/pinely/balance", 10)
            self.timer = self.create_timer(self.status_interval, self._publish_telemetry)
            logger.info("Topics /pinely/status and /pinely/balance active.")
        except Exception as e:
            logger.warn(f"Publishers not active (no ROS2 runtime): {e}")

        logger.info(f"PINELY Node ready for machine '{machine_id or 'unconfigured'}' on chain {self.chain_id}")

    def _resolve_private_key(self) -> str:
        """
        Resolves the machine private key. Priority:
        1. key_file_path (strict file permissions)
        2. PINELY_MACHINE_PRIVATE_KEY environment variable
        3. private_key parameter (emits a security warning)

        Note: the Python SDK holds the key in memory (DevKeyStore). It is not a hardware module.
        """
        logger = self.get_logger()
        key_file = str(self.get_parameter("key_file_path").value or "").strip()
        env_key = os.environ.get("PINELY_MACHINE_PRIVATE_KEY", "").strip()
        param_key = str(self.get_parameter("private_key").value or "").strip()

        if key_file:
            path = os.path.abspath(key_file)
            if not os.path.isfile(path):
                logger.error(f"Key file '{path}' not found!")
                return ""
            if os.name != "nt":
                try:
                    mode = os.stat(path).st_mode
                    if mode & (stat.S_IRWXG | stat.S_IRWXO):
                        logger.warn(
                            f"[SECURITY ALERT] Key file '{path}' has loose permissions ({oct(mode)}). "
                            "Please secure it with: chmod 0600"
                        )
                except Exception as e:
                    logger.warn(f"Could not verify key file permissions: {e}")
            try:
                with open(path, "r", encoding="utf-8") as f:
                    resolved = f.read().strip()
                    logger.info(f"Machine key loaded from file: {path}")
                    return resolved
            except Exception as e:
                logger.error(f"Failed to read key file: {e}")
                return ""

        if env_key:
            logger.info("Machine key loaded from environment variable.")
            return env_key

        if param_key:
            logger.warn(
                "[SECURITY WARNING] Machine private key provided via ROS2 parameter 'private_key'! "
                "ROS2 parameters can be dumped by other processes. "
                "For physical production devices, use 'key_file_path' or a TPM / Secure Element."
            )
            return param_key

        return ""

    def _roll_day(self) -> None:
        """Resets the local daily counter when the UTC day changes (wall-clock time, not blocks)."""
        today = int(time.time() // SECONDS_PER_DAY)
        if today != self._day:
            self._day = today
            self.state["daily_spent"] = 0.0

    def _publish_telemetry(self) -> None:
        """Periodically publishes machine telemetry."""
        try:
            self._roll_day()
            self.state["last_updated"] = time.time()
            status_msg = String()
            # NaN is not valid JSON, so the unknown balance is published as null here and as NaN on
            # the numeric topic.
            payload = dict(self.state)
            payload["stable_balance"] = None
            status_msg.data = json.dumps(payload)
            self.status_pub.publish(status_msg)

            balance_msg = Float64()
            balance_msg.data = float(self.state["stable_balance"])
            self.balance_pub.publish(balance_msg)
        except Exception as e:
            self.get_logger().error(f"Failed to publish telemetry: {e}")

    def _refuse(self, error: str) -> Dict[str, Any]:
        self.state["last_error"] = error
        return {"success": False, "amount_paid": 0, "tx_hash": "", "access_token": "", "error": error}

    def pay_service(self, url: str, max_amount: int, resource_id: str = "") -> Dict[str, Any]:
        """
        Pays for a service through the PINELY Facilitator (HTTP 402).

        The result is only successful when the Facilitator confirmed the settlement and returned a
        transaction hash and an access token. The local daily cap is a client-side safety net; the
        authoritative Spend Policy and kill switch are enforced on-chain and by the Facilitator.
        """
        logger = self.get_logger()
        self._roll_day()

        if self.state["frozen"]:
            logger.warn("Machine is frozen. Transaction cancelled.")
            return self._refuse("MachineIsFrozen")
        if self.client is None:
            return self._refuse("MachineClientNotConfigured")
        if not self.facilitator_url:
            return self._refuse("FacilitatorUrlNotConfigured")
        if self.daily_cap_stable <= 0:
            return self._refuse("DailyCapNotConfigured")

        # max_amount is an upper bound of what this payment can cost.
        if self.state["daily_spent"] + max_amount / 1e6 > self.daily_cap_stable:
            logger.warn("Daily spend cap would be exceeded. Transaction cancelled.")
            return self._refuse("DailyCapExceeded")

        try:
            receipt = self.client.pay(url, max_amount=max_amount, facilitator_url=self.facilitator_url)
        except Exception as e:
            logger.error(f"Payment failed: {e}")
            return self._refuse(str(e))

        tx_hash = receipt.get("txHash")
        token = receipt.get("accessToken")
        if receipt.get("status") != "settled" or not tx_hash or not token:
            return self._refuse(str(receipt.get("error") or "SettlementNotConfirmed"))

        paid = int(receipt.get("amountStable") or max_amount)
        self.state["daily_spent"] += paid / 1e6
        self.state["last_error"] = ""
        logger.info(f"Payment settled: {paid / 1e6} stablecoin to {url} (Tx: {tx_hash})")
        return {
            "success": True,
            "amount_paid": paid,
            "tx_hash": tx_hash,
            "access_token": token,
            "error": "",
        }

    def swap_revenue(self, token_in: str, amount_in: int, min_amount_out: int) -> Dict[str, Any]:
        """
        Revenue swaps are not executed by this node.

        The node can sign a SwapIntent, but submitting it to PinelyRouter needs a funded account and a
        deployed Stage 2 (hook + router). Rather than report an invented result, it says so.
        """
        self.state["last_error"] = "SwapSubmissionNotSupported"
        return {
            "success": False,
            "amount_out": 0,
            "tx_hash": "",
            "error": "SwapSubmissionNotSupported",
        }


def main(args: Optional[Any] = None) -> None:
    try:
        rclpy.init(args=args)
        node = PinelyNode()
        rclpy.spin(node)
        node.destroy_node()
        rclpy.shutdown()
    except Exception as e:
        print(f"Node shutdown / standalone test: {e}")


if __name__ == "__main__":
    main()
