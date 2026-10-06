# Native Code integration — 2026-10-06

Code is available in the sidebar and calls `hermes mithril-code` through the native IPC adapter. Four focused tests passed: an actual child process receives stdin/fixed CLI arguments and only its selected profile's runner credential across A→B→A; unverified source and unknown error bodies are rejected; the screen requires an explicit action and shows verified source; an uncertain result remains visible without an automatic second run. These tests use synthetic service output, not live Jev inference.

Node and renderer typechecks, native/renderer production builds and `lat check` passed. The shared workspace vendor was installed from the unchanged lockfile into the isolated worktree after the primary checkout's older dependencies proved unsuitable; no primary dependencies were modified.

This work requires the owned Agent plugin, explicit profile settings and authorized runner secret. It does not publish or change Fund PR492's account-authenticated free pilot, quotas or idempotent replay. Current installed-client/live inference qualification and preview installer publication are recorded separately.
