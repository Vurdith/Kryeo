import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const unpackedResources = path.join(root, 'release', 'win-unpacked', 'resources');
const installer = path.join(root, 'release', `Kryeo-Setup-${packageJson.version}.exe`);
const appAsar = path.join(unpackedResources, 'app.asar');
const model = path.join(unpackedResources, 'models', 'mobileclip-s0', 'vision_model_quantized.onnx');
const taxonomy = path.join(unpackedResources, 'models', 'mobileclip-s0', 'ui-taxonomy.json');

const [installerStat, modelStat, taxonomyStat] = await Promise.all([
  fs.stat(installer),
  fs.stat(model),
  fs.stat(taxonomy),
]);
const packaged = JSON.parse(extractFile(appAsar, 'package.json').toString('utf8'));

assert.equal(packaged.version, packageJson.version, 'the app.asar version must match the release version');
assert.ok(installerStat.size > 10_000_000, 'the NSIS installer is unexpectedly small');
assert.ok(modelStat.size > 10_000_000, 'the packaged MobileCLIP model is missing or truncated');
assert.ok(taxonomyStat.size > 100_000, 'the packaged visual taxonomy is missing or truncated');

console.log(JSON.stringify({
  version: packageJson.version,
  installerBytes: installerStat.size,
  modelBytes: modelStat.size,
  taxonomyBytes: taxonomyStat.size,
}, null, 2));
