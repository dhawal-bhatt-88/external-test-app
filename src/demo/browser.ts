import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Starts the in-browser API. Resolves once requests are being intercepted. */
export async function startDemoApi() {
  const base = import.meta.env.BASE_URL;
  await setupWorker(...handlers).start({
    // Served and scoped under the site's base, not the origin root: other
    // github.io projects of this account share the origin.
    serviceWorker: { url: `${base}mockServiceWorker.js`, options: { scope: base } },
    // Page assets and anything else not under /api go to the network as usual.
    onUnhandledFrame: 'bypass',
  });
}
