import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import type {
  ComponentAiSuggestion,
  ComponentAssetType,
  ComponentCandidate,
  ComponentDecision,
  LocalAiStatus,
  RobloxUiRole,
} from '../shared/types';
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from './embedding-utils.ts';
import { isMeaninglessName } from './name-quality.ts';

interface TaxonomyLabel {
  type: ComponentAssetType;
  prompts: string[];
  embedding: number[];
}

interface TaxonomyFile {
  model: string;
  dimension: number;
  labels: TaxonomyLabel[];
}

interface VisualStructure {
  centerDensity: number;
  outerDensity: number;
  overallDensity: number;
  borderLike: boolean;
  largeLandscape: boolean;
  imageNode: boolean;
}

const MODEL_FILE = 'vision_model_quantized.onnx';
const TAXONOMY_FILE = 'ui-taxonomy.json';
const IMAGE_SIZE = 256;
const BATCH_SIZE = 8;
const MAX_EMBEDDING_CACHE_ENTRIES = 2_048;
const GENERIC_NAME = /^(layer|group|object|shape|curve|pixel|image|raster|rectangle|ellipse|artboard|container)[\s_-]*\d*$/i;

sharp.concurrency(Math.max(1, Math.min(2, Math.floor(os.availableParallelism() / 2))));

const TYPE_TO_ROLE: Record<ComponentAssetType, RobloxUiRole> = {
  Unknown: 'Unknown',
  Frame: 'Frame',
  Button: 'ImageButton',
  Icon: 'ImageLabel',
  Panel: 'Frame',
  Slot: 'ImageButton',
  Bar: 'ImageLabel',
  Badge: 'ImageLabel',
  Label: 'TextLabel',
  Text: 'TextLabel',
  TextBox: 'TextBox',
  ScrollBar: 'Frame',
  Divider: 'ImageLabel',
  Background: 'ImageLabel',
  Wallpaper: 'ImageLabel',
  Texture: 'ImageLabel',
  Overlay: 'ImageLabel',
  Cursor: 'ImageLabel',
  Tooltip: 'Frame',
  Modal: 'Frame',
  Input: 'TextBox',
  Tab: 'ImageButton',
  Tile: 'ImageButton',
  Ornament: 'ImageLabel',
  Border: 'ImageLabel',
  Corner: 'ImageLabel',
  Edge: 'ImageLabel',
  Fill: 'ImageLabel',
  FX: 'ImageLabel',
};

