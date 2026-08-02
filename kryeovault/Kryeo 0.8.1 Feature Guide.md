# Kryeo 0.8.1 Feature Guide

## Persistent operations

Every operation started through Kryeo is written to the local workspace before it begins. The Activity screen shows whether it is queued, running, complete, failed, cancelled, or interrupted, along with its current stage and progress.

If Kryeo closes during an operation, that operation is marked **Interrupted** the next time the app opens. It can then be checked and retried instead of disappearing from the history.

Cancellation is cooperative. Kryeo can cancel work that has not yet entered Affinity. Once Affinity is executing a host command, its SDK does not expose a safe force-cancel method, so Kryeo records the request and waits for the host call to return.

## Asset previews

Kryeo matches each current library asset with its exported PNG and displays that image in the Assets inspector. Transparent PNGs use a checkerboard background, and pixel assets use nearest-neighbour rendering so they remain crisp.

The preview is for inspection only. The Affinity document remains the editable source of truth.

## Library health

Each current asset is checked for three common problems:

- **Missing source:** the indexed `.afdesign` file no longer exists.
- **Missing export:** no matching PNG could be found in Exported Assets.
- **Export outdated:** the PNG is older than the Affinity source document.

The Assets summary counts items that need attention, and the selected asset explains its exact health state.

## Version history and duplicate names

The Assets inspector shows every indexed version that belongs to the selected asset. Kryeo also compares current code names and warns when the same code name is used by more than one current asset.

This is diagnostic only. Kryeo does not silently rename files or rewrite `GlobalIndex.json`.

## Favourites and collections

Favourites let users mark frequently reused assets. Collections are comma-separated local groupings such as `HUD`, `Inventory`, or `Character Menu`.

These preferences live in Kryeo's workspace data and do not alter the Affinity asset document or its library metadata.

## Workflow presets

Export, Setup, Update, and Hand Shade settings can be saved as named presets. Loading a preset restores the complete set of values for that workflow, reducing repeated configuration while leaving the final Run action explicit.

Presets are local to Kryeo and can be replaced or removed without touching Affinity scripts.

## Project export recipes

Each asset-library project can have its own recipe. A recipe stores:

- whether a successful Save should trigger Export automatically;
- the Affinity export preset name;
- the preferred Master, Base, or Raster source;
- whether to keep the normal export-folder output;
- whether to build a Roblox delivery manifest after export.

Auto-export is disabled by default. When enabled, Kryeo asks Affinity for the newest installed Asset Library Export workflow instead of relying on a hard-coded script version.

## Roblox delivery manifest

**Build Roblox manifest** creates `KryeoManifest.json` under `Asset Library/Delivered/Roblox/<Project>`.

For each current project asset it records the asset ID, display name, code name, category, version, Affinity source path, PNG path, tags, health state, and a simple `ImageLabel` or `ImageButton` suggestion.

This does not currently import objects into Roblox Studio. It creates the stable local handoff file that a future Studio plugin will consume.

## Linked placements

After Affinity verifies a successful Place operation, Kryeo records which asset version and layer kind were placed into which Affinity document session.

This provenance is the foundation for a future **Check for updates** command. Version 0.8.1 records the links but does not automatically replace placed layers.

## Command palette

Press `Ctrl+K` to search pages, workflows, and indexed assets from anywhere in Kryeo. Choosing a page navigates immediately; choosing a workflow opens or runs its existing Kryeo flow; choosing an asset opens it through Affinity.

## Staging cleanup

Interrupted Affinity workflows can leave temporary files in `Assets/KryeoStaging`. The cleanup command removes only files older than 24 hours from that exact folder. It does not delete asset documents, index files, or current staging work.

## Responsive workspace

Kryeo now changes structure before information becomes cramped:

- the right inspector is removed when the window can no longer support four useful columns;
- the asset index and asset inspector become a vertical flow at narrower widths;
- the asset inspector scrolls independently in shorter two-column windows;
- connection errors and diagnostic text wrap instead of being truncated;
- side navigation can scroll when vertical space is limited.

The neo-brutalist visual system remains the same at every size.
