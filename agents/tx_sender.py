"""Serialized on-chain sends with pending nonce tracking and retry on nonce races."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

_CHAIN_LOCKS: dict[int, threading.Lock] = {}
_NEXT_NONCE: dict[tuple[int, str], int] = {}


def _chain_lock(chain_id: int) -> threading.Lock:
    if chain_id not in _CHAIN_LOCKS:
        _CHAIN_LOCKS[chain_id] = threading.Lock()
    return _CHAIN_LOCKS[chain_id]


def _nonce_key(chain_id: int, address: str) -> tuple[int, str]:
    return (chain_id, address.lower())


def _is_nonce_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "nonce too low" in msg
        or "nonce too high" in msg
        or "already known" in msg
        or "replacement transaction underpriced" in msg
    )


def _nonce_from_error(exc: BaseException) -> int | None:
    """Robinhood/geth errors often include `state: N` — the next nonce to use."""
    import re

    m = re.search(r"state:\s*(\d+)", str(exc))
    return int(m.group(1)) if m else None


def send_contract_tx(
    w3,
    account,
    fn,
    *,
    value: int = 0,
    gas_buffer_pct: int = 30,
    max_retries: int = 5,
) -> str:
    """Sign and send a contract tx; one in-flight send per chain (global lock)."""
    chain_id = w3.eth.chain_id
    address = account.address
    key = _nonce_key(chain_id, address)
    lock = _chain_lock(chain_id)

    with lock:
        last_exc: BaseException | None = None
        for attempt in range(max_retries):
            try:
                chain_pending = w3.eth.get_transaction_count(address, "pending")
                tracked = _NEXT_NONCE.get(key)
                nonce = max(chain_pending, tracked) if tracked is not None else chain_pending

                try:
                    estimated = fn.estimate_gas({"from": address, "value": value})
                    gas_limit = int(estimated * (100 + gas_buffer_pct) / 100)
                except Exception as exc:
                    logger.warning("Gas estimate failed (%s), using 500k", exc)
                    gas_limit = 500_000

                tx = fn.build_transaction(
                    {
                        "from": address,
                        "nonce": nonce,
                        "gas": gas_limit,
                        "value": value,
                        "chainId": chain_id,
                    }
                )
                if "gasPrice" not in tx and "maxFeePerGas" not in tx:
                    tx["gasPrice"] = w3.eth.gas_price

                signed = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
                if receipt.status != 1:
                    raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")

                _NEXT_NONCE[key] = nonce + 1
                logger.info("Tx confirmed: %s (chain=%s nonce=%s)", tx_hash.hex(), chain_id, nonce)
                return tx_hash.hex()
            except Exception as exc:
                last_exc = exc
                if _is_nonce_error(exc) and attempt < max_retries - 1:
                    _NEXT_NONCE.pop(key, None)
                    hint = _nonce_from_error(exc)
                    if hint is not None:
                        _NEXT_NONCE[key] = hint
                    delay = 0.35 * (attempt + 1)
                    logger.warning(
                        "Nonce race on %s (attempt %s/%s), retrying in %.1fs: %s",
                        address,
                        attempt + 1,
                        max_retries,
                        delay,
                        exc,
                    )
                    time.sleep(delay)
                    continue
                raise

        if last_exc:
            raise last_exc
        raise RuntimeError("send_contract_tx failed without exception")
