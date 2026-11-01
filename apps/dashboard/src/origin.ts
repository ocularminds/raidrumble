/** Production uses the page origin; development retains the separate Vite/API ports. */
export const apiBase =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? location.origin : 'http://localhost:3000');

export const overlayBase =
  import.meta.env.VITE_OVERLAY_URL ??
  (import.meta.env.PROD ? location.origin : 'http://localhost:5173');
