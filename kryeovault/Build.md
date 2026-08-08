# Kryeo Build

> Repository mirror of the current operational release note. The authoritative Hermes note is `Kryeo/Build/Build & Release.md`.

## Current packaged build

- **Release:** `0.15.36`
- **Built and verified:** 2026-08-08
- **Installer:** `C:\Users\reece\Desktop\Kryeo\release\Kryeo-Setup-0.15.36.exe`
- **Installer size:** `272,210,159` bytes
- **Installer SHA-256:** `C28E3257AC50C77E2C94670326495EAB544A8759A819E87D369AE43E72A44AC2`
- **Packaged app.asar SHA-256:** `4BF35C5D337DC6E45C865E464C5877C5E710A312612FE637C91CCAD50405389D`
- **Authenticode:** not signed
- **Installed app:** `C:\Users\reece\AppData\Local\Programs\Kryeo\Kryeo.exe`
- **Installed version at last check:** `0.15.35.0`
- **Installed app.asar SHA-256:** `B592B2D9D878768D2BFDA47244CA007CB7A3FD15557061515C74275D8D60A5AF`

The `0.15.36` installer is ready, but it has not been applied. Do not describe it as the installed desktop version until the installer is run and the installed version is verified. The local gateway is running the current `family-v35` source with the existing structured cache preserved.

## Large-scan recovery and packaging in `0.15.36`

- A fresh-cache scan of the current document covered 579 unique visual families. The desktop dispatched 74 gateway batches; retries and repairs brought the real provider total to 80 calls, 122,862 prompt tokens, 17,431 completion tokens, and `$0.00595189`. Eleven families remained omitted after grouped repair, while zero were budget-limited.
- The measured bottleneck was Affinity export at 6m 10s, followed by hosted analysis at 4m 33s. Image preparation took 13.6s, document context 1.4s, local analysis 5ms, and finalization 16ms. Cost was healthy; source extraction and provider latency were the performance constraints.
- If a partial model response still omits aliases after grouped recovery, the gateway now performs a final parallel, single-family repair for only those unresolved aliases. Every attempt remains subject to the `$0.03` hard scan ceiling; successful families are never resent.
- Component Scan diagnostics now distinguish desktop gateway batches from real provider calls, expose Affinity request/retry/split counts and the slowest request, and preserve concrete failure messages instead of collapsing them into a count.
- Large scans with more than 160 unique visuals skip the optional embedded MobileCLIP context pass. Full cloud coverage is unchanged. Small scans can still use the bundled model, and `KRYEO_LOCAL_CONTEXT_MAX_VISUALS` can tune or disable the threshold.
- The previous package omitted the MobileCLIP ONNX and taxonomy files because the electron-builder manifest did not copy them. The installer now includes both resources, and `npm run verify:package` fails packaging if the installer version or either resource is missing or implausibly small.
- Missing optional local context is now a neutral diagnostic note rather than a red hosted-review failure. The hosted model remains the final classifier for every uncached unresolved family.

## Classification and system hardening in `0.15.35`

- Inset ornamental borders are measured relative to their occupied alpha bounds. Transparent padding no longer defeats hollow-perimeter detection.
- Inner fill, perimeter density, and four-side coverage provide a deterministic type guard. Geometry-backed borders cannot be changed back to `Frame` by target or hierarchy words such as `MainFrameOuterLayers` and `Frames`.
- Hosted results expose the raw model proposal and normalization reason. Evidence is now an independent audit that may suggest a correction.
- Full-document context capture is lazy and only runs for an actual escalation. Cancellation reaches Affinity partition export and image preparation, and scan diagnostics report per-stage timings, cache hits, failures, and budget skips.
- The gateway structured cache defaults to a 20,000-entry bound, evicts oldest entries, coalesces disk snapshots, reports cache health, and uses the new `family-v35` key space.
- Dependency manifests use explicit compatible ranges. The MCP SDK is `1.30.0`; all fixable production audit findings were removed. Four high-severity transitive findings remain in the optional embedded Transformers/ONNX runtime with no upstream fix.
- The installer remains unsigned; code signing is still a production-distribution requirement.

A fresh-cache scan of the current 969-component document used 84 Qwen3.7 Flash provider requests and cost `$0.00615183`, below the `$0.01` target. Evidence panels would be additional on-demand calls.

