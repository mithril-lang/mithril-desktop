# Build storage

Desktop packages exclude earlier build outputs even when a QA build overrides the output directory. This prevents recursively embedding old applications and installers in the new application archive.

## Package boundary

File exclusions cover root `dist`, `release`, and `artifacts`, retaining compiled `out` and runtime resources. Packaging preflight requires these exclusions; afterPack validates the bounded ASAR index before signing.

## Regression checks

The ASAR gate rejects nested output roots, missing compiled entrypoints and truncated indexes. Tests use small synthetic indexes; the measured failing QA archive is inspected read-only and never repacked while in use.

## Retained local builds

Active QA applications, qualification evidence, backups and rollback assets are preserved. Exact inactive duplicates may share APFS copy-on-write extents after SHA256 and metadata verification, retaining every logical file.
