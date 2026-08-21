import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { AffinityService } from './affinity-service';
import { LibraryService } from './library-service';
import { ConnectorService } from './connector-service';
import { WorkspaceService } from './workspace-service';
import { buildComponentScan, removeScanDirectory, resetScanDirectory } from './component-scan-service';
import { LocalAiService, roleForAssetType } from './local-ai-service';
import { HostedAiService } from './hosted-ai-service';
import { applyComponentIntelligence } from './component-intelligence-service';
import { applyComponentSceneContext, componentCategory, componentSubcategory } from './component-context-service';
import { applyScanIntent, normalizeScanIntent, scanIntentContext, structureFingerprint } from './scan-intent-service';
import { buildProductionIdentity } from './asset-intelligence-service';
import { DeveloperLogService } from './developer-log-service';
import {
  applyApprovedFamilies,
  applyAssetBoundaries,
  applyHostedFamilyAnalyses,
  buildVisualFamilies,
  countLocallyHandledFamilies,
  familyBatchConsistencyIssues,
  familyDecisionConsistencyIssues,
  planHostedFamilyReview,
  requiresIndependentFamilyReview,
  resolveIndependentFamilyAnalysis,
  reviewCategory,
  visualStructureAnchor,
} from './component-family-service';
import {
  AssistantService,
  shouldUseAssistantVision,
  type AssistantModelPack,
} from './assistant-service';
import type { AssistantVisualContext } from './assistant-service';
import type {
  ApplyComponentOrganizationRequest,
  ApplyLayerNamesRequest,
  AssistantChatRequest,
  AssistantMessage,
  AssetPreference,
  ComponentCandidate,
  ComponentScanDiagnostics,
  CreateComponentAssetsRequest,
  ComponentScanRequest,
  ComponentScanMode,
  ComponentDecision,
  ComponentVisualFamily,
  ConfiguredToolRequest,
  HostedAiConfiguration,
  HostedAiStatus,
  HostedFamilyAnalysisRequest,
  HostedFamilyEvidenceRequest,
  HostedReviewTier,
  PlaceAssetRequest,
  SaveAssetRequest,
  SaveComponentReviewRequest,
  ScanIntentProfile,
  SaveProjectNoteRequest,
  ScriptRunResult,
  WorkflowPreset,
} from '../shared/types';

