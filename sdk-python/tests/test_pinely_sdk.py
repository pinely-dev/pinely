"""Unit and integration test suite for the PINELY Python SDK on Robinhood Chain."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

# Ensure the sdk-python directory is on the python search path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from web3 import Web3

from pinely_sdk import (
    PAYMENT_402_TYPES,
    ENTRY_POINT_V07,
    SWAP_INTENT_TYPES,
    DevKeyStore,
    Pinely,
    compute_machine_id,
    build_settlement_call_data,
    build_settlement_user_op,
    compute_pool_id,
    encode_hook_data,
    get_user_op_hash,
    get_pinely_domain,
    get_pinely_facilitator_domain,
    verify_prepared_settlement,
)
from pinely_sdk import client as client_module

TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
OPERATOR_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
MERCHANT_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
MOCK_REGISTRY = "0x1111111111111111111111111111111111111111"
MOCK_HOOK = "0x00000000000000000000000000000000000000c0"
MOCK_STABLECOIN = "0x4444444444444444444444444444444444444444"
MOCK_PAYMASTER = "0x5555555555555555555555555555555555555555"
OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
RESOURCE = "https://facilitator.example/v1/charge/dock-001"


def digest(full_message):
    """EIP-712 digest: keccak256(0x19 || version || domainSeparator || hashStruct)."""
    signable = encode_typed_data(full_message=full_message)
    return Web3.to_hex(Web3.keccak(b"\x19" + signable.version + signable.header + signable.body))


def make_client(**overrides):
    kwargs = dict(
        private_key=TEST_PRIVATE_KEY,
        chain_id=46630,
        registry_address=MOCK_REGISTRY,
        stablecoin_address=MOCK_STABLECOIN,
        hook_address=MOCK_HOOK,
        paymaster_address=MOCK_PAYMASTER,
    )
    kwargs.update(overrides)
    return Pinely.connect(**kwargs)


def response(status, payload):
    return SimpleNamespace(status_code=status, json=lambda: payload)


def challenge(**overrides):
    accept = {
        "asset": MOCK_STABLECOIN,
        "payTo": MERCHANT_ADDRESS,
        "maxAmountRequired": "250000",
        "resource": RESOURCE,
        "extra": {"chainId": 46630},
    }
    accept.update(overrides)
    return response(402, {"accepts": [accept]})


class TestPinelyPythonSDK(unittest.TestCase):
    def test_keystore_address_derivation(self):
        ks = DevKeyStore(TEST_PRIVATE_KEY)
        self.assertEqual(ks.address.lower(), EXPECTED_ADDRESS.lower())

    def test_compute_machine_id(self):
        m_id = compute_machine_id(EXPECTED_ADDRESS)
        self.assertTrue(m_id.startswith("0x"))
        self.assertEqual(len(m_id), 66)

    def test_compute_pool_id(self):
        pool_id = compute_pool_id(
            currency0="0x0000000000000000000000000000000000000001",
            currency1="0x0000000000000000000000000000000000000002",
            fee=3000,
            tick_spacing=60,
            hooks=MOCK_HOOK,
        )
        self.assertTrue(pool_id.startswith("0x"))
        self.assertEqual(len(pool_id), 66)

    def test_swap_quote(self):
        machine = make_client().machines.create("drone-01", OPERATOR_ADDRESS)
        quote = machine.quote_swap("0x1111111111111111111111111111111111111111", 1_000_000)
        self.assertEqual(quote["amountIn"], 1_000_000)
        self.assertEqual(quote["lpFee"], 3000)  # 0.30%
        self.assertEqual(quote["protocolFee"], 500)  # 0.05%
        self.assertEqual(quote["amountOut"], 996_500)

    def test_swap_intent_cryptographic_roundtrip(self):
        machine = make_client().machines.create("delivery-bot", OPERATOR_ADDRESS)
        prepared = machine.prepare_swap(
            token_in="0x1111111111111111111111111111111111111111",
            amount_in=5_000_000,
            min_amount_out=4_950_000,
            nonce=12345,
        )

        intent = prepared["intent"]
        self.assertTrue(prepared["hookData"].startswith("0x"))
        self.assertEqual(intent["chainId"], 46630)

        domain = get_pinely_domain(machine.hook_address, machine.chain_id)
        self.assertEqual(domain["name"], "PINELY")
        encoded = encode_typed_data(
            full_message={
                "types": SWAP_INTENT_TYPES,
                "domain": domain,
                "primaryType": "SwapIntent",
                "message": intent,
            }
        )
        recovered = Account.recover_message(encoded, signature=prepared["signature"])
        self.assertEqual(recovered.lower(), EXPECTED_ADDRESS.lower())

    def test_swap_requires_a_deployed_hook(self):
        machine = make_client(hook_address=None).machines.create("stage1", OPERATOR_ADDRESS)
        with self.assertRaises(RuntimeError):
            machine.prepare_swap(MOCK_STABLECOIN, 1_000_000, 990_000)

    def test_swap_requires_slippage_protection(self):
        machine = make_client().machines.create("bot", OPERATOR_ADDRESS)
        with self.assertRaises(ValueError):
            machine.prepare_swap(MOCK_STABLECOIN, 1_000_000, 0)

    def test_unsupported_chain_is_refused(self):
        for chain_id in (1, 1338, 12345, 56789):
            with self.assertRaises(ValueError):
                make_client(chain_id=chain_id)

    def test_no_default_addresses(self):
        with self.assertRaises(TypeError):
            Pinely.connect(TEST_PRIVATE_KEY, chain_id=46630)  # registry and stablecoin are mandatory


class TestParityAndReplayIsolation(unittest.TestCase):
    """Digests must equal the TypeScript SDK's (sdk/test/pinely-sdk.test.ts asserts the same values)."""

    def test_golden_swap_intent_digest(self):
        message = {
            "machineId": "0x" + "ab" * 32,
            "poolId": "0x" + "cd" * 32,
            "tokenIn": "0x7777777777777777777777777777777777777777",
            "tokenOut": "0x5555555555555555555555555555555555555555",
            "amountIn": 5_000_000,
            "minAmountOut": 4_950_000,
            "nonce": 12345,
            "deadline": 1893456000,
            "chainId": 46630,
        }
        full = {
            "types": SWAP_INTENT_TYPES,
            "domain": get_pinely_domain(MOCK_HOOK, 46630),
            "primaryType": "SwapIntent",
            "message": message,
        }
        self.assertEqual(
            digest(full),
            "0x7a138613a85ff1dcba3c0443ee7c8f1db83674bbd9eea60361647cc58e1b37d8",
        )

    def test_golden_payment_402_digest(self):
        message = {
            "machineId": "0x" + "ab" * 32,
            "resource": RESOURCE,
            "amountStable": 250_000,
            "nonce": 777,
            "deadline": 1893456000,
        }
        full = {
            "types": PAYMENT_402_TYPES,
            "domain": get_pinely_facilitator_domain(MOCK_REGISTRY, 46630),
            "primaryType": "Payment402Intent",
            "message": message,
        }
        self.assertEqual(
            digest(full),
            "0x13843d93774423f08e658920ed748443d9a203c5d002e6a54310d05ad5adf5d8",
        )

    def test_swap_deadline_is_uint64_like_the_contract(self):
        fields = {f["name"]: f["type"] for f in SWAP_INTENT_TYPES["SwapIntent"]}
        self.assertEqual(fields["deadline"], "uint64")

    def test_signature_from_a_different_domain_does_not_verify_under_the_pinely_domain(self):
        message = {
            "machineId": "0x" + "ab" * 32,
            "resource": RESOURCE,
            "amountStable": 1,
            "nonce": 1,
            "deadline": 1893456000,
        }
        foreign_domain = dict(get_pinely_facilitator_domain(MOCK_REGISTRY, 46630), name="OtherFacilitator")
        signature = DevKeyStore(TEST_PRIVATE_KEY).sign_typed_data(
            {
                "types": PAYMENT_402_TYPES,
                "domain": foreign_domain,
                "primaryType": "Payment402Intent",
                "message": message,
            }
        )
        pinely_message = encode_typed_data(
            full_message={
                "types": PAYMENT_402_TYPES,
                "domain": get_pinely_facilitator_domain(MOCK_REGISTRY, 46630),
                "primaryType": "Payment402Intent",
                "message": message,
            }
        )
        recovered = Account.recover_message(pinely_message, signature=signature)
        self.assertNotEqual(recovered.lower(), EXPECTED_ADDRESS.lower())

    def test_hook_data_encoding_is_stable(self):
        intent = {
            "machineId": "0x" + "ab" * 32,
            "poolId": "0x" + "cd" * 32,
            "tokenIn": MOCK_STABLECOIN,
            "tokenOut": OPERATOR_ADDRESS,
            "amountIn": 1,
            "minAmountOut": 1,
            "nonce": 1,
            "deadline": 1893456000,
            "chainId": 46630,
        }
        data = encode_hook_data(intent, "0x" + "aa" * 65)
        self.assertTrue(data.startswith("0x"))
        self.assertEqual((len(data) - 2) % 64, 0)


