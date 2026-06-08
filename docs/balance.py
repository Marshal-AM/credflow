from web3 import Web3

RPC_URL = "https://rpc.testnet.chain.robinhood.com"
ADDRESS  = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"

w3 = Web3(Web3.HTTPProvider(RPC_URL))

if not w3.is_connected():
    print("❌ Failed to connect to Robinhood Chain Testnet")
    exit(1)

print(f"✅ Connected to Robinhood Chain Testnet")
print(f"   Chain ID : {w3.eth.chain_id}")

checksum_addr = Web3.to_checksum_address(ADDRESS)
balance_wei   = w3.eth.get_balance(checksum_addr)
balance_eth   = w3.from_wei(balance_wei, "ether")

print(f"\n📬 Address  : {checksum_addr}")
print(f"💰 Balance  : {balance_eth} ETH")
print(f"   (raw wei): {balance_wei}")