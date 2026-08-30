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

export const APK_DOWNLOAD_URL = 'https://m55681518-byte.github.io/vibecatch/vibecatch.apk';

export function buildStrictTrackError(): string {
  return `This high-security track requires our native Android app to extract. Download the APK here: ${APK_DOWNLOAD_URL}`;
}
