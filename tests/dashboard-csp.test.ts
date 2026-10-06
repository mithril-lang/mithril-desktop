import { applyResponseHeaders } from "../src/main/app/response-headers";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
// Exercise the production response policy used by the startup module.
const mainSrc = applyResponseHeaders(
  "file:///Applications/Mithril.app/index.html",
)["Content-Security-Policy"][0];
const rendererIndexHtml = readFileSync(
  join(ROOT, "src/renderer/index.html"),
  "utf-8",
);

const loopbackConnectSources = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
];

const packagedAssetSources = [
  "img-src 'self' data: blob: file: https:",
  "media-src 'self' data: blob: file: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
];

describe("dashboard Content Security Policy", () => {
  it("allows loopback HTTP and WebSocket connections in the production CSP header", () => {
    for (const source of loopbackConnectSources) {
      expect(mainSrc).toContain(source);
    }
  });

  it("keeps the renderer meta CSP aligned with the production loopback sources", () => {
    for (const source of loopbackConnectSources) {
      expect(rendererIndexHtml).toContain(source);
    }
  });

  it("confines insecure WebSockets to explicit loopback sources", () => {
    expect(mainSrc).not.toMatch(/connect-src[^;]*(?:^|\s)ws:(?:\s|;)/);
    expect(rendererIndexHtml).not.toMatch(
      /connect-src[^;]*(?:^|\s)ws:(?:\s|;)/,
    );
    expect(mainSrc).toMatch(/connect-src[^;]*(?:^|\s)wss:(?:\s|;)/);
    expect(rendererIndexHtml).toMatch(/connect-src[^;]*(?:^|\s)wss:(?:\s|;)/);
  });

  it("keeps packaged file-backed startup assets allowed in both CSP policies", () => {
    for (const source of packagedAssetSources) {
      expect(mainSrc).toContain(source);
      expect(rendererIndexHtml).toContain(source);
    }
  });
});
