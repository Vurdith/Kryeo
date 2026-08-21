import assert from 'node:assert/strict';
import { applyComponentIntelligence } from '../src/main/component-intelligence-service.ts';
import {
  applyHostedFamilyAnalyses,
  buildVisualFamilies,
  countLocallyHandledFamilies,
  planHostedFamilyReview,
} from '../src/main/component-family-service.ts';

const bounds = { x: 0, y: 0, width: 120, height: 120 };
const perimeterMetrics = {
  innerVisibleRatio: 0.04,
  contentPerimeterVisibleRatio: 0.18,
  contentPerimeterCoverage: 0.82,
  centerVisibleRatio: 0.04,
  edgeVisibleRatio: 0.22,
  visiblePixelRatio: 0.2,
  meanAlpha: 0.7,
};

function candidate(id, visualHash, overrides = {}) {
  return {
    id,
    name: 'Close Button',
    affinityType: 'RasterNode',
    bounds: { ...bounds },
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    semanticNames: [],
    path: `C:\\fixture\\${id}.png`,
    hierarchyKey: id,
    parentHierarchyKey: '',
    hierarchyDepth: 0,
    childHierarchyKeys: [],
    previewUrl: 'data:image/png;base64,',
    hostedPreviewUrl: 'data:image/png;base64,',
    analysisPreviewUrls: [],
    visualHash,
    duplicateCount: 1,
    assetType: 'Button',
    role: 'ImageButton',
    aiConfidence: 0.95,
    aiMargin: 0.32,
    visualStructureConfidence: 0.94,
    visualMetrics: perimeterMetrics,
    semanticConflict: false,
    nameSource: 'layer-name',
    diveConfidence: 1,
    nearestLearnedSimilarity: 0,
    learnedFrom: 0,
    exportTarget: true,
    analysisSource: 'local-provisional',
    analysisState: 'provisional',
    diveMode: 'keep-together',
    ...overrides,
  };
}

const clearHash = 'a'.repeat(64);
const conflictHash = 'b'.repeat(64);
const clearComponents = [
  candidate('scope-root', 'c'.repeat(64), {
    name: 'Organizational Group',
    affinityType: 'GroupNode',
    childCount: 2,
    descendantCount: 2,
    childHierarchyKeys: ['0.0', '0.1'],
    diveMode: 'children-only',
    structuralDiveMode: 'children-only',
  }),
  candidate('0.0', clearHash, { parentHierarchyKey: 'scope-root', hierarchyDepth: 1 }),
  candidate('0.1', clearHash, {
    name: 'Close Button Copy',
    parentHierarchyKey: 'scope-root',
    hierarchyDepth: 1,
  }),
];
const clearFamilies = buildVisualFamilies(clearComponents, [], 'Evaluation', 'Cloud fixture');
assert.equal(clearFamilies.length, 1, 'exact visual duplicates inside one decision scope should share one family');
assert.equal(clearFamilies[0].exactInstanceCount, 2);
assert.equal(planHostedFamilyReview(clearFamilies[0]).tier, 'local');

const scopedDuplicates = buildVisualFamilies([
  candidate('0.2', clearHash, { decisionScopeKey: 'scope-a' }),
  candidate('0.3', clearHash, { decisionScopeKey: 'scope-b' }),
], [], 'Evaluation', 'Cloud fixture');
assert.equal(
  scopedDuplicates.length,
  2,
  'exact visual duplicates in different hierarchy scopes must remain separate semantic decisions.',
);

const conflictComponent = candidate('1.0', conflictHash, {
  name: 'Layer 1',
  assetType: 'Unknown',
  role: 'Unknown',
  aiConfidence: 0.55,
  aiMargin: 0.04,
  visualStructureConfidence: 0.3,
  semanticConflict: true,
  nameSource: undefined,
});
const conflictFamily = buildVisualFamilies([conflictComponent], [], 'Evaluation', 'Cloud fixture')[0];
assert.equal(planHostedFamilyReview(conflictFamily).tier, 'escalation');

const approvedFamily = { ...clearFamilies[0], approvedDecision: { familyName: 'Approved', role: 'ImageLabel' } };
assert.equal(
  countLocallyHandledFamilies([clearFamilies[0], conflictFamily, approvedFamily], true),
  1,
  'When cloud review is available, only approved families should count as locally handled.',
);
assert.equal(
  countLocallyHandledFamilies([clearFamilies[0], conflictFamily, approvedFamily], false),
  2,
  'When cloud review is unavailable, unresolved families should remain local and provisional.',
);

const cloudAnalysed = applyHostedFamilyAnalyses(clearComponents, clearFamilies, [{
  familyId: clearFamilies[0].id,
  familyName: 'Close Frame',
  assetType: 'Frame',
  role: 'Frame',
  confidence: 0.96,
  reviewNeeded: false,
  diveMode: 'keep-together',
  reason: 'The fixture model proposed a frame.',
  memberNames: clearFamilies[0].members.map((component) => ({ visualHash: component.visualHash, name: 'Close Frame' })),
  evidence: { visual: 0.96, layerName: 0.1, hierarchy: 0.2, learned: 0 },
}]);
const cloudComponent = cloudAnalysed.find((component) => component.hierarchyKey === '0.0');
assert.ok(cloudComponent, 'The child decision should remain available after its organizational parent is skipped.');
assert.equal(cloudComponent.assetType, 'Frame', 'strong perimeter geometry must trigger an independent review, not rewrite one cloud field locally');
assert.equal(cloudComponent.role, 'Frame');
assert.equal(cloudComponent.analysisState, 'needs-review');
assert.equal(cloudComponent.familyName, 'Close Frame', 'Kryeo retains the original complete decision until a reviewer returns a complete replacement.');
applyComponentIntelligence(cloudAnalysed, false);
assert.equal(cloudComponent.reviewPriority, 'check');

const provisional = applyHostedFamilyAnalyses([conflictComponent], [conflictFamily], []);
assert.equal(provisional[0].analysisSource, 'local-provisional');
assert.equal(provisional[0].analysisState, 'provisional');

console.log(JSON.stringify({
  classification: 'clear local / conflicting escalation',
  localFamilySemantics: 'approved when cloud is available / unresolved when unavailable',
  duplicateFamilies: clearFamilies.length,
  duplicateInstances: clearFamilies[0].exactInstanceCount,
  scopedDuplicateFamilies: scopedDuplicates.length,
  normalizedType: cloudComponent.assetType,
  normalizedRole: cloudComponent.role,
  reviewPriority: cloudComponent.reviewPriority,
  fallbackState: provisional[0].analysisState,
}, null, 2));
