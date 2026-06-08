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
    assert data["feature_count"] == 27


def test_score_endpoint(monkeypatch):
    monkeypatch.setenv("USE_MOCK_DATA", "1")
    response = client.post(
        "/score",
        json={"wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"},
    )
    assert response.status_code == 200
    data = response.json()
    assert 300 <= data["cred_score"] <= 850
    assert data["sybil_risk"] in ("low", "medium", "high")
    assert "shap_cid" in data
    assert data["shap_cid"].startswith("ipfs://")
    assert data["borrow_sub_score"] >= 70
    assert data["wallet_sub_score"] > 0
    assert "gmx_sub_score" not in data
    assert "index_mainnet" not in data
    assert "source_data" in data
    assert "sources" in data["source_data"]
    assert "borrow_history_merged" in data["source_data"]["sources"]
    assert "model_breakdown" in data
    assert data["model_breakdown"]["formula"]["computed"]["cred_score"] == data["cred_score"]
    assert len(data["model_breakdown"]["feature_vector"]) == 27
    assert "aave_borrow_count" in data["features_used"]
    assert "wallet_age_flag" in data["features_used"]
    assert "burst_activity_flag" in data["features_used"]
    assert "borrow_then_transfer_out_flag" in data["features_used"]
    assert "red_flags" in data["model_breakdown"]["feature_groups"]
