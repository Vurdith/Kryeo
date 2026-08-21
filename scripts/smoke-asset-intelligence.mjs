import assert from 'node:assert/strict';
import {
  buildProductionIdentity,
  normalizeAiName,
  roleForAssetType,
  strictProductionName,
} from '../src/main/asset-intelligence-service.ts';

assert.deepEqual(strictProductionName('Sample Button 1 Hover', 'Button'), {
  displayName: 'Sample Button 1 Hover',
  codeName: 'sample_button_1_hover',
  issues: [],
});

assert.deepEqual(strictProductionName('Demo Hover Close Button', 'Button'), {
  displayName: 'Demo Hover Close Button',
  codeName: 'demo_hover_close_button',
  issues: [],
});

assert.deepEqual(strictProductionName('Sample Border Border', 'Border'), {
  displayName: 'Sample Border',
  codeName: 'sample_border',
  issues: [],
});

const mismatchedTypeName = strictProductionName('Canvas Frame', 'Border');
assert.equal(mismatchedTypeName.displayName, 'Canvas Frame');
assert.ok(mismatchedTypeName.issues.some((issue) => /conflicts/i.test(issue)));
assert.ok(strictProductionName('Background Perimeter Border', 'Border').issues.some((issue) => /conflicts/i.test(issue)));
assert.ok(strictProductionName('Sample Borders Border', 'Border').issues.some((issue) => /exactly once/i.test(issue)));
assert.ok(strictProductionName('Slot Sample 1', 'Slot').issues.some((issue) => /after its descriptive identity/i.test(issue)));
assert.deepEqual(strictProductionName('Sample Slot 1', 'Slot').issues, []);
assert.deepEqual(strictProductionName('Close Button Hover', 'Button').issues, []);
assert.ok(strictProductionName('Border 1', 'Border').issues.some((issue) => /descriptive identity/i.test(issue)));
assert.deepEqual(strictProductionName('ParentBorder Top', 'Border').issues, []);
assert.deepEqual(strictProductionName('ParentBorder Side', 'Border').issues, []);
assert.deepEqual(strictProductionName('ParentBorder Frame', 'Frame').issues, []);
assert.deepEqual(strictProductionName('PanelBackground Texture', 'Texture').issues, []);
assert.deepEqual(strictProductionName('Decorative Ornament Center', 'Ornament').issues, []);

assert.ok(strictProductionName('Layer 12', 'Unknown').issues.length > 0);
assert.ok(strictProductionName('Pixel Art', 'Unknown').issues.length > 0);
assert.equal(roleForAssetType('Button'), 'ImageButton');
assert.equal(roleForAssetType('Border'), 'ImageLabel');
assert.equal(roleForAssetType('Panel'), 'ImageLabel');
assert.equal(roleForAssetType('Unknown'), 'Unknown');

const identity = buildProductionIdentity({
  exportName: 'Sample Close Button Hover',
  familyName: 'Close Button',
  layerLabel: 'Close Button',
  name: 'Layer 12',
  assetType: 'Button',
  role: 'ImageLabel',
  remembered: false,
});
assert.equal(identity.displayName, 'Sample Close Button Hover');
assert.equal(identity.codeName, 'sample_close_button_hover');
assert.equal(identity.robloxClass, 'ImageLabel');
assert.deepEqual(identity.issues, []);
assert.match(identity.robloxClassReason, /selected/i);

assert.deepEqual(normalizeAiName('Close_Button_Hover'), {
  displayName: 'Close Button Hover',
  codeName: 'close_button_hover',
  issues: [],
});
assert.ok(normalizeAiName('Border').issues.length > 0, 'The validator must flag bare type names instead of inventing a descriptor.');
assert.equal(
  buildProductionIdentity({ exportName: '', aiSuggestedName: '', familyName: 'Layer 7', layerLabel: 'Layer 7', name: 'Layer 7', assetType: 'Button', role: 'ImageButton', remembered: false }).displayName,
  '',
  'The resolver leaves an unresolved source name blank instead of fabricating a semantic identity.',
);

console.log(JSON.stringify({
  grammar: '[descriptor] [semantic object/type] [ordinal] [state]',
  identity,
}, null, 2));
