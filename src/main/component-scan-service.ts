import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type {
  ComponentCandidate,
  ComponentDecision,
  ComponentScanResult,
  ComponentVisualMetrics,
  RobloxUiRole,
} from '../shared/types';
import type { AffinityComponentExportBatch } from './affinity-service';

function suggestRole(name: string, affinityType: string, semanticNames: string[], childCount: number): RobloxUiRole {
  const words = `${name} ${semanticNames.join(' ')}`.toLowerCase();
  const type = affinityType.toLowerCase();
  if (/textbox|text box|input|field/.test(words)) return 'TextBox';
  if (/button|\bbtn\b|pressed|hover/.test(words)) return 'ImageButton';
  if (/text/.test(type)) return 'TextLabel';
  if (/raster|image/.test(type)) return 'ImageLabel';
  if (childCount > 1 || /group|container|artboard/.test(type)) return 'Frame';
  return 'Unknown';
}

async function inspectPng(file: string): Promise<{
  hash: string;
  previewUrl: string;
  analysisPreviewUrls: string[];
  visualMetrics: ComponentVisualMetrics;
}> {
  const image = sharp(file, { failOn: 'error' }).toColourspace('srgb').ensureAlpha();
  const { data, info } = await image.clone().raw().toBuffer({ resolveWithObject: true });
  const alphaChannel = info.channels - 1;
  const pixelCount = info.width * info.height;
  const edgeInsetX = Math.max(1, Math.floor(info.width * 0.12));
  const edgeInsetY = Math.max(1, Math.floor(info.height * 0.12));
  let visiblePixels = 0;
  let opaquePixels = 0;
  let alphaTotal = 0;
  let edgePixels = 0;
  let edgeVisible = 0;
  let centerPixels = 0;
  let centerVisible = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + alphaChannel] / 255;
      const visible = alpha > 0.03;
      alphaTotal += alpha;
      if (visible) visiblePixels += 1;
      if (alpha > 0.97) opaquePixels += 1;
      const atEdge = x < edgeInsetX || x >= info.width - edgeInsetX || y < edgeInsetY || y >= info.height - edgeInsetY;
      if (atEdge) {
        edgePixels += 1;
        if (visible) edgeVisible += 1;
      } else {
        centerPixels += 1;
        if (visible) centerVisible += 1;
      }
    }
  }
  const visualMetrics: ComponentVisualMetrics = {
    visiblePixelRatio: Number((visiblePixels / Math.max(1, pixelCount)).toFixed(4)),
    opaquePixelRatio: Number((opaquePixels / Math.max(1, pixelCount)).toFixed(4)),
    meanAlpha: Number((alphaTotal / Math.max(1, pixelCount)).toFixed(4)),
    edgeVisibleRatio: Number((edgeVisible / Math.max(1, edgePixels)).toFixed(4)),
    centerVisibleRatio: Number((centerVisible / Math.max(1, centerPixels)).toFixed(4)),
  };
  const dimensions = Buffer.allocUnsafe(12);
  dimensions.writeUInt32LE(info.width, 0);
  dimensions.writeUInt32LE(info.height, 4);
  dimensions.writeUInt32LE(info.channels, 8);
  const hash = createHash('sha256').update(dimensions).update(data).digest('hex');
  const preview = await image
    .clone()
    .resize({
      width: 320,
      height: 220,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 8 })
    .toBuffer();
  const analysisPreviewUrls: string[] = [];
  if (info.width > 640 || info.height > 640) {
    const ratio = info.width / info.height;
    const columns = ratio > 2 ? 4 : ratio > 1.25 ? 3 : 2;
    const rows = ratio < 0.5 ? 4 : ratio < 0.8 ? 3 : 2;
    for (let row = 0; row < rows && analysisPreviewUrls.length < 6; row += 1) {
      for (let column = 0; column < columns && analysisPreviewUrls.length < 6; column += 1) {
        const cellWidth = info.width / columns;
        const cellHeight = info.height / rows;
        const overlapX = cellWidth * 0.12;
        const overlapY = cellHeight * 0.12;
        const left = Math.max(0, Math.floor(column * cellWidth - overlapX));
        const top = Math.max(0, Math.floor(row * cellHeight - overlapY));
        const right = Math.min(info.width, Math.ceil((column + 1) * cellWidth + overlapX));
        const bottom = Math.min(info.height, Math.ceil((row + 1) * cellHeight + overlapY));
        const tile = await image.clone().extract({ left, top, width: right - left, height: bottom - top })
          .resize({
            width: 320,
            height: 320,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png({ compressionLevel: 8 })
          .toBuffer();
        analysisPreviewUrls.push(`data:image/png;base64,${tile.toString('base64')}`);
      }
    }
  }
  return { hash, previewUrl: `data:image/png;base64,${preview.toString('base64')}`, analysisPreviewUrls, visualMetrics };
}

export async function buildComponentScan(
  batch: AffinityComponentExportBatch,
  decisions: ComponentDecision[],
): Promise<ComponentScanResult> {
  const remembered = new Map(decisions.map((decision) => [decision.visualHash, decision]));
  const inspected = await Promise.all(batch.components.map(async (component) => {
    const inspection = await inspectPng(component.path);
    return {
      component,
      ...inspection,
      hash: component.previewFallback
        ? createHash('sha256').update(`structural:${component.hierarchyKey}:${inspection.hash}`).digest('hex')
        : inspection.hash,
    };
  }));
  const familySizes = new Map<string, number>();
  for (const item of inspected) familySizes.set(item.hash, (familySizes.get(item.hash) || 0) + 1);

  const components: ComponentCandidate[] = inspected.map(({
    component,
    hash,
    previewUrl,
    analysisPreviewUrls,
    visualMetrics,
  }, occurrence) => {
    const decision = remembered.get(hash);
    const suggestedRole = suggestRole(
      component.name,
      component.affinityType,
      component.semanticNames,
      component.childCount,
    );
    return {
      id: `${batch.documentSessionUuid}:${component.index}:${occurrence}`,
      name: component.name,
      affinityType: component.affinityType,
      bounds: component.bounds,
      childCount: component.childCount,
      descendantCount: component.descendantCount,
      textCount: component.textCount,
      previewUrl,
      analysisPreviewUrls,
      visualMetrics,
      visualHash: hash,
      duplicateFamily: hash.slice(0, 12),
      duplicateCount: familySizes.get(hash) || 1,
      familyName: decision?.familyName || component.name,
      suggestedRole,
      role: decision?.role || suggestedRole,
      assetType: decision?.assetType || 'Unknown',
      remembered: Boolean(decision),
      members: component.members || [{
        path: [],
        name: component.name,
        affinityType: component.affinityType,
        bounds: component.bounds,
      }],
      grouping: component.grouping || 'single',
      hierarchyKey: component.hierarchyKey || `root:${component.index}`,
      parentHierarchyKey: component.parentHierarchyKey || '',
      hierarchyDepth: component.hierarchyDepth || 0,
      childHierarchyKeys: [],
      diveMode: decision?.diveMode || 'keep-together',
      diveRemembered: Boolean(decision?.diveMode),
      recommendedDiveMode: 'keep-together',
      diveConfidence: 0,
      diveReasons: [],
      visualEmbedding: decision?.embedding,
      learnedFrom: 0,
      nearestLearnedSimilarity: 0,
      similarityFamily: hash.slice(0, 12),
      similarCount: familySizes.get(hash) || 1,
      duplicateKind: (familySizes.get(hash) || 1) > 1 ? 'exact' : 'unique',
    };
  });

  const byHierarchyKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  for (const component of components) {
    const parent = byHierarchyKey.get(component.parentHierarchyKey);
    if (parent) parent.childHierarchyKeys.push(component.hierarchyKey);
    else if (component.parentHierarchyKey) {
      component.parentHierarchyKey = '';
      component.hierarchyDepth = 0;
    }
  }

  const uniqueVisuals = familySizes.size;
  const duplicateFamilies = [...familySizes.values()].filter((count) => count > 1).length;
  return {
    documentTitle: batch.documentTitle,
    documentSessionUuid: batch.documentSessionUuid,
    sourceName: batch.sourceName,
    scannedAt: new Date().toISOString(),
    components,
    uniqueVisuals,
    duplicateFamilies,
    reusedInstances: Math.max(0, components.length - uniqueVisuals),
  };
}

export async function resetScanDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
}

export async function removeScanDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (!resolved.toLowerCase().includes(`${path.sep}componentscanstaging${path.sep}`.toLowerCase())) return;
  await fs.rm(resolved, { recursive: true, force: true });
}
