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
// The stronger visual model is reserved for a genuine independent challenge.
// Primary scans always use the fast visual model; an escalation tier only adds
// richer image/context payloads so one uncertain family does not silently
// switch the entire primary decision authority.
const MODEL_ESCALATION = process.env.KRYEO_AI_MODEL_ESCALATION || 'qwen/qwen3.7-flash';
const MODEL = MODEL_LITE;
const MODEL_BASE_URL = String(process.env.KRYEO_MODEL_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL_API_KEY = process.env.KRYEO_MODEL_API_KEY || '';
const IS_OPENROUTER = /(^|\/)openrouter\.ai\//i.test(MODEL_BASE_URL);
const IS_META_MODEL_API = /(^|\/\/)api\.meta\.ai(?:\/|$)/i.test(MODEL_BASE_URL);
const IS_OPENCODE_ZEN = /(^|\/\/)opencode\.ai\/zen\/v1(?:\/|$)/i.test(MODEL_BASE_URL);
const MODEL_TRANSPORT = ['chat-completions', 'responses'].includes(String(process.env.KRYEO_MODEL_TRANSPORT || '').trim())
  ? String(process.env.KRYEO_MODEL_TRANSPORT).trim()
  : IS_OPENCODE_ZEN
    ? 'responses'
    : 'chat-completions';
const RESPONSES_REASONING_EFFORT = ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(
  String(process.env.KRYEO_AI_RESPONSES_REASONING_EFFORT || '').trim().toLowerCase(),
)
  ? String(process.env.KRYEO_AI_RESPONSES_REASONING_EFFORT).trim().toLowerCase()
  : 'minimal';
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
// A bounded batch keeps one document-aware request compact enough for a
// reliable complete packet, while still giving the model all peer visuals at
// once. Each family retains its own labelled preview so small transparent UI
// artwork is never shrunk into a shared image.
const FAMILY_BATCH_SIZE = Math.min(16, Math.max(1, Number(process.env.KRYEO_AI_FAMILY_BATCH_SIZE || 8)));
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
function nonnegativeEnvironmentNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
const LITE_INPUT_PRICE_PER_MILLION = nonnegativeEnvironmentNumber('KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION', 0.03);
const LITE_OUTPUT_PRICE_PER_MILLION = nonnegativeEnvironmentNumber('KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION', 0.13);
const ESCALATION_INPUT_PRICE_PER_MILLION = nonnegativeEnvironmentNumber('KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION', 0.104);
const ESCALATION_OUTPUT_PRICE_PER_MILLION = nonnegativeEnvironmentNumber('KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION', 0.416);
// Reserve enough room for one compact batch repair and provider-side token
// accounting variance. This is deliberately conservative because the budget is
// a spending ceiling, not a post-hoc estimate.
const COST_ESTIMATE_SAFETY_FACTOR = Math.max(1, Number(process.env.KRYEO_AI_COST_ESTIMATE_SAFETY_FACTOR || 2));
// A scan should keep making progress when one provider request stalls. One
// bounded batch retry is enough for transient transport failures; turning a
// batch failure into a fan-out of single-family calls caused the old timeout
// and rate-limit cascades.
const MODEL_TIMEOUT_MS = Math.min(45_000, Math.max(10_000, Number(process.env.KRYEO_AI_MODEL_TIMEOUT_MS || 35_000)));
const MAX_MODEL_RETRIES = Math.max(0, Math.min(1, Number(process.env.KRYEO_AI_MAX_MODEL_RETRIES || 0)));
const MODEL_CONCURRENCY = Math.max(1, Number(process.env.KRYEO_AI_MODEL_CONCURRENCY || 2));
const MAX_INFLIGHT_PER_TOKEN = Math.max(1, Number(process.env.KRYEO_AI_MAX_INFLIGHT_PER_TOKEN || MODEL_CONCURRENCY));
const ANALYSIS_VERSION = 'family-v70';
const EXPLANATION_VERSION = 'family-explanation-v13';

const ASSET_TYPES = [
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor',
  'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
];
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
  'Use the image as primary evidence. Meaningful human-authored layer names are supporting intent only; hashes, filenames, numbers, and default layer names are not evidence. Never let a source label replace what is visibly present.',
  'Ground every word in the name and reason in an observable visual fact. Never invent a setting, vehicle, story, material, colour adjective, or function that is not plainly visible in the supplied preview or neutral observation. When identity is genuinely unreadable, set u=1 rather than making it sound specific.',
  'Choose the closest allowed type. Complete illustrated scenes are Wallpaper; foundational surfaces are Background; perimeters are Border; sparse transparent treatments are Overlay; reusable material is Texture; discrete content receptacles are Slot; compact markers/counters are Badge; compact symbols are Icon; decorative motifs are Ornament; large structural enclosures are Frame; light/glow/particles are FX.',
  'Wallpaper requires a dense, complete illustrated or photographic scene across most of the canvas. A sparse grid, guide, checker, or transparent layout treatment is not a Wallpaper; classify its visible function and mark uncertainty when that function is unclear.',
  'Hierarchy metadata is context only. Name the supplied family itself; never concatenate parent, ancestor, sibling, collection, or group labels into a reusable name. The final name must include the exact selected asset type once as its terminal semantic noun, before only an ordinal or genuine state; never place the type first and never include a compound subtype that implies another enum.',
  'A GroupNode or structural Frame is implementation metadata, not permission to append Container, Group, Frame, or similar words. Use such a word only when the visible artwork itself is that object.',
  'A GroupNode, child count, or square outline never establishes Frame by itself. A transparent decorative rim with an empty centre and visible perimeter artwork is Border with an ImageLabel role; use Frame only for artwork that visibly functions as structural chrome around external UI content.',
  'Do not borrow distinctive words from parent, ancestor, child, or sibling names. A name word is valid only when supported by the target family source identity or visible artwork.',
  'Return one complete human-facing name based on the visible asset. Source labels may support a visually credible name but must not become the name by themselves. Do not use IDs, hashes, filenames, or bare generic type nouns when the artwork supports a clearer identity.',
  'Keep related construction siblings coherent within this one complete decision: use one short shared visual root and ordinal names in document order when the individual pieces are not directionally distinct. Do not invent colour, material, density, complexity, or style adjectives merely to make siblings different. Prefer a concise 2â€“4 word identity over a descriptive caption.',
  'u is 1 only when the image is unreadable or meaningful evidence genuinely conflicts; otherwise 0. d is 0 keep-together, 1 children-only, or 2 parent-and-children.',
  'For d: use 0 when overlapping pieces form one motif; use 1 only for an organizational parent whose children are reusable and whose parent adds no standalone asset; use 2 when both the assembled parent and independent children are useful exports. When hierarchy evidence is weak, use 0 and set u to 1.',
  `Allowed t values: ${ASSET_TYPES.join(', ')}.`,
  'Return valid JSON only: {"f":[{"id":"f1","n":"complete display name","t":"assetType","r":"role","d":0,"q":"short reason","v":"short visual description","c":0.9,"e":[0.9,0.2,0.8,0],"rv":false,"a":[["alternativeType","short reason"]],"m":[["m1","member name"]]}]}. Include a only when another reading is genuinely plausible. Return every requested alias exactly once.',
].join('\n');

