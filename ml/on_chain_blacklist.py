"""On-chain blacklist / defaulter lookups for sybil graph analysis."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv
from web3 import Web3

from indexer.chains import chain_rpc_url, hub_chain, load_hub_addresses, spoke_chains

load_dotenv()

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
ABIS_DIR = ROOT / "docs" / "abis"

IS_BLACKLISTED_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "wallet", "type": "address"}],
        "name": "isBlacklisted",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    }
]

GET_PROFILE_ABI = []  # loaded from CredScoreSBT.json via _hub_sbt_contract()

_SPOKE_ADDRESS_FILES = {
    "arbitrum_sepolia": "spoke-arbitrum-addresses.json",
    "base_sepolia": "spoke-base-addresses.json",
}

_risk_cache: dict[str, bool] = {}


def _load_spoke_addresses(chain_key: str) -> dict:
    fname = _SPOKE_ADDRESS_FILES.get(chain_key)
    if not fname:
        return {}
    path = ROOT / "docs" / fname
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _load_sbt_abi() -> list:
    path = ABIS_DIR / "CredScoreSBT.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _hub_sbt_contract():
    rpc = chain_rpc_url(hub_chain())
    if not rpc:
        logger.warning("Hub RPC unavailable — sybil defaulter lookups skipped")
        return None, None

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        logger.warning("Cannot connect to hub RPC for sybil defaulter lookups")
        return None, None

    addresses = load_hub_addresses()
    sbt_addr = addresses.get("sbt")
    if not sbt_addr:
        logger.warning("Hub SBT address missing from docs/addresses.json")
        return None, None

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(sbt_addr),
        abi=_load_sbt_abi(),
    )
    return w3, contract


@lru_cache(maxsize=4)
def _spoke_oapp_contract(chain_key: str):
    chain = next((c for c in spoke_chains() if c.key == chain_key), None)
    if chain is None:
        return None
    rpc = chain_rpc_url(chain)
    if not rpc:
        return None

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        return None

    oapp_addr = _load_spoke_addresses(chain_key).get("oapp")
    if not oapp_addr:
        return None

    return w3.eth.contract(
        address=Web3.to_checksum_address(oapp_addr),
        abi=IS_BLACKLISTED_ABI,
    )


def _normalize_address(address: str) -> str | None:
    raw = (address or "").strip().lower()
    if len(raw) != 42 or not raw.startswith("0x"):
        return None
    return raw


def is_hub_risk_address(address: str) -> bool:
    """True if hub SBT marks wallet blacklisted or with defaultCount > 0."""
    normalized = _normalize_address(address)
    if not normalized:
        return False

    if normalized in _risk_cache:
        return _risk_cache[normalized]

    _, sbt = _hub_sbt_contract()
    if sbt is None:
        _risk_cache[normalized] = False
        return False

    checksum = Web3.to_checksum_address(normalized)
    try:
        if bool(sbt.functions.isBlacklisted(checksum).call()):
            _risk_cache[normalized] = True
            return True
        profile = sbt.functions.getProfile(checksum).call()
        if not bool(sbt.functions.hasProfile(checksum).call()):
            _risk_cache[normalized] = False
            return False
        default_count = int(profile[5])  # defaultCount in CreditProfile
        is_risk = default_count > 0
        _risk_cache[normalized] = is_risk
        return is_risk
    except Exception as exc:
        logger.warning("Hub risk lookup failed for %s: %s", normalized, exc)
        _risk_cache[normalized] = False
        return False


def is_spoke_blacklisted(chain_key: str, address: str) -> bool:
    normalized = _normalize_address(address)
    if not normalized:
        return False

    cache_key = f"{chain_key}:{normalized}"
    if cache_key in _risk_cache:
        return _risk_cache[cache_key]

    contract = _spoke_oapp_contract(chain_key)
    if contract is None:
        _risk_cache[cache_key] = False
        return False

    try:
        flagged = bool(
            contract.functions.isBlacklisted(Web3.to_checksum_address(normalized)).call()
        )
        _risk_cache[cache_key] = flagged
        return flagged
    except Exception as exc:
        logger.warning("Spoke blacklist lookup failed %s %s: %s", chain_key, normalized, exc)
        _risk_cache[cache_key] = False
        return False


def is_on_chain_risk_address(address: str) -> bool:
    """Hub blacklist/defaulter OR blacklisted on any CredFlow spoke OApp."""
    if is_hub_risk_address(address):
        return True
    for chain in spoke_chains():
        if is_spoke_blacklisted(chain.key, address):
            return True
    return False


def fetch_on_chain_risk_addresses(addresses: Iterable[str]) -> set[str]:
    """Return subset of addresses flagged on-chain as defaulters or blacklisted."""
    risk: set[str] = set()
    for address in addresses:
        normalized = _normalize_address(address)
        if normalized and is_on_chain_risk_address(normalized):
            risk.add(normalized)
    return risk
