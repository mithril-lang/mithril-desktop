# Windows code signing (Authenticode)

Status: the preview installers were **unsigned**, so Windows SmartScreen shows "Unknown publisher". The release workflow now supports two signing routes, chosen by one repository variable. Until that variable is set, builds stay unsigned and the workflow prints a warning. Nothing here changes macOS signing.

## Which route

The signing entity is **Kotoba Labs Inc, a US corporation**. Public Trust is available to US organizations, and the Azure region list includes US regions (for example East US, West US 2), so geography is not a blocker.

| Route | `WIN_SIGNING` | Cost (published, check at purchase) | Fit for Kotoba Labs Inc |
| --- | --- | --- | --- |
| Azure Artifact Signing (formerly Trusted Signing) | `azure` | Basic about US$9.99/mo (5,000 signatures) | **First choice, if the company passes organization validation.** Microsoft's onboarding table says it can onboard only legal business entities with a **verifiable tax history of three or more years**, checked against public records, and documents no exception path. The current quickstart no longer repeats that sentence, but Microsoft Q&A answers (2026) still say a US LLC formed in 2025 or January 2026 was declined. So the deciding fact is when Kotoba Labs Inc was incorporated and whether it has filed taxes for 3+ years. A D-U-N-S record with the exact legal name and address helps verification but is not a documented requirement. |
| SSL.com OV certificate + eSigner cloud HSM | `esigner` | OV about US$129/yr, eSigner from US$15/mo (240 signatures, one credential) | Works for any US corporation of any age. Validation uses state registry data, a third-party database check and a callback to the company phone. This is the fallback if Azure validation fails. |

Azure needs: a paid (not trial) subscription, the `Microsoft.CodeSigning` resource provider, the legal name, website, a monitored email on the company domain, the business identifier (EIN or D-U-N-S), the exact address from the state filing (Microsoft Q&A cases failed on suite-line mismatches), and a named representative who completes government-ID verification (AU10TIX plus Microsoft Authenticator). Documents must be under 12 months old (articles of incorporation are the primary document; a certificate of good standing and a bank statement are supporting). Microsoft quotes 1-20 business days, three document attempts, and a failed request cannot be retried in place. Only the Azure portal can do identity validation, and a failure cannot be seen in detail: open an Azure support request with the validation, subscription and tenant IDs.

Other CI-capable fallbacks: DigiCert OV + KeyLocker (about US$696-840/yr list for OV plus roughly US$300 for KeyLocker, 1,000 signatures per certificate-year), GlobalSign or Sectigo OV with a cloud HSM or Azure Key Vault Premium (quote needed). Since June 2023 every OV/EV private key must live on an HSM or token, so a plain `.pfx` in a GitHub secret is not an option. EV (about US$349/yr at SSL.com) no longer bypasses SmartScreen (2024), so it is not worth the premium. Signing does not remove SmartScreen warnings at first; reputation builds over releases signed by the same publisher. Microsoft's own pages disagree on whether Artifact Signing gives instant SmartScreen trust; plan for warnings on the first releases either way.

## Secrets and variables

Never paste these into chat or commit them. Set them under GitHub, repository Settings, Secrets and variables, Actions.

### Route `azure`
Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (an app registration granted the **Artifact Signing Certificate Profile Signer** role on the account).
Variables: `WIN_SIGNING=azure`, `AZURE_SIGN_ENDPOINT` (for example `https://jpe.codesigning.azure.net` if the account is in Japan East), `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` (exactly the certificate's CN, the legal entity name).
Setup, in order (steps 1-3 need a human with the company's Azure login and ID):
1. Azure portal: paid subscription (free/trial is refused), register resource provider `Microsoft.CodeSigning`.
2. Create an Artifact Signing account (Basic), region as listed in the quickstart.
3. Account, Identity validations, New identity, Organization, Public. See the requirements above. Only the portal can do this step.
4. Create a Public Trust certificate profile from the completed validation.
5. Create the app registration and role assignment, then copy the endpoint, account and profile names into the variables above.

### Route `esigner`
Secrets: `ES_USERNAME`, `ES_PASSWORD`, `ES_CREDENTIAL_ID`, `ES_TOTP_SECRET`.
Variables: `WIN_SIGNING=esigner`, `WIN_PUBLISHER_NAME` (the certificate subject CN/O exactly, used by electron-updater to verify updates).
Setup, in order:
1. Order an OV Code Signing certificate at SSL.com for Kotoba Labs Inc; complete organization validation and the callback.
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
