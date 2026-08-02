import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const modelRoot = path.join(root, 'resources', 'models', 'mobileclip-s0');
const output = path.join(modelRoot, 'ui-visual-prototypes.json');
const previewDirectory = path.join(root, 'tmp', 'visual-prototypes');
const fixtureDirectory = path.join(root, 'scripts', 'fixtures', 'visual');
const imageSize = 256;

const transparent = (width, height) => sharp({
  create: { width, height, channels: 4, background: '#00000000' },
});

async function rectangle(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

async function bar(width, height, fill, track) {
  const inset = Math.max(2, Math.round(height * 0.18));
  return transparent(width, height).composite([
    { input: await rectangle(width - 4, height - 4, '#181512ff'), left: 2, top: 2 },
    { input: await rectangle(width - 8, height - 8, track), left: 4, top: 4 },
    { input: await rectangle(Math.round((width - 8) * fill), height - 8, '#d72638ff'), left: 4, top: 4 },
    { input: await rectangle(width - inset * 2, 1, '#fff0b0cc'), left: inset, top: inset },
  ]).png().toBuffer();
}

async function verticalBar(width, height, fill, track) {
  const innerWidth = Math.max(4, width - 8);
  const innerHeight = Math.max(8, height - 8);
  const fillHeight = Math.max(4, Math.round(innerHeight * fill));
  return transparent(width, height).composite([
    { input: await rectangle(width - 4, height - 4, '#181512ff'), left: 2, top: 2 },
    { input: await rectangle(innerWidth, innerHeight, track), left: 4, top: 4 },
    { input: await rectangle(innerWidth, fillHeight, '#b4bbc6ff'), left: 4, top: 4 + innerHeight - fillHeight },
  ]).png().toBuffer();
}

async function sparseBar(width, height, color, accent) {
  const middle = Math.floor(height / 2);
  return transparent(width, height).composite([
    { input: await rectangle(width, 2, '#111111ff'), left: 0, top: Math.max(0, middle - 1) },
    { input: await rectangle(Math.round(width * 0.88), 3, color), left: Math.round(width * 0.06), top: Math.max(0, middle - 2) },
    { input: await rectangle(Math.max(2, Math.round(height * 0.22)), Math.max(2, Math.round(height * 0.22)), accent), left: 1, top: Math.max(0, middle - Math.round(height * 0.11)) },
  ]).png().toBuffer();
}

async function slot(size, color) {
  const ring = Math.max(5, Math.round(size * 0.08));
  return transparent(size, size).composite([
    { input: await rectangle(size - 4, size - 4, '#17130fff'), left: 2, top: 2 },
    { input: await rectangle(size - ring * 2, size - ring * 2, color), left: ring, top: ring },
    { input: await rectangle(size - ring * 3, size - ring * 3, '#ffffff18'), left: Math.round(ring * 1.5), top: Math.round(ring * 1.5) },
  ]).png().toBuffer();
}

async function outlinedSlot(size, color, shadow) {
  const inset = Math.max(4, Math.round(size * 0.035));
  return transparent(size, size).composite([
    { input: await rectangle(size - inset * 2, size - inset * 2, '#f0e8e0ff'), left: inset, top: inset },
    { input: await rectangle(size - inset * 4, size - inset * 4, color), left: inset * 2, top: inset * 2 },
    {
      input: await rectangle(size - inset * 4, Math.round((size - inset * 4) * 0.42), shadow),
      left: inset * 2,
      top: Math.round(size * 0.56),
    },
  ]).png().toBuffer();
}

async function border(width, height, color, thickness) {
  return transparent(width, height).composite([
    { input: await rectangle(width, thickness, color), left: 0, top: 0 },
    { input: await rectangle(width, thickness, color), left: 0, top: height - thickness },
    { input: await rectangle(thickness, height - thickness * 2, color), left: 0, top: thickness },
    { input: await rectangle(thickness, height - thickness * 2, color), left: width - thickness, top: thickness },
  ]).png().toBuffer();
}

async function doubleBorder(width, height, color, thickness, gap) {
  return transparent(width, height).composite([
    { input: await border(width, height, color, thickness), left: 0, top: 0 },
    {
      input: await border(width - gap * 2, height - gap * 2, color, thickness),
      left: gap,
      top: gap,
    },
  ]).png().toBuffer();
}

async function scene(width, height, colors) {
  const bands = [];
  const bandHeight = Math.ceil(height / colors.length);
  for (let index = 0; index < colors.length; index += 1) {
    bands.push({ input: await rectangle(width, bandHeight, colors[index]), left: 0, top: index * bandHeight });
  }
  bands.push({ input: await rectangle(Math.round(width * 0.22), Math.round(height * 0.72), '#21170fff'), left: Math.round(width * 0.12), top: Math.round(height * 0.2) });
  bands.push({ input: await rectangle(Math.round(width * 0.22), Math.round(height * 0.72), '#2d2117ff'), left: Math.round(width * 0.66), top: Math.round(height * 0.2) });
  bands.push({ input: await rectangle(Math.round(width * 0.28), Math.round(height * 0.45), '#d0b36a88'), left: Math.round(width * 0.36), top: Math.round(height * 0.32) });
  return sharp({ create: { width, height, channels: 4, background: colors[0] } }).composite(bands).png().toBuffer();
}

async function checker(width, height, first, second, cell = 12) {
  const items = [];
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      items.push({ input: await rectangle(Math.min(cell, width - x), Math.min(cell, height - y), ((x / cell + y / cell) % 2) ? first : second), left: x, top: y });
    }
  }
  return transparent(width, height).composite(items).png().toBuffer();
}

