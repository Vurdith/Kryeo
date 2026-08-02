import { AffinityService } from '../src/main/affinity-service.ts';

const service = new AffinityService();
await service.connect();
const script = `
'use strict';
const { Document } = require('/document');
const doc = Document.current;
function name(node) { return String(node.userDescription || node.description || node.defaultDescriptionForDisplay || node.defaultDescription || 'Unnamed'); }
function type(node) { try { return String(node.constructor && node.constructor.name || 'Node'); } catch (_) { return 'Node'; } }
function bounds(node) { let box = null; try { box = node.exactSpreadVisibleBox || node.spreadVisibleBox || node.spreadBaseBox; } catch (_) {} return box ? { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) } : null; }
function visible(node) { try { return Boolean(node.isVisibleInDomain); } catch (_) {} return true; }
const rows = [];
function walk(node, path, depth) {
  let childCount = 0;
  try { for (const child of node.children) childCount += 1; } catch (_) {}
  rows.push({ path, depth, name: name(node), type: type(node), visible: visible(node), childCount, bounds: bounds(node) });
  if (depth >= 12) return;
  let index = 0;
  try { for (const child of node.children) { walk(child, path.concat(index), depth + 1); index += 1; } } catch (_) {}
}
let spreadIndex = 0;
for (const spread of doc.spreads) {
  let nodeIndex = 0;
  for (const node of spread.children) { walk(node, [spreadIndex, nodeIndex], 0); nodeIndex += 1; }
  spreadIndex += 1;
}
console.log('KRYEO_TREE:' + JSON.stringify({ title: String(doc.title || ''), rows }));`;

const result = await service.callTool('execute_script', { script }, 30_000);
const text = (result.content || []).filter((item) => item && item.type === 'text').map((item) => item.text || '').join('\n');
const marker = 'KRYEO_TREE:';
const index = text.lastIndexOf(marker);
if (result.isError || index < 0) throw new Error(text || 'Hierarchy probe failed.');
const payload = JSON.parse(text.slice(index + marker.length).split(/\r?\n/, 1)[0]);
console.log(JSON.stringify(payload, null, 2));
process.exit();
