import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

const MODEL_PORT = 18786;
const GATEWAY_PORT = 18787;
const TOKEN = 'test-token-that-is-long-enough';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4f0ZAAAAAElFTkSuQmCC';

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitForGateway() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Gateway did not start.');
}

function modelResponse(prompt) {
  const familyIds = [...new Set(
    [...prompt.matchAll(/\\"familyId\\":\\"([^"\\]+)\\"/g)].map((match) => match[1]),
  )];
  if (prompt.includes('Pass one is observation only')) {
    return {
      observations: (familyIds.length ? familyIds : ['family-a']).map((familyId) => ({
        familyId,
        description: 'A square control with a centered close mark and a clear interactive affordance.',
        visibleFunctions: ['dismiss control'],
        ambiguities: [],
        needsDetail: false,
      })),
    };
  }
  if (prompt.includes('reconcile preliminary multimodal classifications')) {
    return {
      summary: 'One family was normalized.',
      issues: [{
        familyId: 'family-a',
        message: 'Use the interactive role consistently.',
        suggestedType: 'Button',
        suggestedRole: 'ImageButton',
        suggestedName: 'Close Button 1',
      }],
    };
  }
  if (prompt.includes('User message:')) {
    return {
      text: 'Hello from Kryeo.',
      memories: [],
      actions: [{ type: 'open-component-scan', label: 'Review document', description: 'Open Component Scan.' }],
      visionUsed: true,
    };
  }
  const nullableEvidence = prompt.includes('null-evidence-family');
  const analysis = (familyId) => ({
    familyId,
    familyName: 'Close Button',
    assetType: 'Button',
    role: 'ImageButton',
    memberNames: [{ visualHash: 'hash-a', name: 'Close Button' }],
    diveMode: 'keep-together',
    reason: 'The complete visual is an interactive close control.',
    visualDescription: 'A square control with a centered close mark and a clear interactive affordance.',
    confidence: nullableEvidence ? null : 0.91,
    evidence: nullableEvidence
      ? { visual: null, layerName: null, hierarchy: null, learned: null }
      : { visual: 0.92, layerName: 0.2, hierarchy: 0.8, learned: 0 },
    conflict: 'false',
    conflictMessage: '',
    reviewNeeded: false,
    alternatives: [],
  });
  const analyses = (familyIds.length ? familyIds : ['rewritten-close-control']).map(analysis);
  return analyses.length === 1 ? analyses[0] : { families: analyses };
}

