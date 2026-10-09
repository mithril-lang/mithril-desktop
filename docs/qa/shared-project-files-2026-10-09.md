# Shared project file removal and recovery

Desktop imports the exact workspace 0.6.29-schedules.65 package from Fund PR882,
merged source 8cafd0bedca2f93b70e5601bd17c34ccd0f6f69e. The vendored archive SHA256
is c9413b4976b931dc695609a7e6a0607eba07fe26c0f6a67bfb0935503662de0a.
It contains the same ProjectFiles component used by Web: revision/generation-
fenced removal, durable manifest-history recovery, preserved current paths and
stale polling suppression. No separate native file-removal UI is introduced.

Local Desktop TypeScript checks and 51 folder/history synchronization tests pass.
Fund shared-package qualification passed 85 suites / 470 tests, with a signed
standalone workspace receipt for source 62bf2efa7bead427f75bb3b8cee1f35367563264.

Preview.69 has not been published; the installed client remains preview.47.
After signed installer publication, verify Web removal → the connected Desktop
folder's recovery directory, history recovery → both clients, restart retention
and the prior signed build's actual automatic update. Source tests and this
archive are not evidence that those installed-client actions succeeded.