async function grid(width, height, color) {
  const items = [];
  for (let x = 0; x < width; x += 24) items.push({ input: await rectangle(1, height, color), left: x, top: 0 });
  for (let y = 0; y < height; y += 24) items.push({ input: await rectangle(width, 1, color), left: 0, top: y });
  return transparent(width, height).composite(items).png().toBuffer();
}

async function icon(size, color) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><path d="M ${size / 2} 4 L ${size * 0.62} ${size * 0.36} L ${size - 4} ${size / 2} L ${size * 0.62} ${size * 0.64} L ${size / 2} ${size - 4} L ${size * 0.38} ${size * 0.64} L 4 ${size / 2} L ${size * 0.38} ${size * 0.36} Z" fill="${color}" stroke="#17130f" stroke-width="4"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function closeIcon(size, foreground, outline = '#17130f') {
  const stroke = Math.max(5, Math.round(size * 0.14));
  const inset = Math.round(size * 0.2);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <path d="M ${inset} ${inset} L ${size - inset} ${size - inset} M ${size - inset} ${inset} L ${inset} ${size - inset}"
      fill="none" stroke="${outline}" stroke-width="${stroke + 5}" stroke-linecap="round"/>
    <path d="M ${inset} ${inset} L ${size - inset} ${size - inset} M ${size - inset} ${inset} L ${inset} ${size - inset}"
      fill="none" stroke="${foreground}" stroke-width="${stroke}" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function closeButton(size, background, foreground) {
  return transparent(size, size).composite([
    { input: await rectangle(size - 4, size - 4, '#17130fff'), left: 2, top: 2 },
    { input: await rectangle(size - 10, size - 10, background), left: 5, top: 5 },
    { input: await closeIcon(Math.round(size * 0.64), foreground), gravity: 'center' },
  ]).png().toBuffer();
}

async function buttonBacking(size, color, shadow) {
  return transparent(size, size).composite([
    { input: await rectangle(size, size, '#17130fff'), left: 0, top: 0 },
    { input: await rectangle(size - 8, size - 8, color), left: 4, top: 4 },
    { input: await rectangle(size - 8, Math.round((size - 8) * 0.34), shadow), left: 4, top: Math.round(size * 0.62) },
    { input: await rectangle(size - 16, 2, '#ffffff55'), left: 8, top: 8 },
  ]).png().toBuffer();
}

async function outlinedButtonBacking(size, color, shadow) {
  return transparent(size, size).composite([
    { input: await rectangle(size, size, '#f2eee6ff'), left: 0, top: 0 },
    { input: await rectangle(size - 4, size - 4, color), left: 2, top: 2 },
    { input: await rectangle(size - 4, Math.round((size - 4) * 0.48), shadow), left: 2, top: Math.round(size * 0.5) },
  ]).png().toBuffer();
}

async function glow(size, color) {
  const core = await sharp({
    create: { width: Math.round(size * 0.45), height: Math.round(size * 0.45), channels: 4, background: color },
  }).blur(Math.max(3, size * 0.08)).png().toBuffer();
  return transparent(size, size).composite([{ input: core, gravity: 'center' }]).png().toBuffer();
}

async function textSpecimen(width, height, text, background = '#00000000', foreground = '#f5f0e4') {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${background}"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial" font-size="${Math.round(height * 0.42)}" font-weight="700" fill="${foreground}">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
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
  const activeRows = [...rows].filter((value) => value > 0.015).length / size;
  const activeColumns = [...columns].filter((value) => value > 0.015).length / size;
  return [
    Math.tanh(Math.log(Math.max(1 / 32, Math.min(32, width / Math.max(1, height)))) / 2),
    total / (size * size),
    center / Math.max(1, centerPixels),
    outer / Math.max(1, outerPixels),
    opaque / (size * size),
    activeRows,
    activeColumns,
    Math.max(...rows),
    Math.max(...columns),
  ];
}

const specimens = [
  ['Bar', 'bar-wide-red', await bar(420, 28, 0.72, '#3a3026ff')],
  ['Bar', 'bar-wide-blue', await bar(360, 34, 0.38, '#17283aff')],
  ['Bar', 'bar-short-gold', await bar(240, 24, 0.55, '#352b17ff')],
  ['Bar', 'bar-sparse-red', await sparseBar(394, 34, '#b1262eff', '#d9ad4fff')],
  ['Bar', 'bar-sparse-blue', await sparseBar(560, 26, '#2b6b91ff', '#e0b63fff')],
  ['Bar', 'bar-sparse-gold', await sparseBar(320, 18, '#a78231ff', '#f0d06aff')],
  ['Slot', 'slot-gold', await slot(96, '#94701fff')],
  ['Slot', 'slot-blue', await slot(112, '#244c7aff')],
  ['Slot', 'slot-dark', await slot(84, '#3b3026ff')],
  ['Border', 'border-square-gold', await border(128, 128, '#b59142ff', 8)],
  ['Border', 'border-screen-silver', await border(320, 180, '#8b887fff', 3)],
  ['Border', 'border-screen-hairline', await border(320, 180, '#8b887fff', 1)],
  ['Border', 'border-screen-white-hairline', await border(640, 360, '#eeeeeeaa', 1)],
  ['Border', 'border-screen-dark-hairline', await border(512, 288, '#1c1c1ccc', 2)],
  ['Border', 'border-screen-double-white', await doubleBorder(640, 360, '#eeeeeecc', 1, 4)],
  ['Border', 'border-screen-double-gray', await doubleBorder(512, 288, '#b8b8b899', 1, 3)],
  ['Border', 'border-wide-single-real', await readFile(path.join(fixtureDirectory, 'border-wide-single.png'))],
  ['Border', 'border-wide-double-real', await readFile(path.join(fixtureDirectory, 'border-wide-double.png'))],
  ['Border', 'border-tall-bronze', await border(180, 280, '#80633bff', 7)],
  ['Wallpaper', 'wallpaper-library', await scene(320, 180, ['#17120fff', '#332519ff', '#5f492fff'])],
  ['Wallpaper', 'wallpaper-forest', await scene(320, 180, ['#14251cff', '#26482fff', '#76623cff'])],
  ['Wallpaper', 'wallpaper-castle', await scene(320, 180, ['#131925ff', '#28374cff', '#6d7580ff'])],
  ['Wallpaper', 'wallpaper-monochrome', await sharp(await scene(640, 360, ['#111111ff', '#383838ff', '#707070ff'])).modulate({ saturation: 0 }).sharpen().png().toBuffer()],
  ['Background', 'background-dark', await rectangle(320, 180, '#171a1fff')],
  ['Background', 'background-panel', await rectangle(320, 180, '#302b25ff')],
  ['Background', 'background-blue', await rectangle(320, 180, '#142238ff')],
  ['Background', 'background-red-real', await readFile(path.join(fixtureDirectory, 'red-background-real.png')), 'Red Background'],
  ['Background', 'background-red-panel', await outlinedSlot(176, '#d75b5bff', '#b84949ff'), 'Red Background'],
  ['Overlay', 'overlay-grid', await grid(320, 180, '#f0e8cf44')],
  ['Overlay', 'overlay-blue-grid', await grid(320, 180, '#4ca6ff3d')],
  ['Overlay', 'overlay-grid-medium', await grid(320, 180, '#8cc8ff55')],
  ['Overlay', 'overlay-grid-bright', await grid(320, 180, '#e8decf88')],
  ['Texture', 'texture-checker', await checker(180, 180, '#4a433aff', '#28241fff')],
  ['Texture', 'texture-blue', await checker(180, 180, '#243954ff', '#1a2738ff', 8)],
  ['Texture', 'texture-checker-compact', await checker(128, 128, '#4c4439ff', '#29251fff', 16)],
  ['Texture', 'texture-checker-fine', await checker(256, 256, '#51483cff', '#29251fff', 8)],
  ['Button', 'button-wide', await bar(220, 64, 1, '#3c4b59ff')],
  ['Button', 'button-square', await slot(72, '#5b3346ff')],
  ['Button', 'button-close-red', await closeButton(176, '#d90808ff', '#f5f5f0'), 'Close Button'],
  ['Button', 'button-close-dark', await closeButton(96, '#292d34ff', '#f1d76a'), 'Close Button'],
  ['Button', 'button-close-red-real', await readFile(path.join(fixtureDirectory, 'close-button-red-real.png')), 'Close Button'],
  ['Divider', 'divider-gold', await rectangle(280, 3, '#c5a65cff')],
  ['Divider', 'divider-silver', await rectangle(220, 2, '#a9adb5ff')],
  ['Icon', 'icon-gold', await icon(72, '#d5aa42')],
  ['Icon', 'icon-blue', await icon(64, '#4e8fd8')],
  ['Icon', 'icon-close-white', await closeIcon(72, '#f5f5f0'), 'Close Icon'],
  ['Icon', 'icon-close-gold', await closeIcon(56, '#d7ad4c'), 'Close Icon'],
  ['Icon', 'icon-close-white-wide', await closeIcon(96, '#f5f5f0', '#777777'), 'Close Icon'],
  ['FX', 'fx-gold-glow', await glow(96, '#f7d648aa')],
  ['FX', 'fx-blue-glow', await glow(96, '#4da6ffaa')],
  ['Panel', 'panel-dark', await slot(240, '#242a31ff')],
  ['Frame', 'frame-window', await border(240, 180, '#9c7a43ff', 12)],
  ['Fill', 'fill-gold', await checker(160, 120, '#6a5424ff', '#80662dff', 16)],
  ['Fill', 'fill-solid-red', await rectangle(176, 176, '#d90808ff')],
  ['Fill', 'fill-solid-blue', await rectangle(128, 128, '#255b9aff')],
  ['Fill', 'fill-button-red', await buttonBacking(176, '#e00808ff', '#bd0505ff')],
  ['Fill', 'fill-button-blue', await buttonBacking(128, '#2865b2ff', '#194a8cff')],
  ['Fill', 'fill-button-red-outlined', await outlinedButtonBacking(128, '#e00808ff', '#bd0505ff')],
  ['Label', 'label-caption', await textSpecimen(220, 42, 'QUEST LOG')],
  ['Text', 'text-body', await textSpecimen(260, 54, 'Ancient ruins await')],
  ['TextBox', 'textbox-search', await textSpecimen(280, 54, 'Search...', '#20242aff', '#aeb4bd')],
  ['ScrollBar', 'scrollbar-vertical', await verticalBar(32, 280, 0.48, '#25282cff')],
  ['Badge', 'badge-count', await textSpecimen(58, 58, '12', '#b62a38ff')],
  ['Cursor', 'cursor-pointer', await icon(44, '#f6f1d4')],
  ['Tooltip', 'tooltip-hint', await textSpecimen(220, 72, 'Equip item', '#191c20ee')],
  ['Modal', 'modal-dialog', await slot(300, '#242832ff')],
  ['Input', 'input-field', await textSpecimen(260, 54, 'Player name', '#171a20ff', '#b5bac2')],
  ['Tab', 'tab-active', await textSpecimen(150, 50, 'INVENTORY', '#4559baff')],
  ['Tile', 'tile-card', await slot(180, '#313a46ff')],
  ['Ornament', 'ornament-diamond', await icon(92, '#bf9840')],
  ['Corner', 'corner-gold', await border(96, 96, '#d3aa4fff', 10)],
  ['Edge', 'edge-gold', await rectangle(280, 8, '#a77c36ff')],
];

function normalize(values) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Array.from(values, (value) => value / magnitude);
}

async function tensorFor(buffer) {
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .resize(imageSize, imageSize, { fit: 'contain', background: { r: 127, g: 127, b: 127, alpha: 1 } })
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
  return values;
}

await mkdir(previewDirectory, { recursive: true });
const session = await ort.InferenceSession.create(path.join(modelRoot, 'vision_model_quantized.onnx'), {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
});

const prototypes = [];
for (const [type, id, buffer, suggestedName] of specimens) {
  await writeFile(path.join(previewDirectory, `${id}.png`), buffer);
  const metadata = await sharp(buffer).metadata();
  const values = await tensorFor(buffer);
  const result = await session.run({ pixel_values: new ort.Tensor('float32', values, [1, 3, imageSize, imageSize]) });
  prototypes.push({
    type,
    id,
    suggestedName,
    embedding: normalize(result.image_embeds.data),
    features: await visualFeatures(buffer, metadata.width || 1, metadata.height || 1),
  });
  process.stdout.write(`Generated ${id}\n`);
}

await writeFile(output, `${JSON.stringify({ model: 'MobileCLIP-S0', dimension: prototypes[0].embedding.length, prototypes }, null, 2)}\n`);
process.stdout.write(`Wrote ${output}\n`);
