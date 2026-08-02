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
const MODEL = process.env.KRYEO_AI_MODEL || 'Qwen3.5-9B';
const MODEL_BASE_URL = String(process.env.KRYEO_MODEL_BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '');
const MODEL_API_KEY = process.env.KRYEO_MODEL_API_KEY || '';
const DATA_DIR = path.resolve(process.env.KRYEO_AI_DATA_DIR || '.data');
const CACHE_PATH = path.join(DATA_DIR, 'family-cache.json');
const TOKENS = String(process.env.KRYEO_AI_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const ALLOW_LOOPBACK_WITHOUT_TOKEN = String(process.env.KRYEO_AI_ALLOW_LOOPBACK_WITHOUT_TOKEN || '').toLowerCase() === 'true';
const MAX_QUEUE = Number(process.env.KRYEO_AI_MAX_QUEUE || 100);
const RATE_LIMIT = Number(process.env.KRYEO_AI_RATE_LIMIT_PER_MINUTE || 30);
const MAX_BODY_BYTES = Number(process.env.KRYEO_AI_MAX_BODY_MB || 18) * 1024 * 1024;
const FAMILY_BATCH_SIZE = Math.max(1, Number(process.env.KRYEO_AI_FAMILY_BATCH_SIZE || 6));
const MODEL_TIMEOUT_MS = Math.max(10_000, Number(process.env.KRYEO_AI_MODEL_TIMEOUT_MS || 55_000));
const ANALYSIS_VERSION = 'family-v26';

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

  run(task) {
    if (this.waiting.length >= MAX_QUEUE) {
      return Promise.reject(new Error(`${this.name} queue is full. Try again shortly.`));
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

const modelQueue = new WorkQueue('Model', Number(process.env.KRYEO_AI_MODEL_CONCURRENCY || 1));
const rateWindows = new Map();
const familyCache = new Map();
let cacheWrite = Promise.resolve();

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
  const key = tokenIdentity(request);
  const now = Date.now();
  const window = (rateWindows.get(key) || []).filter((value) => now - value < 60_000);
  if (window.length >= RATE_LIMIT) return false;
  window.push(now);
  rateWindows.set(key, window);
  return true;
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

async function callModel(messages, maxTokens = 900, reasoningEffort = 'none', externalSignal) {
  return modelQueue.run(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    try {
      const response = await fetch(`${MODEL_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(MODEL_API_KEY ? { authorization: `Bearer ${MODEL_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: maxTokens,
          reasoning_effort: reasoningEffort,
          think: false,
          response_format: { type: 'json_object' },
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Model server error ${response.status}: ${body.slice(0, 500)}`);
      const parsed = JSON.parse(body);
      return parseModelJson(parsed.choices?.[0]?.message?.content);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`The model did not answer within ${Math.round(MODEL_TIMEOUT_MS / 1000)} seconds.`);
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  });
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
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function sourceIdentity(family, visualType, proposedName) {
  const candidates = family.members
    .map((member) => meaningfulSourceName(member.name))
    .filter(Boolean);
  const source = candidates[0] || '';
  const proposal = cleanText(proposedName, '');
  const opaqueProposal = !proposal
    || /^family\s*\d+\s*member\s*\d+$/i.test(readableSourceName(proposal))
    || /^variant\s*\d+$/i.test(readableSourceName(proposal));
  if (!source) {
    return {
      name: opaqueProposal ? 'Unlabelled visual' : proposal,
      type: visualType
    };
  }
  const sourceType = semanticTypeFromSource(source);
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

function normalizeAnalysis(raw, family) {
  const proposedType = ASSET_TYPES.includes(raw.assetType) ? raw.assetType : 'Unknown';
  const identity = sourceIdentity(family, proposedType, raw.familyName);
  const assetType = identity.type;
  const role = roleForAssetType(assetType);
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
  const confidence = evidencePresent ? confidenceScore(raw.confidence) : Math.min(0.55, confidenceScore(raw.confidence));
  const conflict = booleanValue(raw.conflict);
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: identity.name,
    assetType,
    role,
    memberNames: family.members.map((member, index) => ({
      visualHash: member.visualHash,
      name: sourceIdentity(
        { members: [member] },
        assetType,
        names.get(member.visualHash) || identity.name || `Variant ${index + 1}`,
      ).name,
    })),
    diveMode,
    reason: cleanText(raw.reason, 'The family needs user review.', 400),
    visualDescription: cleanText(raw.visualDescription, '', 500),
    confidence,
    evidence,
    conflict,
    conflictMessage: cleanText(raw.conflictMessage, '', 300),
    reviewNeeded: Boolean(
      booleanValue(raw.reviewNeeded)
      || conflict
      || !evidencePresent
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

function familyCacheKey(fingerprint, contextSignature = '') {
  return `${ANALYSIS_VERSION}:${MODEL}:${fingerprint}:${contextSignature}`;
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

function familyPrompt(families, context = {}) {
  const documentFamilies = Array.isArray(context.documentFamilies) ? context.documentFamilies : [];
  const requestedIds = new Set(families.map((family) => family.id));
  const requestedIndexes = documentFamilies
    .map((family, index) => (requestedIds.has(family.familyId) ? index : -1))
    .filter((index) => index >= 0);
  const firstIndex = requestedIndexes.length ? Math.max(0, Math.min(...requestedIndexes) - 1) : 0;
  const lastIndex = requestedIndexes.length
    ? Math.min(documentFamilies.length, Math.max(...requestedIndexes) + 2)
    : Math.min(documentFamilies.length, 3);
  const localDocumentContext = documentFamilies.slice(firstIndex, lastIndex);
  const content = [{
    type: 'text',
    text: [
      'Analyse these related visual-asset families for a reusable UI asset library.',
      'Judge appearance together with hierarchy and sibling context. Do not trust bad layer names over clear visual evidence.',
      'Treat a meaningful source name as supporting evidence, but correct it when the artwork clearly shows a different function.',
      'A clear semantic word in a human-authored layer name (for example Slot, Border, Background, Button, or Wallpaper) is a strong statement of intent. Preserve it in both type and name unless the rendered artwork directly and unambiguously contradicts it. Generic names, hashes, numeric exports, and default layer names are not semantic evidence.',
      'Separate identity from classification. Preserve meaningful source nouns that identify the reusable asset, while using visual evidence to refine its functional assetType.',
      'Nearby hierarchy and scene context explain an asset’s role, but ancestor, sibling, project, and scene names do not belong in the reusable asset name unless that identity is visibly intrinsic to the asset itself.',
      'When visual evidence changes only the functional type, retain the meaningful descriptive words from the source and replace only its type noun.',
      'Items inside one visual family are related variants and should normally share one coherent semantic type. Distinguish complete interactive components from their backgrounds, icons, borders, fills, textures, overlays, and effects.',
      'Visual similarity is supporting evidence only. Never copy a type or name from a nearby asset merely because the artwork has similar colors, proportions, ornamentation, or placement.',
      'Judge every supplied family as its own semantic asset. Closely related components and internal construction layers may still require different names and types.',
      'Use the document-family overview to keep siblings and nearby families coherent. Related construction pieces under one parent should use a shared naming root and compatible types unless their visible functions genuinely differ. Never repeat or stack type nouns in a generated name.',
      'When a parent and its children visibly form one designed motif, establish a distinctive visual identity for the parent and reuse that identity naturally for its backgrounds, borders, fills, and effects. Structural source names such as Middle, Outer Borders, Background, or Layer describe assembly roles and should not become the entire reusable identity.',
      'A Slot is a reusable cell or receptacle intended to hold an item, icon, or content. A Frame is structural framing or a complete window surround, not every square visual.',
      'Use Frame only when the artwork primarily encloses external content or structures a larger interface. A self-contained medallion, emblem, crest, seal, or decorative symbol should instead be judged as Badge, Icon, or Ornament according to its visible purpose, even when it has an outlined rim.',
      'Reserve Slot for a visibly reusable cell that receives selectable content. Classify passive construction and display elements by their own visible function rather than by nearby controls.',
      'A layer whose meaningful source name identifies it as a background is strong contextual evidence for Background when the visible artwork is an internal fill or foundational surface.',
      'A Wallpaper is complete composed scene artwork such as an environment, room, landscape, or illustrated location intended as a large backdrop. A Background is a foundational surface, panel, color field, or non-scene fill. Do not classify a detailed environment as Background merely because it is used behind UI.',
      'A full-canvas or large transparent layer is not automatically a Background. Use the visible alpha geometry: a thin perimeter is Border, a detailed composed environment is Wallpaper, a sparse treatment over another layer is Overlay, and a simple opaque surface is Background.',
      'A Texture is reusable surface material meant to fill or skin an object. An Overlay is a sparse or translucent treatment spanning other artwork. In exported previews, the checkerboard indicates transparent pixels and is not part of the asset.',
      'Use document stacking context: a canvas-sized transparent treatment composed with a nearby scene or background is an Overlay, while a Texture is a reusable material swatch independent of that composition.',
      'visualMetrics are measured from the exported PNG: visiblePixelRatio and opaquePixelRatio describe real alpha coverage, while edgeVisibleRatio and centerVisibleRatio describe where visible pixels occur. Use these measurements as evidence rather than guessing transparency from the checkerboard preview.',
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
      'Recommend children-only only when children are independently reusable assets; otherwise keep the assembled visual together.',
      `Allowed assetType values: ${ASSET_TYPES.join(', ')}.`,
      `Allowed role values: ${ROBLOX_ROLES.join(', ')}.`,
      'Return JSON: {"families":[{"familyId","familyName","assetType","role","memberNames":[{"visualHash","name"}],"diveMode","reason","reviewNeeded","alternatives":[{"assetType","reason"}]}]}.',
      'For each family include visualDescription, confidence from 0 to 1, evidence scores for visual, layerName, hierarchy, and learned context, plus conflict and conflictMessage when evidence sources disagree.',
      `Independent visual observations from pass one: ${JSON.stringify(context.descriptions || []).slice(0, 4200)}.`,
      `Confirmed user instructions: ${JSON.stringify((context.instructions || []).slice(0, 8)).slice(0, 900)}.`,
      `Project knowledge: ${JSON.stringify(context.projectKnowledge || null).slice(0, 700)}.`,
      `Nearby document families: ${JSON.stringify(localDocumentContext).slice(0, 2800)}.`,
      'Families:',
      ...families.map((family, familyIndex) => JSON.stringify({
        familyId: family.id,
        familyIndex: familyIndex + 1,
        parentNames: family.parentNames,
        hierarchyContext: family.hierarchyContext || [],
        exactInstanceCount: family.exactInstanceCount,
        members: family.members.map((member, memberIndex) => ({
          imageLabel: `family-${familyIndex + 1}-member-${memberIndex + 1}`,
          visualHash: member.visualHash,
          layerName: member.name,
          affinityType: member.affinityType,
          bounds: member.bounds,
          childCount: member.childHierarchyKeys.length,
          visualMetrics: member.visualMetrics || null,
        })),
      })),
    ].join('\n'),
  }];
  for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) {
    const family = families[familyIndex];
    for (let memberIndex = 0; memberIndex < Math.min(family.members.length, 6); memberIndex += 1) {
      const member = family.members[memberIndex];
      content.push({ type: 'text', text: `Image family-${familyIndex + 1}-member-${memberIndex + 1}` });
      if (isVisionSafeDataUrl(member.previewUrl)) {
        content.push({ type: 'image_url', image_url: { url: member.previewUrl } });
      } else {
        content.push({ type: 'text', text: 'Preview omitted because this client supplied an unsupported image size.' });
      }
      const description = (context.descriptions || []).find((item) => item.familyId === family.id);
      const detailLimit = description?.needsDetail ? 4 : 0;
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
  if (needsCompositeContext && isVisionSafeDataUrl(context.documentPreviewUrl)) {
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
      'Return exactly this JSON shape: {"families":[{"familyId","familyName","assetType","role","memberNames":[{"visualHash","name"}],"diveMode","reason","visualDescription","confidence","evidence":{"visual","layerName","hierarchy","learned"},"conflict","conflictMessage","reviewNeeded","alternatives":[{"assetType","reason"}]}]}.',
      `assetType must be exactly one of: ${ASSET_TYPES.join(', ')}. role must be exactly one of: ${ROBLOX_ROLES.join(', ')}.`,
      'Use Unknown only if the preview is absent or unreadable. Never use an image label such as family-1, Picture 1, or an opaque source identifier as a name.',
      'Copy each supplied familyId and visualHash exactly. Base names and types on the visible artwork, document context, and distinctions above.',
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

async function classifyFamilyBatch(families, context, descriptions, signal) {
  const output = await callModel([
    {
      role: 'system',
      content: 'You are Kryeo visual intelligence. Observe each asset before deciding its name and type, compare related UI assets jointly, and return only schema-valid JSON.',
    },
    { role: 'user', content: familyPrompt(families, { ...context, descriptions }) },
  ], Math.max(1000, Math.min(2200, families.length * 220)), 'none', signal);
  const rawFamilies = [];
  const visited = new Set();
  const collect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4 || visited.has(value)) return;
    visited.add(value);
    if (
      !Array.isArray(value)
      && value.familyId
      && (value.familyName || value.assetType || Array.isArray(value.memberNames))
    ) {
      rawFamilies.push(value);
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) collect(child, depth + 1);
  };
  collect(output);
  if (!rawFamilies.length) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, 'last-unrecognized-model-output.json'),
      JSON.stringify(output, null, 2),
      'utf8',
    );
    throw new Error('The model returned JSON without a visual-family analysis.');
  }
  const rawById = new Map(rawFamilies.map((item) => [String(item.familyId || ''), item]));
  if (families.length === 1 && rawFamilies.length === 1) rawById.set(families[0].id, rawFamilies[0]);
  if (families.length > 1 && rawFamilies.length === families.length) {
    families.forEach((family, index) => {
      if (!rawById.has(family.id)) rawById.set(family.id, rawFamilies[index]);
    });
  }
  const missing = families.filter((family) => !rawById.has(family.id));
  if (missing.length) throw new Error(`The model omitted ${missing.length} requested visual ${missing.length === 1 ? 'family' : 'families'}.`);
  return families.map((family) => normalizeAnalysis({
    ...(rawById.get(family.id) || {}),
    visualDescription: rawById.get(family.id)?.visualDescription
      || descriptions.find((item) => item.familyId === family.id)?.description,
  }, family));
}

async function analyzeFamilyBatch(families, context, signal) {
  // The classification prompt already observes each supplied image before deciding.
  // Keeping the normal path to one multimodal call avoids doubling latency without
  // improving the final schema result.
  return classifyFamilyBatch(families, context, [], signal);
}

async function persistCache() {
  const serializable = Object.fromEntries(familyCache);
  cacheWrite = cacheWrite.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = `${CACHE_PATH}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(serializable), 'utf8');
    await fs.rename(temporary, CACHE_PATH);
  });
  await cacheWrite;
}

async function analyzeFamilies(payload, signal) {
  const families = Array.isArray(payload.families) ? payload.families.slice(0, 48) : [];
  if (!families.length) throw new Error('No unresolved visual families were supplied.');
  const requestId = randomUUID();
  const analyses = [];
  const unresolved = [];
  const failures = [];
  let cached = 0;
  const sharedContext = JSON.stringify({
    instructions: Array.isArray(payload.instructions) ? payload.instructions.slice(0, 30) : [],
    projectKnowledge: payload.projectKnowledge || null,
  });
  for (const family of families) {
    const contextSignature = createHash('sha256')
      .update(sharedContext)
      .update(JSON.stringify(family.hierarchyContext || []))
      .digest('hex')
      .slice(0, 16);
    family.cacheContextSignature = contextSignature;
    const record = familyCache.get(familyCacheKey(String(family.fingerprint || ''), contextSignature));
    if (record) {
      analyses.push(normalizeAnalysis(record, family));
      cached += 1;
    } else {
      unresolved.push(family);
    }
  }
  const analysisContext = {
    instructions: Array.isArray(payload.instructions) ? payload.instructions.slice(0, 30) : [],
    projectKnowledge: payload.projectKnowledge || null,
    documentPreviewUrl: payload.documentPreviewUrl || '',
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
    for (const result of results) {
      analyses.push(result);
      const family = sourceFamilies.find((item) => item.id === result.familyId);
      familyCache.set(familyCacheKey(result.fingerprint, family?.cacheContextSignature || ''), result);
    }
    await persistCache();
  };
  for (let index = 0; index < unresolved.length; index += FAMILY_BATCH_SIZE) {
    const batch = unresolved.slice(index, index + FAMILY_BATCH_SIZE);
    try {
      await storeResults(await analyzeFamilyBatch(batch, analysisContext, signal), batch);
    } catch (error) {
      if (batch.length === 1 || signal?.aborted) {
        failures.push({
          familyIds: batch.map((family) => family.id),
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const family of batch) {
        try {
          await storeResults(await analyzeFamilyBatch([family], analysisContext, signal), [family]);
        } catch (familyError) {
          failures.push({
            familyIds: [family.id],
            message: familyError instanceof Error ? familyError.message : String(familyError),
          });
        }
      }
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
    familyCache.set(familyCacheKey(analysis.fingerprint, family?.cacheContextSignature || ''), analysis);
  }
  await persistCache();
  return { requestId, cached, analyses, failures };
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
          'Do not propagate Slot across nearby or visually similar assets. Internal backgrounds, fixed holders, emblems, frames, and panels retain their own semantic function.',
          'Corner and edge fragments that assemble or imply one enclosing family remain Border, not Ornament.',
          'Sibling variants with one parent and one semantic type use a shared root numbered in document order. Preserve a suffix only for a genuine state, direction, or effect.',
          'A multi-child group uses a distinctive plural collection name derived from its visible motif or function. Its reusable children use the singular form of that identity followed by sequential numbers.',
          'When related parent and child assets visibly form one motif, preserve a coherent visual identity across the parent and its backgrounds, borders, fills, and effects. Do not use structural source words such as Middle or Outer Borders as the complete identity.',
          'Do not retain camel case, joined source words, hyphenated construction labels, or generic collection names when a clearer visual identity is available.',
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
    for (const [key, value] of Object.entries(parsed)) familyCache.set(key, value);
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
        queueDepth: modelQueue.depth,
        message: 'Kryeo AI is ready.',
      });
    }
    if (!withinRateLimit(request)) return json(response, 429, { error: 'Rate limit reached. Try again shortly.' });

    const payload = await readJson(request);
    const requestController = new AbortController();
    request.once('aborted', () => requestController.abort());
    response.once('close', () => {
      if (!response.writableEnded) requestController.abort();
    });
    if (request.method === 'POST' && request.url === '/v1/families/analyze') {
      return json(response, 200, await analyzeFamilies(payload, requestController.signal));
    }
    if (request.method === 'POST' && request.url === '/v1/documents/reconcile') {
      return json(response, 200, await reconcileDocument(payload));
    }
    if (request.method === 'POST' && request.url === '/v1/chat') {
      return json(response, 200, await chat(payload));
    }
    return json(response, 404, { error: 'Route not found.' });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return json(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Kryeo AI listening on http://${HOST}:${PORT} using ${MODEL}\n`);
  if (!TOKENS.length) process.stdout.write('Authentication is disabled for loopback development only.\n');
});
