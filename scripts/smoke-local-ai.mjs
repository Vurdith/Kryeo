import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

process.env.KRYEO_MODEL_ROOT = path.resolve('resources', 'models', 'mobileclip-s0');
const { LocalAiService } = await import('../src/main/local-ai-service.ts');

const preview = await sharp({
  create: { width: 220, height: 72, channels: 4, background: '#00000000' },
})
  .composite([
    { input: await sharp({ create: { width: 204, height: 56, channels: 4, background: '#d7ff24ff' } }).png().toBuffer(), left: 8, top: 8 },
    { input: await sharp({ create: { width: 186, height: 38, channels: 4, background: '#161816ff' } }).png().toBuffer(), left: 17, top: 17 },
  ])
  .png()
  .toBuffer();

const borderPreview = await sharp({
  create: { width: 128, height: 128, channels: 4, background: '#00000000' },
})
  .composite([
    { input: await sharp({ create: { width: 112, height: 8, channels: 4, background: '#d7a424ff' } }).png().toBuffer(), left: 8, top: 8 },
    { input: await sharp({ create: { width: 112, height: 8, channels: 4, background: '#d7a424ff' } }).png().toBuffer(), left: 8, top: 112 },
    { input: await sharp({ create: { width: 8, height: 96, channels: 4, background: '#d7a424ff' } }).png().toBuffer(), left: 8, top: 16 },
    { input: await sharp({ create: { width: 8, height: 96, channels: 4, background: '#d7a424ff' } }).png().toBuffer(), left: 112, top: 16 },
  ])
  .png()
  .toBuffer();

const filledPreview = await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#17120fff' },
}).composite([
  { input: await sharp({ create: { width: 90, height: 145, channels: 4, background: '#3b2b1eff' } }).png().toBuffer(), left: 24, top: 30 },
  { input: await sharp({ create: { width: 90, height: 145, channels: 4, background: '#493422ff' } }).png().toBuffer(), left: 206, top: 30 },
  { input: await sharp({ create: { width: 76, height: 92, channels: 4, background: '#b38d45aa' } }).png().toBuffer(), left: 122, top: 54 },
]).png().toBuffer();

const sparseBorderPreview = await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#00000000' },
})
  .composite([
    { input: await sharp({ create: { width: 318, height: 1, channels: 4, background: '#8b887fff' } }).png().toBuffer(), left: 1, top: 1 },
    { input: await sharp({ create: { width: 318, height: 1, channels: 4, background: '#8b887fff' } }).png().toBuffer(), left: 1, top: 178 },
    { input: await sharp({ create: { width: 1, height: 176, channels: 4, background: '#8b887fff' } }).png().toBuffer(), left: 1, top: 2 },
    { input: await sharp({ create: { width: 1, height: 176, channels: 4, background: '#8b887fff' } }).png().toBuffer(), left: 318, top: 2 },
  ])
  .png()
  .toBuffer();

const transparentPreview = await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#00000000' },
}).png().toBuffer();

const statusBarPreview = await sharp({
  create: { width: 394, height: 34, channels: 4, background: '#00000000' },
})
  .composite([
    { input: await sharp({ create: { width: 394, height: 2, channels: 4, background: '#111111ff' } }).png().toBuffer(), left: 0, top: 16 },
    { input: await sharp({ create: { width: 350, height: 3, channels: 4, background: '#b1262eff' } }).png().toBuffer(), left: 20, top: 15 },
    { input: await sharp({ create: { width: 8, height: 8, channels: 4, background: '#d9ad4fff' } }).png().toBuffer(), left: 1, top: 13 },
  ])
  .png()
  .toBuffer();

const slotPreview = await sharp({
  create: { width: 96, height: 105, channels: 4, background: '#00000000' },
})
  .composite([
    { input: await sharp({ create: { width: 88, height: 97, channels: 4, background: '#17130fff' } }).png().toBuffer(), left: 4, top: 4 },
    { input: await sharp({ create: { width: 70, height: 79, channels: 4, background: '#9c7424ff' } }).png().toBuffer(), left: 13, top: 13 },
  ])
  .png()
  .toBuffer();

const closeIconPreview = await sharp(Buffer.from(`
  <svg width="72" height="72" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 15 L57 57 M57 15 L15 57" fill="none" stroke="#777777" stroke-width="17" stroke-linecap="round"/>
    <path d="M15 15 L57 57 M57 15 L15 57" fill="none" stroke="#f5f5f0" stroke-width="11" stroke-linecap="round"/>
  </svg>
`)).png().toBuffer();

