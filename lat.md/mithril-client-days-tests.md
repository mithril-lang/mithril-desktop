---
lat:
  require-code-mention: true
---
# Mithril usage day tests

Usage statistics require independent consent and keep credentials in the main process. These tests validate the reporting boundary without claiming a real installed device or two production usage days.

## Main explicit consent

False or non-boolean consent must access neither the encrypted token store nor the network.

## Main fixed endpoint

The main process reads only the selected profile token and sends client type plus consent to the fixed HTTPS endpoint, refusing redirects and keeping the token out of the response.

## Nonblocking failures

A reporting network failure returns false without exposing credentials or interrupting client startup.

## Renderer consent and UTC days

Consent starts disabled. Foreground reporting occurs once per successful UTC day, repeats on a later day, and stops after revocation or cleanup.
