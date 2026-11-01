/** The HTTPS page origin becomes WSS in production; explicit build-time endpoints still work. */
export function socketEndpoint(path: string): URL {
  const base =
    import.meta.env.VITE_API_URL ??
    (import.meta.env.PROD ? location.origin : 'http://localhost:3000');
  const url = new URL(base, location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}