const texturePreview = await sharp({
  create: { width: 128, height: 128, channels: 4, background: '#29251fff' },
})
  .composite(await Promise.all(Array.from({ length: 64 }, async (_, index) => {
    const x = (index % 8) * 16;
    const y = Math.floor(index / 8) * 16;
    return {
      input: await sharp({ create: { width: 16, height: 16, channels: 4, background: (index + Math.floor(index / 8)) % 2 ? '#4c4439ff' : '#29251fff' } }).png().toBuffer(),
      left: x,
      top: y,
    };
  })))
  .png()
  .toBuffer();

const closeButtonPreview = await sharp(Buffer.from(`
  <svg width="176" height="176" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="172" height="172" rx="3" fill="#17130f"/>
    <rect x="6" y="6" width="164" height="164" rx="2" fill="#d90808"/>
    <path d="M48 48 L128 128 M128 48 L48 128" fill="none" stroke="#17130f" stroke-width="25" stroke-linecap="round"/>
    <path d="M48 48 L128 128 M128 48 L48 128" fill="none" stroke="#f5f5f0" stroke-width="16" stroke-linecap="round"/>
  </svg>
`)).png().toBuffer();

const component = {
  id: 'test', name: 'Layer10', affinityType: 'GroupNode',
  bounds: { x: 0, y: 0, width: 220, height: 72 },
  childCount: 3, descendantCount: 3, textCount: 0,
  previewUrl: `data:image/png;base64,${preview.toString('base64')}`,
  visualHash: 'a'.repeat(64), duplicateFamily: 'a'.repeat(12), duplicateCount: 1,
  familyName: 'Layer10', suggestedRole: 'Frame', role: 'Frame', assetType: 'Unknown', remembered: false,
  members: [
    { path: [0, 1], name: 'Button Background', affinityType: 'RasterNode', bounds: { x: 0, y: 0, width: 220, height: 72 } },
    { path: [0, 2], name: 'Button Border', affinityType: 'GroupNode', bounds: { x: 4, y: 4, width: 212, height: 64 } },
  ],
  grouping: 'overlap',
  hierarchyKey: '0.0', parentHierarchyKey: '', hierarchyDepth: 0, childHierarchyKeys: [],
  diveMode: 'keep-together', recommendedDiveMode: 'keep-together', diveConfidence: 0, diveReasons: [],
  similarityFamily: 'a'.repeat(12), similarCount: 1, duplicateKind: 'unique',
};

const service = new LocalAiService();
const status = await service.status(true);
assert.equal(status.available, true);
assert.equal(status.provider, 'embedded');
assert.equal(status.endpoint, 'embedded');

const suggestions = await service.analyze([component, { ...component, id: 'duplicate' }]);
assert.equal(suggestions.length, 1, 'Exact duplicate visuals should only be inferred once.');
assert.ok(suggestions[0].confidence >= 0.35 && suggestions[0].confidence <= 0.96);
assert.equal(suggestions[0].name, '', 'The local classifier must not fabricate a name from its predicted type.');
assert.equal(suggestions[0].visualHash, component.visualHash);

const learned = await service.analyze([{ ...component, id: 'visually-similar', visualHash: 'b'.repeat(64) }], [{
  visualHash: component.visualHash,
  role: 'ImageButton',
  assetType: 'Button',
  familyName: 'Shop Button',
  embedding: suggestions[0].embedding,
  diveMode: 'parent-and-children',
  documentTitle: 'Learning fixture',
  updatedAt: new Date().toISOString(),
}]);
assert.equal(learned.length, 1);
assert.equal(learned[0].assetType, 'Button', 'A nearly identical visual should reuse a confirmed local classification.');
assert.equal(learned[0].role, 'ImageButton');
assert.equal(learned[0].learnedDiveMode, 'parent-and-children');
assert.ok((learned[0].learnedFrom || 0) >= 1);
assert.ok((learned[0].nearestLearnedSimilarity || 0) >= 0.98);

const statusBars = await service.analyze([
  {
    ...component,
    id: 'status-bar',
    name: 'StatusBar',
    familyName: 'StatusBar',
    bounds: { x: 0, y: 0, width: 394, height: 34 },
    previewUrl: `data:image/png;base64,${statusBarPreview.toString('base64')}`,
    visualHash: 'c'.repeat(64),
  },
  {
    ...component,
    id: 'generic-bar',
    name: 'Layer17',
    familyName: 'Layer17',
    members: [],
    bounds: { x: 0, y: 0, width: 394, height: 34 },
    previewUrl: `data:image/png;base64,${statusBarPreview.toString('base64')}`,
    visualHash: 'd'.repeat(64),
  },
  {
    ...component,
    id: 'misleading-bar',
    name: 'ReferenceVisual',
    familyName: 'ReferenceVisual',
    members: [],
    bounds: { x: 0, y: 0, width: 394, height: 34 },
    previewUrl: `data:image/png;base64,${statusBarPreview.toString('base64')}`,
    visualHash: 'e'.repeat(64),
  },
]);
assert.equal(statusBars.length, 3);
assert.notEqual(statusBars[0].source, 'name');
assert.equal(statusBars[0].semanticType, 'Bar');
assert.equal(statusBars[1].assetType, 'Unknown');
assert.equal(statusBars[1].source, 'model');
assert.notEqual(statusBars[2].assetType, 'Wallpaper', 'A misleading source name must not select the local type.');
assert.equal(statusBars[2].source, 'model');

