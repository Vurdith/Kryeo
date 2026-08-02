import { AffinityService } from '../src/main/affinity-service.ts';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

const affinity = new AffinityService();
await affinity.connect();

const script = String.raw`
'use strict';
const { Document } = require('/document');
const doc = Document.current;
if (!doc) throw new Error('No active Affinity document.');

function nameOf(node) {
  return String(node.userDescription || node.description || node.defaultDescriptionForDisplay || node.defaultDescription || 'Unnamed layer');
}
function typeOf(node) {
  try { return String(node.constructor && node.constructor.name || Object.prototype.toString.call(node)); }
  catch (_) { return 'Node'; }
}
function boundsOf(node) {
  const boxes = [];
  try { boxes.push(node.exactSpreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadBaseBox); } catch (_) {}
  for (const box of boxes) {
    if (!box) continue;
    const result = { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) };
    if (Number.isFinite(result.x) && Number.isFinite(result.y)) return result;
  }
  return null;
}
function visit(node, path, depth) {
  const children = [];
  try { for (const child of node.children) children.push(child); } catch (_) {}
  let visible = true;
  try { visible = Boolean(node.isVisibleInDomain); } catch (_) {}
  const record = {
    path,
    depth,
    name: nameOf(node),
    type: typeOf(node),
    visible,
    bounds: boundsOf(node),
    childCount: children.length,
  };
  console.log('KRYEO_TREE:' + JSON.stringify(record));
  if (depth >= 8) return;
  for (let index = 0; index < children.length; index += 1) {
    visit(children[index], path + '.' + index, depth + 1);
  }
}
let spreadIndex = 0;
for (const spread of doc.spreads) {
  let nodeIndex = 0;
  for (const node of spread.children) {
    visit(node, String(spreadIndex) + '.' + String(nodeIndex), 0);
    nodeIndex += 1;
  }
  spreadIndex += 1;
}
console.log('KRYEO_TREE_DONE:' + JSON.stringify({ title: String(doc.title || 'Untitled'), sessionUuid: String(doc.sessionUuid || '') }));
`;

try {
  const result = await affinity.callTool('execute_script', { script }, 30_000);
  const text = (result.content || [])
    .filter((item) => item && typeof item === 'object' && item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  if (result.isError) throw new Error(text || 'Affinity hierarchy probe failed.');
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('KRYEO_TREE:'))
    .map((line) => JSON.parse(line.slice('KRYEO_TREE:'.length)));
  const relevant = rows.filter((row) =>
    /^(ui|wut|lechickennugget|dwa121)$/i.test(row.name)
    || rows.some((parent) => /^(ui|wut)$/i.test(parent.name) && row.path.startsWith(`${parent.path}.`)));
  console.log(JSON.stringify({ relevant, totalNodes: rows.length }, null, 2));
  const stagingDirectory = path.resolve('tmp', 'live-scan-inspect');
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  const batch = await affinity.exportComponentCandidates(stagingDirectory, 'document');
  console.log(JSON.stringify({
    exported: batch.components.map((component) => ({
      name: component.name,
      type: component.affinityType,
      childCount: component.childCount,
      hierarchyKey: component.hierarchyKey,
      parentHierarchyKey: component.parentHierarchyKey,
      previewFallback: component.previewFallback,
      path: component.path,
    })),
  }, null, 2));
} finally {
  await affinity.close();
}
