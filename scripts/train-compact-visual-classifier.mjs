import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const modelRoot = path.join(root, 'resources', 'models', 'mobileclip-s0');
const prototypesPath = path.join(modelRoot, 'ui-visual-prototypes.json');
const taxonomyPath = path.join(modelRoot, 'ui-taxonomy.json');
const outputPath = path.join(modelRoot, 'ui-compact-classifier.json');
const previewDirectory = path.join(root, 'tmp', 'visual-prototypes');
const prototypes = JSON.parse(await readFile(prototypesPath, 'utf8'));
const taxonomy = JSON.parse(await readFile(taxonomyPath, 'utf8'));
const labels = taxonomy.labels.map((label) => label.type).filter((type) => type !== 'Unknown');
const featureDimension = prototypes.prototypes[0]?.features?.length || 0;
const inputDimension = prototypes.dimension + featureDimension;
const baseExamples = prototypes.prototypes
  .filter((prototype) => labels.includes(prototype.type))
  .map((prototype) => ({
    type: prototype.type,
    id: prototype.id,
  }));

function normalize(values) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Array.from(values, (value) => value / magnitude);
}

async function tensorFor(buffer) {
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .resize(256, 256, { fit: 'contain', background: { r: 127, g: 127, b: 127, alpha: 1 } })
    .flatten({ background: { r: 127, g: 127, b: 127 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = 256 * 256;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    values[pixel] = data[pixel * 3] / 255;
    values[plane + pixel] = data[pixel * 3 + 1] / 255;
    values[plane * 2 + pixel] = data[pixel * 3 + 2] / 255;
  }
  return values;
}

async function visualFeatures(buffer) {
  const size = 64;
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  const width = Math.max(1, metadata.width || 1);
  const height = Math.max(1, metadata.height || 1);
  const { data } = await image.resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let total = 0;
  let center = 0;
  let centerPixels = 0;
  let outer = 0;
  let outerPixels = 0;
  let opaque = 0;
  const rows = new Float32Array(size);
  const columns = new Float32Array(size);
  const centerStart = Math.floor(size * 0.3);
  const centerEnd = Math.ceil(size * 0.7);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3] / 255;
      total += alpha;
      rows[y] += alpha / size;
      columns[x] += alpha / size;
      if (alpha >= 0.85) opaque += 1;
      if (x >= centerStart && x < centerEnd && y >= centerStart && y < centerEnd) {
        center += alpha;
        centerPixels += 1;
      } else {
        outer += alpha;
        outerPixels += 1;
      }
    }
  }
  return [
    Math.tanh(Math.log(Math.max(1 / 32, Math.min(32, width / height))) / 2),
    total / (size * size),
    center / Math.max(1, centerPixels),
    outer / Math.max(1, outerPixels),
    opaque / (size * size),
    [...rows].filter((value) => value > 0.015).length / size,
    [...columns].filter((value) => value > 0.015).length / size,
    Math.max(...rows),
    Math.max(...columns),
  ];
}

async function augmentations(file) {
  const input = await readFile(file);
  const metadata = await sharp(input).metadata();
  const width = Math.max(1, metadata.width || 1);
  const height = Math.max(1, metadata.height || 1);
  const padX = Math.max(2, Math.round(width * 0.08));
  const padY = Math.max(2, Math.round(height * 0.08));
  return Promise.all([
    input,
    sharp(input).modulate({ brightness: 0.88, saturation: 0.8 }).png().toBuffer(),
    sharp(input).modulate({ brightness: 1.1, saturation: 1.15, hue: 8 }).png().toBuffer(),
    sharp(input).sharpen({ sigma: 0.7 }).png().toBuffer(),
    sharp(input).blur(0.45).png().toBuffer(),
    sharp(input).flop().png().toBuffer(),
    sharp(input).extend({ top: padY, bottom: padY, left: padX, right: padX, background: '#00000000' }).png().toBuffer(),
    sharp(input).rotate(2, { background: '#00000000' }).resize(width, height, { fit: 'contain', background: '#00000000' }).png().toBuffer(),
    sharp(input).rotate(-2, { background: '#00000000' }).resize(width, height, { fit: 'contain', background: '#00000000' }).png().toBuffer(),
  ]);
}

