export default {
  title: "Welcome to Mithril",
  subtitle:
    "Optional: run the Hermes agent locally on this machine. This is separate from your Mithril account.",
  installIssueTitle: "Installation Issue",
  getStarted: "Install local agent runtime",
  retryInstall: "Retry Installation",
  terminalInstallHint: "Install via terminal, then come back:",
  recheck: "I've installed it — check again",
  switchToLocal: "Switch to local mode",
  installSizeHint: "This will install required components (~2 GB)",
  copyInstallCommand: "Copy install command",
  dividerOr: "or",
  connectRemote: "Connect to Remote Hermes",
  connectRemoteTitle: "Connect to Remote Hermes",
  connectRemoteSubtitle: "Enter the URL of a running Hermes API server.",
  remoteServerUrl: "Server URL",
  remoteApiKey: "API Key (optional)",
  remoteApiKeyPlaceholder: "Bearer token (API_SERVER_KEY)",
  testingConnection: "Testing",
  connect: "Connect",
  remoteHint:
    "Authentication is detected automatically. Raw API servers use API_SERVER_KEY from ~/.hermes/.env on the remote host; dashboard servers open secure browser sign-in.",
} as const;
