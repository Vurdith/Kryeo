import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type {
  AssistantAction,
  AssistantChatRequest,
  AssistantMemory,
  AssistantStatus,
  ComponentAssetType,
  WorkspaceSnapshot,
} from '../shared/types';

export type AssistantModelPack = 'portable' | 'balanced';
const MODEL_PACKS: Record<AssistantModelPack, {
  id: string;
  label: string;
  description: string;
  minimumMemoryGB: number;
}> = {
  portable: {
    id: 'LiquidAI/LFM2.5-VL-450M-ONNX',
    label: 'LFM2.5-VL 450M',
    description: 'Fast CPU-first visual review and local chat for modern systems.',
    minimumMemoryGB: 6,
  },
  balanced: {
    id: 'LiquidAI/LFM2.5-VL-1.6B-ONNX',
    label: 'LFM2.5-VL 1.6B',
    description: 'More accurate visual reasoning for ambiguous UI components; about 1.5 GB.',
    minimumMemoryGB: 12,
  },
};
const MODEL_LICENSE_URL = 'https://huggingface.co/LiquidAI/LFM2.5-VL-450M/resolve/main/LICENSE';
const VISUAL_ASSET_TYPES: ComponentAssetType[] = [
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay',
  'Cursor', 'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner',
  'Edge', 'Fill', 'FX',
];

export interface AssetVisualReview {
  assetType: ComponentAssetType;
  name: string;
  confidence: number;
  reason: string;
}

export interface AssetVisualEvidence {
  width: number;
  height: number;
  affinityType: string;
  childCount: number;
  textCount: number;
  currentType?: ComponentAssetType;
  currentConfidence?: number;
  currentSource?: 'model' | 'memory' | 'name';
  alternatives?: Array<{ assetType: ComponentAssetType; score: number }>;
  parentType?: ComponentAssetType;
  childTypes?: ComponentAssetType[];
}

interface AssistantVisualContext {
  images: Array<{ imagePath: string; label: string }>;
  documentTitle: string;
  documentSessionUuid: string;
}

interface TensorValue {
  dims: number[];
  slice(...args: unknown[]): unknown;
}

interface ModelInputs extends Record<string, unknown> {
  input_ids: TensorValue;
}

interface MultimodalModel {
  generate(inputs: Record<string, unknown>): Promise<TensorValue>;
}

interface MultimodalProcessor {
  (image: unknown, prompt: string, options: Record<string, unknown>): Promise<ModelInputs>;
  apply_chat_template(messages: unknown[], options: Record<string, unknown>): string;
  batch_decode(value: unknown, options: Record<string, unknown>): string[];
  tokenizer: {
    (prompt: string, options: Record<string, unknown>): ModelInputs;
    apply_chat_template(messages: unknown[], options: Record<string, unknown>): ModelInputs;
  };
}

interface ModelBundle {
  model: MultimodalModel;
  processor: MultimodalProcessor;
  RawImage: {
    read(input: string): Promise<unknown>;
    fromTensor(tensor: unknown, channelFormat?: string): unknown;
  };
  Tensor: new(type: string, data: Uint8Array, dims: number[]) => unknown;
}