## First-scan performance in `0.15.34`

- Raw alpha metrics created during component preparation are reused for local structural signals, avoiding a second PNG decode for every unique visual.
- MobileCLIP now produces the local suggestion and reusable visual embedding in one pass; the former separate embedding pass processed every unique visual twice.
- Affinity export starts at a conservative work budget of 24, expands toward 56 only after fast real batches, and contracts to 12 before retrying or splitting a slow/recoverable batch.
- Full document export and cloud coverage are unchanged: every component is still exported and every unresolved unique family remains eligible for hosted analysis.

## Classification correction in `0.15.33`

- A generic Affinity `GroupNode` or child count no longer gives the component a preliminary Roblox `Frame` role. It is source hierarchy, not implementation semantics.
- Raw PNG alpha metrics independently recognise a transparent centre with dense perimeter art. If hosted review calls that geometry `Frame`, `Panel`, `Slot`, `Background`, `Wallpaper`, `Texture`, or `Overlay`, the desktop keeps `Border` / `ImageLabel` and flags the contradiction for review.
- Generic hosted names such as `Border Frame` are retargeted to the resolved type; with no trustworthy visual descriptor, the safe display fallback is `Decorative Border`, never bare `Frame`.
- Component Scan labels now distinguish a true scanned parent from the export category, and the stale fixed `Gemini` wording now follows the active hosted reviewer.
- Gateway contract `family-v34` reinforces the same perimeter-vs-container rule and invalidates prior structured-cache keys. Restart or redeploy the gateway from this source to activate the new prompt and cache version; the packaged desktop safeguard still corrects cached contradictory results.

## Performance implementation shipped in `0.15.32`

These changes were verified and packaged on 2026-08-07. They are not in the installed `0.15.30.0` app until the `0.15.32` installer is applied.

- Light Affinity structural partitions are exported in bounded, weight-aware batches (four initially, up to twelve); dense/large partitions remain isolated.
- Aggregate timeouts shrink and retry before structural splitting; a closed Affinity connection gets one reconnect attempt before fragmentation.
- Ordinary visible exports no longer incur a hide/reveal/restore cycle. Hidden and adjustment-bearing groups retain that safety path.
- Duplicate previews and hosted thumbnails are encoded once per exact visual, and hosted partial results no longer resend the entire thumbnail-bearing document after every cloud batch.
- Gateway cache snapshots use queued unique temporary files and retry transient Windows locks. A generated-cache write cannot fail a completed hosted analysis; the next update retries the full in-memory snapshot.

Live export-only verification of `Devil Hunter.af`: `969` components across `294` planned partitions completed in `458.2` seconds with no timeout, no connection loss, no cloud calls, and the original Affinity selection restored. This is not a claim about the full end-to-end scan duration.

## Hosted Component Scan runtime

Every unresolved unique family remains eligible for cloud analysis. No local language or vision model is required for final classification. Local work is limited to free preprocessing: export, exact-duplicate collapse, family grouping, contact-sheet packing, and optional embedded context.

| Part | Current value |
| --- | --- |
| Bulk and escalation model | `qwen/qwen3.7-flash` |
| Provider | OpenRouter at `https://openrouter.ai/api/v1` |
| Gateway | `http://127.0.0.1:8787` locally; use authenticated HTTPS for shared deployments |
| Client dispatch | 2 concurrent requests; 16 simple or 8 detailed families per request |
| Gateway model slots | `KRYEO_AI_MODEL_CONCURRENCY=2` |
| Gateway family batch | `KRYEO_AI_FAMILY_BATCH_SIZE=16` |
| Normal target | `KRYEO_AI_SCAN_TARGET_USD=0.01` |
| Enforced safety ceiling | `KRYEO_AI_SCAN_BUDGET_USD=0.03` |
| Hosted family count cap | `KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0` (unlimited) |
| Reasoning | `KRYEO_AI_REASONING_EFFORT=none` |
| Routing | `KRYEO_AI_PROVIDER_SORT=price`, `KRYEO_AI_SERVICE_TIER=default` |
| Parameter compatibility | `KRYEO_OPENROUTER_REQUIRE_PARAMETERS=false` |
| Result cache | `services\ai-server\.data\family-cache.json` |
| Cache cap | `KRYEO_AI_MAX_CACHE_ENTRIES=20000` |
| Analysis contract | `family-v35` |

