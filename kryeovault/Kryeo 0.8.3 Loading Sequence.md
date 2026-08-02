# Kryeo 0.8.3 Loading Sequence

## Purpose

The startup experience is now a visual explanation of Kryeo rather than a generic progress bar. It presents a creative source, the Kryeo core, the asset library, and a production target as one connected pipeline.

## Sequence

1. Kryeo reads the asset library and project indexes.
2. It checks for creative and production applications.
3. It starts the connector layer used by Affinity workflows.
4. It marks the workspace and pipeline as ready.

Coloured data packets move through the inbound and outbound routes while each operation resolves in the startup console. The final state completes all four checks before the screen transitions into the application.

## Visual system

- Full-screen grid based on Kryeo's existing workspace background.
- Acid green, amber, coral, and blue route signals.
- Animated scanning line across the Kryeo core.
- Stable source, core, and production geometry at every supported window size.
- Segmented design-to-production progress display.
- Reserved title-bar space for native Windows controls.
- Reduced-motion support for users who disable animation.

## Timing

Production startup remains visible for at least 2.4 seconds while Kryeo initializes. Development builds support `VITE_KRYEO_BOOT_MS` as a visual QA override without changing production timing.

## Verification

- TypeScript passed.
- Production renderer build passed.
- Visually checked at 1002 x 701 and 1482 x 921.
- No clipped labels, overlapping controls, cropped logos, or horizontal overflow were observed.
