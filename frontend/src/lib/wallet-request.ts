import { type NextRequest } from "next/server";
import { isAddress } from "viem";

export function getRequestWallet(req: NextRequest | Request): `0x${string}` | null {
  const header = req.headers.get("x-wallet-address");
  if (header && isAddress(header)) {
    return header as `0x${string}`;
  }

  const url = new URL(req.url);
  const queryWallet = url.searchParams.get("wallet");
  if (queryWallet && isAddress(queryWallet)) {
    return queryWallet as `0x${string}`;
  }

  return null;
}

export function requireRequestWallet(req: NextRequest | Request): `0x${string}` {
  const wallet = getRequestWallet(req);
  if (!wallet) {
    throw new Error("Connect your wallet to continue");
  }
  return wallet;
}
