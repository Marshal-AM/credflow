/** @deprecated Server-side private key wallet is removed — use client wallet via x-wallet-address header. */

export function getFrontendAccount(): never {
  throw new Error(
    "FRONTEND_PRIVATE_KEY is no longer supported. Connect a wallet in the browser."
  );
}

export function getFrontendAddress(): never {
  throw new Error(
    "FRONTEND_PRIVATE_KEY is no longer supported. Connect a wallet in the browser."
  );
}
