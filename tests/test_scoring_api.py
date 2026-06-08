"""Tests for FastAPI scoring API."""

import os

os.environ["USE_MOCK_DATA"] = "1"

from fastapi.testclient import TestClient

from ml.scoring_api import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model_loaded"] is True


def test_score_endpoint():
    response = client.post(
        "/score",
        json={
            "wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844",
            "fhenix_attestation": {
                "income_above_threshold": True,
                "balance_above_threshold": True,
                "repayment_history_clean": True,
                "account_age_years": 3,
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert 300 <= data["cred_score"] <= 850
    assert data["sybil_risk"] in ("low", "medium", "high")
    assert "shap_cid" in data
    assert data["shap_cid"].startswith("ipfs://")
    assert data["gmx_sub_score"] == 71
    assert data["fhenix_sub_score"] >= 68
    assert data["wallet_sub_score"] > 0
