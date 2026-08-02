# Kryeo 0.8.2 UX Notes

## Status language

- Removed the generic `Ready` badge from asset details.
- Removed the connector capability-chip row and the `DETECTED` badge.
- Removed the inspector footer slogan.
- Installed applications now use a small presence mark beside the application name and a factual sentence below it, such as `Installed. Start Affinity and enable MCP to connect.`
- The Pipeline and title toolbar report `Affinity connected` or `Affinity offline` directly.

## Startup

Kryeo now opens behind a short neo-brutalist loading screen while it checks Affinity, reads the asset library, and scans installed applications. The loading treatment uses the Kryeo mark, a high-contrast panel, and a moving two-colour progress bar.

## Application scanning

`Scan applications` now has three clear stages:

1. The control changes to `Scanning` with a spinner.
2. A restrained sweep moves across the scan panel while detection runs.
3. The result remains visible as a sentence with the number of installed applications found.

The active scan remains visible for at least 700 ms so fast local checks still provide perceivable feedback. Motion is disabled when Windows requests reduced motion.

## Responsive QA

Validated at the compact 1002 x 701 window size. The Pipeline and Connectors pages remain vertically scrollable, connector details wrap correctly, and no removed chips leave empty containers behind.
