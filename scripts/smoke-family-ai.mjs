import assert from 'node:assert/strict';

const { encodeEmbedding } = await import('../src/main/embedding-utils.ts');
const { applyComponentIntelligence } = await import('../src/main/component-intelligence-service.ts');
const {
  applyApprovedFamilies,
  applyHostedFamilyAnalyses,
  buildVisualFamilies,
  visualStructureAnchor,
} = await import('../src/main/component-family-service.ts');

function candidate(id, visualHash, name, bounds, embedding, parentHierarchyKey = 'root') {
  return {
    id,
    name,
    affinityType: 'RasterNode',
    bounds,
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    previewUrl: 'data:image/png;base64,',
    analysisPreviewUrls: [],
    visualHash,
    duplicateFamily: visualHash.slice(0, 12),
    duplicateCount: 1,
    familyName: name,
    suggestedRole: 'Unknown',
    role: 'Unknown',
    assetType: 'Unknown',
    remembered: false,
    members: [{ path: [Number(id)], name, affinityType: 'RasterNode', bounds }],
    grouping: 'single',
    hierarchyKey: id,
    parentHierarchyKey,
    hierarchyDepth: 1,
    childHierarchyKeys: [],
    diveMode: 'keep-together',
    recommendedDiveMode: 'keep-together',
    diveConfidence: 1,
    diveReasons: [],
    visualEmbedding: encodeEmbedding(new Float32Array(embedding)),
    similarityFamily: visualHash.slice(0, 12),
    similarCount: 1,
    duplicateKind: 'unique',
  };
}

const components = applyComponentIntelligence([
  candidate('1', 'a'.repeat(64), 'Layer1', { x: 0, y: 0, width: 91, height: 91 }, [1, 0.06, 0]),
  candidate('2', 'b'.repeat(64), 'Layer2', { x: 100, y: 0, width: 101, height: 101 }, [0.99, 0.08, 0]),
  candidate('3', 'c'.repeat(64), 'Layer3', { x: 0, y: 200, width: 400, height: 24 }, [0, 0, 1]),
]);

assert.equal(components[0].similarityFamily, components[1].similarityFamily);
assert.notEqual(components[0].similarityFamily, components[2].similarityFamily);
assert.equal(components[0].assetType, 'Unknown', 'Local clustering must not assign semantics.');

const families = buildVisualFamilies(components, [], 'Project', 'Document');
assert.equal(families.length, 3);
assert.ok(families.every((family) => family.members.length === 1));
const firstFamily = families.find((family) => family.members[0].visualHash === 'a'.repeat(64));
const secondFamily = families.find((family) => family.members[0].visualHash === 'b'.repeat(64));
assert.ok(firstFamily);
assert.ok(secondFamily);

const hosted = applyHostedFamilyAnalyses(components, families, [
  {
    familyId: firstFamily.id,
    fingerprint: firstFamily.fingerprint,
    familyName: 'Ornate Border 1',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'a'.repeat(64), name: 'Ornate Border 1' }],
    diveMode: 'keep-together',
    reason: 'This visual is a decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
  {
    familyId: secondFamily.id,
    fingerprint: secondFamily.fingerprint,
    familyName: 'Ornate Border 2',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'b'.repeat(64), name: 'Ornate Border 2' }],
    diveMode: 'keep-together',
    reason: 'This separate visual is another decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
]);
assert.equal(hosted[0].assetType, 'Border');
assert.equal(hosted[0].familyName, 'Ornate Border 1');
assert.equal(hosted[1].familyName, 'Ornate Border 2');
assert.equal(hosted[2].analysisState, 'provisional');

const identityComponents = [
  candidate('4', 'd'.repeat(64), 'NumberHolder', { x: 0, y: 0, width: 37, height: 23 }, [0.2, 0.3, 0.4]),
  {
    ...candidate('5', 'e'.repeat(64), 'Grid', { x: 0, y: 0, width: 1923, height: 1083 }, [0.4, 0.3, 0.2]),
    semanticType: 'Overlay',
    nameSource: 'layer-name',
  },
  {
    ...candidate('6', 'f'.repeat(64), 'CheckeredTexture', { x: 0, y: 0, width: 1920, height: 1080 }, [0.3, 0.4, 0.2]),
    semanticType: 'Texture',
    nameSource: 'layer-name',
  },
];
const identityFamilies = buildVisualFamilies(identityComponents, [], 'Project', 'Document');
const identityAnalyses = identityFamilies.map((family) => {
  const sourceName = family.members[0].name;
  const visualType = sourceName === 'NumberHolder' ? 'Badge' : sourceName === 'Grid' ? 'Texture' : 'Overlay';
  const modelName = sourceName === 'NumberHolder' ? 'Background' : sourceName === 'Grid' ? 'Library Grid' : 'Transparent Overlay';
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: modelName,
    assetType: visualType,
    role: 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: modelName }],
    diveMode: 'keep-together',
    reason: 'Visual analysis.',
    reviewNeeded: false,
    alternatives: [],
  };
});
const identityResults = applyHostedFamilyAnalyses(identityComponents, identityFamilies, identityAnalyses);
assert.equal(identityResults[0].familyName, 'Number Holder');
assert.equal(identityResults[0].assetType, 'Badge');
assert.equal(identityResults[1].familyName, 'Grid');
assert.equal(identityResults[1].assetType, 'Texture');
assert.equal(identityResults[2].familyName, 'Checkered Overlay');
assert.equal(identityResults[2].assetType, 'Overlay');

