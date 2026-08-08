import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildComponentScan } from '../src/main/component-scan-service.ts';
import { applyComponentIntelligence } from '../src/main/component-intelligence-service.ts';

const root = path.resolve('tmp', 'component-scan-smoke');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });

const redA = path.join(root, 'red-a.png');
const redB = path.join(root, 'red-b.png');
const blue = path.join(root, 'blue.png');
const insetBorder = path.join(root, 'inset-border.png');
await sharp({ create: { width: 24, height: 16, channels: 4, background: '#ff2040ff' } }).png({ compressionLevel: 1 }).toFile(redA);
await sharp({ create: { width: 24, height: 16, channels: 4, background: '#ff2040ff' } }).png({ compressionLevel: 9 }).toFile(redB);
await sharp({ create: { width: 24, height: 16, channels: 4, background: '#2050ffff' } }).png().toFile(blue);
await sharp({ create: { width: 120, height: 120, channels: 4, background: '#00000000' } })
  .composite([{
    input: Buffer.from('<svg width="120" height="120"><rect x="18" y="18" width="84" height="84" rx="8" fill="none" stroke="#d8aa63" stroke-width="9"/></svg>'),
  }])
  .png()
  .toFile(insetBorder);

const bounds = { x: 0, y: 0, width: 24, height: 16 };
const result = await buildComponentScan({
  documentTitle: 'Smoke Test',
  documentSessionUuid: 'smoke-session',
  sourceName: 'Components',
  components: [
    { index: 0, name: 'Layer10', affinityType: 'RasterNode', bounds, childCount: 0, descendantCount: 0, textCount: 0, semanticNames: [], path: redA },
    { index: 1, name: 'Layer11', affinityType: 'RasterNode', bounds: { ...bounds, x: 100 }, childCount: 0, descendantCount: 0, textCount: 0, semanticNames: [], path: redB },
    { index: 2, name: 'Layer12', affinityType: 'RasterNode', bounds: { ...bounds, x: 200 }, childCount: 0, descendantCount: 0, textCount: 0, semanticNames: [], path: blue },
  ],
}, []);

if (result.components.length !== 3) throw new Error('Expected three component instances.');
if (result.uniqueVisuals !== 2) throw new Error(`Expected two unique visuals, received ${result.uniqueVisuals}.`);
if (result.duplicateFamilies !== 1) throw new Error(`Expected one duplicate family, received ${result.duplicateFamilies}.`);
if (result.reusedInstances !== 1) throw new Error(`Expected one avoided upload, received ${result.reusedInstances}.`);
if (result.components[0].visualHash !== result.components[1].visualHash) throw new Error('Identical RGBA pixels did not share a hash.');
if (result.components[0].visualHash === result.components[2].visualHash) throw new Error('Different RGBA pixels shared a hash.');

const groupResult = await buildComponentScan({
  documentTitle: 'Smoke Test',
  documentSessionUuid: 'group-role-smoke',
  sourceName: 'Components',
  components: [
    { index: 0, name: 'OuterLayers', affinityType: 'GroupNode', bounds: { x: 0, y: 0, width: 120, height: 120 }, childCount: 4, descendantCount: 4, textCount: 0, semanticNames: [], path: insetBorder },
  ],
}, []);
if (groupResult.components[0].suggestedRole !== 'Unknown') {
  throw new Error(`Expected a generic Affinity group to remain role-neutral, received ${groupResult.components[0].suggestedRole}.`);
}
const insetMetrics = groupResult.components[0].visualMetrics;
if (!insetMetrics || (insetMetrics.innerVisibleRatio ?? 1) >= 0.12) {
  throw new Error(`Expected the inset border's content-relative centre to remain transparent, received ${insetMetrics?.innerVisibleRatio}.`);
}
if ((insetMetrics.contentPerimeterVisibleRatio ?? 0) <= 0.05 || (insetMetrics.contentPerimeterCoverage ?? 0) < 0.28) {
  throw new Error(`Expected occupied-bounds perimeter evidence for the inset border, received ${JSON.stringify(insetMetrics)}.`);
}

const repeatedChildren = Array.from({ length: 10 }, (_, index) => ({
  ...result.components[0],
  id: `slot-${index}`,
  name: `HotbarSlot${index + 1}`,
  hierarchyKey: `0.${index}`,
  parentHierarchyKey: '0',
  childHierarchyKeys: [],
  assetType: 'Slot',
  duplicateKind: 'exact',
  similarityFamily: result.components[0].visualHash.slice(0, 12),
  bounds: { ...bounds, x: index * 30 },
}));
const repeatedParent = {
  ...result.components[2],
  id: 'slots-parent',
  name: 'Hotbar Slots',
  hierarchyKey: '0',
  parentHierarchyKey: '',
  childHierarchyKeys: repeatedChildren.map((child) => child.hierarchyKey),
  assetType: 'Slot',
};
applyComponentIntelligence([repeatedParent, ...repeatedChildren]);
if (repeatedParent.recommendedDiveMode !== 'children-only') {
  throw new Error(`Expected repeated slot aggregate to recommend children-only, received ${repeatedParent.recommendedDiveMode}.`);
}

const closeChildren = [
  {
    ...result.components[0],
    id: 'close-fill',
    name: 'dwa121',
    hierarchyKey: '1.0',
    parentHierarchyKey: '1',
    childHierarchyKeys: [],
    assetType: 'Fill',
    bounds: { x: 749, y: 330, width: 176, height: 176 },
  },
  {
    ...result.components[1],
    id: 'close-icon',
    name: 'lechickennugget',
    hierarchyKey: '1.1',
    parentHierarchyKey: '1',
    childHierarchyKeys: [],
    assetType: 'Icon',
    bounds: { x: 814, y: 393, width: 61, height: 53 },
  },
];
const closeParent = {
  ...result.components[2],
  id: 'close-parent',
  name: 'wut',
  hierarchyKey: '1',
  parentHierarchyKey: '',
  childHierarchyKeys: closeChildren.map((child) => child.hierarchyKey),
  assetType: 'Button',
  bounds: { x: 749, y: 330, width: 176, height: 176 },
};
applyComponentIntelligence([closeParent, ...closeChildren]);
if (closeParent.recommendedDiveMode !== 'keep-together') {
  throw new Error(`Expected overlapping close-button layers to stay together, received ${closeParent.recommendedDiveMode}.`);
}

console.log(JSON.stringify({
  components: result.components.length,
  uniqueVisuals: result.uniqueVisuals,
  duplicateFamilies: result.duplicateFamilies,
  reusedInstances: result.reusedInstances,
  sharedHash: result.components[0].visualHash.slice(0, 12),
  groupSuggestedRole: groupResult.components[0].suggestedRole,
  insetBorderMetrics: insetMetrics,
  repeatedGroupMode: repeatedParent.recommendedDiveMode,
  closeButtonMode: closeParent.recommendedDiveMode,
}, null, 2));
