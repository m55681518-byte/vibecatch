/**
 * Android Setup — pure helpers for the Termux setup card.
 * No side effects, no fetch calls. Safe to import anywhere.
 */

/** Detect Android devices via user-agent string. Empty string → false. */
export function isAndroidDevice(ua: string): boolean {
  if (!ua) return false;
  return /android/i.test(ua);
}

/** Return the exact copy-paste one-liner that bootstraps the Termux node. */
export function buildSetupCommand(): string {
  return 'bash <(curl -sL https://vibecatch.pages.dev/termux-setup.sh)';
}

/**
 * Decide whether to show the setup card.
 * true only when the device is Android AND no local node was found.
 */
export function shouldShowSetupCard(a: { android: boolean; nodeReachable: boolean }): boolean {
  return a.android && !a.nodeReachable;
}
