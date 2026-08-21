import assert from 'node:assert/strict';
import { applyScanIntent, normalizeScanIntent, scanIntentContext, structureFingerprint } from '../src/main/scan-intent-service.ts';

const single = {
  id: 'single', hierarchyKey: '0.1', parentHierarchyKey: '0', grouping: 'single', childCount: 0, descendantCount: 0,
  affinityType: 'Shape', exportTarget: false,
};
const group = { ...single, id: 'group', hierarchyKey: '0.2', grouping: 'existing-group', childCount: 2, descendantCount: 2 };
const inclusive = normalizeScanIntent({ mode: 'layer-inclusive', answers: [{ id: 'document-purpose', value: 'kit' }] });
assert.equal(applyScanIntent([single, group], inclusive)[0].exportTarget, true);
assert.equal(applyScanIntent([single, group], inclusive)[1].exportTarget, false);
const groupFirst = normalizeScanIntent({ mode: 'group-first', answers: [{ id: 'ungrouped-layers', value: 'construction-only' }] });
assert.equal(applyScanIntent([single], groupFirst)[0].exportTarget, false);
assert.equal(applyScanIntent([single], groupFirst)[0].keptInsideParent, true);
assert.equal(structureFingerprint([single, group]), structureFingerprint([group, single]));
assert.match(scanIntentContext(inclusive), /document-purpose=kit/i);
console.log(JSON.stringify({ modes: ['smart', 'group-first', 'layer-inclusive'], fingerprint: structureFingerprint([single, group]) }, null, 2));