const slot = await service.analyze([{
  ...component,
  id: 'sample-cell',
  name: 'SampleSlot1',
  familyName: 'SampleSlot1',
  members: [],
  bounds: { x: 0, y: 0, width: 96, height: 105 },
  previewUrl: `data:image/png;base64,${slotPreview.toString('base64')}`,
  visualHash: '9'.repeat(64),
}]);
assert.equal(slot[0].source, 'model');
assert.equal(slot[0].semanticType, 'Slot');
assert.notEqual(slot[0].source, 'name', 'A source label may trigger cloud review but cannot choose the local type.');

const realRedBackgroundPreview = await readFile(path.resolve('scripts', 'fixtures', 'visual', 'red-background-real.png'));
const realRedBackground = await service.analyze([{
  ...component,
  id: 'real-red-background',
  name: 'asset-0042',
  familyName: 'asset-0042',
  affinityType: 'ShapeNode',
  members: [],
  childCount: 0,
  bounds: { x: 0, y: 0, width: 176, height: 176 },
  previewUrl: `data:image/png;base64,${realRedBackgroundPreview.toString('base64')}`,
  visualHash: '6'.repeat(64),
}]);
assert.equal(realRedBackground[0].assetType, 'Unknown');
assert.equal(realRedBackground[0].name, '');

const border = await service.analyze([{
  ...component,
  id: 'border',
  name: 'Layer1',
  affinityType: 'ShapeNode',
  bounds: { x: 0, y: 0, width: 1988, height: 1148 },
  members: [{ path: [0, 20], name: 'Layer1', affinityType: 'ShapeNode', bounds: { x: 0, y: 0, width: 1988, height: 1148 } }],
  previewUrl: `data:image/png;base64,${borderPreview.toString('base64')}`,
  visualHash: '2'.repeat(64),
}]);
assert.equal(border[0].assetType, 'Border');
assert.equal(border[0].role, 'ImageLabel');

const sparseCanvasBorder = await service.analyze([{
  ...component,
  id: 'sparse-canvas-border',
  name: 'Layer2',
  affinityType: 'ShapeNode',
  bounds: { x: 0, y: 0, width: 1932, height: 1092 },
  members: [{ path: [0, 21], name: 'Layer2', affinityType: 'ShapeNode', bounds: { x: 0, y: 0, width: 1932, height: 1092 } }],
  previewUrl: `data:image/png;base64,${sparseBorderPreview.toString('base64')}`,
  visualHash: '7'.repeat(64),
}]);
assert.equal(sparseCanvasBorder[0].assetType, 'Border');

const wallpaper = await service.analyze([{
  ...component,
  id: 'wallpaper',
  name: 'asset-0001.png',
  affinityType: 'ImageNode',
  bounds: { x: 0, y: 0, width: 1929, height: 1089 },
  members: [{ path: [0, 2], name: 'asset-0001.png', affinityType: 'ImageNode', bounds: { x: 0, y: 0, width: 1929, height: 1089 } }],
  previewUrl: `data:image/png;base64,${filledPreview.toString('base64')}`,
  analysisPreviewUrls: [`data:image/png;base64,${closeIconPreview.toString('base64')}`],
  visualHash: '3'.repeat(64),
}]);
assert.equal(wallpaper[0].assetType, 'Wallpaper');

const referenceWallpaperPreview = filledPreview;
const referenceWallpaper = await service.analyze([{
  ...component,
  id: 'reference-wallpaper',
  name: 'asset-0001.png',
  familyName: 'asset-0001.png',
  affinityType: 'ImageNode',
  members: [],
  childCount: 0,
  bounds: { x: 0, y: 0, width: 1929, height: 1089 },
  previewUrl: `data:image/png;base64,${referenceWallpaperPreview.toString('base64')}`,
  visualHash: '1'.repeat(64),
}]);
assert.equal(referenceWallpaper[0].assetType, 'Wallpaper');
assert.equal(referenceWallpaper[0].name, '');

