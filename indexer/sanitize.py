"""Sanitize indexer payloads before API / debug responses."""

from __future__ import annotations

import re
from typing import Any

_ALCHEMY_KEY_RE = re.compile(r"(https?://[^/]+\.alchemy\.com/v2/)([^/?#]+)")


def redact_rpc_url(url: str) -> str:
    """Mask Alchemy API keys embedded in RPC URLs."""
    if not url:
        return url
    return _ALCHEMY_KEY_RE.sub(r"\1***", str(url))


def sanitize_source_payload(data: Any) -> Any:
    """Recursively redact sensitive RPC URLs in source_data trees."""
    if isinstance(data, dict):
        out: dict = {}
        for key, value in data.items():
            if key == "_rpc" and isinstance(value, str):
                out[key] = redact_rpc_url(value)
            else:
                out[key] = sanitize_source_payload(value)
        return out
    if isinstance(data, list):
        return [sanitize_source_payload(item) for item in data]
    return data
