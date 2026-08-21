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
  // An Affinity group is source hierarchy, not evidence that the exported
  // artwork should become a Roblox Frame. In particular, multi-layer border
  // artwork is commonly a GroupNode. Keep ordinary groups neutral and reserve
  // this preliminary role for explicit canvas/container nodes.
  if (/container|artboard/.test(type)) return 'Frame';
  return 'Unknown';
}

const IMAGE_INSPECTION_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}
type PngPixelInspection = {
  hash: string;
  width: number;
  height: number;
  visualMetrics: ComponentVisualMetrics;
};

type PngPreview = {
  previewUrl: string;
  hostedPreviewUrl: string;
  analysisPreviewUrls: string[];
};

async function inspectPngPixels(file: string): Promise<PngPixelInspection> {
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
  let visibleMinX = info.width;
  let visibleMinY = info.height;
  let visibleMaxX = -1;
  let visibleMaxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + alphaChannel] / 255;
      const visible = alpha > 0.03;
      alphaTotal += alpha;
      if (visible) {
        visiblePixels += 1;
        visibleMinX = Math.min(visibleMinX, x);
        visibleMinY = Math.min(visibleMinY, y);
        visibleMaxX = Math.max(visibleMaxX, x);
        visibleMaxY = Math.max(visibleMaxY, y);
      }
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
  let innerVisibleRatio = 0;
  let contentPerimeterVisibleRatio = 0;
  let contentPerimeterCoverage = 0;
  if (visibleMaxX >= visibleMinX && visibleMaxY >= visibleMinY) {
    const contentWidth = visibleMaxX - visibleMinX + 1;
    const contentHeight = visibleMaxY - visibleMinY + 1;
    const innerInsetX = Math.max(1, Math.floor(contentWidth * 0.28));
    const innerInsetY = Math.max(1, Math.floor(contentHeight * 0.28));
    const innerLeft = Math.min(visibleMaxX, visibleMinX + innerInsetX);
    const innerRight = Math.max(innerLeft, visibleMaxX - innerInsetX);
    const innerTop = Math.min(visibleMaxY, visibleMinY + innerInsetY);
    const innerBottom = Math.max(innerTop, visibleMaxY - innerInsetY);
    const perimeterInsetX = Math.max(1, Math.floor(contentWidth * 0.22));
    const perimeterInsetY = Math.max(1, Math.floor(contentHeight * 0.22));
    const topColumns = new Uint8Array(contentWidth);
    const bottomColumns = new Uint8Array(contentWidth);
    const leftRows = new Uint8Array(contentHeight);
    const rightRows = new Uint8Array(contentHeight);
    let innerPixels = 0;
    let innerVisible = 0;
    let perimeterPixels = 0;
    let perimeterVisible = 0;
    for (let y = visibleMinY; y <= visibleMaxY; y += 1) {
      for (let x = visibleMinX; x <= visibleMaxX; x += 1) {
        const alpha = data[(y * info.width + x) * info.channels + alphaChannel] / 255;
        const visible = alpha > 0.03;
        const insideInner = x >= innerLeft && x <= innerRight && y >= innerTop && y <= innerBottom;
        if (insideInner) {
          innerPixels += 1;
          if (visible) innerVisible += 1;
        }
        const atContentPerimeter = x < visibleMinX + perimeterInsetX
          || x > visibleMaxX - perimeterInsetX
          || y < visibleMinY + perimeterInsetY
          || y > visibleMaxY - perimeterInsetY;
        if (!atContentPerimeter) continue;
        perimeterPixels += 1;
        if (!visible) continue;
        perimeterVisible += 1;
        if (y < visibleMinY + perimeterInsetY) topColumns[x - visibleMinX] = 1;
        if (y > visibleMaxY - perimeterInsetY) bottomColumns[x - visibleMinX] = 1;
        if (x < visibleMinX + perimeterInsetX) leftRows[y - visibleMinY] = 1;
        if (x > visibleMaxX - perimeterInsetX) rightRows[y - visibleMinY] = 1;
      }
    }
    const covered = (values: Uint8Array) => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
    innerVisibleRatio = innerVisible / Math.max(1, innerPixels);
    contentPerimeterVisibleRatio = perimeterVisible / Math.max(1, perimeterPixels);
    contentPerimeterCoverage = (
      covered(topColumns) + covered(rightRows) + covered(bottomColumns) + covered(leftRows)
    ) / 4;
  }
  const visualMetrics: ComponentVisualMetrics = {
    visiblePixelRatio: Number((visiblePixels / Math.max(1, pixelCount)).toFixed(4)),
    opaquePixelRatio: Number((opaquePixels / Math.max(1, pixelCount)).toFixed(4)),
    meanAlpha: Number((alphaTotal / Math.max(1, pixelCount)).toFixed(4)),
    edgeVisibleRatio: Number((edgeVisible / Math.max(1, edgePixels)).toFixed(4)),
    centerVisibleRatio: Number((centerVisible / Math.max(1, centerPixels)).toFixed(4)),
    innerVisibleRatio: Number(innerVisibleRatio.toFixed(4)),
    contentPerimeterVisibleRatio: Number(contentPerimeterVisibleRatio.toFixed(4)),
    contentPerimeterCoverage: Number(contentPerimeterCoverage.toFixed(4)),
  };
  const dimensions = Buffer.allocUnsafe(12);
  dimensions.writeUInt32LE(info.width, 0);
  dimensions.writeUInt32LE(info.height, 4);
  dimensions.writeUInt32LE(info.channels, 8);
  const hash = createHash('sha256').update(dimensions).update(data).digest('hex');
  return {
    hash,
    width: info.width,
    height: info.height,
    visualMetrics,
  };
}

