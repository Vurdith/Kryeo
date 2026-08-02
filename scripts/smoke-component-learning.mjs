import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const { WorkspaceService } = await import('../src/main/workspace-service.ts');

const root = path.resolve('tmp', 'component-learning-smoke');
await fs.rm(root, { recursive: true, force: true });
const workspace = new WorkspaceService(() => root);

const candidate = (overrides = {}) => ({
  id: 'hotbar',
  name: 'HotbarSlot1',
  affinityType: 'GroupNode',
  bounds: { x: 20, y: 20, width: 96, height: 96 },
  childCount: 1,
  descendantCount: 4,
  textCount: 0,
  previewUrl: 'data:image/png;base64,',
  visualHash: 'a'.repeat(64),
  duplicateFamily: 'a'.repeat(12),
  duplicateCount: 1,
  familyName: 'Hotbar Slot',
  suggestedRole: 'Frame',
  role: 'Frame',
  assetType: 'Slot',
  aiSuggestedName: 'Hotbar Texture',
  aiSuggestedType: 'Texture',
  aiSuggestedRole: 'ImageLabel',
  remembered: false,
  members: [{ path: [0], name: 'HotbarSlot1', affinityType: 'GroupNode', bounds: { x: 20, y: 20, width: 96, height: 96 } }],
  grouping: 'existing-group',
  hierarchyKey: '0',
  parentHierarchyKey: '',
  hierarchyDepth: 0,
  childHierarchyKeys: ['0.0'],
  diveMode: 'parent-and-children',
  recommendedDiveMode: 'parent-and-children',
  diveConfidence: 0.91,
  diveReasons: ['Contains a replaceable nested visual.'],
  visualEmbedding: 'AQIDBA==',
  learnedFrom: 0,
  nearestLearnedSimilarity: 0,
  similarityFamily: 'family-a',
  similarCount: 1,
  duplicateKind: 'unique',
  ...overrides,
});

const child = candidate({
  id: 'icon',
  name: 'SkillHolder',
  visualHash: 'b'.repeat(64),
  duplicateFamily: 'b'.repeat(12),
  familyName: 'Skill Icon',
  assetType: 'Icon',
  role: 'ImageLabel',
  hierarchyKey: '0.0',
  parentHierarchyKey: '0',
  hierarchyDepth: 1,
  childHierarchyKeys: [],
  diveMode: 'keep-together',
  recommendedDiveMode: 'keep-together',
  members: [{ path: [0, 0], name: 'SkillHolder', affinityType: 'GroupNode', bounds: { x: 34, y: 34, width: 48, height: 48 } }],
});

const snapshot = await workspace.saveComponentReview({
  documentTitle: 'HUD Components',
  documentSessionUuid: 'session-test',
  components: [candidate(), child],
  includedIds: ['hotbar', 'icon'],
});

assert.equal(snapshot.componentDecisions.length, 2);
assert.equal(snapshot.componentDecisions[0].embedding, 'AQIDBA==');
assert.equal(snapshot.componentDecisions[0].suggestedType, 'Texture');
assert.equal(snapshot.componentDecisions[0].suggestedRole, 'ImageLabel');
assert.equal(snapshot.componentDecisions[0].correctionCount, 1);
assert.equal(snapshot.componentManifests.length, 1);
assert.equal(snapshot.componentManifests[0].nodes.length, 2);
assert.equal(snapshot.componentManifests[0].nodes[1].parentId, '0');
assert.equal(snapshot.componentManifests[0].nodes[0].diveMode, 'parent-and-children');
const saved = JSON.parse(await fs.readFile(snapshot.componentManifests[0].path, 'utf8'));
assert.equal(saved.nodes[1].familyName, 'Skill Icon');

const afterForget = await workspace.forgetComponentDecision('b'.repeat(64));
assert.equal(afterForget.componentDecisions.length, 1);
assert.equal(afterForget.componentDecisions[0].visualHash, 'a'.repeat(64));

const afterClear = await workspace.clearComponentDecisions();
assert.equal(afterClear.componentDecisions.length, 0);
assert.equal(afterClear.componentManifests.length, 1, 'Resetting learned visuals must preserve review manifests.');

console.log(JSON.stringify({
  decisions: snapshot.componentDecisions.length,
  decisionsAfterForget: afterForget.componentDecisions.length,
  decisionsAfterClear: afterClear.componentDecisions.length,
  manifest: snapshot.componentManifests[0].path,
  hierarchy: saved.nodes.map((node) => ({ id: node.id, parentId: node.parentId, included: node.included })),
}, null, 2));