# Golden values shared with sdk/test/pinely-sdk.test.ts: settlement call data and userOpHash.
GOLDEN_SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
GOLDEN_STABLECOIN = "0x5555555555555555555555555555555555555555"
GOLDEN_MERCHANT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
GOLDEN_PAYMASTER = "0x3333333333333333333333333333333333333333"
GOLDEN_CALLDATA_HASH = "0x51a40e774fc4e5cc855cdfbddb43ae79bc867c6af30ca6643b22db561d5a2949"
GOLDEN_USEROP_HASH = "0xda0a784d712154dc66aea36f8be70a775ad46be734e223e5447ee6d85d909e0f"
GOLDEN_BATCH_CALLDATA_HASH = "0x01b762d1f0d0054a8d9d718fbc38a7ee5025e0569c5be95941ac88fe6b0bbe24"


class TestUserOpParity(unittest.TestCase):
    def test_golden_settlement_values_match_the_typescript_sdk(self):
        op = build_settlement_user_op(GOLDEN_SENDER, 7, GOLDEN_STABLECOIN, GOLDEN_MERCHANT, 99_900, GOLDEN_PAYMASTER)
        self.assertEqual(Web3.to_hex(Web3.keccak(hexstr=op["callData"])), GOLDEN_CALLDATA_HASH)
        self.assertEqual(get_user_op_hash(op, ENTRY_POINT_V07, 46630), GOLDEN_USEROP_HASH)

        batch = build_settlement_call_data(GOLDEN_STABLECOIN, GOLDEN_MERCHANT, 99_800, OTHER, 100)
        self.assertEqual(Web3.to_hex(Web3.keccak(hexstr=batch)), GOLDEN_BATCH_CALLDATA_HASH)

    def test_user_op_hash_ignores_the_signature_and_binds_chain_and_nonce(self):
        op = build_settlement_user_op(GOLDEN_SENDER, 7, GOLDEN_STABLECOIN, GOLDEN_MERCHANT, 1, GOLDEN_PAYMASTER)
        base = get_user_op_hash(op, ENTRY_POINT_V07, 46630)
        self.assertEqual(get_user_op_hash({**op, "signature": "0x" + "11" * 65}, ENTRY_POINT_V07, 46630), base)
        self.assertNotEqual(get_user_op_hash({**op, "nonce": hex(8)}, ENTRY_POINT_V07, 46630), base)
        self.assertNotEqual(get_user_op_hash(op, ENTRY_POINT_V07, 4663), base)


