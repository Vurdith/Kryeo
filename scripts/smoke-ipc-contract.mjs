import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [preload, main, desktopGateway, aiGateway] = await Promise.all([
  fs.readFile(path.join(root, 'src', 'preload', 'index.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'main', 'index.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'main', 'hosted-ai-service.ts'), 'utf8'),
  fs.readFile(path.join(root, 'services', 'ai-server', 'src', 'server.mjs'), 'utf8'),
]);

function channels(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

const invokes = channels(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g);
const handlers = channels(main, /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);
const missingHandlers = invokes.filter((channel) => !handlers.includes(channel));
assert.deepEqual(missingHandlers, [], `Preload channels without main handlers: ${missingHandlers.join(', ')}`);

assert.match(preload, /ipcRenderer\.on\(\s*['"]kryeo:scan-progress['"]/);
assert.match(main, /send\(\s*['"]kryeo:scan-progress['"]/);
assert.ok(invokes.length >= 40, `Expected a broad but fully registered IPC surface, received ${invokes.length} channels.`);

const desktopContract = /REQUIRED_ANALYSIS_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(desktopGateway)?.[1];
const gatewayContract = /ANALYSIS_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(aiGateway)?.[1];
assert.ok(desktopContract, 'Desktop gateway contract was not found.');
assert.ok(gatewayContract, 'AI gateway contract was not found.');
assert.equal(
  desktopContract,
  gatewayContract,
  `Desktop requires ${desktopContract}, but the AI gateway exposes ${gatewayContract}. Package both sides of the same decision contract.`,
);

console.log(JSON.stringify({
  preloadInvokeChannels: invokes.length,
  mainHandlers: handlers.length,
  missingHandlers,
  progressEvent: 'kryeo:scan-progress',
  analysisContract: desktopContract,
}, null, 2));