export function roleForAssetType(type: ComponentAssetType): RobloxUiRole {
  return TYPE_TO_ROLE[type] || 'Unknown';
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function usefulName(component: ComponentCandidate, type: ComponentAssetType): string {
  const primary = titleCase(component.name);
  if (isMeaninglessName(component.name)) return type === 'Unknown' ? 'Unlabelled visual' : type;
  const typedSourceName = new RegExp(`\\b${type}(?:s|\\s*\\d+)?\\b`, 'i');
  if (type !== 'Unknown' && typedSourceName.test(primary) && !GENERIC_NAME.test(primary)) {
    return primary.slice(0, 80);
  }
  if (type === 'Bar' && /\bbar\b/i.test(primary) && !GENERIC_NAME.test(primary)) return primary.slice(0, 80);
  if (type === 'ScrollBar' && /\bscroll\s*bar\b/i.test(primary) && !GENERIC_NAME.test(primary)) return primary.slice(0, 80);
  const candidates = [component.name, ...component.members.map((member) => member.name)]
    .map(titleCase)
    .map((name) => name.replace(/\b(background|backdrop|border|borders|decoration|ornament|shadow|glow|stroke|fill|mask)\b/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((name) => name && !GENERIC_NAME.test(name))
    .filter(Boolean);
  const semantic = candidates.find((name) => !new RegExp(`\\b${type}\\b`, 'i').test(name)) || candidates[0] || '';
  if (!semantic) return type === 'Unknown' ? 'Unlabelled visual' : type;
  if (type === 'Bar' && /\bbar\b/i.test(semantic)) return semantic.slice(0, 80);
  if (type === 'ScrollBar' && /\bscroll\s*bar\b/i.test(semantic)) return semantic.slice(0, 80);
  if (type === 'Unknown' || new RegExp(`\\b${type}\\b`, 'i').test(semantic)) return semantic.slice(0, 80);
  return `${semantic} ${type}`.slice(0, 80);
}

function semanticName(component: ComponentCandidate): string {
  return `${component.name} ${component.members.map((member) => member.name).join(' ')}`
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticTypeFromText(name: string): ComponentAssetType | undefined {
  const normalized = name
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const types = (Object.keys(TYPE_TO_ROLE) as ComponentAssetType[])
    .filter((type) => type !== 'Unknown')
    .sort((left, right) => right.length - left.length);
  const matches = types.flatMap((type) => {
    const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\s+/g, '\\s*');
    const match = new RegExp(`\\b${words}s?\\b`, 'i').exec(normalized);
    return match ? [{ type, index: match.index }] : [];
  });
  return matches
    .sort((left, right) => right.index - left.index || right.type.length - left.type.length)[0]?.type;
}

function semanticAssetType(component: ComponentCandidate): ComponentAssetType | undefined {
  const primary = component.name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return semanticTypeFromText(primary) || semanticTypeFromText(semanticName(component).toLowerCase());
}

function hasMeaningfulLayerName(component: ComponentCandidate): boolean {
  return [component.name, ...component.members.map((member) => member.name)]
    .some((name) => name.trim().length > 0 && !isMeaninglessName(name));
}

function reviewCategory(component: ComponentCandidate, type: ComponentAssetType): 'ui' | 'construction' | 'background' {
  const name = semanticName(component).toLowerCase();
  if (['Background', 'Wallpaper'].includes(type)) return 'background';
  if (['Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX', 'Divider', 'Texture', 'Overlay'].includes(type)) return 'construction';
  if (type === 'Unknown' && /\b(background|backdrop|wallpaper|guide)\b/.test(name)) return 'background';
  if (type === 'Unknown' && /\b(mask|shadow|glow|texture|construction|overlay|stroke)\b/.test(name)) return 'construction';
  return 'ui';
}

function normalize(values: Float32Array): Float32Array {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Float32Array.from(values, (value) => value / magnitude);
}

function dot(left: Float32Array, right: number[]): number {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

function softmaxConfidence(scores: number[]): number {
  const scale = 18;
  const maximum = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp((score - maximum) * scale));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return Math.max(...exponentials) / total;
}

function structuralPriors(component: ComponentCandidate): Partial<Record<ComponentAssetType, number>> {
  const aspect = component.bounds.width / Math.max(1, component.bounds.height);
  const priors: Partial<Record<ComponentAssetType, number>> = {};
  if (component.textCount > 0) priors.Label = (priors.Label || 0) + 0.04;
  if ((aspect > 4 || aspect < 0.25) && component.childCount > 0) {
    priors.ScrollBar = (priors.ScrollBar || 0) + 0.035;
    priors.Bar = (priors.Bar || 0) + 0.035;
  }
  if (component.bounds.width >= 800 && component.bounds.height >= 450) {
    if (/ImageNode/i.test(component.affinityType)) priors.Wallpaper = (priors.Wallpaper || 0) + 0.13;
    else priors.Background = (priors.Background || 0) + 0.07;
  }
  return priors;
}

function dataUrlBuffer(dataUrl: string): Buffer {
  const marker = 'base64,';
  const index = dataUrl.indexOf(marker);
  return Buffer.from(index >= 0 ? dataUrl.slice(index + marker.length) : dataUrl, 'base64');
}

async function inspectVisualStructure(component: ComponentCandidate): Promise<VisualStructure> {
  const size = 64;
  const { data } = await sharp(dataUrlBuffer(component.previewUrl), { failOn: 'error' })
    .ensureAlpha()
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let centerVisible = 0;
  let centerPixels = 0;
  let outerVisible = 0;
  let outerPixels = 0;
  let totalVisible = 0;
  const centerStart = Math.floor(size * 0.3);
  const centerEnd = Math.ceil(size * 0.7);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3] / 255;
      totalVisible += alpha;
      if (x >= centerStart && x < centerEnd && y >= centerStart && y < centerEnd) {
        centerVisible += alpha;
        centerPixels += 1;
      } else {
        outerVisible += alpha;
        outerPixels += 1;
      }
    }
  }
  const centerDensity = centerVisible / Math.max(1, centerPixels);
  const outerDensity = outerVisible / Math.max(1, outerPixels);
  const overallDensity = totalVisible / (size * size);
  const largeLandscape = component.bounds.width >= 800
    && component.bounds.height >= 450
    && component.bounds.width / Math.max(1, component.bounds.height) >= 1.25;
  return {
    centerDensity,
    outerDensity,
    overallDensity,
    borderLike: centerDensity < 0.16 && outerDensity > 0.06 && outerDensity > centerDensity * 2.2,
    largeLandscape,
    imageNode: /ImageNode/i.test(component.affinityType),
  };
}

