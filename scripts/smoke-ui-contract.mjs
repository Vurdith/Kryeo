import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [app, styles] = await Promise.all([
  fs.readFile(path.join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8'),
]);

for (const label of [
  'Scan & export',
  'AI prepares',
  'Build asset library',
  'Needs attention',
  'Groups',
  'Ready',
  'All layers',
  'Customize how Kryeo scans this document',
  'Include in asset library',
  'Save decisions & teach Kryeo',
  'Reapply AI names',
  'Cloud analysis',
  'Developer mode',
  'Developer scan trace',
  'Copy trace',
]) {
  assert.ok(app.includes(label), `UI contract is missing: ${label}`);
}

assert.match(app, /saveComponentReview\(\{/, 'Completed scans must cache AI decisions automatically.');
assert.match(app, /applyLayerNames\(\{ documentSessionUuid: scan\.documentSessionUuid/, 'The automated build must apply AI layer names.');
assert.match(app, /createComponentAssets\(\{/, 'The automated build must create the asset library.');
assert.match(app, /unresolvedComponentCount > 0/, 'Asset creation must be blocked when a scan contains incomplete cloud decisions.');
assert.match(app, /Rescan required/, 'The blocked build action must direct the user to recover the degraded scan.');
assert.doesNotMatch(app, /reviewStats\.attention|Approve and continue|Needs your input/, 'The scan surface must not expose a blocking approval queue.');
assert.match(app, /if \(lower\.includes\('qwen3\.7'\).*return 'Cloud Qwen 3\.7 Flash';/, 'Qwen 3.7 must use the current Cloud Qwen product label.');
assert.match(app, /if \(lower\.includes\('qwen'\)\) return 'Cloud Qwen reviewer';/, 'Other Qwen routes must retain cloud terminology.');
assert.doesNotMatch(app, /if \(lower\.includes\('qwen'\)\) return 'Qwen';/, 'The active Qwen model must not collapse to a generic label.');
assert.match(app, /import: 'Scan & export'/, 'The scan surface must not be mislabeled as Import.');
assert.match(styles, /\.scan-flow\s*\{/, 'The guided scan flow must remain visible.');
assert.match(styles, /\.scan-options-body \.scan-options-watch[^\n]*grid-template-columns: 18px 18px/, 'The selection watcher must keep a stable icon and text column.');
assert.match(styles, /\.scan-more-actions\s*\{/, 'Secondary scan actions must stay progressively disclosed.');
assert.match(styles, /\.component-layer-tree[^\n]*focus-visible/, 'The hierarchy navigator must expose a visible keyboard focus state.');
assert.match(styles, /\.component-inspector\s*\{/, 'The selected-layer inspector must remain a first-class layout surface.');
assert.match(styles, /@media \(max-width: 1260px\)/, 'Responsive layout coverage must include the narrow workstation breakpoint.');
assert.match(styles, /@media \(max-width: 840px\)/, 'Responsive layout coverage must include the compact breakpoint.');
assert.match(app, /Move visual work from a live Affinity document into production-ready assets\./, 'Pipeline navigation must explain the operational handoff.');
assert.match(app, /Keep project decisions and visual context together while you work\./, 'Assistant navigation must retain its workspace context.');
assert.match(app, /Discover what is ready on this device before you start a workflow\./, 'Connectors must explain the scan action.');
assert.match(styles, /\.section-heading::before\s*\{/, 'Page navigation must retain the visible hierarchy marker.');
assert.match(styles, /\.tool-card::before\s*\{/, 'Workflow cards must retain the visible workbench marker.');
assert.match(styles, /\.component-workbench-header\s*\{\s*min-height: 96px;/, 'Component Scan must retain its stronger workbench header.');
assert.match(app, /kryeo\.developer-mode/, 'Developer Mode must persist on this device.');
assert.match(app, /developerMode \}/, 'Developer Mode must be sent with a Component Scan request.');
assert.match(styles, /\.developer-trace pre\s*\{/, 'Developer traces must remain bounded in a scrollable console.');

console.log(JSON.stringify({
  componentScanFlow: ['Scan document', 'AI prepares', 'Build asset library'],
  componentScanLanes: ['Needs attention', 'Groups', 'Ready', 'All layers'],
  primaryAction: 'Build asset library',
  secondaryActions: ['Save AI decisions', 'Reapply AI names', 'Organize Affinity layers'],
  responsiveBreakpoints: ['1260px', '840px'],
}, null, 2));
