# Kryeo Cloud Vision Architecture

> Current Cloud Qwen analysis architecture. Operational commands and release steps live in [Build](Build.md).

## Current decision

Kryeo uses cloud-first visual classification with free desktop preprocessing:

1. Affinity exports every candidate from the requested document scope in bounded structural partitions.
2. The desktop creates previews, visual hashes, and raw alpha metrics once, then establishes hierarchy-owned decision scopes. Exact render identity is deduplication evidence only; it does not merge separate hierarchy scopes into one semantic decision. Construction children, organizational parents, and flattened duplicate representations remain hierarchy evidence rather than export decisions.
3. Embedded MobileCLIP may add confidence and hierarchy context when it is available, but it is optional and is never the final classifier for an unresolved family.
4. Every unresolved selected export scope is sent to Qwen3.7 Flash through the Kryeo gateway. Users do not need Ollama or another local model.
5. The gateway returns structured suggestions only. It cannot execute Affinity actions.

Primary requests contain at most eight families, with two adaptive requests running concurrently. Composed parents include direct child previews as supporting, higher-quality context rather than independent child decisions. Escalation can additionally include a document composite. Approved user decisions and eligible structured-cache hits do not purchase another inference.

## Cost policy

- Normal target: `KRYEO_AI_SCAN_TARGET_USD=0.01`.
- Enforced safety ceiling: `KRYEO_AI_SCAN_BUDGET_USD=0.03` with `KRYEO_AI_ENFORCE_SCAN_BUDGET=true`.
- Unlimited by family count: `KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0`.
- Pricing reservation: Lite uses `$0.03/M` input and `$0.13/M` output; the independent reviewer uses `$0.104/M` input and `$0.416/M` output. Both are multiplied by `KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2`.
- Reasoning: disabled with `KRYEO_AI_REASONING_EFFORT=none` because routine visual classification does not need paid hidden reasoning.
- Model deadline and recovery: `KRYEO_AI_MODEL_TIMEOUT_MS` defaults to 35 seconds (clamped to 10-45 seconds). `KRYEO_AI_MAX_MODEL_RETRIES` defaults to `0` and can be set no higher than `1`. A failed or incomplete batch is not expanded into grouped or per-family repair calls. Complete packets may be retained, but any missing or incomplete scope remains `Unknown`, review-needed, and non-exportable for a later scan. The desktop never retries a complete paid gateway request.
- Settlement: the gateway records provider-reported cost and real provider-call count per scan. The desktop shows both and distinguishes them from its gateway batch count.

The gateway checks its structured cache before reserving paid work. Client-side budget filtering is intentionally absent because it would discard free cache hits near the end of large documents. The hard dollar ceiling remains authoritative even though the family-count cap is unlimited.

Gateway coverage verifies the eight-family primary bound, atomic packet validation, partial-batch handling without repair fanout, cache clearing, and the separate reviewer path. Cost still depends on uncached eligible decision scopes and the configured provider prices; the hard dollar ceiling remains the admission control.

## Deployed model and runtime

| Part | Current value |
| --- | --- |
| Normal cloud model | `qwen/qwen3.7-flash` |
| Escalation/reviewer model | `qwen/qwen3.7-flash` |
| Provider | OpenRouter at `https://openrouter.ai/api/v1` |
| Local gateway | `http://127.0.0.1:8787` |
| Provider key | `services/ai-server/.env`, variable `KRYEO_MODEL_API_KEY` |
| Gateway token | `services/ai-server/.env`, variable `KRYEO_AI_TOKENS` |
| Client dispatch | Two concurrent requests; up to 8 families per request |
| Gateway model slots | `KRYEO_AI_MODEL_CONCURRENCY=2` |
| Per-token active requests | `KRYEO_AI_MAX_INFLIGHT_PER_TOKEN=2` |
| Gateway family batch size | `KRYEO_AI_FAMILY_BATCH_SIZE=8` |
| Member previews | `KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2`; every target keeps its own labelled preview |
| Provider routing | `KRYEO_AI_PROVIDER_SORT=price`, `KRYEO_AI_SERVICE_TIER=default` |
| Strict provider matching | `KRYEO_OPENROUTER_REQUIRE_PARAMETERS=false` |
| Prompt cache request | `KRYEO_OPENROUTER_PROMPT_CACHE=true` |
| Response cache | `KRYEO_OPENROUTER_RESPONSE_CACHE=false` |
| Analysis contract | `family-v71` |
| Evidence contract | `family-explanation-v13` |
| Model timeout | `KRYEO_AI_MODEL_TIMEOUT_MS=35000` by default |
| Model retries | `KRYEO_AI_MAX_MODEL_RETRIES=0` by default; maximum one when explicitly enabled |
| Structured family cache | `services/ai-server/.data/family-cache.json` |
| Structured cache cap | `KRYEO_AI_MAX_CACHE_ENTRIES=20000` |

