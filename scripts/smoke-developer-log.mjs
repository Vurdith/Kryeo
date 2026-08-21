import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [logger, main, preload, types, app] = await Promise.all([
  fs.readFile(path.join(root, 'src', 'main', 'developer-log-service.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'main', 'index.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'preload', 'index.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'shared', 'types.ts'), 'utf8'),
  fs.readFile(path.join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
]);

assert.match(logger, /SENSITIVE_KEY/);
assert.match(logger, /Bearer \[REDACTED\]/);
assert.match(logger, /QUERY_SECRET/);
assert.match(logger, /DATA_URI/);
assert.match(logger, /kryeo-developer\.log/);
assert.match(logger, /MAX_RENDERER_ENTRIES = 750/);
assert.match(logger, /MAX_ENTRY_BYTES = 256 \* 1024/);
assert.match(logger, /readTailLines/);
assert.match(logger, /boundEntry/);
assert.match(logger, /pendingLines/);
assert.match(logger, /pendingBroadcast/);
assert.match(logger, /setRendererStreaming/);
assert.match(logger, /window\.webContents\.send\('kryeo:developer-log'/);
assert.match(main, /ipcMain\.handle =/);
assert.match(main, /kryeo:set-developer-mode/);
assert.match(main, /kryeo:get-developer-log/);
assert.match(main, /kryeo:clear-developer-log/);
assert.match(main, /kryeo:set-developer-log-streaming/);
assert.match(preload, /onDeveloperLog/);
assert.match(preload, /setDeveloperLogStreaming/);
assert.match(types, /interface DeveloperLogEntry/);
assert.match(types, /correlationId\?: string/);
assert.match(types, /fileBytes\?: number/);
assert.match(types, /totalEntries: number/);
assert.match(types, /setDeveloperMode\(enabled: boolean\)/);
assert.match(app, /complete local event stream/);
assert.match(app, /redacted event log/);
assert.match(app, /DEVELOPER_LOG_UI_FLUSH_MS/);
assert.match(app, /developerLogQuery/);

const sanitizerSource = logger.slice(logger.indexOf('const MAX_MEMORY_ENTRIES'), logger.indexOf('export class DeveloperLogService'));
const sanitizerJavaScript = (await transform(sanitizerSource, { loader: 'ts', format: 'cjs', target: 'es2022' })).code;
const sanitizerModule = { exports: {} };
new Function('module', 'exports', sanitizerJavaScript)(sanitizerModule, sanitizerModule.exports);
const sanitized = JSON.stringify(sanitizerModule.exports.sanitizeDeveloperValue({
  token: 'developer-secret-token-123',
  'x-api-key': 'developer-secret-token-123',
  authorization: 'Bearer developer-secret-token-123',
  endpoint: 'https://example.test/?api_key=developer-secret-token-123',
  image: 'data:image/png;base64,QUJD',
  message: 'Bearer developer-secret-token-123',
}));
assert.doesNotMatch(sanitized, /developer-secret-token-123/);
assert.match(sanitized, /REDACTED/);
assert.match(sanitized, /data URI omitted/);

console.log(JSON.stringify({
  logger: 'structured JSONL with rolling memory and disk history',
  redaction: ['object secret fields', 'bearer tokens', 'secret query parameters', 'token-shaped strings', 'data URIs'],
  capture: ['IPC requests/responses/failures', 'renderer console/load/process events', 'component scan stages', 'gateway provider telemetry', 'workflow/export outcomes', 'process-level failures'],
}, null, 2));
