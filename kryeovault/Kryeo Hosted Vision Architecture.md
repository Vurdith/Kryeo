# Kryeo Hosted Vision Architecture

> Current hosted-analysis architecture. Operational commands and release steps live in [Build](Build.md).

## Current decision

Kryeo uses cloud-first visual classification with free desktop preprocessing:

1. Affinity exports every candidate from the requested document scope in bounded structural partitions.
2. The desktop creates previews, visual hashes, and raw alpha metrics once, reuses those metrics for structural signals, collapses exact duplicates, groups related variants, and builds numbered contact sheets.
3. Embedded MobileCLIP may add confidence and hierarchy context when it is available, but it is optional and is never the final classifier for an unresolved family.
4. Every unresolved unique family is sent to Qwen3.7 Flash through the Kryeo gateway. Users do not need Ollama or another local model.
5. The gateway returns structured suggestions only. It cannot execute Affinity actions.

Simple families use numbered 512x512 contact sheets containing up to sixteen previews. Sparse, extreme-aspect, cropped, semantically conflicting, or hierarchy-ambiguous families remain in batches of at most eight on 384x384 sheets. Two adaptive requests run concurrently. Approved user decisions and exact structured-cache hits do not purchase another inference.

## Cost policy

- Normal target: `KRYEO_AI_SCAN_TARGET_USD=0.01`.
- Enforced safety ceiling: `KRYEO_AI_SCAN_BUDGET_USD=0.03` with `KRYEO_AI_ENFORCE_SCAN_BUDGET=true`.
- Unlimited by family count: `KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0`.
- Pricing reservation: `$0.03/M` input and `$0.13/M` output for both lanes, multiplied by `KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2`.
- Reasoning: disabled with `KRYEO_AI_REASONING_EFFORT=none` because routine visual classification does not need paid hidden reasoning.
- Recovery: one bounded provider retry for transient failures, one grouped repair for omitted batch entries, then cost-checked single-family repairs only for aliases still missing. Successful entries are never resent, and the desktop never retries a complete paid gateway request.
- Settlement: the gateway records provider-reported cost and real provider-call count per scan. The desktop shows both and distinguishes them from its gateway batch count.

The gateway checks its structured cache before reserving paid work. Client-side budget filtering is intentionally absent because it would discard free cache hits near the end of large documents. The hard dollar ceiling remains authoritative even though the family-count cap is unlimited.

Live verification on 2026-08-07 measured `$0.00002814` for one uncached family and `$0.00011936` for one uncached sixteen-family batch with all sixteen results returned and no recovery. The regression suite sends 1,000 unique families through production-shaped sixteen-family cloud waves and verifies complete coverage under the one-cent provider-cost fixture.

## Deployed model and runtime

