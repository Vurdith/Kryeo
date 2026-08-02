import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

process.env.KRYEO_MODEL_ROOT = path.resolve('resources', 'models', 'mobileclip-s0');

const { LocalAiService } = await import('../src/main/local-ai-service.ts');
const { applyComponentIntelligence } = await import('../src/main/component-intelligence-service.ts');
const { applyComponentSceneContext } = await import('../src/main/component-context-service.ts');

const fixture = JSON.parse(await readFile(
  path.resolve('scripts', 'fixtures', 'lor-document-golden.json'),
  'utf8',
));
const inputs = fixture.components.map(({ input }) => structuredClone(input));
const suggestions = await new LocalAiService().analyze(inputs);
const byHash = new Map(suggestions.map((suggestion) => [suggestion.visualHash, suggestion]));
const classified = applyComponentSceneContext(applyComponentIntelligence(inputs.map((component) => {
  const suggestion = byHash.get(component.visualHash);
  assert.ok(suggestion, `Missing suggestion for ${component.hierarchyKey} ${component.name}`);
  return {
    ...component,
    assetType: suggestion.assetType,
    familyName: suggestion.name,
    role: suggestion.role,
    aiConfidence: suggestion.confidence,
    aiSource: suggestion.source,
    aiReason: suggestion.reason,
    semanticType: suggestion.semanticType,
    semanticConflict: suggestion.semanticConflict,
    reviewCategory: suggestion.reviewCategory,
    nameSource: suggestion.nameSource,
    visualEmbedding: suggestion.embedding,
  };
})));

const expected = new Map(fixture.components.map((item) => [item.input.hierarchyKey, item.expectedType]));
const mismatches = classified
  .filter((component) => component.assetType !== expected.get(component.hierarchyKey))
  .map((component) => ({
    key: component.hierarchyKey,
    name: component.name,
    expected: expected.get(component.hierarchyKey),
    actual: component.assetType,
    reason: component.aiReason,
  }));

assert.deepEqual(mismatches, [], `LOR baseline regressions:\n${JSON.stringify(mismatches, null, 2)}`);

const keyTypes = Object.fromEntries(classified
  .filter((component) =>
    /^(Hotbar Slots|HotbarSlot1|OuterBorders|Layer[1-6]|StaggerBar|SanityBar|HealthBar|10570641\.jpg)$/i.test(component.name))
  .map((component) => [component.hierarchyKey, `${component.name}: ${component.assetType}`]));

console.log(JSON.stringify({
  document: fixture.documentTitle,
  components: classified.length,
  mismatches: mismatches.length,
  keyTypes,
}, null, 2));
