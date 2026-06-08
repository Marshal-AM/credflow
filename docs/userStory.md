CREDFLOW User story with sponsor integrations

Meet Maya
Maya is a 28-year-old freelance designer in Lagos. She has been using crypto for 2 years. She has a MetaMask wallet, some ETH, a history of using Uniswap and Aave, and an active GMX trading account on Arbitrum where she’s been managing positions for 8 months without a single liquidation. She needs $3,000 USDC to buy design equipment. She has $2,000 worth of ETH — not enough to borrow $3,000 in any standard DeFi protocol. CredFlow is her shot.

Step 1 — Maya opens CredFlow
She goes to the CredFlow frontend, connects her wallet. The app is deployed on Robinhood Chain.
Behind the scenes:
The frontend immediately calls the CredScore SBT contract on Robinhood Chain via an Alchemy RPC call. It checks whether Maya’s wallet address already has a minted SBT. This is her first time — no SBT exists. The UI shows her a “Build Your Score” prompt instead of a borrow limit.

Step 2 — Maya bootstraps her credit identity
She has no on-chain score yet. CredFlow doesn’t ask her to choose anything — it automatically begins building her score the moment her wallet connects, running two processes in parallel without waiting for one to finish before starting the other.

Process 1 — GMX history (automatic, no click required)
The Underwriter Agent silently fires its GMX submodule in the background the instant Maya’s wallet address is known. She sees a loading indicator on the dashboard: “Reading your GMX history…”
Behind the scenes, the agent queries Maya’s full GMX trading history via Alchemy’s Arbitrum node — all her historical positions, entry/exit points, leverage ratios used, how long positions were held, and critically, zero liquidation events across 8 months of active trading. Maya never clicked anything for this. It just happens.
The GMX submodule processes the data and outputs: disciplined trader, moderate leverage, consistent behavior. GMX sub-score: 71/100.

Process 2 — Fhenix FHE off-chain attestation (one user action)
Simultaneously, the frontend surfaces a single prompt: “Verify your financial standing to complete your score — takes 60 seconds.” Maya clicks “Verify” and a Fhenix-powered browser flow opens.
She connects her Binance account through a TLS session. The Fhenix FHE module on the client side encrypts her account balance and repayment history before it ever leaves her device. The encrypted data is scored homomorphically — the protocol learns “balance exceeds $4,000 threshold: true” and “repayment history: clean” without ever seeing the actual numbers. A proof is returned and posted to the Robinhood Chain contract.
Fhenix sub-score: 68/100.

Both signals land, genesis SBT mints
The XGBoost model receives both inputs simultaneously. Feature weights for the genesis score: GMX history 35%, Fhenix attestation 40%, general wallet signals from Alchemy and Dune 25% (wallet age, token holdings, prior DeFi interactions — all pulled automatically).
Combined output: CredScore 624. The SBT is minted to Maya’s wallet on Robinhood Chain.
One edge case handled by design: if Maya had no CEX account for the Fhenix flow, her strong GMX history would compensate — the model doesn’t penalise a missing signal, it just weights the present ones higher. Neither signal can be skipped, but neither alone is a dealbreaker.​​​​​​​​​​​​​​​​

Step 3 — Maya requests a loan
She inputs: borrow $3,000 USDC, collateral $1,800 ETH, 30-day term.
In a standard protocol she’d be flatly rejected — 60% collateral ratio is way below the 150% minimum. CredFlow’s dynamic LTV table maps her score of 612 to a maximum 65% LTV. She’s requesting exactly 60%. She qualifies.
She hits “Request Loan.”
Behind the scenes — the Underwriter Agent runs its full sequence:
First it calls Dune’s API with Maya’s wallet address. Dune returns pre-aggregated historical feature vectors: wallet age 2.1 years, 0 prior liquidations, 4 DeFi protocols used, asset holding duration average 47 days, stablecoin allocation 22%, no prior defaults anywhere. Query takes ~1.8 seconds.
Simultaneously, Alchemy Webhooks pull her current wallet state: ETH balance, active positions, last 30 transactions.
The agent feeds both into the XGBoost model. Model confirms 612 score. SHAP breakdown: GMX history (+43 points), wallet age (+28 points), no liquidation history (+61 points), low protocol diversity (-18 points), short wallet age penalty (-12 points). Every factor logged.
The R-GCN Sybil detector runs in parallel. It maps Maya’s wallet against the transaction graph — who has she interacted with, are any connected wallets flagged as defaulters, does her activity pattern look like a freshly created farming wallet? Graph analysis returns: no suspicious clustering, organic behavior pattern, Sybil risk: low.
The agent checks the Fhenix attestation proof on-chain — valid, unexpired, passes.
Final underwriting decision: Approved. LTV 60%. Rate: base + 3.2% risk premium. 30-day term.
The agent writes the decision and SHAP explanation vector to Robinhood Chain. Total underwriting time: 6 seconds.