const weakHostedScene = candidate(
  '7',
  '7'.repeat(64),
  '10570641.jpg',
  { x: 0, y: 0, width: 1929, height: 1089 },
  [0.2, 0.5, 0.3],
);
weakHostedScene.affinityType = 'ImageNode';
weakHostedScene.visualMetrics = {
  visiblePixelRatio: 0.86,
  opaquePixelRatio: 0.8,
  meanAlpha: 0.86,
  edgeVisibleRatio: 0.78,
  centerVisibleRatio: 0.98,
};
weakHostedScene.visualStructureType = 'Wallpaper';
weakHostedScene.visualStructureConfidence = 0.94;
const weakHostedBorder = candidate(
  '8',
  '8'.repeat(64),
  'BackgroundOuterBorder',
  { x: 0, y: 0, width: 1985, height: 1145 },
  [0.3, 0.2, 0.5],
);
weakHostedBorder.assetType = 'Background';
weakHostedBorder.semanticType = 'Border';
weakHostedBorder.nameSource = 'layer-name';
weakHostedBorder.visualStructureType = 'Border';
weakHostedBorder.visualStructureConfidence = 0.96;
const weakHostedFamilies = buildVisualFamilies([weakHostedScene, weakHostedBorder], [], 'Project', 'Document');
const weakHostedResults = applyHostedFamilyAnalyses([weakHostedScene, weakHostedBorder], weakHostedFamilies,
  weakHostedFamilies.map((family) => ({
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: family.members[0].name.includes('10570641') ? 'Scene' : 'Background',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: family.members[0].name.includes('10570641') ? 'Scene' : 'Background' }],
    diveMode: 'keep-together',
    reason: 'Weak hosted result.',
    visualDescription: 'A detailed room with bookshelves, a table, and a glowing window.',
    confidence: 0.55,
    evidence: { visual: 0, layerName: 0, hierarchy: 0, learned: 0 },
    reviewNeeded: true,
    conflict: false,
    conflictMessage: '',
    alternatives: [],
  })));
assert.equal(weakHostedResults[0].assetType, 'Wallpaper');
assert.notEqual(weakHostedResults[0].familyName, 'Scene');
assert.equal(weakHostedResults[1].assetType, 'Border');

const geometryOnlyScene = candidate(
  '9',
  '9'.repeat(64),
  '10570641.jpg',
  { x: 0, y: 0, width: 1929, height: 1089 },
  [0.2, 0.5, 0.3],
);
geometryOnlyScene.affinityType = 'ImageNode';
geometryOnlyScene.visualMetrics = weakHostedScene.visualMetrics;
const geometryOnlyFamilies = buildVisualFamilies([geometryOnlyScene], [], 'Project', 'Document');
const geometryOnlyResults = applyHostedFamilyAnalyses(geometryOnlyFamilies[0].members, geometryOnlyFamilies, [
  {
    familyId: geometryOnlyFamilies[0].id,
    fingerprint: geometryOnlyFamilies[0].fingerprint,
    familyName: 'Scene',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: geometryOnlyScene.visualHash, name: 'Scene' }],
    diveMode: 'keep-together',
    reason: 'Weak hosted result.',
    visualDescription: 'A detailed illustrated interior scene.',
    confidence: 0.55,
    evidence: { visual: 0, layerName: 0, hierarchy: 0, learned: 0 },
    reviewNeeded: true,
    conflict: false,
    conflictMessage: '',
    alternatives: [],
  },
]);
assert.equal(visualStructureAnchor(geometryOnlyScene)?.type, 'Wallpaper');
assert.equal(geometryOnlyResults[0].assetType, 'Wallpaper');

const approvedFamilies = buildVisualFamilies(components, [{
  visualHash: 'a'.repeat(64),
  familyFingerprint: firstFamily.fingerprint,
  familyMemberHashes: ['a'.repeat(64), 'b'.repeat(64)],
  memberNames: [
    { visualHash: 'a'.repeat(64), name: 'Approved Border 1' },
    { visualHash: 'b'.repeat(64), name: 'Approved Border 2' },
  ],
  project: 'Project',
  scope: 'project',
  approved: true,
  role: 'ImageLabel',
  assetType: 'Border',
  familyName: 'Approved Border',
  diveMode: 'keep-together',
  updatedAt: new Date().toISOString(),
}], 'Project', 'Document');
const reused = applyApprovedFamilies(components, approvedFamilies);
assert.equal(reused[0].familyName, 'Approved Border 1');
assert.equal(reused[0].analysisSource, 'approved-family');
assert.notEqual(reused[1].analysisSource, 'approved-family');

console.log(JSON.stringify({
  families: families.map((family) => family.members.map((member) => member.name)),
  hostedNames: hosted.slice(0, 2).map((component) => component.familyName),
  identityNames: identityResults.map((component) => component.familyName),
  approvedNames: reused.slice(0, 2).map((component) => component.familyName),
}, null, 2));
