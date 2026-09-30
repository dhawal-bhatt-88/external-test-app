// The site is served under Vite's base (/external-test-app/), both locally and
// on GitHub Pages, so every API URL is built from it.
export const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path}`;

// GitHub Pages build: the API is mocked in the browser (src/demo) instead of
// served by server/index.mjs.
export const isDemo = import.meta.env.VITE_DEMO === 'true';
