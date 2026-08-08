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
const VISION_PREVIEW = `data:image/png;base64,${(await fs.readFile(new URL('../../../scripts/fixtures/visual/close-button-red-real.png', import.meta.url))).toString('base64')}`;

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
  const compactCount = Number(/Return the compact packet for f1\.\.f(\d+)/.exec(prompt)?.[1] || 0);
  const compactIds = Array.from({ length: compactCount }, (_, index) => `f${index + 1}`);
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
  if (prompt.includes('independently audit one existing Kryeo visual classification')) {
    if (prompt.includes('Audit Wrong Frame')) {
      return {
        q: 'The artwork is a hollow ornamental perimeter rather than a runtime container.',
        v: 'An inset decorative border surrounding a transparent centre.',
        c: 0.96,
        e: [0.97, 0.1, 0.2, 0],
        ok: false,
        x: true,
        xm: 'The chosen Frame type conflicts with the hollow perimeter artwork.',
        st: 'Border',
        sr: 'ImageLabel',
        sn: 'Decorative Border',
        a: [['Ornament', 'It could be ornamental if it is not used as an enclosing perimeter.']],
      };
    }
    return {
      q: 'The centered close mark and control silhouette support the chosen button classification.',
      v: 'A square red control with a centered pale close mark.',
      c: 0.93,
      e: [0.94, 0.2, 0.82, 0],
      x: false,
      ok: true,
      xm: '',
      a: [['Icon', 'It could be decorative if the surrounding hierarchy is non-interactive.']],
    };
  }
  if (prompt.includes('Incomplete Family')) {
    return { visualHash: 'hash-a', name: 'Diagonal Scanline Overlay' };
  }
  if (prompt.includes('Evidence Only Family')) {
    return {
      visual: 'Large dimensions and low alpha indicate a transparent treatment.',
      layerName: 'CheckeredTexture',
      hierarchy: 'Top-level raster node in the hierarchy context.',
      learned: 'Often used as a UI depth or technical treatment.',
    };
  }
  const nullableEvidence = prompt.includes('Null Evidence Family');
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
  const requestedIds = compactIds.length ? compactIds : familyIds.length ? familyIds : ['rewritten-close-control'];
  const compactAnalysis = (familyId, overrides = {}) => ({
    id: familyId,
    n: overrides.name || 'Close Button',
    t: overrides.type || 'Button',
    r: overrides.role || 'ImageButton',
    d: 'keep-together',
    q: 'The complete visual is an interactive close control.',
    v: overrides.description || 'A square control with a centered close mark and a clear interactive affordance.',
    c: nullableEvidence ? null : 0.91,
    e: nullableEvidence ? [null, null, null, null] : [0.92, 0.2, 0.8, 0],
    x: false,
    rv: false,
  });
  const compactPacket = (ids, overrides = []) => {
    const roots = ids.map((_, index) => overrides[index]?.name || 'Close Button');
    return {
      r: roots,
      f: ids.map((familyId, index) => [
        familyId,
        index,
        overrides[index]?.type || 'Button',
        '',
        overrides[index]?.uncertain ? 1 : 0,
        0,
      ]),
    };
  };
  if (prompt.includes('Partial Recovery Family')) {
    const returnedIds = requestedIds.length > 1 ? requestedIds.slice(0, -1) : requestedIds;
    return compactPacket(returnedIds, returnedIds.map(() => ({ name: 'Recovered Visual', type: 'Button' })));
  }
  if (prompt.includes('Scope Guard Document')) {
    return compactPacket(requestedIds, [{ name: 'Hotbar Slot Number Holder Border 2', type: 'Border' }]);
  }
  if (prompt.includes('Context Leakage Family')) {
    return compactPacket(requestedIds, [
      { name: 'Skill Slot', type: 'Slot' },
      { name: 'Skill Slot Borders', type: 'Border' },
      { name: 'Skill Slot Border 1', type: 'Border' },
      { name: 'Skill Slot', type: 'Slot' },
    ]);
  }
  if (prompt.includes('Inset Perimeter Type Guard')) {
    return compactPacket(requestedIds, [
      { name: 'Main Frame Outer Layers', type: 'Border' },
      { name: 'Frame', type: 'Frame' },
    ]);
  }
  if (prompt.includes('BackgroundMiddle')) {
    const semantic = [
      { name: 'Stagger Meter', type: 'Bar', role: 'ImageLabel' },
      { name: 'Number Badge', type: 'Badge', role: 'ImageLabel' },
      { name: 'Number Display Holder', type: 'Badge', role: 'ImageLabel' },
      { name: 'Hotbar Slot Container', type: 'Slot', role: 'ImageButton' },
    ];
    return compactPacket(requestedIds, semantic);
  }
  if (prompt.includes('Return the compact packet')) {
    return compactPacket(requestedIds);
  }
  const analyses = requestedIds.map(analysis);
  return analyses.length === 1 ? analyses[0] : { families: analyses };
}

