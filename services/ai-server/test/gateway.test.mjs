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
const PREVIEW = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAvElEQVR4nOXOMQEAIAzAsJqcFrSglsnIwZE/zbnvZ+mAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YC2QzFCOxSb7YEAAAAASUVORK5CYII=';
const VISION_PREVIEW = PREVIEW;

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

function modelResponse(prompt, state = {}) {
  const familyIds = [...new Set(
    [
      ...[...prompt.matchAll(/\\"familyId\\":\\"([^"\\]+)\\"/g)].map((match) => match[1]),
      ...[...prompt.matchAll(/Observe family ([^.\s]+)\./g)].map((match) => match[1]),
    ],
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
      text: 'Hello from the test assistant.',
      memories: [],
      actions: [{ type: 'open-component-scan', label: 'Review document', description: 'Open Component Scan.' }],
      visionUsed: true,
    };
  }
  if (prompt.includes('on demand.') && prompt.includes('Inspect the supplied image and metadata')) {
    if (prompt.includes('Audit Missing Replacement')) {
      if (prompt.includes('first audit rejected')) {
        return {
          q: 'The compact visual is a decorative emblem rather than a runtime panel.',
          v: 'A self-contained ornamental marker with a solid central motif.',
          c: 0.91,
          e: [0.93, 0.2, 0.3, 0],
          ok: false,
          x: true,
          xm: 'The chosen Panel type conflicts with the standalone emblem artwork.',
          st: 'Badge',
          sr: 'ImageLabel',
          sn: 'Sample Marker Badge',
        };
      }
      return {
        q: 'The compact visual is a decorative emblem rather than a runtime panel.',
        v: 'A self-contained ornamental marker with a solid central motif.',
        c: 0.91,
        e: [0.93, 0.2, 0.3, 0],
        ok: false,
        x: true,
        xm: 'The chosen Panel type conflicts with the standalone emblem artwork.',
      };
    }
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
    if (prompt.includes('Audit Same Type Rename')) {
      return {
        q: 'The source identity is compatible, while the proposed adjective and compound subtype are unsupported.',
        v: 'A thin horizontal status bar.',
        c: 0.92,
        e: [0.92, 0.75, 0.2, 0],
        ok: true,
        x: false,
        xm: '',
        st: 'Bar',
        sr: 'ImageLabel',
        sn: 'Focus Bar',
      };
    }
    if (prompt.includes('Audit Unreadable Slot')) {
      return {
        q: 'The element is a tiny, nearly invisible artifact with negligible visible pixels, not a functional UI slot.',
        v: 'A nearly transparent fragment without a usable slot silhouette.',
        c: 0.9,
        e: [0.01, 0, 0.01, 0],
        ok: true,
        x: false,
        xm: '',
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
      layerName: 'PatternTexture',
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
      f: ids.map((familyId, index) => nullableEvidence
        ? {
            id: familyId,
            n: overrides[index]?.name || 'Close Button',
            t: overrides[index]?.type || 'Button',
            r: overrides[index]?.role || 'ImageButton',
            d: 0,
            c: 0,
            e: [null, null, null, null],
            rv: true,
          }
        : [
            familyId,
            index,
            overrides[index]?.type || 'Button',
            overrides[index]?.name || 'Close Button',
            overrides[index]?.uncertain ? 1 : 0,
            0,
            overrides[index]?.role || 'ImageButton',
          ]),
    };
  };
  if (prompt.includes('Final Single Recovery Family')) {
    state.finalSingleRecoveryCalls = Number(state.finalSingleRecoveryCalls || 0) + 1;
    if (requestedIds.length > 1) {
      const returnedIds = requestedIds.slice(0, -1);
      return compactPacket(returnedIds, returnedIds.map(() => ({ name: 'Recovered Button', type: 'Button' })));
    }
    if (state.finalSingleRecoveryCalls === 2) return { unexpected: true };
    return compactPacket(requestedIds, [{ name: 'Final Recovered Button', type: 'Button' }]);
  }
  if (prompt.includes('Partial Recovery Family')) {
    const returnedIds = requestedIds.length > 1 ? requestedIds.slice(0, -1) : requestedIds;
    return compactPacket(returnedIds, returnedIds.map(() => ({ name: 'Recovered Button', type: 'Button' })));
  }
  if (prompt.includes('Scope Guard Document')) {
    return compactPacket(requestedIds, [{ name: 'Sample Cell Anchor Border 2', type: 'Border' }]);
  }
  if (prompt.includes('Context Leakage Family')) {
    return compactPacket(requestedIds, [
      { name: 'Action Cell Slot', type: 'Slot' },
      { name: 'Action Cell Borders', type: 'Border' },
      { name: 'Action Cell Border 1', type: 'Border' },
      { name: 'Action Cell Slot', type: 'Slot' },
    ]);
  }
  if (prompt.includes('Save Naming Contract Family')) {
    return compactPacket(requestedIds, [{ name: 'Accent Corner Border', type: 'Border' }]);
  }
  if (prompt.includes('Inset Perimeter Type Guard')) {
    return compactPacket(requestedIds, [
      { name: 'Panel Accent Border', type: 'Border', role: 'ImageLabel' },
      { name: 'Frame', type: 'Frame', role: 'Frame' },
    ]);
  }
  if (prompt.includes('CenterMarker')) {
    const semantic = [
      { name: 'Status Bar', type: 'Bar', role: 'ImageLabel' },
      { name: 'Center Badge', type: 'Badge', role: 'ImageLabel' },
      { name: 'Anchor Badge', type: 'Badge', role: 'ImageLabel' },
      { name: 'Sample Cell Slot', type: 'Slot', role: 'ImageButton' },
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
  const modelRequests = [];
  let activeModelCalls = 0;
  let maxActiveModelCalls = 0;
  const modelState = {};
  const model = http.createServer(async (request, response) => {
    modelCalls += 1;
    activeModelCalls += 1;
    maxActiveModelCalls = Math.max(maxActiveModelCalls, activeModelCalls);
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const usesResponses = request.url === '/v1/responses';
      const requestInput = usesResponses ? body.input || [] : body.messages || [];
      modelRequests.push(body);
      modelNames.push(body.model);
      modelImageCounts.push((JSON.stringify(requestInput).match(/\"type\":\"(?:image_url|input_image)\"/g) || []).length);
      const prompt = JSON.stringify(requestInput);
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
      let content;
      if (prompt.includes('Protocol Retry Family') && prompt.includes('Return the compact packet')) {
        modelState.protocolRetryCalls = Number(modelState.protocolRetryCalls || 0) + 1;
        content = modelState.protocolRetryCalls === 1
          ? 'The decision packet was accidentally omitted.'
          : `${JSON.stringify(modelResponse(prompt, modelState))}\n{"trailing":true}`;
      } else {
        content = `${JSON.stringify(modelResponse(prompt, modelState))}\n{"trailing":true}`;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(usesResponses ? {
        output: [{ content: [{ type: 'output_text', text: content }] }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          cost: 0.0001,
        },
      } : {
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
      KRYEO_AI_MODEL_LITE: 'test-vision-model',
      KRYEO_AI_MODEL_ESCALATION: 'test-vision-model',
      KRYEO_MODEL_TRANSPORT: 'responses',
      KRYEO_MODEL_API_KEY: 'test-gateway-key',
      KRYEO_AI_ALLOW_LOOPBACK_WITHOUT_TOKEN: 'false',
      KRYEO_AI_RATE_LIMIT_PER_MINUTE: '1000',
      KRYEO_AI_MODEL_CONCURRENCY: '2',
      KRYEO_AI_MAX_INFLIGHT_PER_TOKEN: '2',
      KRYEO_AI_MAX_MODEL_RETRIES: '1',
      KRYEO_AI_SCAN_TARGET_USD: '0.01',
      KRYEO_AI_SCAN_BUDGET_USD: '0.03',
      KRYEO_AI_ENFORCE_SCAN_BUDGET: 'true',
      KRYEO_AI_LITE_INPUT_PRICE_PER_MILLION: '0',
      KRYEO_AI_LITE_OUTPUT_PRICE_PER_MILLION: '0',
      KRYEO_AI_ESCALATION_INPUT_PRICE_PER_MILLION: '0',
      KRYEO_AI_ESCALATION_OUTPUT_PRICE_PER_MILLION: '0',
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
    assert.equal(health.familyBatchSize, 8);
    assert.equal(health.maxMemberImagesPerFamily, 2);
    assert.equal(health.modelLite, 'test-vision-model');
    assert.equal(health.modelEscalation, 'test-vision-model');
    assert.equal(health.modelTransport, 'responses');
    assert.equal(health.providerSort, 'price');
    assert.equal(health.responseCacheEnabled, false);
    assert.equal(health.maxInflightPerToken, 2);
    assert.equal(health.scanTargetUsd, 0.01);
    assert.equal(health.scanBudgetUsd, 0.03);
    assert.equal(health.scanBudgetEnforced, true);
    assert.equal(health.liteInputPricePerMillion, 0);
    assert.equal(health.liteOutputPricePerMillion, 0);
    assert.equal(health.costEstimateSafetyFactor, 2);
    assert.equal(health.maxHostedFamiliesPerScan, 0);
    assert.equal(health.analysisVersion, 'family-v70');
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
        previewUrl: PREVIEW,
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
    assert.equal(first.analyses[0].visualDescription, 'The supplied preview was classified visually as button.');
    assert.equal(first.analyses[0].confidence, 0.86);
    assert.equal(first.analyses[0].evidence, undefined);
    assert.equal(first.analyses[0].conflict, false);
    assert.equal(first.analyses[0].reviewNeeded, false);
    assert.equal(first.cached, 0);
    assert.match(
      modelPrompts.at(-1),
      /\bjson\b/i,
      'Every Responses API request must keep JSON instructions in the prompt.',
    );
    assert.deepEqual(
      modelRequests.at(-1).text?.format,
      { type: 'json_object' },
      'Responses calls must request JSON mode explicitly.',
    );
    assert.deepEqual(
      modelRequests.at(-1).reasoning,
      { effort: 'minimal' },
      'Responses calls must reserve output tokens for the completed JSON packet.',
    );
    assert.equal(
      modelPrompts.at(-1).includes('Every row is [alias,unused,type,name'),
      true,
      'The primary request must use one compact schema rather than conflicting packet formats.',
    );
    assert.ok(
      modelRequests.at(-1).max_output_tokens >= 700,
      'Responses calls need output room beyond hidden minimal reasoning to emit the complete packet.',
    );

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

    const reviewFamilies = Array.from({ length: 8 }, (_, index) => ({
      ...family,
      id: `batch-review-${index + 1}`,
      fingerprint: `batch-review-fingerprint-${runId}-${index + 1}`,
      members: [{
        ...family.members[0],
        id: `batch-review-member-${index + 1}`,
        visualHash: `batch-review-hash-${index + 1}`,
        name: `Layer${index + 1}`,
        hierarchyKey: `4.${index + 1}`,
      }],
    }));
    const reviewCallsBefore = modelCalls;
    const batchReview = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        hostedScanId: `batch-review-scan-${runId}`,
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        families: reviewFamilies,
        currentAnalyses: reviewFamilies.map((item) => ({
          familyId: item.id,
          familyName: 'Uncertain Frame',
          assetType: 'Frame',
          role: 'Frame',
          memberNames: [],
          diveMode: 'keep-together',
          reason: 'Primary decision.',
          reviewNeeded: true,
          alternatives: [],
        })),
        challengeReasons: Object.fromEntries(reviewFamilies.map((item) => [item.id, ['Name/type evidence disagrees.']])),
      }),
    }).then((response) => response.json());
    assert.equal(batchReview.analyses.length, 8);
    assert.equal(batchReview.failures.length, 0);
    assert.equal(modelCalls - reviewCallsBefore, 1, 'Eight challenged families must share one visual-review provider call.');
    assert.equal(modelNames.at(-1), 'test-vision-model', 'The independent reviewer should use the configured visual model.');

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

    const sameTypeRenameAudit = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...evidenceRequest,
        familyFingerprint: `audit-same-type-rename-${runId}`,
        visualHash: `audit-same-type-rename-hash-${runId}`,
        familyName: 'Decorative Scroll Bar',
        assetType: 'Bar',
        role: 'ImageLabel',
        sourceName: 'Audit Same Type Rename',
      }),
    }).then((response) => response.json());
    assert.equal(sameTypeRenameAudit.supportsClassification, false, 'A reviewer rename must be emitted as a complete replacement even when type is unchanged.');
    assert.equal(sameTypeRenameAudit.conflict, true);
    assert.equal(sameTypeRenameAudit.suggestedType, 'Bar');
    assert.equal(sameTypeRenameAudit.suggestedRole, 'ImageLabel');
    assert.equal(sameTypeRenameAudit.suggestedName, 'Focus Bar');

    const repairedEvidenceAudit = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...evidenceRequest,
        familyFingerprint: `audit-missing-replacement-${runId}`,
        visualHash: `audit-missing-replacement-hash-${runId}`,
        familyName: 'Sample Panel',
        assetType: 'Panel',
        role: 'ImageLabel',
        sourceName: 'Audit Missing Replacement',
      }),
    }).then((response) => response.json());
    assert.equal(repairedEvidenceAudit.supportsClassification, false);
    assert.equal(repairedEvidenceAudit.suggestedType, 'Badge');
    assert.equal(repairedEvidenceAudit.suggestedRole, 'ImageLabel');
    assert.equal(repairedEvidenceAudit.suggestedName, 'Sample Marker Badge');

    const contradictorySlotAudit = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...evidenceRequest,
        familyFingerprint: `audit-unreadable-slot-${runId}`,
        visualHash: `audit-unreadable-slot-hash-${runId}`,
        familyName: 'Regular Slot',
        assetType: 'Slot',
        role: 'Frame',
        sourceName: 'Audit Unreadable Slot',
      }),
    }).then((response) => response.json());
    assert.equal(contradictorySlotAudit.supportsClassification, false);
    assert.equal(contradictorySlotAudit.conflict, true);
    assert.equal(contradictorySlotAudit.confidence, 0.55);
    assert.match(contradictorySlotAudit.conflictMessage, /almost no supporting evidence/i);

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
    assert.equal(modelCalls - callsBeforeCoalescing, 1, 'identical concurrent misses should coalesce into one atomic visual-decision call');

    const second = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'Test', documentTitle: 'Document', documentSessionUuid: 'session', families: [family] }),
    }).then((response) => response.json());
    assert.equal(second.cached, 1, JSON.stringify({ first, second }));

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
    assert.equal(escalated.model, 'test-vision-model');
    assert.equal(modelNames.at(-1), 'test-vision-model');
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
    assert.equal(incomplete.analyses[0].familyName, 'Unlabelled visual');
    assert.equal(incomplete.analyses[0].assetType, 'Unknown');
    assert.equal(incomplete.analyses[0].role, 'Unknown');
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
    assert.equal(evidenceOnly.analyses[0].assetType, 'Unknown');
    assert.equal(evidenceOnly.analyses[0].role, 'Unknown');
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
    assert.equal(modelCalls - callsBeforeBatch, 1, 'a family batch should use one atomic visual-decision call');
    assert.equal(modelImageCounts.at(-1), 2, 'a Lite family batch should send each family preview in one atomic request');

    const callsBeforeProtocolRetry = modelCalls;
    const protocolRetry = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        hostedScanId: `protocol-retry-${runId}`,
        families: [{
          ...family,
          id: 'protocol-retry-family',
          fingerprint: `protocol-retry-${runId}`,
          members: [{ ...family.members[0], name: 'Protocol Retry Family' }],
        }],
      }),
    }).then((response) => response.json());
    assert.equal(protocolRetry.analyses.length, 1, JSON.stringify(protocolRetry));
    assert.equal(protocolRetry.failures.length, 0, JSON.stringify(protocolRetry));
    assert.equal(modelCalls - callsBeforeProtocolRetry, 2, 'an invalid decision packet must retry its atomic visual decision once');

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
        families: sixteenIds.map((id, index) => ({
          ...family,
          id,
          fingerprint: `${id}-${runId}`,
          members: [{ ...family.members[0], visualHash: `${id}-hash`, name: `Simple Visual ${index + 1}` }],
        })),
      }),
    }).then((response) => response.json());
    assert.equal(sixteenFamilyBatch.analyses.length, 16, JSON.stringify(sixteenFamilyBatch));
    assert.equal(modelCalls - callsBeforeSixteen, 2, 'sixteen families should use two schema-reliable eight-family decisions');
    assert.equal(modelImageCounts.at(-1), 8, 'each schema-reliable batch should preserve eight direct family previews');

    const callsBeforeShiftedBatch = modelCalls;
    const shiftedBatch = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'lite',
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
    assert.equal(modelImageCounts.at(-1), 2, 'cached families must not remove or misalign the remaining direct previews');

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
        families: partialBatchIds.map((id, index) => ({
          ...family,
          id,
          fingerprint: `${id}-${runId}`,
          members: [{ ...family.members[0], name: `Partial Recovery Family ${index + 1}` }],
        })),
      }),
    }).then((response) => response.json());
    assert.equal(partialBatch.analyses.length, 2);
    assert.deepEqual(new Set(partialBatch.analyses.map((item) => item.familyId)), new Set(partialBatchIds.slice(0, -1)));
    assert.equal(modelCalls - callsBeforePartialBatch, 1, 'A partial packet must not fan out into per-family provider retries.');
    assert.equal(partialBatch.recovery.partialBatchResponses, 1);
    assert.equal(partialBatch.recovery.batchRecoveries, 0);
    assert.equal(partialBatch.recovery.recoveryFamilies, 0);
    assert.equal(partialBatch.recovery.singleFamilyRecoveries, 0);
    assert.deepEqual(partialBatch.failures.map((failure) => failure.familyIds), [[partialBatchIds.at(-1)]]);

    const callsBeforeFinalSingleRecovery = modelCalls;
    const finalRecoveryIds = ['final-recovery-one', 'final-recovery-two', 'final-recovery-three'];
    const finalSingleRecovery = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        reviewTier: 'lite',
        families: finalRecoveryIds.map((id, index) => ({
          ...family,
          id,
          fingerprint: `${id}-${runId}`,
          members: [{ ...family.members[0], name: `Final Single Recovery Family ${index + 1}` }],
        })),
      }),
    }).then((response) => response.json());
    assert.equal(finalSingleRecovery.analyses.length, 2);
    assert.deepEqual(new Set(finalSingleRecovery.analyses.map((item) => item.familyId)), new Set(finalRecoveryIds.slice(0, -1)));
    assert.equal(modelCalls - callsBeforeFinalSingleRecovery, 1, 'A persistently omitted alias must remain unresolved instead of triggering a retry cascade.');
    assert.equal(finalSingleRecovery.recovery.singleFamilyRecoveryAttempts, 0);
    assert.equal(finalSingleRecovery.recovery.singleFamilyRecoveries, 0);
    assert.equal(finalSingleRecovery.recovery.singleFamilyFailures, 0);
    assert.equal(finalSingleRecovery.scanProviderRequests, 1, 'provider accounting must reflect the bounded batch request.');
    assert.deepEqual(finalSingleRecovery.failures.map((failure) => failure.familyIds), [[finalRecoveryIds.at(-1)]]);

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
            id: 'family-meter',
            fingerprint: `meter-${runId}`,
            members: [{ ...family.members[0], name: 'StatusMeter' }],
          },
          {
            ...family,
            id: 'family-marker',
            fingerprint: `marker-${runId}`,
            members: [{ ...family.members[0], name: 'CenterMarker' }],
          },
          {
            ...family,
            id: 'family-anchor',
            fingerprint: `anchor-${runId}`,
            members: [{ ...family.members[0], name: 'BadgeAnchor' }],
          },
          {
            ...family,
            id: 'family-sample-cell',
            fingerprint: `sample-cell-${runId}`,
            members: [{ ...family.members[0], name: 'SampleCell1' }],
          },
        ],
      }),
    }).then((response) => response.json());
    const semanticById = new Map(semanticFamilies.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(semanticById.get('family-meter').familyName, 'Status Bar');
    assert.equal(semanticById.get('family-meter').assetType, 'Bar');
    assert.equal(semanticById.get('family-meter').role, 'ImageLabel');
    assert.equal(semanticById.get('family-marker').familyName, 'Center Badge');
    assert.equal(semanticById.get('family-marker').assetType, 'Badge');
    assert.equal(semanticById.get('family-marker').role, 'ImageLabel');
    assert.equal(semanticById.get('family-anchor').familyName, 'Anchor Badge');
    assert.equal(semanticById.get('family-anchor').assetType, 'Badge');
    assert.equal(semanticById.get('family-anchor').role, 'ImageLabel');
    assert.equal(semanticById.get('family-sample-cell').familyName, 'Sample Cell Slot');
    assert.equal(semanticById.get('family-sample-cell').assetType, 'Slot');
    assert.equal(semanticById.get('family-sample-cell').role, 'ImageButton');

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
          parentNames: ['BorderAssembly'],
          hierarchyContext: [{
            parentName: 'BorderAssembly',
            ancestorNames: ['SampleCell1', 'BadgeAnchor'],
            childNames: ['Layer1'],
            siblingNames: ['Layer2'],
          }],
          members: [{ ...family.members[0], name: 'Layer1' }],
        }],
      }),
    }).then((response) => response.json());
    assert.equal(scopeGuard.analyses[0].familyName, 'Sample Cell Anchor Border 2');
    assert.equal(scopeGuard.analyses[0].memberNames[0].name, 'Sample Cell Anchor Border 2');

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
            id: 'context-badge-anchor',
            fingerprint: `context-badge-anchor-${runId}`,
            parentNames: ['SampleCell1'],
            hierarchyContext: [{ parentName: 'SampleCell1', ancestorNames: [], childNames: ['BorderAssembly'], siblingNames: ['ActionContainer'] }],
            reviewSignals: { localAssetType: 'Badge' },
            members: [{ ...family.members[0], name: 'BadgeAnchor' }],
          },
          {
            ...family,
            id: 'context-border-assembly',
            fingerprint: `context-border-assembly-${runId}`,
            parentNames: ['ActionContainer'],
            hierarchyContext: [{ parentName: 'ActionContainer', ancestorNames: [], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'BorderAssembly' }],
          },
          {
            ...family,
            id: 'context-layer-one',
            fingerprint: `context-layer-one-${runId}`,
            parentNames: ['BorderAssembly'],
            hierarchyContext: [{ parentName: 'BorderAssembly', ancestorNames: ['ActionContainer'], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'Layer1' }],
          },
          {
            ...family,
            id: 'context-action-container',
            fingerprint: `context-action-container-${runId}`,
            parentNames: ['SampleCell1'],
            hierarchyContext: [{ parentName: 'SampleCell1', ancestorNames: [], childNames: [], siblingNames: [] }],
            members: [{ ...family.members[0], name: 'ActionContainer' }],
          },
        ],
      }),
    }).then((response) => response.json());
    const contextLeakageById = new Map(contextLeakage.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(contextLeakageById.get('context-badge-anchor').familyName, 'Action Cell Slot');
    assert.equal(contextLeakageById.get('context-badge-anchor').assetType, 'Slot');
    assert.equal(contextLeakageById.get('context-border-assembly').familyName, 'Action Cell Borders');
    assert.equal(contextLeakageById.get('context-layer-one').familyName, 'Action Cell Border 1');
    assert.equal(contextLeakageById.get('context-action-container').familyName, 'Action Cell Slot');

    const saveNamingContract = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/families/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'Test',
        documentTitle: 'Document',
        documentSessionUuid: 'session',
        projectKnowledge: 'Save Naming Contract Family',
        reviewTier: 'lite',
        families: [{
          ...family,
          id: 'save-naming-contract',
          fingerprint: `save-naming-contract-${runId}`,
          members: [{ ...family.members[0], name: 'AccentCornerHover' }],
        }],
      }),
    }).then((response) => response.json());
    assert.equal(saveNamingContract.analyses[0].assetType, 'Border');
    assert.equal(saveNamingContract.analyses[0].familyName, 'Accent Corner Border');
    assert.equal(saveNamingContract.analyses[0].memberNames[0].name, 'Accent Corner Border');

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
            members: [{ ...family.members[0], visualHash: 'inset-model-border-hash', name: 'PanelFrameLayers', visualMetrics: insetPerimeterMetrics }],
          },
          {
            ...family,
            id: 'inset-model-frame',
            fingerprint: `inset-model-frame-${runId}`,
            parentNames: ['Frames'],
            hierarchyContext: [{ parentName: 'Frames', ancestorNames: ['RegularSlot'], childNames: [], siblingNames: [] }],
            reviewSignals: { localAssetType: 'Frame', localRole: 'Frame' },
            members: [{ ...family.members[0], visualHash: 'inset-model-frame-hash', name: 'FrameLayers', visualMetrics: insetPerimeterMetrics }],
          },
        ],
      }),
    }).then((response) => response.json());
    const insetById = new Map(insetPerimeterGuard.analyses.map((analysis) => [analysis.familyId, analysis]));
    assert.equal(insetById.get('inset-model-border').assetType, 'Border', 'a target word such as Frame must not undo a correct visual Border result');
    assert.equal(insetById.get('inset-model-border').role, 'ImageLabel');
    assert.equal(insetById.get('inset-model-border').modelAssetType, 'Border');
    assert.equal(insetById.get('inset-model-frame').assetType, 'Frame', 'the gateway must not rewrite only the hosted type after the visual decision');
    assert.equal(insetById.get('inset-model-frame').role, 'Frame');
    assert.equal(insetById.get('inset-model-frame').modelAssetType, 'Frame');
    assert.equal(insetById.get('inset-model-frame').normalizationReason, undefined);

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
    assert.ok(largeScan.scanProviderCostUsd < 0.03, 'large cloud scans should expose provider spend within the configured ceiling');
    const boundedCacheHealth = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { headers })
      .then((response) => response.json());
    assert.ok(boundedCacheHealth.cacheEntries <= 1000, 'structured cache growth must remain bounded');
    assert.ok(boundedCacheHealth.cacheEvictions > 0, 'the cache should evict its oldest derived entries after reaching the configured cap');
    const clearedCache = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/cache/clear`, {
      method: 'POST',
      headers,
    }).then((response) => response.json());
    assert.deepEqual(clearedCache, { cleared: true, analysisVersion: 'family-v70', cacheEntries: 0 });
    const clearedCacheHealth = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { headers })
      .then((response) => response.json());
    assert.equal(clearedCacheHealth.cacheEntries, 0, 'cache clearing must remove derived decisions before the next scan');

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
    assert.equal(chat.text, 'Hello from the test assistant.');
    assert.equal(chat.actions[0].type, 'open-component-scan');
  } finally {
    gateway.kill();
    await close(model);
    await fs.rm(path.resolve(`.test-data-${runId}`), { recursive: true, force: true });
  }
});