| Part | Current value |
| --- | --- |
| Normal cloud model | `qwen/qwen3.7-flash` |
| Escalation prompt | `qwen/qwen3.7-flash` |
| Provider | OpenRouter at `https://openrouter.ai/api/v1` |
| Local gateway | `http://127.0.0.1:8787` |
| Provider key | `services/ai-server/.env`, variable `KRYEO_MODEL_API_KEY` |
| Gateway token | `services/ai-server/.env`, variable `KRYEO_AI_TOKENS` |
| Client dispatch | Two concurrent requests; 16 simple or 8 detailed families per request |
| Gateway model slots | `KRYEO_AI_MODEL_CONCURRENCY=2` |
| Per-token active requests | `KRYEO_AI_MAX_INFLIGHT_PER_TOKEN=2` |
| Gateway family batch size | `KRYEO_AI_FAMILY_BATCH_SIZE=16` |
| Member previews | `KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2`; Lite normally uses one representative per contact-sheet cell |
| Provider routing | `KRYEO_AI_PROVIDER_SORT=price`, `KRYEO_AI_SERVICE_TIER=default` |
| Strict provider matching | `KRYEO_OPENROUTER_REQUIRE_PARAMETERS=false` |
| Prompt cache request | `KRYEO_OPENROUTER_PROMPT_CACHE=true` |
| Response cache | `KRYEO_OPENROUTER_RESPONSE_CACHE=false` |
| Analysis contract | `family-v37` |
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
KRYEO_AI_FAMILY_BATCH_SIZE=16
KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2
KRYEO_AI_SCAN_TARGET_USD=0.01
KRYEO_AI_SCAN_BUDGET_USD=0.03
KRYEO_AI_ENFORCE_SCAN_BUDGET=true
KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0
KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN=1
KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION=0.03
KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION=0.13
KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION=0.03
KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION=0.13
KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2
KRYEO_AI_MAX_MODEL_RETRIES=1
KRYEO_AI_MAX_CACHE_ENTRIES=20000
```

Keep the provider key on the gateway server. The Electron client receives only a revocable Kryeo token. Shared production deployments require HTTPS, a firewall or reverse proxy, and separate user tokens. Ollama remains an optional development fallback rather than a production requirement.

## Request and response contract

The Lite request carries one contact-sheet image plus compact family metadata: source names, Affinity node types, dimensions, child counts, visible-alpha geometry, limited hierarchy context, and exact-copy counts. Escalation may include one larger representative and the document composite. The desktop renders that full-document composite lazily only when at least one selected family actually uses escalation.

The model returns a compact packet with each family alias, type, concise complete display name, uncertainty, and dive mode. The gateway derives deterministic Roblox roles and ordinary review plumbing. Detailed reasons, visual descriptions, confidence evidence, conflicts, and alternatives are generated only when a user opens the evidence panel through `/v1/families/explain`; those results are cached separately.

The `family-v37` contract anchors names to the target family and rejects words borrowed only from parent, ancestor, child, sibling, or batch peers. A `GroupNode` or child count is not evidence that decorative artwork is a Roblox `Frame`. Alpha topology is measured relative to the occupied visual bounds, so an inset hollow ornament with transparent canvas padding is recognised from low inner fill, dense perimeter art, and four-side coverage. That geometry locks the final type to `Border` / `ImageLabel` when the model or a target word proposes `Frame`, `Panel`, `Slot`, or another container-like type. A high-confidence answer that says the preview is tiny, unreadable, nearly invisible, an artifact, or non-functional while every evidence signal is below 12% is treated as self-contradictory: confidence is capped at 55% and the family is forced into review. The response retains the raw model proposal and a truthful normalization reason.

Group export is a two-vote decision. The hosted packet proposes keep-together, children-only, or parent-and-children, while the desktop independently scores child repetition, spatial separation, overlap, parent coverage, reusable child roles, learned choices, and parent semantics. Strong agreement is accepted; strong disagreement enters the blocking exception queue and uses the structural-safe default until a user resolves it. Saved choices are reused only when a versioned signature of direct-child visuals, separation, and coverage matches the current instance. The hosted prompt defines all three modes explicitly and marks weak hierarchy evidence for review.

The desktop review is exception-first. Exact duplicates share a review decision, low-risk families remain included but hidden from the default lane, and generic names, incomplete hosted results, unknown types, semantic conflicts, low confidence, and group disagreements are promoted. Apply and learning actions remain locked until those exceptions are reviewed, preventing large documents from converting scrolling fatigue into silent approval.

Detailed evidence is an independent audit rather than a rationale constrained to the selected result. It reports whether the current classification is supported and may return a suggested name, asset type, or Roblox role. Every requested alias must be returned. Valid entries from a partial response are stored immediately. Missing aliases are repaired together first; any aliases still absent receive bounded single-family recovery without resending successful work.

The optional MobileCLIP context pass is skipped by default when a scan has more than 160 unique visuals because cloud classification remains authoritative and large local passes add latency without coverage. The threshold is configurable with `KRYEO_LOCAL_CONTEXT_MAX_VISUALS`. Packaged builds include the ONNX model and taxonomy for smaller scans, and the package verifier rejects releases that omit them.

## Learning, cache, and service boundaries

Corrections are stored per project as examples rather than hardcoded asset-specific rules. The gateway cache stores structured results, never source previews. Context-sensitive keys include project rules and hierarchy; context-neutral exact-template keys permit reuse across users when no custom rules are present. Concurrent byte-identical cache misses are coalesced before the provider queue. The structured cache is bounded to 20,000 entries by default, evicts oldest entries, and serializes only dirty snapshots so a long-running shared gateway cannot grow or rewrite indefinitely.

`GET /health` reports the analysis version, model names, queue state, budget policy, current estimator prices, prompt/completion tokens, provider cost, served tiers, coalesced calls, cache hits, cache entries, the configured cache limit, and eviction count. In-memory counters reset when the gateway restarts; OpenRouter remains the billing source of truth.

Run inference separately from the desktop app. Expose only an authenticated HTTPS gateway, never the raw provider key or model endpoint. To clear generated family results, stop only the gateway, delete `services/ai-server/.data/family-cache.json`, and restart it.

## Historical model plans

Older notes targeted local Qwen3-VL and Qwen3.5 through Ollama, and the previous hosted release used GPT-5.6 Luna. Those remain historical or optional development paths. The active hosted bulk and escalation model is Qwen3.7 Flash, selected after live price and structured-output verification.
