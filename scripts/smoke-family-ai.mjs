import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';

const { encodeEmbedding } = await import('../src/main/embedding-utils.ts');
const { applyComponentIntelligence } = await import('../src/main/component-intelligence-service.ts');
const { applyComponentSceneContext } = await import('../src/main/component-context-service.ts');
const {
  applyApprovedFamilies,
  applyAssetBoundaries,
  applyHostedFamilyAnalyses,
  buildVisualFamilies,
  familyBatchConsistencyIssues,
  familyDecisionConsistencyIssues,
  planHostedFamilyReview,
  familySourceTypeHint,
  requiresIndependentFamilyReview,
  resolveChallengedFamilyAnalysis,
  resolveIndependentFamilyAnalysis,
  visualStructureAnchor,
} = await import('../src/main/component-family-service.ts');

const gatewaySource = await fs.readFile(new URL('../services/ai-server/src/server.mjs', import.meta.url), 'utf8');
const desktopSource = await fs.readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const hostedServiceSource = await fs.readFile(new URL('../src/main/hosted-ai-service.ts', import.meta.url), 'utf8');
assert.match(gatewaySource, /KRYEO_AI_FAMILY_BATCH_SIZE \|\| 8/, 'Cloud classification must use schema-reliable default batch sizes.');
assert.match(gatewaySource, /KRYEO_AI_ESTIMATED_OUTPUT_TOKENS_PER_FAMILY \|\| 40/, 'Cloud budgeting must retain the measured compact-packet estimate.');
assert.match(gatewaySource, /compactOutputFloor = MODEL_TRANSPORT === 'responses' \? 700 : 360/, 'Compact packets must retain bounded output headroom for each provider transport.');
assert.match(gatewaySource, /Direct image inputs preserve the pixel detail of every member/, 'The gateway must use direct labelled family previews by default.');
assert.match(hostedServiceSource, /const REQUIRED_ANALYSIS_VERSION = 'family-v70'/, 'Desktop and gateway must share the current decision contract.');
assert.match(gatewaySource, /return classifyFamilyBatch\(families, context, \[\], signal, model\)/, 'The primary visual lane must make one atomic decision rather than blocking on a separate observation call.');
assert.match(gatewaySource, /isModelProtocolError\(error\) \|\| retryIncompleteSingle/, 'Malformed packets and incomplete single-family decisions must be retried before a family is failed.');
assert.match(desktopSource, /hostedAi\.reviewFamilies/, 'Scan-time disagreements must use bounded batch visual review.');
assert.doesNotMatch(desktopSource, /const challenge = await hostedAi\.explainFamily/, 'Scan-time disagreements must not fan out into one provider call per family.');

const primaryDecision = {
  familyId: 'atomic-decision', fingerprint: 'atomic', familyName: 'Canvas Frame', assetType: 'Frame', role: 'Frame',
  memberNames: [{ visualHash: 'atomic-hash', name: 'Canvas Frame' }], diveMode: 'keep-together', reason: 'Primary.',
  reviewNeeded: true, alternatives: [],
};
const resolvedDecision = resolveChallengedFamilyAnalysis(primaryDecision, {
  reason: 'Independent visual review found a hollow perimeter.', visualDescription: 'A decorative perimeter.', confidence: 0.91,
  evidence: { visual: 0.94, layerName: 0.1, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'Border is a better match.',
  supportsClassification: false, suggestedName: 'Canvas Border', suggestedType: 'Border', suggestedRole: 'ImageLabel', alternatives: [], cached: false,
});
assert.equal(resolvedDecision.familyName, 'Canvas Border');
assert.equal(resolvedDecision.assetType, 'Border');
assert.equal(resolvedDecision.role, 'ImageLabel');
assert.equal(resolvedDecision.memberNames[0].name, 'Canvas Border');

const renamedSameTypeDecision = resolveChallengedFamilyAnalysis({
  ...primaryDecision,
  familyName: 'Decorative Scroll Bar',
  assetType: 'Bar',
  role: 'ImageLabel',
}, {
  reason: 'The source identity is visually compatible and the compound subtype is unsupported.', visualDescription: 'A thin status bar.', confidence: 0.9,
  evidence: { visual: 0.9, layerName: 0.7, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'Use one coherent Bar decision.',
  supportsClassification: false, suggestedName: 'Focus Bar', suggestedType: 'Bar', suggestedRole: 'ImageLabel', alternatives: [], cached: false,
});
assert.equal(renamedSameTypeDecision.familyName, 'Focus Bar', 'A complete same-type rename must replace the original decision atomically.');
assert.equal(renamedSameTypeDecision.assetType, 'Bar');

const batchReviewedDecision = resolveIndependentFamilyAnalysis(primaryDecision, {
  ...primaryDecision,
  familyName: 'Decorative Border',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: 'atomic-hash', name: 'Decorative Border' }],
  reason: 'The independent visual batch found a hollow perimeter.',
  reviewNeeded: false,
});
assert.equal(batchReviewedDecision.familyName, 'Decorative Border');
assert.equal(batchReviewedDecision.assetType, 'Border');
assert.equal(batchReviewedDecision.role, 'ImageLabel');
assert.equal(batchReviewedDecision.reviewNeeded, false);

