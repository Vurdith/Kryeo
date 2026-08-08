# Kryeo AI Server

This service places authentication, rate limits, queues, family-result caching, and strict request limits in front of an OpenAI-compatible cloud vision model. The production configuration uses Qwen3.7 Flash through OpenRouter for both normal family review and the richer escalation prompt. Free desktop preprocessing extracts artwork, collapses duplicates, and packs contact sheets; every unresolved unique family is still classified by the cloud model, so users do not need a local model.

It does not save uploaded source images. The persistent cache contains only structured family results. Context-specific results are keyed by analysis version, model, visual-family fingerprint, and context; a second context-neutral exact-asset key lets identical templates be reused across users without storing source previews. The current contract is `family-v35`. The cache is capped at 20,000 entries by default, evicts its oldest entries, and coalesces disk writes; set `KRYEO_AI_MAX_CACHE_ENTRIES` to tune that bound.

## Hosted OpenRouter/Qwen3.7 Flash

The gateway, not the Electron installer, owns the provider credential. Configure the ignored `.env` file or a deployment secret store with:

```dotenv
KRYEO_AI_MODEL=qwen/qwen3.7-flash
KRYEO_AI_MODEL_LITE=qwen/qwen3.7-flash
KRYEO_AI_MODEL_ESCALATION=qwen/qwen3.7-flash
KRYEO_MODEL_BASE_URL=https://openrouter.ai/api/v1
KRYEO_MODEL_API_KEY=<OpenRouter key stored only on the gateway>
KRYEO_AI_REASONING_EFFORT=none
KRYEO_AI_PROVIDER_SORT=price
KRYEO_AI_SERVICE_TIER=default
KRYEO_OPENROUTER_PROMPT_CACHE=true
KRYEO_OPENROUTER_RESPONSE_CACHE=false
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

The gateway sends multimodal family requests to OpenRouter's OpenAI-compatible `/chat/completions` endpoint, requests JSON output, disables paid reasoning for this classification task, and selects the lowest-cost compatible provider route. Stable system rules carry an explicit prompt-cache breakpoint; changing family metadata remains in the final user message. Each scan receives a hashed `session_id`, keeping concurrent waves on a sticky provider route. The client never receives the OpenRouter key; it only authenticates to the Kryeo gateway with a revocable Kryeo token.

To control vision-token cost, the desktop local pass supplies grouping, deduplication, hierarchy, and confidence context before this service is called; it is not the final classifier for unresolved families. Simple Lite work uses up to sixteen representative thumbnails in one numbered 512×512 contact sheet. Sparse, extreme-aspect, cropped, semantically conflicting, or hierarchy-ambiguous artwork stays in batches of at most eight on a 384×384 sheet. Lite returns a compact shared-root packet containing only each alias, type, complete name, uncertainty bit, and dive mode. The gateway derives Roblox role and normal review plumbing locally.

Reasons, descriptions, numeric evidence, conflicts, and alternatives are not purchased during the normal scan. `POST /v1/families/explain` generates and caches those fields only when a user opens the evidence panel. If classification omits part of a batch, the gateway stores valid entries and repairs all omitted families together first. Any aliases still absent receive parallel single-family repairs, limited to the unresolved set and checked against the hard scan budget; successful families are never resent. The desktop never retries a complete paid gateway request. High-risk escalation still uses the larger family preview plus document context. The normal target is `$0.01`; `$0.03` is an enforced safety ceiling. Reservations use current model prices with a 2x allowance for repair and token-accounting variance, while provider-reported cost and the real provider-call count are recorded separately.

The `family-v35` contract applies a target-scoped naming pass after hosted classification. Meaningful names from the target family are preserved; parent, ancestor, child, sibling, peer-family, collection, and implementation labels are context only, and proposal words found only in that context are rejected. A `GroupNode` or child count is not Frame evidence. Border detection is relative to the occupied alpha bounds rather than the outer edge of the PNG, so transparent padding around inset ornamental frames no longer hides their hollow-perimeter topology. That geometry can normalize a contradictory hosted `Frame`, `Panel`, or `Slot` to `Border` / `ImageLabel`, with both the raw model proposal and normalization reason returned for review. Structural filler such as `Container`, `Group`, and `Element` is removed from display names, while a meaningful ordinal is retained.

Concurrent byte-identical model requests are coalesced before entering the provider queue, so simultaneous users purchase one inference. Successful context-neutral exact assets also receive a shared structured-cache key; custom project instructions remain context-specific. Neither cache stores uploaded source images.

`KRYEO_OPENROUTER_RESPONSE_CACHE=false` is intentionally the default. Enabling it can make identical successful retries free at OpenRouter's response-cache layer, but it opts those requests into temporary response retention and may conflict with an account-level zero-data-retention policy. Kryeo's own structured family cache remains active without that opt-in.

For multiple users, deploy this gateway behind HTTPS on a server reachable by the desktop clients. Set `KRYEO_AI_HOST=0.0.0.0` only behind a firewall/reverse proxy, keep the provider key in the host's secret store, and issue a separate `KRYEO_AI_TOKENS` value per user. Do not expose OpenRouter or the gateway key from the Electron process.

## Local development

1. Start Ollama with `OLLAMA_NUM_PARALLEL=2` and `OLLAMA_MAX_QUEUE=100`, then confirm `qwen3.5:9b` is available at `http://127.0.0.1:11434`.
2. Copy `.env.example` to `.env` and set `KRYEO_AI_MODEL=qwen3.5:9b`, `KRYEO_MODEL_BASE_URL=http://127.0.0.1:11434/v1`, clear the hosted provider key, and set a private `KRYEO_AI_TOKENS` value.
3. Start the gateway with `npm start`.
4. Configure Kryeo to use `http://127.0.0.1:8787` and the token from `.env`.