Step 4 — Loan executes
Maya confirms the transaction in MetaMask. The CredFlow lending contract on Robinhood Chain:
	•	Locks her $1,800 ETH as collateral
	•	Transfers $3,000 USDC to her wallet
	•	Records loan terms, start timestamp, liquidation threshold on-chain
	•	Updates her SBT status to “loan active”
	•	Emits a LoanIssued event
OpenZeppelin Defender picks up the LoanIssued event and triggers the Cross-Chain Sync Agent job.
Behind the scenes — LayerZero broadcast:
The Cross-Chain Sync Agent constructs a LayerZero OApp message containing Maya’s updated score state and “loan active” flag. It sends this to three spoke chains simultaneously: Arbitrum, Ethereum mainnet, and Base. The LayerZero DVN (Decentralized Verifier Network) validates and relays the message. Within ~45 seconds, every spoke chain’s CredFlow score registry knows Maya has an active loan. If she tried to open another loan on Arbitrum right now, the system would see it and flag it.

Step 5 — The loan period (days 1–28)
Maya buys her equipment. Life is normal. But under the hood, the Portfolio Monitor Agent is watching her every block.
Behind the scenes:
Alchemy Webhooks are subscribed to Maya’s wallet address. Any transaction she makes triggers a webhook to the Portfolio Monitor Agent. The agent checks:
	•	Is she moving collateral? No.
	•	Is she selling large portions of her non-collateral assets? No.
	•	Has ETH price dropped significantly? On day 14, ETH drops 18%.
At 18% drop, Maya’s $1,800 ETH collateral is now worth $1,476. Her LTV has risen from 60% to 73%. Her liquidation threshold is 80%. The agent calculates she has a buffer but it’s thinning. It emits an on-chain HealthWarning event and sends Maya a frontend notification: “Your position health has decreased. Current LTV: 73%. Liquidation at 80%. Consider adding collateral or repaying early.”
No liquidation yet. Just a warning. Maya sees it, decides to wait — ETH recovers to $1,680 by day 20.

Step 6 — Repayment
Day 30. Maya repays $3,000 USDC plus interest (~$26 for the period). She confirms in MetaMask.
Behind the scenes:
The lending contract marks the loan repaid. It emits a LoanRepaid event. OZ Defender picks it up and triggers two jobs:
The Underwriter Agent re-scores Maya. New inputs: 1 successful loan repayment, on-time, no health warnings triggered into liquidation. XGBoost re-runs. New CredScore: 651. +39 points for clean repayment. SHAP shows the repayment history factor now contributing positively.
The SBT contract burns the “loan active” flag and writes the new score 651 to her SBT on Robinhood Chain.
LayerZero fires again — new score 651 propagated to all spoke chains. Maya’s reputation is now better everywhere, not just on Robinhood Chain.
Her next loan will qualify for a slightly better rate. The system has memory now.

Alternate Ending — Maya Defaults
Let’s say Maya never repaid. Day 31, she’s unreachable.
Behind the scenes — Liquidation Agent activates:
It first attempts soft recovery: emits an on-chain CovenantBreach event, gives a 48-hour grace period. No response.
The agent executes partial liquidation: sells enough of Maya’s $1,800 ETH collateral to recover the $3,000 USDC plus a 5% liquidation penalty. The remaining ETH (if any) is returned to Maya’s wallet.
It then records a Default event on Robinhood Chain. This is the critical moment.
OZ Defender triggers the LayerZero default broadcast immediately — not waiting for the next epoch. An urgent OApp message fires to every spoke chain. Maya’s SBT score is written to 310 (near floor). Every CredFlow-integrated protocol on Arbitrum, Ethereum, and Base receives the update within 2 minutes.
If Maya opens a new wallet and tries to borrow — the R-GCN Sybil detector on the next loan request will analyze the transaction graph, detect that the new wallet received funds from her known defaulted address, and flag it. She can’t simply escape by creating a fresh wallet.
Her reputation follows her across chains, across wallets she’s linked to, and across time.

That’s the full story. One real person, one real scenario, every component doing its actual job.​​​​​​​​​​​​​​​​
