"""XGBoost training and inference with SHAP explanations."""

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from ml.constants import EXPLAINER_PATH, FEATURE_COLUMNS, MODEL_PATH


def train_credflow_model(
    training_data_path: str,
    model_path: str = MODEL_PATH,
    explainer_path: str = EXPLAINER_PATH,
) -> tuple:
    """Train XGBoost classifier on labeled feature CSV."""
    df = pd.read_csv(training_data_path)

    X = df[FEATURE_COLUMNS]
    y = df["defaulted"]

    pos = (y == 1).sum()
    neg = (y == 0).sum()
    scale_pos_weight = neg / pos if pos > 0 else 1.0

    stratify = y if pos >= 2 and neg >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify
    )

    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        eval_metric="auc",
        early_stopping_rounds=50,
    )

    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    y_pred_proba = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, y_pred_proba)
    print(f"Test AUC-ROC: {auc:.4f}")

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)

    explainer = shap.TreeExplainer(model)
    joblib.dump(explainer, explainer_path)

    return model, explainer, auc


def score_wallet(
    feature_vector: dict,
    model_path: str = MODEL_PATH,
    explainer_path: str = EXPLAINER_PATH,
) -> dict:
    """Convert default probability to CredScore (300-850) with SHAP breakdown."""
    model = joblib.load(model_path)
    explainer = joblib.load(explainer_path)

    X = pd.DataFrame([feature_vector])[FEATURE_COLUMNS]

    default_prob = float(model.predict_proba(X)[0][1])
    cred_score = int(300 + (1 - default_prob) * 550)
    cred_score = max(300, min(850, cred_score))

    shap_values = explainer.shap_values(X)
    if isinstance(shap_values, list):
        shap_row = shap_values[1][0]
    else:
        shap_row = shap_values[0]

    shap_dict = {feat: float(shap_row[i]) for i, feat in enumerate(FEATURE_COLUMNS)}

    return {
        "cred_score": cred_score,
        "default_probability": round(default_prob, 4),
        "shap_values": shap_dict,
    }
