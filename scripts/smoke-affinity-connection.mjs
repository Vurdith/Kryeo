import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main/affinity-service.ts', import.meta.url), 'utf8');
const connectBlock = source.slice(source.indexOf('  async connect('), source.indexOf('  async reconnect('));
const retainedTransport = connectBlock.indexOf('this.transport = transport;');
const handshake = connectBlock.indexOf('await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);');

assert.ok(retainedTransport >= 0, 'connect() must retain the new transport');
assert.ok(handshake >= 0, 'connect() must keep its bounded MCP handshake');
assert.ok(retainedTransport < handshake, 'the transport must be retained before the handshake can time out');
assert.ok(connectBlock.lastIndexOf('await this.close();') > handshake, 'a failed handshake must close the retained transport');

console.log('Affinity connection lifecycle smoke test passed.');