test('authenticated gateway analyses, reconciles, chats, and caches', async () => {
  const runId = `${process.pid}-${Date.now()}`;
  let modelCalls = 0;
  const model = http.createServer(async (request, response) => {
    modelCalls += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const prompt = JSON.stringify(body.messages || []);
    if (prompt.includes('slow-family')) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        const finish = () => {
          clearTimeout(timer);
          resolve();
        };
        request.once('aborted', finish);
        response.once('close', finish);
      });
      if (response.destroyed) return;
    }
    const content = `${JSON.stringify(modelResponse(prompt))}\n{"trailing":true}`;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await listen(model, MODEL_PORT);

  const gateway = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      KRYEO_AI_PORT: String(GATEWAY_PORT),
      KRYEO_AI_TOKENS: TOKEN,
      KRYEO_AI_ALLOW_LOOPBACK_WITHOUT_TOKEN: 'false',
      KRYEO_MODEL_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
      KRYEO_AI_DATA_DIR: `.test-data-${runId}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForGateway();
    const unauthorized = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`);
    assert.equal(unauthorized.status, 401);

    const family = {
      id: 'family-a',
      fingerprint: `fingerprint-${runId}`,
      project: 'Test',
      documentTitle: 'Document',
      parentNames: ['Controls'],
      representativeHash: 'hash-a',
      exactInstanceCount: 1,
      members: [{
        id: 'a',
        visualHash: 'hash-a',
        name: 'Layer10',
        affinityType: 'GroupNode',
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        hierarchyKey: '1',
        parentHierarchyKey: '0',
        childHierarchyKeys: [],
        previewUrl: PIXEL,
        analysisPreviewUrls: [],
      }],
    };
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const first = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [family] }),
    }).then((response) => response.json());
    assert.equal(first.analyses[0].assetType, 'Button');
    assert.match(first.analyses[0].visualDescription, /close mark/i);
    assert.equal(first.analyses[0].confidence, 0.91);
    assert.equal(first.analyses[0].conflict, false);
    assert.equal(first.cached, 0);

    const second = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [family] }),
    }).then((response) => response.json());
    assert.equal(second.cached, 1);

    const contextChanged = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        instructions: ['This project uses a different interaction vocabulary.'],
        families: [family],
      }),
    }).then((response) => response.json());
    assert.equal(contextChanged.cached, 0);

    const callsBeforeBatch = modelCalls;
    const batched = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: [
          { ...family, id: 'family-batch-one', fingerprint: `batch-one-${runId}` },
          { ...family, id: 'family-batch-two', fingerprint: `batch-two-${runId}` },
        ],
      }),
    }).then((response) => response.json());
    assert.equal(batched.analyses.length, 2);
    assert.equal(modelCalls - callsBeforeBatch, 1, 'a family batch should use one multimodal decision call');

    const semanticFamilies = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: [
          {
            ...family,
            id: 'family-stagger',
            fingerprint: `stagger-${runId}`,
            members: [{ ...family.members[0], name: 'StaggerBar' }],
          },
          {
            ...family,
            id: 'family-middle',
            fingerprint: `middle-${runId}`,
            members: [{ ...family.members[0], name: 'BackgroundMiddle' }],
          },
          {
            ...family,
            id: 'family-holder',
            fingerprint: `holder-${runId}`,
            members: [{ ...family.members[0], name: 'NumberHolder' }],
          },
          {
            ...family,
            id: 'family-hotbar-slot',
            fingerprint: `hotbar-slot-${runId}`,
            members: [{ ...family.members[0], name: 'HotbarSlot1' }],
          },
        ],
      }),
    }).then((response) => response.json());
    const semanticById = new Map(semanticFamilies.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(semanticById.get('family-stagger').familyName, 'Stagger Bar');
    assert.equal(semanticById.get('family-stagger').assetType, 'Bar');
    assert.equal(semanticById.get('family-stagger').role, 'ImageLabel');
    assert.equal(semanticById.get('family-middle').familyName, 'Middle Background');
    assert.equal(semanticById.get('family-middle').assetType, 'Background');
    assert.equal(semanticById.get('family-middle').role, 'ImageLabel');
    assert.equal(semanticById.get('family-holder').familyName, 'Number Holder');
    assert.equal(semanticById.get('family-hotbar-slot').familyName, 'Hotbar Slot');
    assert.equal(semanticById.get('family-hotbar-slot').assetType, 'Slot');
    assert.equal(semanticById.get('family-hotbar-slot').role, 'ImageButton');

    const nullableEvidence = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: [{ ...family, id: 'null-evidence-family', fingerprint: `null-evidence-${runId}` }],
      }),
    }).then((response) => response.json());
    assert.equal(nullableEvidence.analyses[0].confidence, 0);
    assert.deepEqual(nullableEvidence.analyses[0].evidence, {
      visual: 0,
      layerName: 0,
      hierarchy: 0,
      learned: 0,
    });
    assert.equal(nullableEvidence.analyses[0].reviewNeeded, true);

    const cancelController = new AbortController();
    const slowRequest = fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      signal: cancelController.signal,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: [{ ...family, id: 'slow-family', fingerprint: `slow-${runId}` }],
      }),
    });
    setTimeout(() => cancelController.abort(), 100);
    await assert.rejects(slowRequest, (error) => error?.name === 'AbortError');

    let queueDepth = -1;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const health = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { headers })
        .then((response) => response.json());
      queueDepth = health.queueDepth;
      if (queueDepth === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(queueDepth, 0, 'cancelled analysis should release the hosted queue');

    const reconciliation = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/documents/reconcile`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', analyses: first.analyses }),
    }).then((response) => response.json());
    assert.equal(reconciliation.issues.length, 1);
    assert.equal(reconciliation.issues[0].suggestedRole, 'ImageButton');
    assert.equal(reconciliation.issues[0].suggestedName, 'Close Button 1');

    const chat = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        request: { project: 'Test', message: 'Hello', document: { title: 'Document' } },
        images: [{ label: 'document', dataUrl: PIXEL }],
      }),
    }).then((response) => response.json());
    assert.equal(chat.text, 'Hello from Kryeo.');
    assert.equal(chat.actions[0].type, 'open-component-scan');
  } finally {
    gateway.kill();
    await close(model);
    await fs.rm(path.resolve(`.test-data-${runId}`), { recursive: true, force: true });
  }
});
