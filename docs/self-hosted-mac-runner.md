# Tailscale Mac runner

GitHub Actions coordinates native Mac jobs on an existing Tailscale-connected Mac. Kubernetes and TeamCity are not required. Tailscale supplies management connectivity; the runner connects outbound to GitHub.

The repository-scoped runner uses `mithril-desktop-trusted`, `macOS`, and `ARM64` labels. Install `scripts/trusted-runner-job-start.sh` outside both the checkout and runner application directory, with mode 0700. Set `ACTIONS_RUNNER_HOOK_JOB_STARTED` in the runner's `.env` to that absolute path before starting the service. The hook admits only the designated manual workflows on main and refuses PRs, branch workflows and missing context before steps execute. Labels alone are not authorization.

The manual `Self-hosted Mac readiness` workflow verifies native macOS, Command Line Tools and exact source checkout without requesting signing credentials. A successful readiness run is not build, signing, notarization or installer publication proof. Do not route PR CI to this runner. For stricter server-side workflow restrictions, use a dedicated organization runner group when the existing operator has the required administration scope.

The preview workflow retains its full cross-platform publication gate. Mac signing must use the existing temporary signing-keychain setup and cleanup. Linux and Windows workers require their own native runners; a Mac runner does not establish Windows or Linux installer readiness. Retain hosted jobs until those native workers are explicitly migrated.

Register with a short-lived repository registration token delivered directly to the remote configuration process. Never commit runner credentials, copy the host Keychain, or store a personal GitHub token on the runner. Install as a service only after the hook's allowed and refused fixtures pass. Test real dispatch and report GitHub budget or access failures separately from runner connectivity.
