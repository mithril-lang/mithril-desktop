#!/bin/bash
set -eu
# Install outside the checkout and runner application directory.
# This runner accepts only reviewed main workflows, never PR or branch jobs.
case "${GITHUB_REPOSITORY:-}|${GITHUB_EVENT_NAME:-}|${GITHUB_REF:-}|${GITHUB_WORKFLOW_REF:-}" in
  'mithril-lang/mithril-desktop|workflow_dispatch|refs/heads/main|mithril-lang/mithril-desktop/.github/workflows/self-hosted-mac-smoke.yml@refs/heads/main'|\
  'mithril-lang/mithril-desktop|workflow_dispatch|refs/heads/main|mithril-lang/mithril-desktop/.github/workflows/preview-platforms.yml@refs/heads/main')
    echo 'Trusted main workflow admitted.' ;;
  *) echo 'This runner only accepts designated manual main workflows.' >&2; exit 1 ;;
esac