The gateway intentionally binds to loopback by default. Do not expose the raw model server or this development listener directly to the internet. A public deployment must terminate HTTPS at a reverse proxy and provide independently revocable user tokens.

`scripts/start-qwen.ps1` remains an alternative `llama-server` setup. The current Ollama startup commands, hosted gateway settings, and the complete rebuild procedure are recorded in the repository's [Kryeo Build note](../../kryeovault/Build.md).

## Shared GPU beta

One GPU can be a shared worker for several Kryeo users, but it cannot create unlimited inference capacity. The gateway accepts authenticated requests, limits each token's active requests, and queues work when all model slots are busy. Start with two model slots and lower it to one if VRAM usage becomes unstable.

The desktop client dispatches two concurrent adaptive batches. Simple artwork can use sixteen families per request (up to 32 in a wave); detailed or ambiguous artwork remains capped at eight per request. Each normal request carries one numbered contact-sheet image. The current deployment has no hosted-family count cap, so large documents are processed as queued waves; `KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0` means unlimited by count. Qwen3.7 Flash is the cloud classifier for every unresolved family, including locally clear candidates. Cost grows only with uncached unique families, while duplicate families, repeated scans, shared templates, and simultaneous identical requests reuse paid work. The dollar ceiling remains authoritative even when the family-count cap is unlimited.

The current Ollama-backed setup should use matching settings before Ollama starts:

```powershell
$env:OLLAMA_NUM_PARALLEL = '2'
$env:OLLAMA_MAX_QUEUE = '100'
```

Restart Ollama after changing these values. Ollama's parallel setting defaults to one and memory grows with the number of parallel requests and the context length, so increase it only after checking GPU memory. The gateway settings are:

```dotenv
KRYEO_AI_MODEL_CONCURRENCY=2
KRYEO_AI_MAX_INFLIGHT_PER_TOKEN=2
KRYEO_AI_TOKENS=user-one-token,user-two-token
```

Keep `KRYEO_AI_HOST=127.0.0.1` and expose only the gateway through a secure HTTPS tunnel or reverse proxy. Point each Kryeo installation at that HTTPS gateway URL and give each person a different token. Never expose Ollama's port (`11434`) or the raw model server directly.

`GET /health` reports `analysisVersion`, `modelActive`, `modelQueued`, `modelConcurrency`, `familyBatchSize`, `serviceTier`, cache entry/limit/eviction counters, the Lite/escalation model pair, and safe usage totals including prompt, completion, provider cost, coalesced calls, context/shared cache hits, evidence-cache hits, and served service tiers.

## Production Shape

- Keep at least one inference replica warm.
- Route `/v1/chat` separately from document jobs.
- Scale replicas from queue depth and measured latency.
- Store tokens in a database as hashes when accounts are introduced.
- Replace the single-process rate limiter with a shared store before adding multiple gateway replicas.
- Use the OpenRouter/Qwen3.7 Flash inference boundary for multi-user production; the gateway already supports an OpenAI-compatible `KRYEO_MODEL_BASE_URL`.
- Keep the OpenRouter key server-side and add billing quotas before opening the gateway to untrusted users.
