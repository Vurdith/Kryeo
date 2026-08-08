import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

try {
  const environment = readFileSync(path.resolve('.env'), 'utf8');
  for (const line of environment.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {
  // Environment variables remain the production source of truth.
}

const HOST = process.env.KRYEO_AI_HOST || '127.0.0.1';
const PORT = Number(process.env.KRYEO_AI_PORT || 8787);
const MODEL_LITE = process.env.KRYEO_AI_MODEL_LITE || process.env.KRYEO_AI_MODEL || 'qwen/qwen3.7-flash';
// The default escalation lane uses the same inexpensive cloud vision model with
// a richer prompt. Operators can still opt into a different model explicitly.
const MODEL_ESCALATION = process.env.KRYEO_AI_MODEL_ESCALATION || MODEL_LITE;
const MODEL = MODEL_LITE;
const MODEL_BASE_URL = String(process.env.KRYEO_MODEL_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL_API_KEY = process.env.KRYEO_MODEL_API_KEY || '';
const IS_OPENROUTER = /(^|\/)openrouter\.ai\//i.test(MODEL_BASE_URL);
const IS_META_MODEL_API = /(^|\/\/)api\.meta\.ai(?:\/|$)/i.test(MODEL_BASE_URL);
const OPENROUTER_REASONING_EFFORT = ['none', 'minimal', 'low', 'medium', 'high'].includes(
  String(process.env.KRYEO_AI_REASONING_EFFORT || '').trim().toLowerCase(),
)
  ? String(process.env.KRYEO_AI_REASONING_EFFORT).trim().toLowerCase()
  : 'none';
const OPENROUTER_PROVIDER_SORT = ['price', 'latency', 'throughput'].includes(
  String(process.env.KRYEO_AI_PROVIDER_SORT || '').trim().toLowerCase(),
)
  ? String(process.env.KRYEO_AI_PROVIDER_SORT).trim().toLowerCase()
  : 'price';
const OPENROUTER_HTTP_REFERER = String(process.env.KRYEO_OPENROUTER_HTTP_REFERER || '').trim();
const OPENROUTER_TITLE = String(process.env.KRYEO_OPENROUTER_TITLE || 'Kryeo').trim();
const OPENROUTER_RESPONSE_CACHE = String(process.env.KRYEO_OPENROUTER_RESPONSE_CACHE || 'false').toLowerCase() === 'true';
const OPENROUTER_PROMPT_CACHE = String(process.env.KRYEO_OPENROUTER_PROMPT_CACHE || 'true').toLowerCase() === 'true';
// Strict parameter matching can leave a model with no routable endpoints.
// OpenRouter ignores unsupported options by default, while Kryeo's prompt still
// requires JSON output, so strict matching remains an explicit opt-in only.
const OPENROUTER_REQUIRE_PARAMETERS = String(process.env.KRYEO_OPENROUTER_REQUIRE_PARAMETERS || 'false').toLowerCase() === 'true';
const OPENROUTER_SERVICE_TIER = ['auto', 'default', 'flex', 'priority', 'scale'].includes(
  String(process.env.KRYEO_AI_SERVICE_TIER || '').trim().toLowerCase(),
)
  ? String(process.env.KRYEO_AI_SERVICE_TIER).trim().toLowerCase()
  : 'auto';
const DATA_DIR = path.resolve(process.env.KRYEO_AI_DATA_DIR || '.data');
const CACHE_PATH = path.join(DATA_DIR, 'family-cache.json');
const MAX_CACHE_ENTRIES = Math.max(1_000, Number(process.env.KRYEO_AI_MAX_CACHE_ENTRIES || 20_000));
const TOKENS = String(process.env.KRYEO_AI_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const ALLOW_LOOPBACK_WITHOUT_TOKEN = String(process.env.KRYEO_AI_ALLOW_LOOPBACK_WITHOUT_TOKEN || '').toLowerCase() === 'true';
const MAX_QUEUE = Number(process.env.KRYEO_AI_MAX_QUEUE || 100);
// Zero disables Kryeo's local request-rate ceiling; cloud-provider quotas remain authoritative.
const RATE_LIMIT = Math.max(0, Number(process.env.KRYEO_AI_RATE_LIMIT_PER_MINUTE ?? 0) || 0);
const MAX_BODY_BYTES = Number(process.env.KRYEO_AI_MAX_BODY_MB || 18) * 1024 * 1024;
const FAMILY_BATCH_SIZE = Math.min(16, Math.max(1, Number(process.env.KRYEO_AI_FAMILY_BATCH_SIZE || 16)));
const MAX_MEMBER_IMAGES_PER_FAMILY = Math.min(6, Math.max(1, Number(process.env.KRYEO_AI_MAX_MEMBER_IMAGES_PER_FAMILY || 2)));
const SCAN_TARGET_USD = Math.max(0, Number(process.env.KRYEO_AI_SCAN_TARGET_USD || 0.01));
const SCAN_BUDGET_USD = Math.max(SCAN_TARGET_USD, Number(process.env.KRYEO_AI_SCAN_BUDGET_USD || 0.03));
const ENFORCE_SCAN_BUDGET = String(process.env.KRYEO_AI_ENFORCE_SCAN_BUDGET || 'true').toLowerCase() === 'true';
// Zero means unlimited. The client still sends bounded batches, so this is a
// per-scan policy rather than an attempt to put an enormous request in memory.
const MAX_HOSTED_FAMILIES_PER_SCAN = Math.max(0, Number(process.env.KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN || 0));
const MAX_ESCALATION_FAMILIES_PER_SCAN = Math.max(0, Number(process.env.KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN || 1));
const ESTIMATED_INPUT_TOKENS_PER_IMAGE = Math.max(1, Number(process.env.KRYEO_AI_ESTIMATED_INPUT_TOKENS_PER_IMAGE || 300));
const ESTIMATED_TEXT_TOKENS_PER_FAMILY = Math.max(1, Number(process.env.KRYEO_AI_ESTIMATED_TEXT_TOKENS_PER_FAMILY || 260));
const ESTIMATED_OUTPUT_TOKENS_PER_FAMILY = Math.max(1, Number(process.env.KRYEO_AI_ESTIMATED_OUTPUT_TOKENS_PER_FAMILY || 40));
const LITE_INPUT_PRICE_PER_MILLION = Math.max(0, Number(process.env.KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION || 0.03));
const LITE_OUTPUT_PRICE_PER_MILLION = Math.max(0, Number(process.env.KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION || 0.13));
const ESCALATION_INPUT_PRICE_PER_MILLION = Math.max(0, Number(process.env.KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION || 0.03));
const ESCALATION_OUTPUT_PRICE_PER_MILLION = Math.max(0, Number(process.env.KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION || 0.13));
// Reserve enough room for one compact batch repair and provider-side token
// accounting variance. This is deliberately conservative because the budget is
// a spending ceiling, not a post-hoc estimate.
const COST_ESTIMATE_SAFETY_FACTOR = Math.max(1, Number(process.env.KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR || 2));
const MODEL_TIMEOUT_MS = Math.max(10_000, Number(process.env.KRYEO_AI_MODEL_TIMEOUT_MS || 55_000));
const MAX_MODEL_RETRIES = Math.max(0, Math.min(2, Number(process.env.KRYEO_AI_MAX_MODEL_RETRIES || 1)));
const MODEL_CONCURRENCY = Math.max(1, Number(process.env.KRYEO_AI_MODEL_CONCURRENCY || 2));
const MAX_INFLIGHT_PER_TOKEN = Math.max(1, Number(process.env.KRYEO_AI_MAX_INFLIGHT_PER_TOKEN || MODEL_CONCURRENCY));
const ANALYSIS_VERSION = 'family-v36';
const EXPLANATION_VERSION = 'family-explanation-v2';

const ASSET_TYPES = [
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor',
  'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
];
const BORDER_CONFLICT_TYPES = new Set([
  'Frame', 'Panel', 'Slot', 'Background', 'Wallpaper', 'Texture', 'Overlay',
]);
const ROBLOX_ROLES = ['Unknown', 'ImageButton', 'ImageLabel', 'Frame', 'TextButton', 'TextLabel', 'TextBox'];
const DIVE_MODES = ['keep-together', 'children-only', 'parent-and-children'];
const TYPE_TO_ROLE = {
  Button: 'ImageButton',
  Slot: 'ImageButton',
  Tab: 'ImageButton',
  Tile: 'ImageButton',
  Text: 'TextLabel',
  Label: 'TextLabel',
  TextBox: 'TextBox',
  Input: 'TextBox',
  Panel: 'Frame',
  ScrollBar: 'Frame',
  Tooltip: 'Frame',
  Modal: 'Frame',
  Frame: 'Frame',
};

const LITE_CLASSIFICATION_SYSTEM = [
  'You are Kryeo visual intelligence. Visually classify every supplied numbered UI-asset family; never skip an alias.',
  'Use the image as primary evidence. Meaningful human-authored layer and hierarchy names support intent and should preserve their core nouns; hashes, filenames, numbers, and default layer names do not.',
  'Choose the closest allowed type. Complete illustrated scenes are Wallpaper; foundational surfaces are Background; perimeters are Border; sparse transparent treatments are Overlay; reusable material is Texture; discrete content receptacles are Slot; compact markers/counters are Badge; compact symbols are Icon; decorative motifs are Ornament; large structural enclosures are Frame; light/glow/particles are FX.',
  'Hierarchy metadata is context only. Name the supplied family itself; never concatenate parent, ancestor, sibling, collection, type, or group labels into a reusable name.',
  'A GroupNode or structural Frame is implementation metadata, not permission to append Container, Group, Frame, or similar words. Use such a word only when the visible artwork itself is that object.',
  'A GroupNode, child count, or square outline never establishes Frame by itself. A transparent decorative rim with an empty centre and visible perimeter artwork is Border with an ImageLabel role; use Frame only for artwork that visibly functions as structural chrome around external UI content.',
  'Do not borrow distinctive words from parent, ancestor, child, or sibling names. A name word is valid only when supported by the target family source identity or visible artwork.',
  'Use the target family source name as the naming anchor when it is meaningful. Keep at most one necessary visual or function qualifier and do not stack multiple hierarchy or type nouns.',
  'Return a complete human-facing name for each family. Preserve meaningful source words after spacing and casing cleanup, but do not use IDs, hashes, filenames, or bare generic type nouns when the artwork supports a clearer identity.',
  'Keep related siblings coherent, but give every row its own complete display name and retain a short shared root only when it helps distinguish the family.',
  'u is 1 only when the image is unreadable or meaningful evidence genuinely conflicts; otherwise 0. d is 0 keep-together, 1 children-only, or 2 parent-and-children.',
  'For d: use 0 when overlapping pieces form one motif; use 1 only for an organizational parent whose children are reusable and whose parent adds no standalone asset; use 2 when both the assembled parent and independent children are useful exports. When hierarchy evidence is weak, use 0 and set u to 1.',
  `Allowed t values: ${ASSET_TYPES.join(', ')}.`,
  'Return valid JSON only: {"r":["shared identity root"],"f":[["f1",0,"assetType","complete display name",0,0]]}. Each f row is [alias, zero-based r index, t, n, u, d]. Return every requested alias exactly once.',
].join('\n');

const EVIDENCE_SYSTEM = [
  'You independently audit one existing Kryeo visual classification on demand.',
  'Inspect the supplied image and metadata without assuming the chosen name or type is correct. Explain support when it is correct; when it is wrong, mark a conflict and return the better allowed type, role, and name.',
  'A transparent hollow perimeter is Border/ImageLabel, not Frame. A GroupNode, parent name, child count, or category label is context only and never proves a runtime Frame.',
  'Return JSON only: {"q":"one short reason","v":"one short visual description","c":0.9,"e":[0.9,0.2,0.8,0],"ok":true,"x":false,"xm":"","st":"optional better type","sr":"optional better role","sn":"optional better name","a":[["alternativeType","short reason"]]}.',
  `Alternative types must come from: ${ASSET_TYPES.join(', ')}. Keep q, v, xm, and alternative reasons to one short sentence each.`,
].join('\n');

const STRUCTURAL_IDENTITY_WORDS = new Set([
  ...ASSET_TYPES.flatMap((type) => readableSourceName(type).toLowerCase().split(/\s+/).flatMap((word) => [word, `${word}s`])),
  'ui', 'root', 'container', 'containers', 'group', 'groups', 'layer', 'layers',
  'middle', 'outer', 'inner', 'center', 'centre', 'base', 'main', 'foreground',
  'backdrop', 'outline', 'outlines', 'content', 'contents', 'top', 'bottom',
  'left', 'right', 'side', 'sides', 'glow', 'shine', 'highlight', 'light', 'shadow',
]);

const NAME_NOISE_WORDS = new Set([
  'container', 'containers', 'group', 'groups', 'component', 'components',
  'element', 'elements', 'asset', 'assets', 'visual', 'visuals', 'ui',
  'display', 'composite', 'collection', 'object', 'objects',
  'ornate', 'ornamental', 'decorative', 'gilded', 'gilt', 'golden', 'gold',
]);

class IncompleteFamilyBatchError extends Error {
  constructor(message, partialResults = [], missingFamilies = [], fallbackResults = []) {
    super(message);
    this.name = 'IncompleteFamilyBatchError';
    this.partialResults = partialResults;
    this.missingFamilies = missingFamilies;
    this.fallbackResults = fallbackResults;
  }
}

class WorkQueue {
  constructor(name, concurrency) {
    this.name = name;
    this.concurrency = Math.max(1, concurrency);
    this.active = 0;
    this.waiting = [];
  }

  get depth() {
    return this.active + this.waiting.length;
  }

  get queued() {
    return this.waiting.length;
  }

  run(task) {
    if (this.waiting.length >= MAX_QUEUE) {
      return Promise.reject(Object.assign(new Error(`${this.name} queue is full. Try again shortly.`), { statusCode: 429 }));
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.waiting.length) {
      const item = this.waiting.shift();
      this.active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const modelQueue = new WorkQueue('Model', MODEL_CONCURRENCY);
const modelFlights = new Map();
const rateWindows = new Map();
const inflightRequests = new Map();
const familyCache = new Map();
const usageTotals = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  providerCostUsd: 0,
  coalescedRequests: 0,
  contextCacheHits: 0,
  sharedCacheHits: 0,
  explanationCacheHits: 0,
};
const usageByModel = new Map();
const serviceTierCounts = new Map();
const scanBudgetState = new Map();
let cacheWrite = Promise.resolve();
let cacheDirty = false;
let cacheEvictions = 0;

function storeCachedResult(key, value) {
  if (familyCache.has(key)) familyCache.delete(key);
  familyCache.set(key, value);
  cacheDirty = true;
  while (familyCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = familyCache.keys().next().value;
    if (oldestKey === undefined) break;
    familyCache.delete(oldestKey);
    cacheEvictions += 1;
  }
}

function secureEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authenticated(request) {
  // The local desktop app and its gateway share the loopback interface. Requiring
  // a persisted desktop credential here makes a stale Windows secure-storage entry
  // turn every scan into an unavailable-host fallback. Remote callers remain token
  // protected, even when the server itself is configured for loopback use.
  const remoteAddress = String(request.socket.remoteAddress || '');
  const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (ALLOW_LOOPBACK_WITHOUT_TOKEN && HOST === '127.0.0.1' && isLoopback) return true;
  const header = String(request.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(token) && TOKENS.some((known) => secureEqual(token, known));
}

function tokenIdentity(request) {
  return createHash('sha256').update(String(request.headers.authorization || request.socket.remoteAddress || '')).digest('hex');
}

function withinRateLimit(request) {
  if (RATE_LIMIT === 0) return true;
  const key = tokenIdentity(request);
  const now = Date.now();
  const window = (rateWindows.get(key) || []).filter((value) => now - value < 60_000);
  if (window.length >= RATE_LIMIT) return false;
  window.push(now);
  rateWindows.set(key, window);
  return true;
}

function totalInflightRequests() {
  let total = 0;
  for (const count of inflightRequests.values()) total += count;
  return total;
}

function acquireRequestSlot(request) {
  const identity = tokenIdentity(request);
  const active = inflightRequests.get(identity) || 0;
  if (active >= MAX_INFLIGHT_PER_TOKEN) {
    throw Object.assign(new Error('This token already has the maximum number of active requests.'), { statusCode: 429 });
  }
  inflightRequests.set(identity, active + 1);
  return () => {
    const next = (inflightRequests.get(identity) || 1) - 1;
    if (next > 0) inflightRequests.set(identity, next);
    else inflightRequests.delete(identity);
  };
}

function json(response, status, body) {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(value),
    'cache-control': 'no-store',
  });
  response.end(value);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseModelJson(value) {
  const trimmed = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some local OpenAI-compatible servers append a second object or prose even
    // when JSON mode is requested. Recover complete objects without truncating
    // braces that appear inside JSON strings.
  }
  const candidates = [];
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === '{') depth += 1;
      if (character !== '}') continue;
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(start, index + 1));
        const preferredKeys = ['families', 'summary', 'text'].filter((key) => Object.hasOwn(parsed, key)).length;
        candidates.push({ parsed, score: preferredKeys * 1_000_000 + index - start });
      } catch {
        // Keep scanning for the next complete object.
      }
      break;
    }
  }
  if (!candidates.length) throw new Error('The model did not return structured JSON.');
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].parsed;
}

function nonnegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function modelForTier(reviewTier) {
  return reviewTier === 'escalation' ? MODEL_ESCALATION : MODEL_LITE;
}

function pricingForTier(reviewTier) {
  return reviewTier === 'escalation'
    ? { input: ESCALATION_INPUT_PRICE_PER_MILLION, output: ESCALATION_OUTPUT_PRICE_PER_MILLION }
    : { input: LITE_INPUT_PRICE_PER_MILLION, output: LITE_OUTPUT_PRICE_PER_MILLION };
}

function estimatedFamilyCost(reviewTier, maxMemberImages, includeDocumentContext, imageCountOverride) {
  const pricing = pricingForTier(reviewTier);
  const defaultImageCount = Math.max(1, Math.min(6, Number(maxMemberImages || 1))) + (includeDocumentContext ? 1 : 0);
  const imageCount = Number.isFinite(imageCountOverride)
    ? Math.max(0, Number(imageCountOverride))
    : defaultImageCount;
  const inputTokens = ESTIMATED_TEXT_TOKENS_PER_FAMILY + imageCount * ESTIMATED_INPUT_TOKENS_PER_IMAGE;
  const outputTokens = ESTIMATED_OUTPUT_TOKENS_PER_FAMILY;
  const rawUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return {
    inputTokens,
    outputTokens,
    rawUsd,
    usd: rawUsd * COST_ESTIMATE_SAFETY_FACTOR,
  };
}

function usageForModel(model) {
  if (!usageByModel.has(model)) {
    usageByModel.set(model, {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      providerCostUsd: 0,
    });
  }
  return usageByModel.get(model);
}

function recordModelUsage(modelResponse, model) {
  const usage = modelResponse?.usage || {};
  const promptTokens = nonnegativeNumber(usage.prompt_tokens);
  const completionTokens = nonnegativeNumber(usage.completion_tokens);
  const totalTokens = nonnegativeNumber(usage.total_tokens) || promptTokens + completionTokens;
  const cachedTokens = nonnegativeNumber(usage.prompt_tokens_details?.cached_tokens);
  const cacheWriteTokens = nonnegativeNumber(usage.prompt_tokens_details?.cache_write_tokens);
  const providerCostUsd = nonnegativeNumber(usage.cost ?? usage.total_cost);
  const servedServiceTier = cleanText(modelResponse?.service_tier, 'unknown', 30).toLowerCase();
  serviceTierCounts.set(servedServiceTier, (serviceTierCounts.get(servedServiceTier) || 0) + 1);
  const reviewTier = model === MODEL_ESCALATION ? 'escalation' : 'lite';
  const pricing = pricingForTier(reviewTier);
  const estimatedCostUsd = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
  const target = usageForModel(model);
  for (const [key, value] of Object.entries({
    requests: 1,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens,
    estimatedCostUsd,
    providerCostUsd,
  })) {
    target[key] += value;
    usageTotals[key] += value;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens,
    estimatedCostUsd,
    providerCostUsd,
  };
}

function usageReport() {
  return {
    ...usageTotals,
    ...(usageTotals.providerCostUsd > 0 ? { providerCostUsd: usageTotals.providerCostUsd } : {}),
    byModel: Object.fromEntries([...usageByModel.entries()].map(([model, usage]) => [model, { ...usage }])),
    serviceTiers: Object.fromEntries(serviceTierCounts),
  };
}

function scanBudget(scanId, requestId) {
  const key = String(scanId || requestId || '').trim() || requestId;
  const now = Date.now();
  for (const [entryKey, entry] of scanBudgetState.entries()) {
    if (now - entry.updatedAt > 15 * 60_000) scanBudgetState.delete(entryKey);
  }
  const existing = scanBudgetState.get(key) || {
    updatedAt: now,
    estimatedUsd: 0,
    providerUsd: 0,
    providerRequests: 0,
    familyCount: 0,
    escalationCount: 0,
    familyIds: new Set(),
  };
  existing.updatedAt = now;
  scanBudgetState.set(key, existing);
  return existing;
}

function settleScanBudget(scanId, usage) {
  const key = String(scanId || '').trim();
  if (!key || !usage) return;
  const budget = scanBudget(key, key);
  const actual = nonnegativeNumber(usage.providerCostUsd) || nonnegativeNumber(usage.estimatedCostUsd);
  budget.providerUsd += actual;
  budget.providerRequests += 1;
  budget.updatedAt = Date.now();
}

function reserveFamiliesWithinBudget(families, reviewTier, payload, requestId) {
  const maxMemberImages = Math.min(
    MAX_MEMBER_IMAGES_PER_FAMILY,
    Math.max(1, Number(payload.maxMemberImages || (reviewTier === 'escalation' ? 2 : 1))),
  );
  const includeDocumentContext = Boolean(payload.includeDocumentContext) && reviewTier === 'escalation';
  const budget = scanBudget(payload.hostedScanId, requestId);
  const contactSheetIds = reviewTier === 'lite'
    && isVisionSafeDataUrl(payload.familyContactSheet?.previewUrl)
    && Array.isArray(payload.familyContactSheet?.familyIds)
    ? new Set(payload.familyContactSheet.familyIds.map((familyId) => String(familyId || '')))
    : new Set();
  const contactSheetFamilyCount = families.filter((family) => contactSheetIds.has(String(family.id || ''))).length;
  const allowed = [];
  const skippedFamilyIds = [];
  let estimatedCostUsd = 0;
  for (const family of families) {
    const familyId = String(family.id || '');
    if (!familyId || budget.familyIds.has(familyId)) {
      skippedFamilyIds.push(familyId);
      continue;
    }
    const estimate = estimatedFamilyCost(
      reviewTier,
      maxMemberImages,
      includeDocumentContext,
      contactSheetFamilyCount >= 2 && contactSheetIds.has(familyId) ? 1 / contactSheetFamilyCount : undefined,
    );
    const overFamilyLimit = MAX_HOSTED_FAMILIES_PER_SCAN > 0 && budget.familyCount >= MAX_HOSTED_FAMILIES_PER_SCAN;
    const overEscalationLimit = reviewTier === 'escalation' && budget.escalationCount >= MAX_ESCALATION_FAMILIES_PER_SCAN;
    const committedUsd = Math.max(budget.estimatedUsd, budget.providerUsd);
    const overBudget = ENFORCE_SCAN_BUDGET && committedUsd + estimate.usd > SCAN_BUDGET_USD;
    if (overFamilyLimit || overEscalationLimit || overBudget) {
      skippedFamilyIds.push(familyId);
      continue;
    }
    budget.familyIds.add(familyId);
    budget.familyCount += 1;
    if (reviewTier === 'escalation') budget.escalationCount += 1;
    budget.estimatedUsd += estimate.usd;
    estimatedCostUsd += estimate.usd;
    allowed.push(family);
  }
  return {
    allowed,
    skippedFamilyIds,
    budgetLimited: skippedFamilyIds.length > 0,
    estimatedCostUsd,
    maxMemberImages,
    includeDocumentContext,
  };
}