async function renderPngPreviews(file: string, width: number, height: number): Promise<PngPreview> {
  const image = sharp(file, { failOn: 'error' }).toColourspace('srgb').ensureAlpha();
  const preview = await image
    .clone()
    .resize({
      width: 320,
      height: 220,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 5 })
    .toBuffer();
  // Hosted vision only needs a cheap semantic thumbnail. Keep the larger
  // preview for the local classifier/UI, but avoid paying frontier vision
  // rates for pixels the model cannot usefully distinguish at full size.
  const hostedPreview = await image
    .clone()
    .resize({
      width: 224,
      height: 154,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 5 })
    .toBuffer();
  const analysisPreviewUrls: string[] = [];
  if (width > 1_024 || height > 1_024) {
    const ratio = width / height;
    const columns = ratio > 2 ? 4 : ratio > 1.25 ? 3 : 2;
    const rows = ratio < 0.5 ? 4 : ratio < 0.8 ? 3 : 2;
    for (let row = 0; row < rows && analysisPreviewUrls.length < 2; row += 1) {
      for (let column = 0; column < columns && analysisPreviewUrls.length < 2; column += 1) {
        const cellWidth = width / columns;
        const cellHeight = height / rows;
        const overlapX = cellWidth * 0.12;
        const overlapY = cellHeight * 0.12;
        const left = Math.max(0, Math.floor(column * cellWidth - overlapX));
        const top = Math.max(0, Math.floor(row * cellHeight - overlapY));
        const right = Math.min(width, Math.ceil((column + 1) * cellWidth + overlapX));
        const bottom = Math.min(height, Math.ceil((row + 1) * cellHeight + overlapY));
        const tile = await image.clone().extract({ left, top, width: right - left, height: bottom - top })
          .resize({
            width: 320,
            height: 320,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png({ compressionLevel: 5 })
          .toBuffer();
        analysisPreviewUrls.push(`data:image/png;base64,${tile.toString('base64')}`);
      }
    }
  }
  return {
    previewUrl: `data:image/png;base64,${preview.toString('base64')}`,
    hostedPreviewUrl: `data:image/png;base64,${hostedPreview.toString('base64')}`,
    analysisPreviewUrls,
  };
}

export async function buildComponentScan(
  batch: AffinityComponentExportBatch,
  decisions: ComponentDecision[],
  signal?: AbortSignal,
): Promise<ComponentScanResult> {
  const assertActive = () => {
    if (!signal?.aborted) return;
    const error = new Error('Component scan cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  assertActive();
  // Generated results are a cache, never a remembered decision. Only an
  // accepted/corrected choice may prepopulate a fresh scan; otherwise old
  // names survive even after the hosted gateway cache has been cleared.
  const remembered = new Map(decisions
    .filter((decision) => decision.approved !== false && decision.decisionStatus !== 'generated')
    .map((decision) => [decision.visualHash, decision]));
  // Large documents can contain hundreds of exports. Bounded image work keeps
  // libvips from competing with Affinity and avoids a memory-heavy promise fan-out.
  const pixelInspections = await mapWithConcurrency(batch.components, IMAGE_INSPECTION_CONCURRENCY, async (component) => {
    assertActive();
    return {
      component,
      inspection: await inspectPngPixels(component.path),
    };
  });
  assertActive();
  // Hashes must be computed for every export, but identical visual families do
  // not need their thumbnails, hosted preview, crops, and base64 payloads
  // encoded repeatedly. This keeps the UI and all-cloud coverage identical
  // while substantially reducing CPU, allocation pressure, and scan memory on
  // documents with reused controls.
  const previewSources = new Map<string, { file: string; width: number; height: number }>();
  for (const { component, inspection } of pixelInspections) {
    if (!previewSources.has(inspection.hash)) {
      previewSources.set(inspection.hash, {
        file: component.path,
        width: inspection.width,
        height: inspection.height,
      });
    }
  }
  const previewEntries = await mapWithConcurrency(
    [...previewSources.entries()],
    IMAGE_INSPECTION_CONCURRENCY,
    async ([hash, source]) => {
      assertActive();
      return [hash, await renderPngPreviews(source.file, source.width, source.height)] as const;
    },
  );
  assertActive();
  const previewsByHash = new Map(previewEntries);
  const inspected = pixelInspections.map(({ component, inspection }) => {
    const preview = previewsByHash.get(inspection.hash);
    if (!preview) throw new Error('Kryeo could not prepare a component preview.');
    return {
      component,
      ...inspection,
      ...preview,
      renderHash: inspection.hash,
      hash: component.previewFallback
        ? createHash('sha256').update(`structural:${component.hierarchyKey}:${inspection.hash}`).digest('hex')
        : inspection.hash,
    };
  });
  const familySizes = new Map<string, number>();
  for (const item of inspected) familySizes.set(item.hash, (familySizes.get(item.hash) || 0) + 1);

  const components: ComponentCandidate[] = inspected.map(({
    component,
    hash,
    renderHash,
    previewUrl,
    hostedPreviewUrl,
    analysisPreviewUrls,
    visualMetrics,
  }, occurrence) => {
    const decision = remembered.get(hash);
    const canonicalName = decision?.exportName || decision?.familyName || decision?.layerLabel || component.name;
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
      hostedPreviewUrl,
      analysisPreviewUrls,
      visualMetrics,
      visualHash: hash,
      renderHash,
      duplicateFamily: hash.slice(0, 12),
      duplicateCount: familySizes.get(hash) || 1,
      familyName: canonicalName,
      layerLabel: canonicalName,
      exportName: canonicalName,
      exportTarget: true,
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
      diveMode: 'keep-together',
      diveRemembered: false,
      learnedDiveDecisions: decision?.diveDecisions,
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
