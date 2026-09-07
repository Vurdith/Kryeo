# Kryeo AI Server

This service places authentication, rate limits, queues, family-result caching, and strict request limits in front of cloud vision models. The default configuration uses OpenRouter's `qwen/qwen3.7-flash` through its OpenAI-compatible chat-completions API for both the primary visual decision and the bounded independent reviewer. Free desktop preprocessing establishes structural export scopes and suppresses non-export duplicates; every unresolved export scope is still classified by the cloud model, so users do not need a local model.

It does not save uploaded source images. The persistent cache contains only complete structured family results. Context-specific results are keyed by analysis version, model, visual-family fingerprint, and context; a second context-neutral exact-asset key lets eligible Lite results be reused across users without storing source previews. The current decision contract is `family-v83` and the evidence contract is `family-explanation-v13`. The cache is capped at 20,000 entries by default, evicts its oldest entries, and coalesces disk writes; set `KRYEO_AI_MAX_CACHE_ENTRIES` to tune that bound.

## OpenRouter Qwen3.7 Flash

The gateway, not the Electron installer, owns the provider credential. Configure the ignored `.env` file or a deployment secret store with:

```dotenv
KRYEO_AI_MODEL=qwen/qwen3.7-flash
KRYEO_AI_MODEL_LITE=qwen/qwen3.7-flash
KRYEO_AI_MODEL_ESCALATION=qwen/qwen3.7-flash
KRYEO_MODEL_BASE_URL=https://openrouter.ai/api/v1
KRYEO_MODEL_TRANSPORT=chat-completions
KRYEO_MODEL_API_KEY=<OpenRouter key stored only on the gateway>
KRYEO_AI_REASONING_EFFORT=none
KRYEO_AI_PROVIDER_SORT=price
KRYEO_AI_SERVICE_TIER=default
KRYEO_OPENROUTER_PROMPT_CACHE=true
KRYEO_OPENROUTER_RESPONSE_CACHE=false
KRYEO_AI_FAMILY_BATCH_SIZE=8
KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY=2
KRYEO_AI_SCAN_TARGET_USD=0.01
KRYEO_AI_SCAN_BUDGET_USD=0.03
KRYEO_AI_ENFORCE_SCAN_BUDGET=true
KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0
KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN=1
KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION=0
KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION=0
KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION=0
KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION=0
KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR=2
KRYEO_AI_MODEL_TIMEOUT_MS=35000
KRYEO_AI_MAX_MODEL_RETRIES=0
KRYEO_AI_MAX_CACHE_ENTRIES=20000
```

The gateway sends multimodal family requests to OpenRouter's OpenAI-compatible `/chat/completions` endpoint, requests JSON output, and keeps every provider credential in the gateway. The client never receives the OpenRouter key; it only authenticates to the Kryeo gateway with a revocable Kryeo token. `KRYEO_MODEL_TRANSPORT=chat-completions` is the default; the gateway still accepts other OpenAI-compatible deployments when their base URL and transport are configured explicitly.

To control vision-token cost, the desktop local pass supplies grouping, hierarchy, duplicate-representation evidence, and confidence context before this service is called; it is not the final classifier for unresolved export scopes. The runtime sends primary requests in batches of at most eight families. A composed parent carries direct child context and uses the higher-quality context path; an escalation can additionally receive a document composite. The gateway does not derive a missing semantic field from local hints.

Reasons, descriptions, numeric evidence, conflicts, and alternatives are not purchased during the normal scan. `POST /v1/families/explain` generates and caches those fields only when a user opens the evidence panel. Every primary and reviewer result is one atomic packet: name, type, Roblox role, grouping, confidence, reason, and alternatives agree or the scope is unresolved. A partial packet is never completed from local fields. Complete results from an otherwise incomplete batch may be retained, but missing scopes remain `Unknown`, review-needed, and non-exportable for the next scan; there is no grouped or per-family repair fanout. Each model call has a 35-second default deadline, and `KRYEO_AI_MAX_MODEL_RETRIES` defaults to `0` (operators may explicitly opt into one bounded retry). The desktop never retries a complete paid gateway request. High-risk escalation uses the larger context path. The normal target is `$0.01`; `$0.03` is an enforced safety ceiling. Reservations use current model prices with a 2x allowance for token-accounting variance, while provider-reported cost and the real provider-call count are recorded separately.