Configure the ignored gateway `.env` or deployment secret store:

```dotenv
KRYEO_AI_MODEL=qwen/qwen3.7-flash
KRYEO_AI_MODEL_LITE=qwen/qwen3.7-flash
KRYEO_AI_MODEL_ESCALATION=qwen/qwen3.7-flash
KRYEO_MODEL_BASE_URL=https://openrouter.ai/api/v1
KRYEO_MODEL_API_KEY=<server-side OpenRouter key>
KRYEO_AI_REASONING_EFFORT=none
KRYEO_AI_PROVIDER_SORT=price
KRYEO_AI_SERVICE_TIER=default
KRYEO_OPENROUTER_PROMPT_CACHE=true
KRYEO_OPENROUTER_RESPONSE_CACHE=false
KRYEO_OPENROUTER_REQUIRE_PARAMETERS=false
KRYEO_AI_FAMILY_BATCH_SIZE=8
KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2
KRYEO_AI_SCAN_TARGET_USD=0.01
KRYEO_AI_SCAN_BUDGET_USD=0.03
KRYEO_AI_ENFORCE_SCAN_BUDGET=true
KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0
KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN=1
KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION=0.03
KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION=0.13
KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION=0.104
KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION=0.416
KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2
KRYEO_AI_MODEL_TIMEOUT_MS=35000
KRYEO_AI_MAX_MODEL_RETRIES=0
KRYEO_AI_MAX_CACHE_ENTRIES=20000
```

Keep the provider key on the gateway server. The Electron client receives only a revocable Kryeo token. Shared production deployments require HTTPS, a firewall or reverse proxy, and separate user tokens. Ollama remains an optional development fallback rather than a production requirement.

## Request and response contract

The primary request carries each target preview directly beside compact family metadata: source names, Affinity node types, dimensions, child counts, visible-alpha geometry, limited hierarchy context, and exact-copy counts. A composed parent also carries direct child previews as supporting context, never as independent output scopes. Escalation may include a representative and the document composite; the desktop renders that composite lazily only when a selected scope actually uses escalation.

The model returns one complete packet per requested export scope: name, type, Roblox role, planned grouping, confidence, reason, and alternatives. The semantic identity is evidence, not a document-tree label. The gateway does not derive missing semantic fields from local hints. Detailed evidence is generated only when a user opens the evidence panel through `/v1/families/explain`; those results are cached separately.

The `family-v71` contract anchors each decision to its hierarchy context and accepts only atomic primary or reviewer packets. Image evidence is primary; direct source names and immediate hierarchy are supporting context only. No project-specific vocabulary is embedded in the contract. A composed parent remains the export owner, but non-duplicate construction children are separately named and classified so document organisation does not lose visual meaning. Mixed placeholder and named construction siblings receive one immediate-parent naming root and document-order numbering after both visual passes. An incomplete packet is never patched from local fields: it becomes `Unknown`, visibly unresolved, and non-exportable. A challenged scope receives one bounded independent-review pass; only a complete reviewer packet can replace the complete primary packet. There is no partial fallback and no per-family repair fanout.