const unresolvedDecision = resolveChallengedFamilyAnalysis(primaryDecision, {
  reason: 'The independent reviewer disagreed but could not read the preview clearly.', visualDescription: 'Tiny ambiguous artwork.', confidence: 0.43,
  evidence: { visual: 0.43, layerName: 0.1, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'The primary decision is not sufficiently supported.',
  supportsClassification: false, suggestedName: 'Possible Border', suggestedType: undefined, suggestedRole: undefined, alternatives: [{ assetType: 'Border', reason: 'A perimeter may be present.' }], cached: false,
});
assert.equal(unresolvedDecision.familyName, primaryDecision.familyName, 'An incomplete challenge must not partially replace a decision.');
assert.equal(unresolvedDecision.assetType, primaryDecision.assetType);
assert.equal(unresolvedDecision.reviewNeeded, true, 'An incomplete rejected decision must remain visibly unresolved.');
assert.equal(unresolvedDecision.conflict, true);

const sourceEvidenceFamily = buildVisualFamilies([
  candidate('source-evidence', 'e'.repeat(64), 'SampleBorder', { x: 0, y: 0, width: 96, height: 96 }, [0.3, 0.2, 0.1]),
], [], 'Project', 'Document')[0];
assert.equal(familySourceTypeHint(sourceEvidenceFamily), 'Border');
assert.equal(requiresIndependentFamilyReview({
  ...primaryDecision,
  familyId: sourceEvidenceFamily.id,
  familyName: 'Canvas Badge',
  assetType: 'Badge',
  role: 'ImageLabel',
  memberNames: [{ visualHash: sourceEvidenceFamily.members[0].visualHash, name: 'Canvas Badge' }],
  confidence: 0.91,
  reviewNeeded: false,
  conflict: false,
}, sourceEvidenceFamily), false, 'A source type disagreement alone is confidence context, not a second visual decision.');

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
assert.deepEqual(families.map((family) => family.namingScopeKey), ['1', '2', '3']);
const scopeParent = candidate('scope-parent', 'd'.repeat(64), 'Assembly', { x: 0, y: 0, width: 120, height: 120 }, [0, 1, 0]);
scopeParent.childHierarchyKeys = ['scope-child-a', 'scope-child-b'];
const scopeChildA = candidate('scope-child-a', 'e'.repeat(64), 'Layer', { x: 0, y: 0, width: 20, height: 20 }, [0, 1, 0], 'scope-parent');
const scopeChildB = candidate('scope-child-b', 'f'.repeat(64), 'Layer', { x: 90, y: 90, width: 20, height: 20 }, [0, 1, 0], 'scope-parent');
const scopedFamilies = buildVisualFamilies([scopeParent, scopeChildA, scopeChildB], [], 'Project', 'Document');
assert.equal(scopedFamilies.length, 3, 'A composed group and its construction layers must each receive a visual decision scope.');
assert.equal(scopedFamilies.find((family) => family.members[0].hierarchyKey === 'scope-parent')?.assetBoundary, 'composed-parent');
assert.equal(scopedFamilies.find((family) => family.members[0].hierarchyKey === 'scope-parent')?.contextMembers?.length, 2, 'Direct child thumbnails must support the composed-parent decision.');
assert.equal(scopeChildA.assetBoundary, 'construction-child');
assert.equal(scopeChildB.assetBoundary, 'construction-child');
assert.equal(scopeChildA.exportTarget, false, 'Construction layers cannot compete with their composed parent in export planning.');
assert.ok(scopedFamilies.some((family) => family.members[0].hierarchyKey === 'scope-child-a'), 'A construction layer must still receive a semantic classification.');
const namedConstructionChild = {
  ...scopeChildA,
  familyName: 'Assembly Border 1',
  layerLabel: 'Assembly Border 1',
  exportName: 'Assembly Border 1',
  aiSuggestedName: 'Assembly Border 1',
  aiModelSuggestedName: 'Assembly Border 1',
  assetType: 'Border',
  role: 'ImageLabel',
  analysisSource: 'hosted-family',
  analysisState: 'analyzed',
  exportTarget: false,
  remembered: false,
};
applyComponentSceneContext([namedConstructionChild]);
assert.equal(namedConstructionChild.exportName, 'Assembly Border 1', 'A construction child keeps its completed AI name for Affinity organisation.');
assert.equal(namedConstructionChild.exportTarget, false, 'A construction child remains excluded from the PNG export plan.');
const editableOwner = candidate('editable-owner', '7'.repeat(64), 'Group', { x: 0, y: 320, width: 80, height: 80 }, [0, 1, 0]);
editableOwner.renderHash = 'shared-render';
editableOwner.childHierarchyKeys = ['editable-owner.child'];
const editableOwnerChild = candidate('editable-owner.child', '8'.repeat(64), 'Layer', { x: 0, y: 320, width: 80, height: 20 }, [0, 1, 0], 'editable-owner');
const flatRepresentation = candidate('flat-representation', '9'.repeat(64), 'Raster', { x: 100, y: 320, width: 80, height: 80 }, [0, 1, 0]);
flatRepresentation.renderHash = 'shared-render';
flatRepresentation.keptInsideParent = true;
applyAssetBoundaries([editableOwner, editableOwnerChild, flatRepresentation]);
const duplicateScopedFamilies = buildVisualFamilies([editableOwner, editableOwnerChild, flatRepresentation], [], 'Project', 'Document');
assert.equal(flatRepresentation.assetBoundary, 'duplicate-representation');
assert.equal(flatRepresentation.exportTarget, false);
assert.equal(duplicateScopedFamilies.length, 2, 'The editable group and its construction child receive decisions, while the flattened raster representation remains non-competing evidence.');
assert.ok(!duplicateScopedFamilies.some((family) => family.members[0].hierarchyKey === 'flat-representation'), 'A flattened duplicate must not receive a competing semantic decision.');
const matchingScopeParent = candidate('matching-scope-parent', '1'.repeat(64), 'Assembly Copy', { x: 180, y: 0, width: 120, height: 120 }, [0, 1, 0]);
matchingScopeParent.childHierarchyKeys = ['matching-scope-child-a', 'matching-scope-child-b'];
const matchingScopeChildA = candidate('matching-scope-child-a', '2'.repeat(64), 'Layer', { x: 180, y: 0, width: 20, height: 20 }, [0, 1, 0], 'matching-scope-parent');
const matchingScopeChildB = candidate('matching-scope-child-b', '3'.repeat(64), 'Layer', { x: 270, y: 90, width: 20, height: 20 }, [0, 1, 0], 'matching-scope-parent');
scopeParent.similarityFamily = 'corner-assembly';
scopeParent.similarCount = 2;
matchingScopeParent.similarityFamily = 'corner-assembly';
matchingScopeParent.similarCount = 2;
const visuallyEquivalentScopes = buildVisualFamilies(
  [scopeParent, scopeChildA, scopeChildB, matchingScopeParent, matchingScopeChildA, matchingScopeChildB],
  [],
  'Project',
  'Document',
);
assert.equal(new Set(visuallyEquivalentScopes.map((family) => family.namingScopeKey)).size, 2,
  'Visually similar groups in different hierarchy roots must retain independent decision scopes.');
const constructionContainer = candidate('construction-container', '4'.repeat(64), 'Group', { x: 0, y: 160, width: 120, height: 40 }, [0, 1, 0]);
constructionContainer.diveMode = 'children-only';
constructionContainer.childHierarchyKeys = ['construction-a', 'construction-b'];
const constructionA = candidate('construction-a', '5'.repeat(64), 'Layer', { x: 0, y: 160, width: 20, height: 20 }, [0, 1, 0], 'construction-container');
const constructionB = candidate('construction-b', '6'.repeat(64), 'Layer', { x: 90, y: 180, width: 20, height: 20 }, [0, 1, 0], 'construction-container');
const anonymousSiblingFamilies = buildVisualFamilies(
  [constructionContainer, constructionA, constructionB], [], 'Project', 'Document',
);
assert.equal(anonymousSiblingFamilies.length, 2, 'An organizational parent must expose its independent children as separate decisions.');
assert.deepEqual(
  anonymousSiblingFamilies.map((family) => [family.siblingOrdinal, family.siblingCount]),
  [[1, 2], [2, 2]],
  'Sibling document-order metadata must remain attached to each independent family.',
);
const siblingConsistency = familyBatchConsistencyIssues(anonymousSiblingFamilies.map((family, index) => ({
  familyId: family.id,
  fingerprint: family.fingerprint,
  familyName: index === 0 ? 'Alpha Border 2' : 'Beta Border 1',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: family.members[0].visualHash, name: index === 0 ? 'Alpha Border 2' : 'Beta Border 1' }],
  diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
})), anonymousSiblingFamilies);
assert.equal(siblingConsistency.size, anonymousSiblingFamilies.length, 'Anonymous sibling root/order drift must require a full visual review.');
const mixedSiblingTypes = familyBatchConsistencyIssues(anonymousSiblingFamilies.map((family, index) => ({
  familyId: family.id,
  fingerprint: family.fingerprint,
  familyName: index === 0 ? 'Neutral Border 1' : 'Neutral Frame 2',
  assetType: index === 0 ? 'Border' : 'Frame',
  role: index === 0 ? 'ImageLabel' : 'Frame',
  memberNames: [{ visualHash: family.members[0].visualHash, name: index === 0 ? 'Neutral Border 1' : 'Neutral Frame 2' }],
  diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
})), anonymousSiblingFamilies);
assert.equal(mixedSiblingTypes.size, anonymousSiblingFamilies.length, 'Anonymous construction siblings with drifting types must all be challenged together.');
const ancestorParent = candidate('ancestor-parent', 'p'.repeat(64), 'Context Assembly', { x: 0, y: 0, width: 120, height: 120 }, [0.2, 0.2, 0.2]);
ancestorParent.diveMode = 'children-only';
ancestorParent.childHierarchyKeys = ['ancestor-child'];
const ancestorChild = candidate('ancestor-child', 'q'.repeat(64), 'Layer', { x: 0, y: 0, width: 96, height: 96 }, [0.2, 0.2, 0.2], 'ancestor-parent');
const ancestorFamily = buildVisualFamilies([ancestorParent, ancestorChild], [], 'Project', 'Document').find((family) => family.members[0].hierarchyKey === 'ancestor-child');
assert.ok(ancestorFamily);
assert.ok(familyDecisionConsistencyIssues({
  familyId: ancestorFamily.id, fingerprint: ancestorFamily.fingerprint, familyName: 'Context Assembly Border', assetType: 'Border', role: 'ImageLabel',
  memberNames: [{ visualHash: ancestorChild.visualHash, name: 'Context Assembly Border' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, ancestorFamily).some((issue) => /ancestor identity/i.test(issue)), 'A child may not inherit an irrelevant ancestor identity as its asset name.');
assert.ok(familyDecisionConsistencyIssues({
  familyId: ancestorFamily.id, fingerprint: ancestorFamily.fingerprint, familyName: 'Context Assembly', assetType: 'Border', role: 'ImageLabel',
  memberNames: [{ visualHash: ancestorChild.visualHash, name: 'Context Assembly' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, ancestorFamily).some((issue) => /missing its final Border type/i.test(issue)), 'A complete AI decision must keep its name and final type in agreement.');
const identityFamily = buildVisualFamilies([
  candidate('identity-child', 'r'.repeat(64), 'FocusBar', { x: 0, y: 0, width: 180, height: 16 }, [0.4, 0.4, 0.4]),
], [], 'Project', 'Document')[0];
assert.ok(!familyDecisionConsistencyIssues({
  familyId: identityFamily.id, fingerprint: identityFamily.fingerprint, familyName: 'Decorative Blue Bar', assetType: 'Bar', role: 'ImageLabel',
  memberNames: [{ visualHash: identityFamily.members[0].visualHash, name: 'Decorative Blue Bar' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, identityFamily).some((issue) => /human-authored identity/i.test(issue)), 'Source identity can inform confidence but must not force a naming template.');
assert.ok(familyDecisionConsistencyIssues({
  familyId: identityFamily.id, fingerprint: identityFamily.fingerprint, familyName: 'Bar Focus 1', assetType: 'Bar', role: 'ImageLabel',
  memberNames: [{ visualHash: identityFamily.members[0].visualHash, name: 'Bar Focus 1' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, identityFamily).some((issue) => /descriptive identity/i.test(issue)), 'Type-first model grammar must trigger complete visual review.');
assert.equal(planHostedFamilyReview({
  ...families[0],
  reviewSignals: {
    localConfidence: 0.94,
    localMargin: 0.22,
    visualStructureConfidence: 0.88,
    semanticConflict: false,
    meaningfulLayerName: true,
    hierarchyAmbiguity: 0.05,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 1,
  },
}).tier, 'local');
assert.equal(planHostedFamilyReview({
  ...families[1],
  reviewSignals: {
    localConfidence: 0.61,
    localMargin: 0.04,
    visualStructureConfidence: 0.35,
    semanticConflict: true,
    meaningfulLayerName: true,
    hierarchyAmbiguity: 0.7,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 0.5,
  },
}).tier, 'escalation');
assert.equal(planHostedFamilyReview({
  ...families[2],
  reviewSignals: {
    localConfidence: 0.8,
    localMargin: 0.11,
    visualStructureConfidence: 0,
    semanticConflict: false,
    meaningfulLayerName: false,
    hierarchyAmbiguity: 0.15,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 1,
  },
}).tier, 'lite');
const firstFamily = families.find((family) => family.members[0].visualHash === 'a'.repeat(64));
const secondFamily = families.find((family) => family.members[0].visualHash === 'b'.repeat(64));
assert.ok(firstFamily);
assert.ok(secondFamily);

const hosted = applyHostedFamilyAnalyses(components, families, [
  {
    familyId: firstFamily.id,
    fingerprint: firstFamily.fingerprint,
    familyName: 'Sample Border 1',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'a'.repeat(64), name: 'Sample Border 1' }],
    diveMode: 'keep-together',
    reason: 'This visual is a decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
  {
    familyId: secondFamily.id,
    fingerprint: secondFamily.fingerprint,
    familyName: 'Sample Border 2',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'b'.repeat(64), name: 'Sample Border 2' }],
    diveMode: 'keep-together',
    reason: 'This separate visual is another decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
]);
assert.equal(hosted[0].assetType, 'Border');
assert.equal(hosted[0].familyName, 'Sample Border 1');
assert.equal(hosted[1].familyName, 'Sample Border 2');
assert.equal(hosted[2].analysisState, 'provisional');
assert.equal(hosted[2].assetType, 'Unknown', 'A family without a cloud packet must not retain a local semantic guess.');
assert.equal(hosted[2].exportTarget, false, 'An unresolved family must not be exported automatically.');

const identityComponents = [
  candidate('4', 'd'.repeat(64), 'BadgeAnchor', { x: 0, y: 0, width: 37, height: 23 }, [0.2, 0.3, 0.4]),
  {
    ...candidate('5', 'e'.repeat(64), 'Grid', { x: 0, y: 0, width: 1923, height: 1083 }, [0.4, 0.3, 0.2]),
    semanticType: 'Overlay',
    nameSource: 'layer-name',
  },
  {
    ...candidate('6', 'f'.repeat(64), 'PatternTexture', { x: 0, y: 0, width: 1920, height: 1080 }, [0.3, 0.4, 0.2]),
    semanticType: 'Texture',
    nameSource: 'layer-name',
  },
];
const identityFamilies = buildVisualFamilies(identityComponents, [], 'Project', 'Document');
const identityAnalyses = identityFamilies.map((family) => {
  const sourceName = family.members[0].name;
  const visualType = sourceName === 'BadgeAnchor' ? 'Badge' : sourceName === 'Grid' ? 'Texture' : 'Overlay';
  const modelName = sourceName === 'BadgeAnchor' ? 'Background' : sourceName === 'Grid' ? 'Pattern Grid' : 'Transparent Overlay';
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
assert.equal(identityResults[0].familyName, '', 'A bare type name must remain unresolved instead of being fabricated into a semantic identity.');
assert.equal(identityResults[0].assetType, 'Badge');
assert.equal(identityResults[1].familyName, '', 'A name without its final Texture type must remain unresolved.');
assert.equal(identityResults[1].assetType, 'Texture');
assert.equal(identityResults[2].familyName, 'Transparent Overlay');
assert.equal(identityResults[2].assetType, 'Overlay');

const weakHostedScene = candidate(
  '7',
  '7'.repeat(64),
  'asset-0001.png',
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
  'BorderAssembly',
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
    familyName: family.members[0].name === 'asset-0001.png' ? 'Backdrop' : 'Background',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: family.members[0].name === 'asset-0001.png' ? 'Backdrop' : 'Background' }],
    diveMode: 'keep-together',
    reason: 'Weak hosted result.',
    visualDescription: 'A broad illustrated surface with high visual coverage.',
    confidence: 0.55,
    evidence: { visual: 0, layerName: 0, hierarchy: 0, learned: 0 },
    reviewNeeded: true,
    conflict: false,
    conflictMessage: '',
    alternatives: [],
  })));
assert.equal(weakHostedResults[0].assetType, 'Background');
assert.equal(weakHostedResults[0].familyName, '', 'A source-only backdrop name must remain unresolved when it omits the final Background type.');
assert.equal(weakHostedResults[1].assetType, 'Background');
assert.equal(weakHostedResults[1].analysisState, 'needs-review');

const decorativeBorderGroup = {
  ...candidate('decorative-group', 'h'.repeat(64), 'BorderLayers', { x: 0, y: 0, width: 121, height: 121 }, [0.2, 0.6, 0.2]),
  affinityType: 'GroupNode',
  grouping: 'existing-group',
  childHierarchyKeys: ['decorative-group.0', 'decorative-group.1', 'decorative-group.2', 'decorative-group.3'],
  visualMetrics: {
    visiblePixelRatio: 0.28,
    opaquePixelRatio: 0.22,
    meanAlpha: 0.25,
    // The artwork is inset from the canvas, so the legacy canvas-edge metric
    // misses it and the broad canvas-centre region includes the rim itself.
    edgeVisibleRatio: 0.01,
    centerVisibleRatio: 0.22,
    innerVisibleRatio: 0.01,
    contentPerimeterVisibleRatio: 0.24,
    contentPerimeterCoverage: 0.86,
  },
};
const decorativeBorderFamilies = buildVisualFamilies([decorativeBorderGroup], [], 'Project', 'Document');
const decorativeBorderResults = applyHostedFamilyAnalyses([decorativeBorderGroup], decorativeBorderFamilies, [{
  familyId: decorativeBorderFamilies[0].id,
  fingerprint: decorativeBorderFamilies[0].fingerprint,
  familyName: 'Border Frame',
  assetType: 'Frame',
  role: 'Frame',
  memberNames: [{ visualHash: decorativeBorderGroup.visualHash, name: 'Border Frame' }],
  diveMode: 'keep-together',
  reason: 'The hosted reviewer called this a frame.',
  visualDescription: '',
  confidence: 0.86,
  evidence: { visual: 0.86, layerName: 0, hierarchy: 0.2, learned: 0 },
  reviewNeeded: false,
  conflict: false,
  conflictMessage: '',
  alternatives: [],
}]);
assert.equal(visualStructureAnchor(decorativeBorderGroup)?.type, 'Border');
assert.equal(decorativeBorderResults[0].assetType, 'Frame');
assert.equal(decorativeBorderResults[0].role, 'Frame');
assert.equal(decorativeBorderResults[0].familyName, '', 'A name that conflicts with its final Frame type must remain unresolved.');
assert.equal(decorativeBorderResults[0].analysisState, 'needs-review');
assert.equal(decorativeBorderResults[0].semanticConflict, true);

const opaqueNameComponents = [
  {
    ...weakHostedScene,
    id: 'opaque-wallpaper',
    hierarchyKey: 'opaque-wallpaper',
    visualHash: 'w'.repeat(64),
    duplicateFamily: 'w'.repeat(12),
    similarityFamily: 'w'.repeat(12),
  },
  {
    ...candidate('opaque-middle', 'm'.repeat(64), 'Marker', { x: 0, y: 0, width: 103, height: 103 }, [0.4, 0.4, 0.2]),
    affinityType: 'GroupNode',
  },
  candidate('opaque-glow', 'g'.repeat(64), 'Layer6Accent', { x: 0, y: 0, width: 103, height: 103 }, [0.2, 0.4, 0.4]),
];
const opaqueNameFamilies = buildVisualFamilies(opaqueNameComponents, [], 'Project', 'Document');
const opaqueNameResults = applyHostedFamilyAnalyses(
  opaqueNameComponents,
  opaqueNameFamilies,
  opaqueNameFamilies.map((family) => {
    const source = family.members[0].name;
    const assetType = source === 'asset-0001.png' ? 'Wallpaper' : source === 'Marker' ? 'Badge' : 'Ornament';
    const visualDescription = source === 'asset-0001.png'
      ? 'A broad illustrated surface with high visual coverage.'
      : source === 'Marker'
        ? 'A decorative diamond medallion with four points.'
        : 'A pale gold diamond glow surrounding a decorative border.';
    return {
      familyId: family.id,
      fingerprint: family.fingerprint,
      familyName: source === 'Layer6Accent' ? 'Perimeter Ornament' : source,
      assetType,
      role: 'ImageLabel',
      memberNames: [{ visualHash: family.members[0].visualHash, name: source === 'Layer6Accent' ? 'Perimeter Ornament' : source }],
      diveMode: 'keep-together',
      reason: 'Visual analysis.',
      visualDescription,
      confidence: 0.9,
      evidence: { visual: 0.9, layerName: 0.1, hierarchy: 0.7, learned: 0 },
      reviewNeeded: false,
      conflict: false,
      conflictMessage: '',
      alternatives: [],
    };
  }),
);
assert.equal(opaqueNameResults[0].familyName, '');
assert.equal(opaqueNameResults[1].familyName, '', 'A source-only marker name must remain unresolved when it omits the final Badge type.');
assert.equal(opaqueNameResults[2].familyName, 'Perimeter Ornament');

const geometryOnlyScene = candidate(
  '9',
  '9'.repeat(64),
  'asset-0001.png',
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
    familyName: 'Backdrop',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: geometryOnlyScene.visualHash, name: 'Backdrop' }],
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
assert.equal(geometryOnlyResults[0].assetType, 'Background');

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