const TOOLS = [
  {
    name: 'open_component_scan',
    description: 'Open Kryeo Component Scan when the user asks to scan, identify, classify, or organize Affinity layers into reusable UI components.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'review_asset_library',
    description: 'Open the Kryeo asset library when the user asks to find, inspect, compare, or review saved assets and versions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_workflows',
    description: 'Open Kryeo workflows when the user asks to export, shade, mirror, update, save, or run an Affinity workflow.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

function memoryKind(text: string): AssistantMemory['kind'] {
  if (/name|rename|called|code name/i.test(text)) return 'naming';
  if (/group|child|children|nested|inside|together|separate/i.test(text)) return 'hierarchy';
  if (/classif|type|button|slot|bar|frame|icon|label|panel/i.test(text)) return 'classification';
  return 'instruction';
}

function isDirectClassificationRule(message: string): boolean {
  const text = message.trim();
  if (text.endsWith('?') || /^(?:what|why|how|when|where|can|could|should|is|are|do|does)\b/i.test(text)) return false;
  return /\b(?:is|are|should be|must be)\s+(?:a |an )?(?:image\s*buttons?|image\s*labels?|text\s*buttons?|text\s*labels?|text\s*boxes|frames?|progress\s*bars?|scroll\s*bars?|buttons?|slots?|panels?|icons?|labels?|backgrounds?|decorations?|containers?|images?)\b/i.test(text);
}

function extractMemories(project: string, documentTitle: string, message: string): AssistantMemory[] {
  const directClassification = isDirectClassificationRule(message);
  if (!directClassification && !/\b(remember|always|every|treat|prefer|never|do not|don't|keep|ignore)\b/i.test(message)) return [];
  const text = message.trim().replace(/^remember(?: that| this)?\s*/i, '').slice(0, 360);
  if (text.length < 5) return [];
  const global = /\bglobally|all projects|every project|across projects\b/i.test(message);
  return [{ id: randomUUID(), project: global ? 'General' : project, scope: global ? 'global' : 'project', documentTitle, kind: memoryKind(text), text, createdAt: new Date().toISOString() }];
}

function isGreeting(message: string): boolean {
  const text = message.trim();
  return text.split(/\s+/).length <= 16
    && /^(?:hi|hey|hello|hiya|yo|good (?:morning|afternoon|evening)|how are you|how's it going)\b/i.test(text)
    && !/\b(scan|organize|organise|classify|save|place|export|open|run|update)\b/i.test(text);
}

function isCasual(message: string): boolean {
  return isGreeting(message) || /^(?:thanks|thank you|nice|cool|great|okay|ok|who are you|what can you do)[!,.?\s]*$/i.test(message.trim());
}

export function shouldUseAssistantVision(message: string): boolean {
  return !isCasual(message);
}

function proposedActions(message: string): AssistantAction[] {
  const actions: AssistantAction[] = [];
  if (/scan|organize|organise|component|layer|classif/i.test(message)) actions.push(actionForTool('open_component_scan'));
  if (/asset|library|duplicate|version/i.test(message)) actions.push(actionForTool('review_asset_library'));
  if (/export|workflow|shade|mirror|tool/i.test(message)) actions.push(actionForTool('open_workflows'));
  return actions.filter(Boolean).slice(0, 2) as AssistantAction[];
}

function actionForTool(tool: string): AssistantAction {
  if (tool === 'open_component_scan') return {
    id: randomUUID(), type: 'open-component-scan', label: 'Review component plan',
    description: 'Open Component Scan with the assistant findings available. Affinity is not changed until you approve the review.',
  };
  if (tool === 'review_asset_library') return {
    id: randomUUID(), type: 'review-assets', label: 'Review asset library',
    description: 'Open indexed assets to inspect versions, visual families, and production health.',
  };
  return {
    id: randomUUID(), type: 'open-workflows', label: 'Open workflows',
    description: 'Choose the matching Kryeo workflow. Nothing runs without your confirmation.',
  };
}

function toolFromOutput(value: string): string {
  const native = value.match(/<\|tool_call_start\|>\s*\[?\s*([a-z_]+)\s*\(/i)?.[1];
  if (native && TOOLS.some((tool) => tool.name === native)) return native;
  const json = value.match(/"tool"\s*:\s*"([a-z_]+)"/i)?.[1];
  return json && TOOLS.some((tool) => tool.name === json) ? json : '';
}

function wordSet(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((word) => !['this', 'that', 'with', 'from', 'when', 'what', 'have', 'should'].includes(word)));
}

function relevantMemory(message: string, memories: AssistantMemory[]): AssistantMemory | undefined {
  const words = wordSet(message);
  return memories
    .map((memory) => ({ memory, score: [...wordSet(memory.text)].filter((word) => words.has(word)).length }))
    .sort((left, right) => right.score - left.score)
    .find((item) => item.score > 0)?.memory;
}

function safeResponse(value: string): string {
  const withoutTools = value
    .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/^```(?:json)?|```$/gim, '')
    .trim();
  const lines = withoutTools
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/\b(i (?:will|have|added|changed|created|removed|moved)|i'm going to|has been (?:set up|changed|added)|done\b)/i.test(line));
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export function cleanAssetName(value: string): string {
  const cleaned = safeResponse(value)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:name|asset name)\s*:\s*/i, '')
    .replace(/^(?:reusable\s+)?(?:game\s+)?ui\s*:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\b(?:image|asset|graphic|picture)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(' ')
    .slice(0, 64);
  if (
    cleaned.replace(/[^a-z0-9]/gi, '').length <= 1
    || /\b(?:reusable|asset library|game ui asset|return only|concise|do not include|name this)\b/i.test(cleaned)
  ) return '';
  return cleaned;
}

export function parseAssetVisualReview(value: string): AssetVisualReview | null {
  const plain = value
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/^```(?:json)?|```$/gim, '')
    .trim();
  type ReviewJson = { assetType?: string; name?: string; confidence?: number; reason?: string };
  let parsed: ReviewJson | null = null;
  try {
    const json = plain.match(/\{[\s\S]*\}/)?.[0];
    if (json) parsed = JSON.parse(json) as ReviewJson;
  } catch {
    parsed = null;
  }
  const separator = plain.match(/^([^|\n:]+)\s*(?:\||:)\s*([^|\n]+)(?:\|\s*([0-9.]+))?(?:\|\s*(.+))?$/);
  const rawType = parsed?.assetType || separator?.[1] || '';
  const rawName = parsed?.name || separator?.[2] || '';
  const normalizedType = rawType.replace(/[\s_-]+/g, '').toLowerCase();
  const assetType = VISUAL_ASSET_TYPES.find((type) => type.replace(/[\s_-]+/g, '').toLowerCase() === normalizedType);
  const name = cleanAssetName(rawName);
  const confidenceValue = Number(parsed?.confidence ?? separator?.[3] ?? 0.5);
  const confidence = Math.max(0, Math.min(1, confidenceValue > 1 ? confidenceValue / 100 : confidenceValue));
  const reason = safeResponse(parsed?.reason || separator?.[4] || 'Visual reviewer consensus.').slice(0, 180);
  return assetType && name ? { assetType, name, confidence, reason } : null;
}

export function shouldReviewAssetVisual(
  source: 'model' | 'memory' | 'name',
  confidence: number,
  _alternatives: Array<{ assetType: ComponentAssetType; score: number }> = [],
  childCount = 0,
): boolean {
  if (source === 'memory') return false;
  return confidence < 0.62 || (childCount > 0 && confidence < 0.72);
}

export function acceptAssetVisualReview(
  review: AssetVisualReview,
  evidence: AssetVisualEvidence,
): boolean {
  if (review.assetType === 'Unknown' || review.confidence < 0.58) return false;
  if (!evidence.currentType || evidence.currentType === 'Unknown') return review.confidence >= 0.72;
  if (review.assetType === evidence.currentType) return true;
  const currentTypeSupportedByHierarchy = evidence.parentType === evidence.currentType
    || (evidence.childTypes || []).filter((type) => type === evidence.currentType).length >= 2;
  if (currentTypeSupportedByHierarchy) return false;
  if (evidence.currentSource === 'model' && (evidence.currentConfidence || 0) < 0.62) {
    return review.confidence >= 0.78;
  }
  return false;
}

function asksForVisualDescription(message: string): boolean {
  return /\b(what (?:do you see|does .* look like|is visible)|describe|inspect|identify (?:what|the visible)|look at)\b/i.test(message);
}

function contradictsSuppliedContext(message: string): boolean {
  return /(?:do not|don't|cannot|can't|unable to|no) (?:have )?access|cannot see|can't see|as (?:an|a) ai/i.test(message);
}

function toolReply(tool: string, visionSummary: string): string {
  const observation = visionSummary ? `I inspected the active document. ${visionSummary}\n\n` : '';
  if (tool === 'open_component_scan') return `${observation}I can open Component Scan so you can review the proposed components and hierarchy before anything changes.`;
  if (tool === 'review_asset_library') return `${observation}I can open the asset library so you can review the matching assets and saved versions.`;
  return `${observation}I can open Workflows so you can choose and confirm the operation.`;
}

export class AssistantService {
  private bundle: Promise<ModelBundle> | null = null;
  private bundlePack: AssistantModelPack | null = null;
  private loading = false;
  private progress = 0;
  private stage = 'Not installed';
  private readonly dataPath: () => string;

  constructor(dataPath: () => string) {
    this.dataPath = dataPath;
  }

  private cacheDirectory(): string {
    return process.env.KRYEO_AI_CACHE_DIR || path.join(this.dataPath(), 'IntelligencePack');
  }

  private markerPath(): string {
    return path.join(this.cacheDirectory(), 'installed.json');
  }

  private memoryGB(): number {
    return Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  }

  private profile(): AssistantStatus['profile'] {
    if (this.memoryGB() >= 24) return 'enhanced';
    return this.memoryGB() >= 12 ? 'balanced' : 'compatibility';
  }

  private recommendedPack(): AssistantModelPack {
    return this.memoryGB() >= MODEL_PACKS.balanced.minimumMemoryGB ? 'balanced' : 'portable';
  }

  private async installationMarker(): Promise<{
    activePack: AssistantModelPack;
    models: Partial<Record<AssistantModelPack, { installedAt: string }>>;
  }> {
    return fs.readFile(this.markerPath(), 'utf8').then((contents) => {
      const marker = JSON.parse(contents) as {
        model?: string;
        activePack?: AssistantModelPack;
        models?: Partial<Record<AssistantModelPack, { installedAt: string }>>;
        installedAt?: string;
      };
      if (marker.activePack && marker.models) return { activePack: marker.activePack, models: marker.models };
      const legacyPack = Object.entries(MODEL_PACKS).find(([, pack]) => pack.id === marker.model)?.[0] as AssistantModelPack | undefined;
      return {
        activePack: legacyPack || 'portable',
        models: legacyPack ? { [legacyPack]: { installedAt: marker.installedAt || new Date().toISOString() } } : {},
      };
    }).catch(() => ({ activePack: 'portable' as const, models: {} }));
  }

  async status(): Promise<AssistantStatus> {
    const marker = await this.installationMarker();
    const activePack = marker.activePack;
    const installed = Boolean(marker.models[activePack]);
    const activeModel = MODEL_PACKS[activePack];
    return {
      installed,
      ready: Boolean(this.bundle) && installed,
      loading: this.loading,
      model: activeModel.label,
      message: this.loading ? this.stage : installed ? 'Local multimodal intelligence is installed.' : 'Install the local vision and language model to enable document-aware chat.',
      progress: this.progress,
      stage: this.stage,
      vision: true,
      toolCalling: true,
      profile: this.profile(),
      memoryGB: this.memoryGB(),
      modelPack: activePack,
      recommendedProfile: this.profile(),
      availableModelPacks: (Object.entries(MODEL_PACKS) as Array<[AssistantModelPack, typeof MODEL_PACKS.portable]>).map(([id, pack]) => ({
        id,
        name: id === 'portable' ? 'Portable' : 'Balanced vision',
        installed: Boolean(marker.models[id]),
        recommended: this.recommendedPack() === id,
        description: pack.description,
      })),
    };
  }

  private updateProgress(event: unknown): void {
    if (!event || typeof event !== 'object') return;
    const value = event as { status?: string; progress?: number; file?: string };
    if (value.status === 'progress' && typeof value.progress === 'number') this.progress = Math.max(1, Math.min(99, Math.round(value.progress)));
    if (value.file) this.stage = `Preparing ${path.basename(value.file).replace(/\.onnx(?:_data)?$/i, '')}`;
  }

  private async load(requestedPack?: AssistantModelPack): Promise<ModelBundle> {
    const marker = await this.installationMarker();
    const pack = requestedPack || marker.activePack;
    const modelConfig = MODEL_PACKS[pack];
    if (this.bundle && this.bundlePack === pack) return this.bundle;
    this.bundle = null;
    this.bundlePack = pack;
    this.loading = true;
    this.progress = 1;
    this.stage = 'Starting local model';
    this.bundle = (async () => {
      await fs.mkdir(this.cacheDirectory(), { recursive: true });
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = this.cacheDirectory();
      transformers.env.allowRemoteModels = true;
      const progress_callback = (event: unknown) => this.updateProgress(event);
      const model = await transformers.AutoModelForImageTextToText.from_pretrained(modelConfig.id, {
        device: 'cpu',
        dtype: { vision_encoder: 'q4', embed_tokens: 'fp16', decoder_model_merged: 'q4' },
        progress_callback,
      }) as unknown as MultimodalModel;
      this.stage = 'Loading language and vision processor';
      const processor = await transformers.AutoProcessor.from_pretrained(modelConfig.id, { progress_callback }) as unknown as MultimodalProcessor;
      const currentMarker = await this.installationMarker();
      const installedAt = new Date().toISOString();
      await fs.writeFile(this.markerPath(), JSON.stringify({
        activePack: pack,
        models: { ...currentMarker.models, [pack]: { installedAt } },
        profile: this.profile(),
      }, null, 2), 'utf8');
      await fetch(MODEL_LICENSE_URL).then((response) => response.ok ? response.text() : '').then((license) => license ? fs.writeFile(path.join(this.cacheDirectory(), 'LFM-LICENSE.txt'), license, 'utf8') : undefined).catch(() => undefined);
      await fs.rm(path.join(this.cacheDirectory(), 'onnx-community', 'SmolLM2-360M-Instruct-ONNX'), { recursive: true, force: true }).catch(() => undefined);
      this.progress = 100;
      this.stage = 'Ready';
      return { model, processor, RawImage: transformers.RawImage, Tensor: transformers.Tensor } as ModelBundle;
    })();
    try {
      return await this.bundle;
    } catch (error) {
      this.bundle = null;
      this.bundlePack = null;
      this.progress = 0;
      this.stage = 'Installation failed';
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async install(pack: AssistantModelPack = 'portable'): Promise<AssistantStatus> {
    await this.load(pack);
    return this.status();
  }

  private async prepareImage(bundle: ModelBundle, imagePath: string): Promise<unknown> {
    const { data, info } = await sharp(imagePath, { failOn: 'error' })
      .toColourspace('srgb')
      .flatten({ background: '#7f7f7f' })
      .resize({ width: 512, height: 512, fit: 'contain', background: '#7f7f7f' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tensor = new bundle.Tensor('uint8', new Uint8Array(data), [info.height, info.width, info.channels]);
    return bundle.RawImage.fromTensor(tensor, 'HWC');
  }

  private async prepareReviewImage(bundle: ModelBundle, imagePath: string): Promise<unknown> {
    const source = sharp(imagePath, { failOn: 'error' }).toColourspace('srgb').ensureAlpha();
    const checker = await source.clone()
      .flatten({ background: '#7f7f7f' })
      .resize({ width: 256, height: 256, fit: 'contain', background: '#7f7f7f' })
      .png()
      .toBuffer();
    const light = await source.clone()
      .flatten({ background: '#eeeeee' })
      .resize({ width: 256, height: 256, fit: 'contain', background: '#eeeeee' })
      .png()
      .toBuffer();
    const trimmed = await source.clone()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .flatten({ background: '#7f7f7f' })
      .resize({ width: 256, height: 256, fit: 'contain', background: '#7f7f7f' })
      .png()
      .toBuffer()
      .catch(() => checker);
    const metadata = await source.metadata();
    const width = Math.max(1, metadata.width || 1);
    const height = Math.max(1, metadata.height || 1);
    const cropWidth = Math.max(1, Math.round(width * 0.62));
    const cropHeight = Math.max(1, Math.round(height * 0.62));
    const detail = await source.clone()
      .extract({
        left: Math.max(0, Math.floor((width - cropWidth) / 2)),
        top: Math.max(0, Math.floor((height - cropHeight) / 2)),
        width: cropWidth,
        height: cropHeight,
      })
      .flatten({ background: '#7f7f7f' })
      .resize({ width: 256, height: 256, fit: 'contain', background: '#7f7f7f' })
      .png()
      .toBuffer();
    const { data, info } = await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#7f7f7f' },
    })
      .composite([
        { input: checker, left: 0, top: 0 },
        { input: light, left: 256, top: 0 },
        { input: trimmed, left: 0, top: 256 },
        { input: detail, left: 256, top: 256 },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tensor = new bundle.Tensor('uint8', new Uint8Array(data), [info.height, info.width, info.channels]);
    return bundle.RawImage.fromTensor(tensor, 'HWC');
  }

  private async describeImageStructure(imagePath: string, evidence: AssetVisualEvidence): Promise<string> {
    const size = 64;
    const { data } = await sharp(imagePath, { failOn: 'error' })
      .ensureAlpha()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let visible = 0;
    let centerVisible = 0;
    let centerPixels = 0;
    let edgeVisible = 0;
    let edgePixels = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const alpha = data[(y * size + x) * 4 + 3] / 255;
        visible += alpha;
        const center = x >= 19 && x < 45 && y >= 19 && y < 45;
        if (center) {
          centerVisible += alpha;
          centerPixels += 1;
        } else {
          edgeVisible += alpha;
          edgePixels += 1;
        }
      }
    }
    const percent = (value: number) => `${Math.round(value * 100)}%`;
    return [
      `${evidence.width} by ${evidence.height} pixels`,
      `aspect ratio ${(evidence.width / Math.max(1, evidence.height)).toFixed(2)}`,
      `${percent(visible / (size * size))} visible coverage`,
      `${percent(centerVisible / Math.max(1, centerPixels))} center coverage`,
      `${percent(edgeVisible / Math.max(1, edgePixels))} outer coverage`,
      `Affinity structure ${evidence.affinityType}`,
      `${evidence.childCount} direct children`,
      `${evidence.textCount} text descendants`,
    ].join(', ');
  }

  async suggestAssetName(imagePath: string, assetType: string): Promise<string> {
    const status = await this.status();
    if (!status.installed) return '';
    const bundle = await this.load();
    this.stage = 'Naming visual components';
    try {
      const image = await this.prepareImage(bundle, imagePath);
      const messages = [{
        role: 'user',
        content: [
          { type: 'image' },
          {
            type: 'text',
            text: `Name this ${assetType.toLowerCase()} for a reusable game UI asset library. Infer the likely interface function from recognizable iconography and composition, such as close, back, settings, play, confirm, inventory, or navigation, instead of naming a letter or geometric mark. For non-controls, describe the visible subject, setting, material, or motif. Return only a concise 2 to 5 word asset name. Do not include explanations, parentheses, quotes, punctuation, numbering, "image", or "asset".`,
          },
        ],
      }];
      const prompt = bundle.processor.apply_chat_template(messages, { add_generation_prompt: true });
      const inputs = await bundle.processor(image, prompt, { add_special_tokens: false });
      const outputs = await bundle.model.generate({ ...inputs, do_sample: false, max_new_tokens: 18, repetition_penalty: 1.12 });
      return cleanAssetName(this.decode(bundle, outputs, inputs));
    } finally {
      this.stage = 'Ready';
    }
  }

  async reviewAssetVisual(imagePath: string, evidence?: AssetVisualEvidence): Promise<AssetVisualReview | null> {
    const status = await this.status();
    if (!status.installed) return null;
    const bundle = await this.load();
    this.stage = 'Reviewing visual components';
    try {
      const image = await this.prepareReviewImage(bundle, imagePath);
      const structure = evidence ? await this.describeImageStructure(imagePath, evidence) : 'No structural metadata was supplied.';
      const candidateContext = evidence
        ? `Fast visual pass: ${evidence.currentType || 'Unknown'} at ${Math.round((evidence.currentConfidence || 0) * 100)}%. Other candidates: ${(evidence.alternatives || []).map((item) => item.assetType).join(', ') || 'none'}. Parent: ${evidence.parentType || 'none'}. Children: ${(evidence.childTypes || []).join(', ') || 'none'}.`
        : '';
      const messages = [{
        role: 'user',
        content: [
          { type: 'image' },
          {
            type: 'text',
            text: `Act as a cautious second-pass UI asset reviewer. The image is a four-view evidence board: full render on gray, full render on light, transparency-trimmed render, and center detail. Compare the full visible composition, transparency, geometry, hierarchy, and likely interaction. Ignore filenames and layer names. Neutral measurements: ${structure}. ${candidateContext}

Use these functional distinctions:
- Wallpaper: a complete scene or full-canvas artwork behind the interface.
- Background: a non-interactive backing surface behind another component or content.
- Frame, Panel, or Modal: structural interface chrome or a container that visibly encloses content.
- Border, Corner, Edge, or Ornament: transparent decorative construction pieces around content.
- Overlay: a translucent full-area treatment placed over other content.
- Texture: a repeatable or surface pattern rather than a complete scene.
- Bar, ScrollBar, Divider, Fill: elongated progress, scrolling, separator, or interior-fill elements.
- Button: an action control, especially a backing combined with a recognizable action symbol such as close, confirm, back, or play.
- Slot: an empty receptacle or item cell intended to hold content, without an action symbol defining a command.
- Tab, Tile, Input, TextBox: other interactive controls.
- Icon, Badge, Cursor, Label, Text, Tooltip, FX: symbols, text, pointers, hints, or visual effects.

Choose exactly one type from: ${VISUAL_ASSET_TYPES.join(', ')}. Briefly compare the plausible candidates internally, but do not output private reasoning. Give a concise 2 to 5 word functional visual name. Return only JSON:
{"assetType":"Button","name":"Close Button","confidence":0.82,"reason":"Visible X control on a button backing"}`,
          },
        ],
      }];
      const prompt = bundle.processor.apply_chat_template(messages, { add_generation_prompt: true });
      const inputs = await bundle.processor(image, prompt, { add_special_tokens: false });
      const outputs = await bundle.model.generate({ ...inputs, do_sample: false, max_new_tokens: 64, repetition_penalty: 1.1 });
      return parseAssetVisualReview(this.decode(bundle, outputs, inputs));
    } finally {
      this.stage = 'Ready';
    }
  }

  private decode(bundle: ModelBundle, outputs: TensorValue, inputs: ModelInputs, keepSpecialTokens = false): string {
    const inputLength = inputs.input_ids.dims.at(-1) || 0;
    const generated = outputs.slice(null, [inputLength, null]);
    return bundle.processor.batch_decode(generated, { skip_special_tokens: !keepSpecialTokens })[0]?.trim() || '';
  }

  private async perceive(bundle: ModelBundle, visual: AssistantVisualContext): Promise<string> {
    this.stage = 'Reading active document';
    const observations: string[] = [];
    for (const [index, visualImage] of visual.images.entries()) {
      this.stage = index === 0 ? 'Reading document overview' : `Inspecting detail ${index} of ${visual.images.length - 1}`;
      const image = await this.prepareImage(bundle, visualImage.imagePath);
      const messages = [{
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: `This is ${visualImage.label} from an Affinity UI document. Inspect it conservatively. Distinguish real interface components from background artwork, guides, empty transparency, and grid lines. Identify clearly visible controls, bars, icons, containers, text, and reusable decorative parts. Describe spatial relationships. Do not invent hidden controls. Use at most 55 words.` },
        ],
      }];
      const prompt = bundle.processor.apply_chat_template(messages, { add_generation_prompt: true });
      const inputs = await bundle.processor(image, prompt, { add_special_tokens: false });
      const outputs = await bundle.model.generate({ ...inputs, do_sample: false, max_new_tokens: 82, repetition_penalty: 1.08 });
      const observation = safeResponse(this.decode(bundle, outputs, inputs));
      if (observation) observations.push(`${visualImage.label}: ${observation}`);
    }
    return observations.join('\n').slice(0, 3200);
  }

  private async plan(bundle: ModelBundle, messages: Array<{ role: string; content: string }>): Promise<{ text: string; tool: string }> {
    this.stage = 'Planning response';
    const inputs = bundle.processor.tokenizer.apply_chat_template(messages, {
      tools: TOOLS,
      add_generation_prompt: true,
      tokenize: true,
      return_tensor: true,
      return_dict: true,
    });
    const outputs = await bundle.model.generate({ ...inputs, do_sample: false, max_new_tokens: 160, repetition_penalty: 1.08 });
    const raw = this.decode(bundle, outputs, inputs, true);
    return { text: safeResponse(raw), tool: toolFromOutput(raw) };
  }

  async chat(
    request: AssistantChatRequest,
    workspace: WorkspaceSnapshot,
    visual?: AssistantVisualContext,
  ): Promise<{ text: string; memories: AssistantMemory[]; actions: AssistantAction[]; visionUsed: boolean }> {
    const project = request.project.trim() || request.document.title || 'General';
    const learnedMemories = extractMemories(project, request.document.title, request.message);
    if (learnedMemories.length) {
      return {
        text: `Confirmed project rule: ${learnedMemories[0].text}\n\nKryeo will apply this rule to future component reviews. Affinity remains unchanged until you approve a review.`,
        memories: learnedMemories,
        actions: proposedActions(request.message),
        visionUsed: false,
      };
    }
    if (isGreeting(request.message)) {
      return {
        text: `Hi! I'm doing well and ready to help. ${project === 'General' ? 'We can talk through your Kryeo workflow' : `We can work through ${project}`}, inspect the active Affinity document, organize components, or plan how assets should reach Roblox Studio. What are you working on?`,
        memories: [], actions: [], visionUsed: false,
      };
    }

    const memories = workspace.assistantMemories.filter((memory) => memory.scope === 'global' || memory.project === project).slice(-24);
    const knowledge = workspace.projectKnowledge?.find((item) => item.project === project);
    const groundedMemory = relevantMemory(request.message, memories);
    if (groundedMemory && /[?]|^(?:what|why|how|when|where|can|could|should|is|are|do|does)\b/i.test(request.message.trim())) {
      return {
        text: `For ${project}, the rule is: ${groundedMemory.text} Kryeo applies that guidance during component review, while leaving Affinity unchanged until you approve an action.`,
        memories: [], actions: [], visionUsed: false,
      };
    }

    const bundle = await this.load();
    let visionSummary = '';
    if (request.useVision !== false && visual && !isCasual(request.message)) visionSummary = await this.perceive(bundle, visual).catch(() => '');
    const visionUsed = Boolean(visionSummary);
    if (visionSummary && asksForVisualDescription(request.message)) {
      this.stage = 'Ready';
      return { text: visionSummary, memories: [], actions: [], visionUsed: true };
    }
    const manifests = workspace.componentManifests.filter((manifest) => manifest.documentTitle === request.document.title).slice(0, 2);
    const recent = workspace.assistantMessages.filter((message) => message.sessionId === request.sessionId).slice(-10);
    const system = [
      'You are Kryeo, a friendly local multimodal assistant for Affinity UI production and Roblox UI delivery.',
      'Speak naturally. Respond warmly to greetings and small talk. You may briefly answer casual questions, then offer useful Kryeo help without sounding scripted.',
      'When a request is unrelated to design, Affinity, Roblox, assets, or Kryeo, answer briefly when harmless and gently explain your main expertise. Do not scold or hard-block the user.',
      'Use the supplied visual observation, document facts, project memory, and tools. Do not claim to see anything absent from the observation.',
      'Use a tool when it directly advances the request. Tool calls only open a reviewed Kryeo surface; they never silently change Affinity.',
      'Answer normally when no tool is needed. Never apologize for being an AI or claim you cannot access context that is supplied below.',
      'Prefer clear, human sentences. Keep ordinary answers under 140 words. Do not invent layer names.',
      `Project: ${project}. Active document: ${request.document.open ? request.document.title : 'none'}. Selected layers: ${request.document.selectionNames.join(', ') || 'none'}.`,
      `Confirmed visual examples: ${workspace.componentDecisions.length}. Saved hierarchy manifests for this document: ${manifests.length}.`,
      visionSummary ? `Visual observation: ${visionSummary}` : 'No current document image was supplied. Rely on structured document facts only.',
      memories.length ? `Applicable memory:\n${memories.map((memory) => `- [${memory.scope === 'global' ? 'global' : 'project'}] ${memory.text}`).join('\n')}` : 'No project instructions have been confirmed yet.',
      knowledge?.notes.length
        ? `Project notes:\n${knowledge.notes.slice(0, 16).map((note) => `- ${note.text}${note.tags.length ? ` [${note.tags.join(', ')}]` : ''}`).join('\n')}`
        : 'No project notes have been added yet.',
      knowledge && Object.keys(knowledge.metadata).length ? `Project metadata: ${JSON.stringify(knowledge.metadata).slice(0, 2400)}` : '',
    ].join('\n');
    const messages = [
      { role: 'system', content: system },
      ...recent.map((message) => ({ role: message.role, content: message.text })),
      { role: 'user', content: request.message },
    ];
    const planned = await this.plan(bundle, messages);
    const deterministicActions = proposedActions(request.message);
    const selectedTool = deterministicActions[0]?.type === 'open-component-scan' ? 'open_component_scan'
      : deterministicActions[0]?.type === 'review-assets' ? 'review_asset_library'
        : deterministicActions[0]?.type === 'open-workflows' ? 'open_workflows' : planned.tool;
    const actions = deterministicActions.length ? deterministicActions : selectedTool ? [actionForTool(selectedTool)] : [];
    let text = selectedTool
      ? toolReply(selectedTool, visionSummary)
      : (visionSummary && contradictsSuppliedContext(planned.text) ? visionSummary : planned.text)
        || (visionSummary ? visionSummary : 'I could not form a reliable response from the current project context.');
    this.stage = 'Ready';
    return { text: text.slice(0, 1800), memories: [], actions, visionUsed };
  }
}

export type { AssistantVisualContext };
