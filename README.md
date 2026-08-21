# Kryeo

Kryeo is a free desktop companion for Affinity scripts and local UI asset workflows.

## Current build

Kryeo `0.15.98` is the current Windows release. The repeatable update, rebuild, install, Cloud Qwen, and cache procedures are documented in [kryeovault/Build.md](kryeovault/Build.md).

## What it does

- Connects to the local Affinity MCP server at `http://localhost:6767/sse`.
- Discovers the newest installed version of each Affinity library script.
- Searches, previews, opens, and places indexed assets without an Affinity picker dialog.
- Scans complete Affinity documents or a focused selection into reviewable component instances.
- Hashes canonical RGBA pixels so exact duplicate visuals share one future upload while retaining separate placements.
- Remembers confirmed Roblox UI roles by visual family across later scans.
- Stores searchable project notes, palettes, brushes, tags, and design decisions beside each asset library.
- Guides naming, versioning, Base/Raster options, and saving directly from Kryeo.
- Embeds asset-library setup in Kryeo so the library is browsed and managed in one workspace.
- Places an asset's editable Master, clean Base, or flattened Raster layer into the active document.
- Uses a high-contrast neo-brutalist workstation interface and custom Kryeo brand mark.
- Shows the active Affinity document and selection count.
- Maintains the local asset index and run diagnostics inside Kryeo's app workspace.
- Runs Affinity actions as persistent jobs with live progress, cancellation requests, retry, and interrupted-run recovery.
- Shows PNG previews, asset health, complete version history, duplicate code-name warnings, favourites, and collections.
- Saves reusable settings presets for Export, Update, and Hand Shade.
- Generates a local Roblox Studio delivery manifest from the latest project assets.
- Records placed asset links so future connector work can identify which document received which version.
- Includes a `Ctrl+K` command palette for navigation, workflows, and assets.
- Cleans abandoned staging files without touching current library documents.
- Keeps all execution and indexing local. No account or analytics are configured.

## Use

1. Open Affinity and enable its MCP server.
2. Open Kryeo.
3. Open **Assets** to browse the embedded library. Kryeo creates its private library workspace automatically.
4. Choose a workflow from **Tools**. Each installed core workflow is configured directly in Kryeo.

Placement uses Affinity's normal copy/paste path because its scripting SDK cannot transfer native nodes between documents. Kryeo resolves both documents by session ID before copying and pasting, so tab order does not determine the destination. The saved asset document remains open in Affinity after placement.

Kryeo does not bundle the Affinity scripts themselves. It uses the scripts already installed in Affinity, so updates to those scripts appear automatically.

Kryeo no longer exposes the Affinity **Asset Library - Setup** workflow or creates a desktop library folder. New assets are stored in Kryeo's app workspace and surfaced through **Assets**. Existing desktop libraries are indexed into Kryeo without moving their source documents.

### Component Scan

Open **Import** and choose **Scan document** to inspect every spread and walk nested containers until Kryeo finds independently editable visual groups. Use **Scan selection** when you only want one parent group or a few chosen layers. Kryeo exports temporary transparent PNGs, decodes them to canonical RGBA pixels, groups exact duplicates, and lets the AI prepare the asset plan automatically. Temporary scan files are removed after their previews and hashes are created.

Document scans include hidden component branches. Kryeo treats Affinity containers as organizational folders, ordinary groups as component boundaries, and repeated sibling sets such as numbered inventory cells as individual components. It recursively reviews meaningful nested groups while keeping generic construction layers inside their parent preview. A group or container named exactly `Storage` is a hard boundary: neither it nor anything inside it is scanned. Hidden ancestors are revealed only while their selected component is exported, then every original visibility state is restored.

Full-document export is split into bounded Affinity requests. Large structural groups are subdivided by descendant size, while smaller groups stay intact for hierarchy and composition; follow-up requests resolve only their active partition. This keeps large scans below Affinity's remote MCP execution window and reports partition progress instead of failing on one monolithic document request.

The workflow is automation-first rather than a thousand-row checklist. Kryeo makes conservative naming, export-boundary, and grouping decisions automatically, caches them, and exposes optional inspection lanes instead of a blocking approval queue. Internal layers that are not export targets do not create classification chores. Exact duplicate instances share one decision, and large hierarchies begin collapsed while nested details remain available.

Every group can stay together, export only its children, or export both the complete parent and reusable nested parts. Kryeo evaluates structure independently of the cloud proposal: separated repeated children favor children-only, overlapping construction favors keep-together, and an assembled parent with reusable independent children favors both. When evidence conflicts, Kryeo keeps the safest reversible boundary and records a non-blocking AI note. Remembered choices remain authoritative only when the direct-child visuals, separation, and parent coverage match, so identical parent pixels cannot transfer a dive choice into a different hierarchy.

Kryeo keeps document labels separate from production names. Meaningful Affinity names remain the tree labels; anonymous construction pieces receive honest structural labels such as `Top Left Corner`, `Border 2`, `Glow`, or `Part 3`. Only exported nodes receive production asset names, which combine a trustworthy parent identity with the child role when useful. Repeated cloud names across visually different siblings are rejected instead of producing walls of labels such as `Pixel Weapon Icon`.

