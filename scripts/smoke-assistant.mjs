import assert from 'node:assert/strict';
import path from 'node:path';
import {
  acceptAssetVisualReview,
  AssistantService,
  cleanAssetName,
  parseAssetVisualReview,
  shouldReviewAssetVisual,
  shouldUseAssistantVision,
} from '../src/main/assistant-service.ts';
import { applyAssistantMemoryRules } from '../src/main/assistant-memory-rules.ts';

const root = path.resolve('tmp', 'assistant-model-smoke');
process.env.KRYEO_AI_CACHE_DIR = path.resolve('tmp', 'lfm25-vl-smoke');
const service = new AssistantService(() => root);
const parsedReview = parseAssetVisualReview('{"assetType":"Button","name":"Close Button","confidence":0.84,"reason":"Visible X control"}');
assert.deepEqual(parsedReview, { assetType: 'Button', name: 'Close Button', confidence: 0.84, reason: 'Visible X control' });
assert.equal(cleanAssetName('Reusable Game UI Asset Library'), '');
assert.equal(cleanAssetName('return only a concise asset name'), '');
assert.equal(cleanAssetName('Red Slot'), 'Red Slot');
assert.equal(shouldReviewAssetVisual('memory', 0.3, [], 2), false);
assert.equal(shouldReviewAssetVisual('model', 0.58, [], 0), true);
assert.equal(shouldReviewAssetVisual('model', 0.8, [], 3), false);
assert.equal(acceptAssetVisualReview(parsedReview, {
  width: 176,
  height: 176,
  affinityType: 'GroupNode',
  childCount: 2,
  textCount: 0,
  currentType: 'Texture',
  currentConfidence: 0.39,
  currentSource: 'model',
  alternatives: [{ assetType: 'Button', score: 0.38 }],
}), true, 'A confident assistant review may repair a weak raw-model decision.');
assert.equal(acceptAssetVisualReview(parsedReview, {
  width: 176,
  height: 176,
  affinityType: 'GroupNode',
  childCount: 2,
  textCount: 0,
  currentType: 'Texture',
  currentConfidence: 0.9,
  currentSource: 'name',
  alternatives: [{ assetType: 'Button', score: 0.38 }],
}), false, 'The assistant must not override a stable semantic decision.');
assert.equal(acceptAssetVisualReview(parsedReview, {
  width: 103,
  height: 103,
  affinityType: 'GroupNode',
  childCount: 6,
  textCount: 0,
  currentType: 'Border',
  currentConfidence: 0.49,
  currentSource: 'model',
  childTypes: ['Border', 'Border', 'Border', 'Border', 'Border', 'FX'],
}), false, 'The assistant must not split a coherent hierarchy-supported family.');
assert.equal(acceptAssetVisualReview(parsedReview, {
  width: 176,
  height: 176,
  affinityType: 'GroupNode',
  childCount: 2,
  textCount: 0,
  currentType: 'Unknown',
  currentConfidence: 0.39,
  alternatives: [{ assetType: 'Button', score: 0.38 }],
}), true, 'A confident assistant review may resolve an unknown visual.');
assert.equal(acceptAssetVisualReview({ ...parsedReview, assetType: 'Wallpaper', confidence: 0.62 }, {
  width: 176,
  height: 176,
  affinityType: 'GroupNode',
  childCount: 2,
  textCount: 0,
  currentType: 'Button',
  alternatives: [{ assetType: 'Slot', score: 0.38 }],
}), false);
const installed = await service.install();
assert.equal(installed.installed, true);
assert.equal(installed.ready, true);