const realBorderFixtures = await Promise.all([
  readFile(path.resolve('scripts', 'fixtures', 'visual', 'border-wide-single.png')),
  readFile(path.resolve('scripts', 'fixtures', 'visual', 'border-wide-double.png')),
]);
const realBorders = await service.analyze(realBorderFixtures.map((previewBuffer, index) => ({
  ...component,
  id: `real-border-${index}`,
  name: `Layer${index + 1}`,
  affinityType: 'ShapeNode',
  members: [],
  childCount: 0,
  bounds: { x: 0, y: 0, width: index ? 1932 : 1988, height: index ? 1092 : 1148 },
  previewUrl: `data:image/png;base64,${previewBuffer.toString('base64')}`,
  analysisPreviewUrls: [`data:image/png;base64,${filledPreview.toString('base64')}`],
  visualHash: String(index + 6).repeat(64),
})));
assert.deepEqual(
  realBorders.map((result) => result.assetType),
  ['Border', 'Border'],
  JSON.stringify(realBorders.map((result) => ({
    assetType: result.assetType,
    classifierType: result.classifierType,
    classifierConfidence: result.classifierConfidence,
    prototypeType: result.prototypeType,
    prototypeConfidence: result.prototypeConfidence,
    inferencePath: result.inferencePath,
    alternatives: result.alternatives,
  }))),
);

const texture = await service.analyze([{
  ...component,
  id: 'texture',
  name: 'Layer42',
  members: [],
  bounds: { x: 0, y: 0, width: 128, height: 128 },
  previewUrl: `data:image/png;base64,${texturePreview.toString('base64')}`,
  visualHash: '4'.repeat(64),
}]);
assert.equal(texture[0].assetType, 'Unknown');

const closeButton = await service.analyze([{
  ...component,
  id: 'close-button',
  name: 'wut',
  affinityType: 'GroupNode',
  members: [],
  childCount: 2,
  bounds: { x: 0, y: 0, width: 176, height: 176 },
  previewUrl: `data:image/png;base64,${closeButtonPreview.toString('base64')}`,
  visualHash: '5'.repeat(64),
}]);
assert.equal(closeButton[0].assetType, 'Unknown');

const referenceCloseButtonPreview = closeButtonPreview;
const referenceCloseButton = await service.analyze([{
  ...component,
  id: 'reference-close-button',
  name: 'wut',
  familyName: 'wut',
  affinityType: 'GroupNode',
  members: [],
  childCount: 2,
  bounds: { x: 0, y: 0, width: 176, height: 176 },
  previewUrl: `data:image/png;base64,${referenceCloseButtonPreview.toString('base64')}`,
  visualHash: '0'.repeat(64),
}]);
assert.equal(referenceCloseButton[0].assetType, 'Unknown');
assert.equal(referenceCloseButton[0].name, '');

const closeIcon = await service.analyze([{
  ...component,
  id: 'close-icon',
  name: 'marker',
  familyName: 'marker',
  affinityType: 'ArtTextNode',
  members: [],
  childCount: 0,
  bounds: { x: 0, y: 0, width: 61, height: 53 },
  previewUrl: `data:image/png;base64,${closeIconPreview.toString('base64')}`,
  visualHash: '6'.repeat(64),
}]);
assert.equal(closeIcon[0].assetType, 'Texture');
assert.equal(closeIcon[0].name, 'Marker');

console.log(JSON.stringify({
  status,
  suggestion: suggestions[0],
  learned: learned[0],
  statusBars: statusBars.map((result) => ({
    name: result.name,
    type: result.assetType,
    inferencePath: result.inferencePath,
    classifierType: result.classifierType,
    classifierConfidence: result.classifierConfidence,
  })),
  slotType: slot[0].assetType,
  slotInferencePath: slot[0].inferencePath,
  redBackground: { type: realRedBackground[0].assetType, name: realRedBackground[0].name },
  borderType: border[0].assetType,
  borderInferencePath: border[0].inferencePath,
  realBorders: realBorders.map((result) => ({ type: result.assetType, path: result.inferencePath })),
  wallpaperType: wallpaper[0].assetType,
  wallpaperInferencePath: wallpaper[0].inferencePath,
  closeButton: {
    type: closeButton[0].assetType,
    name: closeButton[0].name,
    inferencePath: closeButton[0].inferencePath,
    classifierType: closeButton[0].classifierType,
    classifierConfidence: closeButton[0].classifierConfidence,
  },
  referenceCloseButton: { type: referenceCloseButton[0].assetType, name: referenceCloseButton[0].name },
  closeIcon: { type: closeIcon[0].assetType, name: closeIcon[0].name },
}, null, 2));
