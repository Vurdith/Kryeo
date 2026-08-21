import assert from 'node:assert/strict';
import { applyComponentSceneContext, componentCategory, componentSubcategory } from '../src/main/component-context-service.ts';

function candidate(overrides = {}) {
  return {
    id: 'component', name: 'Layer 7', familyName: '', layerLabel: 'Layer 7', exportName: '', codeName: '',
    affinityType: 'RasterNode', bounds: { x: 0, y: 0, width: 80, height: 40 }, childCount: 0, descendantCount: 0,
    textCount: 0, previewUrl: '', visualHash: 'a'.repeat(64), duplicateFamily: 'a', duplicateCount: 1,
    exportTarget: true, suggestedRole: 'ImageLabel', role: 'ImageLabel', assetType: 'Button', remembered: false,
    members: [{ path: [0, 0], name: 'Layer 7', affinityType: 'RasterNode', bounds: { x: 0, y: 0, width: 80, height: 40 } }],
    grouping: 'single', hierarchyKey: '0', parentHierarchyKey: '', hierarchyDepth: 0, childHierarchyKeys: [],
    diveMode: 'keep-together', recommendedDiveMode: 'keep-together', diveConfidence: 1, diveReasons: [],
    similarityFamily: 'a', similarCount: 1, duplicateKind: 'unique',
    ...overrides,
  };
}

const modelNamed = applyComponentSceneContext([candidate({
  familyName: 'Arcane Action Button', aiSuggestedName: 'Arcane Action Button',
})])[0];
assert.equal(modelNamed.exportName, 'Arcane Action Button');
assert.equal(modelNamed.codeName, 'arcane_action_button');
assert.equal(modelNamed.layerLabel, 'Arcane Action Button');
assert.equal(modelNamed.automationState, 'ready');

const unresolved = applyComponentSceneContext([candidate()])[0];
assert.equal(unresolved.exportName, '');
assert.equal(unresolved.layerLabel, '');
assert.equal(unresolved.automationState, 'exception');
assert.match(unresolved.namingReason, /did not invent/i);
assert.ok(unresolved.automationIssues?.some((issue) => /distinctive semantic/i.test(issue)));

const remembered = applyComponentSceneContext([candidate({
  remembered: true, exportName: 'Sunken Temple Button', layerLabel: 'Temple Action', familyName: 'Ignored Model Name',
})])[0];
assert.equal(remembered.exportName, 'Sunken Temple Button');
assert.equal(remembered.layerLabel, 'Sunken Temple Button');

const parent = candidate({ id: 'parent', hierarchyKey: 'parent', name: 'Inventory', familyName: 'Inventory', layerLabel: 'Inventory', childHierarchyKeys: ['child'], exportTarget: false, diveMode: 'children-only' });
const child = candidate({ id: 'child', hierarchyKey: 'child', parentHierarchyKey: 'parent', familyName: 'Rune Button', aiSuggestedName: 'Rune Button' });
const hierarchy = applyComponentSceneContext([parent, child]);
assert.equal(componentSubcategory(hierarchy[1], hierarchy), 'Inventory');

const grandchild = candidate({ id: 'grandchild', hierarchyKey: 'grandchild', parentHierarchyKey: 'child', familyName: 'Rune Fill', aiSuggestedName: 'Rune Fill' });
const nestedHierarchy = applyComponentSceneContext([parent, child, grandchild]);
assert.equal(componentSubcategory(nestedHierarchy[2], nestedHierarchy), 'Inventory/Rune Button');
assert.equal(componentCategory('Button'), 'Buttons');
assert.equal(componentCategory('Unknown'), 'Uncategorised');

console.log(JSON.stringify({
  modelName: modelNamed.exportName,
  unresolved: unresolved.automationIssues,
  remembered: remembered.exportName,
  category: componentCategory('Button'),
}, null, 2));