const DECISION_CONTRACT = [
  'You are Kryeo visual intelligence. Return one atomic decision for every requested export scope; never skip an alias. Return valid JSON only.',
  'Evidence order: target preview and alpha topology first; supporting child previews second; hierarchy and meaningful source labels only as confidence context. Names, hashes, filenames, and group labels never decide the answer on their own.',
  'The scope has already been structurally planned. Do not turn a construction child, parent label, or adjacent sibling into the target asset. Decide only the shown export owner.',
  'Return type, Roblox role, name, grouping, confidence, reason, and alternative together. Do not patch one field from another. Use Unknown only when the target preview is absent or unreadable; otherwise choose the closest allowed type and set uncertainty when the reading is genuinely ambiguous.',
  'When review context is supplied, return the final replacement packet itself rather than criticism of the current packet. Set conflict only if no complete final packet is defensible.',
  'Use a short, factual human name grounded in visible artwork. It must contain the selected type exactly once as the final semantic noun, followed only by an ordinal or real visual state. Never invent story, setting, material, colour, product, or function details.',
  'A filled foundation is Background; a complete illustrated scene is Wallpaper; a reusable material surface is Texture; a sparse treatment is Overlay; a perimeter is Border; a self-contained decorative mark is Ornament or Badge; an item receptacle is Slot; a structural enclosure for external content is Frame. GroupNode is not Frame evidence.',
  'For d, copy the supplied plannedGrouping exactly: 0 keeps a composed parent together, 1 exposes child assets from an organizational parent, and 2 exports both. If the structural plan seems ambiguous, set reviewNeeded and explain it; never silently rewrite its boundary.',
  `Allowed types: ${ASSET_TYPES.join(', ')}. Allowed roles: ${ROBLOX_ROLES.join(', ')}.`,
].join('\n');

// The primary lane deliberately uses this smaller, fully atomic wire format.
// It keeps every family decision within one response without asking a fast
// vision model to choose between this schema and the richer reviewer schema.
const COMPACT_DECISION_CONTRACT = [
  'You are Kryeo visual intelligence. Make one complete visual decision for every requested family alias. Return JSON only and never skip an alias.',
  'Use the target preview as primary evidence. Hierarchy and meaningful source labels only adjust confidence; they never become a naming template. Do not invent a story, setting, material, colour, or function that is not visibly supported.',
  'Name, type, Roblox role, and planned grouping are one decision. The name must contain the selected type exactly once as its final semantic noun, followed only by a real state or document-order ordinal.',
  'A perimeter is Border; a foundational surface is Background; a scene is Wallpaper; a reusable material surface is Texture; a sparse treatment is Overlay; an item receptacle is Slot; Frame requires visible structural chrome for external content. GroupNode is not Frame evidence.',
  'Return exactly {"f":[["f1",0,"assetType","complete name",0,0,"role"]]}. Every row is [alias,unused,type,name,uncertain(0|1),plannedGrouping(0 keep-together|1 children-only|2 parent-and-children),role]. Return every requested alias exactly once and no prose.',
  `Allowed types: ${ASSET_TYPES.join(', ')}. Allowed roles: ${ROBLOX_ROLES.join(', ')}.`,
].join('\n');

const EVIDENCE_SYSTEM = [
  'You independently audit one existing Kryeo visual classification on demand.',
  'Inspect the supplied image and metadata without assuming the chosen name or type is correct. Explain support when it is correct; when it is wrong, mark a conflict and return the better allowed type, role, and name. If the preview is tiny, unreadable, nearly invisible, or not a functional instance of the chosen type, set ok=false and x=true; do not report high confidence for that chosen type.',
  'A transparent or visibly empty perimeter is Border/ImageLabel, not Frame, Badge, or Slot. A compact Badge is a self-contained filled marker; a Slot visibly receives selectable content; a Background is a foundational surface or fill rather than a surrounding rim. A GroupNode, parent name, child count, or category label is context only and never proves a runtime type.',
  'When rejecting or renaming a decision, return one complete replacement: type, Roblox role, and a concise name that includes the exact replacement type once as its terminal semantic noun, before only an ordinal or genuine state. Never return criticism or a renamed proposal without the complete replacement.',
  'If a compatible meaningful source identity is clearer than speculative visual adjectives, retain that identity. Source text supports confidence but never overrides contrary visible evidence.',
  'For anonymous construction siblings, use the supplied sibling ordinal and peer decisions to return one concise shared root followed by the final type and document-order number. Do not invent a different style adjective for every piece.',
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

function decisionNameTypeWords(value) {
  const normalized = readableSourceName(value).toLowerCase();
  return ASSET_TYPES
    .filter((type) => type !== 'Unknown')
    .flatMap((type) => {
      const phrase = readableSourceName(type).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [...normalized.matchAll(new RegExp(`\\b${phrase}s?\\b`, 'g'))]
        .map((match) => ({ type, index: match.index || 0, length: match[0].length }));
    })
    .sort((left, right) => left.index - right.index || right.type.length - left.type.length);
}

function isCompleteDecisionName(value, assetType) {
  const name = cleanText(value, '', 160);
  if (!name || !ASSET_TYPES.includes(assetType) || assetType === 'Unknown') return false;
  const matches = decisionNameTypeWords(name);
  const selectedMatches = matches.filter((match) => match.type === assetType);
  if (selectedMatches.length !== 1 || !matches.every((match) => match.type === assetType)) return false;
  const selected = selectedMatches[0];
  const normalized = readableSourceName(name).toLowerCase();
  const prefix = normalized.slice(0, selected.index).trim();
  const suffix = normalized.slice(selected.index + selected.length).trim();
  const allowedSuffixes = new Set(['hover', 'pressed', 'disabled', 'active', 'selected', 'focused', 'default', 'empty', 'filled', 'glow']);
  return Boolean(prefix)
    && (!suffix || suffix.split(/\s+/).every((word) => /^\d+$/.test(word) || allowedSuffixes.has(word)));
}

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
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(
        new Error(`Request body exceeded the ${Math.round(MAX_BODY_BYTES / (1024 * 1024))} MB gateway limit.`),
        { statusCode: 413 },
      );
    }
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
  return MODEL_LITE;
}

function pricingForTier(reviewTier) {
  return reviewTier === 'escalation'
    ? { input: ESCALATION_INPUT_PRICE_PER_MILLION, output: ESCALATION_OUTPUT_PRICE_PER_MILLION }
    : { input: LITE_INPUT_PRICE_PER_MILLION, output: LITE_OUTPUT_PRICE_PER_MILLION };
}

function estimatedFamilyCost(reviewTier, maxMemberImages, includeDocumentContext, imageCountOverride) {
  // Review tier controls image/context fidelity for a primary decision, not
  // which model owns it. Primary decisions always use MODEL_LITE; the stronger
  // model is reserved for the independent reviewer endpoint.
  const pricing = pricingForTier('lite');
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
  const promptTokens = nonnegativeNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = nonnegativeNumber(usage.completion_tokens ?? usage.output_tokens);
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

function toResponsesInput(messages) {
  return messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : [{ type: 'text', text: String(message?.content || '') }];
    return {
      // The Responses API uses developer instructions where Chat Completions
      // uses system messages. Keep user image input as native input_image.
      role: message?.role === 'system' ? 'developer' : message?.role || 'user',
      content: content.map((part) => {
        if (part?.type === 'image_url') {
          return { type: 'input_image', image_url: String(part.image_url?.url || part.url || '') };
        }
        return { type: 'input_text', text: String(part?.text || '') };
      }).filter((part) => (part.type === 'input_image' ? Boolean(part.image_url) : Boolean(part.text))),
    };
  });
}

function responseOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = Array.isArray(response?.output)
    ? response.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    : [];
  return parts
    .filter((part) => part?.type === 'output_text' || typeof part?.text === 'string')
    .map((part) => String(part.text || ''))
    .join('\n');
}

