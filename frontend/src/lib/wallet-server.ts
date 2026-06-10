import { privateKeyToAccount } from "viem/accounts";

export function getFrontendAccount() {
  const pk = process.env.FRONTEND_PRIVATE_KEY;
  if (!pk) {
    throw new Error("FRONTEND_PRIVATE_KEY is not set in frontend/.env.local");
  }
  const key = pk.startsWith("0x") ? pk : `0x${pk}`;
  return privateKeyToAccount(key as `0x${string}`);
}

export function getFrontendAddress(): `0x${string}` {
  return getFrontendAccount().address;
}
