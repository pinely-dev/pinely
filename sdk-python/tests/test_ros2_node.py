"""PINELY ROS2 node: it must never report a payment it did not make, nor invent telemetry."""

import math
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ros2", "pinely_ros2"))
)

from pinely_ros2.pinely_node import PinelyNode  # noqa: E402

TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
OPERATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
REGISTRY = "0x1111111111111111111111111111111111111111"
stablecoin = "0x4444444444444444444444444444444444444444"
RESOURCE = "https://facilitator.example/v1/charge/dock-001"


def configured_node(**overrides):
    params = {
        "chain_id": 46630,
        "operator": OPERATOR,
        "registry_address": REGISTRY,
        "stablecoin_address": stablecoin,
        "facilitator_url": "https://facilitator.example",
        "daily_cap_stable": 1.0,
        "private_key": TEST_PRIVATE_KEY,
    }
    params.update(overrides)
    return PinelyNode(parameter_overrides=params)


class TestPinelyNode(unittest.TestCase):
    def test_unconfigured_node_refuses_to_pay_instead_of_simulating(self):
        node = PinelyNode()
        result = node.pay_service(RESOURCE, 100_000)
        self.assertFalse(result["success"])
        self.assertEqual(result["tx_hash"], "")
        self.assertEqual(result["error"], "MachineClientNotConfigured")

    def test_telemetry_never_invents_values(self):
        node = configured_node()
        self.assertEqual(node.state["tier"], "unknown")
        self.assertFalse(node.state["on_chain_state_known"])
        self.assertTrue(math.isnan(node.state["stable_balance"]))
        # The cap is exactly what the operator configured, not a default.
        self.assertEqual(node.state["daily_cap"], 1.0)
        self.assertEqual(PinelyNode().state["daily_cap"], 0.0)

    def test_no_default_operator_or_facilitator(self):
        node = PinelyNode()
        self.assertEqual(node.operator, "")
        self.assertEqual(node.facilitator_url, "")

    def test_payment_blocked_until_a_daily_cap_is_configured(self):
        node = configured_node(daily_cap_stable=0.0)
        self.assertEqual(node.pay_service(RESOURCE, 100_000)["error"], "DailyCapNotConfigured")

    def test_payment_blocked_without_a_facilitator(self):
        node = configured_node(facilitator_url="")
        self.assertEqual(node.pay_service(RESOURCE, 100_000)["error"], "FacilitatorUrlNotConfigured")

    def test_daily_cap_is_enforced_before_any_request(self):
        node = configured_node(daily_cap_stable=0.05)
        with mock.patch.object(node.client, "pay") as pay:
            result = node.pay_service(RESOURCE, 100_000)  # 0.10 stablecoin > 0.05 cap
        self.assertEqual(result["error"], "DailyCapExceeded")
        pay.assert_not_called()

    def test_settled_payment_reports_only_what_the_facilitator_returned(self):
        node = configured_node()
        receipt = {
            "status": "settled",
            "amountStable": 90_000,
            "txHash": "0x" + "ab" * 32,
            "accessToken": "tok",
        }
        with mock.patch.object(node.client, "pay", return_value=receipt) as pay:
            result = node.pay_service(RESOURCE, 100_000)

        self.assertTrue(result["success"])
        self.assertEqual(result["tx_hash"], "0x" + "ab" * 32)
        self.assertEqual(result["amount_paid"], 90_000)
        # The Facilitator URL must reach the SDK: dropping it used to silently simulate every payment.
        self.assertEqual(pay.call_args.kwargs["facilitator_url"], "https://facilitator.example")
        self.assertAlmostEqual(node.state["daily_spent"], 0.09)

    def test_unconfirmed_payment_is_a_failure_with_no_invented_hash(self):
        node = configured_node()
        for receipt in (
            {"status": "failed", "error": "Facilitator returned HTTP 503"},
            {"status": "settled"},  # no txHash, no token
        ):
            with self.subTest(receipt=receipt), mock.patch.object(node.client, "pay", return_value=receipt):
                result = node.pay_service(RESOURCE, 100_000)
                self.assertFalse(result["success"])
                self.assertEqual(result["tx_hash"], "")
                self.assertEqual(result["access_token"], "")
        self.assertEqual(node.state["daily_spent"], 0.0)

    def test_revenue_swap_is_not_faked(self):
        node = configured_node()
        result = node.swap_revenue(stablecoin, 1_000_000, 990_000)
        self.assertFalse(result["success"])
        self.assertEqual(result["tx_hash"], "")
        self.assertEqual(result["error"], "SwapSubmissionNotSupported")

    def test_daily_counter_resets_on_a_new_utc_day(self):
        node = configured_node()
        node.state["daily_spent"] = 0.9
        node._day -= 1  # pretend the counter belongs to yesterday
        node._roll_day()
        self.assertEqual(node.state["daily_spent"], 0.0)

    def test_key_resolution_from_file_and_environment(self):
        with tempfile.NamedTemporaryFile("w+", delete=False) as f:
            f.write(TEST_PRIVATE_KEY)
            path = f.name
        try:
            self.assertEqual(PinelyNode(parameter_overrides={"key_file_path": path}).private_key, TEST_PRIVATE_KEY)
        finally:
            os.remove(path)

        with mock.patch.dict(os.environ, {"PINELY_MACHINE_PRIVATE_KEY": TEST_PRIVATE_KEY}):
            self.assertEqual(PinelyNode().private_key, TEST_PRIVATE_KEY)

    def test_unrecognised_environment_variable_is_ignored(self):
        with mock.patch.dict(os.environ, {"OTHER_MACHINE_PRIVATE_KEY": TEST_PRIVATE_KEY}, clear=False):
            os.environ.pop("PINELY_MACHINE_PRIVATE_KEY", None)
            self.assertEqual(PinelyNode().private_key, "")


if __name__ == "__main__":
    unittest.main()