function cacheableSystemMessage(text) {
  return {
    role: 'system',
    content: IS_OPENROUTER && OPENROUTER_PROMPT_CACHE
      ? [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
      : text,
  };
}

function modelFlightKey(messages, maxTokens, model, serviceTier) {
  return createHash('sha256')
    .update(model)
    .update(String(maxTokens))
    .update(serviceTier)
    .update(JSON.stringify(messages))
    .digest('hex');
}

async function executeModelCall(messages, maxTokens, reasoningEffort, externalSignal, model, sessionId, serviceTier) {
  return modelQueue.run(async () => {
    if ((IS_OPENROUTER || IS_META_MODEL_API) && !MODEL_API_KEY) {
      throw new Error(`KRYEO_MODEL_API_KEY is required when using ${IS_META_MODEL_API ? 'the Meta Model API' : 'OpenRouter'}.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    try {
      const modelRequest = {
        model,
        messages,
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        ...(IS_OPENROUTER && sessionId ? { session_id: sessionId } : {}),
        ...(IS_OPENROUTER && serviceTier !== 'auto' ? { service_tier: serviceTier } : {}),
        ...(IS_OPENROUTER
          ? {
              reasoning: {
                effort: OPENROUTER_REASONING_EFFORT,
                exclude: true,
              },
              provider: {
                sort: OPENROUTER_PROVIDER_SORT,
                ...(OPENROUTER_REQUIRE_PARAMETERS ? { require_parameters: true } : {}),
              },
            }
          : IS_META_MODEL_API
            ? {}
            : {
              reasoning_effort: reasoningEffort,
              think: false,
            }),
      };
      const requestCompletion = async (body) => {
        const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(MODEL_API_KEY ? { authorization: `Bearer ${MODEL_API_KEY}` } : {}),
            ...(IS_OPENROUTER
              ? {
                  ...(OPENROUTER_HTTP_REFERER ? { 'http-referer': OPENROUTER_HTTP_REFERER } : {}),
                  ...(OPENROUTER_TITLE ? { 'x-title': OPENROUTER_TITLE } : {}),
                  ...(OPENROUTER_RESPONSE_CACHE ? { 'x-openrouter-cache': 'true' } : {}),
                }
              : {}),
          },
          body: JSON.stringify(body),
        });
        return { response, text: await response.text() };
      };
      let completion = await requestCompletion(modelRequest);
      if (
        !completion.response.ok
        && IS_OPENROUTER
        && serviceTier === 'flex'
        && [400, 404, 422].includes(completion.response.status)
      ) {
        // Flex is opportunistic: an endpoint without an economy lane must not
        // make a document scan fail. Rejected requests are not inference calls.
        const { service_tier: _ignored, ...defaultTierRequest } = modelRequest;
        completion = await requestCompletion(defaultTierRequest);
      }
      if (!completion.response.ok) {
        throw new Error(`Model server error ${completion.response.status}: ${completion.text.slice(0, 500)}`);
      }
      const body = completion.text;
      const parsed = JSON.parse(body);
      const usage = recordModelUsage(parsed, model);
      try {
        return {
          output: parseModelJson(parsed.choices?.[0]?.message?.content),
          usage,
        };
      } catch (error) {
        error.modelUsage = usage;
        throw error;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`The model did not answer within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds.`);
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  });
}

async function callModelWithUsage(
  messages,
  maxTokens = 900,
  reasoningEffort = 'none',
  externalSignal,
  model = MODEL,
  sessionId = '',
  serviceTier = OPENROUTER_SERVICE_TIER,
) {
  const key = modelFlightKey(messages, maxTokens, model, serviceTier);
  const existing = modelFlights.get(key);
  if (existing) {
    usageTotals.coalescedRequests += 1;
    return existing;
  }
  const flight = executeModelCall(
    messages,
    maxTokens,
    reasoningEffort,
    externalSignal,
    model,
    sessionId,
    serviceTier,
  ).finally(() => modelFlights.delete(key));
  modelFlights.set(key, flight);
  return flight;
}

async function callModel(
  messages,
  maxTokens = 900,
  reasoningEffort = 'none',
  externalSignal,
  model = MODEL,
  sessionId = '',
  serviceTier = OPENROUTER_SERVICE_TIER,
) {
  const result = await callModelWithUsage(
    messages,
    maxTokens,
    reasoningEffort,
    externalSignal,
    model,
    sessionId,
    serviceTier,
  );
  return result.output;
}

function cleanText(value, fallback, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || fallback;
}

function confidenceScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

function booleanValue(value) {
  if (value === true || value === 1 || String(value).toLowerCase() === 'true') return true;
  return false;
}

function readableSourceName(value) {
  return String(value || '')
    .replace(/\.(?:png|jpe?g|webp|gif|tiff?|afdesign)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function identityWords(value) {
  return readableSourceName(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !/^\d+$/.test(word));
}

function isStructuralIdentity(value) {
  const sourceWords = identityWords(value);
  return sourceWords.length > 0 && sourceWords.every((word) => STRUCTURAL_IDENTITY_WORDS.has(word));
}

function isOpaqueIdentity(value) {
  const source = readableSourceName(value);
  const compact = source.replace(/\s/g, '');
  return !source
    || /^\d+$/.test(compact)
    || /^family\s*\d+\s*member\s*\d+$/i.test(source)
    || /^variant\s*\d+$/i.test(source)
    || /^(?:layer|group|image|asset|export)\s*\d*$/i.test(source)
    || /^[a-f0-9]{12,}$/i.test(compact);
}

function meaningfulSourceName(value) {
  const source = readableSourceName(value).replace(/\s*\d+$/i, '').trim();
  if (!source || /^\d+$/.test(source) || /^layer\s*\d*$/i.test(source) || /^group\s*\d*$/i.test(source)) return '';
  if (/^[a-f0-9]{12,}$/i.test(source.replace(/\s/g, ''))) return '';
  return source;
}

function semanticTypeFromSource(value) {
  const source = ` ${readableSourceName(value).toLowerCase()} `;
  const matches = ASSET_TYPES
    .filter((type) => type !== 'Unknown')
    .sort((left, right) => right.length - left.length)
    .flatMap((type) => {
      const words = readableSourceName(type).toLowerCase().replace(/\s+/g, '\\s*');
      const match = new RegExp(`\\b${words}s?\\b`, 'i').exec(source);
      return match ? [{ type, index: match.index }] : [];
    });
  return matches
    .sort((left, right) => right.index - left.index || right.type.length - left.type.length)[0]?.type;
}

function hasContentRelativePerimeter(family) {
  return (Array.isArray(family?.members) ? family.members : []).some((member) => {
    const metrics = member?.visualMetrics;
    if (!metrics) return false;
    const inner = Number(metrics.innerVisibleRatio);
    const perimeter = Number(metrics.contentPerimeterVisibleRatio);
    const coverage = Number(metrics.contentPerimeterCoverage ?? 1);
    if (Number.isFinite(inner) && Number.isFinite(perimeter)) {
      return inner < 0.12
        && perimeter > 0.05
        && perimeter > inner * 2
        && coverage >= 0.28;
    }
    const center = Number(metrics.centerVisibleRatio);
    const edge = Number(metrics.edgeVisibleRatio);
    return Number.isFinite(center)
      && Number.isFinite(edge)
      && center < 0.16
      && edge > 0.06
      && edge > center * 2.2;
  });
}

function trailingNameNumber(value) {
  return readableSourceName(value).match(/\s(\d+)$/)?.[1] || '';
}

function appendNameNumber(name, number) {
  const base = cleanText(name, '');
  if (!base || !number || new RegExp(`\\s${number}$`).test(base)) return base;
  return `${base} ${number}`;
}

function hierarchyNameCandidates(family, peerFamilies = []) {
  const hierarchy = Array.isArray(family?.hierarchyContext) ? family.hierarchyContext : [];
  return [
    ...(Array.isArray(family?.parentNames) ? family.parentNames : []),
    ...hierarchy.flatMap((item) => [
      item?.parentName,
      ...(Array.isArray(item?.ancestorNames) ? item.ancestorNames : []),
      ...(Array.isArray(item?.childNames) ? item.childNames : []),
      ...(Array.isArray(item?.siblingNames) ? item.siblingNames : []),
    ]),
    ...peerFamilies
      .filter((peer) => peer?.id !== family?.id)
      .flatMap((peer) => (Array.isArray(peer?.members) ? peer.members : []).map((member) => member?.name)),
  ]
    .map((value) => meaningfulSourceName(value))
    .filter(Boolean);
}

function familyNameAnchor(family, visualType) {
  const memberNames = (Array.isArray(family?.members) ? family.members : [])
    .map((member) => meaningfulSourceName(member?.name))
    .filter(Boolean);
  const hierarchy = Array.isArray(family?.hierarchyContext) ? family.hierarchyContext : [];
  const directHierarchyNames = [
    ...(Array.isArray(family?.parentNames) ? family.parentNames : []),
    ...hierarchy.map((item) => item?.parentName),
  ]
    .map((value) => meaningfulSourceName(value))
    .filter(Boolean);
  const hierarchyNames = hierarchyNameCandidates(family);
  const memberIdentity = memberNames.find((name) => !isStructuralIdentity(name));
  if (memberIdentity) return memberIdentity;
  const memberTypeMatch = memberNames.find((name) => (
    identityWords(name).length > 1
    && semanticTypeFromSource(name) === visualType
  ));
  if (memberTypeMatch) return memberTypeMatch;
  const hierarchyTypeMatch = [...new Set([...directHierarchyNames, ...hierarchyNames])].find((name) => (
    identityWords(name).length > 1
    && semanticTypeFromSource(name) === visualType
  ));
  if (hierarchyTypeMatch) return hierarchyTypeMatch;
  if (hierarchyNames.length) return '';
  return memberNames.find((name) => !isStructuralIdentity(name))
    || memberNames.find((name) => identityWords(name).length > 1 && semanticTypeFromSource(name) === visualType)
    || '';
}

function displayIdentityName(value, visualType) {
  const words = identityWords(value);
  if (!words.length) return '';
  const typeWords = identityWords(visualType);
  const typeIndex = words.findIndex((word) => typeWords.some((typeWord) => (
    word === typeWord || word === `${typeWord}s`
  )));
  if (typeIndex >= 0) {
    words[typeIndex] = typeWords.find((typeWord) => (
      words[typeIndex] === typeWord || words[typeIndex] === `${typeWord}s`
    )) || words[typeIndex];
    if (typeIndex === 0 && words.length > 1) {
      words.push(words.splice(typeIndex, 1)[0]);
    }
  }
  return readableSourceName(words.join(' '));
}

function proposalBorrowsHierarchyContext(family, proposedName, peerFamilies = []) {
  const proposalWords = identityWords(proposedName);
  const sourceWords = new Set((Array.isArray(family?.members) ? family.members : [])
    .flatMap((member) => identityWords(meaningfulSourceName(member?.name))));
  const hierarchyWords = new Set(hierarchyNameCandidates(family, peerFamilies)
    .flatMap((name) => identityWords(name)));
  return proposalWords.some((word) => (
    hierarchyWords.has(word)
    && !sourceWords.has(word)
    && !STRUCTURAL_IDENTITY_WORDS.has(word)
  ));
}

function compactFamilyName(family, visualType, proposedName, peerFamilies = []) {
  const proposal = readableSourceName(proposedName);
  if (
    !proposal
    || isOpaqueIdentity(proposal)
    || /^(?:unlabelled|unlabeled)(?:\s+visual)?$/i.test(proposal)
  ) return '';

  const anchor = familyNameAnchor(family, visualType);
  const anchorName = displayIdentityName(anchor, visualType);
  const proposalType = semanticTypeFromSource(proposal);
  if (anchorName && proposalType && proposalType !== visualType) return anchorName;
  const proposalWords = identityWords(proposal);
  const anchorWords = identityWords(anchorName);
  const sourceWords = new Set(anchorWords);
  const typeWordSet = new Set(identityWords(visualType));
  const hierarchyWords = new Set(hierarchyNameCandidates(family, peerFamilies).flatMap((name) => identityWords(name)));
  const contextOnlyWords = new Set([...hierarchyWords].filter((word) => (
    !sourceWords.has(word)
    && !typeWordSet.has(word)
    && !STRUCTURAL_IDENTITY_WORDS.has(word)
  )));
  const contextLeakPresent = proposalWords.some((word) => contextOnlyWords.has(word));
  const containsAnchor = anchorWords.length > 0 && anchorWords.every((word) => proposalWords.includes(word));
  const noisePresent = proposalWords.some((word) => NAME_NOISE_WORDS.has(word));
  const extraWords = proposalWords.filter((word) => (
    !anchorWords.includes(word) && !NAME_NOISE_WORDS.has(word)
  ));
  const anchorIsStructural = isStructuralIdentity(anchor);
  const useAnchor = Boolean(anchorName) && (
    contextLeakPresent
    ||
    (containsAnchor && (noisePresent || extraWords.length > 1 || proposalWords.length > 3))
    || (proposalWords.length > 4 && (!anchorIsStructural || semanticTypeFromSource(anchor) === visualType))
  );
  const ordinal = trailingNameNumber(proposal);
  if (useAnchor) return appendNameNumber(anchorName, ordinal);

  const compactWords = [];
  for (const word of proposalWords) {
    if (NAME_NOISE_WORDS.has(word)) continue;
    if (contextOnlyWords.has(word)) continue;
    if (compactWords.at(-1) === word) continue;
    compactWords.push(word);
  }
  if (!compactWords.length) return anchorName;

  const typeWords = identityWords(visualType);
  const typeIndex = compactWords.findIndex((word) => typeWords.some((typeWord) => (
    word === typeWord || word === `${typeWord}s`
  )));
  if (compactWords.length > 4) {
    if (typeIndex >= 0) {
      compactWords.splice(0, Math.max(0, typeIndex - 2));
    } else {
      compactWords.splice(4);
    }
  }
  return appendNameNumber(displayIdentityName(compactWords.join(' '), visualType), ordinal);
}

function sourceIdentity(family, visualType, proposedName, peerFamilies = [], options = {}) {
  const sourceCandidates = family.members
    .map((member) => meaningfulSourceName(member.name))
    .filter(Boolean);
  const sourceSemanticType = sourceCandidates
    .map((name) => semanticTypeFromSource(name))
    .find(Boolean);
  const candidates = sourceCandidates.filter((name) => !isStructuralIdentity(name));
  const source = candidates[0] || '';
  const proposal = cleanText(proposedName, '');
  const opaqueProposal = isOpaqueIdentity(proposal);
  // Context leakage is a naming problem, not classification evidence. A model
  // name borrowed from a parent such as "Frames" may be compacted or replaced,
  // but it must never promote the local classifier's type over the visual type.
  const resolvedType = options.lockType ? visualType : sourceSemanticType || visualType;
  const compactProposal = compactFamilyName(family, resolvedType, proposal, peerFamilies);
  if (compactProposal) return { name: compactProposal, type: resolvedType };
  if (!source) {
    return {
      name: opaqueProposal ? 'Unlabelled visual' : proposal,
      type: sourceSemanticType || visualType,
    };
  }
  const sourceType = semanticTypeFromSource(source) || sourceSemanticType;
  const words = source.split(/\s+/);
  const isCompoundIdentity = words.length > 1;
  if (!sourceType && !isCompoundIdentity) {
    return { name: opaqueProposal ? source : proposal, type: visualType };
  }
  let name = source.replace(/\s+\d+$/i, '').trim();
  if (sourceType) {
    const typeWords = readableSourceName(sourceType);
    const leading = new RegExp(`^${typeWords}s?\\s+(.+)$`, 'i').exec(name);
    if (leading) name = `${leading[1]} ${typeWords}`;
  }
  return { name: cleanText(name, proposedName), type: sourceType || visualType };
}

function roleForAssetType(type) {
  return TYPE_TO_ROLE[type] || (type === 'Unknown' ? 'Unknown' : 'ImageLabel');
}

function normalizeAnalysis(raw, family, peerFamilies = []) {
  const proposedType = ASSET_TYPES.includes(raw.assetType) ? raw.assetType : 'Unknown';
  const modelFamilyName = cleanText(raw.familyName, 'Unlabelled visual');
  const perimeterGeometry = hasContentRelativePerimeter(family);
  const geometryOverride = perimeterGeometry && BORDER_CONFLICT_TYPES.has(proposedType);
  const geometryLocksType = perimeterGeometry && (proposedType === 'Border' || geometryOverride);
  const localType = ASSET_TYPES.includes(family.reviewSignals?.localAssetType)
    ? family.reviewSignals.localAssetType
    : 'Unknown';
  const contextTypeOverride = !geometryLocksType
    && localType !== 'Unknown'
    && localType !== proposedType
    && proposalBorrowsHierarchyContext(family, modelFamilyName, peerFamilies);
  const visualType = geometryLocksType ? 'Border' : contextTypeOverride ? localType : proposedType;
  const identity = sourceIdentity(
    family,
    visualType,
    modelFamilyName,
    peerFamilies,
    { lockType: geometryLocksType },
  );
  const assetType = identity.type;
  const role = roleForAssetType(assetType);
  const normalizationReason = geometryOverride
    ? `Content-relative alpha topology identifies a hollow perimeter, so Kryeo normalized the model's ${proposedType} result to Border/ImageLabel.`
    : contextTypeOverride
      ? `The model proposal borrowed hierarchy-only context, so Kryeo preserved the local ${localType} classification.`
    : assetType !== proposedType
      ? `Kryeo preserved the explicit target layer type ${assetType} over the model's ${proposedType} proposal.`
      : '';
  const diveMode = DIVE_MODES.includes(raw.diveMode) ? raw.diveMode : 'keep-together';
  const names = new Map((Array.isArray(raw.memberNames) ? raw.memberNames : [])
    .map((member) => [String(member.visualHash || ''), cleanText(member.name, '')]));
  const evidence = {
    visual: confidenceScore(raw.evidence?.visual),
    layerName: confidenceScore(raw.evidence?.layerName),
    hierarchy: confidenceScore(raw.evidence?.hierarchy),
    learned: confidenceScore(raw.evidence?.learned),
  };
  const evidencePresent = Object.values(evidence).some((score) => score > 0);
  const compactPacket = raw.compactPacket === true;
  const confidence = compactPacket
    ? confidenceScore(raw.confidence || (booleanValue(raw.reviewNeeded) ? 0.58 : 0.86))
    : evidencePresent
      ? confidenceScore(raw.confidence)
      : Math.min(0.55, confidenceScore(raw.confidence));
  const conflict = booleanValue(raw.conflict) || geometryOverride;
  const modelReason = cleanText(
    raw.reason,
    compactPacket
      ? `The cloud reviewer visually classified this family as ${readableSourceName(proposedType).toLowerCase()}.`
      : 'The family needs user review.',
    400,
  );
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: identity.name,
    assetType,
    role,
    modelFamilyName,
    modelAssetType: proposedType,
    normalizationReason: normalizationReason || undefined,
    memberNames: family.members.map((member, index) => ({
      visualHash: member.visualHash,
      name: sourceIdentity(
        { ...family, members: [member] },
        assetType,
        names.get(member.visualHash) || identity.name || `Variant ${index + 1}`,
        peerFamilies,
        { lockType: geometryLocksType },
      ).name,
    })),
    diveMode,
    reason: normalizationReason ? `${normalizationReason} ${modelReason}` : modelReason,
    visualDescription: cleanText(raw.visualDescription, '', 500),
    confidence,
    ...(evidencePresent ? { evidence } : {}),
    conflict,
    conflictMessage: cleanText(
      raw.conflictMessage,
      geometryOverride ? `The model proposed ${proposedType}, but the rendered alpha topology is a hollow perimeter.` : '',
      300,
    ),
    reviewNeeded: Boolean(
      booleanValue(raw.reviewNeeded)
      || conflict
      || (!compactPacket && !evidencePresent)
      || confidence < 0.72
      || assetType === 'Unknown'
      || role === 'Unknown'
    ),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : []).slice(0, 3).map((item) => ({
      assetType: ASSET_TYPES.includes(item.assetType) ? item.assetType : 'Unknown',
      reason: cleanText(item.reason, 'Alternative interpretation.', 220),
    })),
  };
}

function familyCacheKey(fingerprint, contextSignature = '', model = MODEL) {
  return `${ANALYSIS_VERSION}:${model}:${fingerprint}:${contextSignature}`;
}

function sharedFamilyFingerprint(family) {
  const normalizeNames = (values) => [...new Set((values || [])
    .map((value) => readableSourceName(value).toLowerCase())
    .filter(Boolean))].sort();
  const semanticHierarchy = (family.hierarchyContext || []).flatMap((item) => [
    item.parentName,
    ...(item.ancestorNames || []).slice(0, 2),
    ...(item.childNames || []).slice(0, 6),
    ...(item.siblingNames || []).slice(0, 6),
  ]);
  return createHash('sha256').update(JSON.stringify({
    visuals: [...new Set((family.members || []).map((member) => member.visualHash).filter(Boolean))].sort(),
    sourceNames: normalizeNames((family.members || []).map((member) => member.name)),
    parents: normalizeNames(family.parentNames),
    hierarchy: normalizeNames(semanticHierarchy),
  })).digest('hex');
}

function sharedFamilyCacheKey(family, model = MODEL) {
  return `${ANALYSIS_VERSION}:${model}:shared:${sharedFamilyFingerprint(family)}`;
}

function sharedCacheEligible(payload) {
  const instructions = Array.isArray(payload.instructions)
    ? payload.instructions.map((item) => cleanText(item, '')).filter(Boolean)
    : [];
  return instructions.length === 0 && !payload.projectKnowledge;
}

function isVisionSafeDataUrl(value) {
  const match = String(value || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) return false;
  try {
    const png = Buffer.from(match[1], 'base64');
    if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') return false;
    return png.readUInt32BE(16) > 32 && png.readUInt32BE(20) > 32;
  } catch {
    return false;
  }
}

function selectVisionMembers(family, maxMemberImages = MAX_MEMBER_IMAGES_PER_FAMILY) {
  const members = Array.isArray(family.members) ? family.members : [];
  const imageLimit = Math.min(6, Math.max(1, Number(maxMemberImages || MAX_MEMBER_IMAGES_PER_FAMILY)));
  if (members.length <= imageLimit) {
    return members.map((member, index) => ({ member, index }));
  }
  if (imageLimit === 1) return [{ member: members[0], index: 0 }];
  const indexes = new Set([0, members.length - 1]);
  for (let slot = 1; slot < imageLimit - 1; slot += 1) {
    indexes.add(Math.round((slot * (members.length - 1)) / (imageLimit - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => ({ member: members[index], index }));
}

function compactHierarchyForPrompt(hierarchyContext = []) {
  return (Array.isArray(hierarchyContext) ? hierarchyContext : []).slice(0, 3).map((item) => ({
    parentName: item.parentName,
    ancestorNames: (item.ancestorNames || []).slice(0, 2),
    childNames: (item.childNames || []).slice(0, 6),
    siblingNames: (item.siblingNames || []).slice(0, 6),
  }));
}

function promptFamilyMetadata(family, familyIndex, compact) {
  return {
    familyId: compact ? `f${familyIndex + 1}` : family.id,
    familyIndex: familyIndex + 1,
    parentNames: (family.parentNames || []).slice(0, 4),
    hierarchyContext: compact
      ? compactHierarchyForPrompt(family.hierarchyContext)
      : family.hierarchyContext || [],
    reviewSignals: family.reviewSignals || null,
    exactInstanceCount: family.exactInstanceCount,
    members: (family.members || []).map((member, memberIndex) => ({
      imageLabel: `family-${familyIndex + 1}-member-${memberIndex + 1}`,
      visualHash: compact ? `m${memberIndex + 1}` : member.visualHash,
      layerName: member.name,
      affinityType: member.affinityType,
      ...(compact && memberIndex > 0
        ? {}
        : {
            bounds: member.bounds,
            childCount: member.childHierarchyKeys.length,
            visualMetrics: member.visualMetrics || null,
          }),
    })),
  };
}

function roundedMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function compactLiteFamilyMetadata(family, familyIndex) {
  const hierarchy = compactHierarchyForPrompt(family.hierarchyContext).slice(0, 2).map((item) => [
    item.parentName || '',
    item.ancestorNames || [],
    item.childNames || [],
    item.siblingNames || [],
  ]);
  const members = (family.members || []).slice(0, 6).map((member) => [
    member.name,
    member.affinityType,
    Math.round(Number(member.bounds?.width || 0)),
    Math.round(Number(member.bounds?.height || 0)),
    member.childHierarchyKeys?.length || 0,
    member.visualMetrics
      ? [
          roundedMetric(member.visualMetrics.visiblePixelRatio),
          roundedMetric(member.visualMetrics.opaquePixelRatio),
          roundedMetric(member.visualMetrics.edgeVisibleRatio),
          roundedMetric(member.visualMetrics.centerVisibleRatio),
          roundedMetric(member.visualMetrics.innerVisibleRatio),
          roundedMetric(member.visualMetrics.contentPerimeterVisibleRatio),
          roundedMetric(member.visualMetrics.contentPerimeterCoverage),
        ]
      : null,
  ]);
  return [
    `f${familyIndex + 1}`,
    (family.parentNames || []).slice(0, 3),
    members,
    hierarchy,
    Math.max(1, Number(family.exactInstanceCount || 1)),
  ];
}

function compactFamilyPrompt(families, context) {
  const contactSheetFamilyIds = Array.isArray(context.familyContactSheet?.familyIds)
    ? context.familyContactSheet.familyIds.slice(0, 16).map((familyId) => String(familyId || ''))
    : [];
  const mappings = families.flatMap((family, familyIndex) => {
    const cellIndex = contactSheetFamilyIds.indexOf(family.id);
    return cellIndex >= 0 ? [{ cell: cellIndex + 1, alias: `f${familyIndex + 1}` }] : [];
  });
  const useContactSheet = mappings.length >= 2 && isVisionSafeDataUrl(context.familyContactSheet?.previewUrl);
  const content = [{
    type: 'text',
    text: [
      'Metadata rows use [alias,parentNames,members,hierarchy,exactCopies].',
      'Member rows use [sourceName,AffinityType,width,height,childCount,[visibleAlpha,opaqueAlpha,canvasEdgeVisible,canvasCenterVisible,contentInnerVisible,contentPerimeterVisible,contentPerimeterCoverage]].',
      'Hierarchy fields are disambiguation context only, not naming text. Name each target family from its own visible artwork or source identity; never concatenate parent, ancestor, sibling, collection, or type labels.',
      'A GroupNode, child count, or Frame field is structural metadata, not a request to call the asset Container, Group, or Frame. A transparent decorative perimeter with a sparse centre is Border/ImageLabel, not Frame, unless it visibly acts as structural chrome for external UI content.',
      `F=${JSON.stringify(families.map(compactLiteFamilyMetadata))}`,
      ...(Array.isArray(context.instructions) && context.instructions.length
        ? [`User rules=${JSON.stringify(context.instructions.slice(0, 3)).slice(0, 300)}`]
        : []),
      ...(context.projectKnowledge
        ? [`Project context=${JSON.stringify(context.projectKnowledge).slice(0, 260)}`]
        : []),
    ].join('\n'),
  }];
  if (useContactSheet) {
    content.push({
      type: 'text',
      text: `Numbered contact sheet mapping: ${mappings.map((item) => `${item.cell}=${item.alias}`).join(', ')}.`,
    });
    content.push({ type: 'image_url', image_url: { url: context.familyContactSheet.previewUrl } });
  }
  families.forEach((family, familyIndex) => {
    const representative = family.members?.[0];
    if (useContactSheet && contactSheetFamilyIds.includes(family.id)) return;
    const previewUrl = representative?.hostedPreviewUrl || representative?.previewUrl;
    content.push({ type: 'text', text: `Preview f${familyIndex + 1}.` });
    if (isVisionSafeDataUrl(previewUrl)) content.push({ type: 'image_url', image_url: { url: previewUrl } });
    else content.push({ type: 'text', text: 'Preview unreadable; set u=1.' });
  });
  content.push({ type: 'text', text: `Return the compact packet for f1..f${families.length}.` });
  return content;
}

function familyPrompt(families, context = {}) {
  const compact = context.reviewTier === 'lite';
  if (compact) return compactFamilyPrompt(families, context);
  const contactSheetFamilyIds = Array.isArray(context.familyContactSheet?.familyIds)
    ? context.familyContactSheet.familyIds.slice(0, 8).map((familyId) => String(familyId || ''))
    : [];
  const contactSheetMappings = families.flatMap((family, familyIndex) => {
    const cellIndex = contactSheetFamilyIds.indexOf(family.id);
    return cellIndex >= 0 ? [{ cell: cellIndex + 1, familyAlias: `f${familyIndex + 1}`, familyId: family.id }] : [];
  });
  const useContactSheet = compact
    && contactSheetMappings.length >= 2
    && isVisionSafeDataUrl(context.familyContactSheet?.previewUrl);
  const documentFamilies = Array.isArray(context.documentFamilies) ? context.documentFamilies : [];
  const requestedIds = new Set(families.map((family) => family.id));
  const requestedIndexes = documentFamilies
    .map((family, index) => (requestedIds.has(family.familyId) ? index : -1))
    .filter((index) => index >= 0);
  const firstIndex = requestedIndexes.length ? Math.max(0, Math.min(...requestedIndexes) - 1) : 0;
  const lastIndex = requestedIndexes.length
    ? Math.min(documentFamilies.length, Math.max(...requestedIndexes) + 2)
    : Math.min(documentFamilies.length, 3);
  const localDocumentContext = documentFamilies.slice(firstIndex, lastIndex).map((family) => compact
    ? {
        order: family.order,
        parentNames: (family.parentNames || []).slice(0, 4),
        memberCount: Array.isArray(family.members) ? family.members.length : 0,
        exactInstanceCount: family.exactInstanceCount,
      }
    : family);
  const content = [{
    type: 'text',
    text: [
      ...(context.reviewTier === 'lite' || context.reviewTier === 'escalation'
        ? [
          'Classify each supplied visual family for a reusable UI asset library using the preview, layer metadata, and nearby hierarchy.',
          'Use visual evidence first. A meaningful human-authored layer name is supporting intent; generic names, hashes, numbers, and default names are not evidence.',
          'Preserve distinctive identity words from meaningful names while choosing the closest functional asset type from the allowed enum.',
          'A complete composed scene is Wallpaper; a foundational surface is Background; a perimeter is Border; a sparse transparent treatment is Overlay; reusable material is Texture; an item receptacle is Slot; structural framing is Frame.',
          'A GroupNode or child count is hierarchy metadata, not Frame evidence. When alpha metrics show a transparent centre and denser perimeter artwork, classify it as Border/ImageLabel unless the visible artwork clearly serves as a container for external UI content.',
          'Use ImageLabel for non-interactive artwork, an interactive role for controls, and Frame for structural containers. Use Unknown only when evidence is absent or unreadable.',
           'Keep related variants coherent, but do not copy a classification from a nearby family merely because colors or placement look similar.',
           'Return polished human-facing names. Never use family IDs, image labels, hashes, filenames, or bare generic type nouns as names when the preview supports a clearer identity.',
           'Keep reason and visualDescription concise: one short sentence each. Do not repeat the instructions or describe every layer.',
          `Allowed assetType values: ${ASSET_TYPES.join(', ')}.`,
          `Allowed role values: ${ROBLOX_ROLES.join(', ')}.`,
          compact
            ? 'Return one compact JSON object for every supplied family. Do not stop early: every f1..fN alias must appear exactly once.'
            : 'Return JSON only with one analysis for every supplied family, including confidence, evidence, conflict, and reviewNeeded fields.',
        ]
        : [
      'Analyse these related visual-asset families for a reusable UI asset library.',
      'Judge appearance together with hierarchy and sibling context. Do not trust bad layer names over clear visual evidence.',
      'Treat a meaningful source name as supporting evidence, but correct it when the artwork clearly shows a different function.',
      'A clear semantic word in a human-authored layer name (for example Slot, Border, Background, Button, or Wallpaper) is a strong statement of intent. Preserve it in both type and name unless the rendered artwork directly and unambiguously contradicts it. Generic names, hashes, numeric exports, and default layer names are not semantic evidence.',
      'Separate identity from classification. Preserve meaningful source nouns that identify the reusable asset, while using visual evidence to refine its functional assetType.',
      'Nearby hierarchy and scene context explain an assetÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s role, but ancestor, sibling, project, and scene names do not belong in the reusable asset name unless that identity is visibly intrinsic to the asset itself.',
      'When visual evidence changes only the functional type, retain the meaningful descriptive words from the source and replace only its type noun.',
      'Items inside one visual family are related variants and should normally share one coherent semantic type. Distinguish complete interactive components from their backgrounds, icons, borders, fills, textures, overlays, and effects.',
      'Visual similarity is supporting evidence only. Never copy a type or name from a nearby asset merely because the artwork has similar colors, proportions, ornamentation, or placement.',
      'Judge every supplied family as its own semantic asset. Closely related components and internal construction layers may still require different names and types.',
      'Use the document-family overview to keep siblings and nearby families coherent. Related construction pieces under one parent should use a shared naming root and compatible types unless their visible functions genuinely differ. Never repeat or stack type nouns in a generated name.',
      'When a parent and its children visibly form one designed motif, establish a distinctive visual identity for the parent and reuse that identity naturally for its backgrounds, borders, fills, and effects. Structural source names such as Middle, Outer Borders, Background, or Layer describe assembly roles and should not become the entire reusable identity.',
      'A Slot is a reusable cell or receptacle intended to hold an item, icon, or content. A Frame is structural framing or a complete window surround, not every square visual.',
      'Use Frame only when the artwork primarily encloses external content or structures a larger interface. A self-contained medallion, emblem, crest, seal, or decorative symbol should instead be judged as Badge, Icon, or Ornament according to its visible purpose, even when it has an outlined rim.',
      'A GroupNode or child count is source hierarchy, not proof of a runtime container. A transparent decorative rim with perimeter artwork is a Border/ImageLabel even when several child layers compose it; use Frame only when the artwork itself provides structural chrome for external UI content.',
      'Reserve Slot for a visibly reusable cell that receives selectable content. Classify passive construction and display elements by their own visible function rather than by nearby controls.',
      'A layer whose meaningful source name identifies it as a background is strong contextual evidence for Background when the visible artwork is an internal fill or foundational surface.',
      'A Wallpaper is complete composed scene artwork such as an environment, room, landscape, or illustrated location intended as a large backdrop. A Background is a foundational surface, panel, color field, or non-scene fill. Do not classify a detailed environment as Background merely because it is used behind UI.',
      'A full-canvas or large transparent layer is not automatically a Background. Use the visible alpha geometry: a thin perimeter is Border, a detailed composed environment is Wallpaper, a sparse treatment over another layer is Overlay, and a simple opaque surface is Background.',
      'A Texture is reusable surface material meant to fill or skin an object. An Overlay is a sparse or translucent treatment spanning other artwork. In exported previews, the checkerboard indicates transparent pixels and is not part of the asset.',
      'Use document stacking context: a canvas-sized transparent treatment composed with a nearby scene or background is an Overlay, while a Texture is a reusable material swatch independent of that composition.',
      'visualMetrics are measured from the exported PNG. Canvas edge/center values use the full PNG; content inner/perimeter values are relative to the occupied artwork bounds and therefore ignore transparent padding. Use content-relative topology for inset hollow borders rather than guessing transparency from the checkerboard preview.',
      'A Border encloses an area or forms part of its perimeter. An Ornament is a standalone decorative flourish. An FX asset is primarily light, glow, particles, or another effect.',
      'Corner and edge fragments are Border when their purpose is to assemble or imply an enclosing perimeter. Use Ornament only for a flourish independent of a perimeter.',
      'Use only the supplied assetType and role enums. Names must describe what is visibly present and must not repeat meaningless filenames.',
      'Inspect the visible shape, transparency, composition, scale, repeated pattern, and apparent UI function before choosing a type. Choose the closest allowed type rather than inventing a new category.',
      'Unknown is a last resort for a missing or genuinely unreadable preview. Do not use Unknown merely because the artwork is unusual or the source name is poor.',
      'Use enum values with the exact spelling and capitalization supplied below. Non-interactive raster artwork normally needs a visual Roblox role rather than Unknown.',
      'For non-interactive visible artwork such as icons, wallpapers, textures, overlays, borders, ornaments, and effects, use ImageLabel unless the hierarchy clearly establishes a different implementation role.',
      'familyName and every member name must be polished human-facing asset names based on the visible artwork.',
      'Give every visual family a distinctive shared identity based on its visible motif, material, shape, setting, or function. Do not settle for a generic adjective plus the type noun when the artwork supports a more specific identity.',
      'Never use a bare generic proposal such as Scene, Background, Frame, Border, Ornament, Badge, Icon, Wallpaper, Texture, Overlay, Visual, or Asset when the preview supports a more descriptive identity. Use visible setting, material, motif, or function words instead, such as Medieval Library Wallpaper or Crystal Badge.',
      'When a meaningful source name contains multiple semantic words, read the whole compound name and give the strongest functional noun its role. For example, a source like BackgroundOuterBorder describes a border, not a background, because Border is the specific perimeter function.',
      'When a group is composed of multiple reusable children of one type, name the group as a plural collection and give its children one singular shared root. Number distinct children in document order. Do not use directional or structural suffixes such as Top, Bottom, Corner, Middle, or Frame unless those distinctions represent user-facing variants rather than construction pieces.',
      'Normalize source words into readable display text by splitting camel case, Pascal case, underscores, hyphens, and clearly joined words.',
      'Never prepend an application, product, project, or brand name unless that identity is visibly present in the artwork or explicitly confirmed in the supplied instructions.',
      'Never use family IDs, image labels, hashes, numeric filenames, default layer names, or other opaque identifiers as an asset name.',
      'Exact duplicate instances reuse one name and one upload. Distinct siblings of the same functional type under one parent use a shared naming root numbered sequentially from 1 with no arbitrary upper limit. Keep a meaningful suffix only for a genuine state, direction, or effect such as Glow.',
      'Trailing digits in source layer names usually identify instances. Remove them from the polished family name unless they communicate a genuine visible state or ordered variant. Exact duplicates must never gain sequential numbers.',
      'Roblox role describes implementation behavior: interactive controls generally use an interactive role; non-interactive artwork generally uses ImageLabel; structural containers may use Frame.',
      'For group export, keep together when overlapping pieces form one motif; use children-only only for an organizational parent whose children are reusable and whose parent adds no standalone asset; use parent-and-children when the assembled parent and independent children are both useful exports. Mark reviewNeeded when hierarchy evidence is insufficient.',
      `Allowed assetType values: ${ASSET_TYPES.join(', ')}.`,
      `Allowed role values: ${ROBLOX_ROLES.join(', ')}.`,
      'Return JSON: {"families":[{"familyId","familyName","assetType","role","memberNames":[{"visualHash","name"}],"diveMode","reason","reviewNeeded","alternatives":[{"assetType","reason"}]}]}.',
      'For each family include visualDescription, confidence from 0 to 1, evidence scores for visual, layerName, hierarchy, and learned context, plus conflict and conflictMessage when evidence sources disagree.',
      ]),
      `Independent visual observations from pass one: ${JSON.stringify(context.descriptions || []).slice(0, context.reviewTier === 'lite' || context.reviewTier === 'escalation' ? 700 : 4200)}.`,
      `Confirmed user instructions: ${JSON.stringify((context.instructions || []).slice(0, context.reviewTier === 'lite' || context.reviewTier === 'escalation' ? 3 : 8)).slice(0, context.reviewTier === 'lite' || context.reviewTier === 'escalation' ? 400 : 900)}.`,
      `Project knowledge: ${JSON.stringify(context.projectKnowledge || null).slice(0, context.reviewTier === 'lite' || context.reviewTier === 'escalation' ? 400 : 700)}.`,
      `Nearby document families: ${JSON.stringify(localDocumentContext).slice(0, context.reviewTier === 'lite' || context.reviewTier === 'escalation' ? 1200 : 2800)}.`,
      'Families:',
       ...families.map((family, familyIndex) => JSON.stringify(promptFamilyMetadata(family, familyIndex, compact))),
    ].join('\n'),
  }];
  if (useContactSheet) {
    content.push({
      type: 'text',
      text: [
        'The next image is one numbered contact sheet containing representative family previews.',
        `Requested cell mapping: ${contactSheetMappings.map((mapping) => `cell ${mapping.cell} = ${mapping.familyAlias}`).join(', ')}.`,
        'The number is printed in the top-left of each cell. Classify only the requested aliases and ignore any other numbered cells.',
      ].join(' '),
    });
    content.push({ type: 'image_url', image_url: { url: context.familyContactSheet.previewUrl } });
  }
  for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) {
    const family = families[familyIndex];
    for (const { member, index: memberIndex } of selectVisionMembers(family, context.maxMemberImages)) {
      if (useContactSheet && memberIndex === 0 && contactSheetFamilyIds.includes(family.id)) continue;
      content.push({ type: 'text', text: `Image family-${familyIndex + 1}-member-${memberIndex + 1}` });
      const previewUrl = context.reviewTier === 'lite'
        ? (member.hostedPreviewUrl || member.previewUrl)
        : member.previewUrl;
      if (isVisionSafeDataUrl(previewUrl)) {
        content.push({ type: 'image_url', image_url: { url: previewUrl } });
      } else {
        content.push({ type: 'text', text: 'Preview omitted because this client supplied an unsupported image size.' });
      }
      const description = (context.descriptions || []).find((item) => item.familyId === family.id);
      const detailLimit = context.reviewTier === 'lite' ? 0 : description?.needsDetail ? 4 : 0;
      for (let detailIndex = 0; detailIndex < Math.min(member.analysisPreviewUrls?.length || 0, detailLimit); detailIndex += 1) {
        const detailUrl = member.analysisPreviewUrls[detailIndex];
        if (!isVisionSafeDataUrl(detailUrl)) continue;
        content.push({
          type: 'text',
          text: `Detail crop ${detailIndex + 1} for family-${familyIndex + 1}-member-${memberIndex + 1}. Use it to identify artwork that is tiny inside unusually large layer bounds.`,
        });
        content.push({ type: 'image_url', image_url: { url: detailUrl } });
      }
    }
  }
  const needsCompositeContext = families.some((family) => family.members.some((member) => (
    Number(member.bounds?.width || 0) >= 900 && Number(member.bounds?.height || 0) >= 600
  )));
  if (context.includeDocumentContext && needsCompositeContext && isVisionSafeDataUrl(context.documentPreviewUrl)) {
    content.push({
      type: 'text',
      text: 'Document composite context. Use this only to understand how the isolated family is layered and used in the finished composition.',
    });
    content.push({ type: 'image_url', image_url: { url: context.documentPreviewUrl } });
  }
  content.push({
    type: 'text',
    text: [
      'Now make the semantic asset decision for every supplied family.',
      'Do not return bounding boxes, coordinates, image detections, captions, markdown, or prose outside the JSON.',
      compact
        ? 'Return exactly {"f":[{"id":"f1","n":"distinctive asset name","t":"assetType","r":"role","d":"keep-together","q":"short reason","v":"short visual description","c":0.9,"e":[0.9,0.2,0.8,0],"x":false,"rv":false,"m":[["m1","member name"]]}]}. Keys: id family alias; n name; t type; r role; d dive mode; q reason; v visual description; c confidence; e scores [visual,layerName,hierarchy,learned]; x conflict; rv review needed; m optional member aliases and names. Omit m when all members use n. Return every requested f alias exactly once.'
        : 'Return exactly this JSON shape: {"families":[{"familyId","familyName","assetType","role","memberNames":[{"visualHash","name"}],"diveMode","reason","visualDescription","confidence","evidence":{"visual","layerName","hierarchy","learned"},"conflict","conflictMessage","reviewNeeded","alternatives":[{"assetType","reason"}]}]}.',
      `assetType must be exactly one of: ${ASSET_TYPES.join(', ')}. role must be exactly one of: ${ROBLOX_ROLES.join(', ')}.`,
      'Use Unknown only if the preview is absent or unreadable. Never use an image label such as family-1, Picture 1, or an opaque source identifier as a name.',
       compact
         ? 'For Lite review, copy the short family and member keys exactly; the gateway maps them back to the source document. Base names and types on the visible artwork, document context, and distinctions above.'
         : 'Copy each supplied familyId and visualHash exactly. Base names and types on the visible artwork, document context, and distinctions above.',
    ].join(' '),
  });
  return content;
}

async function describeFamilyBatch(families, context, signal) {
  const content = [{
    type: 'text',
    text: [
      'Pass one is observation only. Describe visible composition, transparency, shape, repeated structure, likely interaction affordance, and relationship between parent and children.',
      'Do not choose an asset type or polished name yet. Do not use source names as visual facts.',
      'Mark needsDetail only when the overview is genuinely insufficient and detailed crops could resolve the ambiguity.',
      `Document families: ${JSON.stringify(context.documentFamilies || []).slice(0, 3000)}.`,
      'Return {"observations":[{"familyId":"...","description":"...","visibleFunctions":["..."],"ambiguities":["..."],"needsDetail":true|false}]}.',
    ].join('\n'),
  }];
  for (const family of families) {
    content.push({ type: 'text', text: `Observe family ${family.id}. Parent context: ${JSON.stringify(family.parentNames)}.` });
    const representative = family.members[0];
    if (representative && isVisionSafeDataUrl(representative.previewUrl)) {
      content.push({ type: 'image_url', image_url: { url: representative.previewUrl } });
    }
  }
  const output = await callModel([
    { role: 'system', content: 'You are a neutral visual observer. Separate observation from interpretation and return JSON only.' },
    { role: 'user', content },
  ], Math.max(650, families.length * 260), 'none', signal);
  const observations = Array.isArray(output.observations) ? output.observations : [];
  return families.map((family) => {
    const observation = observations.find((item) => String(item.familyId || '') === family.id) || {};
    return {
      familyId: family.id,
      description: cleanText(observation.description, 'The overview did not provide a reliable visual description.', 500),
      visibleFunctions: Array.isArray(observation.visibleFunctions) ? observation.visibleFunctions.slice(0, 8).map((item) => cleanText(item, '', 100)).filter(Boolean) : [],
      ambiguities: Array.isArray(observation.ambiguities) ? observation.ambiguities.slice(0, 6).map((item) => cleanText(item, '', 120)).filter(Boolean) : [],
      needsDetail: Boolean(observation.needsDetail),
    };
  });
}

function composePacketName(root, suffix, assetType) {
  const base = cleanText(root, '', 120);
  const tail = cleanText(suffix, '', 60);
  if (tail && base && tail.toLowerCase().startsWith(base.toLowerCase())) return tail;
  const joined = cleanText([base, tail].filter(Boolean).join(' '), '', 160);
  return joined || `Unlabelled ${readableSourceName(assetType || 'visual').toLowerCase()}`;
}

function decodeCompactPacket(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const roots = Array.isArray(output.r) ? output.r : Array.isArray(output.roots) ? output.roots : [];
  const rows = Array.isArray(output.f) ? output.f : [];
  return rows.flatMap((row) => {
    if (Array.isArray(row)) {
      const [familyId, rootReference, assetType, completeName, uncertainty, diveCode] = row;
      const root = Number.isInteger(Number(rootReference)) && String(rootReference).trim() !== ''
        ? roots[Number(rootReference)]
        : rootReference;
      const uncertain = uncertainty === 1 || String(uncertainty).toLowerCase() === 'true';
      return [{
        familyId,
        familyName: cleanText(completeName, '', 160) || composePacketName(root, '', assetType),
        assetType,
        diveMode: Number(diveCode) === 1
          ? 'children-only'
          : Number(diveCode) === 2
            ? 'parent-and-children'
            : 'keep-together',
        reason: uncertain
          ? 'The cloud reviewer completed the visual classification but marked the evidence as uncertain.'
          : `The cloud reviewer visually classified this family as ${readableSourceName(assetType).toLowerCase()}.`,
        confidence: uncertain ? 0.58 : 0.86,
        conflict: false,
        reviewNeeded: uncertain,
        alternatives: [],
        compactPacket: true,
      }];
    }
    if (!row || typeof row !== 'object') return [];
    return [{ ...expandCompactAnalysis(row), compactPacket: true }];
  });
}

function expandCompactAnalysis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const evidenceValue = raw.evidence ?? raw.e;
  const evidence = Array.isArray(evidenceValue)
    ? {
        visual: evidenceValue[0],
        layerName: evidenceValue[1],
        hierarchy: evidenceValue[2],
        learned: evidenceValue[3],
      }
    : evidenceValue && typeof evidenceValue === 'object'
      ? {
          visual: evidenceValue.visual ?? evidenceValue.v,
          layerName: evidenceValue.layerName ?? evidenceValue.n,
          hierarchy: evidenceValue.hierarchy ?? evidenceValue.h,
          learned: evidenceValue.learned ?? evidenceValue.l,
        }
      : undefined;
  const memberSource = Array.isArray(raw.memberNames) ? raw.memberNames : raw.m;
  const memberNames = Array.isArray(memberSource)
    ? memberSource.map((member) => (Array.isArray(member)
      ? { visualHash: member[0], name: member[1] }
      : {
          visualHash: member?.visualHash ?? member?.id ?? member?.h,
          name: member?.name ?? member?.n,
        }))
    : undefined;
  const alternativeSource = Array.isArray(raw.alternatives) ? raw.alternatives : raw.a;
  const alternatives = Array.isArray(alternativeSource)
    ? alternativeSource.map((item) => (Array.isArray(item)
      ? { assetType: item[0], reason: item[1] }
      : { assetType: item?.assetType ?? item?.t, reason: item?.reason ?? item?.q }))
    : undefined;
  return {
    familyId: raw.familyId ?? raw.id,
    familyName: raw.familyName ?? raw.name ?? raw.n,
    assetType: raw.assetType ?? raw.type ?? raw.t,
    role: raw.role ?? raw.r,
    memberNames,
    diveMode: raw.diveMode ?? raw.d,
    reason: raw.reason ?? raw.why ?? raw.q,
    visualDescription: raw.visualDescription ?? raw.v,
    confidence: raw.confidence ?? raw.c,
    evidence,
    conflict: raw.conflict ?? raw.x,
    conflictMessage: raw.conflictMessage ?? raw.xm,
    reviewNeeded: raw.reviewNeeded ?? raw.rv,
    alternatives,
  };
}

function hasCoreFamilyAnalysis(raw) {
  return Boolean(
    cleanText(raw?.familyName, '', 160)
    && ASSET_TYPES.includes(raw?.assetType),
  );
}

function partialFallbackAnalysis(output, family) {
  const expanded = expandCompactAnalysis(output) || {};
  const localType = ASSET_TYPES.includes(family.reviewSignals?.localAssetType)
    ? family.reviewSignals.localAssetType
    : 'Unknown';
  const modelType = ASSET_TYPES.includes(expanded.assetType) ? expanded.assetType : undefined;
  const assetType = modelType || localType;
  const evidenceSource = expanded.evidence && typeof expanded.evidence === 'object'
    ? expanded.evidence
    : output;
  const outputName = cleanText(expanded.familyName, '', 160);
  const sourceName = family.members
    .map((member) => meaningfulSourceName(member.name))
    .find((name) => name && !isStructuralIdentity(name));
  const fallbackName = outputName || sourceName || 'Unlabelled visual';
  const evidenceText = [
    ['Visual', evidenceSource?.visual],
    ['Layer name', evidenceSource?.layerName],
    ['Hierarchy', evidenceSource?.hierarchy],
    ['Learned context', evidenceSource?.learned],
  ]
    .map(([label, value]) => {
      const text = cleanText(value, '', 160);
      return text ? `${label}: ${text}` : '';
    })
    .filter(Boolean)
    .join(' ');
  const fallbackFamily = {
    ...family,
    // A partial provider response must not promote a source label into visual
    // truth. This result is retained only as an explicitly review-needed fallback.
    members: family.members.map((member) => ({ ...member, name: '' })),
  };
  return normalizeAnalysis({
    familyId: family.id,
    familyName: fallbackName,
    assetType,
    role: roleForAssetType(assetType),
    memberNames: family.members.map((member) => ({
      visualHash: member.visualHash,
      name: outputName || fallbackName,
    })),
    diveMode: expanded.diveMode || 'keep-together',
    reason: `The hosted response supplied partial evidence but remained incomplete after schema repair; the available result is retained for review.${evidenceText ? ` ${evidenceText}` : ''}`,
    visualDescription: cleanText(expanded.visualDescription || output?.visual, '', 500),
    confidence: confidenceScore(expanded.confidence),
    evidence: {
      visual: confidenceScore(evidenceSource?.visual),
      layerName: confidenceScore(evidenceSource?.layerName),
      hierarchy: confidenceScore(evidenceSource?.hierarchy),
      learned: confidenceScore(evidenceSource?.learned),
    },
    conflict: true,
    conflictMessage: 'The hosted response did not include a complete visual-family schema.',
    reviewNeeded: true,
    alternatives: [],
  }, fallbackFamily);
}

async function classifyFamilyBatch(families, context, descriptions, signal, model = MODEL) {
  const maxOutputTokens = context.reviewTier === 'lite'
    ? Math.max(192, Math.min(720, 80 + families.length * 40))
    : Math.max(800, Math.min(2200, families.length * 300));
  let completion;
  try {
    completion = await callModelWithUsage([
      cacheableSystemMessage(context.reviewTier === 'lite'
        ? LITE_CLASSIFICATION_SYSTEM
        : 'You are Kryeo visual intelligence. Observe each asset before deciding its name and type, compare related UI assets jointly, and return only schema-valid JSON.'),
      { role: 'user', content: familyPrompt(families, { ...context, descriptions }) },
    ], maxOutputTokens, 'none', signal, model, context.sessionId, context.serviceTier);
  } catch (error) {
    settleScanBudget(context.hostedScanId, error?.modelUsage);
    throw error;
  }
  settleScanBudget(context.hostedScanId, completion.usage);
  const output = completion.output;
  const rawFamilies = context.reviewTier === 'lite' ? decodeCompactPacket(output) : [];
  const visited = new Set();
  const collect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4 || visited.has(value)) return;
    visited.add(value);
    const expanded = expandCompactAnalysis(value);
    if (
      !Array.isArray(value)
      && expanded?.familyId
      && (expanded.familyName || expanded.assetType || Array.isArray(expanded.memberNames))
    ) {
      rawFamilies.push(expanded);
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) collect(child, depth + 1);
  };
  if (!rawFamilies.length) collect(output);
  const partialFamilyKeys = [
    'name', 'familyName', 'assetType', 'type', 'role', 'reason', 'why', 'visualDescription',
    'confidence', 'evidence', 'visual', 'layerName', 'hierarchy', 'learned', 'conflict',
    'conflictMessage', 'reviewNeeded', 'n', 't', 'r', 'q', 'v', 'c', 'e', 'x', 'rv', 'm',
  ];
  const isPartialFamilyResponse = Boolean(
    output
    && typeof output === 'object'
    && !Array.isArray(output)
    && partialFamilyKeys.some((key) => Object.prototype.hasOwnProperty.call(output, key)),
  );
  if (!rawFamilies.length && families.length === 1 && isPartialFamilyResponse) {
    rawFamilies.push({ ...expandCompactAnalysis(output), familyId: families[0].id });
  }
  if (!rawFamilies.length) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, 'last-unrecognized-model-output.json'),
      JSON.stringify(output, null, 2),
      'utf8',
    );
    throw new IncompleteFamilyBatchError(
      'The model returned JSON without a visual-family analysis.',
      [],
      families,
    );
  }
  const compact = context.reviewTier === 'lite';
  const restoredFamilies = compact
    ? rawFamilies.map((item) => {
        const family = families.find((candidate, index) => (
          String(item.familyId || '') === `f${index + 1}`
          || String(item.familyId || '') === candidate.id
        ));
        if (!family) return item;
        const memberByAlias = new Map(family.members.map((member, index) => [`m${index + 1}`, member.visualHash]));
        return {
          ...item,
          familyId: family.id,
          memberNames: Array.isArray(item.memberNames)
            ? item.memberNames.map((member) => ({
                ...member,
                visualHash: memberByAlias.get(String(member.visualHash || '')) || member.visualHash,
              }))
            : item.memberNames,
        };
      })
    : rawFamilies;
  const rawById = new Map(restoredFamilies.map((item) => [String(item.familyId || ''), item]));
  if (families.length === 1 && restoredFamilies.length === 1) rawById.set(families[0].id, restoredFamilies[0]);
  if (families.length > 1 && restoredFamilies.length === families.length) {
    families.forEach((family, index) => {
      if (!rawById.has(family.id)) rawById.set(family.id, restoredFamilies[index]);
    });
  }
  const missing = families.filter((family) => !hasCoreFamilyAnalysis(rawById.get(family.id)));
  const complete = families
    .filter((family) => !missing.includes(family))
    .map((family) => normalizeAnalysis({
      ...(rawById.get(family.id) || {}),
      visualDescription: rawById.get(family.id)?.visualDescription
        || descriptions.find((item) => item.familyId === family.id)?.description,
    }, family, families));
  if (missing.length) {
    throw new IncompleteFamilyBatchError(
      `The model omitted or incompletely described ${missing.length} requested visual ${missing.length === 1 ? 'family' : 'families'}.`,
      complete,
      missing,
      families.length === 1 && isPartialFamilyResponse
        ? [partialFallbackAnalysis(output, families[0])]
        : [],
    );
  }
  return complete;
}