def consistent(op, **extra):
    """A prepared settlement whose hash matches its operation, as a malicious facilitator would send."""
    return {
        "userOp": op,
        "userOpHash": get_user_op_hash(op, ENTRY_POINT_V07, 46630),
        "entryPoint": ENTRY_POINT_V07,
        "chainId": 46630,
        **extra,
    }


class TestPaymentFlow(unittest.TestCase):
    def setUp(self):
        self.machine = make_client().machines.create("pay-bot", OPERATOR_ADDRESS)
        self.gross = 250_000

    def honest_op(self, request, fee=0, fee_recipient=None):
        return build_settlement_user_op(
            request["machineAccount"],
            5,
            MOCK_STABLECOIN,
            request["merchantAddress"],
            int(request["intent"]["amountStable"]) - fee,
            MOCK_PAYMASTER,
            fee_recipient,
            fee,
        )

    def run_pay(self, tamper=None, fee=0, fee_recipient=None, prepare_status=200, settle=None, challenge_reply=None, max_fee_bps=100):
        seen = {"prepare": 0, "settle": 0, "settle_body": None, "prepared": None}

        def fake_post(url, json, timeout):
            if url.endswith("/v1/settle/prepare"):
                seen["prepare"] += 1
                if prepare_status != 200:
                    return response(prepare_status, {})
                op = self.honest_op(json, fee, fee_recipient)
                prepared = tamper(op, json) if tamper else consistent(
                    op, facilitatorFee=str(fee), **({"feeRecipient": fee_recipient} if fee_recipient else {})
                )
                seen["prepared"] = prepared
                return response(200, prepared)
            seen["settle"] += 1
            seen["settle_body"] = json
            return response(
                200,
                settle or {"status": "settled", "txHash": "0x" + "ab" * 32, "accessToken": "tok"},
            )

        with mock.patch.object(
            client_module.requests, "get", return_value=challenge_reply or challenge()
        ), mock.patch.object(client_module.requests, "post", side_effect=fake_post):
            result = self.machine.pay(
                RESOURCE, 300_000, facilitator_url="https://facilitator.example", max_fee_bps=max_fee_bps
            )
        return result, seen

    def test_pay_is_never_simulated_without_a_facilitator(self):
        result = self.machine.pay(RESOURCE, 250_000)
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("accessToken", result)
        self.assertIn("facilitator_url is required", result["error"])

    def test_pay_prepares_verifies_signs_the_hash_and_settles(self):
        result, seen = self.run_pay()

        self.assertEqual(result["status"], "settled")
        self.assertEqual(result["amountStable"], 250_000)  # the challenge amount, not the cap
        self.assertEqual(result["accessToken"], "tok")
        self.assertEqual(seen["prepare"], 1)

        body = seen["settle_body"]
        self.assertEqual(body["merchantAddress"], MERCHANT_ADDRESS)
        self.assertEqual(body["machineAccount"], self.machine.account)
        self.assertEqual(body["userOp"], seen["prepared"]["userOp"])

        # The intent signature recovers to the session key under the PINELYFacilitator domain.
        intent = body["intent"]
        encoded = encode_typed_data(
            full_message={
                "types": PAYMENT_402_TYPES,
                "domain": get_pinely_facilitator_domain(MOCK_REGISTRY, 46630),
                "primaryType": "Payment402Intent",
                "message": {
                    "machineId": intent["machineId"],
                    "resource": intent["resource"],
                    "amountStable": int(intent["amountStable"]),
                    "nonce": int(intent["nonce"]),
                    "deadline": int(intent["deadline"]),
                },
            }
        )
        self.assertEqual(
            Account.recover_message(encoded, signature=body["signature"]).lower(), EXPECTED_ADDRESS.lower()
        )

        # The UserOperation signature is personal_sign over the raw userOpHash, which is exactly what
        # PinelyAccount.validateUserOp recovers.
        raw_hash = bytes.fromhex(seen["prepared"]["userOpHash"][2:])
        recovered = Account.recover_message(encode_defunct(primitive=raw_hash), signature=body["userOpSignature"])
        self.assertEqual(recovered.lower(), EXPECTED_ADDRESS.lower())

    def test_pay_accepts_a_small_facilitator_fee(self):
        result, seen = self.run_pay(fee=250, fee_recipient=OTHER)  # 0.10% of 250,000
        self.assertEqual(result["status"], "settled")
        self.assertEqual(seen["settle"], 1)

    def test_pay_never_signs_a_malicious_user_op(self):
        def op_for(request, **changes):
            args = dict(
                sender=request["machineAccount"], nonce=5, stablecoin=MOCK_STABLECOIN,
                merchant=request["merchantAddress"], amount=self.gross, paymaster=MOCK_PAYMASTER,
            )
            args.update(changes)
            return build_settlement_user_op(**args)

        cases = {
            "other recipient": lambda h, r: consistent(op_for(r, merchant=OTHER)),
            "more than agreed": lambda h, r: consistent(op_for(r, amount=self.gross * 2)),
            "other token": lambda h, r: consistent(op_for(r, stablecoin=OTHER)),
            "other paymaster": lambda h, r: consistent(op_for(r, paymaster=OTHER)),
            "other sender": lambda h, r: consistent(op_for(r, sender=OTHER)),
            "other entry point": lambda h, r: {
                **consistent(h),
                "entryPoint": OTHER,
                "userOpHash": get_user_op_hash(h, OTHER, 46630),
            },
            "inflated gas fees": lambda h, r: consistent({**h, "gasFees": "0x" + "00" * 15 + "01" + "00" * 15 + "ff"}),
            "inflated gas limits": lambda h, r: consistent({**h, "accountGasLimits": "0x" + "ff" * 32}),
            "initCode": lambda h, r: consistent({**h, "initCode": "0x" + "11" * 24}),
            "already signed": lambda h, r: consistent({**h, "signature": "0x" + "22" * 65}),
            "lying hash": lambda h, r: {**consistent(h), "userOpHash": "0x" + "33" * 32},
            "fee above cap": lambda h, r: consistent(
                op_for(r, amount=self.gross - 12_500, fee_recipient=OTHER, fee_amount=12_500),
                facilitatorFee="12500",
                feeRecipient=OTHER,
            ),
            "undeclared fee": lambda h, r: consistent(
                op_for(r, amount=self.gross - 100, fee_recipient=OTHER, fee_amount=100)
            ),
        }
        for label, tamper in cases.items():
            with self.subTest(label):
                result, seen = self.run_pay(tamper=tamper)
                self.assertEqual(result["status"], "failed")
                self.assertIn("Refused to sign the UserOperation", result["error"])
                self.assertEqual(seen["settle"], 0)  # nothing signed, nothing submitted

    def test_pay_requires_a_paymaster(self):
        self.machine = make_client(paymaster_address=None).machines.create("pay-bot", OPERATOR_ADDRESS)
        result, seen = self.run_pay()
        self.assertEqual(result["status"], "failed")
        self.assertIn("PinelyPaymaster address is required", result["error"])
        self.assertEqual(seen["prepare"], 0)

    def test_pay_reports_a_failed_prepare(self):
        result, seen = self.run_pay(prepare_status=403)
        self.assertEqual(result["status"], "failed")
        self.assertIn("HTTP 403", result["error"])
        self.assertEqual(seen["settle"], 0)

    def test_pay_refuses_to_sign_a_bad_challenge(self):
        cases = {
            "other asset": challenge(asset="0x9999999999999999999999999999999999999999"),
            "other network": challenge(extra={"chainId": 4663}),
            "above max": challenge(maxAmountRequired="300001"),
            "zero amount": challenge(maxAmountRequired="0"),
            "no payTo": challenge(payTo=None),
            "not a 402": response(200, {"accepts": []}),
        }
        for label, bad in cases.items():
            with self.subTest(label):
                result, seen = self.run_pay(challenge_reply=bad)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(seen["prepare"], 0)
                self.assertEqual(seen["settle"], 0)

    def test_pay_fails_when_the_facilitator_does_not_confirm(self):
        result, _ = self.run_pay(settle={"status": "settled"})  # no txHash, no token
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("accessToken", result)


if __name__ == "__main__":
    unittest.main()
