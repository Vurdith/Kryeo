# Kryeo 0.8.11 Canvas Preview

- Replaced the asset preview image element with an explicit canvas renderer.
- Fits assets from their natural dimensions, preserving the full image without cropping.
- Redraws when the preview panel changes size so partial-window layouts remain correct.
- Keeps pixel artwork crisp by disabling canvas image smoothing.
