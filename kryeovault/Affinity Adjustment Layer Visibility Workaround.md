# Affinity adjustment-layer visibility workaround

## Problem

Affinity can crash, fail to copy, or leave adjustment layers temporarily missing when a rendered group is duplicated or transferred while its live adjustment layers are visible.

This affected the Asset Library Master/Raster creation process. The stable fix was to prevent Affinity from rendering the risky duplicate while the hierarchy was still being copied.

## Safe ordering

1. Select the completed, centred Master hierarchy.
2. Set the source or duplicate to **invisible before duplication/copy begins**.
3. Duplicate the complete hierarchy while it is invisible.
4. Wait until the duplicate operation has fully completed.
5. Select the new duplicate explicitly.
6. Make the duplicate visible again.
7. Only after visibility has been restored, perform the next rendered operation such as rasterising.
8. Restore the intended final visibility state for Master, Base, and Raster.

The important rule is:

> Hide first, complete the structural copy, show the completed copy, then rasterise or render.

Do not make the duplicate visible during the copy. Do not rasterise before the hidden duplicate has finished being created.

## Script pattern

```javascript
const sourceSelection = Selection.create(doc, masterNode);
doc.executeCommand(DocumentCommand.createSetVisibility(sourceSelection, false));

// Duplicate the complete hidden hierarchy here.
const duplicate = duplicateMasterHierarchy(doc, masterNode);
const duplicateSelection = Selection.create(doc, duplicate);

// Keep it hidden until duplication is completely finished.
doc.executeCommand(DocumentCommand.createSetVisibility(duplicateSelection, false));

// Affinity can safely render it after the completed duplicate is selected.
doc.executeCommand(DocumentCommand.createSetVisibility(duplicateSelection, true));
doc.selection = duplicateSelection;

// Rasterise only after the visibility round trip.
rasteriseSelection(doc, duplicateSelection);
```

## Applying this to Kryeo Place

Current Master placement can fail with:

```text
Affinity did not copy the selected asset layer.
```

Master may contain visible live adjustment layers, so Place should use a visibility-staged copy:

1. Resolve the exact asset document and Master node by session ID and `[Master]` prefix.
2. Record the Master node's original visibility.
3. Set the Master selection invisible before preparing the clipboard copy.
4. Complete any required duplicate/staging operation while hidden.
5. Keep the completed staging copy invisible and select it.
6. Issue the native Affinity copy command while the staging copy remains invisible.
7. Confirm that the Windows clipboard contains the `Affinity Nodes` format.
8. Switch to the exact destination document by session ID and paste.
9. After paste has fully completed, make only the pasted destination copy visible.
10. Confirm the destination node count increased and leave the source Master hidden.

If copying a hidden node directly produces no `Affinity Nodes` clipboard format, create a hidden temporary duplicate first, finish the duplicate, then perform the visibility off/on round trip on that duplicate before copying it.

## Verification checklist

- Affinity remains open and does not crash.
- Clipboard includes `Affinity Nodes`, not only PNG/Bitmap formats.
- Master hierarchy and adjustment layers remain editable after paste.
- Destination is the original working document session.
- Destination node count increases.
- Source Master visibility is restored.
- No temporary staging node remains in the asset document.

## Related versions

- Asset Library Save v4.32-v4.40: visibility staging developed while stabilising Master duplication and Raster generation.
- Kryeo v0.5.2: native clipboard validation and session-based destination placement.
- Kryeo v0.5.3: first Place staging attempt; incorrectly revealed the staging node during native clipboard serialization.
- Kryeo v0.5.4: keeps Master/Base staging hidden through duplication, native copy, and cleanup; reveals only the fully pasted destination copy.
- Kryeo v0.5.5: Master placement no longer uses duplication or the native clipboard. It uses Affinity File > Place, exposes only the embedded `[Master]` layer, and bounds the embedded document to its minimum visible content.
- Kryeo v0.5.6: File > Place paths are transferred through UTF-8/Base64 decoding so Windows backslashes reach Affinity unchanged instead of becoming invalid doubled separators.
- Kryeo v0.5.7: restores native editable Master placement. Source and staging hierarchies remain hidden through duplication, clipboard copy, destination paste, and source cleanup. The pasted destination is revealed only as the final operation; importantly, staging cleanup now happens after paste instead of before Affinity has finished consuming its clipboard data.
- Kryeo v0.5.8: keeps both the source Master and hidden staging duplicate alive and invisible after paste. Affinity can retain lazy adjustment resources from the clipboard hierarchy, so deleting or restoring the source before rendering the destination can crash at final reveal. The destination visibility command is now the sole final operation. Close the opened asset document without saving to discard its hidden staging copy.
- Kryeo v0.5.9: cleans the hidden staging Master only after the destination has been revealed and given five seconds to render. Kryeo then clears the clipboard, waits for lazy clipboard resources to release, deletes the still-hidden staging copy, restores the real source Master's original visibility, and returns to the working document.
