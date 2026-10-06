const KURO_ASSET_ROOT = "https://app.mithril.fund/spa/kuro/";

export function applyResponseHeaders(
  url: string,
  headers: Record<string, string[]> = {},
): Record<string, string[]> {
  // Kuro's server CSP restricts worker network/storage authority. Never replace
  // it with the broader policy needed by the privileged local app renderer.
  if (url.startsWith(KURO_ASSET_ROOT)) return { ...headers };
  const responseHeaders: Record<string, string[]> = { ...headers };
  for (const key of Object.keys(responseHeaders)) {
    if (key.toLowerCase() === "content-security-policy")
      delete responseHeaders[key];
  }
  responseHeaders["Content-Security-Policy"] = [
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: file: https:; " +
      "media-src 'self' data: blob: file: https:; " +
      "connect-src 'self' blob: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* https: wss:; " +
      "font-src 'self' data:; " +
      "frame-src 'self' https: http://127.0.0.1:* http://localhost:*; " +
      "object-src 'none'; " +
      "base-uri 'self';",
  ];
  if (url.startsWith("https://registry.hermesone.org/registry-icon/")) {
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === "cache-control") delete responseHeaders[key];
    }
    responseHeaders["Cache-Control"] = ["public, max-age=31536000, immutable"];
  }
  return responseHeaders;
}
