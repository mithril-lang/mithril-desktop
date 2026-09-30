// electron-builder `win.sign` hook: sign one file through SSL.com eSigner
// (CodeSignTool, cloud HSM). Used only when the workflow selects
// WIN_SIGNING=esigner; see docs/windows-signing.md.
//
// Env (all GitHub secrets, never printed):
//   ES_USERNAME, ES_PASSWORD, ES_CREDENTIAL_ID, ES_TOTP_SECRET
//   CODESIGNTOOL_DIR  directory holding CodeSignTool.bat (set by the workflow)
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync } = require("node:child_process");
const { copyFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; cannot sign with eSigner`);
  return value;
}

exports.default = async function sign(configuration) {
  const input = configuration.path;
  const out = mkdtempSync(join(tmpdir(), "esigner-"));
  try {
    // CodeSignTool.bat is a batch file, so cmd.exe parses the arguments:
    // the eSigner password must not contain % & ^ | < > or ". (docs/windows-signing.md)
    execFileSync(
      join(required("CODESIGNTOOL_DIR"), "CodeSignTool.bat"),
      [
        "sign",
        `-username=${required("ES_USERNAME")}`,
        `-password=${required("ES_PASSWORD")}`,
        `-credential_id=${required("ES_CREDENTIAL_ID")}`,
        `-totp_secret=${required("ES_TOTP_SECRET")}`,
        `-input_file_path=${input}`,
        `-output_dir_path=${out}`,
      ],
      { stdio: ["ignore", "inherit", "inherit"], shell: true },
    );
    copyFileSync(join(out, basename(input)), input);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};