test('authenticated gateway analyses, reconciles, chats, and caches', async () => {
  const runId = `${process.pid}-${Date.now()}`;
  let modelCalls = 0;
  const modelImageCounts = [];
  const modelNames = [];
  const modelPrompts = [];
  let activeModelCalls = 0;
  let maxActiveModelCalls = 0;
  const model = http.createServer(async (request, response) => {
    modelCalls += 1;
    activeModelCalls += 1;
    maxActiveModelCalls = Math.max(maxActiveModelCalls, activeModelCalls);
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      modelNames.push(body.model);
      modelImageCounts.push((JSON.stringify(body.messages || []).match(/\"type\":\"image_url\"/g) || []).length);
      const prompt = JSON.stringify(body.messages || []);
      modelPrompts.push(prompt);
      if (prompt.includes('Slow Family')) {
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
      if (prompt.includes('Concurrency')) await new Promise((resolve) => setTimeout(resolve, 250));
      const content = `${JSON.stringify(modelResponse(prompt))}\n{"trailing":true}`;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cost: 0.0001,
        },
      }));
    } finally {
      activeModelCalls -= 1;
    }
  });
  await listen(model, MODEL_PORT);

  const gateway = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      KRYEO_AI_PORT: String(GATEWAY_PORT),
      KRYEO_AI_TOKENS: TOKEN,
      KRYEO_AI_MODEL_LITE: 'qwen/qwen3.7-flash',
      KRYEO_AI_MODEL_ESCALATION: 'qwen/qwen3.7-flash',
      KRYEO_MODEL_API_KEY: '',
      KRYEO_AI_ALLOW_LOOPBACK_WITHOUT_TOKEN: 'false',
      KRYEO_AI_RATE_LIMIT_PER_MINUTE: '1000',
      KRYEO_AI_MODEL_CONCURRENCY: '2',
      KRYEO_AI_MAX_INFLIGHT_PER_TOKEN: '2',
      KRYEO_AI_SCAN_TARGET_USD: '0.01',
      KRYEO_AI_SCAN_BUDGET_USD: '0.03',
      KRYEO_AI_ENFORCE_SCAN_BUDGET: 'true',
      KRYEO_AI_MAX_HOSTED_FAMILIES_PER_SCAN: '0',
      KRYEO_AI_MAX_ESCALATION_FAMILIES_PER_SCAN: '48',
      KRYEO_AI_MAX_CACHE_ENTRIES: '1000',
      KRYEO_MODEL_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
      KRYEO_AI_DATA_DIR: `.test-data-${runId}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForGateway();
    const health = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((response) => response.json());
    assert.equal(health.modelConcurrency, 2);
    assert.equal(health.familyBatchSize, 16);
    assert.equal(health.maxMemberImagesPerFamily, 2);
    assert.equal(health.modelLite, 'qwen/qwen3.7-flash');
    assert.equal(health.modelEscalation, 'qwen/qwen3.7-flash');
    assert.equal(health.providerSort, 'price');
    assert.equal(health.responseCacheEnabled, false);
    assert.equal(health.maxInflightPerToken, 2);
    assert.equal(health.scanTargetUsd, 0.01);
    assert.equal(health.scanBudgetUsd, 0.03);
    assert.equal(health.scanBudgetEnforced, true);
    assert.equal(health.liteInputPricePerMillion, 0.03);
    assert.equal(health.liteOutputPricePerMillion, 0.13);
    assert.equal(health.costEstimateSafetyFactor, 2);
    assert.equal(health.maxHostedFamiliesPerScan, 0);
    assert.equal(health.analysisVersion, 'family-v35');
    assert.equal(health.maxCacheEntries, 1000);
    assert.equal(modelPrompts.length, 0);
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
    assert.equal(first.analyses[0].visualDescription, '');
    assert.equal(first.analyses[0].confidence, 0.86);
    assert.equal(first.analyses[0].evidence, undefined);
    assert.equal(first.analyses[0].conflict, false);
    assert.equal(first.analyses[0].reviewNeeded, false);
    assert.equal(first.cached, 0);

    const evidenceRequest = {
      familyFingerprint: family.fingerprint,
      visualHash: family.members[0].visualHash,
      familyName: first.analyses[0].familyName,
      assetType: first.analyses[0].assetType,
      role: first.analyses[0].role,
      sourceName: family.members[0].name,
      affinityType: family.members[0].affinityType,
      bounds: family.members[0].bounds,
      previewUrl: VISION_PREVIEW,
    };
    const evidence = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify(evidenceRequest),
    }).then((response) => response.json());
    assert.equal(evidence.cached, false);
    assert.equal(evidence.confidence, 0.93);
    assert.equal(evidence.evidence.visual, 0.94);
    const cachedEvidence = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify(evidenceRequest),
    }).then((response) => response.json());
    assert.equal(cachedEvidence.cached, true);

    const independentFrameAudit = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...evidenceRequest,
        familyFingerprint: `audit-wrong-frame-${runId}`,
        visualHash: `audit-wrong-frame-hash-${runId}`,
        familyName: 'Frame',
        assetType: 'Frame',
        role: 'Frame',
        sourceName: 'Audit Wrong Frame',
      }),
    }).then((response) => response.json());
    assert.equal(independentFrameAudit.supportsClassification, false);
    assert.equal(independentFrameAudit.conflict, true);
    assert.equal(independentFrameAudit.suggestedType, 'Border');
    assert.equal(independentFrameAudit.suggestedRole, 'ImageLabel');
    assert.equal(independentFrameAudit.suggestedName, 'Decorative Border');

    const concurrentResults = await Promise.all(['one', 'two'].map((suffix) => fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: [{
          ...family,
          id: `concurrency-family-${suffix}`,
          fingerprint: `concurrency-${suffix}-${runId}`,
          members: [{ ...family.members[0], name: `Concurrency ${suffix}` }],
        }],
      }),
    }).then((response) => response.json())));
    assert.equal(concurrentResults.every((result) => result.analyses?.length === 1), true);
    assert.equal(maxActiveModelCalls, 2, 'the gateway should use both configured model slots');

    const coalescedFamily = {
      ...family,
      id: 'coalesced-family',
      fingerprint: `coalesced-${runId}`,
      members: [{ ...family.members[0], name: 'Coalesced Family' }],
    };
    const callsBeforeCoalescing = modelCalls;
    const coalesced = await Promise.all([1, 2].map((copy) => fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        hostedScanId: `coalesced-scan-${runId}-${copy}`,
        families: [coalescedFamily],
      }),
    }).then((response) => response.json())));
    assert.equal(coalesced.every((result) => result.analyses?.length === 1), true, JSON.stringify(coalesced));
    assert.equal(modelCalls - callsBeforeCoalescing, 1, 'identical concurrent misses should purchase one model call');

    const second = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [family] }),
    }).then((response) => response.json());
    assert.equal(second.cached, 1);

    const callsBeforeSharedCache = modelCalls;
    const sharedAcrossUsers = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Another user project',
        documentTitle: 'Another document',
        documentSessionUuid: 'another-session',
        families: [{ ...family, id: 'shared-family-copy', fingerprint: `shared-copy-${runId}` }],
      }),
    }).then((response) => response.json());
    assert.equal(sharedAcrossUsers.cached, 1);
    assert.equal(modelCalls - callsBeforeSharedCache, 0, 'context-neutral exact assets should reuse the shared structured cache');

    const tierContextFamily = {
      ...family,
      id: 'tier-context-lite',
      fingerprint: `tier-context-lite-${runId}`,
      members: [{
        ...family.members[0],
        visualHash: `tier-context-hash-${runId}`,
        name: 'Escalation Context Family',
        previewUrl: VISION_PREVIEW,
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      }],
    };
    const tierLite = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [tierContextFamily] }),
    }).then((response) => response.json());
    assert.equal(tierLite.cached, 0);
    const callsBeforeEscalationCacheCheck = modelCalls;
    const tierEscalation = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document with richer context',
        documentSessionUuid: 'different-escalation-session',
        hostedScanId: `tier-context-escalation-${runId}`,
        reviewTier: 'escalation',
        maxMemberImages: 1,
        includeDocumentContext: true,
        documentPreviewUrl: VISION_PREVIEW,
        families: [{ ...tierContextFamily, id: 'tier-context-escalation', fingerprint: `tier-context-escalation-${runId}` }],
      }),
    }).then((response) => response.json());
    assert.equal(tierEscalation.cached, 0, 'an escalation must not reuse a Lite shared result');
    assert.equal(modelCalls - callsBeforeEscalationCacheCheck, 1);
    assert.equal(modelImageCounts.at(-1), 2, 'an escalation should retain its document context image');

    const cappedFamily = {
      ...family,
      id: 'capped-family',
      fingerprint: `capped-${runId}`,
      members: Array.from({ length: 4 }, (_, index) => ({
        ...family.members[0],
        id: `capped-member-${index}`,
        visualHash: `capped-hash-${index}`,
        name: `Variant ${index + 1}`,
        previewUrl: VISION_PREVIEW,
      })),
    };
    const capped = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [cappedFamily] }),
    }).then((response) => response.json());
    assert.equal(capped.analyses.length, 1);
    assert.equal(modelImageCounts.at(-1), 1, 'Lite classification should send only one representative preview');

    const escalationFamily = {
      ...cappedFamily,
      id: 'escalation-family',
      fingerprint: `escalation-${runId}`,
      members: [{
        ...cappedFamily.members[0],
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      }],
    };
    const escalated = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        hostedScanId: `escalation-scan-${runId}`,
        reviewTier: 'escalation',
        maxMemberImages: 1,
        includeDocumentContext: true,
        documentPreviewUrl: VISION_PREVIEW,
        families: [escalationFamily],
      }),
    }).then((response) => response.json());
    assert.equal(escalated.model, 'qwen/qwen3.7-flash');
    assert.equal(modelNames.at(-1), 'qwen/qwen3.7-flash');
    assert.equal(modelImageCounts.at(-1), 2, 'escalation should send one family preview plus document context');

    const incomplete = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        hostedScanId: `incomplete-scan-${runId}`,
        families: [{
          ...family,
          id: 'incomplete-family',
          fingerprint: `incomplete-${runId}`,
          members: [{ ...family.members[0], name: 'Incomplete Family' }],
          reviewSignals: { localAssetType: 'Overlay', localRole: 'ImageLabel' },
        }],
      }),
    }).then((response) => response.json());
    assert.equal(incomplete.analyses.length, 1);
    assert.equal(incomplete.analyses[0].familyName, 'Diagonal Scanline Overlay');
    assert.equal(incomplete.analyses[0].assetType, 'Overlay');
    assert.equal(incomplete.analyses[0].reviewNeeded, true);

    const evidenceOnly = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        hostedScanId: `evidence-only-scan-${runId}`,
        families: [{
          ...family,
          id: 'evidence-only-family',
          fingerprint: `evidence-only-${runId}`,
          members: [{ ...family.members[0], name: 'Evidence Only Family' }],
          reviewSignals: { localAssetType: 'Overlay', localRole: 'ImageLabel' },
        }],
      }),
    }).then((response) => response.json());
    assert.equal(evidenceOnly.analyses.length, 1);
    assert.equal(evidenceOnly.analyses[0].assetType, 'Overlay');
    assert.equal(evidenceOnly.analyses[0].role, 'ImageLabel');
    assert.equal(evidenceOnly.analyses[0].reviewNeeded, true);
    assert.match(evidenceOnly.analyses[0].visualDescription, /transparent treatment/i);
    assert.match(evidenceOnly.analyses[0].reason, /partial evidence/i);

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
        reviewTier: 'lite',
        familyContactSheet: {
          previewUrl: VISION_PREVIEW,
          familyIds: ['family-batch-one', 'family-batch-two'],
        },
        families: [
          {
            ...family,
            id: 'family-batch-one',
            fingerprint: `batch-one-${runId}`,
            members: [{ ...family.members[0], visualHash: 'batch-hash-one', name: 'Batch Visual One' }],
          },
          {
            ...family,
            id: 'family-batch-two',
            fingerprint: `batch-two-${runId}`,
            members: [{ ...family.members[0], visualHash: 'batch-hash-two', name: 'Batch Visual Two' }],
          },
        ],
      }),
    }).then((response) => response.json());
    assert.equal(Array.isArray(batched.analyses), true, JSON.stringify(batched));
    assert.equal(batched.analyses.length, 2);
    assert.equal(modelCalls - callsBeforeBatch, 1, 'a family batch should use one multimodal decision call');
    assert.equal(modelImageCounts.at(-1), 1, 'a Lite family batch should send one contact-sheet image');

    const sixteenIds = Array.from({ length: 16 }, (_, index) => `sixteen-family-${index + 1}`);
    const callsBeforeSixteen = modelCalls;
    const sixteenFamilyBatch = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'lite',
        familyContactSheet: { previewUrl: VISION_PREVIEW, familyIds: sixteenIds },
        families: sixteenIds.map((id, index) => ({
          ...family,
          id,
          fingerprint: `${id}-${runId}`,
          members: [{ ...family.members[0], visualHash: `${id}-hash`, name: `Simple Visual ${index + 1}` }],
        })),
      }),
    }).then((response) => response.json());
    assert.equal(sixteenFamilyBatch.analyses.length, 16);
    assert.equal(modelCalls - callsBeforeSixteen, 1, 'sixteen simple families should fit one compact model request');
    assert.equal(modelImageCounts.at(-1), 1, 'sixteen simple families should share one 512px contact sheet');

    const callsBeforeShiftedBatch = modelCalls;
    const shiftedBatch = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'lite',
        familyContactSheet: {
          previewUrl: VISION_PREVIEW,
          familyIds: ['family-batch-one', 'family-batch-three', 'family-batch-four'],
        },
        families: [
          {
            ...family,
            id: 'family-batch-one',
            fingerprint: `batch-one-${runId}`,
            members: [{ ...family.members[0], visualHash: 'batch-hash-one', name: 'Batch Visual One' }],
          },
          {
            ...family,
            id: 'family-batch-three',
            fingerprint: `batch-three-${runId}`,
            members: [{ ...family.members[0], visualHash: 'batch-hash-three', name: 'Batch Visual Three' }],
          },
          {
            ...family,
            id: 'family-batch-four',
            fingerprint: `batch-four-${runId}`,
            members: [{ ...family.members[0], visualHash: 'batch-hash-four', name: 'Batch Visual Four' }],
          },
        ],
      }),
    }).then((response) => response.json());
    assert.equal(shiftedBatch.cached, 1);
    assert.equal(shiftedBatch.analyses.length, 3);
    assert.deepEqual(
      new Set(shiftedBatch.analyses.map((analysis) => analysis.familyId)),
      new Set(['family-batch-one', 'family-batch-three', 'family-batch-four']),
    );
    assert.equal(modelCalls - callsBeforeShiftedBatch, 1);
    assert.equal(modelImageCounts.at(-1), 1, 'cached cells must not shift the contact-sheet mapping');

    const callsBeforePartialBatch = modelCalls;
    const partialBatchIds = ['partial-recovery-one', 'partial-recovery-two', 'partial-recovery-three'];
    const partialBatch = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'lite',
        familyContactSheet: {
          previewUrl: VISION_PREVIEW,
          familyIds: partialBatchIds,
        },
        families: partialBatchIds.map((id, index) => ({
          ...family,
          id,
          fingerprint: `${id}-${runId}`,
          members: [{ ...family.members[0], name: `Partial Recovery Family ${index + 1}` }],
        })),
      }),
    }).then((response) => response.json());
    assert.equal(partialBatch.analyses.length, 3);
    assert.deepEqual(new Set(partialBatch.analyses.map((item) => item.familyId)), new Set(partialBatchIds));
    assert.equal(modelCalls - callsBeforePartialBatch, 2, 'only the one omitted family should be retried');
    assert.equal(partialBatch.recovery.partialBatchResponses, 1);
    assert.equal(partialBatch.recovery.batchRecoveries, 1);
    assert.equal(partialBatch.recovery.recoveryFamilies, 1);
    assert.equal(partialBatch.recovery.singleFamilyRecoveries, 0);
    assert.deepEqual(partialBatch.failures, []);

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
    assert.equal(semanticById.get('family-stagger').familyName, 'Stagger Meter');
    assert.equal(semanticById.get('family-stagger').assetType, 'Bar');
    assert.equal(semanticById.get('family-stagger').role, 'ImageLabel');
    assert.equal(semanticById.get('family-middle').familyName, 'Middle Background');
    assert.equal(semanticById.get('family-middle').assetType, 'Background');
    assert.equal(semanticById.get('family-middle').role, 'ImageLabel');
    assert.equal(semanticById.get('family-holder').familyName, 'Number Holder');
    assert.equal(semanticById.get('family-holder').assetType, 'Badge');
    assert.equal(semanticById.get('family-holder').role, 'ImageLabel');
    assert.equal(semanticById.get('family-hotbar-slot').familyName, 'Hotbar Slot');
    assert.equal(semanticById.get('family-hotbar-slot').assetType, 'Slot');
    assert.equal(semanticById.get('family-hotbar-slot').role, 'ImageButton');

    const scopeGuard = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        projectKnowledge: 'Scope Guard Document',
        reviewTier: 'lite',
        families: [{
          ...family,
          id: 'scope-guard-family',
          fingerprint: `scope-guard-${runId}`,
          parentNames: ['OuterBorders'],
          hierarchyContext: [{
            parentName: 'OuterBorders',
            ancestorNames: ['HotbarSlot1', 'NumberHolder'],
            childNames: ['Layer1'],
            siblingNames: ['Layer2'],
          }],
          members: [{ ...family.members[0], name: 'Layer1' }],
        }],
      }),
    }).then((response) => response.json());
    assert.equal(scopeGuard.analyses[0].familyName, 'Outer Border 2');
    assert.equal(scopeGuard.analyses[0].memberNames[0].name, 'Outer Border 2');

    const contextLeakage = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        projectKnowledge: 'Context Leakage Family',
        reviewTier: 'lite',
        families: [
          {
            ...family,
            id: 'context-number-holder',
            fingerprint: `context-number-holder-${runId}`,
            parentNames: ['HotbarSlot1'],
            hierarchyContext: [{ parentName: 'HotbarSlot1', ancestorNames: [], childNames: ['OuterBorders'], siblingNames: ['SkillHolder'] }],
            reviewSignals: { localAssetType: 'Badge' },
            members: [{ ...family.members[0], name: 'NumberHolder' }],
          },
          {
            ...family,
            id: 'context-outer-borders',
            fingerprint: `context-outer-borders-${runId}`,
            parentNames: ['SkillHolder'],
            hierarchyContext: [{ parentName: 'SkillHolder', ancestorNames: [], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'OuterBorders' }],
          },
          {
            ...family,
            id: 'context-layer-one',
            fingerprint: `context-layer-one-${runId}`,
            parentNames: ['OuterBorders'],
            hierarchyContext: [{ parentName: 'OuterBorders', ancestorNames: ['SkillHolder'], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'Layer1' }],
          },
          {
            ...family,
            id: 'context-skill-holder',
            fingerprint: `context-skill-holder-${runId}`,
            parentNames: ['HotbarSlot1'],
            hierarchyContext: [{ parentName: 'HotbarSlot1', ancestorNames: [], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'SkillHolder' }],
          },
        ],
      }),
    }).then((response) => response.json());
    const contextLeakageById = new Map(contextLeakage.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(contextLeakageById.get('context-number-holder').familyName, 'Number Holder');
    assert.equal(contextLeakageById.get('context-number-holder').assetType, 'Badge');
    assert.equal(contextLeakageById.get('context-outer-borders').familyName, 'Outer Border');
    assert.equal(contextLeakageById.get('context-layer-one').familyName, 'Outer Border 1');
    assert.equal(contextLeakageById.get('context-skill-holder').familyName, 'Skill Slot');

    const insetPerimeterMetrics = {
      visiblePixelRatio: 0.28,
      opaquePixelRatio: 0.22,
      meanAlpha: 0.25,
      edgeVisibleRatio: 0.01,
      centerVisibleRatio: 0.22,
      innerVisibleRatio: 0.01,
      contentPerimeterVisibleRatio: 0.24,
      contentPerimeterCoverage: 0.86,
    };
    const insetPerimeterGuard = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        projectKnowledge: 'Inset Perimeter Type Guard',
        reviewTier: 'lite',
        families: [
          {
            ...family,
            id: 'inset-model-border',
            fingerprint: `inset-model-border-${runId}`,
            parentNames: ['Frames'],
            hierarchyContext: [{ parentName: 'Frames', ancestorNames: ['RegularSlot'], childNames: [], siblingNames: [] }],
            reviewSignals: { localAssetType: 'Frame', localRole: 'Frame' },
            members: [{ ...family.members[0], visualHash: 'inset-model-border-hash', name: 'MainFrameOuterLayers', visualMetrics: insetPerimeterMetrics }],
          },
          {
            ...family,
            id: 'inset-model-frame',
            fingerprint: `inset-model-frame-${runId}`,
            parentNames: ['Frames'],
            hierarchyContext: [{ parentName: 'Frames', ancestorNames: ['RegularSlot'], childNames: [], siblingNames: [] }],
            reviewSignals: { localAssetType: 'Frame', localRole: 'Frame' },
            members: [{ ...family.members[0], visualHash: 'inset-model-frame-hash', name: 'OuterLayers', visualMetrics: insetPerimeterMetrics }],
          },
        ],
      }),
    }).then((response) => response.json());
    const insetById = new Map(insetPerimeterGuard.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(insetById.get('inset-model-border').assetType, 'Border', 'a target word such as Frame must not undo a correct visual Border result');
    assert.equal(insetById.get('inset-model-border').role, 'ImageLabel');
    assert.equal(insetById.get('inset-model-border').modelAssetType, 'Border');
    assert.equal(insetById.get('inset-model-frame').assetType, 'Border', 'content-relative perimeter geometry must correct a hosted Frame result');
    assert.equal(insetById.get('inset-model-frame').role, 'ImageLabel');
    assert.equal(insetById.get('inset-model-frame').modelAssetType, 'Frame');
    assert.match(insetById.get('inset-model-frame').normalizationReason, /hollow perimeter/i);
    assert.equal(insetById.get('inset-model-frame').reviewNeeded, true);

    const largeFamilies = Array.from({ length: 1000 }, (_, index) => ({
      ...family,
      id: `large-family-${index}`,
      fingerprint: `large-${runId}-${index}`,
      members: [{
        ...family.members[0],
        id: `large-member-${index}`,
        visualHash: `large-hash-${index}`,
        name: `Large Layer ${index + 1}`,
      }],
    }));
    const largeScanId = `large-cloud-scan-${runId}`;
    const largeAnalyses = [];
    const largeSkipped = [];
    let largeScan;
    for (let start = 0; start < largeFamilies.length; start += 16) {
      const batch = largeFamilies.slice(start, start + 16);
      largeScan = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          project: 'Test',
          documentTitle: 'Large Document',
          documentSessionUuid: 'large-session',
          hostedScanId: largeScanId,
          reviewTier: 'lite',
          maxMemberImages: 1,
          familyContactSheet: {
            previewUrl: VISION_PREVIEW,
            familyIds: batch.map((item) => item.id),
          },
          families: batch,
        }),
      }).then((response) => response.json());
      largeAnalyses.push(...largeScan.analyses);
      largeSkipped.push(...largeScan.skippedFamilyIds);
    }
    assert.equal(largeAnalyses.length, 1000, 'the cloud lane should cover a thousand-family document without a family-count cap');
    assert.deepEqual(largeSkipped, []);
    assert.equal(largeScan.budgetLimited, false);
    assert.ok(largeScan.scanProviderCostUsd > 0);
    assert.ok(largeScan.scanProviderCostUsd < 0.01, 'large cloud scans should expose their provider-reported spend');
    const boundedCacheHealth = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { headers })
      .then((response) => response.json());
    assert.ok(boundedCacheHealth.cacheEntries <= 1000, 'structured cache growth must remain bounded');
    assert.ok(boundedCacheHealth.cacheEvictions > 0, 'the cache should evict its oldest derived entries after reaching the configured cap');

    const nullableEvidence = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'escalation',
        families: [{
          ...family,
          id: 'null-evidence-family',
          fingerprint: `null-evidence-${runId}`,
          members: [{ ...family.members[0], name: 'Null Evidence Family' }],
        }],
      }),
    }).then((response) => response.json());
    assert.equal(nullableEvidence.analyses[0].confidence, 0);
    assert.equal(nullableEvidence.analyses[0].evidence, undefined);
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
        families: [{
          ...family,
          id: 'slow-family',
          fingerprint: `slow-${runId}`,
          members: [{ ...family.members[0], name: 'Slow Family' }],
        }],
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
