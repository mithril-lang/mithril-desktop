# Windows code signing (Authenticode)

Status: the preview installers were **unsigned**, so Windows SmartScreen shows "Unknown publisher". The release workflow now supports two signing routes, chosen by one repository variable. Until that variable is set, builds stay unsigned and the workflow prints a warning. Nothing here changes macOS signing.

## Which route

| Route | `WIN_SIGNING` | Cost (published, check at purchase) | Fit for a Japanese corporation |
| --- | --- | --- | --- |
| Azure Artifact Signing (formerly Trusted Signing) | `azure` | Basic about US$9.99/mo (5,000 signatures) | **Unclear.** The Artifact Signing quickstart (ms.date 2026-05-21) lists Japan for organizations and lists a Japan East endpoint. Microsoft's "Code signing options for Windows app developers" page (updated 2026-08-29) still says USA, Canada, EU, UK only, and Microsoft Q&A reports Japan missing from the portal's country list. Individuals: US and Canada only. Test it in the portal before relying on it. |
| SSL.com OV certificate + eSigner cloud HSM | `esigner` | OV about US$129/yr, eSigner from US$15/mo (240 signatures, one credential) | Yes. Organization validation uses company registry data, a third-party database check and a callback to the company phone. |

Other CI-capable options if SSL.com is rejected: DigiCert OV + KeyLocker (reseller in Japan, roughly JPY 89,000-98,000/yr with 1,000 signatures per certificate-year), GlobalSign or Sectigo OV with a cloud HSM or Azure Key Vault Premium (quote needed). Since June 2023 every OV/EV private key must live on an HSM or token, so a plain `.pfx` in a GitHub secret is not an option. EV no longer bypasses SmartScreen (2024), so it is not worth the premium here. Signing does not remove SmartScreen warnings at first; reputation builds over releases signed by the same publisher.

## Secrets and variables

Never paste these into chat or commit them. Set them under GitHub, repository Settings, Secrets and variables, Actions.

### Route `azure`
Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (an app registration granted the **Artifact Signing Certificate Profile Signer** role on the account).
Variables: `WIN_SIGNING=azure`, `AZURE_SIGN_ENDPOINT` (for example `https://jpe.codesigning.azure.net` if the account is in Japan East), `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` (exactly the certificate's CN, the legal entity name).
Setup, in order:
1. Azure portal: paid subscription (free/trial is refused), register resource provider `Microsoft.CodeSigning`.
2. Create an Artifact Signing account (Basic), region as listed in the quickstart.
3. Account, Identity validations, New identity, Organization, Public. Needs the legal name, website, a monitored email on the company domain, business identifier, address, and a representative who completes ID verification (government ID, AU10TIX + Microsoft Authenticator). Microsoft says 1-20 business days. Documents must be under 12 months old. Only the portal can do this step.
4. Create a Public Trust certificate profile from the completed validation.
5. Create the app registration and role assignment, then copy the endpoint, account and profile names into the variables above.

### Route `esigner`
Secrets: `ES_USERNAME`, `ES_PASSWORD`, `ES_CREDENTIAL_ID`, `ES_TOTP_SECRET`.
Variables: `WIN_SIGNING=esigner`, `WIN_PUBLISHER_NAME` (the certificate subject CN/O exactly, used by electron-updater to verify updates).
Setup, in order:
1. Order an OV Code Signing certificate at SSL.com for the company; complete organization validation and the callback.
2. Enroll the certificate in eSigner and subscribe to an eSigner tier. Enroll two-factor authentication and copy the **TOTP secret** shown next to the QR code (not the 6-digit code).
3. Get the credential id with `CodeSignTool get_credential_ids`.
4. Use a dedicated eSigner password without `% & ^ | < > "` characters, because `CodeSignTool.bat` runs through cmd.exe.
Signature budget: one release signs about 6 files (app exe, helper exe, uninstaller, installer, portable). Tier 1 (240 a month) is enough.

## What the workflow does
> **Pending:** the workflow edit is not in this PR because the automation token lacks GitHub's `workflow` scope. It is a ready patch (`git apply windows-signing-workflow.patch`, attached to the PR description) that needs one push from someone with that scope. Until then the workflow still builds unsigned.

`.github/workflows/preview-platforms.yml`, job `windows`:
1. Resolves `WIN_SIGNING` (unset means unsigned plus a warning; unknown values fail).
2. `azure`: passes `win.azureSignOptions` to electron-builder on the command line.
   `esigner`: downloads CodeSignTool and runs `scripts/win-sign-esigner.cjs` as `win.sign`.
3. `Verify Windows signatures`: `Get-AuthenticodeSignature` must report `Valid` with a timestamp countersignature on the setup exe, the portable exe and `mithril.exe`, otherwise the job fails and nothing is published.

## Verifying a downloaded release on Linux
```
osslsigncode verify -in mithril-desktop-<version>-setup.exe
```
Expect "Signature verification: ok", the company name in the subject, and a timestamp. `SHA256SUMS` and `preview.yml` must be regenerated after signing, which the workflow does because it builds and signs before computing them.

## Not covered
Signing the stable `release.yml` path is not changed; it is disabled in the source preview and must be migrated first.
