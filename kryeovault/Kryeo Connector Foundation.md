# Kryeo connector foundation

> The connector model remains current in broad terms, while the numbered sections below preserve 0.6.1 and 0.7.0 historical decisions. For the current `0.15.23` release, build, installer, hosted-AI, and runtime procedures, see [Build](Build.md).

## Product premise

Kryeo is a local design-to-development bridge. Creative applications are sources, production environments are targets, and Kryeo owns the transfer pipeline between them.

The primary product actions are **Auto-Import** and **Auto-Export**. Existing Affinity asset workflows are the first working connector, not the limit of the product.

## Core domains

### Connectors

Each connector declares:

- Stable ID and display name
- Creative-source, production-target, or bidirectional role
- Installed, configured, and available-now flags
- Connected, detected, planned, missing, or error state
- Installation path
- Capabilities
- Honest user-facing status

### Pipeline routes

Routes connect one source to one target and declare import, export, or sync direction. Route state is deliberately strict:

- `active`: implemented and usable now
- `detected`: both the machine/application context and route foundation exist, but the adapter is not implemented
- `planned`: the connector or route is not ready

### Current connector

Affinity is the first active creative-source connector. It currently owns:

- Indexed asset library
- Versioned save
- Master, Base, and Raster placement
- Asset loading and PNG export
- Pixel and utility scripts

### Future targets

Roblox Studio is represented as the production target. Photoshop is represented as a creative source. Detection does not imply that an adapter is complete.

## Architecture

- `src/main/connector-service.ts`: local application detection and connector registry
- `src/shared/types.ts`: connector-neutral contracts exposed over IPC
- `src/main/index.ts`: connector snapshot and refresh IPC handlers
- `src/preload/index.ts`: safe renderer bridge
- `src/renderer/src/App.tsx`: Pipeline, Connectors, Workflows, Assets, Activity, and Settings surfaces

Future adapters should implement the shared connector and route contracts instead of adding platform-specific assumptions to the renderer.

## 0.6.1 workflow compatibility repair

- Connector discovery is supplementary and no longer shares the critical loading path with Affinity workflows, the asset library, or activity logs.
- Affinity workflow discovery retries once after a short MCP settle period instead of silently leaving the app empty.
- A transient discovery failure preserves the last known workflow list and shows a useful Retry state.
- Kryeo now uses Electron's single-instance lock. A second launch focuses the existing window instead of opening another MCP client that can compete with Affinity.
- The seven established workflows remain available: Load, Save, Export, Update, Place, Hand Shade, and Library Setup.

## 0.7.0 interface system

- Added visible names to primary navigation so first-time users do not have to decode icon-only controls.
- Rebuilt the shell around a consistent spacing scale, readable control sizes, restrained shadows, and clearer surface hierarchy.
- Reserved lime for active state and primary actions, blue for focus and transfer state, and amber for secondary attention.
- Refined Pipeline, Connectors, Workflows, Assets, Activity, Settings, Save, Place, and configured tool screens as one system.
- Increased form labels and controls, aligned card actions, strengthened empty/error states, and improved long path readability.
- Verified the complete interface at the 1480x920 default size and the 980x680 minimum supported window size.
