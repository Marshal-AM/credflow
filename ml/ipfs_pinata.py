"""Upload SHAP explanations to IPFS via Pinata."""

import hashlib
import json
import logging
import os

import requests

logger = logging.getLogger(__name__)

PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS"


def _pseudo_cid(payload: dict) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return f"ipfs://{digest[:46]}"


def _pinata_headers() -> dict | None:
    api_key = os.environ.get("PINATA_API_KEY", "").strip()
    secret = os.environ.get("PINATA_SECRET_KEY", "").strip()
    if api_key and secret:
        return {
            "pinata_api_key": api_key,
            "pinata_secret_api_key": secret,
        }

    jwt = os.environ.get("PINATA_JWT", "").strip()
    if jwt:
        return {"Authorization": f"Bearer {jwt}"}
    return None


def upload_shap_explanation(shap_values: dict, wallet_address: str) -> str:
    """Pin SHAP JSON to Pinata when credentials are configured."""
    content = {
        "wallet": wallet_address.lower(),
        "shap_values": shap_values,
    }

    ipfs_api = os.environ.get("IPFS_API_URL", "").strip()
    if ipfs_api:
        try:
            import ipfshttpclient

            client = ipfshttpclient.connect(ipfs_api)
            cid = client.add_json(content)
            return f"ipfs://{cid}"
        except Exception as exc:
            logger.warning("Local IPFS upload failed, trying Pinata: %s", exc)

    headers = _pinata_headers()
    if not headers:
        logger.debug("Pinata credentials not set; using deterministic pseudo-CID")
        return _pseudo_cid(content)

    try:
        response = requests.post(
            PINATA_PIN_JSON_URL,
            headers={**headers, "Content-Type": "application/json"},
            json={
                "pinataContent": content,
                "pinataMetadata": {
                    "name": f"credflow-shap-{wallet_address.lower()}",
                },
            },
            timeout=30,
        )
        if response.status_code == 403:
            jwt = os.environ.get("PINATA_JWT", "").strip()
            api_key = os.environ.get("PINATA_API_KEY", "").strip()
            secret = os.environ.get("PINATA_SECRET_KEY", "").strip()
            if jwt and api_key and secret and "Authorization" in headers:
                response = requests.post(
                    PINATA_PIN_JSON_URL,
                    headers={
                        "pinata_api_key": api_key,
                        "pinata_secret_api_key": secret,
                        "Content-Type": "application/json",
                    },
                    json={
                        "pinataContent": content,
                        "pinataMetadata": {
                            "name": f"credflow-shap-{wallet_address.lower()}",
                        },
                    },
                    timeout=30,
                )
        response.raise_for_status()
        ipfs_hash = response.json()["IpfsHash"]
        return f"ipfs://{ipfs_hash}"
    except Exception as exc:
        logger.warning("Pinata upload failed, using pseudo-CID: %s", exc)
        return _pseudo_cid(content)