function prepareComponentsForReview(components: ComponentCandidate[]): ComponentCandidate[] {
  // Scene context may refine generic child names and construction types. Run
  // the structural/review pass on both sides so triage reflects the values the
  // user actually sees rather than the pre-context hosted packet.
  const structurallyAssessed = applyComponentIntelligence(components, false);
  applyComponentSceneContext(structurallyAssessed);
  return applyAssetBoundaries(applyComponentIntelligence(structurallyAssessed, false));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const library = new LibraryService(() => app.getPath('userData'));
const affinity = new AffinityService(() => library.storagePaths());
const connectors = new ConnectorService();
const workspace = new WorkspaceService(() => app.getPath('userData'));
const localAi = new LocalAiService();
const assistant = new AssistantService(() => app.getPath('userData'));
const hostedAi = new HostedAiService(() => app.getPath('userData'));
const developerLogger = new DeveloperLogService(() => app.getPath('logs'));
const execFileAsync = promisify(execFile);
const LOCAL_CONTEXT_MAX_VISUALS = Math.max(0, Number(process.env.KRYEO_LOCAL_CONTEXT_MAX_VISUALS || 160));
const activeComponentScans = new Map<number, AbortController>();

process.on('unhandledRejection', (reason) => {
  developerLogger.record('error', 'process', 'unhandled-rejection', 'Unhandled promise rejection.', { reason });
});
process.on('uncaughtExceptionMonitor', (error, origin) => {
  developerLogger.record('error', 'process', 'uncaught-exception', 'Uncaught exception observed.', { error, origin });
});

interface HostedScanCandidate {
  family: ComponentVisualFamily;
  tier: HostedReviewTier;
  riskScore: number;
  reasons: string[];
}

interface HostedScanSelection {
  candidates: HostedScanCandidate[];
  selected: HostedScanCandidate[];
  /** Families resolved without a cloud request in the current availability path. */
  localCount: number;
  budgetLimitedCount: number;
  estimatedCostUsd: number;
}

function estimateHostedFamilyCost(status: HostedAiStatus, tier: HostedReviewTier): number {
  const inputPrice = tier === 'escalation'
    ? Number(status.escalationInputPricePerMillion ?? 0.03)
    : Number(status.liteInputPricePerMillion ?? 0.03);
  const outputPrice = tier === 'escalation'
    ? Number(status.escalationOutputPricePerMillion ?? 0.13)
    : Number(status.liteOutputPricePerMillion ?? 0.13);
  const imageCount = tier === 'escalation' ? 2 : 1;
  const inputTokens = (
    Number(status.estimatedTextTokensPerFamily || 260)
    + imageCount * Number(status.estimatedInputTokensPerImage || 300)
  );
  const outputTokens = Number(status.estimatedOutputTokensPerFamily || 40);
  const safetyFactor = Math.max(1, Number(status.costEstimateSafetyFactor || 1));
  return ((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000) * safetyFactor;
}

function selectHostedFamilies(
  families: ComponentVisualFamily[],
  status: HostedAiStatus,
): HostedScanSelection {
  const plans = families
    .filter((family) => !family.approvedDecision)
    .map((family) => {
      const plan = planHostedFamilyReview(family);
      return { family, ...plan };
    });
  // Cloud Qwen is the final classifier for every unresolved family.
  // Clear local plans still use Lite so the local pass remains a cheap source
  // of grouping/context signals rather than silently becoming the final AI.
  const candidates: HostedScanCandidate[] = plans.map((plan) => ({
    family: plan.family,
    tier: plan.tier === 'local' ? 'lite' : plan.tier,
    riskScore: plan.riskScore,
    reasons: plan.tier === 'local'
      ? [...plan.reasons, 'Cloud review is enabled for every unresolved family; Lite is used for this locally clear candidate.']
      : plan.reasons,
  }));
  const maxEscalations = Math.max(0, Number(status.maxEscalationFamiliesPerScan ?? 1));
  const selected: HostedScanCandidate[] = [];
  let escalationCount = 0;
  let estimatedCostUsd = 0;
  const ordered = [...candidates].sort((left, right) => (
    right.riskScore - left.riskScore
    || (left.tier === 'escalation' ? -1 : 1)
  ));
  for (const candidate of ordered) {
    // Reserve the more capable model for the highest-risk family, but do not
    // discard additional escalation candidates when the configured escalation
    // cap is reached. The Lite reviewer is still safer than leaving a family
    // with an Unknown provisional result. The gateway performs cache lookup
    // first, then enforces the shared per-scan dollar ceiling.
    const selectedTier: HostedReviewTier = candidate.tier === 'escalation' && escalationCount >= maxEscalations
      ? 'lite'
      : candidate.tier;
    const selectedCandidate: HostedScanCandidate = selectedTier === candidate.tier
      ? candidate
      : {
          ...candidate,
          tier: selectedTier,
          reasons: [
            ...candidate.reasons,
            'The escalation slot was reserved for a higher-risk family; Lite review is used for this additional candidate.',
          ],
    };
    const estimate = estimateHostedFamilyCost(status, selectedTier);
    // Send every unresolved family to the gateway. It performs cache lookup
    // before reserving paid work, so filtering here would incorrectly exclude
    // free cache hits on large documents.
    selected.push(selectedCandidate);
    estimatedCostUsd += estimate;
    if (selectedTier === 'escalation') escalationCount += 1;
  }
  return {
    candidates,
    selected,
    localCount: countLocallyHandledFamilies(families, true),
    budgetLimitedCount: 0,
    estimatedCostUsd,
  };
}

function safeHostedFailureMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || 'Cloud analysis failed.');
  if (/429|rate.?limit|insufficient_quota|provider.*busy/i.test(raw)) {
    return 'The cloud visual provider is temporarily busy; affected families remain unresolved and can be rescanned.';
  }
  if (/timed? out|did not answer within|safety limit|abort/i.test(raw)) {
    return 'A cloud visual batch did not finish in time; affected families remain unresolved and can be rescanned.';
  }
  if (/schema|json|complete decision|incomplete/i.test(raw)) {
    return 'The cloud response was incomplete, so Kryeo left the affected families unresolved instead of applying a partial decision.';
  }
  return 'Cloud analysis could not finish for the affected families; Kryeo left them unresolved rather than guessing.';
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function calibrateComponentConfidence(components: ComponentCandidate[], decisions: ComponentDecision[]): ComponentCandidate[] {
  const samples = decisions.reduce((total, decision) => total + (decision.confidenceSamples || 0), 0);
  const correct = decisions.reduce((total, decision) => total + (decision.confidenceCorrect || 0), 0);
  if (!samples) return components;
  const observedAccuracy = correct / samples;
  const weight = Math.min(0.75, samples / (samples + 12));
  return components.map((component) => {
    if (component.aiConfidence === undefined) return component;
    const confidence = component.aiConfidence * (1 - weight) + observedAccuracy * weight;
    const lowMargin = confidence < 0.72 && Boolean(component.analysisAlternatives?.length);
    return {
      ...component,
      aiConfidence: confidence,
      semanticConflict: component.semanticConflict || lowMargin,
      semanticConflictMessage: component.semanticConflictMessage
        || (lowMargin ? 'The leading interpretation is too close to another plausible type and needs review.' : undefined),
      analysisState: lowMargin ? 'needs-review' : component.analysisState,
    };
  });
}

async function buildAssistantVisualImages(rawPath: string, directory: string, profile: 'compatibility' | 'balanced' | 'enhanced'): Promise<AssistantVisualContext['images']> {
  const source = sharp(rawPath, { failOn: 'error' }).toColourspace('srgb').ensureAlpha();
  const metadata = await source.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const overviewPath = path.join(directory, 'document-overview.png');
  const overviewMaximum = profile === 'compatibility' ? 512 : 768;
  await source.clone().resize({ width: overviewMaximum, height: overviewMaximum, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 8 }).toFile(overviewPath);
  const images: AssistantVisualContext['images'] = [{ imagePath: overviewPath, label: `the full document overview (${width} x ${height})` }];
  if (width <= overviewMaximum * 1.25 && height <= overviewMaximum * 1.25) return images;

  const landscape = width / height >= 1.35;
  const portrait = height / width >= 1.35;
  const columns = landscape ? 3 : 2;
  const rows = portrait ? 3 : 2;
  const maximumTiles = profile === 'compatibility' ? 4 : 6;
  for (let row = 0; row < rows && images.length - 1 < maximumTiles; row += 1) {
    for (let column = 0; column < columns && images.length - 1 < maximumTiles; column += 1) {
      const cellLeft = Math.floor(column * width / columns);
      const cellTop = Math.floor(row * height / rows);
      const cellRight = Math.ceil((column + 1) * width / columns);
      const cellBottom = Math.ceil((row + 1) * height / rows);
      const overlapX = Math.round((cellRight - cellLeft) * 0.08);
      const overlapY = Math.round((cellBottom - cellTop) * 0.08);
      const left = Math.max(0, cellLeft - overlapX);
      const top = Math.max(0, cellTop - overlapY);
      const right = Math.min(width, cellRight + overlapX);
      const bottom = Math.min(height, cellBottom + overlapY);
      const tilePath = path.join(directory, `detail-${row + 1}-${column + 1}.png`);
      await source.clone().extract({ left, top, width: right - left, height: bottom - top })
        .resize({ width: profile === 'compatibility' ? 512 : 640, height: profile === 'compatibility' ? 512 : 640, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 8 }).toFile(tilePath);
      images.push({ imagePath: tilePath, label: `detail crop row ${row + 1}, column ${column + 1}` });
    }
  }
  return images;
}

async function sendAffinityKeys(keys: string, settleMilliseconds = 350): Promise<void> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Threading; public static class KryeoWin32 { [DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\\\"user32.dll\\\")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra); public static void Chord(byte modifier, byte key) { keybd_event(modifier, 0, 0, UIntPtr.Zero); Thread.Sleep(30); keybd_event(key, 0, 0, UIntPtr.Zero); Thread.Sleep(30); keybd_event(key, 0, 2, UIntPtr.Zero); keybd_event(modifier, 0, 2, UIntPtr.Zero); } }'"`,
    `$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -like 'Affinity*' } | Select-Object -First 1`,
    `if (-not $p) { throw 'Affinity window not found.' }`,
    '[KryeoWin32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null',
    '[Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) | Out-Null',
    '[KryeoWin32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null',
    'Start-Sleep -Milliseconds 220',
    `$keys = ${JSON.stringify(keys)}`,
    `switch ($keys) { '^c' { [KryeoWin32]::Chord(0x11, 0x43) } '^v' { [KryeoWin32]::Chord(0x11, 0x56) } '^{TAB}' { [KryeoWin32]::Chord(0x11, 0x09) } default { throw 'Unsupported key command.' } }`,
  ].join('; ');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 12_000 });
  await wait(settleMilliseconds);
}

async function affinityClipboardReady(): Promise<boolean> {
  const script = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetDataObject().GetFormats() | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000 });
  try {
    const parsed = JSON.parse(stdout.trim()) as string | string[];
    return (Array.isArray(parsed) ? parsed : [parsed]).includes('Affinity Nodes');
  } catch {
    return false;
  }
}

async function clearClipboard(): Promise<void> {
  const script = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()';
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000 });
}

async function focusAffinityDocument(sessionUuid: string): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const context = await affinity.getDocumentContext();
    if (context.open && context.sessionUuid === sessionUuid) return;
    await sendAffinityKeys('^{TAB}', 260);
  }
  throw new Error('Could not activate the requested Affinity document.');
}

async function transferPreparedLayer(
  sourceSessionUuid: string,
  targetSessionUuid: string,
  staged: boolean,
): Promise<void> {
  await focusAffinityDocument(sourceSessionUuid);
  await clearClipboard();
  await sendAffinityKeys('^c', staged ? 1100 : 700);
  if (!(await affinityClipboardReady())) throw new Error('Affinity did not copy the selected asset layer.');
  await focusAffinityDocument(targetSessionUuid);
  await sendAffinityKeys('^v', staged ? 3000 : 1000);
}

function preparedPlacement(output: string): {
  sourceSessionUuid: string;
  targetNodeCount: number;
  staged: boolean;
  expected: string;
  sourceVisibilities: boolean[];
} {
  const marker = 'KRYEO_PLACE_READY:';
  const index = output.lastIndexOf(marker);
  if (index < 0) return { sourceSessionUuid: '', targetNodeCount: 0, staged: false, expected: '', sourceVisibilities: [] };
  const line = output.slice(index + marker.length).split(/\r?\n/, 1)[0];
  try {
    const value = JSON.parse(line) as {
      sourceSessionUuid?: string;
      targetNodeCount?: number;
      staged?: boolean;
      expected?: string;
      sourceVisibilities?: unknown[];
    };
    return {
      sourceSessionUuid: String(value.sourceSessionUuid || ''),
      targetNodeCount: Number(value.targetNodeCount || 0),
      staged: value.staged === true,
      expected: String(value.expected || ''),
      sourceVisibilities: Array.isArray(value.sourceVisibilities) ? value.sourceVisibilities.map(Boolean) : [],
    };
  } catch {
    return { sourceSessionUuid: '', targetNodeCount: 0, staged: false, expected: '', sourceVisibilities: [] };
  }
}

function createWindow(): void {
  const qaWidth = app.isPackaged ? 0 : Number(process.env.KRYEO_QA_WIDTH || 0);
  const qaHeight = app.isPackaged ? 0 : Number(process.env.KRYEO_QA_HEIGHT || 0);
  const window = new BrowserWindow({
    width: qaWidth >= 980 ? qaWidth : 1480,
    height: qaHeight >= 680 ? qaHeight : 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#111312',
    title: 'Kryeo',
    icon: path.join(app.getAppPath(), 'build-icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111312',
      symbolColor: '#e8ece9',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    developerLogger.record('debug', 'renderer', 'console-message', 'Renderer console message.', {
      level,
      message,
      line,
      sourceId,
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    developerLogger.record('error', 'renderer', 'process-gone', 'Renderer process exited unexpectedly.', details);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    developerLogger.record('error', 'renderer', 'load-failed', 'Renderer navigation failed.', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function summarizeDeveloperHandlerResult(channel: string, result: unknown): unknown {
  if (!['kryeo:set-developer-mode', 'kryeo:get-developer-log', 'kryeo:clear-developer-log'].includes(channel)) return result;
  if (!result || typeof result !== 'object') return result;
  const snapshot = result as { enabled?: unknown; entries?: unknown[]; filePath?: unknown };
  return {
    enabled: snapshot.enabled === true,
    entryCount: Array.isArray(snapshot.entries) ? snapshot.entries.length : 0,
    filePath: typeof snapshot.filePath === 'string' ? snapshot.filePath : '',
  };
}

const nativeIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = ((channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => nativeIpcHandle(
  channel,
  async (event, ...args) => {
    const startedAt = Date.now();
    const captureRequest = channel !== 'kryeo:clear-developer-log';
    const captureResult = channel !== 'kryeo:get-developer-log' && channel !== 'kryeo:clear-developer-log';
    if (captureRequest) {
      developerLogger.record('debug', 'ipc', 'request', `IPC request: ${channel}`, { channel, args });
    }
    try {
      const result = await listener(event, ...args);
      if (captureResult) {
        developerLogger.record('debug', 'ipc', 'response', `IPC response: ${channel}`, {
          channel,
          durationMs: Date.now() - startedAt,
          result: summarizeDeveloperHandlerResult(channel, result),
        });
      }
      return result;
    } catch (error) {
      if (captureResult) {
        developerLogger.record('error', 'ipc', 'failure', `IPC failure: ${channel}`, {
          channel,
          durationMs: Date.now() - startedAt,
          error,
        });
      }
      throw error;
    }
  },
)) as typeof ipcMain.handle;

ipcMain.handle('kryeo:set-developer-mode', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid developer mode setting.');
  return developerLogger.setEnabled(enabled);
});
ipcMain.handle('kryeo:get-developer-log', () => developerLogger.snapshot());
ipcMain.handle('kryeo:clear-developer-log', () => developerLogger.clear());

ipcMain.handle('kryeo:get-status', () => affinity.getStatus());
ipcMain.handle('kryeo:reconnect', () => affinity.reconnect());
ipcMain.handle('kryeo:get-document-context', () => affinity.getDocumentContext());
ipcMain.handle('kryeo:get-connectors', () => connectors.snapshot(affinity.getStatus()));
ipcMain.handle('kryeo:refresh-connectors', () => connectors.snapshot(affinity.getStatus(), true));
ipcMain.handle('kryeo:get-asset-library', () => library.snapshot());
ipcMain.handle('kryeo:get-library-logs', () => library.logs());
ipcMain.handle('kryeo:get-workspace', () => workspace.snapshot());
ipcMain.handle('kryeo:list-tools', () => affinity.listTools());
ipcMain.handle('kryeo:analyze-components', (_event, input: unknown) => {
  if (!Array.isArray(input)) throw new Error('Invalid local vision review.');
  return localAi.analyze(input as ComponentCandidate[]);
});
ipcMain.handle('kryeo:apply-component-organization', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid component organization request.');
  const request = input as ApplyComponentOrganizationRequest;
  if (typeof request.documentSessionUuid !== 'string' || !Array.isArray(request.components)) {
    throw new Error('Invalid component organization request.');
  }
  const components = request.components.map((component) => {
    if (!component || typeof component.name !== 'string' || component.name.length > 80 || !Array.isArray(component.memberPaths) || component.memberPaths.length > 80) {
      throw new Error('Invalid component organization plan.');
    }
    const memberPaths = component.memberPaths.map((memberPath) => {
      if (!Array.isArray(memberPath) || memberPath.length < 2 || memberPath.length > 30 || memberPath.some((value) => !Number.isInteger(value))) {
        throw new Error('Invalid Affinity layer path.');
      }
      return memberPath;
    });
    return { name: component.name.trim() || 'UI Component', memberPaths };
  });
  return affinity.applyComponentOrganization({ documentSessionUuid: request.documentSessionUuid, components });
});
ipcMain.handle('kryeo:apply-layer-names', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid layer naming request.');
  const request = input as ApplyLayerNamesRequest;
  if (typeof request.documentSessionUuid !== 'string' || !Array.isArray(request.layers)) {
    throw new Error('Invalid layer naming request.');
  }
  const layers = request.layers.map((layer) => {
    if (!layer || typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 80 || !Array.isArray(layer.path) || layer.path.length < 2 || layer.path.length > 30 || layer.path.some((value) => !Number.isInteger(value))) {
      throw new Error('Invalid Affinity layer naming entry.');
    }
    return { name: layer.name.trim(), path: layer.path };
  });
  return affinity.applyLayerNames({ documentSessionUuid: request.documentSessionUuid, layers });
});
ipcMain.handle('kryeo:forget-component-decision', (_event, visualHash: unknown) => {
  if (typeof visualHash !== 'string' || !/^[a-f0-9]{64}$/i.test(visualHash)) throw new Error('Invalid learned visual.');
  return workspace.forgetComponentDecision(visualHash);
});
ipcMain.handle('kryeo:set-component-decision-scope', (_event, visualHash: unknown, scope: unknown) => {
  if (typeof visualHash !== 'string' || !/^[a-f0-9]{64}$/i.test(visualHash) || !['project', 'global'].includes(String(scope))) {
    throw new Error('Invalid learned visual scope.');
  }
  return workspace.setComponentDecisionScope(visualHash, scope as 'project' | 'global');
});
ipcMain.handle('kryeo:clear-component-decisions', () => workspace.clearComponentDecisions());
ipcMain.handle('kryeo:save-component-review', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid component review.');
  const request = input as SaveComponentReviewRequest;
  if (
    typeof request.documentTitle !== 'string'
    || request.documentTitle.length > 180
    || typeof request.documentSessionUuid !== 'string'
    || !Array.isArray(request.components)
    || !Array.isArray(request.includedIds)
    || (request.decisionStatus !== undefined && !['generated', 'accepted', 'corrected'].includes(request.decisionStatus))
  ) {
    throw new Error('Invalid component review.');
  }
  for (const component of request.components) {
    if (!component || typeof component.id !== 'string' || typeof component.visualHash !== 'string' || !/^[a-f0-9]{64}$/i.test(component.visualHash)) {
      throw new Error('Invalid component review entry.');
    }
  }
  return workspace.saveComponentReview(request);
});
ipcMain.handle('kryeo:save-scan-intent-profile', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid scan intent profile.');
  const profile = input as Partial<ScanIntentProfile>;
  if (
    typeof profile.project !== 'string'
    || typeof profile.documentTitle !== 'string'
    || typeof profile.structureFingerprint !== 'string'
    || !['smart', 'group-first', 'layer-inclusive'].includes(String(profile.mode))
    || !Array.isArray(profile.answers)
  ) throw new Error('Invalid scan intent profile.');
  return workspace.saveScanIntentProfile({
    id: typeof profile.id === 'string' ? profile.id : undefined,
    project: profile.project,
    documentTitle: profile.documentTitle,
    structureFingerprint: profile.structureFingerprint,
    mode: profile.mode as ComponentScanMode,
    answers: profile.answers,
  });
});
ipcMain.handle('kryeo:create-component-assets', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid component asset request.');
  const request = input as CreateComponentAssetsRequest;
  if (!request.documentSessionUuid || !request.documentTitle || !request.project || !Array.isArray(request.components) || !Array.isArray(request.includedIds) || !request.structureFingerprint) {
    throw new Error('Invalid component asset request.');
  }
  const project = request.project;
  const documentTitle = request.documentTitle;
  const documentSessionUuid = request.documentSessionUuid;
  const structureFingerprint = request.structureFingerprint;
  const requestedAssets = request.components
    .filter((component) => request.includedIds.includes(component.id) && component.members.length)
    .map((component) => {
      const identity = buildProductionIdentity(component);
      return {
        ...component,
        exportName: identity.displayName,
        codeName: identity.codeName,
        role: identity.robloxClass,
        robloxClassReason: identity.robloxClassReason,
        namingIssues: identity.issues,
        automationIssues: identity.issues,
        automationState: identity.issues.length ? 'exception' as const : 'ready' as const,
      };
    });
  const selected = requestedAssets.filter((component) => component.automationState !== 'exception' && !(component.automationIssues?.length));
  const exceptionCount = requestedAssets.length - selected.length;
  if (!selected.length) throw new Error(exceptionCount
    ? `Kryeo isolated ${exceptionCount} unresolved asset${exceptionCount === 1 ? '' : 's'}. Resolve the exceptions before building.`
    : 'Select at least one export target before creating assets.');
  return workspace.runJob('save', `Create ${selected.length} scanned asset${selected.length === 1 ? '' : 's'}`, { project, documentTitle }, async (update, cancelled) => {
    await update(12, 'Planning editable component files');
    const planned = await library.componentAssetDestinations(project, documentTitle, selected.map((component) => ({
      id: component.id,
      name: component.exportName || component.familyName,
      codeName: component.codeName || (component.exportName || component.familyName).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase(),
      category: componentCategory(component.assetType),
      subcategory: componentSubcategory(component, request.components),
      sourcePaths: component.members.map((member) => member.path),
    })));
    let committed = false;
    let commitAttempted = false;
    try {
      if (cancelled()) throw new Error('Asset creation cancelled before Affinity started.');
      await update(35, 'Creating staged Affinity component files');
      const exported = await affinity.exportConfirmedComponentAssets(documentSessionUuid, planned.map((asset) => ({
        id: asset.id, name: asset.name, sourcePath: asset.stagedSourcePath, rasterPath: asset.stagedRasterPath,
        sourcePaths: selected.find((component) => component.id === asset.id)?.members.map((member) => member.path) || [],
      })));
      if (cancelled()) throw new Error('Asset creation cancelled safely before the staged files were committed.');
      const exportedIds = new Set(exported.map((asset) => asset.id));
      if (exportedIds.size !== planned.length || planned.some((asset) => !exportedIds.has(asset.id))) {
        throw new Error(`Affinity returned ${exportedIds.size} of ${planned.length} staged assets. Kryeo left the existing library unchanged.`);
      }
      await update(82, 'Validating and committing the complete asset batch');
      commitAttempted = true;
      const manifest = await library.recordComponentAssets({
        project, documentTitle, documentSessionUuid,
        structureFingerprint,
        assets: planned.filter((asset) => exportedIds.has(asset.id)).map((asset) => {
          const component = selected.find((candidate) => candidate.id === asset.id)!;
          return { ...asset, role: component.role, bounds: component.bounds, sourcePaths: component.members.map((member) => member.path) };
        }),
      });
      committed = true;
      const acceptedComponents = selected.filter((component) => exportedIds.has(component.id));
      await workspace.saveComponentReview({
        project,
        documentTitle,
        documentSessionUuid,
        components: acceptedComponents,
        includedIds: acceptedComponents.map((component) => component.id),
        scanIntent: request.scanIntent,
        decisionStatus: 'accepted',
      });
      const now = new Date().toISOString();
      return { ok: true, title: 'Create scanned assets', output: `Created ${manifest.assetCount} editable asset${manifest.assetCount === 1 ? '' : 's'}${exceptionCount ? `; isolated ${exceptionCount} unresolved exception${exceptionCount === 1 ? '' : 's'}` : ''} and regenerated the complete Roblox project manifest at ${manifest.manifestPath}.`, startedAt: now, completedAt: now };
    } finally {
      if (!committed && !commitAttempted) await library.discardComponentAssetTransaction(planned);
    }
  });
});
ipcMain.handle('kryeo:save-component-decisions', (_event, input: unknown) => {
  if (!Array.isArray(input)) throw new Error('Invalid Component Scan review.');
  const allowedRoles = ['Unknown', 'ImageButton', 'ImageLabel', 'Frame', 'TextButton', 'TextLabel', 'TextBox'];
  const allowedTypes = ['Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text', 'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor', 'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX'];
  const allowedDiveModes = ['keep-together', 'children-only', 'parent-and-children'];
  const decisions = input.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid component decision.');
    const candidate = item as ComponentDecision;
    if (
      typeof candidate.visualHash !== 'string'
      || !/^[a-f0-9]{64}$/i.test(candidate.visualHash)
      || typeof candidate.role !== 'string'
      || !allowedRoles.includes(candidate.role)
      || typeof candidate.familyName !== 'string'
      || candidate.familyName.length > 120
      || (candidate.layerLabel !== undefined && (typeof candidate.layerLabel !== 'string' || candidate.layerLabel.length > 120))
      || (candidate.exportName !== undefined && (typeof candidate.exportName !== 'string' || candidate.exportName.length > 120))
      || (candidate.assetType !== undefined && !allowedTypes.includes(candidate.assetType))
      || (candidate.suggestedType !== undefined && !allowedTypes.includes(candidate.suggestedType))
      || (candidate.suggestedRole !== undefined && !allowedRoles.includes(candidate.suggestedRole))
      || (candidate.diveMode !== undefined && !allowedDiveModes.includes(candidate.diveMode))
      || (candidate.embedding !== undefined && (typeof candidate.embedding !== 'string' || candidate.embedding.length > 1200))
    ) throw new Error('Invalid component decision.');
    const canonicalName = (candidate.exportName || candidate.familyName || candidate.layerLabel || '').trim().slice(0, 120);
    return {
      ...candidate,
      familyName: canonicalName,
      layerLabel: canonicalName,
      exportName: canonicalName,
      semanticHint: candidate.semanticHint?.slice(0, 160),
      suggestedName: candidate.suggestedName?.slice(0, 120),
      correctionCount: Number.isFinite(candidate.correctionCount) ? Math.max(0, Math.floor(candidate.correctionCount || 0)) : 0,
      diveMode: candidate.diveMode || 'keep-together',
      documentTitle: candidate.documentTitle?.slice(0, 180),
    };
  });
  return workspace.saveComponentDecisions(decisions);
});
ipcMain.handle('kryeo:save-project-note', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid project note.');
  const request = input as SaveProjectNoteRequest;
  if (typeof request.project !== 'string' || request.project.length > 100 || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 1200 || !Array.isArray(request.tags) || request.tags.length > 12 || request.tags.some((tag) => typeof tag !== 'string' || tag.length > 40) || (request.id !== undefined && (typeof request.id !== 'string' || request.id.length > 100))) {
    throw new Error('Invalid project note.');
  }
  return workspace.saveProjectNote(request);
});
ipcMain.handle('kryeo:delete-project-note', (_event, project: unknown, id: unknown) => {
  if (typeof project !== 'string' || project.length > 100 || typeof id !== 'string' || id.length > 100) throw new Error('Invalid project note.');
  return workspace.deleteProjectNote(project, id);
});
ipcMain.handle('kryeo:export-project-knowledge', async (_event, project: unknown) => {
  if (typeof project !== 'string' || project.length > 100) throw new Error('Invalid project.');
  const snapshot = await workspace.snapshot();
  const knowledge = snapshot.projectKnowledge.find((item) => item.project === project) || { project, notes: [], metadata: {}, updatedAt: new Date().toISOString() };
  const parent = BrowserWindow.getFocusedWindow();
  const options = {
    title: 'Export Kryeo project notes',
    defaultPath: `${project.replace(/[<>:"/\\|?*]/g, '-') || 'General'} - Kryeo notes.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, `${JSON.stringify(knowledge, null, 2)}\n`, 'utf8');
  return true;
});
ipcMain.handle('kryeo:import-project-knowledge', async (_event, project: unknown) => {
  if (typeof project !== 'string' || project.length > 100) throw new Error('Invalid project.');
  const parent = BrowserWindow.getFocusedWindow();
  const options: OpenDialogOptions = { title: 'Import Kryeo project notes', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return workspace.snapshot();
  const parsed = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('This project notes file is invalid.');
  return workspace.mergeProjectKnowledge(project, parsed);
});
ipcMain.handle('kryeo:run-tool', (_event, title: unknown) => {
  if (typeof title !== 'string' || title.length > 180) throw new Error('Invalid tool title.');
  return workspace.runJob('tool', title, { title }, async (update) => {
    await update(20, 'Sending workflow to Affinity');
    const result = await affinity.runTool(title);
    await update(92, 'Refreshing workflow state');
    return result;
  });
});
ipcMain.handle('kryeo:open-asset', async (_event, candidate: unknown, displayName: unknown) => {
  if (typeof candidate !== 'string' || typeof displayName !== 'string' || displayName.length > 180 || !await library.isAllowedAssetFile(candidate)) {
    throw new Error('Invalid asset file.');
  }
  return workspace.runJob('open', `Open ${displayName}`, { path: candidate, displayName }, async (update) => {
    await update(25, 'Opening asset document');
    return affinity.openAsset(candidate, displayName);
  });
});
ipcMain.handle('kryeo:save-asset', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid save request.');
  const candidate = input as Record<string, unknown>;
  const textFields = ['displayName', 'codeName', 'project', 'category', 'subcategory', 'tags', 'notes'];
  const booleanFields = ['batch', 'update', 'baseCopy', 'rasterCopy'];
  for (const field of textFields) {
    if (typeof candidate[field] !== 'string' || String(candidate[field]).length > 500) throw new Error(`Invalid ${field}.`);
  }
  for (const field of booleanFields) {
    if (typeof candidate[field] !== 'boolean') throw new Error(`Invalid ${field}.`);
  }
  if (!String(candidate.displayName).trim() || !String(candidate.codeName).trim() || !String(candidate.project).trim()) {
    throw new Error('Display name, code name, and project are required.');
  }
  const request = candidate as unknown as SaveAssetRequest;
  return workspace.runJob('save', `Save ${request.displayName}`, request, async (update, cancelled) => {
    await update(12, 'Preparing the asset library');
    await Promise.all([library.prepareKryeoStaging(), library.prepareSaveDestination(request)]);
    if (cancelled()) throw new Error('Save cancelled before Affinity started.');
    await update(28, 'Building Master, Base, and Raster');
    const result = await affinity.saveAsset(request);
    if (!result.ok) return result;
    await update(94, 'Updating the library index');
    return result;
  });
});
ipcMain.handle('kryeo:run-configured-tool', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid workflow request.');
  const request = input as ConfiguredToolRequest;
  const titlePatterns = {
    export: /^Asset Library - Export\s+v/i,
    update: /^Asset Library - Update\s+v/i,
    shade: /^Pixel Helper - Hand Shade\s+v/i,
  };
  if (!request.kind || !request.title || !request.values || !titlePatterns[request.kind]?.test(request.title)) {
    throw new Error('Unsupported configured workflow.');
  }
  for (const value of Object.values(request.values)) {
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 500)) {
      throw new Error('Invalid workflow value.');
    }
  }
  return workspace.runJob('configured', request.title, request, async (update, cancelled) => {
    await update(22, 'Applying workflow settings');
    if (cancelled()) throw new Error('Workflow cancelled before Affinity started.');
    return affinity.runConfiguredTool(request);
  });
});
ipcMain.handle('kryeo:cancel-job', (_event, id: unknown) => {
  if (typeof id !== 'string' || id.length > 180) return false;
  return workspace.cancelJob(id);
});
ipcMain.handle('kryeo:save-preset', (_event, input: unknown) => {
  const preset = input as WorkflowPreset;
  if (!preset || !['export', 'update', 'shade'].includes(String(preset.kind)) || typeof preset.name !== 'string' || !preset.name.trim() || !preset.values || typeof preset.values !== 'object') {
    throw new Error('Invalid workflow preset.');
  }
  return workspace.savePreset({ id: typeof preset.id === 'string' ? preset.id : undefined, kind: preset.kind, name: preset.name.trim().slice(0, 100), values: preset.values });
});
ipcMain.handle('kryeo:delete-preset', (_event, id: unknown) => {
  if (typeof id !== 'string' || id.length > 180) throw new Error('Invalid preset.');
  return workspace.deletePreset(id);
});
ipcMain.handle('kryeo:set-asset-preference', (_event, input: unknown) => {
  const preference = input as AssetPreference;
  if (!preference || typeof preference.assetId !== 'string' || typeof preference.favourite !== 'boolean' || !Array.isArray(preference.collections)) {
    throw new Error('Invalid asset preference.');
  }
  return workspace.setAssetPreference({
    assetId: preference.assetId,
    favourite: preference.favourite,
    collections: preference.collections.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 20),
  });
});
ipcMain.handle('kryeo:deliver-project', (_event, project: unknown, target: unknown) => {
  if (typeof project !== 'string' || !project.trim() || target !== 'roblox') throw new Error('Invalid delivery request.');
  return library.deliverProject(project.trim(), 'roblox');
});
ipcMain.handle('kryeo:cleanup-staging', () => workspace.runJob('cleanup', 'Clean staging files', {}, async (update) => {
  await update(30, 'Inspecting old staging files');
  const result = await library.cleanupStaging();
  const now = new Date().toISOString();
  return { ok: true, title: 'Clean staging files', output: `Removed ${result.removed} old temporary item(s).`, startedAt: now, completedAt: now };
}));
ipcMain.handle('kryeo:reveal-path', async (_event, candidate: unknown) => {
  if (typeof candidate !== 'string' || !await library.isAllowedPath(candidate)) return false;
  shell.showItemInFolder(candidate);
  return true;
});
ipcMain.handle('kryeo:place-asset', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid placement request.');
  const request = input as PlaceAssetRequest;
  if (
    typeof request.path !== 'string'
    || typeof request.displayName !== 'string'
    || request.displayName.length > 180
    || typeof request.targetSessionUuid !== 'string'
    || request.targetSessionUuid.length > 180
    || !['master', 'base', 'raster'].includes(String(request.layerKind))
    || !await library.isAllowedAssetFile(request.path)
  ) throw new Error('Invalid asset placement request.');
  return workspace.runJob('place', `Place ${request.layerKind}: ${request.displayName}`, request, async (update, cancelled) => {
    await update(12, 'Preparing an invisible source layer');
    const prepared = await affinity.preparePlaceAsset(request);
    if (!prepared.ok) return prepared;
    const placement = preparedPlacement(prepared.output);
    if (!placement.sourceSessionUuid || placement.targetNodeCount < 1) {
      return { ...prepared, ok: false, output: 'Affinity did not identify the loaded asset document.', completedAt: new Date().toISOString() };
    }
    try {
      if (cancelled()) throw new Error('Placement cancelled before the clipboard transfer.');
      await update(40, 'Copying the prepared layer');
      await transferPreparedLayer(placement.sourceSessionUuid, request.targetSessionUuid, placement.staged);
    } catch (error) {
      return { ...prepared, ok: false, output: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() };
    }
    await update(70, 'Verifying the placed layer');
    const verified = await affinity.verifyPlacedAsset(request, placement.targetNodeCount);
    if (!verified.ok) return verified;
    const recordPlacement = async () => {
      const asset = await library.assetByPath(request.path);
      if (!asset) return;
      await workspace.recordPlacement({
        assetId: asset.id,
        assetPath: asset.path,
        displayName: asset.displayName || asset.name,
        version: asset.version,
        layerKind: request.layerKind,
        targetDocument: (await affinity.getDocumentContext()).title,
        targetSessionUuid: request.targetSessionUuid,
      });
    };
    if (!placement.staged) {
      await recordPlacement();
      return verified;
    }
    try {
      await wait(5_000);
      await clearClipboard();
      await wait(750);
      await focusAffinityDocument(placement.sourceSessionUuid);
      await affinity.cleanupPreparedPlace(placement.sourceSessionUuid, true, placement.expected, placement.sourceVisibilities);
      await focusAffinityDocument(request.targetSessionUuid);
      await recordPlacement();
      await update(96, 'Cleaning the hidden staging copy');
      return verified;
    } catch (error) {
      return {
        ...verified,
        ok: false,
        output: `The Master was placed, but Kryeo could not remove its hidden staging copy: ${error instanceof Error ? error.message : String(error)}`,
        completedAt: new Date().toISOString(),
      };
    }
  });
});
ipcMain.handle('kryeo:scan-components', async (event, input: unknown) => {
  activeComponentScans.get(event.sender.id)?.abort();
  const scanController = new AbortController();
  activeComponentScans.set(event.sender.id, scanController);
  const requested = typeof input === 'object' && input !== null ? input as ComponentScanRequest : undefined;
  const scope = input === 'selection' || requested?.scope === 'selection' ? 'selection' : 'document';
  const developerMode = requested?.developerMode === true;
  const directory = path.join(app.getPath('desktop'), 'Kryeo', 'ComponentScanStaging', randomUUID());
  const scanStartedAt = Date.now();
  const stageTimings = {
    contextCaptureMs: 0,
    affinityExportMs: 0,
    imagePreparationMs: 0,
    localAnalysisMs: 0,
    hostedAnalysisMs: 0,
    finalizationMs: 0,
  };
  const scanWarnings: string[] = [];
  const scanNotes: string[] = [];
  let diagnosticsHostedFamilies = 0;
  let diagnosticsHostedRequests = 0;
  let diagnosticsProviderRequests = 0;
  let diagnosticsAffinityRequests = 0;
  let diagnosticsAffinityRetries = 0;
  let diagnosticsAffinitySplits = 0;
  let diagnosticsAffinitySlowestRequestMs = 0;
  let diagnosticsCachedFamilies = 0;
  let diagnosticsFailedFamilies = 0;
  let diagnosticsBudgetLimitedFamilies = 0;
  let diagnosticsFailureMessages: string[] = [];
  const traceEntries: NonNullable<ComponentScanDiagnostics['trace']> = [];
  const trace = (stage: string, message: string, data?: Record<string, string | number | boolean>) => {
    if (!developerMode) return;
    const entry = { at: new Date().toISOString(), stage, message, ...(data ? { data } : {}) };
    traceEntries.push(entry);
    if (traceEntries.length > 500) traceEntries.shift();
    developerLogger.record('debug', 'component-scan', stage, message, data);
    if (!event.sender.isDestroyed()) event.sender.send('kryeo:scan-progress', { phase: 'preparing', label: 'Developer trace', detail: message, progress: 0, trace: entry });
  };
  const progress = (phase: string, label: string, detail: string, value: number) => {
    trace(phase, `${label}: ${detail}`, { progress: value });
    if (!event.sender.isDestroyed()) {
      event.sender.send('kryeo:scan-progress', { phase, label, detail, progress: value });
    }
  };
  trace('scan', 'Scan requested.', { scope, developerMode });
  progress('preparing', 'Preparing scan', `Creating a clean workspace for the ${scope}.`, 4);
  await resetScanDirectory(directory);
  try {
    progress('discovering-layers', 'Finding component layers', 'Walking spreads, nested groups, and independently editable visual layers.', 22);
    const affinityExportStartedAt = Date.now();
    const batch = await affinity.exportComponentCandidates(directory, scope, ({ completedPartitions, totalPartitions }) => {
      const fraction = completedPartitions / Math.max(1, totalPartitions);
      progress(
        'discovering-layers',
        'Finding component layers',
        `Processing Affinity scan part ${completedPartitions} of ${totalPartitions}.`,
        22 + Math.round(fraction * 14),
      );
    }, scanController.signal);
    stageTimings.affinityExportMs = Date.now() - affinityExportStartedAt;
    diagnosticsAffinityRequests = batch.exportDiagnostics?.requestCount || 0;
    diagnosticsAffinityRetries = batch.exportDiagnostics?.retryCount || 0;
    diagnosticsAffinitySplits = batch.exportDiagnostics?.splitCount || 0;
    diagnosticsAffinitySlowestRequestMs = batch.exportDiagnostics?.slowestRequestMs || 0;
    trace('affinity-export', 'Affinity candidate export completed.', {
      components: batch.components.length,
      requests: diagnosticsAffinityRequests,
      retries: diagnosticsAffinityRetries,
      splits: diagnosticsAffinitySplits,
      elapsedMs: stageTimings.affinityExportMs,
    });
    if (batch.components.length === 0) throw new Error(`No component layers were found in the ${scope}.`);
    const snapshot = await workspace.snapshot();
    progress('local-analysis', 'Preparing visual families', `Preparing ${batch.components.length} candidates once for grouping and cloud review.`, 43);
    const imagePreparationStartedAt = Date.now();
    const scan = await buildComponentScan(batch, snapshot.componentDecisions, scanController.signal);
    trace('local-analysis', 'Local hierarchy and visual families prepared.', {
      components: scan.components.length,
      uniqueVisuals: scan.uniqueVisuals,
      duplicateFamilies: scan.duplicateFamilies,
      elapsedMs: stageTimings.imagePreparationMs,
    });
    const project = batch.sourceName || scan.documentTitle || 'General';
    const intentFingerprint = structureFingerprint(scan.components);
    const cachedIntent = snapshot.scanIntentProfiles.find((profile) => (
      profile.project === project
      && profile.documentTitle === scan.documentTitle
      && profile.structureFingerprint === intentFingerprint
    ));
    const scanIntent = normalizeScanIntent(requested?.intent || cachedIntent);
    scan.components = applyScanIntent(scan.components, scanIntent);
    stageTimings.imagePreparationMs = Date.now() - imagePreparationStartedAt;
    // Local visual analysis already returns a reusable embedding. Running a
    // separate embed pass first made every new visual pay for MobileCLIP twice
    // before the first hosted request could begin.
    const localAnalysisStartedAt = Date.now();
    let localSuggestions: Awaited<ReturnType<typeof localAi.analyze>> = [];
    if (LOCAL_CONTEXT_MAX_VISUALS > 0 && scan.uniqueVisuals <= LOCAL_CONTEXT_MAX_VISUALS) {
      try {
        localSuggestions = await localAi.analyze(scan.components);
      } catch (error) {
        scanNotes.push(`Cloud review continued without optional embedded classifier context: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
        scanNotes.push(`Skipped optional embedded classifier context for ${scan.uniqueVisuals} unique visuals to keep this large scan responsive; every unresolved family still received cloud review.`);
    }
    stageTimings.localAnalysisMs = Date.now() - localAnalysisStartedAt;
    if (scanController.signal.aborted) throw new Error('Component scan cancelled.');
    const suggestionByHash = new Map(localSuggestions.map((suggestion) => [suggestion.visualHash, suggestion]));
    const locallyClassified = scan.components.map((component) => {
      const suggestion = suggestionByHash.get(component.visualHash);
      if (!suggestion) return component;
      if (component.remembered) {
        return {
          ...component,
          visualEmbedding: suggestion.embedding || component.visualEmbedding,
        };
      }
      return {
        ...component,
        familyName: suggestion.name || component.familyName,
        assetType: suggestion.assetType,
        role: suggestion.role,
        aiSuggestedName: suggestion.name,
        aiSuggestedType: suggestion.assetType,
        aiSuggestedRole: suggestion.role,
        aiSource: suggestion.source,
        aiMargin: suggestion.margin,
        aiAlternatives: suggestion.alternatives,
        aiReason: suggestion.reason,
        semanticHint: suggestion.semanticHint,
        semanticType: suggestion.semanticType,
        visualStructureType: suggestion.visualStructureType,
        visualStructureConfidence: suggestion.visualStructureConfidence,
        semanticConflict: suggestion.semanticConflict,
        semanticConflictMessage: suggestion.semanticConflictMessage,
        reviewCategory: suggestion.reviewCategory,
        nameSource: suggestion.nameSource,
        visualEmbedding: suggestion.embedding || component.visualEmbedding,
        learnedFrom: suggestion.learnedFrom,
        nearestLearnedSimilarity: suggestion.nearestLearnedSimilarity,
        recommendedDiveMode: suggestion.learnedDiveMode || component.recommendedDiveMode,
      };
    });
    const clustered = applyAssetBoundaries(applyComponentIntelligence(locallyClassified));
    const families = buildVisualFamilies(clustered, snapshot.componentDecisions, project, scan.documentTitle);
    await workspace.recordComponentInfluences(
      families.filter((family) => family.approvedDecision).map((family) => family.fingerprint),
    );
    let reviewed = applyApprovedFamilies(clustered, families);
    let reconciliation = undefined;
    let hostedAnalysisAvailable = false;
    let hostedAnalysisError = '';
    let hostedProviderCostUsd = 0;
    let hostedTargetUsd = 0.01;
    let hostedBudgetUsd = 0.03;
    let hostedAnalysisStartedAt = 0;
    try {
      const unresolvedFamilies = families.filter((family) => !family.approvedDecision).length;
      const hostedStatus = await hostedAi.status();
      hostedTargetUsd = hostedStatus.scanTargetUsd ?? hostedTargetUsd;
      hostedBudgetUsd = hostedStatus.scanBudgetUsd ?? hostedBudgetUsd;
      const selection = hostedStatus.available
        ? selectHostedFamilies(families, hostedStatus)
        : {
            candidates: [],
            selected: [],
            localCount: countLocallyHandledFamilies(families, false),
            budgetLimitedCount: 0,
            estimatedCostUsd: 0,
          } satisfies HostedScanSelection;
      const hostedScanId = randomUUID();
      const hostedFamilies = selection.selected;
      const hostedTotal = hostedFamilies.length;
      trace('hosted-selection', 'Cloud review plan selected.', {
        visualFamilies: families.length,
        selectedFamilies: hostedTotal,
        localFamilies: selection.localCount,
        budgetLimited: selection.budgetLimitedCount,
      });
      diagnosticsHostedFamilies = hostedTotal;
      const provisionalBudgetFamilies = selection.budgetLimitedCount;
      const scanTargetUsd = hostedStatus.scanTargetUsd ?? 0.01;
      const scanBudgetUsd = hostedStatus.scanBudgetUsd ?? 0.03;
      const budgetDescription = hostedStatus.scanBudgetEnforced
        ? `toward the $${scanTargetUsd.toFixed(3)} target with a $${scanBudgetUsd.toFixed(3)} hard ceiling`
        : `against an estimated $${scanTargetUsd.toFixed(3)} per-scan target`;
      progress(
        'hosted-analysis',
        'Analysing new visual families',
        !hostedStatus.available && unresolvedFamilies
          ? `The cloud reviewer is unavailable. The local pass kept ${unresolvedFamilies} ${unresolvedFamilies === 1 ? 'family' : 'families'} provisional.`
          : hostedTotal
            ? `The local pass prepared context for ${unresolvedFamilies} unresolved ${unresolvedFamilies === 1 ? 'family' : 'families'}. The cloud reviewer is classifying ${hostedTotal} ${hostedTotal === 1 ? 'family' : 'families'} ${budgetDescription}${provisionalBudgetFamilies ? `; ${provisionalBudgetFamilies} remain provisional` : ''}.`
            : unresolvedFamilies
              ? `The local pass handled the clear families; ${unresolvedFamilies} ${unresolvedFamilies === 1 ? 'family remains' : 'families remain'} provisional within the cloud budget.`
              : 'All visual families are already known; applying learned decisions.',
        62,
      );
      const requestBase: Omit<HostedFamilyAnalysisRequest, 'families' | 'reviewTier' | 'includeDocumentContext' | 'maxMemberImages' | 'hostedScanId'> = {
        project,
        documentTitle: scan.documentTitle,
        documentSessionUuid: scan.documentSessionUuid,
        instructions: snapshot.assistantMemories
          .filter((memory) => memory.scope === 'global' || memory.project === project)
          .map((memory) => memory.text)
          .concat(scanIntentContext(scanIntent)),
        projectKnowledge: snapshot.projectKnowledge.find((knowledge) => knowledge.project === project),
      };
      const hostedAnalyses: Awaited<ReturnType<typeof hostedAi.analyzeFamilies>>['analyses'] = [];
      let cachedFamilies = 0;
      let failedFamilies = 0;
      let completedHostedFamilies = 0;
      let budgetLimitedFamilies = provisionalBudgetFamilies;
      let lastPartialResultAt = 0;
      let lastPartialResultCompleted = 0;
      let partialResultSent = false;
      const tierResponses: Awaited<ReturnType<typeof hostedAi.analyzeFamilies>>[] = [];
      hostedAnalysisStartedAt = Date.now();
      for (const tier of ['lite', 'escalation'] as HostedReviewTier[]) {
        const tierFamilies = hostedFamilies.filter((candidate) => candidate.tier === tier).map((candidate) => candidate.family);
        if (!tierFamilies.length) continue;
        const response = await hostedAi.analyzeFamiliesProgressively({
          ...requestBase,
          families: tierFamilies,
          reviewTier: tier,
          // Every primary decision sees its own direct target PNG. Hierarchy
          // metadata supplies local context; a whole-document image would
          // allow adjacent artwork to leak into the asset's identity.
          maxMemberImages: 1,
          includeDocumentContext: false,
          hostedScanId,
        }, (completed, total, partial) => {
          diagnosticsHostedRequests += 1;
          diagnosticsProviderRequests = Math.max(diagnosticsProviderRequests, partial.scanProviderRequests || 0);
          hostedAnalyses.push(...partial.analyses);
          cachedFamilies += partial.cached;
          failedFamilies += partial.failures.reduce((total, failure) => total + failure.familyIds.length, 0);
          budgetLimitedFamilies += partial.skippedFamilyIds?.length || 0;
          diagnosticsCachedFamilies = cachedFamilies;
          diagnosticsFailedFamilies = failedFamilies;
          diagnosticsBudgetLimitedFamilies = budgetLimitedFamilies;
          const globalCompleted = Math.min(completedHostedFamilies + completed, hostedTotal);
          trace('hosted-batch', 'Gateway batch completed.', {
            completed: globalCompleted,
            total: hostedTotal,
            analyses: partial.analyses.length,
            cached: partial.cached,
            failed: partial.failures.reduce((total, failure) => total + failure.familyIds.length, 0),
            providerRequests: partial.scanProviderRequests || 0,
          });
          const detail = `The cloud reviewer completed ${globalCompleted} of ${hostedTotal} selected ${hostedTotal === 1 ? 'family' : 'families'}${budgetLimitedFamilies ? `; ${budgetLimitedFamilies} remain local within budget` : ''}.`;
          if (!event.sender.isDestroyed()) {
            const now = Date.now();
            const isFinalHostedUpdate = globalCompleted >= hostedTotal;
            // A partial result contains every thumbnail as a base64 data URL.
            // Re-sending that full document after every small cloud batch makes
            // large scans spend more time in IPC/React updates than inference.
            // Progress counts still update for every response; the heavyweight
            // result update is intentionally bounded.
            const shouldSendPartialResult = !partialResultSent
              || isFinalHostedUpdate
              || (
                globalCompleted - lastPartialResultCompleted >= 48
                && now - lastPartialResultAt >= 2_500
              );
            const partialResult = shouldSendPartialResult
              ? {
                ...scan,
                components: prepareComponentsForReview(
                  calibrateComponentConfidence(
                    applyHostedFamilyAnalyses(reviewed, families, hostedAnalyses),
                    snapshot.componentDecisions,
                  ),
                ),
              }
              : undefined;
            if (partialResult) {
              partialResultSent = true;
              lastPartialResultAt = now;
              lastPartialResultCompleted = globalCompleted;
            }
            event.sender.send('kryeo:scan-progress', {
              phase: 'hosted-analysis',
              label: 'Analysing new visual families',
              detail,
              progress: 62 + Math.round((globalCompleted / Math.max(1, hostedTotal)) * 18),
              completedFamilies: globalCompleted,
              totalFamilies: hostedTotal,
              cachedFamilies,
              failedFamilies,
              localFamilies: selection.localCount,
              hostedFamilies: hostedTotal,
              budgetLimitedFamilies,
              ...(partialResult ? { partialResult } : {}),
            });
          }
        }, scanController.signal);
        tierResponses.push(response);
        completedHostedFamilies += tierFamilies.length;
      }
      stageTimings.hostedAnalysisMs = Date.now() - hostedAnalysisStartedAt;
      let responseAnalyses = tierResponses.flatMap((response) => response.analyses);
      const familyById = new Map(families.map((family) => [family.id, family]));
      const batchConsistency = familyBatchConsistencyIssues(responseAnalyses, families);
      const challenges = responseAnalyses.filter((analysis) => (
        requiresIndependentFamilyReview(analysis, familyById.get(analysis.familyId))
        || batchConsistency.has(analysis.familyId)
      ));
      hostedProviderCostUsd = Math.max(0, ...tierResponses.map((response) => response.scanProviderCostUsd || 0));
      diagnosticsProviderRequests = Math.max(
        diagnosticsProviderRequests,
        ...tierResponses.map((response) => response.scanProviderRequests || 0),
      );
      if (challenges.length) {
        trace('review', 'Independent visual review required.', { challengedFamilies: challenges.length, inconsistentScopes: batchConsistency.size });
        progress('reconciliation', 'Resolving visual disagreements', `Independently checking ${challenges.length} uncertain ${challenges.length === 1 ? 'family' : 'families'} before applying one final decision.`, 82);
        const scopes = new Map<string, typeof challenges>();
        for (const analysis of challenges) {
          const family = familyById.get(analysis.familyId);
          const key = family?.namingScopeKey || analysis.familyId;
          const scopeAnalyses = scopes.get(key) || [];
          scopeAnalyses.push(analysis);
          scopes.set(key, scopeAnalyses);
        }
        const reviewBatches: Array<typeof challenges> = [];
        let pendingBatch: typeof challenges = [];
        for (const scopeAnalyses of scopes.values()) {
          for (let offset = 0; offset < scopeAnalyses.length; offset += 8) {
            const unit = scopeAnalyses.slice(offset, offset + 8);
            if (pendingBatch.length && pendingBatch.length + unit.length > 8) {
              reviewBatches.push(pendingBatch);
              pendingBatch = [];
            }
            pendingBatch.push(...unit);
            if (pendingBatch.length === 8) {
              reviewBatches.push(pendingBatch);
              pendingBatch = [];
            }
          }
        }
        if (pendingBatch.length) reviewBatches.push(pendingBatch);
        const reviewedById = new Map<string, (typeof challenges)[number]>();
        for (const batch of reviewBatches) {
          const batchFamilies = batch.flatMap((analysis) => {
            const family = familyById.get(analysis.familyId);
            return family ? [family] : [];
          });
          const challengeReasons = Object.fromEntries(batch.map((analysis) => {
            const family = familyById.get(analysis.familyId);
            return [analysis.familyId, [
              ...familyDecisionConsistencyIssues(analysis, family),
              ...(batchConsistency.get(analysis.familyId) || []),
            ]];
          }));
          try {
            diagnosticsHostedRequests += 1;
            const response = await hostedAi.reviewFamilies({
              ...requestBase,
              families: batchFamilies,
              reviewTier: 'escalation',
              hostedScanId,
              currentAnalyses: batch,
              challengeReasons,
            }, scanController.signal);
            response.analyses.forEach((analysis) => reviewedById.set(analysis.familyId, analysis));
            hostedProviderCostUsd = Math.max(hostedProviderCostUsd, response.scanProviderCostUsd || 0);
            diagnosticsProviderRequests = Math.max(diagnosticsProviderRequests, response.scanProviderRequests || 0);
            diagnosticsFailureMessages.push(...response.failures.map((failure) => safeHostedFailureMessage(failure.message)));
            trace('review', 'Independent review batch completed.', { families: batchFamilies.length, analyses: response.analyses.length, failures: response.failures.length });
          } catch (error) {
            diagnosticsFailureMessages.push(safeHostedFailureMessage(error));
            trace('review', 'Independent review batch failed.', { families: batchFamilies.length, error: safeHostedFailureMessage(error) });
          }
        }
        const resolvedById = new Map(challenges.map((analysis) => [
          analysis.familyId,
          resolveIndependentFamilyAnalysis(analysis, reviewedById.get(analysis.familyId)),
        ]));
        responseAnalyses = responseAnalyses.map((analysis) => resolvedById.get(analysis.familyId) || analysis);
      }
      reviewed = calibrateComponentConfidence(
        applyHostedFamilyAnalyses(reviewed, families, responseAnalyses),
        snapshot.componentDecisions,
      );
      hostedAnalysisAvailable = responseAnalyses.length > 0;
      trace('resolver', 'Atomic decisions resolved.', {
        analyses: responseAnalyses.length,
        challenged: challenges.length,
        unresolved: responseAnalyses.filter((analysis) => analysis.reviewNeeded || analysis.assetType === 'Unknown' || analysis.role === 'Unknown').length,
      });
      const failures = tierResponses.flatMap((response) => response.failures);
      const skippedHostedFamilies = [...new Set(tierResponses.flatMap((response) => response.skippedFamilyIds || []))];
      diagnosticsCachedFamilies = cachedFamilies;
      diagnosticsFailedFamilies = failures.reduce((total, failure) => total + failure.familyIds.length, 0);
      diagnosticsBudgetLimitedFamilies = skippedHostedFamilies.length;
      diagnosticsFailureMessages = [...new Set([
        ...diagnosticsFailureMessages,
        ...failures.map((failure) => `${failure.familyIds.length} ${failure.familyIds.length === 1 ? 'family' : 'families'}: ${safeHostedFailureMessage(failure.message)}`),
      ])].slice(0, 6);
      if (!hostedAnalysisAvailable && failures.length) {
        hostedAnalysisError = safeHostedFailureMessage(failures[0].message);
      } else if (skippedHostedFamilies.length) {
        hostedAnalysisError = `The $${scanBudgetUsd.toFixed(3)} cloud safety ceiling was reached before ${skippedHostedFamilies.length} ${skippedHostedFamilies.length === 1 ? 'family' : 'families'} could be classified.`;
      } else if (!hostedStatus.available && unresolvedFamilies) {
        hostedAnalysisError = hostedStatus.message;
      }
      if (!hostedTotal) progress(
        'hosted-analysis',
        'Analysing new visual families',
        hostedStatus.available
           ? `No cloud families were queued under the active policy, so ${unresolvedFamilies} ${unresolvedFamilies === 1 ? 'family remains' : 'families remain'} provisional.`
          : hostedStatus.message,
        80,
      );
      progress(
        'reconciliation',
        'Applying local consistency checks',
        'Aligning hierarchy and family context without another model request.',
        84,
      );
      // The family pass already receives sibling and hierarchy context. The final
      // local context pass is enough for the normal scan and avoids another series
      // of slow model calls over the same document.
      reconciliation = {
        summary: 'Local consistency pass applied after visual analysis.',
        issues: [],
      };
    } catch (error) {
      if (hostedAnalysisStartedAt) stageTimings.hostedAnalysisMs = Date.now() - hostedAnalysisStartedAt;
      hostedAnalysisError = safeHostedFailureMessage(error);
      diagnosticsFailureMessages = [hostedAnalysisError];
      reviewed = applyHostedFamilyAnalyses(reviewed, families, []);
      trace('hosted-analysis', 'Cloud analysis failed; affected families remain unresolved.', { error: hostedAnalysisError });
    }
    progress('finalizing', 'Preparing automatic build', 'Applying hierarchy context and arranging the AI decisions.', 94);
    const finalizationStartedAt = Date.now();
    reviewed = prepareComponentsForReview(reviewed);
    stageTimings.finalizationMs = Date.now() - finalizationStartedAt;
    trace('finalization', 'Scan finalization completed.', {
      components: reviewed.length,
      exportTargets: reviewed.filter((component) => component.exportTarget).length,
      unresolved: reviewed.filter((component) => component.assetType === 'Unknown' || component.analysisState === 'needs-review' || component.analysisState === 'provisional').length,
      elapsedMs: stageTimings.finalizationMs,
    });
    progress('complete', 'Scan complete', `${reviewed.length} components are ready for automatic asset creation.`, 100);
    return {
      ...scan,
      components: reviewed,
      reconciliation,
      hostedAnalysisAvailable,
      hostedAnalysisError,
      hostedProviderCostUsd,
      hostedTargetUsd,
      hostedBudgetUsd,
      scanIntent: { ...scanIntent, structureFingerprint: intentFingerprint },
      diagnostics: {
        totalMs: Date.now() - scanStartedAt,
        stages: stageTimings,
        visualFamilyCount: families.length,
        hostedFamilyCount: diagnosticsHostedFamilies,
        hostedRequestCount: diagnosticsHostedRequests,
        providerRequestCount: diagnosticsProviderRequests,
        affinityRequestCount: diagnosticsAffinityRequests,
        affinityRetryCount: diagnosticsAffinityRetries,
        affinitySplitCount: diagnosticsAffinitySplits,
        affinitySlowestRequestMs: diagnosticsAffinitySlowestRequestMs,
        cachedFamilyCount: diagnosticsCachedFamilies,
        failedFamilyCount: diagnosticsFailedFamilies,
        budgetLimitedFamilyCount: diagnosticsBudgetLimitedFamilies,
        failureMessages: diagnosticsFailureMessages,
        notes: scanNotes,
        warnings: scanWarnings,
        ...(developerMode ? { trace: traceEntries } : {}),
      },
    };
  } catch (error) {
    if (scanController.signal.aborted) throw new Error('Component scan cancelled.');
    throw error;
  } finally {
    if (activeComponentScans.get(event.sender.id) === scanController) activeComponentScans.delete(event.sender.id);
    await removeScanDirectory(directory).catch(() => undefined);
  }
});

ipcMain.handle('kryeo:cancel-component-scan', (event) => {
  const controller = activeComponentScans.get(event.sender.id);
  if (!controller) return false;
  controller.abort();
  activeComponentScans.delete(event.sender.id);
  return true;
});

ipcMain.handle('kryeo:get-local-ai-status', () => localAi.status());
ipcMain.handle('kryeo:get-hosted-ai-status', () => hostedAi.status());
ipcMain.handle('kryeo:explain-component-family', (_event, input: unknown) => {
  const request = input as HostedFamilyEvidenceRequest;
  if (!request || typeof request !== 'object' || !String(request.visualHash || '') || !String(request.previewUrl || '')) {
    throw new Error('A visual family is required before Kryeo can request evidence.');
  }
  return hostedAi.explainFamily(request);
});
ipcMain.handle('kryeo:configure-hosted-ai', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid Kryeo AI configuration.');
  const configuration = input as Partial<HostedAiConfiguration>;
  if (typeof configuration.endpoint !== 'string' || typeof configuration.token !== 'string') {
    throw new Error('Invalid Kryeo AI configuration.');
  }
  return hostedAi.configure({ endpoint: configuration.endpoint, token: configuration.token });
});
ipcMain.handle('kryeo:get-assistant-status', () => assistant.status());
ipcMain.handle('kryeo:install-assistant', (_event, input: unknown) => {
  const pack: AssistantModelPack = input === 'balanced' ? 'balanced' : 'portable';
  return assistant.install(pack);
});
ipcMain.handle('kryeo:chat-with-assistant', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid assistant request.');
  const request = input as Partial<AssistantChatRequest>;
  if (typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200 || typeof request.project !== 'string' || request.project.length > 100 || typeof request.sessionId !== 'string' || !request.sessionId || !request.document) {
    throw new Error('Invalid assistant request.');
  }
  const safeRequest: AssistantChatRequest = {
    project: request.project.trim() || 'General',
    sessionId: request.sessionId,
    message: request.message.trim(),
    document: request.document,
    useVision: request.useVision !== false,
  };
  const snapshot = await workspace.snapshot();
  let visualDirectory = '';
  let visualContext: AssistantVisualContext | undefined;
  if (safeRequest.useVision && safeRequest.document.open && shouldUseAssistantVision(safeRequest.message)) {
    visualDirectory = path.join(app.getPath('desktop'), 'Kryeo', 'ComponentScanStaging', `assistant-${randomUUID()}`);
    await resetScanDirectory(visualDirectory);
    try {
      const rawPath = path.join(visualDirectory, 'document-source.png');
      const preview = await affinity.exportAssistantPreview(rawPath, safeRequest.document.selectionCount > 0 ? 'selection' : 'document');
      const status = await assistant.status();
      const images = await buildAssistantVisualImages(rawPath, visualDirectory, status.profile);
      visualContext = { images, documentTitle: preview.documentTitle, documentSessionUuid: preview.documentSessionUuid };
    } catch {
      visualContext = undefined;
    }
  }
  let result;
  try {
    try {
      result = await hostedAi.chat(safeRequest, snapshot, visualContext);
    } catch {
      result = await assistant.chat(safeRequest, snapshot, visualContext);
    }
  } finally {
    if (visualDirectory) await removeScanDirectory(visualDirectory).catch(() => undefined);
  }
  const createdAt = new Date().toISOString();
  const userMessage: AssistantMessage = { id: randomUUID(), project: safeRequest.project, sessionId: safeRequest.sessionId, role: 'user', text: safeRequest.message, createdAt };
  const assistantMessage: AssistantMessage = { id: randomUUID(), project: safeRequest.project, sessionId: safeRequest.sessionId, role: 'assistant', text: result.text, visionUsed: result.visionUsed, createdAt: new Date().toISOString() };
  const nextWorkspace = await workspace.saveAssistantExchange(userMessage, assistantMessage, result.memories);
  return { message: assistantMessage, memories: result.memories, actions: result.actions, visionUsed: result.visionUsed, workspace: nextWorkspace };
});
ipcMain.handle('kryeo:forget-assistant-memory', (_event, id: unknown) => {
  if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid assistant memory.');
  return workspace.forgetAssistantMemory(id);
});
ipcMain.handle('kryeo:clear-assistant-memories', () => workspace.clearAssistantMemories());
ipcMain.handle('kryeo:set-assistant-memory-scope', (_event, id: unknown, scope: unknown, project: unknown) => {
  if (typeof id !== 'string' || (scope !== 'project' && scope !== 'global') || typeof project !== 'string' || project.length > 100) throw new Error('Invalid assistant memory scope.');
  return workspace.setAssistantMemoryScope(id, scope, project);
});
ipcMain.handle('kryeo:create-assistant-session', (_event, project: unknown) => {
  if (typeof project !== 'string' || project.length > 100) throw new Error('Invalid project name.');
  return workspace.createAssistantSession(project);
});
ipcMain.handle('kryeo:update-assistant-session', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid conversation update.');
  const request = input as { id?: unknown; title?: unknown; pinned?: unknown; archived?: unknown };
  if (typeof request.id !== 'string') throw new Error('Invalid conversation update.');
  return workspace.updateAssistantSession(request.id, {
    ...(typeof request.title === 'string' ? { title: request.title } : {}),
    ...(typeof request.pinned === 'boolean' ? { pinned: request.pinned } : {}),
    ...(typeof request.archived === 'boolean' ? { archived: request.archived } : {}),
  });
});
ipcMain.handle('kryeo:delete-assistant-session', (_event, id: unknown) => {
  if (typeof id !== 'string') throw new Error('Invalid conversation.');
  return workspace.deleteAssistantSession(id);
});
ipcMain.handle('kryeo:export-assistant-session', async (_event, id: unknown) => {
  if (typeof id !== 'string') throw new Error('Invalid conversation.');
  const record = await workspace.assistantSession(id);
  if (!record) throw new Error('Conversation was not found.');
  const parent = BrowserWindow.getFocusedWindow();
  const saveOptions = {
    title: 'Export Kryeo conversation',
    defaultPath: `${record.session.title.replace(/[<>:"/\\|?*]/g, '-')} - Kryeo.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  };
  const result = parent ? await dialog.showSaveDialog(parent, saveOptions) : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) return false;
  const markdown = [`# ${record.session.title}`, '', `Project: ${record.session.project}`, `Exported: ${new Date().toISOString()}`, '']
    .concat(record.messages.flatMap((message) => [`## ${message.role === 'user' ? 'You' : 'Kryeo'}`, '', message.text, '']))
    .join('\n');
  await fs.writeFile(result.filePath, `${markdown}\n`, 'utf8');
  return true;
});
ipcMain.handle('kryeo:import-assistant-session', async (_event, project: unknown) => {
  if (typeof project !== 'string' || project.length > 100) throw new Error('Invalid project name.');
  const parent = BrowserWindow.getFocusedWindow();
  const importOptions: OpenDialogOptions = { title: 'Import Kryeo conversation', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] };
  const result = parent ? await dialog.showOpenDialog(parent, importOptions) : await dialog.showOpenDialog(importOptions);
  if (result.canceled || !result.filePaths[0]) return workspace.snapshot();
  const markdown = await fs.readFile(result.filePaths[0], 'utf8');
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(result.filePaths[0], path.extname(result.filePaths[0]));
  const parts = [...markdown.matchAll(/^##\s+(You|Kryeo)\s*\r?\n+([\s\S]*?)(?=^##\s+|\s*$)/gim)];
  const messages = parts.map(([_, role, text]) => ({
    role: role === 'You' ? 'user' : 'assistant' as const,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    project,
    sessionId: randomUUID(),
  })) as AssistantMessage[];
  if (!messages.length) return workspace.snapshot();
  const sessionId = randomUUID();
  const session = { id: sessionId, project, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pinned: false, archived: false };
  return await workspace.importAssistantSession(project, title, messages);
});

function createApp(): void {
  createWindow();
  void affinity.reconnect();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(createApp);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void affinity.close();
});
