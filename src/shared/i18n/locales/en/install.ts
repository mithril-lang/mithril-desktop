export default {
  preparing: "Preparing...",
  startingInstall: "Starting installation",
  installationComplete: "Installation Complete",
  installationFailed: "Installation Failed",
  installingHermes: "Installing Mithril Agent",
  installationFailedHint:
    "Installation failed. Please try again or install via terminal.",
  retryInstallation: "Retry Installation",
  copied: "Copied!",
  copyLogs: "Copy Logs",
  stepLabel: "Step {{step}}/{{total}}: {{title}}",
  waitingToStart: "Waiting to start...",
  continueToSetup: "Continue to Setup",
  confirmTitle: "Before installing",
  confirmLocationLabel: "Mithril Agent will be installed at:",
  confirmFresh:
    "No existing installation was found here — a fresh copy will be set up.",
  confirmUpdate:
    "An existing Mithril Agent installation is here — it will be updated to the latest version.",
  confirmReplace:
    "A folder exists here but isn't a valid Mithril Agent installation — installing will delete and replace it.",
  confirmNotInherited:
    "If you installed Mithril Agent somewhere else, or via the command line, it won't be carried over.",
  cancelInstallation: "Cancel installation",
  confirmInstallBtn: "Install Mithril Agent",
  useExistingBtn: "Use an existing installation",
  useExistingHint:
    "Select the folder that holds your existing Mithril Agent installation (the one containing the hermes-agent folder).",
  useExistingInvalid:
    "No usable Mithril Agent installation was found in that folder.",
  useExistingDone:
    "Existing installation set — quit and reopen Mithril to apply it.",
  useExistingQuitBtn: "Quit Mithril",
} as const;