async function imageTensor(dataUrl: string): Promise<Float32Array> {
  const buffer = dataUrlBuffer(dataUrl);
  const { data } = await sharp(buffer, { failOn: 'error' })
    .ensureAlpha()
    .resize(IMAGE_SIZE, IMAGE_SIZE, {
      fit: 'contain',
      background: { r: 127, g: 127, b: 127, alpha: 1 },
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: { r: 127, g: 127, b: 127 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = IMAGE_SIZE * IMAGE_SIZE;
  const tensor = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    tensor[pixel] = data[pixel * 3] / 255;
    tensor[plane + pixel] = data[pixel * 3 + 1] / 255;
    tensor[plane * 2 + pixel] = data[pixel * 3 + 2] / 255;
  }
  return tensor;
}

export class LocalAiService {
  private session: Promise<ort.InferenceSession> | null = null;
  private taxonomy: Promise<TaxonomyFile> | null = null;
  private modelDirectory = '';
  private readonly embeddingCache = new Map<string, string>();

  private async resolveModelDirectory(): Promise<string> {
    if (this.modelDirectory) return this.modelDirectory;
    const candidates = [
      process.env.KRYEO_MODEL_ROOT,
      path.join(process.resourcesPath || '', 'models', 'mobileclip-s0'),
      path.join(process.cwd(), 'resources', 'models', 'mobileclip-s0'),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(candidate, MODEL_FILE));
        await fs.access(path.join(candidate, TAXONOMY_FILE));
        this.modelDirectory = candidate;
        return candidate;
      } catch {}
    }
    throw new Error('Kryeo local vision files are missing. Reinstall Kryeo to restore the embedded model.');
  }

  private async loadTaxonomy(): Promise<TaxonomyFile> {
    if (!this.taxonomy) {
      this.taxonomy = this.resolveModelDirectory()
        .then((directory) => fs.readFile(path.join(directory, TAXONOMY_FILE), 'utf8'))
        .then((content) => JSON.parse(content) as TaxonomyFile);
    }
    return this.taxonomy;
  }

  private async loadSession(): Promise<ort.InferenceSession> {
    if (!this.session) {
      this.session = this.resolveModelDirectory().then((directory) => ort.InferenceSession.create(
        path.join(directory, MODEL_FILE),
        {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
          executionMode: 'sequential',
          intraOpNumThreads: Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2))),
          interOpNumThreads: 1,
        },
      ));
    }
    return this.session;
  }

  async status(force = false): Promise<LocalAiStatus> {
    if (force) {
      this.session = null;
      this.taxonomy = null;
      this.modelDirectory = '';
      this.embeddingCache.clear();
    }
    try {
      const directory = await this.resolveModelDirectory();
      const [details, taxonomy] = await Promise.all([
        fs.stat(path.join(directory, MODEL_FILE)),
        this.loadTaxonomy(),
        this.loadSession(),
      ]);
      return {
        available: true,
        model: taxonomy.model,
        endpoint: 'embedded',
        message: `Embedded local vision ready (${(details.size / 1_000_000).toFixed(1)} MB).`,
        provider: 'embedded',
      };
    } catch (error) {
      return {
        available: false,
        model: 'MobileCLIP-S0',
        endpoint: 'embedded',
        message: error instanceof Error ? error.message : String(error),
        provider: 'embedded',
      };
    }
  }

  async embed(components: ComponentCandidate[]): Promise<Map<string, string>> {
    const [session, taxonomy] = await Promise.all([this.loadSession(), this.loadTaxonomy()]);
    const unique = [...new Map(components.map((component) => [component.visualHash, component])).values()];
    const result = new Map<string, string>();
    const missing = unique.filter((component) => {
      const cached = this.embeddingCache.get(component.visualHash);
      if (cached) result.set(component.visualHash, cached);
      return !cached;
    });
    for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
      const batch = missing.slice(offset, offset + BATCH_SIZE);
      const images = await Promise.all(batch.map((component) => imageTensor(component.previewUrl)));
      const values = new Float32Array(batch.length * 3 * IMAGE_SIZE * IMAGE_SIZE);
      images.forEach((image, index) => values.set(image, index * image.length));
      const output = await session.run({
        pixel_values: new ort.Tensor('float32', values, [batch.length, 3, IMAGE_SIZE, IMAGE_SIZE]),
      });
      const embeddings = output.image_embeds.data as Float32Array;
      batch.forEach((component, row) => {
        const encoded = encodeEmbedding(normalize(
          embeddings.slice(row * taxonomy.dimension, (row + 1) * taxonomy.dimension),
        ));
        this.embeddingCache.set(component.visualHash, encoded);
        result.set(component.visualHash, encoded);
      });
    }
    while (this.embeddingCache.size > MAX_EMBEDDING_CACHE_ENTRIES) {
      const oldest = this.embeddingCache.keys().next().value;
      if (!oldest) break;
      this.embeddingCache.delete(oldest);
    }
    return result;
  }

  async analyze(components: ComponentCandidate[], decisions: ComponentDecision[] = []): Promise<ComponentAiSuggestion[]> {
    const [session, taxonomy] = await Promise.all([this.loadSession(), this.loadTaxonomy()]);
    const unique = [...new Map(components.map((component) => [component.visualHash, component])).values()];
    const learned = decisions
      .filter((decision) => decision.embedding && decision.assetType && decision.assetType !== 'Unknown')
      .map((decision) => ({ decision, embedding: decodeEmbedding(decision.embedding || '') }))
      .filter((example) => example.embedding.length === taxonomy.dimension);
    const results: ComponentAiSuggestion[] = [];
    const structures = await Promise.all(unique.map(inspectVisualStructure));
    const variants = unique.flatMap((component, componentIndex) =>
      [component.previewUrl, ...(component.analysisPreviewUrls || [])].map((url) => ({ componentIndex, url })));
    const sums = unique.map(() => new Float32Array(taxonomy.dimension));
    const counts = unique.map(() => 0);
    for (let offset = 0; offset < variants.length; offset += BATCH_SIZE) {
      const batch = variants.slice(offset, offset + BATCH_SIZE);
      const images = await Promise.all(batch.map((variant) => imageTensor(variant.url)));
      const values = new Float32Array(batch.length * 3 * IMAGE_SIZE * IMAGE_SIZE);
      images.forEach((image, index) => values.set(image, index * image.length));
      const output = await session.run({
        pixel_values: new ort.Tensor('float32', values, [batch.length, 3, IMAGE_SIZE, IMAGE_SIZE]),
      });
      const embeddings = output.image_embeds.data as Float32Array;
      const dimension = taxonomy.dimension;
      batch.forEach((variant, row) => {
        const embedding = normalize(embeddings.slice(row * dimension, (row + 1) * dimension));
        for (let index = 0; index < dimension; index += 1) {
          sums[variant.componentIndex][index] += embedding[index];
        }
        counts[variant.componentIndex] += 1;
      });
    }
    unique.forEach((component, componentIndex) => {
      const structure = structures[componentIndex];
      const averaged = sums[componentIndex].map((value) => value / Math.max(1, counts[componentIndex]));
      const embedding = normalize(averaged);
      const priors = structuralPriors(component);
      const scores = taxonomy.labels.map((label) => dot(embedding, label.embedding) + (priors[label.type] || 0));
      const neighbours = learned
        .map((example) => ({ ...example, similarity: cosineSimilarity(embedding, example.embedding) }))
        .filter((example) => example.similarity >= 0.84)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 5);
      for (const neighbour of neighbours) {
        const labelIndex = taxonomy.labels.findIndex((label) => label.type === neighbour.decision.assetType);
        if (labelIndex >= 0) scores[labelIndex] += Math.pow((neighbour.similarity - 0.84) / 0.16, 2) * 0.12;
      }
      const ranked = scores
        .map((score, index) => ({ score, label: taxonomy.labels[index] }))
        .sort((left, right) => right.score - left.score);
      const best = ranked[0];
      const nearest = neighbours[0];
      const semanticType = semanticAssetType(component);
      const modelConfidence = softmaxConfidence(scores);
      const margin = best.score - (ranked[1]?.score || best.score);
      const confidence = clamp(
        0.34 + modelConfidence * 0.48 + margin * 1.5 + (nearest ? Math.max(0, nearest.similarity - 0.9) : 0),
        0.35,
        0.98,
      );
      const fullCanvasShape = /ShapeNode/i.test(component.affinityType)
        && component.bounds.width >= 1600
        && component.bounds.height >= 900;
      const sparseAnonymousCanvasShape = fullCanvasShape && !semanticType && structure.overallDensity < 0.12;
      const misleadingFullCanvasFrame = fullCanvasShape && semanticType === 'Frame';
      const structureType: ComponentAssetType | undefined = structure.borderLike || sparseAnonymousCanvasShape
        ? 'Border'
        : misleadingFullCanvasFrame
          ? 'Background'
          : structure.largeLandscape
            && structure.imageNode
            && structure.centerDensity >= 0.45
            && structure.overallDensity >= 0.2
            ? 'Wallpaper'
            : structure.largeLandscape && structure.centerDensity >= 0.38
            ? 'Background'
            : undefined;
      const visualStructureConfidence = structureType === 'Border'
        ? 0.96
        : structureType === 'Wallpaper'
          ? 0.94
          : structureType === 'Background'
            ? 0.82
            : undefined;
      const genericLowConfidenceVisual = !semanticType
        && !structureType
        && !hasMeaningfulLayerName(component)
        && !nearest
        && confidence < 0.56;
      const semanticCorrectedByStructure = semanticType === 'Frame' && structureType === 'Background';
      const learnedType = nearest && nearest.similarity >= 0.96 && nearest.decision.assetType
        ? nearest.decision.assetType
        : semanticCorrectedByStructure
          ? 'Background'
          : semanticType || structureType || (genericLowConfidenceVisual ? 'Unknown' : best.label.type);
      const semanticScore = semanticType
        ? ranked.find((candidate) => candidate.label.type === semanticType)?.score
        : undefined;
      const semanticConflict = Boolean(
        semanticCorrectedByStructure
        || (semanticType && semanticType !== best.label.type && best.score - (semanticScore ?? best.score) > 0.035),
      );
      const role = nearest && nearest.similarity >= 0.93 && nearest.decision.role !== 'Unknown'
        ? nearest.decision.role
        : TYPE_TO_ROLE[learnedType] || component.suggestedRole;
      results.push({
        visualHash: component.visualHash,
        name: usefulName(component, learnedType),
        assetType: learnedType,
        role,
        source: nearest && nearest.similarity >= 0.96
          ? 'memory'
          : semanticType && learnedType === semanticType ? 'name' : 'model',
        confidence: structureType && learnedType === structureType
          ? Math.max(0.78, confidence)
          : semanticType && learnedType === semanticType ? Math.max(0.9, confidence) : confidence,
        reason: nearest && nearest.similarity >= 0.96
          ? 'Matched a visual classification previously confirmed on this computer.'
          : semanticCorrectedByStructure
            ? 'The layer name says frame, but the rendered artwork is a filled landscape background.'
            : semanticType && learnedType === semanticType
              ? `The component name identifies this as a ${semanticType.toLowerCase()} and overrides the weaker visual match.`
              : structureType && learnedType === structureType
                ? structureType === 'Border'
                  ? 'The rendered artwork has a transparent center with visible perimeter artwork, which identifies it as a border.'
                  : `The rendered size, coverage, and layer kind identify this as a ${structureType.toLowerCase()}.`
                : genericLowConfidenceVisual
                  ? 'This anonymous layer has no reliable visual match. Keep it inside its parent or name it before exporting it separately.'
                  : `${taxonomy.model} matched this visual most closely to ${best.label.type.toLowerCase()} components.`,
        alternatives: ranked.slice(1, 4).map((candidate) => ({
          assetType: candidate.label.type,
          score: candidate.score,
        })),
        embedding: encodeEmbedding(embedding),
        learnedFrom: neighbours.length,
        nearestLearnedSimilarity: nearest?.similarity || 0,
        inferencePath: nearest && nearest.similarity >= 0.96 ? 'user-memory' : 'baseline-taxonomy',
        learnedDiveMode: nearest && nearest.similarity >= 0.92 ? nearest.decision.diveMode : undefined,
        semanticHint: semanticType ? semanticName(component).slice(0, 160) : undefined,
        visualStructureType: structureType,
        visualStructureConfidence,
        semanticType,
        semanticConflict,
        semanticConflictMessage: semanticConflict
          ? semanticCorrectedByStructure
            ? 'Layer name suggests Frame; rendered structure indicates Background. Kryeo used the rendered result.'
            : `Layer name suggests ${semanticType}; the visual model leans toward ${best.label.type}. Review this classification.`
          : undefined,
        reviewCategory: reviewCategory(component, learnedType),
        nameSource: nearest && nearest.similarity >= 0.96
          ? 'memory'
          : semanticCorrectedByStructure
            ? 'visual'
            : semanticType ? best.label.type === semanticType ? 'both' : 'layer-name' : 'visual',
      });
    });
    return results;
  }
}
