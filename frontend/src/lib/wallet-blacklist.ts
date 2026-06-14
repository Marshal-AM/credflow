/** Hub borrow block: explicit SBT blacklist OR prior default on profile. */
export function isHubWalletBlacklisted(
  defaultCount: number | bigint,
  explicitBlacklisted: boolean
): boolean {
  return explicitBlacklisted || Number(defaultCount) > 0;
}

/** Spoke borrow block: LZ default mirror on OApp. */
export function isSpokeWalletBlacklisted(explicitBlacklisted: boolean): boolean {
  return explicitBlacklisted;
}
