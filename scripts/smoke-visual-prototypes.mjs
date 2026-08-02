import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const modelRoot = path.join(root, 'resources', 'models', 'mobileclip-s0');
const imageSize = 256;

const prototypes = JSON.parse(
  await readFile(path.join(modelRoot, 'ui-visual-prototypes.json'), 'utf8'),
);
const session = await ort.InferenceSession.create(
  path.join(modelRoot, 'vision_model_quantized.onnx'),
  { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
);

const rectangle = (width, height, background) => sharp({
  create: { width, height, channels: 4, background },
}).png().toBuffer();

const transparent = (width, height) => sharp({
  create: { width, height, channels: 4, background: '#00000000' },
});

async function embed(buffer) {
  const metadata = await sharp(buffer).metadata();
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .resize(imageSize, imageSize, {
      fit: 'contain',
      background: { r: 127, g: 127, b: 127, alpha: 1 },
    })
    .flatten({ background: { r: 127, g: 127, b: 127 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = imageSize * imageSize;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    values[pixel] = data[pixel * 3] / 255;
    values[plane + pixel] = data[pixel * 3 + 1] / 255;
    values[plane * 2 + pixel] = data[pixel * 3 + 2] / 255;
  }
  const output = await session.run({
    pixel_values: new ort.Tensor('float32', values, [1, 3, imageSize, imageSize]),
  });
  const embedding = output.image_embeds.data;
  let magnitude = 0;
  for (const value of embedding) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return {
    embedding: Float32Array.from(embedding, (value) => value / magnitude),
    features: await visualFeatures(buffer, metadata.width || 1, metadata.height || 1),
  };
}

function cosine(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

async function visualFeatures(buffer, width, height) {
  const size = 64;
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
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
    Math.tanh(Math.log(Math.max(1 / 32, Math.min(32, width / Math.max(1, height)))) / 2),
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

function featureSimilarity(left, right) {
  const weights = [2.4, 1.2, 1.4, 1.4, 0.8, 1, 1, 0.8, 0.8];
  const distance = left.reduce((sum, value, index) => {
    const difference = value - right[index];
    return sum + difference * difference * weights[index];
  }, 0);
  return Math.exp(-distance * 2.2);
}

async function classify(id, expected, buffer) {
  const specimen = await embed(buffer);
  const byType = new Map();
  for (const prototype of prototypes.prototypes) {
    const imageScore = cosine(specimen.embedding, prototype.embedding);
    const structureScore = featureSimilarity(specimen.features, prototype.features);
    const score = imageScore + structureScore * 0.55;
    const current = byType.get(prototype.type);
    if (!current || score > current.score) byType.set(prototype.type, { score, id: prototype.id });
  }
  const ranked = [...byType.entries()]
    .map(([type, result]) => ({ type, ...result }))
    .sort((left, right) => right.score - left.score);
  console.log(`${id}: ${ranked.slice(0, 5).map((item) => `${item.type} ${item.score.toFixed(3)} (${item.id})`).join(' | ')}`);
  if (ranked[0].type !== expected) {
    const expectedPrototype = prototypes.prototypes.find((prototype) => prototype.type === expected);
    console.log(`  specimen features: ${specimen.features.map((value) => value.toFixed(3)).join(', ')}`);
    console.log(`  ${expected} features: ${expectedPrototype.features.map((value) => value.toFixed(3)).join(', ')}`);
  }
  return { id, expected, actual: ranked[0].type };
}

const statusBar = await transparent(394, 34).composite([
  { input: await rectangle(394, 3, '#111111ff'), left: 0, top: 15 },
  { input: await rectangle(350, 4, '#b1262eff'), left: 20, top: 14 },
]).png().toBuffer();

const slot = await transparent(96, 105).composite([
  { input: await rectangle(88, 97, '#17130fff'), left: 4, top: 4 },
  { input: await rectangle(70, 79, '#9c7424ff'), left: 13, top: 13 },
]).png().toBuffer();

const border = await transparent(128, 128).composite([
  { input: await rectangle(112, 7, '#b59142ff'), left: 8, top: 8 },
  { input: await rectangle(112, 7, '#b59142ff'), left: 8, top: 113 },
  { input: await rectangle(7, 98, '#b59142ff'), left: 8, top: 15 },
  { input: await rectangle(7, 98, '#b59142ff'), left: 113, top: 15 },
]).png().toBuffer();

const wallpaper = await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#1b1714ff' },
}).composite([
  { input: await rectangle(90, 145, '#3b2b1eff'), left: 24, top: 30 },
  { input: await rectangle(90, 145, '#493422ff'), left: 206, top: 30 },
  { input: await rectangle(76, 92, '#b38d45aa'), left: 122, top: 54 },
]).png().toBuffer();

const overlayLines = [];
for (let index = 0; index < 14; index += 1) {
  overlayLines.push({ input: await rectangle(1, 180, '#8cc8ff55'), left: index * 24, top: 0 });
}
for (let index = 0; index < 8; index += 1) {
  overlayLines.push({ input: await rectangle(320, 1, '#8cc8ff55'), left: 0, top: index * 24 });
}
const overlay = transparent(320, 180).composite(overlayLines);
const overlayBuffer = await overlay.png().toBuffer();

const checkerTiles = [];
for (let y = 0; y < 8; y += 1) {
  for (let x = 0; x < 8; x += 1) {
    checkerTiles.push({
      input: await rectangle(16, 16, (x + y) % 2 ? '#4c4439ff' : '#29251fff'),
      left: x * 16,
      top: y * 16,
    });
  }
}
const textureBuffer = await transparent(128, 128).composite(checkerTiles).png().toBuffer();

const results = [
  await classify('generic-status-bar', 'Bar', statusBar),
  await classify('generic-slot', 'Slot', slot),
  await classify('generic-border', 'Border', border),
  await classify('numeric-wallpaper', 'Wallpaper', wallpaper),
  await classify('generic-grid-overlay', 'Overlay', overlayBuffer),
  await classify('generic-checker-texture', 'Texture', textureBuffer),
];
assert.deepEqual(
  results.map(({ actual }) => actual),
  results.map(({ expected }) => expected),
  'Every generic fixture should be classified from its rendered pixels.',
);