const session = await ort.InferenceSession.create(path.join(modelRoot, 'vision_model_quantized.onnx'), {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
});
const examples = [];
for (const base of baseExamples) {
  const variants = await augmentations(path.join(previewDirectory, `${base.id}.png`));
  for (let offset = 0; offset < variants.length; offset += 12) {
    const batch = variants.slice(offset, offset + 12);
    const [tensors, structures] = await Promise.all([
      Promise.all(batch.map(tensorFor)),
      Promise.all(batch.map(visualFeatures)),
    ]);
    const values = new Float32Array(batch.length * 3 * 256 * 256);
    tensors.forEach((tensor, index) => values.set(tensor, index * tensor.length));
    const output = await session.run({
      pixel_values: new ort.Tensor('float32', values, [batch.length, 3, 256, 256]),
    });
    const embeddings = output.image_embeds.data;
    for (let row = 0; row < batch.length; row += 1) {
      examples.push({
        type: base.type,
        values: [
          ...normalize(embeddings.slice(row * prototypes.dimension, (row + 1) * prototypes.dimension)),
          ...structures[row],
        ],
      });
    }
  }
}

const mean = Array(inputDimension).fill(0);
const scale = Array(inputDimension).fill(0);
for (const example of examples) {
  example.values.forEach((value, index) => { mean[index] += value / examples.length; });
}
for (const example of examples) {
  example.values.forEach((value, index) => {
    const difference = value - mean[index];
    scale[index] += difference * difference / examples.length;
  });
}
for (let index = 0; index < scale.length; index += 1) scale[index] = Math.max(Math.sqrt(scale[index]), 0.008);

function normalizeInput(values) {
  return values.map((value, index) => Math.max(-5, Math.min(5, (value - mean[index]) / scale[index])));
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rng = random(0x4b525945);
const training = examples.flatMap((example) => {
  const values = normalizeInput(example.values);
  return [
    { values, label: labels.indexOf(example.type) },
    {
      label: labels.indexOf(example.type),
      values: values.map((value) => value + (rng() - 0.5) * 0.055),
    },
  ];
});
const weights = labels.map(() => Array(inputDimension).fill(0));
const bias = labels.map(() => 0);
const logits = Array(labels.length).fill(0);
const probabilities = Array(labels.length).fill(0);
const epochs = 55;
const regularization = 0.00045;

for (let epoch = 0; epoch < epochs; epoch += 1) {
  const learningRate = 0.045 * (1 - epoch / epochs) + 0.006;
  for (let index = training.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [training[index], training[swap]] = [training[swap], training[index]];
  }
  for (const example of training) {
    let maximum = -Infinity;
    for (let label = 0; label < labels.length; label += 1) {
      let score = bias[label];
      for (let column = 0; column < inputDimension; column += 1) score += weights[label][column] * example.values[column];
      logits[label] = score;
      maximum = Math.max(maximum, score);
    }
    let total = 0;
    for (let label = 0; label < labels.length; label += 1) {
      probabilities[label] = Math.exp(logits[label] - maximum);
      total += probabilities[label];
    }
    for (let label = 0; label < labels.length; label += 1) {
      probabilities[label] /= total || 1;
      const gradient = probabilities[label] - Number(label === example.label);
      bias[label] -= learningRate * gradient;
      for (let column = 0; column < inputDimension; column += 1) {
        weights[label][column] -= learningRate * (
          gradient * example.values[column]
          + regularization * weights[label][column]
        );
      }
    }
  }
}

function predict(values) {
  return labels.map((type, label) => ({
    type,
    score: weights[label].reduce((sum, weight, column) => sum + weight * values[column], bias[label]),
  })).sort((left, right) => right.score - left.score);
}

let correct = 0;
for (const example of examples) {
  if (predict(normalizeInput(example.values))[0].type === example.type) correct += 1;
}

const round = (value) => Math.round(value * 1e6) / 1e6;
await writeFile(outputPath, `${JSON.stringify({
  format: 1,
  model: 'Kryeo Compact UI Classifier',
  encoder: prototypes.model,
  embeddingDimension: prototypes.dimension,
  featureDimension,
  labels,
  mean: mean.map(round),
  scale: scale.map(round),
  weights: weights.map((row) => row.map(round)),
  bias: bias.map(round),
  training: {
    seed: 'image-augmented-softmax-v1',
    examples: examples.length,
    augmentedExamples: training.length,
    trainingAccuracy: correct / examples.length,
  },
}, null, 2)}\n`);

process.stdout.write(`Wrote ${outputPath}\n`);
process.stdout.write(`Training examples: ${examples.length}; accuracy: ${correct}/${examples.length}\n`);
