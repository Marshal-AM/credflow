# LayerZero on Robinhood Chain Testnet

## Official support (use this path)

**Robinhood Chain testnet is officially supported by LayerZero V2.** You do **not** need to self-deploy EndpointV2, SendUln302, DVN, or Executor — LayerZero Labs already deployed the full stack.

Verified via [LayerZero metadata API](https://metadata.layerzero-api.com/v1/metadata) (`robinhood-testnet`):

| Field | Value |
|---|---|
| Chain ID | `46630` |
| LayerZero EID | `40451` (not the same as chain ID) |
| EndpointV2 | `0x3aCAAf60502791D199a5a5F0B173D78229eBFe32` |
| SendUln302 | `0x45841dd1ca50265Da7614fC43A361e526c0e6160` |
| ReceiveUln302 | `0xd682ECF100f6F4284138AA925348633B0611Ae21` |
| Executor | `0x701f3927871EfcEa1235dB722f9E608aE120d243` |

Canonical config lives in [`layerzero/config.json`](../layerzero/config.json).

### CredFlow deploy steps (hub = Robinhood testnet)

```bash
# 1. Verify LayerZero contracts exist on-chain
npm run lz:status

# 2. Deploy CredFlowOApp (hub) — uses official EndpointV2
npm run deploy:oapp

# 3. (Phase 6) Deploy spoke OApps on Arbitrum Sepolia + Base Sepolia
npx hardhat run scripts/deploy-spoke.js arbitrum --network arbitrumSepolia
npx hardhat run scripts/deploy-spoke.js base --network baseSepolia

# 4. Wire peers (hub first, then each spoke)
npm run lz:set-peers
npx hardhat run scripts/set-peer-spoke.js --network arbitrumSepolia
npx hardhat run scripts/set-peer-spoke.js --network baseSepolia
```

### Spoke EIDs (for cross-chain messages)

| Chain | Chain ID | LayerZero EID | EndpointV2 |
|---|---|---|---|
| Robinhood testnet (hub) | 46630 | **40451** | `0x3aCAAf60502791D199a5a5F0B173D78229eBFe32` |
| Arbitrum Sepolia | 421614 | **40231** | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| Base Sepolia | 84532 | **40245** | `0x6EDCE65403992e310A62460808c4b910D972f10f` |

### Agent broadcast options

Use [`layerzero/buildLzOptions.js`](../layerzero/buildLzOptions.js) when calling `broadcastScore` / `broadcastDefault` — empty `options` bytes will fail on mainnet/testnet executors.

---

## Self-hosted endpoint (unsupported chains only)

The section below applies only if LayerZero has **not** deployed to your chain. **Do not run this on Robinhood testnet** — it would duplicate infrastructure and conflict with the official EID `40451`.

---

## How to Extend LayerZero to an Unsupported Chain

### Concept

LayerZero works by deploying an **Endpoint contract** on each chain. If your chain isn't officially supported, you deploy your own endpoint stack and register it with LayerZero's infrastructure.

### Step 1 — Deploy the LayerZero Endpoint Contracts

Clone and deploy the V2 endpoint suite onto your chain:

```bash
git clone https://github.com/LayerZero-Labs/LayerZero-v2
cd LayerZero-v2
npm install
```

The core contracts you must deploy, in order:

```
1. EndpointV2
2. SendUln302        (Send MessageLib)
3. ReceiveUln302     (Receive MessageLib)
4. DVN (Decentralized Verifier Network)  ← your own, or use existing
5. Executor
```

Deploy script (Hardhat/Foundry):

```bash
export RPC_URL=https://rpc.testnet.chain.robinhood.com
export PRIVATE_KEY=0x<your_key>
export CHAIN_ID=46630

forge script script/DeployEndpoint.s.sol \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### Step 2 — Assign an Endpoint ID (EID)

LayerZero uses its own **Endpoint ID (EID)** — separate from chain ID. For a custom/testnet chain you pick one that doesn't conflict:

```solidity
// Convention: testnet EIDs are in the 40000+ range
// Custom chain → pick unused eid (Robinhood official = 40451)

uint32 constant CUSTOM_EID = 40346;
```

Check existing EIDs to avoid clashes:
https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts

### Step 3 — Register with LayerZero's Endpoint Registry (or run fully isolated)

**Option A — Official Registration (recommended for production)**

Contact LayerZero Labs via their Partner form:
https://layerzero.network/partners

They will:

- Assign you an official EID
- Add your chain to their DVN/Executor network
- List it in their scan/explorer

**Option B — Self-Hosted (for testnet/dev)**

Run your own DVN and Executor off-chain workers. These watch for `PacketSent` events and relay them:

```
LayerZero Endpoint (Chain A)
        │
        │ emits PacketSent event
        ▼
  [Your DVN Worker]  ← off-chain TypeScript process
        │
        │ calls verify() on destination
        ▼
LayerZero Endpoint (Custom Chain)
        │
        ▼
  OApp receives message
```

### Step 4 — Deploy Your OApp pointing at your Endpoint

```solidity
import { OApp, Origin, MessagingFee } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";

contract MyOApp is OApp {
    constructor(address _endpoint, address _owner)
        OApp(_endpoint, _owner) {}

    function send(uint32 _dstEid, bytes calldata _message) external payable {
        _lzSend(
            _dstEid,
            _message,
            "",
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
    }

    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata _message,
        address,
        bytes calldata
    ) internal override {
        // handle incoming message
    }
}
```

CredFlow's implementation: [`contracts/CredFlowOApp.sol`](../contracts/CredFlowOApp.sol)

### Step 5 — Wire the peers

```solidity
// On hub deployment
myOApp.setPeer(REMOTE_EID, bytes32(uint256(uint160(REMOTE_OAPP_ADDRESS))));

// On remote chain deployment
remoteOApp.setPeer(HUB_EID, bytes32(uint256(uint160(HUB_OAPP_ADDRESS))));
```

Automated via `scripts/set-peers.js` and `scripts/set-peer-spoke.js`.

---

## Summary Flow

```
Robinhood Chain Testnet (OFFICIAL LayerZero — eid 40451)
├── EndpointV2          0x3aCAAf60502791D199a5a5F0B173D78229eBFe32  (pre-deployed)
├── SendUln302 + ReceiveUln302 + Executor + DVNs  (pre-deployed)
└── CredFlowOApp        deploy via npm run deploy:oapp
         │
         │  cross-chain message (eid 40231 / 40245)
         ▼
Arbitrum Sepolia / Base Sepolia
├── Official LayerZero EndpointV2
└── CredFlowOApp spoke  deploy via deploy-spoke.js
```