The gateway reserves against current Qwen pricing with a 2x allowance for repair and token-accounting variance. It records provider-reported cost and the real provider-call count per scan, which the desktop summary displays separately from gateway batches. Valid partial results are stored immediately; missing aliases receive one grouped repair, followed by bounded single-family repairs only for aliases that are still absent.

Live verification on 2026-08-07:

- one uncached family: `$0.00002814`;
- sixteen uncached families: `$0.00011936`;
- all sixteen aliases returned with zero recovery;
- the 1,000-family cloud-coverage fixture completed in 16-family production-shaped waves below one cent of provider-reported fixture cost.

## Configure and run the gateway

Store secrets only in `services\ai-server\.env` or a deployment secret store. Never add either value to the Electron bundle or notes.

```dotenv
KRYEO_AI_MODEL=qwen/qwen3.7-flash
KRYEO_AI_MODEL_LITE=qwen/qwen3.7-flash
KRYEO_AI_MODEL_ESCALATION=qwen/qwen3.7-flash
KRYEO_MODEL_BASE_URL=https://openrouter.ai/api/v1
KRYEO_MODEL_API_KEY=<gateway-only OpenRouter key>
KRYEO_AI_REASONING_EFFORT=none
KRYEO_AI_PROVIDER_SORT=price
KRYEO_AI_SERVICE_TIER=default
KRYEO_OPENROUTER_PROMPT_CACHE=true
KRYEO_OPENROUTER_RESPONSE_CACHE=false
KRYEO_OPENROUTER_REQUIRE_PARAMETERS=false
KRYEO_AI_MODEL_CONCURRENCY=2
KRYEO_AI_MAX_INFLIGHT_PER_TOKEN=2
KRYEO_AI_FAMILY_BATCH_SIZE=16
KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2
KRYEO_AI_SCAN_TARGET_USD=0.01
KRYEO_AI_SCAN_BUDGET_USD=0.03
KRYEO_AI_ENFORCE_SCAN_BUDGET=true
KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0
KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN=1
KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2
KRYEO_AI_MAX_MODEL_RETRIES=1
KRYEO_AI_MAX_CACHE_ENTRIES=20000
```

```powershell
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'src/server.mjs' `
  -WorkingDirectory 'C:\Users\reece\Desktop\Kryeo\services\ai-server' `
  -WindowStyle Hidden

Invoke-RestMethod http://127.0.0.1:8787/health
```

The health response should report `analysisVersion: family-v35`, Qwen3.7 Flash on both lanes, a `$0.01` target, an enforced `$0.03` ceiling, 16-family batching, two model slots, bounded-cache counters, and zero active requests when idle.

## Build, validate, and install

1. Preserve unrelated local work with `git status --short`.
2. Update the root version and matching root `package-lock.json` entries. Leave the private AI-server package version alone unless it has a separate release.
3. Run:

   ```powershell
   npm install
   npm run typecheck
   npm run test:affinity-export
   npm run test:component-context
   npm run test:component-scan
   npm run test:local-ai
   npm run test:family-ai
   npm test --prefix services\ai-server
   node --check services\ai-server\src\server.mjs
   git diff --check
   npm run dist
   ```

4. Close only running installed `Kryeo.exe` processes. Run `release\Kryeo-Setup-<version>.exe`, relaunch Kryeo, then verify the installed Windows product version and `resources\app.asar` hash.

Recorded passes for `0.15.36`: `npm install`, typecheck, adaptive Affinity-export recovery and telemetry, component-context, inset component-scan topology, local-AI, family-AI, gateway cache/budget/evidence/recovery suite, syntax check, production build, NSIS package build, and packaged-resource verification. The installer and unpacked package report `0.15.36`; the packaged model is `11,846,843` bytes and taxonomy is `440,707` bytes.

## Clear generated family results

1. Confirm the exact target is `C:\Users\reece\Desktop\Kryeo\services\ai-server\.data\family-cache.json`.
2. Stop only the Kryeo gateway.
3. Delete that one generated cache file.
4. Restart the gateway.

This removes generated analysis results only. It does not remove Affinity assets, approved component decisions, or source documents.
