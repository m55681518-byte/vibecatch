import { extractUrlFromText } from './extractor';

export interface InterceptedShare {
  url: string;
  title?: string;
  text?: string;
  autoExtract: boolean;
}

/**
 * Checks for shared URL from Android Web Share Target or standard launch params
 */
export function checkSharedUrl(): InterceptedShare | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const sharedUrl = params.get('url');
  const sharedText = params.get('text');
  const sharedTitle = params.get('title');
  const action = params.get('action');

  let targetUrl = '';

  if (sharedUrl) {
    targetUrl = extractUrlFromText(sharedUrl);
  } else if (sharedText) {
    targetUrl = extractUrlFromText(sharedText);
  }

  if (targetUrl) {
    // Clean URL without reloading page
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    return {
      url: targetUrl,
      title: sharedTitle || undefined,
      text: sharedText || undefined,
      autoExtract: true,
    };
  }

  if (action === 'extract') {
    return {
      url: '',
      autoExtract: false,
    };
  }

  return null;
}

/**
 * Setup Web Launch Queue for native PWA file/URL handling if supported
 */
export function setupLaunchHandler(onReceiveUrl: (url: string) => void) {
  if ('launchQueue' in window && 'setConsumer' in (window as any).launchQueue) {
    (window as any).launchQueue.setConsumer((launchParams: any) => {
      if (launchParams.targetURL) {
        const url = extractUrlFromText(launchParams.targetURL);
        if (url) onReceiveUrl(url);
      }
    });
  }
}
