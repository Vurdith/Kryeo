# Kryeo 0.8 Pipeline Architecture

> Historical 0.8 architecture snapshot. Current release and operational procedures are maintained in [Build](Build.md); do not use this note as the current version or hosted-runtime reference.

## Purpose

Kryeo is the local bridge between creative source applications and production targets. Version 0.8 establishes persistent operations, asset intelligence, project recipes, and delivery manifests without replacing the Affinity workflows that already handle native document operations.

## Durable jobs

Every tool, open, save, configured workflow, place, and cleanup action is recorded in `pipeline-workspace.json` under Electron's user-data folder. Jobs expose progress, stage, result, cancellation intent, retry payload, and interrupted state. If Kryeo closes while a job is queued or running, the next launch marks it interrupted instead of silently losing it.

Cancellation is cooperative. Kryeo can stop before handing work to Affinity, but the Affinity SDK does not provide a safe host-command abort after execution begins.

## Asset intelligence

`GlobalIndex.json` remains the source of truth. Kryeo derives:

- latest asset records and complete version history;
- PNG previews from Exported Assets;
- missing source, missing export, and stale export health;
- duplicate current code names;
- local favourites and collections.

## Project recipes

Recipes are opt-in per project. A recipe stores the export preset, preferred source kind, enabled production targets, and whether Save should trigger Export automatically. Kryeo discovers the newest installed Asset Library Export workflow at runtime.

## Delivery contracts

Roblox delivery generates `KryeoManifest.json` under the Asset Library's `Delivered` folder. The manifest contains IDs, names, versions, paths, health, tags, and a suggested Roblox GUI class. This is the stable input for the future Studio-side adapter.

The current Roblox capability is a delivery manifest, not direct Studio insertion. A future Roblox Studio plugin should watch or import that manifest, upload/copy image files as appropriate, create GUI objects, and retain the Kryeo asset ID/version for updates.

## Linked placements

After Affinity verifies a successful placement and completes hidden staging cleanup, Kryeo records the source asset, version, layer kind, target document, and target session. This gives a future refresh command enough provenance to find outdated placements without changing the proven visibility workaround.

## Safety boundaries

- Master placement keeps copied adjustment content invisible through preparation, transfer, verification, cleanup, and only then final reveal.
- Staging cleanup only deletes old files inside `Assets/KryeoStaging`.
- Asset source files remain governed by the Affinity scripts; Kryeo does not rewrite `GlobalIndex.json`.
- Automatic export remains disabled until the user enables it for a project.
