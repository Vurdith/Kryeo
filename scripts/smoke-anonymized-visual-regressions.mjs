import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const fixturePath = path.resolve('scripts/fixtures/anonymized-visual-regressions.json');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const {
  buildVisualFamilies,
  familySourceTypeHint,
  requiresIndependentFamilyReview,
  resolveChallengedFamilyAnalysis,
  applyHostedFamilyAnalyses,
} = await import('../src/main/component-family-service.ts');

function candidate(node, visual) {
  const [x, y, width, height] = node.bounds;
  return {
    id: node.id,
    name: node.name,
    affinityType: node.affinityType,
    bounds: { x, y, width, height },
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    previewUrl: 'data:image/png;base64,',
    analysisPreviewUrls: [],
    visualHash: createHash('sha256').update(`${visual.hash}:${node.id}`).digest('hex'),
    ...(node.renderKey ? { renderHash: createHash('sha256').update(`${visual.hash}:render:${node.renderKey}`).digest('hex') } : {}),
    visualMetrics: visual.metrics,
    duplicateFamily: node.id.slice(0, 12),
    duplicateCount: 1,
    familyName: '',
    suggestedRole: 'Unknown',
    role: 'Unknown',
    assetType: 'Unknown',
    remembered: false,
    members: [{ path: [0], name: node.name, affinityType: node.affinityType, bounds: { x, y, width, height } }],
    grouping: node.affinityType === 'GroupNode' ? 'existing-group' : 'single',
    hierarchyKey: node.id,
    parentHierarchyKey: node.parentId,
    hierarchyDepth: node.id.split('.').length - 1,
    childHierarchyKeys: [],
    diveMode: 'keep-together',
    recommendedDiveMode: 'keep-together',
    diveConfidence: 1,
    diveReasons: [],
    similarityFamily: node.id,
    similarCount: 1,
    duplicateKind: 'unique',
  };
}

function componentsFor(entry, visual) {
  const components = entry.nodes.map((node) => candidate(node, visual));
  const byId = new Map(components.map((component) => [component.id, component]));
  for (const component of components) {
    if (component.parentHierarchyKey) byId.get(component.parentHierarchyKey)?.childHierarchyKeys.push(component.hierarchyKey);
  }
  return components;
}

function completeDecisionFor(family, assetType, familyName) {
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName,
    assetType,
    role: 'ImageLabel',
    memberNames: family.members.map((member) => ({ visualHash: member.visualHash, name: familyName })),
    diveMode: 'keep-together',
    reason: 'Complete visual decision.',
    confidence: 0.92,
    reviewNeeded: false,
    alternatives: [],
  };
}

