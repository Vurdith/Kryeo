import assert from 'node:assert/strict';
import { applyComponentSceneContext, componentCategory, componentSubcategory } from '../src/main/component-context-service.ts';

function candidate(overrides) {
  return {
    id: overrides.hierarchyKey,
    name: 'Layer1',
    affinityType: 'RasterNode',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    previewUrl: 'data:image/png;base64,',
    visualHash: overrides.visualHash,
    duplicateFamily: overrides.visualHash.slice(0, 12),
    duplicateCount: 1,
    familyName: 'Border',
    suggestedRole: 'ImageLabel',
    role: 'ImageLabel',
    assetType: 'Border',
    remembered: false,
    members: [],
    grouping: 'single',
    parentHierarchyKey: '',
    hierarchyDepth: 0,
    childHierarchyKeys: [],
    diveMode: 'keep-together',
    recommendedDiveMode: 'keep-together',
    diveConfidence: 1,
    diveReasons: [],
    similarityFamily: overrides.visualHash.slice(0, 12),
    similarCount: 1,
    duplicateKind: 'unique',
    ...overrides,
  };
}

const parent = candidate({
  hierarchyKey: '0',
  name: 'OuterBorders',
  familyName: 'Outer Border',
  visualHash: 'a'.repeat(64),
  childHierarchyKeys: ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'],
  diveMode: 'children-only',
  recommendedDiveMode: 'children-only',
});
const children = Array.from({ length: 5 }, (_, index) => candidate({
  hierarchyKey: `0.${index}`,
  name: `Layer${index + 1}`,
  visualHash: String(index + 1).repeat(64),
  parentHierarchyKey: '0',
  hierarchyDepth: 1,
}));
children.push(candidate({
  hierarchyKey: '0.5',
  name: 'Layer6Glow',
  familyName: 'Layer6Glow FX',
  assetType: 'FX',
  visualHash: '6'.repeat(64),
  parentHierarchyKey: '0',
  hierarchyDepth: 1,
}));

const wallpaper = candidate({
  hierarchyKey: '1',
  name: '10570641.jpg',
  familyName: '10570641.Jpg Wallpaper',
  assetType: 'Wallpaper',
  visualHash: 'f'.repeat(64),
});

const numberHolderParent = candidate({
  hierarchyKey: '2',
  name: 'OuterBorders',
  familyName: 'NumberHolder Outer Border',
  visualHash: '7'.repeat(64),
  childHierarchyKeys: ['2.0', '2.1'],
  diveMode: 'children-only',
  recommendedDiveMode: 'children-only',
});
const numberHolderChildren = [
  candidate({
    hierarchyKey: '2.0',
    name: 'Layer1',
    familyName: 'Number Holder Outer Border',
    visualHash: '8'.repeat(64),
    parentHierarchyKey: '2',
    hierarchyDepth: 1,
  }),
  candidate({
    hierarchyKey: '2.1',
    name: 'Layer2',
    familyName: 'NumberHolder Outer Border',
    visualHash: '9'.repeat(64),
    parentHierarchyKey: '2',
    hierarchyDepth: 1,
  }),
];

const repeatedHotbarSlot = candidate({
  hierarchyKey: '3',
  name: 'HotbarSlot1',
  familyName: 'Hotbar Slot1',
  assetType: 'Slot',
  duplicateCount: 10,
  visualHash: '0'.repeat(64),
});

const badgeParent = candidate({
  hierarchyKey: '4',
  name: 'Middle',
  familyName: 'Diamond Badge',
  assetType: 'Badge',
  visualHash: 'b'.repeat(64),
  childHierarchyKeys: ['4.0', '4.1'],
});
const badgeBackground = candidate({
  hierarchyKey: '4.0',
  name: 'BackgroundMiddle',
  familyName: 'Middle Background',
  assetType: 'Background',
  visualHash: 'c'.repeat(64),
  parentHierarchyKey: '4',
  hierarchyDepth: 1,
});
const badgeBorders = candidate({
  hierarchyKey: '4.1',
  name: 'OuterBorders',
  familyName: 'Outer Borders',
  assetType: 'Border',
  visualHash: 'd'.repeat(64),
  parentHierarchyKey: '4',
  hierarchyDepth: 1,
});

const components = applyComponentSceneContext(
  [
    parent,
    ...children,
    wallpaper,
    numberHolderParent,
    ...numberHolderChildren,
    repeatedHotbarSlot,
    badgeParent,
    badgeBackground,
    badgeBorders,
  ],
  new Map([['1', 'Golden Forest Hall']]),
);

assert.deepEqual(components.slice(1, 6).map((component) => component.familyName), [
  'Outer Border 1',
  'Outer Border 2',
  'Outer Border 3',
  'Outer Border 4',
  'Outer Border 5',
]);
assert.equal(components[6].familyName, 'Outer Border 6 Glow');
assert.equal(components[0].familyName, 'Outer Borders');
assert.equal(components[7].familyName, 'Golden Forest Hall Wallpaper');
assert.equal(components[8].familyName, 'Number Holder Outer Borders');
assert.deepEqual(components.slice(9, 11).map((component) => component.familyName), [
  'Number Holder Outer Border 1',
  'Number Holder Outer Border 2',
]);
assert.equal(components[11].familyName, 'Hotbar Slot');
assert.equal(components[13].familyName, 'Diamond Badge Background');
assert.equal(components[14].familyName, 'Diamond Badge Borders');
assert.equal(componentCategory(components[1].assetType), 'Borders');
assert.equal(componentSubcategory(components[1], components), 'Outer Borders');

const nestedRoot = candidate({
  hierarchyKey: '5',
  name: 'Middle',
  familyName: 'Crystal Badge',
  assetType: 'Badge',
  visualHash: 'r'.repeat(64),
  childHierarchyKeys: ['5.0'],
});
const nestedCollection = candidate({
  hierarchyKey: '5.0',
  name: 'OuterBorders',
  familyName: 'Outer Borders',
  assetType: 'Border',
  visualHash: 's'.repeat(64),
  parentHierarchyKey: '5',
  hierarchyDepth: 1,
  childHierarchyKeys: ['5.0.0', '5.0.1'],
});
const nestedChildren = [0, 1].map((index) => candidate({
  hierarchyKey: `5.0.${index}`,
  name: `Layer${index + 1}`,
  familyName: `Layer${index + 1}`,
  assetType: 'Border',
  visualHash: `nested-${index}`.padEnd(64, String(index)),
  parentHierarchyKey: '5.0',
  hierarchyDepth: 2,
}));
const nested = applyComponentSceneContext([nestedRoot, nestedCollection, ...nestedChildren]);
assert.equal(nested[0].familyName, 'Crystal Badge');
assert.equal(nested[1].familyName, 'Crystal Badge Borders');
assert.deepEqual(nested.slice(2).map((component) => component.familyName), [
  'Crystal Badge Border 1',
  'Crystal Badge Border 2',
]);

console.log(JSON.stringify({
  borderNames: components.slice(1, 7).map((component) => component.familyName),
  wallpaper: components[7].familyName,
  location: [componentCategory(components[1].assetType), componentSubcategory(components[1], components)].join(' / '),
}, null, 2));