async function analyzeFamilyBatch(families, context, signal, model = MODEL) {
  // The classification prompt already observes each supplied image before deciding.
  // Keeping the normal path to one multimodal call avoids doubling latency without
  // improving the final schema result.
  return classifyFamilyBatch(families, context, [], signal, model);
}

function isRetryableModelError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Model server error (408|425|429|5\d\d)\b|did not answer within|fetch failed|network|timed out/i.test(message);
}

async function analyzeFamilyBatchWithRetry(families, context, signal, model = MODEL) {
  let transientAttempt = 0;
  while (true) {
    try {
      return await analyzeFamilyBatch(families, context, signal, model);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof IncompleteFamilyBatchError && families.length === 1) {
        if (error.fallbackResults.length) return error.fallbackResults;
        throw error;
      }
      if (!isRetryableModelError(error) || transientAttempt >= MAX_MODEL_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** transientAttempt)));
      transientAttempt += 1;
    }
  }
}

function isTransientCacheReplaceError(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

async function replaceCacheFile(temporary) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rename(temporary, CACHE_PATH);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientCacheReplaceError(error) || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  // Windows can briefly hold the old cache file after a read or antivirus
  // inspection. The cache is derived data, so a replace-after-remove fallback
  // is preferable to failing an otherwise valid paid analysis request.
  if (isTransientCacheReplaceError(lastError)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.rm(CACHE_PATH, { force: true });
        await fs.rename(temporary, CACHE_PATH);
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientCacheReplaceError(error) || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function persistCache() {
  if (!cacheDirty) return cacheWrite;
  cacheDirty = false;
  cacheWrite = cacheWrite
    .catch((error) => {
      process.stderr.write(`Kryeo AI cache write recovered: ${error instanceof Error ? error.message : String(error)}\n`);
    })
    .then(async () => {
      const serializable = Object.fromEntries(familyCache);
      await fs.mkdir(DATA_DIR, { recursive: true });
      const temporary = `${CACHE_PATH}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(serializable), 'utf8');
        await replaceCacheFile(temporary);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
    });
  try {
    await cacheWrite;
  } catch (error) {
    // Cached results are a latency optimisation, never a reason to reject a
    // completed provider response. The next queued update retries the full
    // in-memory snapshot after any temporary filesystem failure.
    process.stderr.write(`Kryeo AI cache write deferred: ${error instanceof Error ? error.message : String(error)}\n`);
    cacheDirty = true;
  }
}

async function analyzeFamilies(payload, signal) {
  const families = Array.isArray(payload.families) ? payload.families : [];
  if (!families.length) throw new Error('No unresolved visual families were supplied.');
  const requestId = randomUUID();
  const reviewTier = payload.reviewTier === 'escalation' ? 'escalation' : 'lite';
  const model = modelForTier(reviewTier);
  const analyses = [];
  let unresolved = [];
  const failures = [];
  const recovery = {
    batchAttempts: 0,
    partialBatchResponses: 0,
    fullBatchFailures: 0,
    batchRecoveries: 0,
    recoveryFamilies: 0,
    singleFamilyRecoveryAttempts: 0,
    singleFamilyRecoveries: 0,
    singleFamilyFailures: 0,
  };
  let cached = 0;
  const requestedMaxMemberImages = Math.min(
    MAX_MEMBER_IMAGES_PER_FAMILY,
    Math.max(1, Number(payload.maxMemberImages || (
      payload.reviewTier ? (reviewTier === 'escalation' ? 2 : 1) : MAX_MEMBER_IMAGES_PER_FAMILY
    ))),
  );
  const requestedDocumentContext = Boolean(payload.includeDocumentContext) && reviewTier === 'escalation';
  const documentContextSignature = requestedDocumentContext
    ? createHash('sha256')
      .update(String(payload.documentSessionUuid || ''))
      .update(String(payload.documentPreviewUrl || ''))
      .digest('hex')
      .slice(0, 16)
    : '';
  const sharedContext = JSON.stringify({
    instructions: Array.isArray(payload.instructions) ? payload.instructions.slice(0, 30) : [],
    projectKnowledge: payload.projectKnowledge || null,
    reviewTier,
    requestedMaxMemberImages,
    requestedDocumentContext,
    documentContextSignature,
  });
  // A shared result is deliberately Lite-only. Escalation receives richer
  // member/document evidence, so falling back to a cross-document Lite cache
  // can silently discard the very context that justified escalation.
  const allowSharedCache = reviewTier === 'lite' && sharedCacheEligible(payload);
  for (const family of families) {
    const contextSignature = createHash('sha256')
      .update(sharedContext)
      .update(JSON.stringify(family.hierarchyContext || []))
      .digest('hex')
      .slice(0, 16);
    family.cacheContextSignature = contextSignature;
    const primaryKey = familyCacheKey(String(family.fingerprint || ''), contextSignature, model);
    let record = familyCache.get(primaryKey);
    if (record) usageTotals.contextCacheHits += 1;
    if (!record && allowSharedCache) {
      record = familyCache.get(sharedFamilyCacheKey(family, model));
      if (record) usageTotals.sharedCacheHits += 1;
    }
    if (record) {
      analyses.push(normalizeAnalysis(record, family, families));
      cached += 1;
    } else {
      unresolved.push(family);
    }
  }
  const budgetSelection = reserveFamiliesWithinBudget(unresolved, reviewTier, {
    ...payload,
    maxMemberImages: requestedMaxMemberImages,
    includeDocumentContext: requestedDocumentContext,
  }, requestId);
  unresolved = budgetSelection.allowed;
  const analysisContext = {
    instructions: Array.isArray(payload.instructions) ? payload.instructions.slice(0, 30) : [],
    projectKnowledge: payload.projectKnowledge || null,
    documentPreviewUrl: payload.documentPreviewUrl || '',
    familyContactSheet: payload.familyContactSheet && typeof payload.familyContactSheet === 'object'
      ? {
          previewUrl: String(payload.familyContactSheet.previewUrl || ''),
          familyIds: Array.isArray(payload.familyContactSheet.familyIds)
            ? payload.familyContactSheet.familyIds.slice(0, 16).map((familyId) => String(familyId || ''))
            : [],
        }
      : null,
    sessionId: `kryeo-${createHash('sha256')
      .update(String(payload.hostedScanId || requestId))
      .digest('hex')
      .slice(0, 32)}`,
    hostedScanId: String(payload.hostedScanId || requestId),
    reviewTier,
    serviceTier: ['default', 'flex', 'priority', 'scale'].includes(String(payload.serviceTier || '').toLowerCase())
      ? String(payload.serviceTier).toLowerCase()
      : OPENROUTER_SERVICE_TIER,
    maxMemberImages: budgetSelection.maxMemberImages,
    includeDocumentContext: budgetSelection.includeDocumentContext,
    documentFamilies: families.map((family, familyIndex) => ({
      familyId: family.id,
      order: familyIndex + 1,
      parentNames: family.parentNames,
      exactInstanceCount: family.exactInstanceCount,
      members: family.members.map((member) => ({
        layerName: member.name,
        affinityType: member.affinityType,
        bounds: member.bounds,
        childCount: member.childHierarchyKeys.length,
        visualMetrics: member.visualMetrics || null,
      })),
    })),
  };
  const storeResults = async (results, sourceFamilies) => {
    if (!results.length) return;
    for (const result of results) {
      analyses.push(result);
      const family = sourceFamilies.find((item) => item.id === result.familyId);
      storeCachedResult(familyCacheKey(result.fingerprint, family?.cacheContextSignature || '', model), result);
      if (family && allowSharedCache && !result.reviewNeeded && result.assetType !== 'Unknown') {
        storeCachedResult(sharedFamilyCacheKey(family, model), result);
      }
    }
    await persistCache();
  };
  const recoverFamiliesIndividually = async (sourceFamilies, sourceError) => {
    if (!sourceFamilies.length) return;
    const budget = scanBudget(payload.hostedScanId, requestId);
    const estimatedSingleRepairUsd = estimatedFamilyCost(
      reviewTier,
      budgetSelection.maxMemberImages,
      budgetSelection.includeDocumentContext,
    ).rawUsd * 1.5;
    let locallyReservedUsd = 0;
    const attempted = [];
    for (const family of sourceFamilies) {
      const withinCeiling = !ENFORCE_SCAN_BUDGET
        || budget.providerUsd + locallyReservedUsd + estimatedSingleRepairUsd <= SCAN_BUDGET_USD;
      if (!withinCeiling) {
        recovery.singleFamilyFailures += 1;
        failures.push({
          familyIds: [family.id],
          message: `The $${SCAN_BUDGET_USD.toFixed(3)} cloud safety ceiling left no room for a final single-family repair.`,
        });
        continue;
      }
      attempted.push(family);
      locallyReservedUsd += estimatedSingleRepairUsd;
    }
    recovery.singleFamilyRecoveryAttempts += attempted.length;
    const outcomes = await Promise.all(attempted.map(async (family) => {
      try {
        const results = await analyzeFamilyBatchWithRetry([family], analysisContext, signal, model);
        await storeResults(results, [family]);
        recovery.singleFamilyRecoveries += 1;
        return null;
      } catch (error) {
        if (error instanceof IncompleteFamilyBatchError && error.partialResults.length) {
          await storeResults(error.partialResults, [family]);
          if (error.partialResults.some((result) => result.familyId === family.id)) {
            recovery.singleFamilyRecoveries += 1;
            return null;
          }
        }
        recovery.singleFamilyFailures += 1;
        return {
          familyIds: [family.id],
          message: error instanceof Error
            ? error.message
            : sourceError instanceof Error
              ? sourceError.message
              : String(error || sourceError),
        };
      }
    }));
    failures.push(...outcomes.filter(Boolean));
  };
  for (let index = 0; index < unresolved.length; index += FAMILY_BATCH_SIZE) {
    const batch = unresolved.slice(index, index + FAMILY_BATCH_SIZE);
    recovery.batchAttempts += 1;
    try {
      await storeResults(await analyzeFamilyBatchWithRetry(batch, analysisContext, signal, model), batch);
    } catch (error) {
      let recoveryFamilies = batch;
      if (error instanceof IncompleteFamilyBatchError) {
        recovery.partialBatchResponses += 1;
        await storeResults(error.partialResults, batch);
        recoveryFamilies = error.missingFamilies;
      } else {
        recovery.fullBatchFailures += 1;
      }
      if (signal?.aborted) {
        failures.push({
          familyIds: recoveryFamilies.map((family) => family.id),
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      let finalRecoveryFamilies = recoveryFamilies;
      let finalRecoveryError = error;
      if (batch.length > 1) {
        recovery.batchRecoveries += 1;
        recovery.recoveryFamilies += recoveryFamilies.length;
        try {
          await storeResults(
            await analyzeFamilyBatchWithRetry(recoveryFamilies, analysisContext, signal, model),
            recoveryFamilies,
          );
          continue;
        } catch (recoveryError) {
          finalRecoveryError = recoveryError;
          if (recoveryError instanceof IncompleteFamilyBatchError) {
            recovery.partialBatchResponses += 1;
            await storeResults(recoveryError.partialResults, recoveryFamilies);
            finalRecoveryFamilies = recoveryError.missingFamilies;
          }
        }
      }
      await recoverFamiliesIndividually(finalRecoveryFamilies, finalRecoveryError);
    }
  }
  for (const analysis of analyses) {
    if (analysis.memberNames.length > 1) {
      const memberNames = new Set(analysis.memberNames.map((member) => member.name.toLocaleLowerCase()));
      if (memberNames.size === 1) {
        analysis.memberNames = analysis.memberNames.map((member, index) => ({
          ...member,
          name: `${analysis.familyName} ${index + 1}`,
        }));
      }
    }
  }
  for (const analysis of analyses) {
    const family = families.find((item) => item.id === analysis.familyId);
    const primaryKey = familyCacheKey(analysis.fingerprint, family?.cacheContextSignature || '', model);
    if (!familyCache.has(primaryKey)) storeCachedResult(primaryKey, analysis);
    if (family && allowSharedCache && !analysis.reviewNeeded && analysis.assetType !== 'Unknown') {
      const sharedKey = sharedFamilyCacheKey(family, model);
      if (!familyCache.has(sharedKey)) storeCachedResult(sharedKey, analysis);
    }
  }
  await persistCache();
  const finalBudget = scanBudget(payload.hostedScanId, requestId);
  return {
    requestId,
    cached,
    analyses,
    failures,
    model,
    reviewTier,
    skippedFamilyIds: budgetSelection.skippedFamilyIds.filter(Boolean),
    budgetLimited: budgetSelection.budgetLimited,
    estimatedCostUsd: budgetSelection.estimatedCostUsd,
    scanProviderCostUsd: finalBudget.providerUsd,
    scanCommittedCostUsd: Math.max(finalBudget.providerUsd, finalBudget.estimatedUsd),
    scanProviderRequests: finalBudget.providerRequests,
    recovery,
    usage: usageReport(),
  };
}

function explanationCacheKey(payload) {
  const signature = createHash('sha256').update(JSON.stringify({
    visualHash: String(payload.visualHash || ''),
    familyFingerprint: String(payload.familyFingerprint || ''),
    familyName: cleanText(payload.familyName, '').toLowerCase(),
    assetType: ASSET_TYPES.includes(payload.assetType) ? payload.assetType : 'Unknown',
    sourceName: readableSourceName(payload.sourceName).toLowerCase(),
    parentName: readableSourceName(payload.parentName).toLowerCase(),
    childNames: (Array.isArray(payload.childNames) ? payload.childNames : []).map((item) => readableSourceName(item).toLowerCase()),
    siblingNames: (Array.isArray(payload.siblingNames) ? payload.siblingNames : []).map((item) => readableSourceName(item).toLowerCase()),
  })).digest('hex');
  return `${EXPLANATION_VERSION}:${MODEL_LITE}:${signature}`;
}

async function explainFamily(payload, signal) {
  const previewUrl = String(payload.previewUrl || '');
  if (!isVisionSafeDataUrl(previewUrl)) throw new Error('A readable family preview is required for hosted evidence.');
  const cacheKey = explanationCacheKey(payload);
  const cached = familyCache.get(cacheKey);
  if (cached) {
    usageTotals.explanationCacheHits += 1;
    return { ...cached, cached: true };
  }
  const assetType = ASSET_TYPES.includes(payload.assetType) ? payload.assetType : 'Unknown';
  const content = [
    {
      type: 'text',
      text: JSON.stringify({
        chosenName: cleanText(payload.familyName, 'Unlabelled visual'),
        chosenType: assetType,
        sourceName: cleanText(payload.sourceName, ''),
        affinityType: cleanText(payload.affinityType, ''),
        bounds: payload.bounds || null,
        visualMetrics: payload.visualMetrics || null,
        parentName: cleanText(payload.parentName, ''),
        childNames: (Array.isArray(payload.childNames) ? payload.childNames : []).slice(0, 8),
        siblingNames: (Array.isArray(payload.siblingNames) ? payload.siblingNames : []).slice(0, 8),
      }),
    },
    { type: 'image_url', image_url: { url: previewUrl } },
  ];
  const output = await callModel([
    cacheableSystemMessage(EVIDENCE_SYSTEM),
    { role: 'user', content },
  ], 360, 'none', signal, MODEL_LITE, '', OPENROUTER_SERVICE_TIER);
  const evidenceValue = output?.evidence ?? output?.e;
  const evidence = Array.isArray(evidenceValue)
    ? {
        visual: confidenceScore(evidenceValue[0]),
        layerName: confidenceScore(evidenceValue[1]),
        hierarchy: confidenceScore(evidenceValue[2]),
        learned: confidenceScore(evidenceValue[3]),
      }
    : {
        visual: confidenceScore(evidenceValue?.visual),
        layerName: confidenceScore(evidenceValue?.layerName),
        hierarchy: confidenceScore(evidenceValue?.hierarchy),
        learned: confidenceScore(evidenceValue?.learned),
  };
  const alternativeSource = Array.isArray(output?.alternatives) ? output.alternatives : output?.a;
  const suggestedTypeValue = output?.suggestedType ?? output?.st;
  const suggestedRoleValue = output?.suggestedRole ?? output?.sr;
  const suggestedType = ASSET_TYPES.includes(suggestedTypeValue) ? suggestedTypeValue : undefined;
  const suggestedRole = ROBLOX_ROLES.includes(suggestedRoleValue)
    ? suggestedRoleValue
    : suggestedType
      ? roleForAssetType(suggestedType)
      : undefined;
  const suggestedName = cleanText(output?.suggestedName ?? output?.sn, '', 160) || undefined;
  const explicitConflict = booleanValue(output?.conflict ?? output?.x);
  const classificationChanged = Boolean(
    (suggestedType && suggestedType !== assetType)
    || (suggestedRole && suggestedRole !== payload.role),
  );
  const conflict = explicitConflict || classificationChanged;
  const supportsClassification = output?.supportsClassification !== undefined || output?.ok !== undefined
    ? booleanValue(output?.supportsClassification ?? output?.ok) && !conflict
    : !conflict;
  const result = {
    reason: cleanText(output?.reason ?? output?.q, `The cloud reviewer classified the visible family as ${readableSourceName(assetType).toLowerCase()}.`, 300),
    visualDescription: cleanText(output?.visualDescription ?? output?.v, 'The supplied preview was reviewed visually.', 300),
    confidence: confidenceScore(output?.confidence ?? output?.c),
    evidence,
    conflict,
    conflictMessage: cleanText(
      output?.conflictMessage ?? output?.xm,
      classificationChanged
        ? `Independent review suggests ${suggestedType || assetType}/${suggestedRole || payload.role} instead.`
        : '',
      240,
    ),
    supportsClassification,
    suggestedName,
    suggestedType,
    suggestedRole,
    alternatives: (Array.isArray(alternativeSource) ? alternativeSource : []).slice(0, 3).flatMap((item) => {
      const candidateType = Array.isArray(item) ? item[0] : item?.assetType ?? item?.t;
      const reason = Array.isArray(item) ? item[1] : item?.reason ?? item?.q;
      return ASSET_TYPES.includes(candidateType)
        ? [{ assetType: candidateType, reason: cleanText(reason, 'Alternative visual interpretation.', 180) }]
        : [];
    }),
  };
  storeCachedResult(cacheKey, result);
  await persistCache();
  return { ...result, cached: false };
}

async function reconcileDocument(payload) {
  const analyses = Array.isArray(payload.analyses) ? payload.analyses : [];
  if (!analyses.length) return { summary: 'No new analyses required reconciliation.', issues: [] };
  const families = Array.isArray(payload.families) ? payload.families : [];
  const familyOrder = new Map(families.map((family, index) => [family.familyId, Number(family.order || index + 1)]));
  const ordered = [...analyses].sort((left, right) => (
    (familyOrder.get(left.familyId) || Number.MAX_SAFE_INTEGER)
    - (familyOrder.get(right.familyId) || Number.MAX_SAFE_INTEGER)
  ));
  const compactAnalysis = (analysis) => ({
    familyId: analysis.familyId,
    familyName: analysis.familyName,
    assetType: analysis.assetType,
    role: analysis.role,
    memberNames: analysis.memberNames,
    reason: cleanText(analysis.reason, '', 220),
    visualDescription: cleanText(analysis.visualDescription, '', 300),
  });
  const issuesByFamily = new Map();
  for (let start = 0; start < ordered.length; start += 8) {
    const focus = ordered.slice(start, start + 8);
    const context = ordered.slice(Math.max(0, start - 2), Math.min(ordered.length, start + 10));
    const contextIds = new Set(context.map((analysis) => analysis.familyId));
    const localFamilies = families.filter((family) => contextIds.has(family.familyId));
    const output = await callModel([
      {
        role: 'system',
        content: [
          'You reconcile preliminary multimodal classifications across one ordered neighborhood of a UI document.',
          'Use hierarchy, sibling order, bounds, source names, and preliminary visual reasons to correct contradictions.',
          'Do not add application, product, project, or brand names unless the supplied evidence explicitly establishes that identity.',
          'A complete composed scene such as an environment, room, landscape, or illustrated location is Wallpaper. Background is a foundational surface, panel, color field, or non-scene fill. A transparent treatment above artwork is Overlay.',
          'A canvas-sized transparent or sparse treatment composed with a nearby scene/background is Overlay, not Texture. Texture is reusable surface material independent of a particular composition.',
          'A reusable item receptacle is Slot. Structural framing is Frame. Perimeter artwork and perimeter fragments are Border.',
          'Frame means artwork whose primary purpose is to enclose external content or structure a larger interface. A self-contained medallion, emblem, crest, seal, or decorative symbol is Badge, Icon, or Ornament according to its visible purpose, even if it has an outlined rim.',
          'A GroupNode and child count are source hierarchy, not Frame evidence. Preserve a transparent decorative perimeter as Border/ImageLabel unless the visible artwork itself acts as a container for external UI content.',
          'Do not propagate Slot across nearby or visually similar assets. Internal backgrounds, fixed holders, emblems, frames, and panels retain their own semantic function.',
          'Corner and edge fragments that assemble or imply one enclosing family remain Border, not Ornament.',
          'Sibling variants with one parent and one semantic type use a shared root numbered in document order. Preserve a suffix only for a genuine state, direction, or effect.',
          'Use ImageLabel for non-interactive visual artwork unless the evidence establishes an interactive or structural role. Unknown requires absent or unreadable evidence.',
          'Return corrections only for the requested focus family IDs. Return JSON only.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Project: ${cleanText(payload.project, 'General')}\nDocument: ${cleanText(payload.documentTitle, 'Untitled')}\nFocus family IDs: ${JSON.stringify(focus.map((analysis) => analysis.familyId))}\nNeighborhood hierarchy: ${JSON.stringify(localFamilies)}\nPreliminary analyses: ${JSON.stringify(context.map(compactAnalysis))}\nReturn {"summary":"...","issues":[{"familyId":"...","message":"...","suggestedType":"optional","suggestedRole":"optional","suggestedName":"optional"}]}. Include every focus family whose final type, role, or name should change.`,
      },
  ], 800);
    for (const issue of Array.isArray(output.issues) ? output.issues : []) {
      const familyId = String(issue.familyId || '');
      if (!focus.some((analysis) => analysis.familyId === familyId)) continue;
      issuesByFamily.set(familyId, issue);
    }
  }
  return {
    summary: `Document consistency checked across ${Math.ceil(ordered.length / 8)} local family neighborhoods.`,
    issues: [...issuesByFamily.values()].slice(0, 48).map((issue) => ({
      familyId: String(issue.familyId || ''),
      message: cleanText(issue.message, 'Review this family.', 300),
      ...(ASSET_TYPES.includes(issue.suggestedType) ? { suggestedType: issue.suggestedType } : {}),
      ...(ROBLOX_ROLES.includes(issue.suggestedRole) ? { suggestedRole: issue.suggestedRole } : {}),
      ...(issue.suggestedName ? { suggestedName: cleanText(issue.suggestedName, '', 160) } : {}),
    })).filter((issue) => issue.familyId),
  };
}

