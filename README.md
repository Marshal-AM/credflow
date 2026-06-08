# CredFlow

Undercollateralized lending powered by cross-chain credit scores on Robinhood Chain.

## Prerequisites

- Node.js 18+
- Python 3.10+ (for Phase 2+ agents/ML)
- A funded Robinhood Chain testnet wallet ([faucet](https://docs.robinhood.com/chain/))

## Robinhood testnet tokens

| Token | Address |
|---|---|
| USDG (borrow asset) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |
| WETH (collateral) | `0x7943e237c7F95DA44E0301572D358911207852Fa` |

Native ETH pays gas. Wrap ETH → WETH via `WETH.deposit{value}()` before posting collateral.

## Setup

```bash
cp .env.example .env
# Fill DEPLOYER_PRIVATE_KEY, AGENT_PRIVATE_KEY, AGENT_WALLET_ADDRESS, CHAINLINK_ETH_USD_FEED

npm install
npx hardhat compile
npx hardhat test
```

## Deploy to Robinhood testnet

```bash
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

Set `LENDING_FUND_USDG=50` (or less than your USDG balance) in `.env`.

The deploy script:

1. Deploys CredScoreSBT, CredFlowLP, CredFlowLending, ChainlinkOracle (OApp if `LAYERZERO_ENDPOINT_ROBINHOOD` is set)
2. Wires pool ↔ lending and grants roles to your `AGENT_WALLET_ADDRESS`
3. Transfers USDG from your deployer wallet to fund the lending contract
4. Writes `docs/addresses.json` and exports ABIs to `docs/abis/`

### Live testnet deployment (Robinhood Chain)

| Contract | Address |
|---|---|
| CredScoreSBT | `0x3EA6D1c84481f89aac255a7ABC375fe761653cdA` |
| CredFlowLending | `0x14d42947929F1ECf882aA6a07dd4279ADb49345d` |
| CredFlowLP | `0x1E491de1a08843079AAb4cFA516C717597344e50` |
| ChainlinkOracle | `0x26D215752f68bc2254186F9f6FF068b8C4BdFd37` |

After deploy, set `CHAINLINK_ETH_USD_FEED` and call `oracle.setPriceFeed(WETH_ROBINHOOD, feed, 18)` so live borrows can price WETH collateral.

## Tests

Tests fork Robinhood testnet and use **your deployer wallet** (`DEPLOYER_PRIVATE_KEY` in `.env`) for real USDG transfers:

```bash
npx hardhat test
```

## Python environment (Phase 2+)

```bash
python -m venv credflow-env
# Windows: credflow-env\Scripts\activate
# Unix: source credflow-env/bin/activate
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install torch-geometric
```

## ML pipeline (Phase 2)

```bash
# Train XGBoost + Sybil models (uses credflow-env on Windows)
npm run ml:train

# Run scoring API on http://localhost:8000
npm run ml:serve

# Python tests
npm run ml:test
```

Set `DUNE_API_KEY` and `ALCHEMY_API_KEY` in `.env` for live data. Use `USE_MOCK_DATA=1` for offline dev/tests.

## Project structure

```
contracts/   Solidity smart contracts
scripts/     Deployment scripts
tests/       Hardhat tests
agents/      Python agents (Phase 3)
ml/          ML pipeline (Phase 2)
frontend/    Next.js app (Phase 5)
docs/        Specs, ABIs, deployed addresses
```
