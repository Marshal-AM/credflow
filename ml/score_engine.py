"""Mirror of on-chain CredScoreEngine formula for API previews."""


def balance_capacity_factor_bps(balance_usd_cents: int) -> int:
    usd_whole = balance_usd_cents // 100
    if usd_whole >= 5000:
        return 9200
    if usd_whole >= 1000:
        return 9600
    if usd_whole >= 100:
        return 9800
    return 10000


def compute_on_chain_cred_score(default_prob_bps: int, balance_usd_cents: int) -> int:
    """Match CredScoreEngine.computeCredScore in Solidity."""
    factor = balance_capacity_factor_bps(balance_usd_cents)
    adjusted = (default_prob_bps * factor) // 10000
    adjusted = min(adjusted, 10000)
    score = 300 + ((10000 - adjusted) * 550) // 10000
    return max(300, min(850, score))


def default_prob_to_bps(default_probability: float) -> int:
    return max(0, min(10000, int(round(default_probability * 10000))))