function actionType(value) {
  return ['open-component-scan', 'review-assets', 'open-workflows'].includes(value) ? value : '';
}

async function chat(payload) {
  const request = payload.request || {};
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 6) : [];
  const system = [
    'You are Kryeo, a warm and capable multimodal assistant for Affinity asset production and Roblox UI delivery.',
    'Use supplied project context and images. Never claim to see information that was not supplied.',
    'Propose reviewed Kryeo actions; never claim an action was executed.',
    'When the user teaches a durable project rule, return it in memories.',
    'Keep normal replies concise and natural.',
    'Return JSON: {"text":"...","memories":[{"kind":"instruction|naming|hierarchy|classification","text":"..."}],"actions":[{"type":"open-component-scan|review-assets|open-workflows","label":"...","description":"..."}],"visionUsed":true|false}.',
  ].join('\n');
  const context = {
    project: request.project,
    document: request.document,
    memories: payload.memories || [],
    projectKnowledge: payload.projectKnowledge || null,
    manifests: payload.manifests || [],
  };
  const userContent = [
    { type: 'text', text: `Context: ${JSON.stringify(context)}\nUser message: ${String(request.message || '')}` },
    ...images.flatMap((image) => [
      { type: 'text', text: `Visual context: ${cleanText(image.label, 'document image')}` },
      { type: 'image_url', image_url: { url: image.dataUrl } },
    ]),
  ];
  const recent = (Array.isArray(payload.recentMessages) ? payload.recentMessages : []).slice(-10)
    .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.text || '') }));
  const output = await callModel([
    { role: 'system', content: system },
    ...recent,
    { role: 'user', content: userContent },
  ], 1000);
  const now = new Date().toISOString();
  return {
    text: cleanText(output.text, 'I could not form a reliable response from the current context.', 1800),
    memories: (Array.isArray(output.memories) ? output.memories : []).slice(0, 4).map((memory) => ({
      id: randomUUID(),
      project: cleanText(request.project, 'General', 100),
      scope: 'project',
      kind: ['instruction', 'naming', 'hierarchy', 'classification'].includes(memory.kind) ? memory.kind : 'instruction',
      text: cleanText(memory.text, '', 500),
      documentTitle: cleanText(request.document?.title, '', 160) || undefined,
      createdAt: now,
    })).filter((memory) => memory.text),
    actions: (Array.isArray(output.actions) ? output.actions : []).slice(0, 3).map((action) => ({
      id: randomUUID(),
      type: actionType(action.type),
      label: cleanText(action.label, 'Review next step', 80),
      description: cleanText(action.description, 'Open the relevant Kryeo workspace.', 180),
    })).filter((action) => action.type),
    visionUsed: Boolean(images.length && output.visionUsed !== false),
  };
}

