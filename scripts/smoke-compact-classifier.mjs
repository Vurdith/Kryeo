import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve('resources', 'models', 'mobileclip-s0', 'ui-compact-classifier.json');
const classifier = JSON.parse(await readFile(file, 'utf8'));
const details = await stat(file);

assert.equal(classifier.format, 1);
assert.equal(classifier.encoder, 'MobileCLIP-S0');
assert.equal(classifier.embeddingDimension, 512);
assert.equal(classifier.featureDimension, 9);
assert.ok(classifier.labels.length >= 25);
assert.equal(classifier.weights.length, classifier.labels.length);
assert.equal(classifier.bias.length, classifier.labels.length);
assert.equal(classifier.mean.length, classifier.embeddingDimension + classifier.featureDimension);
assert.ok(classifier.weights.every((row) => row.length === classifier.mean.length));
assert.ok(classifier.training.examples >= 600);
assert.ok(classifier.training.trainingAccuracy >= 0.95);
assert.equal('prototypes' in classifier, false, 'The compact runtime head must not contain individual prototypes.');
assert.ok(details.size < 400_000, `Compact head is unexpectedly large: ${details.size} bytes.`);

console.log(JSON.stringify({
  model: classifier.model,
  labels: classifier.labels.length,
  trainingExamples: classifier.training.examples,
  structuralFeatures: classifier.featureDimension,
  trainingAccuracy: classifier.training.trainingAccuracy,
  bytes: details.size,
  containsPrototypeTable: false,
}, null, 2));
