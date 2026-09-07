import assert from 'node:assert/strict';
import { nameMeaninglessness } from '../src/main/name-quality.ts';
import { canonicalAiNameForType, reconcileAiNameForType, strictProductionName } from '../src/main/asset-intelligence-service.ts';

const meaningless = [
  'asset-0001.png',
  'Layer10',
  'IMG_20240101_000000.png',
  'a81f0c928bb44e4d',
  'xqzplmnr',
  'wut',
];

const meaningful = [
  'Grid',
  'Panel Assembly',
  'Sample Panel Status Slot',
  'Base Panel Frame',
  'Status Meter',
  'Pattern Texture',
];

for (const name of meaningless) {
  assert.ok(nameMeaninglessness(name) >= 0.7, `${name} should be eligible for visual naming.`);
}

for (const name of meaningful) {
  assert.ok(nameMeaninglessness(name) < 0.7, `${name} should preserve its human-readable name.`);
}

assert.ok(
  strictProductionName('Jpg Wallpaper', 'Wallpaper').issues.some((issue) => /file or export artefact/i.test(issue)),
  'A filename extension must never be accepted as a visual asset identity.',
);
assert.ok(
  strictProductionName('Outer Layer Border 7', 'Border').issues.some((issue) => /editor-default construction label/i.test(issue)),
  'An editor-default Layer token must never be accepted as a production identity.',
);
assert.equal(
  reconcileAiNameForType('Health Bar Chrome Bar', 'Bar'),
  'Health Chrome Bar',
  'A name reconciler must retain one final type word rather than duplicating it during sibling formatting.',
);
assert.equal(canonicalAiNameForType('HealthBar', 'Bar'), 'Health Bar', 'CamelCase is display formatting, not semantic identity.');
assert.equal(canonicalAiNameForType('BackgroundMiddle', 'Background'), 'Middle Background', 'The selected type must follow its existing descriptor without inventing words.');
assert.equal(canonicalAiNameForType('OuterBorder1', 'Border'), 'Outer Border 1', 'A model ordinal may follow the final type after generic spacing is normalised.');
assert.equal(canonicalAiNameForType('ActionSlotFrame', 'Frame'), 'Action Slot Frame', 'A conflicting type word must remain visible for review rather than being silently removed.');
assert.ok(strictProductionName('ActionSlotFrame', 'Frame').issues.some((issue) => /conflicts/i.test(issue)));

console.log(JSON.stringify({
  meaningless: Object.fromEntries(meaningless.map((name) => [name, nameMeaninglessness(name)])),
  meaningful: Object.fromEntries(meaningful.map((name) => [name, nameMeaninglessness(name)])),
}, null, 2));