async function loadCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
    const entries = Object.entries(parsed);
    const retained = entries.slice(-MAX_CACHE_ENTRIES);
    for (const [key, value] of retained) familyCache.set(key, value);
    if (retained.length < entries.length) {
      cacheEvictions += entries.length - retained.length;
      cacheDirty = true;
      await persistCache();
    }
  } catch {
    // The cache is optional and contains no source images.
  }
}

await loadCache();

const server = http.createServer(async (request, response) => {
  try {
    if (!authenticated(request)) return json(response, 401, { error: 'Invalid Kryeo AI token.' });

    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, {
        available: true,
        configured: true,
        endpoint: `http://${HOST}:${PORT}`,
        model: MODEL,
        modelLite: MODEL_LITE,
        modelEscalation: MODEL_ESCALATION,
        provider: IS_OPENROUTER ? 'openrouter' : IS_META_MODEL_API ? 'meta-model-api' : 'openai-compatible',
        providerSort: OPENROUTER_PROVIDER_SORT,
        serviceTier: IS_OPENROUTER ? OPENROUTER_SERVICE_TIER : 'default',
        responseCacheEnabled: OPENROUTER_RESPONSE_CACHE,
        promptCacheEnabled: IS_OPENROUTER && OPENROUTER_PROMPT_CACHE,
        analysisVersion: ANALYSIS_VERSION,
        cacheEntries: familyCache.size,
        maxCacheEntries: MAX_CACHE_ENTRIES,
        cacheEvictions,
        modelApiKeyConfigured: Boolean(MODEL_API_KEY),
        queueDepth: modelQueue.depth,
        modelActive: modelQueue.active,
        modelQueued: modelQueue.queued,
        modelConcurrency: MODEL_CONCURRENCY,
        familyBatchSize: FAMILY_BATCH_SIZE,
        maxMemberImagesPerFamily: MAX_MEMBER_IMAGES_PER_FAMILY,
        scanTargetUsd: SCAN_TARGET_USD,
        scanBudgetUsd: SCAN_BUDGET_USD,
        scanBudgetEnforced: ENFORCE_SCAN_BUDGET,
        maxHostedFamiliesPerScan: MAX_HOSTED_FAMILIES_PER_SCAN,
        maxEscalationFamiliesPerScan: MAX_ESCALATION_FAMILIES_PER_SCAN,
        estimatedInputTokensPerImage: ESTIMATED_INPUT_TOKENS_PER_IMAGE,
        estimatedTextTokensPerFamily: ESTIMATED_TEXT_TOKENS_PER_FAMILY,
        estimatedOutputTokensPerFamily: ESTIMATED_OUTPUT_TOKENS_PER_FAMILY,
        liteInputPricePerMillion: LITE_INPUT_PRICE_PER_MILLION,
        liteOutputPricePerMillion: LITE_OUTPUT_PRICE_PER_MILLION,
        escalationInputPricePerMillion: ESCALATION_INPUT_PRICE_PER_MILLION,
        escalationOutputPricePerMillion: ESCALATION_OUTPUT_PRICE_PER_MILLION,
        costEstimateSafetyFactor: COST_ESTIMATE_SAFETY_FACTOR,
        maxModelRetries: MAX_MODEL_RETRIES,
        usage: usageReport(),
        activeRequests: totalInflightRequests(),
        maxInflightPerToken: MAX_INFLIGHT_PER_TOKEN,
        message: 'Kryeo AI is ready.',
      });
    }
    if (!withinRateLimit(request)) return json(response, 429, { error: 'Rate limit reached. Try again shortly.' });
    const releaseRequestSlot = request.method === 'POST' ? acquireRequestSlot(request) : null;
    try {
      const payload = await readJson(request);
      const requestController = new AbortController();
      request.once('aborted', () => requestController.abort());
      response.once('close', () => {
        if (!response.writableEnded) requestController.abort();
      });
      if (request.method === 'POST' && request.url === '/v1/families/analyze') {
        return json(response, 200, await analyzeFamilies(payload, requestController.signal));
      }
      if (request.method === 'POST' && request.url === '/v1/families/explain') {
        return json(response, 200, await explainFamily(payload, requestController.signal));
      }
      if (request.method === 'POST' && request.url === '/v1/documents/reconcile') {
        return json(response, 200, await reconcileDocument(payload));
      }
      if (request.method === 'POST' && request.url === '/v1/chat') {
        return json(response, 200, await chat(payload));
      }
      return json(response, 404, { error: 'Route not found.' });
    } finally {
      releaseRequestSlot?.();
    }
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return json(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Kryeo AI listening on http://${HOST}:${PORT} using ${MODEL}\n`);
  if (!TOKENS.length) process.stdout.write('Authentication is disabled for loopback development only.\n');
});
