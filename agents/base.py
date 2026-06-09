"""Shared Web3 + contract bindings for CredFlow agents."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3
from web3.contract import Contract

from agents.lz_options import build_lz_options

load_dotenv()

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
ADDRESSES_PATH = ROOT / "docs" / "addresses.json"
ABIS_DIR = ROOT / "docs" / "abis"

GAS_BUFFER_PCT = 30
DEFAULT_LZ_FEE_WEI = int(os.environ.get("LZ_NATIVE_FEE_PER_DST", "700000000000000"))  # ~0.0007 ETH per dst


def _load_abi(name: str) -> list[dict]:
    with open(ABIS_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _load_addresses() -> dict[str, Any]:
    with open(ADDRESSES_PATH, encoding="utf-8") as f:
        return json.load(f)


class CredFlowAgent:
    """Base agent with Robinhood hub bindings and tx helpers."""

    def __init__(self) -> None:
        rpc = os.environ.get("RPC_ROBINHOOD")
        if not rpc:
            raise RuntimeError("RPC_ROBINHOOD not set")
        pk = os.environ.get("AGENT_PRIVATE_KEY")
        if not pk:
            raise RuntimeError("AGENT_PRIVATE_KEY not set")

        self.w3 = Web3(Web3.HTTPProvider(rpc))
        if not self.w3.is_connected():
            raise RuntimeError(f"Cannot connect to RPC_ROBINHOOD: {rpc}")

        self.account = Account.from_key(pk)
        self.addresses = _load_addresses()

        self.sbt: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.addresses["sbt"]),
            abi=_load_abi("CredScoreSBT.json"),
        )
        self.score_engine: Contract | None = None
        engine_addr = self.addresses.get("scoreEngine") or os.environ.get("CREDSCORE_ENGINE_ADDRESS")
        if engine_addr and str(engine_addr) not in ("0x0", "0x0000000000000000000000000000000000000000", ""):
            engine_abi_path = ABIS_DIR / "CredScoreEngine.json"
            if engine_abi_path.exists():
                self.score_engine = self.w3.eth.contract(
                    address=Web3.to_checksum_address(engine_addr),
                    abi=_load_abi("CredScoreEngine.json"),
                )
        self.lending: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.addresses["lending"]),
            abi=_load_abi("CredFlowLending.json"),
        )
        self.pool: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.addresses["pool"]),
            abi=_load_abi("CredFlowLP.json"),
        )
        hub_oapp = os.environ.get("HUB_OAPP_ADDRESS") or self.addresses["oapp"]
        self.oapp: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(hub_oapp),
            abi=_load_abi("CredFlowOApp.json"),
        )

        self._verify_roles()

    def _verify_roles(self) -> None:
        agent = self.account.address
        lending_role = self.lending.functions.AGENT_ROLE().call()
        if not self.lending.functions.hasRole(lending_role, agent).call():
            logger.warning("Agent wallet lacks AGENT_ROLE on lending")

        oapp_role = self.oapp.functions.AGENT_ROLE().call()
        if not self.oapp.functions.hasRole(oapp_role, agent).call():
            logger.warning("Agent wallet lacks AGENT_ROLE on hub OApp")

        scorer_role = self.sbt.functions.SCORER_ROLE().call()
        if not self.sbt.functions.hasRole(scorer_role, agent).call() and self.score_engine is None:
            logger.warning("Agent wallet lacks SCORER_ROLE on SBT and no CredScoreEngine configured")

        if self.score_engine is not None:
            engine_scorer = self.score_engine.functions.SCORER_ROLE().call()
            if not self.score_engine.functions.hasRole(engine_scorer, agent).call():
                logger.warning("Agent wallet lacks SCORER_ROLE on CredScoreEngine")

    def dst_chain_eids(self) -> list[int]:
        eids = []
        if os.environ.get("ARBITRUM_OAPP_ADDRESS"):
            eids.append(int(os.environ.get("LZ_EID_ARBITRUM", "40231")))
        if os.environ.get("BASE_OAPP_ADDRESS"):
            eids.append(int(os.environ.get("LZ_EID_BASE", "40245")))
        return eids

    def send_tx(self, fn, value: int = 0) -> str:
        """Build, estimate gas (+buffer), sign and send transaction."""
        nonce = self.w3.eth.get_transaction_count(self.account.address)
        try:
            estimated = fn.estimate_gas({"from": self.account.address, "value": value})
            gas_limit = int(estimated * (100 + GAS_BUFFER_PCT) / 100)
        except Exception as exc:
            logger.warning("Gas estimate failed (%s), using 500k", exc)
            gas_limit = 500_000

        tx = fn.build_transaction(
            {
                "from": self.account.address,
                "nonce": nonce,
                "gas": gas_limit,
                "value": value,
                "chainId": self.w3.eth.chain_id,
            }
        )
        if "gasPrice" not in tx and "maxFeePerGas" not in tx:
            tx["gasPrice"] = self.w3.eth.gas_price

        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt.status != 1:
            raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")
        logger.info("Tx confirmed: %s", tx_hash.hex())
        return tx_hash.hex()

    def lz_options(self, gas_limit: int = 200_000) -> bytes:
        return build_lz_options(gas_limit)

    def lz_fee_for_broadcast(self, dst_count: int) -> int:
        fee = DEFAULT_LZ_FEE_WEI * max(dst_count, 1)
        balance = self.w3.eth.get_balance(self.account.address)
        logger.info("LZ fee estimate: %s wei (balance %s wei)", fee, balance)
        if balance < fee:
            logger.warning("Insufficient ETH for LZ fees — tx may revert")
        return fee

    def broadcast_score(self, wallet: str, score: int) -> str | None:
        eids = self.dst_chain_eids()
        if not eids:
            logger.info("No spoke OApps configured — skip broadcastScore")
            return None
        options = self.lz_options()
        last_tx: str | None = None
        # Hub OApp divides msg.value across dsts but _payNative requires msg.value == fee;
        # send one destination per transaction until the contract overrides _payNative.
        for eid in eids:
            fee = self.lz_fee_for_broadcast(1)
            fn = self.oapp.functions.broadcastScore([eid], wallet, score, options)
            last_tx = self.send_tx(fn, value=fee)
            logger.info("broadcastScore eid=%s tx=%s", eid, last_tx)
        return last_tx

    def broadcast_default(self, wallet: str) -> str | None:
        eids = self.dst_chain_eids()
        if not eids:
            logger.info("No spoke OApps configured — skip broadcastDefault")
            return None
        options = self.lz_options()
        last_tx: str | None = None
        for eid in eids:
            fee = self.lz_fee_for_broadcast(1)
            fn = self.oapp.functions.broadcastDefault([eid], wallet, options)
            last_tx = self.send_tx(fn, value=fee)
            logger.info("broadcastDefault eid=%s tx=%s", eid, last_tx)
        return last_tx

    def broadcast_loan_active(self, wallet: str) -> str | None:
        eids = self.dst_chain_eids()
        if not eids:
            logger.info("No spoke OApps configured — skip broadcastLoanActive")
            return None
        options = self.lz_options()
        last_tx: str | None = None
        for eid in eids:
            fee = self.lz_fee_for_broadcast(1)
            fn = self.oapp.functions.broadcastLoanActive([eid], wallet, options)
            last_tx = self.send_tx(fn, value=fee)
            logger.info("broadcastLoanActive eid=%s tx=%s", eid, last_tx)
        return last_tx

    def broadcast_repaid(self, wallet: str) -> str | None:
        eids = self.dst_chain_eids()
        if not eids:
            logger.info("No spoke OApps configured — skip broadcastRepaid")
            return None
        options = self.lz_options()
        last_tx: str | None = None
        for eid in eids:
            fee = self.lz_fee_for_broadcast(1)
            fn = self.oapp.functions.broadcastRepaid([eid], wallet, options)
            last_tx = self.send_tx(fn, value=fee)
            logger.info("broadcastRepaid eid=%s tx=%s", eid, last_tx)
        return last_tx


SPOKE_CONFIG: dict[str, dict[str, str]] = {
    "arbitrum": {
        "rpc_env": "RPC_ARBITRUM_SEPOLIA",
        "alchemy_env": "ALCHEMY_ARBITRUM_SEPOLIA_RPC",
        "addresses_file": "spoke-arbitrum-addresses.json",
    },
    "base": {
        "rpc_env": "RPC_BASE_SEPOLIA",
        "alchemy_env": "ALCHEMY_BASE_SEPOLIA_RPC",
        "addresses_file": "spoke-base-addresses.json",
    },
}


class SpokeAgent:
    """Agent bindings for spoke-chain CredFlowSpokeLending + OApp."""

    def __init__(self, chain: str = "arbitrum") -> None:
        chain = chain.lower()
        if chain not in SPOKE_CONFIG:
            raise ValueError(f"Unknown spoke chain '{chain}'. Use: arbitrum | base")

        cfg = SPOKE_CONFIG[chain]
        rpc = os.environ.get(cfg["rpc_env"]) or os.environ.get(cfg["alchemy_env"])
        if not rpc:
            raise RuntimeError(f"{cfg['rpc_env']} not set")

        pk = os.environ.get("AGENT_PRIVATE_KEY")
        if not pk:
            raise RuntimeError("AGENT_PRIVATE_KEY not set")

        self.chain = chain
        self.w3 = Web3(Web3.HTTPProvider(rpc))
        if not self.w3.is_connected():
            raise RuntimeError(f"Cannot connect to {cfg['rpc_env']}: {rpc}")

        self.account = Account.from_key(pk)
        addr_path = ROOT / "docs" / cfg["addresses_file"]
        with open(addr_path, encoding="utf-8") as f:
            self.addresses = json.load(f)

        if not self.addresses.get("lending"):
            raise RuntimeError(f"Spoke lending not deployed — see {addr_path}")

        self.lending: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.addresses["lending"]),
            abi=_load_abi("CredFlowSpokeLending.json"),
        )
        self.oapp: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.addresses["oapp"]),
            abi=_load_abi("CredFlowOApp.json"),
        )

    def send_tx(self, fn, value: int = 0) -> str:
        agent = CredFlowAgent.__new__(CredFlowAgent)
        agent.w3 = self.w3
        agent.account = self.account
        return CredFlowAgent.send_tx(agent, fn, value=value)
