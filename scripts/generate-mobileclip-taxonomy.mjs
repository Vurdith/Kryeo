import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@huggingface/transformers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'resources', 'models', 'mobileclip-s0', 'ui-taxonomy.json');
const modelId = 'Xenova/mobileclip_s0';

const buildRoot = process.env.KRYEO_BUILD_TMP || path.join(tmpdir(), 'kryeo-build');
env.cacheDir = path.join(buildRoot, 'transformers-cache');
env.allowLocalModels = true;

const taxonomy = [
  ['Frame', ['a decorative game interface frame', 'an ornamental border around interface content', 'a UI window frame']],
  ['Button', ['a reusable game interface button', 'a clickable image button control', 'a menu action button']],
  ['Icon', ['a standalone game interface icon', 'a small symbolic UI graphic', 'an item or action icon']],
  ['Panel', ['a game interface panel surface', 'a rectangular menu panel', 'a UI content panel']],
  ['Slot', ['a reusable inventory slot', 'an item or ability slot in a game interface', 'a framed equipment slot']],
  ['Bar', ['a game UI progress bar', 'a health mana or experience bar', 'a status meter with a filled track']],
  ['Badge', ['a small interface badge or counter', 'a notification badge on a UI control', 'a compact status emblem']],
  ['Label', ['a text label in a game interface', 'a UI caption or heading', 'display text for a menu']],
  ['Text', ['standalone text in a game interface', 'a paragraph or title rendered as text', 'non editable UI text']],
  ['TextBox', ['a text input field in a game interface', 'an editable text box control', 'a search or chat input field']],
  ['ScrollBar', ['a vertical or horizontal UI scroll bar', 'a scroll track with a draggable thumb', 'a game menu scrollbar']],
  ['Divider', ['a thin interface divider', 'a separator line between UI sections', 'a decorative menu separator']],
  ['Background', ['a full screen interface background', 'a large decorative background behind a menu', 'a game UI backdrop']],
  ['Cursor', ['a mouse cursor graphic', 'a pointer used for interface interaction', 'a custom game cursor']],
  ['Wallpaper', ['a full screen illustrated wallpaper', 'a decorative menu wallpaper', 'background art for a game interface']],
  ['Texture', ['a seamless interface texture', 'a repeating surface pattern for a game UI', 'a material texture used inside a panel']],
  ['Overlay', ['a transparent interface overlay', 'a full screen visual overlay above content', 'a tint vignette or atmospheric UI overlay']],
  ['Tooltip', ['a small tooltip panel near a control', 'a contextual help popup', 'an item information tooltip']],
  ['Modal', ['a centered modal dialog', 'a blocking popup window', 'a confirmation dialog panel']],
  ['Input', ['an editable interface input control', 'a form input field', 'a text entry control']],
  ['Tab', ['a clickable interface tab', 'a navigation tab control', 'a selected menu tab']],
  ['Tile', ['a reusable interface tile or card', 'a clickable game menu tile', 'a rectangular content card']],
  ['Ornament', ['a decorative interface ornament', 'a non interactive visual flourish', 'an ornamental motif']],
  ['Border', ['a standalone interface border', 'a decorative outline around a panel', 'a reusable UI border']],
  ['Corner', ['an ornamental interface corner piece', 'a decorative frame corner', 'a reusable UI corner asset']],
  ['Edge', ['a repeatable interface edge segment', 'a side piece of a decorative frame', 'a reusable UI edge']],
  ['Fill', ['an interior interface fill texture', 'a panel surface fill', 'a repeatable UI fill asset']],
  ['FX', ['a visual interface effect', 'a glow shadow or highlight effect', 'a non interactive UI effect layer']],
];

function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((total, value) => total + value * value, 0)) || 1;
  return values.map((value) => value / magnitude);
}

const tokenizer = await AutoTokenizer.from_pretrained(modelId);
const model = await CLIPTextModelWithProjection.from_pretrained(modelId, {
  dtype: 'q8',
  model_file_name: 'text_model',
});

const labels = [];
for (const [type, prompts] of taxonomy) {
  const inputs = tokenizer(prompts, { padding: 'max_length', truncation: true, max_length: 77 });
  const { text_embeds: embeddings } = await model(inputs);
  const dimension = embeddings.dims.at(-1);
  const average = new Array(dimension).fill(0);
  for (let row = 0; row < prompts.length; row += 1) {
    for (let column = 0; column < dimension; column += 1) {
      average[column] += embeddings.data[row * dimension + column] / prompts.length;
    }
  }
  labels.push({ type, prompts, embedding: normalize(average) });
  process.stdout.write(`Generated ${type}\n`);
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ model: 'MobileCLIP-S0', dimension: labels[0].embedding.length, labels }, null, 2)}\n`);
await model.dispose();
process.stdout.write(`Wrote ${output}\n`);