const workspace = {
  jobs: [], recipes: [], presets: [], links: [], preferences: [],
  componentDecisions: [], componentManifests: [], assistantSessions: [{ id: 'session', project: 'Devil Hunter', title: 'Test', pinned: false, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], assistantMessages: [],
  assistantMemories: [{ id: 'rule', project: 'Devil Hunter', scope: 'project', kind: 'hierarchy', text: 'Decorative borders stay inside their parent component.', createdAt: new Date().toISOString() }],
  updatedAt: new Date().toISOString(),
};
const result = await service.chat({
  project: 'Devil Hunter',
  sessionId: 'session',
  message: 'How should you handle decorative borders when organizing this document?',
  document: { open: true, title: 'HUD', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'test' },
}, workspace);
assert.ok(result.text.length > 10);
assert.match(result.text, /border|inside|parent/i);
assert.doesNotMatch(result.text, /I (will|have|added|changed)|I'm going to/i);

const greeting = await service.chat({
  project: 'Devil Hunter',
  sessionId: 'session',
  message: 'Hi, what can you help me with?',
  useVision: true,
  document: { open: true, title: 'HUD', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'test' },
}, workspace);
assert.match(greeting.text, /hi|hello|well|ready|help/i);
assert.equal(greeting.visionUsed, false);
assert.equal(shouldUseAssistantVision('Hi, what can you help me with?'), false);
assert.equal(shouldUseAssistantVision('Inspect the active document and identify reusable buttons.'), true);

const visual = await service.chat({
  project: 'General',
  sessionId: 'visual',
  message: 'What does the Kryeo logo look like?',
  useVision: true,
  document: { open: true, title: 'Kryeo', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'visual-test' },
}, { ...workspace, assistantMemories: [] }, {
  images: [{ imagePath: path.resolve('build-icon.png'), label: 'the full logo overview' }],
  documentTitle: 'Kryeo',
  documentSessionUuid: 'visual-test',
});
assert.equal(visual.visionUsed, true);
assert.match(visual.text, /K|logo|color|red|yellow|blue/i);
assert.doesNotMatch(visual.text, /don't have access|cannot see|unable to/i);

const visualReview = await service.reviewAssetVisual(path.resolve('build-icon.png'));
assert.ok(visualReview, 'The local multimodal reviewer should return a structured visual opinion.');
assert.ok(visualReview.name.length > 0);

const closeButtonReview = await service.reviewAssetVisual(
  path.resolve('scripts', 'fixtures', 'visual', 'close-button-red-real.png'),
  {
    width: 176,
    height: 176,
    affinityType: 'GroupNode',
    childCount: 2,
    textCount: 0,
    currentType: 'Button',
    currentConfidence: 0.66,
    alternatives: [{ assetType: 'Slot', score: 0.6 }, { assetType: 'Icon', score: 0.55 }],
    childTypes: ['Background', 'Icon'],
  },
);
assert.equal(closeButtonReview?.assetType, 'Button');
assert.match(closeButtonReview?.name || '', /Close|Button/i);

const redBackgroundReview = await service.reviewAssetVisual(
  path.resolve('scripts', 'fixtures', 'visual', 'red-background-real.png'),
  {
    width: 176,
    height: 176,
    affinityType: 'ShapeNode',
    childCount: 0,
    textCount: 0,
    currentType: 'Background',
    currentConfidence: 0.7,
    alternatives: [{ assetType: 'Fill', score: 0.56 }, { assetType: 'Slot', score: 0.5 }],
    parentType: 'Button',
  },
);
assert.equal(redBackgroundReview?.assetType, 'Background');

const toolCall = await service.chat({
  project: 'General',
  sessionId: 'tool',
  message: 'Organize my active Affinity document into reusable components.',
  useVision: false,
  document: { open: true, title: 'HUD', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'tool-test' },
}, { ...workspace, assistantMemories: [] });
assert.equal(toolCall.actions[0]?.type, 'open-component-scan');
assert.match(toolCall.text, /Component Scan/i);

const learned = await service.chat({
  project: 'Devil Hunter',
  sessionId: 'session',
  message: 'Remember that every SanityBar is a progress bar.',
  document: { open: true, title: 'HUD', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'test' },
}, workspace);
assert.equal(learned.memories.length, 1);
assert.equal(learned.memories[0].kind, 'classification');

const roleRule = await service.chat({
  project: 'Devil Hunter',
  sessionId: 'session',
  message: 'ProgressBars are ImageLabels not frames',
  document: { open: true, title: 'HUD', path: '', selectionCount: 0, selectionNames: [], sessionUuid: 'test' },
}, workspace);
assert.match(roleRule.text, /Confirmed project rule:/);
assert.equal(roleRule.memories.length, 1);

const reviewed = applyAssistantMemoryRules([
  { name: 'SanityBar', familyName: 'Sanity Bar', assetType: 'Fill', role: 'ImageLabel', parentHierarchyKey: '' },
  { name: 'OuterBorders', familyName: 'Outer Borders', assetType: 'Frame', role: 'Frame', parentHierarchyKey: 'root' },
], [
  learned.memories[0],
  roleRule.memories[0],
  { id: 'inside', project: 'Devil Hunter', documentTitle: 'HUD', kind: 'hierarchy', text: 'Decorative borders stay inside their parent component.', createdAt: new Date().toISOString() },
], 'HUD');
assert.equal(reviewed[0].assetType, 'Bar');
assert.equal(reviewed[0].role, 'ImageLabel');
assert.equal(reviewed[0].aiSource, 'memory');
assert.equal(reviewed[1].keptInsideParent, true);

console.log(JSON.stringify({ installed, visual: visual.text, visualReview, tool: toolCall.actions[0], memory: learned.memories[0] }, null, 2));