The `family-v83` contract separates structural ownership from semantic classification. Hierarchy establishes context first; render hashes then deduplicate exact flattened representations only within that scope. Visually similar nodes in distinct hierarchy scopes are not merged into one semantic decision. A composed parent remains the sole export owner, while its non-duplicate construction children receive their own visual name, type, and role from the accepted visual model packet. Local code validates completeness and the generic Roblox type-to-role output contract; it never synthesizes a visual identity, remaps types or Roblox roles, or uses source/hierarchy evidence as a semantic override. A narrow generic leakage guard requests an independent replacement when a proposed child name copies a distinctive ancestor identity while omitting the child’s own meaningful direct identity; it never derives a replacement from that text. Direct target-type conflicts now receive full parent/child visual context and preserve the meaningful target cue whenever the artwork is compatible with more than one UI shell. A rejected mixed-taxonomy reviewer name is fed back as an explicit atomic replacement error; the one detailed correction does not repeat a third identical semantic request. Generic display grammar may split CamelCase and move an already-selected type behind the model's existing descriptors without adding, removing, or replacing semantic words. Terminal sibling ordinals are document-order metadata and are canonicalized mechanically as the final packet is applied, so a valid decision never becomes unresolved merely because a model reversed `1` and `2`. A complete uncertain primary packet stays automatic with its confidence visible; explicit evidence conflicts, invalid packets, and coverage failures reach independent review. Structural ownership is determined from the document before visual analysis, so a model grouping hint cannot erase a complete semantic packet. `Unknown` means the model supplied no complete defensible packet: it remains visibly unresolved and cannot export automatically. A `GroupNode` or child count is context, not type evidence.

The structural plan defines whether a composed parent stays together, an organizational parent exposes children, or both levels export. The model receives that planned grouping but cannot silently rewrite its boundary. A challenged packet gets at most one bounded independent-review pass; that pass can replace the primary only with a complete replacement packet. Incomplete reviewer criticism keeps the primary packet intact but marks the scope unresolved for review.

Concurrent byte-identical model requests are coalesced before entering the provider queue, so simultaneous users purchase one inference. Successful context-neutral exact assets also receive a shared structured-cache key; custom project instructions remain context-specific. Neither cache stores uploaded source images.

`KRYEO_OPENROUTER_RESPONSE_CACHE=false` is intentionally the default. Enabling it can make identical successful retries free at OpenRouter's response-cache layer, but it opts those requests into temporary response retention and may conflict with an account-level zero-data-retention policy. Kryeo's own structured family cache remains active without that opt-in.

For multiple users, deploy this gateway behind HTTPS on a server reachable by the desktop clients. Set `KRYEO_AI_HOST=0.0.0.0` only behind a firewall/reverse proxy, keep the provider key in the host's secret store, and issue a separate `KRYEO_AI_TOKENS` value per user. Do not expose OpenRouter or the gateway key from the Electron process.

## Cache maintenance and gateway restarts

Clear generated structured results through the authenticated gateway only after active analyses finish:

```powershell
$headers = @{ Authorization = 'Bearer <Kryeo AI token>' }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/v1/cache/clear -Headers $headers
```

`POST /v1/cache/clear` waits for the cache writer, removes the in-memory and on-disk derived cache, and returns `409` while analysis work is active. It does not remove source documents, exports, or saved decisions. Do not manually delete the cache while the gateway is running.

The gateway is a separate Node process. Updating its source or `.env` requires stopping and restarting that process, then checking `GET /health` reports `family-v83`. Building or installing the Electron desktop app neither deploys nor restarts the local gateway.

## Local development

1. Start Ollama with `OLLAMA_NUM_PARALLEL=2` and `OLLAMA_MAX_QUEUE=100`, then confirm `qwen3.5:9b` is available at `http://127.0.0.1:11434`.
2. Copy `.env.example` to `.env` and set `KRYEO_AI_MODEL=qwen3.5:9b`, `KRYEO_MODEL_BASE_URL=http://127.0.0.1:11434/v1`, clear the cloud provider key, and set a private `KRYEO_AI_TOKENS` value.
3. Start the gateway with `npm start`.
4. Configure Kryeo to use `http://127.0.0.1:8787` and the token from `.env`.

The gateway intentionally binds to loopback by default. Do not expose the raw model server or this development listener directly to the internet. A public deployment must terminate HTTPS at a reverse proxy and provide independently revocable user tokens. After changing gateway source or configuration, restart this process separately and confirm `/health` reports `family-v83` before scanning.

`scripts/start-qwen.ps1` remains an alternative `llama-server` setup. The current Ollama startup commands, cloud gateway settings, and the complete rebuild procedure are recorded in the repository's [Kryeo Build note](../../kryeovault/Build.md).

## Shared GPU beta

One GPU can be a shared worker for several Kryeo users, but it cannot create unlimited inference capacity. The gateway accepts authenticated requests, limits each token's active requests, and queues work when all model slots are busy. Start with two model slots and lower it to one if VRAM usage becomes unstable.

The desktop client dispatches two concurrent batches. Each primary request is capped at eight families and carries one labelled target PNG per family, so adjacent artwork cannot be mistaken for the selected target. The current deployment has no cloud-family count cap, so large documents are processed as queued waves; `KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN=0` means unlimited by count. Qwen3.7 Flash is the cloud classifier for every unresolved export scope, including locally clear candidates. Cost grows only with uncached eligible families, while duplicate representations, repeated scans, shared templates, and simultaneous identical requests reuse paid work. The dollar ceiling remains authoritative even when the family-count cap is unlimited.

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