Group export is structurally planned before semantic classification: a composed parent remains together, an organizational parent exposes its children, or both levels export. The model receives the planned grouping but cannot silently rewrite the boundary. Render equality can suppress a flattened duplicate representation after structural ownership is known; it cannot collapse distinct hierarchy decision scopes. Unsafe structural conflicts enter the blocking exception queue until a user resolves them.

The desktop review is export-aware and exception-first. Exact duplicate representations within the same decision scope share one decision, while matching visuals in different scopes stay separate. Non-exported internal layers remain visible in the hierarchy but do not create classification chores; only standalone or composed-parent boundaries are checked for complete packets, types, and semantic conflicts. `Unknown` and incomplete results cannot enter the export queue. Group-export conflicts remain blocking because they change which descendants become assets. A cautious cloud `reviewNeeded` flag remains an optional quick check rather than blocking the document.

Detailed evidence is an independent audit rather than a rationale constrained to the selected result. It reports whether the current classification is supported and may return a suggested name, asset type, or Roblox role. Every requested alias must be returned. A reviewer rejection without a complete replacement is useful review evidence only: it leaves the primary packet intact and visibly unresolved instead of partially modifying it.

The optional MobileCLIP context pass is skipped by default when a scan has more than 160 unique visuals because cloud classification remains authoritative and large local passes add latency without coverage. The threshold is configurable with `KRYEO_LOCAL_CONTEXT_MAX_VISUALS`. Packaged builds include the ONNX model and taxonomy for smaller scans, and the package verifier rejects releases that omit them.

## Naming pipeline

Naming uses one AI-owned overall asset name. The resolved name and type move together into the Affinity layer, editable asset, PNG, and manifest; the Roblox-safe `codeName` is derived mechanically. Folder context records hierarchy without prefixing irrelevant ancestors into the asset name. Construction children receive their own semantic naming decision but do not compete with their composed owner for export. A reviewer can change a decision only as one complete replacement; strict grammar rejects incomplete or internally inconsistent packets. Reviewer work preserves hierarchy scopes, does not fan out into repair retries, and leaves an affected scope visibly unresolved when capacity is unavailable. `family-v71` and `family-explanation-v13` invalidate affected generated results while preserving approved decisions and source files.

## Exception-first review

The cloud `reviewNeeded` field is advisory when it is the only concern. Kryeo places that scope in an optional quick-check lane, so it cannot turn a large document into a blocking wall of rows. Blocking review is reserved for incomplete analysis, an `Unknown` type or role, semantic or visual conflict, or an unsafe group-export conflict. Construction children, organizational parents, and duplicate representations are non-exported by design rather than unresolved classification work. The desktop collapses exact duplicate representations only within their decision scope and permits applying safe scopes without dismissing every advisory item.

## Learning, cache, and service boundaries

Corrections are stored per project as examples rather than hardcoded asset-specific rules. The gateway cache stores structured results, never source previews. Context-sensitive keys include project rules and hierarchy; context-neutral exact-template keys permit reuse across users when no custom rules are present. Concurrent byte-identical cache misses are coalesced before the provider queue. The structured cache is bounded to 20,000 entries by default, evicts oldest entries, and serializes only dirty snapshots so a long-running shared gateway cannot grow or rewrite indefinitely.

`GET /health` reports the analysis version, model names, queue state, budget policy, current estimator prices, retry limit, prompt/completion tokens, provider cost, served tiers, coalesced calls, cache hits, cache entries, the configured cache limit, and eviction count. In-memory counters reset when the gateway restarts; OpenRouter remains the billing source of truth.

Run inference separately from the desktop app. Expose only an authenticated HTTPS gateway, never the raw provider key or model endpoint. Clear generated family results with authenticated `POST /v1/cache/clear` after active work finishes; it safely clears in-memory and derived-file cache state and returns `409` while analysis is active. Do not manually delete the cache while the gateway is running. The Electron installer does not deploy or restart this local Node process: after gateway source or `.env` changes, restart it separately and require `/health` to report `family-v71` before scanning.
