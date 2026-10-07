/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const args = new Set(process.argv.slice(2));
const releaseMode = args.has("--release");

const requiredFiles = [
  "scripts/store-release/macos/fastlane/Fastfile",
  "scripts/store-release/macos/entitlements.mas.plist",
  "scripts/store-release/macos/entitlements.mas.inherit.plist",
  "scripts/store-release/windows/publish.ps1",
  "docs/desktop-store-release.md",
];

const errors = [];
for (const path of requiredFiles) {
  if (!existsSync(resolve(root, path))) errors.push(`missing ${path}`);
}

const entitlementsPath = resolve(
  root,
  "scripts/store-release/macos/entitlements.mas.plist",
);
if (existsSync(entitlementsPath)) {
  const entitlements = readFileSync(entitlementsPath, "utf8");
  for (const key of [
    "com.apple.security.app-sandbox",
    "com.apple.security.cs.allow-jit",
    "com.apple.security.network.client",
  ]) {
    if (!entitlements.includes(`<key>${key}</key>`)) {
      errors.push(`MAS entitlement missing ${key}`);
    }
  }
}

const outsideCheckoutFile = (name) => {
  const value = process.env[name];
  if (!value) {
    errors.push(`missing ${name}`);
    return;
  }
  const path = resolve(value);
  const withinCheckout =
    !relative(root, path).startsWith("..") && path !== root;
  if (!isAbsolute(value) || withinCheckout) {
    errors.push(`${name} must be an absolute path outside the checkout`);
  } else if (!existsSync(path)) {
    errors.push(`${name} does not exist`);
  }
};

if (releaseMode) {
  if (args.has("--macos")) {
    for (const name of [
      "MITHRIL_MAS_APP_IDENTIFIER",
      "MITHRIL_MAS_APPLE_ID",
      "MITHRIL_MAS_TEAM_ID",
    ]) {
      if (!process.env[name]) errors.push(`missing ${name}`);
    }
    outsideCheckoutFile("MITHRIL_MAS_API_KEY_PATH");
    outsideCheckoutFile("MITHRIL_MAS_PROVISIONING_PROFILE");
    outsideCheckoutFile("MITHRIL_MAS_PKG");
    if (process.env.MITHRIL_MAS_CLOUD_ONLY !== "1") {
      errors.push(
        "MITHRIL_MAS_CLOUD_ONLY=1 is required after the sandboxed edition passes clean-machine QA",
      );
    }
  }

  if (args.has("--windows")) {
    for (const name of [
      "MITHRIL_MS_STORE_APP_ID",
      "PARTNER_CENTER_TENANT_ID",
      "PARTNER_CENTER_SELLER_ID",
      "PARTNER_CENTER_CLIENT_ID",
      "PARTNER_CENTER_CLIENT_SECRET",
    ]) {
      if (!process.env[name]) errors.push(`missing ${name}`);
    }
    outsideCheckoutFile("MITHRIL_MSIX_PATH");
  }
}

if (errors.length) {
  console.error("Desktop store release is not ready:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  releaseMode
    ? "Desktop store release inputs are present; submission still requires the protected release environment."
    : "Desktop store release structure is valid; no credentials or submissions were exercised.",
);