AI decisions are cached automatically with the asset type, Roblox role, layer label, export name, group-dive choice, semantic hint, and a compact visual embedding locally. **Remember choices** remains available when you want to explicitly save a correction. Future visually similar components can learn from those decisions even when their pixel hash is different. Exact duplicates collapse into one row with an expandable list of every source instance, while close variants remain separate visual families.

Kryeo supplies meaningful layer and hierarchy names as evidence to Cloud Qwen, while the model remains the final semantic classifier for unresolved families. When names and pixels disagree, the inspection panel explains the safer fallback instead of blocking the scan. Filters separate UI components, construction layers, and background artwork.

Overlapping sibling artwork is proposed as one composed component while page-sized backgrounds are protected from absorbing smaller controls. Every proposal lists its source-layer count and is selected for export automatically unless you exclude it. The **Build asset library** action caches the AI decisions, applies readable layer labels, and creates the editable files and PNGs. Affinity writes each build into a private transaction first; Kryeo validates the complete batch before replacing library files, updating the index, and regenerating the full project manifest. Later same-name assets receive stable ordinal names instead of overwriting earlier files, while rebuilding the same source boundary keeps its asset ID and increments its version. **Organize layers** remains an optional source-hierarchy action and uses export names only for selected asset boundaries. Both actions resolve every original layer path before changing anything; rescan if the document hierarchy changes.

Kryeo includes an 11.8 MB quantized MobileCLIP-S0 image encoder and a UI-specific taxonomy aligned with the Save workflow. Every scan groups each unique visual into the same asset types used while saving: frames, buttons, icons, panels, slots, bars, badges, labels, text, text boxes, scroll bars, dividers, backgrounds, cursors, wallpapers, tooltips, modals, inputs, tabs, tiles, ornaments, borders, corners, edges, fills, and effects. Geometry and layer structure supply additional context, then Kryeo maps the visual type to a Roblox UI role. The optional embedded context pass requires no Ollama service and is skipped by default above 160 unique visuals to keep large scans responsive; full cloud classification coverage is unchanged.

The embedded model runs on the CPU and never receives a complete editable document. It sees only temporary component previews. Large previews are analysed as an overview plus up to six overlapping high-resolution crops, so small labels and ornaments are not lost to one square resize. Learning stays in Kryeo's local workspace data; it does not train or download a new neural network. Confirmed embeddings act as a private visual memory layered over the bundled model.

Cloud Qwen family analysis runs through the separate Kryeo gateway. Free desktop preprocessing supplies extraction, grouping, deduplication, hierarchy, and confidence context; Qwen3.7 Flash through OpenRouter remains the cloud classifier for every unresolved family, so a local model is not required. Each request sends labelled target PNGs directly in bounded batches of up to eight families, and two batches may run concurrently. The model returns one atomic packet per family, deterministic validation keeps name/type/role/grouping together, and evidence is generated only when a user opens its panel. The normal target is `$0.01` per scan with an enforced `$0.03` safety ceiling, conservative reservations, and provider-reported per-scan cost in the review UI. Price-aware routing, reasoning-off classification, exact-template reuse, and in-flight request coalescing further reduce spend. Complete partial answers are retained; omitted families stay explicitly unresolved instead of being guessed or patched from local fields. Diagnostics distinguish gateway batches from actual provider calls. See the [cloud vision architecture](kryeovault/Kryeo%20Hosted%20Vision%20Architecture.md) and [Build note](kryeovault/Build.md).

Every AI scan writes a hierarchy manifest under Kryeo's local `ComponentManifests` directory. It records parent-child relationships, chosen export depth, visual families, source paths, roles, and inclusion state so future production connectors can preserve component structure instead of receiving a flat folder of PNGs.

### Kryeo Assistant

The **Assistant** workspace uses the optional quantized LFM2.5-VL 450M Intelligence Pack for natural project-aware conversation, visual document inspection, and reviewed tool calls. It is downloaded only when the user chooses to install it. Once installed, image and text inference run locally on the CPU through Transformers.js and ONNX, without Python, a cloud account, or a dedicated GPU. Kryeo detects available memory and recommends a compatibility or balanced profile automatically.

When document vision is enabled, Kryeo asks Affinity for a temporary rendered preview of the current selection or whole document. Large previews are analysed as a full-document overview plus overlapping high-resolution detail crops, preserving small controls and text that disappear in a single downscaled square. The model performs a visual perception pass, then a text planning pass with a strict allowlist of Kryeo tools. It can explain classifications and propose navigation into Component Scan, Assets, or Workflows. Raw model output is never executed, and it cannot silently edit Affinity.

Conversations are separated into persistent sessions with automatic titles, rename, pin, archive, import, and Markdown export. Memory can be scoped to the current project or made global. Instructions such as `Every ProgressMeter is a bar` and `Decorative borders stay inside their parent component` remain visible and removable. Applicable classification and hierarchy rules feed back into later Component Scan decisions, which remain inspectable and correctable without a blocking approval queue.

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

Kryeo 0.15.98 prepares production handoff rather than pretending to be a finished Roblox importer. Component Scan and manual delivery now share one `kryeo.roblox.v1` `KryeoManifest.json` contract with stable asset IDs, strict code names, versions, raster paths, dimensions, source boundaries, and deterministic Roblox UI classes. A Studio-side connector can consume this manifest next.

The current implementation is summarized here and in the vault's `Build` notes. Historical release snapshots are intentionally excluded from the active documentation set.

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
