# Kryeo

Kryeo is a free desktop companion for Affinity scripts and local UI asset workflows.

## Current build

Kryeo `0.15.36` is the current packaged Windows build. The repeatable update, rebuild, install, hosted-AI, and cache procedures are documented in [kryeovault/Build.md](kryeovault/Build.md).

## What it does

- Connects to the local Affinity MCP server at `http://localhost:6767/sse`.
- Discovers the newest installed version of each Affinity library script.
- Searches, previews, opens, and places indexed assets without an Affinity picker dialog.
- Scans complete Affinity documents or a focused selection into reviewable component instances.
- Hashes canonical RGBA pixels so exact duplicate visuals share one future upload while retaining separate placements.
- Remembers confirmed Roblox UI roles by visual family across later scans.
- Stores searchable project notes, palettes, brushes, tags, and design decisions beside each asset library.
- Guides naming, versioning, Base/Raster options, and saving directly from Kryeo.
- Configures Export, Update, Setup, and Hand Shade directly in Kryeo.
- Places an asset's editable Master, clean Base, or flattened Raster layer into the active document.
- Uses a high-contrast neo-brutalist workstation interface and custom Kryeo brand mark.
- Shows the active Affinity document and selection count.
- Reads the existing Asset Library index and run diagnostics directly from disk.
- Runs Affinity actions as persistent jobs with live progress, cancellation requests, retry, and interrupted-run recovery.
- Shows PNG previews, asset health, complete version history, duplicate code-name warnings, favourites, and collections.
- Saves reusable settings presets for Export, Update, Setup, and Hand Shade.
- Stores per-project Auto-Export settings and publishes stable Raster PNGs after Save or on demand.
- Generates a local Roblox Studio delivery manifest from the latest project assets.
- Records placed asset links so future connector work can identify which document received which version.
- Includes a `Ctrl+K` command palette for navigation, workflows, and assets.
- Cleans abandoned staging files without touching current library documents.
- Keeps all execution and indexing local. No account or analytics are configured.

## Use

1. Open Affinity and enable its MCP server.
2. Open Kryeo.
3. Choose a workflow from **Tools**. Each installed core workflow is configured directly in Kryeo.

Placement uses Affinity's normal copy/paste path because its scripting SDK cannot transfer native nodes between documents. Kryeo resolves both documents by session ID before copying and pasting, so tab order does not determine the destination. The saved asset document remains open in Affinity after placement.

Kryeo does not bundle the Affinity scripts themselves. It uses the scripts already installed in Affinity, so updates to those scripts appear automatically.

### Component Scan

Open **Import** and choose **Scan document** to inspect every spread and walk nested containers until Kryeo finds independently editable visual groups. Use **Scan selection** when you only want one parent group or a few chosen layers. Kryeo exports temporary transparent PNGs, decodes them to canonical RGBA pixels, groups exact duplicates, and presents one batch role review. Temporary scan files are removed after their previews and hashes are created.

Document scans include hidden component branches. Kryeo treats Affinity containers as organizational folders, ordinary groups as component boundaries, and repeated sibling sets such as numbered hotbar slots as individual components. It recursively reviews meaningful nested groups while keeping generic construction layers inside their parent preview. A group or container named exactly `Storage` is a hard boundary: neither it nor anything inside it is scanned. Hidden ancestors are revealed only while their selected component is exported, then every original visibility state is restored.

Full-document export is split into bounded Affinity requests. Large structural groups are subdivided by descendant size, while smaller groups stay intact for hierarchy and composition; follow-up requests resolve only their active partition. This keeps large scans below Affinity's remote MCP execution window and reports partition progress instead of failing on one monolithic document request.

The review is presented as a collapsible parent-child tree. Every group can stay together, export only its children, or export both the complete parent and reusable nested parts. Kryeo scores that group-dive choice from names, geometry, child roles, reuse, and previous confirmations; the user always has the final choice.

**Remember choices** stores the asset type, Roblox role, family name, group-dive choice, correction count, semantic hint, and a compact visual embedding locally. Future visually similar components can learn from those confirmations even when their pixel hash is different. Exact duplicates collapse into one review row with an expandable list of every source instance, while close variants remain separate visual families.

Kryeo supplies meaningful layer and hierarchy names as evidence to the hosted model, while the model remains the final semantic classifier for unresolved families. When names and pixels disagree, the review shows the conflict instead of silently hiding it. Filters separate UI components, construction layers, and background artwork.

Overlapping sibling artwork is proposed as one composed component while page-sized backgrounds are protected from absorbing smaller controls. Every proposal lists its source-layer count and can be excluded before applying. **Apply names** changes only validated layer names and preserves the current hierarchy. **Apply to Affinity** is the separate, deliberate organization action that can create approved component groups. Both actions resolve every original layer path before changing anything; rescan if the document hierarchy changes.

Kryeo includes an 11.8 MB quantized MobileCLIP-S0 image encoder and a UI-specific taxonomy aligned with the Save workflow. Every scan groups each unique visual into the same asset types used while saving: frames, buttons, icons, panels, slots, bars, badges, labels, text, text boxes, scroll bars, dividers, backgrounds, cursors, wallpapers, tooltips, modals, inputs, tabs, tiles, ornaments, borders, corners, edges, fills, and effects. Geometry and layer structure supply additional context, then Kryeo maps the visual type to a Roblox UI role. The optional embedded context pass requires no Ollama service and is skipped by default above 160 unique visuals to keep large scans responsive; full cloud classification coverage is unchanged.

