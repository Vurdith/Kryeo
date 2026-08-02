import assert from 'node:assert/strict';
import { nameMeaninglessness } from '../src/main/name-quality.ts';

const meaningless = [
  '10570641.jpg',
  'Layer10',
  'IMG_20260726_124500.png',
  'a81f0c928bb44e4d',
  'xqzplmnr',
  'wut',
];

const meaningful = [
  'Grid',
  'OuterBorders',
  'Character Menu Stat Slot',
  'BaseHotbarFrame',
  'SanityBar',
  'Checkered Texture',
];

for (const name of meaningless) {
  assert.ok(nameMeaninglessness(name) >= 0.7, `${name} should be eligible for visual naming.`);
}

for (const name of meaningful) {
  assert.ok(nameMeaninglessness(name) < 0.7, `${name} should preserve its human-readable name.`);
}

console.log(JSON.stringify({
  meaningless: Object.fromEntries(meaningless.map((name) => [name, nameMeaninglessness(name)])),
  meaningful: Object.fromEntries(meaningful.map((name) => [name, nameMeaninglessness(name)])),
}, null, 2));