async function executeModelCall(messages, maxTokens, reasoningEffort, externalSignal, model, sessionId, serviceTier) {
  return modelQueue.run(async () => {
    if ((IS_OPENROUTER || IS_META_MODEL_API || IS_OPENCODE_ZEN) && !MODEL_API_KEY) {
      const provider = IS_OPENCODE_ZEN ? 'OpenCode Zen' : IS_META_MODEL_API ? 'the Meta Model API' : 'OpenRouter';
      throw new Error(`KRYEO_MODEL_API_KEY is required when using ${provider}.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    const startedAt = Date.now();
    let attempts = 0;
    let requestBytes = 0;
    let responseBytes = 0;
    let providerRequestId = '';
    const httpStatuses = [];
    const providerTelemetry = (parsed = false, error = '') => ({
      requestId: providerRequestId || undefined,
      model,
      transport: MODEL_TRANSPORT,
      attempts,
      httpStatuses,
      requestBytes,
      responseBytes,
      durationMs: Date.now() - startedAt,
      parsed,
      ...(error ? { error: String(error).slice(0, 500) } : {}),
    });
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    try {
      const chatCompletionRequest = {
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
      const modelRequest = MODEL_TRANSPORT === 'responses'
        ? {
            model,
            input: toResponsesInput(messages),
            temperature: 0.1,
            top_p: 0.9,
            max_output_tokens: maxTokens,
            // Responses models can consume the compact JSON allowance on hidden
            // reasoning, so keep reasoning bounded and reserve output headroom.
            reasoning: { effort: RESPONSES_REASONING_EFFORT },
            text: { format: { type: 'json_object' } },
          }
        : chatCompletionRequest;
      const requestCompletion = async (body) => {
        attempts += 1;
        requestBytes += Buffer.byteLength(JSON.stringify(body), 'utf8');
        const response = await fetch(`${MODEL_BASE_URL}/${MODEL_TRANSPORT === 'responses' ? 'responses' : 'chat/completions'}`, {
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
        const text = await response.text();
        httpStatuses.push(response.status);
        responseBytes += Buffer.byteLength(text, 'utf8');
        return { response, text };
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
      providerRequestId = String(parsed?.id || parsed?.response_id || '');
      const usage = recordModelUsage(parsed, model);
      try {
        return {
          output: parseModelJson(MODEL_TRANSPORT === 'responses'
            ? responseOutputText(parsed)
            : parsed.choices?.[0]?.message?.content),
          usage,
          telemetry: providerTelemetry(true),
        };
      } catch (error) {
        error.modelUsage = usage;
        error.providerTelemetry = providerTelemetry(false, error);
        throw error;
      }
    } catch (error) {
      if (error && typeof error === 'object') error.providerTelemetry = providerTelemetry(false, error);
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`The model did not answer within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds.`);
        timeoutError.providerTelemetry = providerTelemetry(false, timeoutError);
        throw timeoutError;
      }
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

function isSelfContradictoryCloudAssessment(reason, evidence, confidence) {
  const strongestEvidence = Math.max(0, ...Object.values(evidence || {}).map((value) => confidenceScore(value)));
  const describesArtifact = /\b(?:tiny|nearly\s+invisible|negligible\s+(?:visible|visual)|artifact|unreadable|not\s+(?:a\s+)?functional|no\s+(?:reliable|visible)\s+(?:visual|evidence))\b/i.test(String(reason || ''));
  return confidence >= 0.72 && strongestEvidence < 0.12 && describesArtifact;
}

function roleForAssetType(type) {
  return TYPE_TO_ROLE[type] || (type === 'Unknown' ? 'Unknown' : 'ImageLabel');
}

function normalizeDiveMode(value) {
  if (DIVE_MODES.includes(value)) return value;
  if (Number(value) === 0) return 'keep-together';
  if (Number(value) === 1) return 'children-only';
  if (Number(value) === 2) return 'parent-and-children';
  return undefined;
}

function normalizeAnalysis(raw, family, peerFamilies = []) {
  const proposedType = ASSET_TYPES.includes(raw.assetType) ? raw.assetType : 'Unknown';
  const modelFamilyName = cleanText(raw.familyName, 'Unlabelled visual');
  // The cloud decision is atomic. Geometry is supplied as visual evidence to
  // both passes; it must not locally rewrite one field after the model returns.
  const assetType = proposedType;
  // A packet is atomic: do not silently derive a missing Roblox role from the
  // proposed type. The model must return name, type, role, and grouping as one
  // usable decision or the scope remains unresolved for review.
  const role = ROBLOX_ROLES.includes(raw.role) ? raw.role : 'Unknown';
  const validName = isCompleteDecisionName(modelFamilyName, assetType);
  const normalizationReason = '';
  const suppliedDiveMode = normalizeDiveMode(raw.diveMode);
  const diveMode = suppliedDiveMode || family.structuralDiveMode || 'keep-together';
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
  const hasCompactConfidence = raw.confidence !== undefined
    && raw.confidence !== null
    && raw.confidence !== '';
  const reportedConfidence = compactPacket
    ? hasCompactConfidence
      ? confidenceScore(raw.confidence)
      : (booleanValue(raw.reviewNeeded) ? 0.58 : 0.86)
    : evidencePresent
      ? confidenceScore(raw.confidence)
      : Math.min(0.55, confidenceScore(raw.confidence));
  const modelReason = cleanText(
    raw.reason,
    compactPacket
      ? `The cloud reviewer visually classified this family as ${readableSourceName(proposedType).toLowerCase()}.`
      : 'The family needs user review.',
    400,
  );
  const selfContradictoryAssessment = !compactPacket
    && isSelfContradictoryCloudAssessment(modelReason, evidence, reportedConfidence);
  const confidence = selfContradictoryAssessment ? Math.min(0.55, reportedConfidence) : reportedConfidence;
  const conflict = booleanValue(raw.conflict) || selfContradictoryAssessment;
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: modelFamilyName,
    assetType,
    role,
    modelFamilyName,
    modelAssetType: proposedType,
    normalizationReason: normalizationReason || undefined,
    memberNames: family.members.map((member, index) => ({
      visualHash: member.visualHash,
      name: cleanText(names.get(member.visualHash) || modelFamilyName, ''),
    })),
    diveMode,
    reason: selfContradictoryAssessment
      ? `The cloud response described this as an unreadable or non-functional artifact while claiming high confidence. Kryeo marked the classification unreliable. ${normalizationReason ? `${normalizationReason} ` : ''}${modelReason}`
      : normalizationReason ? `${normalizationReason} ${modelReason}` : modelReason,
    visualDescription: cleanText(raw.visualDescription, '', 500),
    confidence,
    ...(compactPacket ? { compactPacket: true } : {}),
    ...(evidencePresent ? { evidence } : {}),
    conflict,
    conflictMessage: cleanText(
      raw.conflictMessage,
      selfContradictoryAssessment
          ? 'The cloud response has almost no supporting evidence and describes the preview as an unreadable or non-functional artifact.'
          : !validName && assetType !== 'Unknown'
            ? 'The cloud response did not return a valid name for its selected type.'
          : '',
      300,
    ),
    reviewNeeded: Boolean(
      booleanValue(raw.reviewNeeded)
      || conflict
      || (!compactPacket && !evidencePresent)
      || confidence < 0.72
      || assetType === 'Unknown'
      || role === 'Unknown'
      || !suppliedDiveMode
      || !validName
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
    boundary: family.assetBoundary || 'standalone',
    structuralDiveMode: family.structuralDiveMode || 'keep-together',
    decisionScopeKey: family.decisionScopeKey || family.namingScopeKey || '',
    siblingOrdinal: Number(family.siblingOrdinal || 0),
    siblingCount: Number(family.siblingCount || 0),
    visuals: [...new Set((family.members || []).map((member) => member.visualHash).filter(Boolean))].sort(),
    contextVisuals: [...new Set((family.contextMembers || []).map((member) => member.visualHash).filter(Boolean))].sort(),
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
    assetBoundary: family.assetBoundary || 'standalone',
    structuralDiveMode: family.structuralDiveMode || 'keep-together',
    siblingOrdinal: family.siblingOrdinal,
    siblingCount: family.siblingCount,
    decisionScopeKey: family.decisionScopeKey || family.namingScopeKey || '',
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
    contextMembers: (family.contextMembers || []).slice(0, 8).map((member, memberIndex) => ({
      imageLabel: `family-${familyIndex + 1}-context-${memberIndex + 1}`,
      layerName: member.name,
      affinityType: member.affinityType,
      bounds: member.bounds,
      visualMetrics: member.visualMetrics || null,
    })),
  };
}

function isCacheableFamilyAnalysis(analysis) {
  return Boolean(
    analysis
    && analysis.assetType !== 'Unknown'
    && analysis.role !== 'Unknown'
    && !analysis.reviewNeeded
    && !analysis.conflict
    && isCompleteDecisionName(analysis.familyName, analysis.assetType)
    && (analysis.memberNames || []).every((member) => isCompleteDecisionName(member.name, analysis.assetType)),
  );
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
  const contextMembers = (family.contextMembers || []).slice(0, 4).map((member) => [
    member.name,
    member.affinityType,
    Math.round(Number(member.bounds?.width || 0)),
    Math.round(Number(member.bounds?.height || 0)),
  ]);
  return [
    `f${familyIndex + 1}`,
    family.assetBoundary || 'standalone',
    family.structuralDiveMode || 'keep-together',
    Number(family.siblingOrdinal || 0),
    Number(family.siblingCount || 0),
    (family.parentNames || []).slice(0, 3),
    members,
    contextMembers,
    hierarchy,
    Math.max(1, Number(family.exactInstanceCount || 1)),
  ];
}

function compactFamilyPrompt(families, context) {
  // Direct image inputs preserve the pixel detail of every member in a
  // context-aware batch. Every target keeps its own label and preview.
  const content = [{
    type: 'text',
    text: [
      'Metadata rows use [alias,boundary,plannedGrouping,siblingOrdinal,siblingCount,parentNames,members,supportingChildren,hierarchy,exactCopies].',
      'Member rows use [sourceName,AffinityType,width,height,childCount,[visibleAlpha,opaqueAlpha,canvasEdgeVisible,canvasCenterVisible,contentInnerVisible,contentPerimeterVisible,contentPerimeterCoverage]].',
      'Supporting children explain the composition of a composed parent and are not separate output decisions. Hierarchy fields are disambiguation context only, not naming text. Name each target family from its own visible artwork; never concatenate parent, ancestor, sibling, collection, or type labels.',
      'Sibling ordinal/count records document order only. Use an ordinal in a name only when visually equivalent siblings truly share one root; never use it to copy a neighbour\'s identity.',
      'plannedGrouping is fixed structural ownership. Copy it into d exactly (0=keep-together, 1=children-only, 2=parent-and-children); if it appears ambiguous, set rv=true instead of changing it.',
      'A GroupNode, child count, or Frame field is structural metadata, not a request to call the asset Container, Group, or Frame. A transparent decorative perimeter with a sparse centre is Border/ImageLabel, not Frame, unless it visibly acts as structural chrome for external UI content.',
      'Names must follow <descriptive visual identity> <final asset type>; include at least one grounded descriptor before the final type. Never return a bare taxonomy word such as Background, Wallpaper, Slot, Frame, Border, Texture, Badge, or Overlay, even with a number. Do not copy source, parent, ancestor, or sibling labels into a target name.',
      'When reviewing a current packet, return a complete replacement row whenever the visual supports a decision. Do not return criticism alone, and do not mark a defensible visual Unknown merely because the current name is weak.',
      'Return JSON only in the compact shape {"f":[["f1",0,"assetType","complete name",0,0,"role"]]}. Each row is [alias,ignored,type,name,uncertain(0|1),plannedGrouping(0|1|2),role]. Return every requested alias exactly once; never return prose, markdown, or an incomplete row.',
      `F=${JSON.stringify(families.map(compactLiteFamilyMetadata))}`,
      `Neutral observations=${JSON.stringify(context.descriptions || []).slice(0, 1600)}. These describe visible facts only. Do not introduce any noun or adjective absent from them or the preview.`,
      ...(Array.isArray(context.instructions) && context.instructions.length
        ? [`User rules=${JSON.stringify(context.instructions.slice(0, 3)).slice(0, 300)}`]
        : []),
      ...(context.projectKnowledge
        ? [`Project context=${JSON.stringify(context.projectKnowledge).slice(0, 260)}`]
        : []),
      ...(Array.isArray(context.reviewContext) && context.reviewContext.length
        ? [`Independent review context=${JSON.stringify(context.reviewContext.map((item) => ({
            familyId: item.familyId,
            currentDecision: item.currentDecision
              ? {
                  familyName: item.currentDecision.familyName,
                  assetType: item.currentDecision.assetType,
                  role: item.currentDecision.role,
                  grouping: item.currentDecision.diveMode,
                }
              : null,
            challengeReasons: Array.isArray(item.challengeReasons) ? item.challengeReasons.slice(0, 4) : [],
          }))).slice(0, 3600)}. Return a complete replacement row when the current decision is unsupported; never return criticism without a row.`]
        : []),
    ].join('\n'),
  }];
  families.forEach((family, familyIndex) => {
    const representative = family.members?.[0];
    const previewUrl = family.assetBoundary === 'composed-parent'
      ? (representative?.previewUrl || representative?.hostedPreviewUrl)
      : (representative?.hostedPreviewUrl || representative?.previewUrl);
    content.push({ type: 'text', text: `Preview f${familyIndex + 1}.` });
    if (isVisionSafeDataUrl(previewUrl)) content.push({ type: 'image_url', image_url: { url: previewUrl } });
    else content.push({ type: 'text', text: 'Preview unreadable; set rv=true and use Unknown only for this case.' });
    // Construction hierarchy stays in the compact metadata. Sending every
    // child thumbnail beside every target turns a small batch into dozens of
    // images and encourages a model to classify a neighbouring construction
    // fragment instead of the labelled target preview.
  });
  if (context.includeDocumentContext && isVisionSafeDataUrl(context.documentPreviewUrl)) {
    content.push({ type: 'text', text: 'Document composite context explains placement only; it must not be copied into a target name.' });
    content.push({ type: 'image_url', image_url: { url: context.documentPreviewUrl } });
  }
  content.push({ type: 'text', text: `Return the compact packet for f1..f${families.length}.` });
  return content;
}

/**
 * One compact, schema-first semantic pass for detailed/reviewer requests.
 * The Lite lane above uses the same contract in a smaller payload. Keeping the
 * two prompts aligned prevents one reviewer from inventing a different naming
 * policy than the primary decision.
 */
function familyPrompt(families, context = {}) {
  if (context.compactResponse || context.reviewTier === 'lite') return compactFamilyPrompt(families, context);

  const documentFamilies = Array.isArray(context.documentFamilies) ? context.documentFamilies : [];
  const requested = new Set(families.map((family) => family.id));
  const requestedOrders = documentFamilies
    .map((family, index) => requested.has(family.familyId) ? index : -1)
    .filter((index) => index >= 0);
  const first = requestedOrders.length ? Math.max(0, Math.min(...requestedOrders) - 1) : 0;
  const last = requestedOrders.length
    ? Math.min(documentFamilies.length, Math.max(...requestedOrders) + 2)
    : Math.min(documentFamilies.length, 3);
  const nearbyScopes = documentFamilies.slice(first, last).map((family) => ({
    familyId: family.familyId,
    order: family.order,
    assetBoundary: family.assetBoundary || 'standalone',
    structuralDiveMode: family.structuralDiveMode || 'keep-together',
    siblingOrdinal: family.siblingOrdinal,
    siblingCount: family.siblingCount,
    parentNames: (family.parentNames || []).slice(0, 2),
    memberCount: Array.isArray(family.members) ? family.members.length : 0,
  }));
  const content = [{
    type: 'text',
    text: [
      'Make one complete semantic decision for every requested export scope. Return every requested family exactly once.',
      'Evidence order: target image and alpha topology first; supporting child images second; immediate hierarchy and meaningful source labels only adjust confidence. Never use IDs, filenames, numbers, group labels, or ancestor text as the name.',
      'The structural boundary is already planned. Supporting construction children are evidence for their parent, not extra assets. Report the supplied plannedGrouping exactly; do not turn a composed owner into loose children or vice versa.',
      'Each decision is atomic: name, assetType, role, plannedGrouping, confidence, reason, and any alternative must agree. If a reading is genuinely plausible but uncertain, select the best complete packet and put the other reading in alternatives. Use Unknown only for a missing or unreadable target preview.',
      'Name the target itself from visible evidence. Use a short factual identity; never invent a story, location, vehicle, material, colour, brand, or function. Include the final type exactly once as the last semantic noun, then only a real state or document-order ordinal.',
      'Type guide: a filled foundation is Background; a complete scene is Wallpaper; a reusable surface material is Texture; a sparse treatment is Overlay; an enclosing perimeter is Border; a self-contained decorative mark is Badge, Icon, or Ornament; an item receptacle is Slot; Frame requires visible structural chrome for external content. GroupNode is never Frame evidence by itself.',
      'Use ImageLabel for non-interactive art, an interactive role only for visibly interactive controls, and Frame only for actual structural containers. Related anonymous siblings may share a concise root and use document order, but visually similar scopes must not borrow one another\'s identity.',
      `Allowed asset types: ${ASSET_TYPES.join(', ')}. Allowed roles: ${ROBLOX_ROLES.join(', ')}.`,
      `Requested scopes=${JSON.stringify(families.map((family, index) => promptFamilyMetadata(family, index, false))).slice(0, 12000)}`,
      `Nearby scopes=${JSON.stringify(nearbyScopes).slice(0, 1800)}`,
      ...(context.reviewContext
        ? [`Review proposals to replace completely=${JSON.stringify(context.reviewContext).slice(0, 3200)}`]
        : []),
      ...(Array.isArray(context.descriptions) && context.descriptions.length
        ? [`Neutral observations=${JSON.stringify(context.descriptions).slice(0, 1600)}`]
        : []),
    ].join('\n'),
  }];

  for (const [familyIndex, family] of families.entries()) {
    for (const { member, index: memberIndex } of selectVisionMembers(family, context.maxMemberImages)) {
      const previewUrl = member.previewUrl || member.hostedPreviewUrl;
      content.push({ type: 'text', text: `Target image family-${familyIndex + 1}-member-${memberIndex + 1}.` });
      if (isVisionSafeDataUrl(previewUrl)) content.push({ type: 'image_url', image_url: { url: previewUrl } });
    }
    for (const [childIndex, child] of (family.contextMembers || []).slice(0, 4).entries()) {
      const previewUrl = child.previewUrl || child.hostedPreviewUrl;
      if (!isVisionSafeDataUrl(previewUrl)) continue;
      content.push({ type: 'text', text: `Supporting construction image for family-${familyIndex + 1}; not an output: child-${childIndex + 1}.` });
      content.push({ type: 'image_url', image_url: { url: previewUrl } });
    }
  }
  if (context.includeDocumentContext && isVisionSafeDataUrl(context.documentPreviewUrl)) {
    content.push({ type: 'text', text: 'Document composite context; use it only to understand placement, not to copy an ancestor name.' });
    content.push({ type: 'image_url', image_url: { url: context.documentPreviewUrl } });
  }
  content.push({
    type: 'text',
    text: [
      'Return JSON only: {"families":[{"familyId","familyName","assetType","role","memberNames":[{"visualHash","name"}],"diveMode","reason","visualDescription","confidence","evidence":{"visual","layerName","hierarchy","learned"},"conflict","conflictMessage","reviewNeeded","alternatives":[{"assetType","reason"}]}]}.',
      'Copy each requested familyId and visualHash exactly. Use the scope\'s plannedGrouping as diveMode. Return a valid role; missing fields make the decision unusable.',
    ].join(' '),
  });
  return content;
}

function decodeCompactPacket(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const rows = Array.isArray(output.f) ? output.f : [];
  return rows.flatMap((row) => {
    if (Array.isArray(row)) {
      const [familyId, , assetType, completeName, uncertainty, diveCode, role] = row;
      const uncertain = uncertainty === 1 || String(uncertainty).toLowerCase() === 'true';
      const diveMode = Number(diveCode) === 0
        ? 'keep-together'
        : Number(diveCode) === 1
          ? 'children-only'
          : Number(diveCode) === 2
            ? 'parent-and-children'
            : undefined;
      return [{
        familyId,
        // A compact row without its complete name is an incomplete packet,
        // not permission to assemble a name locally from a root reference.
        familyName: cleanText(completeName, '', 160),
        assetType,
        role,
        diveMode,
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
  const observedType = modelType || localType;
  const evidenceSource = expanded.evidence && typeof expanded.evidence === 'object'
    ? expanded.evidence
    : output;
  const outputName = cleanText(expanded.familyName, '', 160);
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
    // A partial provider packet must never be completed with local source
    // words or a type-to-role lookup. Keep every semantic field unresolved so
    // the UI cannot present a stitched-together decision as AI output.
    familyName: '',
    assetType: 'Unknown',
    role: 'Unknown',
    memberNames: [],
    diveMode: family.structuralDiveMode || 'keep-together',
    reason: `The hosted response supplied partial evidence for ${readableSourceName(observedType).toLowerCase()} but did not return one complete decision.${evidenceText ? ` ${evidenceText}` : ''}`,
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
  const compactResponse = context.compactResponse === true || context.reviewTier === 'lite';
  const compactOutputFloor = MODEL_TRANSPORT === 'responses' ? 700 : 360;
  const compactOutputCeiling = MODEL_TRANSPORT === 'responses' ? 1600 : 1200;
  const maxOutputTokens = compactResponse
    ? Math.max(compactOutputFloor, Math.min(compactOutputCeiling, 320 + families.length * 160))
    : Math.max(520, Math.min(1600, families.length * 220));
  let completion;
  try {
    completion = await callModelWithUsage([
      cacheableSystemMessage(compactResponse ? COMPACT_DECISION_CONTRACT : DECISION_CONTRACT),
      { role: 'user', content: familyPrompt(families, { ...context, descriptions, compactResponse }) },
    ], maxOutputTokens, 'none', signal, model, context.sessionId, context.serviceTier);
  } catch (error) {
    if (error?.providerTelemetry && Array.isArray(context.providerCalls)) context.providerCalls.push(error.providerTelemetry);
    settleScanBudget(context.hostedScanId, error?.modelUsage);
    throw error;
  }
  if (completion.telemetry && Array.isArray(context.providerCalls)) context.providerCalls.push(completion.telemetry);
  settleScanBudget(context.hostedScanId, completion.usage);
  const output = completion.output;
  const rawFamilies = compactResponse ? decodeCompactPacket(output) : [];
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
  const compact = compactResponse;
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
  // Sibling coherence is part of the primary visual decision. A second pass
  // that edits names alone would split name/type/role into separate decisions.
  const missing = families.filter((family) => !hasCoreFamilyAnalysis(rawById.get(family.id)));
  const complete = families
    .filter((family) => !missing.includes(family))
    .map((family) => normalizeAnalysis({
      ...(rawById.get(family.id) || {}),
      visualDescription: rawById.get(family.id)?.visualDescription
        || descriptions.find((item) => item.familyId === family.id)?.description
        || `The supplied preview was classified visually as ${readableSourceName(rawById.get(family.id)?.assetType || 'Unknown').toLowerCase()}.`,
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
  // The primary visual model owns one atomic decision. A separate observation
  // request doubled latency and could strand progress behind two sequential
  // generations without adding authority; grounding remains in this prompt and
  // the independent reviewer is reserved for actual evidence conflicts.
  return classifyFamilyBatch(families, context, [], signal, model);
}

function isRetryableModelError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Model server error (408|425|429|5\d\d)\b|did not answer within|fetch failed|network|timed out/i.test(message);
}

function isModelProtocolError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /did not return structured JSON/i.test(message);
}

async function analyzeFamilyBatchWithRetry(families, context, signal, model = MODEL) {
  let transientAttempt = 0;
  let protocolAttempt = 0;
  while (true) {
    try {
      return await analyzeFamilyBatch(families, context, signal, model);
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryIncompleteSingle = error instanceof IncompleteFamilyBatchError && families.length === 1;
      if ((isModelProtocolError(error) || retryIncompleteSingle) && protocolAttempt < MAX_MODEL_RETRIES) {
        protocolAttempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 250 * protocolAttempt));
        continue;
      }
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
      .update(JSON.stringify({
        hierarchy: family.hierarchyContext || [],
        boundary: family.assetBoundary || 'standalone',
        structuralDiveMode: family.structuralDiveMode || 'keep-together',
        decisionScopeKey: family.decisionScopeKey || family.namingScopeKey || '',
        siblingOrdinal: Number(family.siblingOrdinal || 0),
        siblingCount: Number(family.siblingCount || 0),
        contextMembers: (family.contextMembers || []).map((member) => ({
          visualHash: member.visualHash,
          hierarchyKey: member.hierarchyKey,
        })),
      }))
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
    const normalizedRecord = record ? normalizeAnalysis(record, family, families) : null;
    if (normalizedRecord && isCacheableFamilyAnalysis(normalizedRecord)) {
      analyses.push(normalizedRecord);
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
      sessionId: `kryeo-${createHash('sha256')
      .update(String(payload.hostedScanId || requestId))
      .digest('hex')
      .slice(0, 32)}`,
    hostedScanId: String(payload.hostedScanId || requestId),
    reviewTier,
    // All primary decisions use the small schema so the fast visual model has
    // one unambiguous output contract. Escalation raises preview/context
    // fidelity, while only /review uses the stronger model and full packet.
    compactResponse: true,
    serviceTier: ['default', 'flex', 'priority', 'scale'].includes(String(payload.serviceTier || '').toLowerCase())
      ? String(payload.serviceTier).toLowerCase()
      : OPENROUTER_SERVICE_TIER,
    maxMemberImages: budgetSelection.maxMemberImages,
    includeDocumentContext: budgetSelection.includeDocumentContext,
    correlationId: String(payload.correlationId || payload.hostedScanId || ''),
    providerCalls: [],
    documentFamilies: families.map((family, familyIndex) => ({
      familyId: family.id,
      order: familyIndex + 1,
      namingScopeKey: family.namingScopeKey,
      decisionScopeKey: family.decisionScopeKey,
      assetBoundary: family.assetBoundary || 'standalone',
      structuralDiveMode: family.structuralDiveMode || 'keep-together',
      siblingOrdinal: family.siblingOrdinal,
      siblingCount: family.siblingCount,
      parentNames: family.parentNames,
      exactInstanceCount: family.exactInstanceCount,
      members: family.members.map((member) => ({
        layerName: member.name,
        affinityType: member.affinityType,
        bounds: member.bounds,
        childCount: member.childHierarchyKeys.length,
        visualMetrics: member.visualMetrics || null,
      })),
      contextMembers: (family.contextMembers || []).slice(0, 8).map((member) => ({
        layerName: member.name,
        affinityType: member.affinityType,
        bounds: member.bounds,
        visualMetrics: member.visualMetrics || null,
      })),
    })),
  };
  const storeResults = async (results, sourceFamilies) => {
    if (!results.length) return;
    for (const result of results) {
      analyses.push(result);
      const family = sourceFamilies.find((item) => item.id === result.familyId);
      if (!isCacheableFamilyAnalysis(result)) continue;
      storeCachedResult(familyCacheKey(result.fingerprint, family?.cacheContextSignature || '', model), result);
      if (family && allowSharedCache) {
        storeCachedResult(sharedFamilyCacheKey(family, model), result);
      }
    }
    await persistCache();
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
      // Preserve any valid partial results and leave the remaining scope
      // explicitly unresolved. Do not explode one provider failure into a
      // second batch plus N individual calls: that was the cause of long
      // scans, 429s, and stale half-decisions.
      failures.push({
        familyIds: recoveryFamilies.map((family) => family.id),
        message: isRetryableModelError(error)
          ? 'The visual provider did not complete this batch in time. These families remain unresolved and can be retried on the next scan.'
          : error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Do not manufacture member ordinals after the model has returned its
  // packet. Exact duplicate render instances intentionally share the same
  // semantic identity, while distinct construction siblings are separate
  // decision scopes. Renaming only member names here used to produce
  // out-of-order labels that disagreed with the final family decision.
  for (const analysis of analyses) {
    const family = families.find((item) => item.id === analysis.familyId);
    if (!isCacheableFamilyAnalysis(analysis)) continue;
    const primaryKey = familyCacheKey(analysis.fingerprint, family?.cacheContextSignature || '', model);
    if (!familyCache.has(primaryKey)) storeCachedResult(primaryKey, analysis);
    if (family && allowSharedCache) {
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
    diagnostics: {
      correlationId: String(payload.correlationId || payload.hostedScanId || ''),
      requestId,
      route: '/v1/families/analyze',
      reviewTier,
      requestedFamilies: families.length,
      cachedFamilies: cached,
      analyzedFamilies: analyses.length,
      incompleteFamilies: failures.flatMap((failure) => failure.familyIds),
      providerCalls: analysisContext.providerCalls,
      recovery: Object.fromEntries(Object.entries(recovery).map(([key, value]) => [key, Number(value) || 0])),
    },
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
    challengeReasons: (Array.isArray(payload.challengeReasons) ? payload.challengeReasons : []).map((item) => cleanText(item, '').toLowerCase()),
    peerDecisionNames: (Array.isArray(payload.peerDecisionNames) ? payload.peerDecisionNames : []).map((item) => readableSourceName(item).toLowerCase()),
    siblingOrdinal: Number(payload.siblingOrdinal || 0),
    siblingCount: Number(payload.siblingCount || 0),
  })).digest('hex');
  return `${EXPLANATION_VERSION}:${MODEL_ESCALATION}:${signature}`;
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
        challengeReasons: (Array.isArray(payload.challengeReasons) ? payload.challengeReasons : []).slice(0, 8),
        peerDecisionNames: (Array.isArray(payload.peerDecisionNames) ? payload.peerDecisionNames : []).slice(0, 12),
        siblingOrdinal: Number(payload.siblingOrdinal || 0) || undefined,
        siblingCount: Number(payload.siblingCount || 0) || undefined,
      }),
    },
    { type: 'image_url', image_url: { url: previewUrl } },
  ];
  let completion;
  try {
    completion = await callModelWithUsage([
      cacheableSystemMessage(EVIDENCE_SYSTEM),
      { role: 'user', content },
    ], 360, 'none', signal, MODEL_ESCALATION, payload.hostedScanId || '', OPENROUTER_SERVICE_TIER);
  } catch (error) {
    settleScanBudget(payload.hostedScanId, error?.modelUsage);
    throw error;
  }
  settleScanBudget(payload.hostedScanId, completion.usage);
  let output = completion.output;
  const initialEvidenceValue = output?.evidence ?? output?.e;
  const initialEvidence = Array.isArray(initialEvidenceValue)
    ? { visual: confidenceScore(initialEvidenceValue[0]), layerName: confidenceScore(initialEvidenceValue[1]), hierarchy: confidenceScore(initialEvidenceValue[2]), learned: confidenceScore(initialEvidenceValue[3]) }
    : { visual: confidenceScore(initialEvidenceValue?.visual), layerName: confidenceScore(initialEvidenceValue?.layerName), hierarchy: confidenceScore(initialEvidenceValue?.hierarchy), learned: confidenceScore(initialEvidenceValue?.learned) };
  const initialConfidence = confidenceScore(output?.confidence ?? output?.c);
  const initialSelfContradictory = isSelfContradictoryCloudAssessment(output?.reason ?? output?.q, initialEvidence, initialConfidence);
  const initialRejected = booleanValue(output?.conflict ?? output?.x)
    || (
      (output?.supportsClassification !== undefined || output?.ok !== undefined)
      && booleanValue(output?.supportsClassification ?? output?.ok) === false
    );
  const initialSuggestedType = output?.suggestedType ?? output?.st;
  const initialSuggestedRole = output?.suggestedRole ?? output?.sr;
  const initialSuggestedName = cleanText(output?.suggestedName ?? output?.sn, '', 160);
  const initialCompleteReplacement = ASSET_TYPES.includes(initialSuggestedType)
    && ROBLOX_ROLES.includes(initialSuggestedRole)
    && isCompleteDecisionName(initialSuggestedName, initialSuggestedType);
  const initialProposesChange = Boolean(
    (initialSuggestedType && initialSuggestedType !== assetType)
    || (initialSuggestedRole && initialSuggestedRole !== payload.role)
    || (initialSuggestedName
      && readableSourceName(initialSuggestedName).toLowerCase() !== readableSourceName(payload.familyName).toLowerCase())
  );
  if ((initialRejected || initialProposesChange) && !initialSelfContradictory && !initialCompleteReplacement) {
    let repair;
    try {
      repair = await callModelWithUsage([
        cacheableSystemMessage(EVIDENCE_SYSTEM),
        {
          role: 'user',
          content: [...content, {
            type: 'text',
            text: 'Your first audit rejected the chosen decision but omitted a replacement. Return the complete replacement now: ok=false, x=true, and concrete st, sr, and sn. The name must include st exactly once and contain no other asset-type word. Choose one best-supported replacement from the visible artwork; do not return prose outside the JSON.',
          }],
        },
      ], 360, 'none', signal, MODEL_ESCALATION, payload.hostedScanId || '', OPENROUTER_SERVICE_TIER);
    } catch (error) {
      settleScanBudget(payload.hostedScanId, error?.modelUsage);
      throw error;
    }
    settleScanBudget(payload.hostedScanId, repair.usage);
    output = repair.output;
  }
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
  const reportedConfidence = confidenceScore(output?.confidence ?? output?.c);
  const selfContradictoryAssessment = isSelfContradictoryCloudAssessment(
    output?.reason ?? output?.q,
    evidence,
    reportedConfidence,
  );
  const confidence = selfContradictoryAssessment ? Math.min(0.55, reportedConfidence) : reportedConfidence;
  const explicitConflict = booleanValue(output?.conflict ?? output?.x);
  const classificationChanged = Boolean(
    (suggestedType && suggestedType !== assetType)
    || (suggestedRole && suggestedRole !== payload.role),
  );
  const nameChanged = Boolean(
    suggestedName
    && readableSourceName(suggestedName).toLowerCase() !== readableSourceName(payload.familyName).toLowerCase()
  );
  const conflict = explicitConflict || classificationChanged || nameChanged || selfContradictoryAssessment;
  const supportsClassification = output?.supportsClassification !== undefined || output?.ok !== undefined
    ? booleanValue(output?.supportsClassification ?? output?.ok) && !conflict
    : !conflict;
  const result = {
    reason: selfContradictoryAssessment
      ? `The cloud response described this as an unreadable or non-functional artifact while claiming high confidence. Treat its classification as unreliable.`
      : cleanText(output?.reason ?? output?.q, `The cloud reviewer classified the visible family as ${readableSourceName(assetType).toLowerCase()}.`, 300),
    visualDescription: cleanText(output?.visualDescription ?? output?.v, 'The supplied preview was reviewed visually.', 300),
    confidence,
    evidence,
    conflict,
    conflictMessage: cleanText(
      output?.conflictMessage ?? output?.xm,
      classificationChanged
        ? `Independent review suggests ${suggestedType || assetType}/${suggestedRole || payload.role} instead.`
        : selfContradictoryAssessment
          ? 'The cloud response has almost no supporting evidence and says this preview is an unreadable or non-functional artifact.'
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
  const finalBudget = scanBudget(payload.hostedScanId, payload.hostedScanId || randomUUID());
  return {
    ...result,
    cached: false,
    scanProviderCostUsd: finalBudget.providerUsd,
    scanProviderRequests: finalBudget.providerRequests,
  };
}

async function reviewFamilies(payload, signal) {
  const families = (Array.isArray(payload.families) ? payload.families : []).slice(0, 8);
  if (!families.length) throw new Error('No challenged visual families were supplied.');
  const currentAnalyses = Array.isArray(payload.currentAnalyses) ? payload.currentAnalyses : [];
  const challengeReasons = payload.challengeReasons && typeof payload.challengeReasons === 'object'
    ? payload.challengeReasons
    : {};
  const reviewSignature = createHash('sha256').update(JSON.stringify({
    current: currentAnalyses.map((analysis) => ({
      familyId: analysis.familyId,
      familyName: analysis.familyName,
      assetType: analysis.assetType,
      role: analysis.role,
    })),
    challengeReasons,
    scope: families.map((family) => ({
      id: family.id,
      namingScopeKey: family.namingScopeKey,
      assetBoundary: family.assetBoundary || 'standalone',
      structuralDiveMode: family.structuralDiveMode || 'keep-together',
      siblingOrdinal: family.siblingOrdinal,
      siblingCount: family.siblingCount,
    })),
  })).digest('hex').slice(0, 24);
  const analyses = [];
  const unresolved = [];
  for (const family of families) {
    const key = `${EXPLANATION_VERSION}:batch-review:${MODEL_ESCALATION}:${family.fingerprint}:${reviewSignature}`;
    const cached = familyCache.get(key);
    const normalized = cached ? normalizeAnalysis(cached, family, families) : null;
    if (normalized && isCacheableFamilyAnalysis(normalized)) analyses.push(normalized);
    else {
      family.batchReviewCacheKey = key;
      unresolved.push(family);
    }
  }
  const failures = [];
  const providerCalls = [];
  if (unresolved.length) {
    const context = {
      instructions: [],
      projectKnowledge: payload.projectKnowledge || null,
      documentPreviewUrl: '',
      sessionId: `kryeo-review-${createHash('sha256').update(String(payload.hostedScanId || randomUUID())).digest('hex').slice(0, 24)}`,
      hostedScanId: String(payload.hostedScanId || randomUUID()),
      reviewTier: 'escalation',
      // Keep the escalation model, but use the compact atomic packet so one
      // bounded response can contain a complete replacement for every family.
      compactResponse: true,
      serviceTier: ['default', 'flex', 'priority', 'scale'].includes(String(payload.serviceTier || '').toLowerCase())
        ? String(payload.serviceTier).toLowerCase()
        : OPENROUTER_SERVICE_TIER,
      maxMemberImages: 1,
      includeDocumentContext: false,
      correlationId: String(payload.correlationId || payload.hostedScanId || ''),
      providerCalls,
      reviewContext: unresolved.map((family) => ({
        familyId: family.id,
        currentDecision: currentAnalyses.find((analysis) => analysis.familyId === family.id) || null,
        challengeReasons: Array.isArray(challengeReasons[family.id]) ? challengeReasons[family.id].slice(0, 8) : [],
      })),
      documentFamilies: families.map((family, familyIndex) => ({
        familyId: family.id,
        order: familyIndex + 1,
        namingScopeKey: family.namingScopeKey,
        decisionScopeKey: family.decisionScopeKey,
        assetBoundary: family.assetBoundary || 'standalone',
        structuralDiveMode: family.structuralDiveMode || 'keep-together',
        siblingOrdinal: family.siblingOrdinal,
        siblingCount: family.siblingCount,
        parentNames: family.parentNames,
        members: family.members.map((member) => ({
          layerName: member.name,
          affinityType: member.affinityType,
          bounds: member.bounds,
          childCount: member.childHierarchyKeys.length,
          visualMetrics: member.visualMetrics || null,
        })),
        contextMembers: (family.contextMembers || []).slice(0, 8).map((member) => ({
          layerName: member.name,
          affinityType: member.affinityType,
          bounds: member.bounds,
          visualMetrics: member.visualMetrics || null,
        })),
      })),
    };
    try {
      const reviewed = await analyzeFamilyBatch(unresolved, context, signal, MODEL_ESCALATION);
      for (const result of reviewed) {
        analyses.push(result);
        const family = unresolved.find((candidate) => candidate.id === result.familyId);
        if (family?.batchReviewCacheKey && isCacheableFamilyAnalysis(result)) storeCachedResult(family.batchReviewCacheKey, result);
      }
      await persistCache();
    } catch (error) {
      const partial = error instanceof IncompleteFamilyBatchError ? error.partialResults : [];
      for (const result of partial) {
        analyses.push(result);
        const family = unresolved.find((candidate) => candidate.id === result.familyId);
        if (family?.batchReviewCacheKey && isCacheableFamilyAnalysis(result)) storeCachedResult(family.batchReviewCacheKey, result);
      }
      const completed = new Set(partial.map((result) => result.familyId));
      failures.push({
        familyIds: unresolved.filter((family) => !completed.has(family.id)).map((family) => family.id),
        message: isRetryableModelError(error)
          ? 'The independent visual-review provider is temporarily busy; these families remain visibly unresolved and can be retried on the next scan.'
          : error instanceof Error ? error.message : String(error),
      });
      await persistCache();
    }
  }
  const budget = scanBudget(payload.hostedScanId, payload.hostedScanId || randomUUID());
  return {
    requestId: randomUUID(),
    cached: families.length - unresolved.length,
    analyses,
    failures: failures.filter((failure) => failure.familyIds.length),
    model: MODEL_ESCALATION,
    reviewTier: 'escalation',
    skippedFamilyIds: [],
    budgetLimited: false,
    scanProviderCostUsd: budget.providerUsd,
    scanCommittedCostUsd: Math.max(budget.providerUsd, budget.estimatedUsd),
    scanProviderRequests: budget.providerRequests,
    usage: usageReport(),
    diagnostics: {
      correlationId: String(payload.correlationId || payload.hostedScanId || ''),
      route: '/v1/families/review',
      reviewTier: 'escalation',
      requestedFamilies: families.length,
      cachedFamilies: families.length - unresolved.length,
      analyzedFamilies: analyses.length,
      incompleteFamilies: failures.flatMap((failure) => failure.familyIds),
      providerCalls,
    },
  };
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
    // Cache entries are tied to the complete decision contract. A prompt or
    // resolver version change must never leave historical decisions available
    // to a new scan, even if an old cache file remains on disk.
    const acceptedPrefixes = [`${ANALYSIS_VERSION}:`, `${EXPLANATION_VERSION}:`];
    const entries = Object.entries(parsed).filter(([key]) => acceptedPrefixes.some((prefix) => key.startsWith(prefix)));
    const retained = entries.slice(-MAX_CACHE_ENTRIES);
    for (const [key, value] of retained) familyCache.set(key, value);
    if (retained.length < Object.keys(parsed).length) {
      cacheEvictions += Object.keys(parsed).length - retained.length;
      cacheDirty = true;
      await persistCache();
    }
  } catch {
    // The cache is optional and contains no source images.
  }
}

await loadCache();

async function clearFamilyCache() {
  if (modelQueue.depth || totalInflightRequests()) {
    throw Object.assign(new Error('Wait for the active visual analysis to finish before clearing its cache.'), { statusCode: 409 });
  }
  // Wait for a previous atomic write before deleting the derived cache file;
  // otherwise a queued write can recreate old entries just after a clear.
  await cacheWrite.catch(() => undefined);
  familyCache.clear();
  cacheDirty = false;
  await fs.rm(CACHE_PATH, { force: true });
  return { cleared: true, analysisVersion: ANALYSIS_VERSION, cacheEntries: 0 };
}

const server = http.createServer(async (request, response) => {
  const gatewayRequestId = randomUUID();
  const correlationId = String(request.headers['x-kryeo-correlation-id'] || '').slice(0, 120);
  const route = String(request.url || '').split('?')[0];
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
        provider: IS_OPENROUTER ? 'openrouter' : IS_META_MODEL_API ? 'meta-model-api' : IS_OPENCODE_ZEN ? 'opencode-zen' : 'openai-compatible',
        modelTransport: MODEL_TRANSPORT,
        responsesReasoningEffort: MODEL_TRANSPORT === 'responses' ? RESPONSES_REASONING_EFFORT : undefined,
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
    if (request.method === 'POST' && request.url === '/v1/cache/clear') {
      return json(response, 200, await clearFamilyCache());
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
      if (request.method === 'POST' && request.url === '/v1/families/review') {
        return json(response, 200, await reviewFamilies(payload, requestController.signal));
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
    return json(response, status, {
      error: error instanceof Error ? error.message : String(error),
      requestId: gatewayRequestId,
      diagnostics: {
        correlationId,
        requestId: gatewayRequestId,
        route,
        providerCalls: [],
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Kryeo AI listening on http://${HOST}:${PORT} using ${MODEL}\n`);
  if (!TOKENS.length) process.stdout.write('Authentication is disabled for loopback development only.\n');
});