The embedded model runs on the CPU and never receives a complete editable document. It sees only temporary component previews. Large previews are analysed as an overview plus up to six overlapping high-resolution crops, so small labels and ornaments are not lost to one square resize. Learning stays in Kryeo's local workspace data; it does not train or download a new neural network. Confirmed embeddings act as a private visual memory layered over the bundled model.

Hosted family analysis runs through the separate Kryeo gateway. Free desktop preprocessing supplies extraction, grouping, deduplication, hierarchy, and confidence context; Qwen3.7 Flash through OpenRouter remains the cloud classifier for every unresolved family, so a local model is not required. Simple work uses adaptive sixteen-family contact sheets while detailed or ambiguous work stays at eight, with two requests processed concurrently. The model returns a compact packet, deterministic roles are expanded locally, and detailed evidence is purchased only when a user opens its panel. The normal target is `$0.01` per scan with an enforced `$0.03` safety ceiling, conservative reservations, and provider-reported per-scan cost in the review UI. Price-aware routing, reasoning-off classification, exact-template reuse, and in-flight request coalescing further reduce spend. Valid partial answers are retained; omissions receive one grouped repair and then cost-checked single-family recovery only for aliases still missing. Diagnostics distinguish gateway batches from actual provider calls. See the [hosted vision architecture](kryeovault/Kryeo%20Hosted%20Vision%20Architecture.md) and [Build note](kryeovault/Build.md).

Every confirmed review writes a hierarchy manifest under Kryeo's local `ComponentManifests` directory. It records parent-child relationships, chosen export depth, visual families, source paths, roles, and inclusion state so Auto-Export and future production connectors can preserve component structure instead of receiving a flat folder of PNGs.

### Kryeo Assistant

The **Assistant** workspace uses the optional quantized LFM2.5-VL 450M Intelligence Pack for natural project-aware conversation, visual document inspection, and reviewed tool calls. It is downloaded only when the user chooses to install it. Once installed, image and text inference run locally on the CPU through Transformers.js and ONNX, without Python, a cloud account, or a dedicated GPU. Kryeo detects available memory and recommends a compatibility or balanced profile automatically.

When document vision is enabled, Kryeo asks Affinity for a temporary rendered preview of the current selection or whole document. Large previews are analysed as a full-document overview plus overlapping high-resolution detail crops, preserving small controls and text that disappear in a single downscaled square. The model performs a visual perception pass, then a text planning pass with a strict allowlist of Kryeo tools. It can explain classifications and propose navigation into Component Scan, Assets, or Workflows. Raw model output is never executed, and it cannot silently edit Affinity.

Conversations are separated into persistent sessions with automatic titles, rename, pin, archive, import, and Markdown export. Memory can be scoped to the current project or made global. Instructions such as `Every SanityBar is a bar` and `Decorative borders stay inside their parent component` remain visible and removable. Applicable classification and hierarchy rules feed back into later Component Scan reviews and remain subject to user approval.

### Project Notes

Every project in **Assets** has a collapsible notes workspace for decisions that should survive beyond one chat: palettes, brush choices, naming rules, layout constraints, and production details. Notes support tags, text search, date filters, JSON import/export, and individual deletion.

Kryeo extracts useful structured metadata without hiding the original note. Hex colours become palette entries, `Brush: Name` records a brush, and tags such as `style:pixel` become design metadata. Imported knowledge merges nested colours, brushes, and design fields instead of replacing existing project context. The Assistant receives the current project's notes and metadata in its local prompt.

### Local Knowledge Search

The development vault and Kryeo documentation can be searched locally with QMD. The `kryeo` collection indexes the Hermes Kryeo vault and the optional `kryeo-code` collection indexes repository documentation. Both keyword and embedded retrieval remain on this machine.

```powershell
qmd update
qmd embed --max-docs-per-batch 32 --max-batch-mb 16
qmd query "component scan naming corrections" -c kryeo --no-rerank -n 3 --full-path
```

## Delivery scope

Kryeo 0.15.36 prepares production handoff rather than pretending to be a finished Roblox importer. A Roblox delivery creates `KryeoManifest.json` with asset IDs, versions, raster paths, health, and suggested Roblox UI classes. A Studio-side connector can consume this manifest next.

Auto-Export is opt-in per project. Kryeo discovers the newest installed Asset Library Export workflow, asks Affinity to prepare the latest Raster PNGs, and then publishes them into a production folder using stable code-name paths such as `Devil Hunter/Slots/slot_hotbar.png`. The versioned Asset Library files remain untouched.

Each run also writes `KryeoAutoExport.json` inside the project's production folder. It records the asset IDs, code names, versions, categories, and published files used by that run. Auto-Export can run after a successful Kryeo Save or manually from **Settings > Auto-Export**. Its job is tracked separately, so a failed export does not turn a completed asset Save into a failed Save. Interrupted jobs are reported on the next launch; cancellation cannot forcibly interrupt an Affinity command that has already entered the host application.

Earlier behavior and limits are documented in [Kryeo 0.8.1 Feature Guide](kryeovault/Kryeo%200.8.1%20Feature%20Guide.md). The current implementation is summarized here and in the vault's `Build` notes.

## Development

```powershell
npm install
npm run dev
```

Validation and packaging:

```powershell
npm run typecheck
npm run test:component-context
npm run test:local-ai
npm run test:component-scan
npm run test:family-ai
npm test --prefix services\ai-server
npm run build
npm run dist
```