for (const entry of fixture.cases) {
  const thumbnailPath = path.resolve('scripts/fixtures', entry.thumbnail);
  const file = await fs.readFile(thumbnailPath);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let edgeVisible = 0;
  let edgePixels = 0;
  let centerVisible = 0;
  let centerPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3] / 255;
      visible += alpha;
      const edge = x < info.width * 0.15 || x >= info.width * 0.85 || y < info.height * 0.15 || y >= info.height * 0.85;
      const center = x >= info.width * 0.3 && x < info.width * 0.7 && y >= info.height * 0.3 && y < info.height * 0.7;
      if (edge) { edgeVisible += alpha; edgePixels += 1; }
      if (center) { centerVisible += alpha; centerPixels += 1; }
    }
  }
  const visual = {
    hash: createHash('sha256').update(file).digest('hex'),
    metrics: {
      visiblePixelRatio: visible / (info.width * info.height),
      opaquePixelRatio: visible / (info.width * info.height),
      meanAlpha: visible / (info.width * info.height),
      edgeVisibleRatio: edgeVisible / edgePixels,
      centerVisibleRatio: centerVisible / centerPixels,
    },
  };
  if (entry.expect.topology === 'filled') {
    assert.ok(visual.metrics.centerVisibleRatio > 0.5, `${entry.id}: real thumbnail must decode as a filled visual`);
  } else if (entry.expect.topology === 'perimeter') {
    assert.ok(visual.metrics.edgeVisibleRatio > visual.metrics.centerVisibleRatio + 0.02, `${entry.id}: real thumbnail must decode as perimeter-weighted`);
  }
  const components = componentsFor(entry, visual);
  const families = buildVisualFamilies(components, [], 'Anonymized', entry.id);
  assert.ok(families.length > 0, `${entry.id}: hierarchy must produce reviewable families`);
  if (entry.expect.sourceHint) {
    assert.equal(familySourceTypeHint(families[0]), entry.expect.sourceHint);
    assert.equal(requiresIndependentFamilyReview({
      familyId: families[0].id,
      fingerprint: families[0].fingerprint,
      familyName: 'Neutral Background',
      assetType: entry.expect.requiresIndependentReviewWhenVisualType,
      role: 'ImageLabel',
      memberNames: [],
      diveMode: 'keep-together',
      reason: 'Visual result.',
      confidence: 0.9,
      reviewNeeded: false,
      alternatives: [],
    }, families[0]), false, `${entry.id}: a direct source label must remain model context, not a local review gate`);
  }
  if (entry.expect.parentKind) {
    const parent = components.find((component) => component.id === 'assembly');
    assert.equal(parent.childHierarchyKeys.length, 2, `${entry.id}: parent owns its construction children`);
    assert.equal(parent.assetBoundary, entry.expect.parentKind, `${entry.id}: editable parent must own one composed decision scope`);
    assert.ok(components.filter((component) => component.parentHierarchyKey === 'assembly').every((component) => (
      component.assetBoundary === entry.expect.childKind && component.exportTarget === false
    )), `${entry.id}: construction children must not become competing export decisions`);
    assert.equal(families.length, 3, `${entry.id}: the composed asset and both construction layers must receive visual decisions`);
    const parentFamily = families.find((family) => family.members[0].hierarchyKey === 'assembly');
    assert.equal(parentFamily?.contextMembers?.length, 2, `${entry.id}: primary decision receives child visual context`);
    assert.equal(families.filter((family) => family.assetBoundary === 'construction-child').length, 2, `${entry.id}: construction layers must be named instead of discarded as Unknown`);
  }
  if (entry.expect.editableOwner) {
    const owner = components.find((component) => component.id === entry.expect.editableOwner);
    const duplicate = components.find((component) => component.id === entry.expect.suppressedRepresentation);
    assert.equal(owner?.assetBoundary, 'composed-parent', `${entry.id}: editable composition is the owner`);
    assert.equal(duplicate?.assetBoundary, 'duplicate-representation', `${entry.id}: flattened copy is structural evidence only`);
    assert.equal(duplicate?.exportTarget, false, `${entry.id}: flattened copy cannot replace editable ownership`);
    assert.equal(families.length, 2, `${entry.id}: the editable owner and its named construction layer receive decisions, while the flattened duplicate does not`);
    assert.ok(!families.some((family) => family.members[0].hierarchyKey === entry.expect.suppressedRepresentation), `${entry.id}: flattened duplicate must remain evidence only`);
  }
  if (entry.expect.documentOrder) {
    assert.deepEqual(components.filter((component) => component.parentHierarchyKey === 'root').map((component) => component.hierarchyKey), entry.expect.documentOrder);
  }

  // Replay a complete hosted decision against the real thumbnail and hierarchy
  // fixture. This prevents a later pass from accepting only a name, type, or
  // grouping change while leaving the other fields stale.
  const expectedDecision = entry.expect.decision;
  const expectedType = expectedDecision.type;
  const expectedName = expectedDecision.name;
  const resolved = applyHostedFamilyAnalyses(components, families, families.map((family) => ({
    ...completeDecisionFor(family, expectedType, expectedName), role: expectedDecision.role, diveMode: expectedDecision.diveMode,
  })));
  const semanticOwners = resolved.filter((component) => component.assetBoundary === 'standalone' || component.assetBoundary === 'composed-parent');
  assert.ok(semanticOwners.length > 0, `${entry.id}: a decision scope must retain an export owner`);
  assert.ok(semanticOwners.every((component) => (
    component.familyName === expectedName
    && component.assetType === expectedType
    && component.role === expectedDecision.role
    && component.diveMode === expectedDecision.diveMode
    && component.exportTarget === true
    && component.analysisState === 'analyzed'
  )), `${entry.id}: a complete hosted packet must apply name, type, role, grouping, and export state atomically`);
  assert.ok(resolved.filter((component) => component.assetBoundary === 'construction-child').every((component) => (
    component.exportTarget === false
    && component.assetType === expectedType
    && component.role === expectedDecision.role
    && component.analysisState === 'analyzed'
  )), `${entry.id}: construction layers retain a complete visual decision but remain excluded from export`);
  assert.ok(resolved.filter((component) => ['duplicate-representation', 'organizational-parent'].includes(component.assetBoundary || '')).every((component) => (
    component.exportTarget === false && component.assetType === 'Unknown'
  )), `${entry.id}: duplicate representations remain structural evidence only`);

  // An incomplete/Unknown result is not a fallback classification. It must
  // remain unresolved and excluded from every export destination.
  const unresolvedComponents = componentsFor(entry, visual);
  const unresolvedFamilies = buildVisualFamilies(unresolvedComponents, [], 'Anonymized', entry.id);
  const unresolved = applyHostedFamilyAnalyses(unresolvedComponents, unresolvedFamilies, [
    completeDecisionFor(unresolvedFamilies[0], 'Unknown', ''),
  ]);
  const unresolvedOwners = unresolved.filter((component) => component.assetBoundary === 'standalone' || component.assetBoundary === 'composed-parent');
  assert.ok(unresolvedOwners.every((component) => (
    component.assetType === 'Unknown'
    && component.familyName === ''
    && component.exportTarget === false
    && component.analysisState === 'needs-review'
    && component.automationState === 'exception'
  )), `${entry.id}: an Unknown packet must stay unresolved instead of leaking into export`);
}

const primary = {
  familyId: 'atomic', fingerprint: 'atomic', familyName: 'Neutral Badge', assetType: 'Badge', role: 'ImageLabel',
  memberNames: [{ visualHash: 'a'.repeat(64), name: 'Neutral Badge' }], diveMode: 'keep-together', reason: 'Primary visual decision.', reviewNeeded: false, alternatives: [],
};
const finalDecision = resolveChallengedFamilyAnalysis(primary, {
  reason: 'Independent visual review selected a perimeter.', visualDescription: 'A hollow rim.', confidence: 0.91,
  evidence: { visual: 0.94, layerName: 0.1, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'Replacement.',
  supportsClassification: false, suggestedName: 'Neutral Border', suggestedType: 'Border', suggestedRole: 'ImageLabel', alternatives: [{ assetType: 'Badge', reason: 'Alternate reading.' }], cached: false,
});
assert.deepEqual(
  [finalDecision.familyName, finalDecision.assetType, finalDecision.role, finalDecision.memberNames[0].name],
  ['Neutral Border', 'Border', 'ImageLabel', 'Neutral Border'],
  'A challenger may replace name, type, role, and member identity only as one decision.',
);
assert.equal(finalDecision.conflict, false, 'A complete challenger replacement is accepted instead of remaining an export conflict.');

console.log(JSON.stringify({ cases: fixture.cases.map((entry) => entry.id), atomic: finalDecision.assetType }, null, 2));
