# Shared Mithril workspace

The active dependency is mithril-workspace-0.6.16.tgz, built and packed from the canonical Fund workspace package. Desktop and Web import the same renderer bodies behind consumer-specific ports.

This package includes the original Desktop views, per-key locale fallback and an explicit reconnect hook. Automatic connection never invokes the explicit hook. Desktop retains its original account card and secure main-process credential handling; Web retains its existing browser retry behavior.

SHA-256: 742832237c9874020749c6b9d8cffe82af75dccdad9cd310382c023353c290fd.

Update by building and packing the canonical package, selecting a fresh version, replacing the file dependency and regenerating the exact lock entry. Run renderer/protocol tests, types, lint, production build and lat check. Preview.29 is pending qualification and publication; this file does not certify an installed app or full synchronization.
