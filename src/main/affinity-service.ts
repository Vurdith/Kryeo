import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  AffinityStatus,
  ConfiguredToolRequest,
  ComponentBounds,
  DocumentContext,
  KryeoTool,
  PlaceAssetRequest,
  ScriptRunResult,
  SaveAssetRequest,
  ToolCategory,
  ApplyComponentOrganizationRequest,
  ApplyLayerNamesRequest,
} from '../shared/types';
import type { LibraryStoragePaths } from './library-service';

export interface AffinityComponentExport {
  index: number;
  name: string;
  affinityType: string;
  bounds: ComponentBounds;
  childCount: number;
  descendantCount: number;
  textCount: number;
  semanticNames: string[];
  path: string;
  hierarchyKey: string;
  parentHierarchyKey: string;
  hierarchyDepth: number;
  previewFallback?: boolean;
  members: Array<{ path: number[]; name: string; affinityType: string; bounds: ComponentBounds }>;
  grouping: 'single' | 'existing-group' | 'overlap';
}

export interface AffinityScanPartitionPlan {
  path: number[];
  parentPath: number[];
  parentName: string;
  parentType: string;
  parentHierarchyKey: string;
  hierarchyDepth: number;
  mode: 'candidate' | 'subtree';
  ancestorPaths: number[][];
  // A cheap Affinity-side approximation used only to avoid combining several
  // dense or very large sections in the same remote script.
  estimatedWork?: number;
}

export interface AffinityComponentExportBatch {
  documentTitle: string;
  documentSessionUuid: string;
  sourceName: string;
  components: AffinityComponentExport[];
  totalCandidates?: number;
  totalPartitions?: number;
  partitionIndex?: number;
  partitionPlan?: AffinityScanPartitionPlan[];
  exportDiagnostics?: {
    requestCount: number;
    retryCount: number;
    splitCount: number;
    slowestRequestMs: number;
    averageRequestMs: number;
  };
}

export interface AffinityAssistantPreview {
  path: string;
  documentTitle: string;
  documentSessionUuid: string;
}

const SERVER_URL = 'http://localhost:6767/sse';
const CONNECT_TIMEOUT_MS = 3500;
const REQUEST_TIMEOUT_MS = 6500;
// Component export is constrained by Affinity's remote script window, rather
// than by the MCP round-trip alone. Start conservatively, grow after quick
// batches, and shrink before a slow document turns into a timeout.
const INITIAL_COMPONENT_EXPORT_PARTITIONS = 4;
const MAX_COMPONENT_EXPORT_PARTITIONS = 12;
// Start inside the known-safe window, then let fast real batches earn a larger
// work allowance. The previous fixed limit made a large document pay a remote
// Affinity round-trip for many tiny, already-safe batches.
const INITIAL_COMPONENT_EXPORT_BATCH_WORK = 24;
const MIN_COMPONENT_EXPORT_BATCH_WORK = 12;
const MAX_COMPONENT_EXPORT_BATCH_WORK = 56;
const FAST_COMPONENT_EXPORT_BATCH_MS = 18_000;
const SLOW_COMPONENT_EXPORT_BATCH_MS = 42_000;
// DocumentViewApi.setZoom uses inverse scale rather than the percentage shown
// by Affinity's UI. On Affinity 3.2, 0.001 produces the maximum practical
// zoom-in (about 1000%); large values produce a zoomed-out canvas.
const SCAN_VIEWPORT_MIN_SCALE = 0.001;
const SCAN_VIEWPORT_MAX_ZOOM_PERCENT = 1_000;
const SCAN_VIEWPORT_SETTLE_STEP_MS = 100;
const SCAN_VIEWPORT_SETTLE_ATTEMPTS = 50;
const SCAN_VIEWPORT_TIMEOUT_MS = 120_000;
const SCAN_VIEWPORT_READ_MARKER = 'KRYEO_SCAN_VIEWPORT_READ:';
const SCAN_VIEWPORT_MARKER = 'KRYEO_SCAN_VIEWPORT:';
const SCAN_VIEWPORT_RESTORE_MARKER = 'KRYEO_SCAN_VIEWPORT_RESTORE:';

type TextContent = { type: 'text'; text: string };

function textFromResult(result: { content?: unknown[] }): string {
  return (result.content ?? [])
    .filter((item): item is TextContent => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<TextContent>;
      return candidate.type === 'text' && typeof candidate.text === 'string';
    })
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Affinity did not respond in time.')), milliseconds);
    }),
  ]);
}

export interface AffinityComponentAssetRequest {
  id: string;
  name: string;
  sourcePaths: number[][];
  sourcePath: string;
  rasterPath: string;
}

export interface AffinityComponentAssetResult {
  id: string;
  sourcePath: string;
  rasterPath: string;
}

function isRecoverableComponentExportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:MCP error -32001|MCP error -32000|request timed out|timed out|connection closed|connection was interrupted|Affinity did not respond in time)/i.test(message);
}

function componentExportBatchCount(
  partitions: AffinityScanPartitionPlan[],
  start: number,
  maxCount: number,
  maxWork = MAX_COMPONENT_EXPORT_BATCH_WORK,
): number {
  let count = 0;
  let totalWork = 0;
  while (start + count < partitions.length && count < maxCount) {
    const partition = partitions[start + count];
    const work = Math.max(1, Math.round(Number(partition?.estimatedWork || 1)));
    if (count > 0 && totalWork + work > maxWork) break;
    totalWork += work;
    count += 1;
    if (totalWork >= maxWork) break;
  }
  return Math.max(1, count);
}

function versionParts(value: string): number[] {
  return value.split('.').map((part) => Number(part) || 0);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function toolFromTitle(title: string): KryeoTool {
  const versionMatch = title.match(/\bv(\d+(?:\.\d+)*)\b/i);
  const version = versionMatch?.[1] ?? '1';
  const baseTitle = title.replace(/\s+v\d+(?:\.\d+)*\s*$/i, '').trim();
  let category: ToolCategory = 'Utilities';
  let icon: KryeoTool['icon'] = 'script';
  let description = 'Run this Affinity workflow against the current document.';
  let displayName = baseTitle;
  let featured = false;

  if (/asset library\s*-\s*save/i.test(title)) {
    category = 'Assets';
    icon = 'save';
    displayName = 'Save asset';
    description = 'Package the current selection as a centred, versioned asset document.';
    featured = true;
  } else if (/asset library\s*-\s*load/i.test(title)) {
    category = 'Assets';
    icon = 'folder-open';
    displayName = 'Load asset';
    description = 'Load a saved asset document from your indexed library.';
    featured = true;
  } else if (/asset library\s*-\s*update/i.test(title)) {
    category = 'Assets';
    icon = 'refresh';
    displayName = 'Update asset';
    description = 'Create the next version while preserving the asset structure.';
  } else if (/asset library\s*-\s*export/i.test(title)) {
    category = 'Assets';
    icon = 'package';
    displayName = 'Export asset';
    description = 'Export the prepared raster version from an asset document.';
  } else if (/pixel helper/i.test(title)) {
    category = 'Pixel tools';
    icon = 'wand';
    displayName = baseTitle.replace(/^Pixel Helper\s*-\s*/i, '');
    description = /shade/i.test(title)
      ? 'Apply controlled pixel shading to the selected artwork.'
      : 'Run a pixel-focused Affinity workflow.';
    featured = /hand shade/i.test(title);
  } else if (/mirror|symmetr|corner mirror/i.test(title)) {
    category = 'Symmetry';
    icon = 'symmetry';
    displayName = baseTitle
      .replace(/^Mirror Helper\s*-\s*/i, '')
      .replace(/^Corner Mirror\s*-\s*/i, '');
    description = 'Align or transform selected artwork for mirrored construction.';
  }

  const id = baseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id, title, displayName, description, category, version, icon, featured };
}

function newestTools(titles: string[]): KryeoTool[] {
  const newest = new Map<string, KryeoTool>();
  for (const title of titles) {
    const tool = toolFromTitle(title);
    const current = newest.get(tool.id);
    if (!current || compareVersions(tool.version, current.version) > 0) newest.set(tool.id, tool);
  }
  return [...newest.values()].sort((left, right) => {
    if (left.category !== right.category) return left.category.localeCompare(right.category);
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

function replaceModalBlock(code: string, startNeedle: string, injected: string): string {
  const start = code.indexOf(startNeedle);
  if (start < 0) throw new Error('The installed script no longer matches Kryeo\'s workflow adapter.');
  const modalNeedle = 'if (dlg.runModal().value != DialogResult.Ok) return;';
  const alternateNeedle = 'if (dialogResult.value != DialogResult.Ok) return;';
  let modal = code.indexOf(modalNeedle, start);
  let endLength = modalNeedle.length;
  if (modal < 0) {
    modal = code.indexOf(alternateNeedle, start);
    endLength = alternateNeedle.length;
  }
  if (modal < 0) throw new Error('Could not locate the installed script dialog boundary.');
  return code.slice(0, start) + injected + code.slice(modal + endLength);
}

function instrumentAlerts(code: string): string {
  const replaced = code.replace(/\bapp\.alert\(/g, 'kryeoAlert(');
  return replaced.replace(
    /(['"]use strict['"];?)/,
    `$1\nfunction kryeoAlert(message, heading) { console.log('KRYEO_ALERT:' + JSON.stringify({ title: heading || 'Affinity', message: String(message) })); }`,
  );
}

function replaceLibraryFunction(code: string, name: string, replacement: string): string {
  const pattern = new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`);
  const patched = code.replace(pattern, replacement);
  if (patched === code) throw new Error(`The installed Asset Library script does not expose ${name} for Kryeo.`);
  return patched;
}

function patchLibraryScriptPaths(code: string, paths: LibraryStoragePaths): string {
  let patched = code;
  const assets = JSON.stringify(paths.assets);
  const exportsRoot = JSON.stringify(paths.exports);
  if (/function configuredLibraryRoot\(\)/.test(patched)) {
    patched = replaceLibraryFunction(patched, 'configuredLibraryRoot', `function configuredLibraryRoot() { return ${assets}; }`);
  }
  if (/function getSetupConfig\(\)/.test(patched)) {
    patched = replaceLibraryFunction(patched, 'getSetupConfig', `function getSetupConfig() { return { assetsRoot: ${assets}, exportsRoot: ${exportsRoot} }; }`);
  }
  if (/function exportRoot\(\)/.test(patched)) {
    patched = replaceLibraryFunction(patched, 'exportRoot', `function exportRoot() { return ${exportsRoot}; }`);
  }
  if (/function libraryRoot\(\)/.test(patched)) {
    patched = replaceLibraryFunction(patched, 'libraryRoot', `function libraryRoot() { return ${assets}; }`);
  }
  return patched;
}

export class AffinityService {
  private readonly libraryPaths?: () => Promise<LibraryStoragePaths>;
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private status: AffinityStatus = {
    state: 'disconnected',
    message: 'Affinity is not connected.',
    serverUrl: SERVER_URL,
    checkedAt: new Date().toISOString(),
  };

  constructor(libraryPaths?: () => Promise<LibraryStoragePaths>) {
    this.libraryPaths = libraryPaths;
  }

  getStatus(): AffinityStatus {
    return this.status;
  }

  private setStatus(state: AffinityStatus['state'], message: string): void {
    this.status = { state, message, serverUrl: SERVER_URL, checkedAt: new Date().toISOString() };
  }

  private markDisconnected(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.setStatus('error', `Affinity connection lost: ${message}`);
    if (transport) {
      void withTimeout(transport.close(), 800).catch(() => undefined);
    }
  }

  private async callTool(name: string, args: Record<string, unknown>, timeout = REQUEST_TIMEOUT_MS): Promise<{
    content?: unknown[];
    isError?: boolean;
  }> {
    const client = this.client;
    if (!client) throw new Error('Affinity is not connected.');
    try {
      return await withTimeout(
        client.request(
          { method: 'tools/call', params: { name, arguments: args } },
          CallToolResultSchema,
        ),
        timeout,
      );
    } catch (error) {
      if (this.client === client) this.markDisconnected(error);
      throw error;
    }
  }

  private async prepareScanViewport(): Promise<number | null> {
    // Read the original zoom in a separate, side-effect-free script. If the
    // mutation script times out after Affinity has already changed the view,
    // this value still reaches the finally block and cleanup can restore it.
    const readScript = `
'use strict';
const { DocumentViewApi } = require('affinity:dom');
const view = DocumentViewApi.getCurrent();
const zoom = view ? Number(DocumentViewApi.getZoom(view)) : NaN;
console.log(${JSON.stringify(SCAN_VIEWPORT_READ_MARKER)} + JSON.stringify({
  zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : null,
}));`;
    let originalZoom: number | null = null;
    try {
      const result = await this.callTool('execute_script', { script: readScript }, SCAN_VIEWPORT_TIMEOUT_MS);
      const line = textFromResult(result)
        .split(/\r?\n/)
        .find((value) => value.startsWith(SCAN_VIEWPORT_READ_MARKER));
      if (!line) return null;
      const payload = JSON.parse(line.slice(SCAN_VIEWPORT_READ_MARKER.length)) as { zoom?: unknown };
      const zoom = Number(payload.zoom);
      originalZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : null;
    } catch {
      // View optimization is best effort. An SDK/version without DocumentView
      // support must not prevent the normal component scan from running.
      return null;
    }
    if (originalZoom === null) return null;

    const script = `
'use strict';
const { DocumentViewApi } = require('affinity:dom');
const timers = require('affinity:timers');
const view = DocumentViewApi.getCurrent();
let preparedZoom = NaN;
if (view) {
  DocumentViewApi.setZoom(view, ${SCAN_VIEWPORT_MIN_SCALE});
  for (let attempt = 0; attempt < ${SCAN_VIEWPORT_SETTLE_ATTEMPTS}; attempt += 1) {
    preparedZoom = Number(DocumentViewApi.getZoom(view));
    if (Number.isFinite(preparedZoom) && preparedZoom >= ${SCAN_VIEWPORT_MAX_ZOOM_PERCENT} * 0.99) break;
    timers.sleep(${SCAN_VIEWPORT_SETTLE_STEP_MS});
  }
}
console.log(${JSON.stringify(SCAN_VIEWPORT_MARKER)} + JSON.stringify({
  zoom: ${JSON.stringify(originalZoom)},
  preparedZoom: Number.isFinite(preparedZoom) && preparedZoom > 0 ? preparedZoom : null,
}));`;
    try {
      await this.callTool('execute_script', { script }, SCAN_VIEWPORT_TIMEOUT_MS);
    } catch {
      // Cleanup still runs with the captured original zoom if the mutation
      // script fails after Affinity has changed the view.
    }
    return originalZoom;
  }

  private async restoreScanViewport(originalZoom: number | null): Promise<void> {
    if (originalZoom === null) return;
    const restoreScale = 100 / originalZoom;
    if (!Number.isFinite(restoreScale) || restoreScale <= 0) return;
    const script = `
'use strict';
const { DocumentViewApi } = require('affinity:dom');
const view = DocumentViewApi.getCurrent();
if (view) DocumentViewApi.setZoom(view, ${JSON.stringify(restoreScale)});
console.log(${JSON.stringify(SCAN_VIEWPORT_RESTORE_MARKER)} + JSON.stringify({ zoom: ${JSON.stringify(originalZoom)} }));`;
    try {
      await this.callTool('execute_script', { script }, SCAN_VIEWPORT_TIMEOUT_MS);
    } catch {
      // The scan result is still valid if Affinity closes before the viewport
      // can be restored; do not turn cleanup into a scan failure.
    }
  }

  async connect(force = false): Promise<void> {
    if (this.client && !force) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.setStatus('connecting', 'Connecting to Affinity...');
      await this.close();

      try {
        const client = new Client({ name: 'kryeo-desktop', version: '0.1.0' });
        const transport = new SSEClientTransport(new URL(SERVER_URL));
        transport.onerror = () => {
          if (this.transport === transport) this.markDisconnected(new Error('The Affinity connection was interrupted.'));
        };
        // Retain the transport before the handshake starts so a timed-out
        // connect can close its underlying SSE request and not leak a session
        // in Affinity's local MCP server.
        this.transport = transport;
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);
        this.client = client;

        const preamble = await this.callTool('read_sdk_documentation_topic', { filename: 'preamble' });
        if (preamble.isError) throw new Error('Affinity rejected the SDK preamble request.');
        this.setStatus('connected', 'Affinity is connected and ready.');
      } catch (error) {
        await this.close();
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus('error', message);
        throw error;
      }
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async reconnect(): Promise<AffinityStatus> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.connect(true);
        return this.status;
      } catch (error) {
        lastError = error;
        await this.close();
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError || 'Affinity did not respond.');
    this.setStatus('error', `Affinity could not reconnect after two attempts: ${message}`);
    return this.status;
  }

  async listTools(): Promise<KryeoTool[]> {
    await this.connect();
    try {
      const result = await this.callTool('list_library_scripts', {});
      const text = textFromResult(result);
      if (result.isError || !text) throw new Error('Affinity returned no scripts.');
      const titles = text.split(',').map((title) => title.trim()).filter((title) => Boolean(title) && !/asset library\s*-\s*setup/i.test(title));
      const tools = newestTools(titles);
      tools.push({
        id: 'place-asset',
        title: 'Kryeo - Place Asset',
        displayName: 'Place asset',
        description: 'Place a saved Master, Base, or Raster layer into the active document.',
        category: 'Assets',
        version: '1',
        icon: 'package',
        featured: true,
      });
      return tools;
    } catch (error) {
      this.client = null;
      throw error;
    }
  }

  async runTool(title: string): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    if (/asset library\s*-\s*setup/i.test(title)) {
      return {
        ok: false,
        title,
        output: 'Asset Library setup is embedded in Kryeo. Open Assets to manage the library.',
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    await this.connect();
    try {
      const scriptResult = await this.callTool('read_library_script', { title });
      let code = textFromResult(scriptResult);
      if (scriptResult.isError || !code) throw new Error(`Could not read "${title}" from Affinity.`);
      if (this.libraryPaths && /asset library\s*-\s*(load|save|update|export)/i.test(title)) {
        code = patchLibraryScriptPaths(code, await this.libraryPaths());
      }

      const runResult = await this.callTool('execute_script', { script: code });
      const output = textFromResult(runResult);
      const failed = runResult.isError || /^ERROR:/im.test(output);
      return {
        ok: !failed,
        title,
        output: output || (failed ? 'Affinity reported an error.' : 'Workflow started in Affinity.'),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        title,
        output: message,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async openAsset(assetPath: string, displayName: string): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = `Open asset: ${displayName}`;
    await this.connect();
    try {
      const script = `
'use strict';
const { Document } = require('/document');
const assetPath = ${JSON.stringify(assetPath)};
Document.load(assetPath);
console.log('KRYEO_ASSET_OPENED:' + assetPath);
`;
      const result = await this.callTool('execute_script', { script });
      const output = textFromResult(result);
      const failed = result.isError || /^ERROR:/im.test(output);
      return {
        ok: !failed,
        title,
        output: failed ? (output || 'Affinity could not open the asset.') : `Opened ${displayName} in Affinity.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        title,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async saveAsset(request: SaveAssetRequest): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = `Save asset: ${request.displayName}`;
    await this.connect();

    try {
      const libraryResult = await this.callTool('list_library_scripts', {});
      const saveTitles = textFromResult(libraryResult)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => /asset library\s*-\s*save\s+v/i.test(value))
        .sort((left, right) => {
          const leftVersion = left.match(/\bv(\d+(?:\.\d+)*)/i)?.[1] ?? '0';
          const rightVersion = right.match(/\bv(\d+(?:\.\d+)*)/i)?.[1] ?? '0';
          return compareVersions(rightVersion, leftVersion);
        });
      const saveTitle = saveTitles[0];
      if (!saveTitle) throw new Error('No Asset Library Save script is installed in Affinity.');

      const scriptResult = await this.callTool('read_library_script', { title: saveTitle });
      let code = textFromResult(scriptResult);
      if (scriptResult.isError || !code) throw new Error(`Could not read "${saveTitle}" from Affinity.`);
      if (this.libraryPaths) code = patchLibraryScriptPaths(code, await this.libraryPaths());

      const dialogStart = code.indexOf('const dlg = buildDialog(defaultName, {');
      const saveStart = code.indexOf('// FIX (v4.24)', dialogStart);
      if (dialogStart < 0 || saveStart < 0) {
        throw new Error(`${saveTitle} is not compatible with Kryeo's guided save workflow.`);
      }

      const value = (input: unknown) => JSON.stringify(input);
      const injectedDialog = `const dlg = {
  displayName: { text: ${value(request.displayName)} },
  codeName: { text: ${value(request.codeName)} },
  project: { text: ${value(request.project)} },
  category: { text: ${value(request.category)} },
  subcategory: { text: ${value(request.subcategory)} },
  tags: { text: ${value(request.tags)} },
  notes: { text: ${value(request.notes)} },
  batch: { value: ${value(request.batch)} },
  update: { value: ${value(request.update)} },
  baseCopy: { value: ${value(request.baseCopy)} },
  rasterCopy: { value: ${value(request.rasterCopy)} },
};

const baseConfig = {
  displayName: dlg.displayName.text,
  codeName: dlg.codeName.text,
  name: dlg.codeName.text,
  project: dlg.project.text,
  category: dlg.category.text,
  subcategory: effectiveSubcategory(dlg.category.text, dlg.subcategory.text),
  tags: dlg.tags.text.split(',').map((tag) => tag.trim()).filter(Boolean),
  notes: dlg.notes.text || '',
  update: dlg.update.value,
  baseCopy: dlg.baseCopy.value,
  rasterCopy: dlg.rasterCopy.value,
};

`;
      code = code.slice(0, dialogStart) + injectedDialog + code.slice(saveStart);
      code = code.replace(/\.AssetLibraryStaging/g, 'KryeoStaging');
      code = code.replace(/\bapp\.alert\(/g, 'kryeoAlert(');
      code = code.replace(
        /(['"]use strict['"];?)/,
        `$1\nfunction kryeoAlert(message, heading) { console.log('KRYEO_ALERT:' + JSON.stringify({ title: heading || 'Affinity', message: String(message) })); }`,
      );
      code = code.replace(
        'showSaveConfirmation(saved);',
        `console.log('KRYEO_SAVE_RESULT:' + JSON.stringify(saved));`,
      );

      const runResult = await this.callTool('execute_script', { script: code }, 240_000);
      const output = textFromResult(runResult);
      const errorMarker = 'KRYEO_ALERT:';
      const resultMarker = 'KRYEO_SAVE_RESULT:';
      const resultIndex = output.lastIndexOf(resultMarker);

      if (runResult.isError || resultIndex < 0) {
        const alertIndex = output.lastIndexOf(errorMarker);
        if (alertIndex >= 0) {
          const alertLine = output.slice(alertIndex + errorMarker.length).split(/\r?\n/, 1)[0];
          try {
            const alert = JSON.parse(alertLine) as { message?: string };
            throw new Error(alert.message || 'Affinity could not save the asset.');
          } catch (error) {
            if (error instanceof SyntaxError) throw new Error('Affinity could not save the asset.');
            throw error;
          }
        }
        throw new Error(output || 'Affinity did not return a save confirmation.');
      }

      const resultLine = output.slice(resultIndex + resultMarker.length).split(/\r?\n/, 1)[0];
      const records = JSON.parse(resultLine) as Array<{ displayName?: string; version?: number; path?: string }>;
      const record = records[0];
      return {
        ok: true,
        title,
        output: record
          ? `Saved ${record.displayName || request.displayName} v${record.version || 1} to ${record.path || 'the asset library'}.`
          : `Saved ${request.displayName} to the asset library.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        title,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async runConfiguredTool(request: ConfiguredToolRequest): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    if (/asset library\s*-\s*setup/i.test(request.title)) {
      return {
        ok: false,
        title: request.title,
        output: 'Asset Library setup is embedded in Kryeo. Open Assets to manage the library.',
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    await this.connect();
    try {
      const scriptResult = await this.callTool('read_library_script', { title: request.title });
      let code = textFromResult(scriptResult);
      if (scriptResult.isError || !code) throw new Error(`Could not read "${request.title}" from Affinity.`);
      if (this.libraryPaths) code = patchLibraryScriptPaths(code, await this.libraryPaths());
      const value = (key: string, fallback: string | number | boolean) => JSON.stringify(request.values[key] ?? fallback);

      if (request.kind === 'export') {
        code = replaceModalBlock(code, "const dlg = Dialog.create('Export Project Assets');", `const kryeoProject = ${value('project', 'Default Project')};
const dlg = {
  project: { selectedIndex: Math.max(0, projects.indexOf(kryeoProject)) },
  preset: { text: ${value('preset', 'PNG (Pixel)')} },
  latest: { value: ${value('latest', true)} },
  stable: { value: ${value('stable', true)} },
};`);
      } else if (request.kind === 'update') {
        code = replaceModalBlock(code, 'const dlg = buildUpdateDialog(doc, root, globalIndex, currentRecord);', `const dlg = {
  rebuildBase: { value: ${value('rebuildBase', true)} },
  rebuildRaster: { value: ${value('rebuildRaster', true)} },
  defaultVisibility: { value: ${value('defaultVisibility', true)} },
  changeNote: { text: ${value('changeNote', '')} },
};`);
      } else if (request.kind === 'shade') {
        code = replaceModalBlock(code, "const dlg = Dialog.create('Pixel Helper - Hand Shade');", `const dlg = {
  light: { selectedIndex: ${value('light', 0)} },
  mode: { selectedIndex: ${value('mode', 0)} },
  style: { selectedIndex: ${value('style', 23)} },
  scope: { selectedIndex: ${value('scope', 0)} },
  fadeMode: { selectedIndex: ${value('fadeMode', 0)} },
  palette: { selectedIndex: ${value('palette', 1)} },
  detailScale: { selectedIndex: ${value('detailScale', 1)} },
  affect: { selectedIndex: ${value('affect', 0)} },
  outlineMode: { selectedIndex: ${value('outlineMode', 1)} },
  protectOutlines: { value: ${value('protectOutlines', false)} },
  protectHighlights: { value: ${value('protectHighlights', false)} },
  strength: { selectedIndex: ${value('strength', 1)} },
  texture: { selectedIndex: ${value('texture', 1)} },
  highlightVariation: { selectedIndex: ${value('highlightVariation', 1)} },
  placement: { selectedIndex: ${value('placement', 0)} },
  dither: { value: ${value('dither', false)} },
};`);
      }

      code = instrumentAlerts(code);
      const runResult = await this.callTool('execute_script', { script: code }, 240_000);
      const output = textFromResult(runResult);
      const alerts = [...output.matchAll(/KRYEO_ALERT:(\{[^\r\n]+\})/g)].map((match) => {
        try { return JSON.parse(match[1]) as { title?: string; message?: string }; } catch { return {}; }
      });
      const failure = alerts.find((alert) => /fail|error/i.test(alert.title || ''));
      if (runResult.isError || failure) throw new Error(failure?.message || output || 'Affinity could not complete the workflow.');
      const finalAlert = alerts.at(-1);
      return {
        ok: true,
        title: request.title,
        output: finalAlert?.message || `${request.title} completed in Affinity.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        title: request.title,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async preparePlaceAsset(request: PlaceAssetRequest): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = `Place ${request.layerKind}: ${request.displayName}`;
    await this.connect();
    try {
      const script = `
'use strict';
const { Document } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const targetSessionUuid = ${JSON.stringify(request.targetSessionUuid)};
const assetPath = ${JSON.stringify(request.path)};
const requestedKind = ${JSON.stringify(request.layerKind)};
const target = Document.current;
if (!target || String(target.sessionUuid || '') !== targetSessionUuid) {
  throw new Error('The active document changed before placement started.');
}
function countNodes(doc) {
  let count = 0;
  function visit(node) {
    count += 1;
    try { for (const child of node.children) visit(child); } catch (_) {}
  }
  for (const spread of doc.spreads) for (const node of spread.children) visit(node);
  return count;
}
const targetNodeCount = countNodes(target);
const assetDoc = Document.load(assetPath);
const expected = '[' + requestedKind.charAt(0).toUpperCase() + requestedKind.slice(1) + ']';
const matches = [];
for (const spread of assetDoc.spreads) {
  for (const node of spread.children) {
    const name = String(node.userDescription || node.description || node.defaultDescription || '');
    if (name.indexOf(expected) === 0) matches.push(node);
  }
}
if (matches.length === 0) throw new Error('This asset does not contain a ' + expected + ' layer.');
const sourceVisibilities = matches.map((node) => Boolean(node.isVisible));
let copyNodes = matches;
let staged = false;
if (requestedKind === 'master') {
  const sourceSelection = Selection.create(assetDoc, matches, true);
  assetDoc.executeCommand(DocumentCommand.createSetVisibility(sourceSelection, false));
  const duplicates = [];
  for (const node of matches) {
    const duplicate = node.duplicate();
    if (!duplicate) throw new Error('Affinity could not create a hidden staging copy for ' + expected + '.');
    duplicates.push(duplicate);
  }
  const duplicateSelection = Selection.create(assetDoc, duplicates, true);
  assetDoc.executeCommand(DocumentCommand.createSetVisibility(duplicateSelection, false));
  copyNodes = duplicates;
  staged = true;
} else {
  assetDoc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(assetDoc, matches, true), true));
}
const selection = Selection.create(assetDoc, copyNodes, true);
assetDoc.selection = selection;
console.log('KRYEO_PLACE_READY:' + JSON.stringify({
  count: copyNodes.length,
  expected,
  sourceSessionUuid: String(assetDoc.sessionUuid || ''),
  sourceVisibilities,
  staged,
  targetNodeCount,
  targetSessionUuid,
}));
`;
      const result = await this.callTool('execute_script', { script }, 60_000);
      const output = textFromResult(result);
      if (result.isError || output.lastIndexOf('KRYEO_PLACE_READY:') < 0) {
        throw new Error(output || 'Affinity could not prepare the asset layer.');
      }
      return { ok: true, title, output, startedAt, completedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, title, output: error instanceof Error ? error.message : String(error), startedAt, completedAt: new Date().toISOString() };
    }
  }

  async cleanupPreparedPlace(
    sourceSessionUuid: string,
    staged: boolean,
    expected: string,
    sourceVisibilities: boolean[],
  ): Promise<void> {
    if (!staged) return;
    await this.connect();
    const script = `
'use strict';
const { Document } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const expectedSessionUuid = ${JSON.stringify(sourceSessionUuid)};
const expectedPrefix = ${JSON.stringify(expected)};
const sourceVisibilities = ${JSON.stringify(sourceVisibilities)};
const doc = Document.current;
if (!doc || String(doc.sessionUuid || '') !== expectedSessionUuid) {
  throw new Error('Affinity changed documents before the temporary Place copy was cleaned up.');
}
const staging = [];
try { for (const node of doc.selection.nodes) staging.push(node); } catch (_) {}
if (staging.length === 0) throw new Error('Affinity lost the temporary Place copy before cleanup.');
const stagingSelection = Selection.create(doc, staging, true);
doc.executeCommand(DocumentCommand.createSetVisibility(stagingSelection, false));
doc.deleteSelection(stagingSelection);
const originals = [];
for (const spread of doc.spreads) {
  for (const node of spread.children) {
    const name = String(node.userDescription || node.description || node.defaultDescription || '');
    if (name.indexOf(expectedPrefix) === 0) originals.push(node);
  }
}
for (let index = 0; index < originals.length; index += 1) {
  const shouldShow = index < sourceVisibilities.length ? sourceVisibilities[index] : false;
  doc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(doc, originals[index], true), shouldShow));
}
doc.selection = Selection.create(doc, originals, true);
console.log('KRYEO_PLACE_CLEANED:' + JSON.stringify({ count: staging.length, restored: originals.length, sourceSessionUuid: expectedSessionUuid }));
`;
    const result = await this.callTool('execute_script', { script });
    const output = textFromResult(result);
    if (result.isError || output.lastIndexOf('KRYEO_PLACE_CLEANED:') < 0) {
      throw new Error(output || 'Affinity could not remove the temporary Place copy.');
    }
  }

  async verifyPlacedAsset(request: PlaceAssetRequest, baselineNodeCount: number): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = `Place ${request.layerKind}: ${request.displayName}`;
    await this.connect();
    try {
      const script = `
'use strict';
const { Document } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const doc = Document.current;
const expectedSessionUuid = ${JSON.stringify(request.targetSessionUuid)};
if (!doc || String(doc.sessionUuid || '') !== expectedSessionUuid) {
  throw new Error('Affinity did not return to the original document after copying.');
}
let count = 0;
const names = [];
try { count = doc.selection ? doc.selection.length : 0; } catch (_) {}
if (count === 0) throw new Error('Affinity pasted the asset but did not select the completed copy.');
const placed = [];
try { for (const node of doc.selection.nodes) placed.push(node); } catch (_) {}
if (placed.length === 0) throw new Error('Affinity could not resolve the completed pasted copy.');
doc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(doc, placed, true), true));
try {
  for (const node of doc.selection.nodes) names.push(String(node.userDescription || node.description || node.defaultDescription || ''));
} catch (_) {}
let nodeCount = 0;
function visit(node) {
  nodeCount += 1;
  try { for (const child of node.children) visit(child); } catch (_) {}
}
for (const spread of doc.spreads) for (const node of spread.children) visit(node);
if (nodeCount <= ${JSON.stringify(baselineNodeCount)}) {
  throw new Error('Affinity did not add the requested asset to the working document.');
}
console.log('KRYEO_PLACE_COMPLETE:' + JSON.stringify({ count, names, nodeCount, title: doc.title || 'Untitled' }));
`;
      const result = await this.callTool('execute_script', { script });
      const output = textFromResult(result);
      if (result.isError || output.lastIndexOf('KRYEO_PLACE_COMPLETE:') < 0) {
        throw new Error(output || 'Affinity did not confirm the placed layer.');
      }
      return {
        ok: true,
        title,
        output: `Placed the ${request.layerKind} version of ${request.displayName} into the active document.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { ok: false, title, output: error instanceof Error ? error.message : String(error), startedAt, completedAt: new Date().toISOString() };
    }
  }

  async getDocumentContext(): Promise<DocumentContext> {
    await this.connect();
    const probe = `
const { Document } = require('/document');
const doc = Document.current;
if (!doc) {
  console.log('KRYEO_CONTEXT:' + JSON.stringify({ open: false, title: '', path: '', selectionCount: 0, selectionNames: [], sessionUuid: '' }));
} else {
  let selectionCount = 0;
  const selectionNames = [];
  try { selectionCount = doc.selection ? doc.selection.length : 0; } catch (_) {}
  try {
    for (const node of doc.selection.nodes) {
      selectionNames.push(String(node.description || node.userDescription || node.defaultDescription || 'Unnamed layer'));
      if (selectionNames.length >= 20) break;
    }
  } catch (_) {}
  console.log('KRYEO_CONTEXT:' + JSON.stringify({
    open: true,
    title: doc.title || 'Untitled',
    path: doc.path || '',
    selectionCount,
    selectionNames,
    sessionUuid: doc.sessionUuid || '',
  }));
}`;
    const result = await this.callTool('execute_script', { script: probe });
    const text = textFromResult(result);
    const marker = 'KRYEO_CONTEXT:';
    const index = text.lastIndexOf(marker);
    if (result.isError || index < 0) {
      throw new Error(text || 'Could not inspect the active Affinity document.');
    }
    const line = text.slice(index + marker.length).split(/\r?\n/, 1)[0];
    return JSON.parse(line) as DocumentContext;
  }

  async exportAssistantPreview(outputPath: string, scope: 'document' | 'selection' = 'document'): Promise<AffinityAssistantPreview> {
    await this.connect();
    const script = `
'use strict';
const { Document, FileExportArea, FileExportOptions } = require('/document');
const { Selection } = require('/selections');
const doc = Document.current;
if (!doc) throw new Error('Open an Affinity document before asking Kryeo to inspect it.');
const previewScope = ${JSON.stringify(scope)};
const original = [];
for (const node of doc.selection.nodes) original.push(node);
const previewNodes = [];
if (previewScope === 'selection' && original.length > 0) {
  for (const node of original) previewNodes.push(node);
} else {
  for (const spread of doc.spreads) {
    for (const node of spread.children) {
      let visible = true;
      try { visible = Boolean(node.isVisibleInDomain); } catch (_) {}
      if (visible) previewNodes.push(node);
    }
  }
}
if (previewNodes.length === 0) throw new Error('The active document has no visible layers to inspect.');
const selection = Selection.create(doc, previewNodes, true);
const options = FileExportOptions.createWithPresetName('PNG');
let success = false;
try {
  doc.selection = selection;
  const records = doc.export(${JSON.stringify(outputPath)}, options, FileExportArea.createForSelection(selection));
  for (const record of records.all) if (record.isSuccess) success = true;
} finally {
  doc.selection = Selection.create(doc, original, true);
}
if (!success) throw new Error('Affinity could not render a preview for Kryeo.');
console.log('KRYEO_ASSISTANT_PREVIEW:' + JSON.stringify({
  path: ${JSON.stringify(outputPath)},
  documentTitle: String(doc.title || 'Untitled'),
  documentSessionUuid: String(doc.sessionUuid || ''),
}));`;
    const result = await this.callTool('execute_script', { script }, 90_000);
    const output = textFromResult(result);
    const marker = 'KRYEO_ASSISTANT_PREVIEW:';
    const index = output.lastIndexOf(marker);
    if (result.isError || index < 0) throw new Error(output || 'Affinity could not prepare visual context for Kryeo.');
    const line = output.slice(index + marker.length).split(/\r?\n/, 1)[0];
    return JSON.parse(line) as AffinityAssistantPreview;
  }

  async exportComponentCandidates(
    stagingDirectory: string,
    scope: 'document' | 'selection' = 'document',
    onProgress?: (progress: { completedPartitions: number; totalPartitions: number }) => void,
    signal?: AbortSignal,
  ): Promise<AffinityComponentExportBatch> {
    const assertActive = () => {
      if (!signal?.aborted) return;
      const error = new Error('Component scan cancelled.');
      error.name = 'AbortError';
      throw error;
    };
    assertActive();
    await this.connect();
    let originalViewportZoom: number | null = null;
    try {
      originalViewportZoom = await this.prepareScanViewport();
      // Affinity's MCP endpoint has a finite execution window. Partition the
      // document at its top-level component sections so traversal and rendering
      // never depend on one monolithic whole-document script.
      let chunkSize = INITIAL_COMPONENT_EXPORT_PARTITIONS;
      let workBudget = INITIAL_COMPONENT_EXPORT_BATCH_WORK;
      let start = 0;
      let totalPartitions = Number.POSITIVE_INFINITY;
      let firstBatch: AffinityComponentExportBatch | null = null;
      let partitionPlan: AffinityScanPartitionPlan[] = [];
      let partitionPlanReady = scope !== 'document';
      const components: AffinityComponentExport[] = [];
      let totalCandidates = 0;
      const singlePartitionRetries = new Set<string>();
      let requestCount = 0;
      let retryCount = 0;
      let splitCount = 0;
      let totalRequestMs = 0;
      let slowestRequestMs = 0;
      while (start < totalPartitions) {
      assertActive();
      const planning = !partitionPlanReady;
      const requestedPartitionCount = planning
        ? 0
        : componentExportBatchCount(
          partitionPlan,
          start,
          Math.max(1, Math.min(chunkSize, totalPartitions - start)),
          workBudget,
        );
      const end = planning ? 0 : start + requestedPartitionCount;
      const probe = `
'use strict';
const { Document, FileExportArea, FileExportOptions } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const doc = Document.current;
if (!doc) throw new Error('Open an Affinity document before scanning components.');
const scanScope = ${JSON.stringify(scope)};
const exportPartitionStart = ${JSON.stringify(start)};
const exportPartitionEnd = ${JSON.stringify(end)};
  const providedPartitions = scanScope === 'document' ? ${JSON.stringify(partitionPlan.slice(start, end))} : [];
  const providedPartitionCount = ${JSON.stringify(partitionPlan.length)};

function nodeName(node) {
  return String(node.userDescription || node.description || node.defaultDescriptionForDisplay || node.defaultDescription || 'Unnamed layer');
}
function isStorageBoundary(node) {
  return nodeName(node).trim().toLowerCase() === 'storage';
}
function nodeType(node) {
  try { return String(node.constructor && node.constructor.name || Object.prototype.toString.call(node)); }
  catch (_) { return 'Node'; }
}
function nodeBounds(node) {
  const boxes = [];
  try { boxes.push(node.exactSpreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadBaseBox); } catch (_) {}
  for (const box of boxes) {
    if (!box) continue;
    const result = { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) };
    if (Number.isFinite(result.x) && Number.isFinite(result.y) && result.width > 0 && result.height > 0) return result;
  }
  return null;
}
function mergedBounds(left, right) {
  if (!left) return right;
  if (!right) return left;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}
function renderedBounds(node, depth) {
  const direct = nodeBounds(node);
  if (direct || depth >= 8) return direct;
  let result = null;
  for (const child of childNodes(node)) result = mergedBounds(result, renderedBounds(child, depth + 1));
  return result;
}
function nodeVisible(node) {
  try { return Boolean(node.isVisibleInDomain); } catch (_) {}
  try { return Boolean(node.isVisible); } catch (_) {}
  return true;
}
function nodeOwnVisibility(node) {
  try { return Boolean(node.isVisible); } catch (_) {}
  return true;
}

const original = [];
for (const node of doc.selection.nodes) original.push(node);
const candidates = [];
let sourceName = 'Whole document';

function childNodes(node) {
  const children = [];
  try {
    for (const child of node.children) children.push(child);
  } catch (_) {}
  return children;
}
function nodeDescendantCount(node) {
  try { return Number(node.children.all.length || 0); } catch (_) { return 0; }
}
function isRenderableCandidate(node) {
  return !/Adjustment|Filter|Mask/i.test(nodeType(node));
}
function normalizedSeriesName(node) {
  return nodeName(node).toLowerCase().replace(/[\\s_-]*\\d+$/g, '').replace(/\\s+/g, ' ').trim();
}
function hierarchyKey(path) { return path.join('.'); }
function genericLayerName(node) {
  return /^(layer|group|object|shape|curve|pixel|image|raster|rectangle|ellipse|container)[\\s_-]*\\d*$/i.test(nodeName(node));
}
function resemblesRepeatedSet(children) {
  const renderable = children.filter(isRenderableCandidate);
  if (renderable.length < 3) return false;
  const names = {};
  for (const child of renderable) {
    const key = normalizedSeriesName(child);
    if (key && !/^(layer|group|object|shape|curve|pixel|image|raster|rectangle|ellipse)$/i.test(key)) names[key] = (names[key] || 0) + 1;
  }
  const repeatedName = Object.keys(names).some((key) => names[key] >= 3);
  const boxes = renderable.map(nodeBounds).filter(Boolean);
  if (boxes.length < 3) return repeatedName;
  const widths = boxes.map((box) => box.width).sort((a, b) => a - b);
  const heights = boxes.map((box) => box.height).sort((a, b) => a - b);
  const middle = Math.floor(boxes.length / 2);
  const medianWidth = Math.max(1, widths[middle]);
  const medianHeight = Math.max(1, heights[middle]);
  const similarlySized = boxes.filter((box) =>
    Math.abs(box.width - medianWidth) / medianWidth < 0.25
    && Math.abs(box.height - medianHeight) / medianHeight < 0.25
  ).length >= Math.ceil(boxes.length * 0.7);
  let separatedPairs = 0;
  let comparedPairs = 0;
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      comparedPairs += 1;
      if (intersectionArea(boxes[a], boxes[b]) === 0) separatedPairs += 1;
    }
  }
  return repeatedName && similarlySized && separatedPairs / Math.max(1, comparedPairs) > 0.7;
}
function independentChild(node) {
  if (!isRenderableCandidate(node)) return false;
  if (genericLayerName(node)) return false;
  if (childNodes(node).length > 0) return true;
  return !/^(background|backdrop|border|borders|decoration|ornament|shadow|glow|stroke|fill|mask|base)$/i.test(nodeName(node));
}
function addCandidate(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth) {
  candidates.push({
    node,
    path,
    parentPath,
    parentName,
    ancestors,
    canCompose: parentType === 'Spread' && !parentHierarchyKey,
    hierarchyKey: hierarchyKey(path),
    parentHierarchyKey,
    hierarchyDepth,
  });
}
function collectDocumentCandidate(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth) {
  if (isStorageBoundary(node)) return;
  const children = childNodes(node);
  if (children.length === 0) {
    if (isRenderableCandidate(node)) addCandidate(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth);
    return;
  }

  const type = nodeType(node);
  const isContainer = /Container|Artboard|Spread/i.test(type);
  if (isContainer || !isRenderableCandidate(node)) {
    let childIndex = 0;
    for (const child of children) {
      collectDocumentCandidate(child, path.concat(childIndex), path, nodeName(node), ancestors.concat(node), type, parentHierarchyKey, hierarchyDepth);
      childIndex += 1;
    }
    return;
  }

  const currentHierarchyKey = hierarchyKey(path);
  addCandidate(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth);
  if (hierarchyDepth >= 5) return;
  let childIndex = 0;
  for (const child of children) {
    if (isRenderableCandidate(child)) {
      collectDocumentCandidate(child, path.concat(childIndex), path, nodeName(node), ancestors.concat(node), type, currentHierarchyKey, hierarchyDepth + 1);
    }
    childIndex += 1;
  }
}

const partitions = [];
function partitionWork(node, mode) {
  const descendants = Math.max(0, nodeDescendantCount(node));
  const bounds = nodeBounds(node);
  const megapixels = bounds
    ? Math.max(0, (Number(bounds.width) * Number(bounds.height)) / (1024 * 1024))
    : 0;
  // Descendants approximate the number of export selections. Large flat artwork
  // can also take a long time to rasterise, so give every megapixel a small
  // weight even when it has no children.
  const descendantWork = mode === 'candidate' ? 1 : Math.min(48, descendants + 1);
  const rasterWork = Math.min(48, Math.ceil(megapixels) * 3);
  return Math.max(1, Math.min(96, descendantWork + rasterWork));
}
function pushPartition(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth, mode) {
  partitions.push({
    node,
    path,
    parentPath,
    parentName,
    ancestors,
    parentType,
    parentHierarchyKey,
    hierarchyDepth,
    mode,
    ancestorPaths: path
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1))
      .filter((ancestorPath) => ancestorPath.length >= 2),
    estimatedWork: partitionWork(node, mode),
  });
}
function nodeAtPath(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  let current = null;
  let spreadIndex = 0;
  for (const spread of doc.spreads) {
    if (spreadIndex === Number(path[0])) { current = spread; break; }
    spreadIndex += 1;
  }
  if (!current) return null;
  for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
    current = childNodes(current)[Number(path[pathIndex])];
    if (!current) return null;
  }
  return current;
}
function pushSectionPartitions(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth, depth) {
  const children = childNodes(node);
  const currentType = nodeType(node);
  const subtreeDescendants = nodeDescendantCount(node);
  // A non-generic editable group is itself meaningful source artwork, even
  // when it must be split into smaller export partitions for reliability.
  // Omitting it here leaves its construction layers loose and lets an
  // equivalent flattened RasterNode become the only visible asset boundary.
  const retainEditableParent = depth < 6
    && children.length > 0
    && children.length <= 16
    && subtreeDescendants <= 96
    && !genericLayerName(node)
    && !/Container|Artboard|Spread/i.test(currentType);
  if (retainEditableParent) {
    pushPartition(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth, 'candidate');
  }
  const childParentHierarchyKey = retainEditableParent ? hierarchyKey(path) : parentHierarchyKey;
  const childHierarchyDepth = retainEditableParent ? hierarchyDepth + 1 : hierarchyDepth;
  // A single export has to finish inside Affinity's fixed remote MCP window.
  // Split any dense subtree, regardless of its concrete Affinity node type:
  // imported/live groups do not consistently identify as a "Group" even when
  // their descendants are expensive to render.
  const shouldSplit = depth < 8 && children.length > 0 && (
    children.length > 2 || subtreeDescendants > 24
  );
  if (shouldSplit) {
    let childIndex = 0;
    for (const child of children) {
      pushSectionPartitions(
        child,
        path.concat(childIndex),
        path,
        nodeName(node),
        ancestors.concat(node),
        currentType,
        childParentHierarchyKey,
        childHierarchyDepth,
        depth + 1,
      );
      childIndex += 1;
    }
    return;
  }
  pushPartition(node, path, parentPath, parentName, ancestors, parentType, parentHierarchyKey, hierarchyDepth, 'subtree');
}
if (providedPartitions.length > 0) {
  for (const descriptor of providedPartitions) {
    const node = nodeAtPath(descriptor.path);
    if (!node) throw new Error('The Affinity document hierarchy changed during Component Scan.');
    const ancestors = (descriptor.ancestorPaths || []).map(nodeAtPath).filter(Boolean);
    partitions.push({ ...descriptor, node, ancestors });
  }
} else if (scanScope === 'selection') {
  if (original.length === 0) throw new Error('Select a parent group or one or more component layers before scanning the selection.');
  const selectedRoot = original.length === 1 ? original[0] : null;
  sourceName = selectedRoot ? nodeName(selectedRoot) : original.length + ' selected layers';
  if (selectedRoot && isStorageBoundary(selectedRoot)) {
    // Storage is an explicit component-scan boundary, including when selected directly.
  } else if (selectedRoot && selectedRoot.firstChild) {
    // Preserve a selected component group as the reviewable parent. Organizational
    // containers remain transparent because collectDocumentCandidate handles them.
    collectDocumentCandidate(selectedRoot, [-1, 0], [-1], 'Selection', [], 'Selection', '', 0);
  } else {
    for (let index = 0; index < original.length; index += 1) {
      collectDocumentCandidate(original[index], [-2, index], [-2], sourceName, [], 'Selection', '', 0);
    }
  }
} else {
  let spreadIndex = 0;
  for (const spread of doc.spreads) {
    let nodeIndex = 0;
    for (const node of spread.children) {
      const path = [spreadIndex, nodeIndex];
      if (isStorageBoundary(node)) {
        nodeIndex += 1;
        continue;
      }
      const children = childNodes(node);
      const type = nodeType(node);
      const parentName = 'Spread ' + (spreadIndex + 1);
      const topTypeIsComponent = !/Container|Artboard|Spread/i.test(type);
      // A named top-level assembly is still a real editable component when it
      // has a repeated set of children. The old <=2 limit dropped collection
      // groups such as a slot strip before the parent-vs-raster decision ran.
      const retainedParent = topTypeIsComponent
        && !genericLayerName(node)
        && children.length <= 16
        && nodeDescendantCount(node) <= 96;
      if (children.length === 0) {
        pushPartition(node, path, [spreadIndex], parentName, [], 'Spread', '', 0, 'subtree');
      } else {
        if (retainedParent) {
          // Large top-level groups are usually organizational wrappers. Keep
          // their child sections, but avoid rendering the whole wrapper as one
          // oversized component request.
          pushPartition(node, path, [spreadIndex], parentName, [], 'Spread', '', 0, 'candidate');
        }
        let childIndex = 0;
        for (const child of children) {
          pushSectionPartitions(
            child,
            path.concat(childIndex),
            path,
            nodeName(node),
            [node],
            type,
            retainedParent ? path.join('.') : '',
            retainedParent ? 1 : 0,
            0,
          );
          childIndex += 1;
        }
      }
      nodeIndex += 1;
    }
    spreadIndex += 1;
  }
}
if (scanScope === 'document') {
  const activePartitionStart = providedPartitions.length > 0 ? 0 : exportPartitionStart;
  const activePartitionEnd = providedPartitions.length > 0 ? partitions.length : Math.min(exportPartitionEnd, partitions.length);
  for (let partitionIndex = activePartitionStart; partitionIndex < activePartitionEnd; partitionIndex += 1) {
    const partition = partitions[partitionIndex];
    if (partition.mode === 'candidate') {
      addCandidate(partition.node, partition.path, partition.parentPath, partition.parentName, partition.ancestors, partition.parentType, partition.parentHierarchyKey, partition.hierarchyDepth);
    } else {
      collectDocumentCandidate(partition.node, partition.path, partition.parentPath, partition.parentName, partition.ancestors, partition.parentType, partition.parentHierarchyKey, partition.hierarchyDepth);
    }
  }
}
function area(box) { return Math.max(0, box.width) * Math.max(0, box.height); }
function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}
function shouldCompose(a, b) {
  if (!a.canCompose || !b.canCompose) return false;
  if (a.parentPath.join('.') !== b.parentPath.join('.')) return false;
  const boxA = nodeBounds(a.node);
  const boxB = nodeBounds(b.node);
  if (!boxA || !boxB) return false;
  const small = Math.min(area(boxA), area(boxB));
  const large = Math.max(area(boxA), area(boxB));
  const documentArea = Math.max(1, Number(doc.widthPixels || 0) * Number(doc.heightPixels || 0));
  if (small <= 0) return false;
  if (large / documentArea > 0.55 && small / large < 0.2) return false;
  return intersectionArea(boxA, boxB) / small >= 0.08;
}
const parents = candidates.map((_, index) => index);
function root(index) {
  while (parents[index] !== index) {
    parents[index] = parents[parents[index]];
    index = parents[index];
  }
  return index;
}
function join(a, b) {
  const rootA = root(a);
  const rootB = root(b);
  if (rootA !== rootB) parents[rootB] = rootA;
}
if (scanScope === 'document') {
  // Composition is only possible between candidates with the same direct
  // parent. Bucket first so large documents do not pay an all-document
  // quadratic comparison cost.
  const siblings = {};
  for (let index = 0; index < candidates.length; index += 1) {
    const key = candidates[index].parentPath.join('.');
    if (!siblings[key]) siblings[key] = [];
    siblings[key].push(index);
  }
  for (const indexes of Object.values(siblings)) {
    for (let a = 0; a < indexes.length; a += 1) {
      for (let b = a + 1; b < indexes.length; b += 1) {
        if (shouldCompose(candidates[indexes[a]], candidates[indexes[b]])) join(indexes[a], indexes[b]);
      }
    }
  }
}
const clusterMap = {};
for (let index = 0; index < candidates.length; index += 1) {
  const key = String(root(index));
  if (!clusterMap[key]) clusterMap[key] = [];
  clusterMap[key].push(candidates[index]);
}
const clusters = Object.keys(clusterMap)
  .map((key) => ({ rootIndex: Number(key), members: clusterMap[key] }));
const changedVisibilityNodes = [];
const changedVisibilityStates = [];
const renderRefreshCache = new Map();
function rememberVisibility(nodes) {
  for (const node of nodes) {
    if (changedVisibilityNodes.indexOf(node) >= 0) continue;
    changedVisibilityNodes.push(node);
    changedVisibilityStates.push(nodeOwnVisibility(node));
  }
}
function restoreVisibility(nodes, states) {
  for (let visibilityIndex = nodes.length - 1; visibilityIndex >= 0; visibilityIndex -= 1) {
    doc.executeCommand(DocumentCommand.createSetVisibility(
      Selection.create(doc, nodes[visibilityIndex], true),
      Boolean(states[visibilityIndex])
    ));
  }
}
function needsRenderRefresh(node, depth) {
  if (renderRefreshCache.has(node)) return renderRefreshCache.get(node);
  if (/Adjustment|Live|Filter/i.test(nodeType(node))) {
    renderRefreshCache.set(node, true);
    return true;
  }
  if (depth >= 4) {
    renderRefreshCache.set(node, false);
    return false;
  }
  for (const child of childNodes(node)) {
    if (needsRenderRefresh(child, depth + 1)) {
      renderRefreshCache.set(node, true);
      return true;
    }
  }
  renderRefreshCache.set(node, false);
  return false;
}

const options = FileExportOptions.createWithPresetName('PNG');
const exported = [];
const structuralFallbacks = [];
try {
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index].members;
    const rootIndex = clusters[index].rootIndex;
    const exportIndex = exportPartitionStart * 100000 + index;
    const nodes = cluster.map((item) => item.node);
    const node = nodes[0];
    let bounds = null;
    for (const memberNode of nodes) {
      const memberBox = renderedBounds(memberNode, 0);
      if (!memberBox) continue;
      if (!bounds) bounds = { x: memberBox.x, y: memberBox.y, width: memberBox.width, height: memberBox.height };
      else {
        const right = Math.max(bounds.x + bounds.width, memberBox.x + memberBox.width);
        const bottom = Math.max(bounds.y + bounds.height, memberBox.y + memberBox.height);
        bounds.x = Math.min(bounds.x, memberBox.x);
        bounds.y = Math.min(bounds.y, memberBox.y);
        bounds.width = right - bounds.x;
        bounds.height = bottom - bounds.y;
      }
    }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;

    let childCount = 0;
    let descendantCount = 0;
    let textCount = /Text/i.test(nodeType(node)) ? 1 : 0;
    const semanticNames = [];
    for (const member of cluster) if (semanticNames.length < 16) semanticNames.push(nodeName(member.node));
    try {
      for (const child of node.children) childCount += 1;
      for (const descendant of node.children.all) {
        descendantCount += 1;
        if (/Text/i.test(nodeType(descendant))) textCount += 1;
        if (semanticNames.length < 16) semanticNames.push(nodeName(descendant));
      }
    } catch (_) {}

    const outputPath = ${JSON.stringify(stagingDirectory)} + '\\\\component-' + String(exportIndex + 1).padStart(6, '0') + '.png';
    const revealNodes = [];
    for (const item of cluster) {
      for (const ancestor of item.ancestors || []) if (revealNodes.indexOf(ancestor) < 0) revealNodes.push(ancestor);
      if (revealNodes.indexOf(item.node) < 0) revealNodes.push(item.node);
    }
    const visibilityStates = revealNodes.map((item) => nodeOwnVisibility(item));
    const hiddenRevealNodes = revealNodes.filter((_, revealIndex) => !visibilityStates[revealIndex]);
    const refreshNodes = nodes.filter((item) => nodeOwnVisibility(item));
    const localChangedNodes = [];
    const localChangedStates = [];
    function rememberLocalVisibility(items) {
      for (const item of items) {
        if (localChangedNodes.indexOf(item) >= 0) continue;
        localChangedNodes.push(item);
        localChangedStates.push(nodeOwnVisibility(item));
      }
      rememberVisibility(items);
    }
    if (refreshNodes.length > 0 && nodes.some((item) => needsRenderRefresh(item, 0))) {
      // Adjustment-bearing groups need a visibility refresh before Affinity
      // renders them. Ordinary visible artwork does not, avoiding several
      // document mutations for every exported component.
      rememberLocalVisibility(refreshNodes);
      doc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(doc, refreshNodes, true), false));
      doc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(doc, refreshNodes, true), true));
    }
    if (hiddenRevealNodes.length > 0) {
      rememberLocalVisibility(hiddenRevealNodes);
      doc.executeCommand(DocumentCommand.createSetVisibility(Selection.create(doc, hiddenRevealNodes, true), true));
    }
    let success = false;
    try {
      // Visibility commands can invalidate a live-adjustment group's previous
      // selection snapshot. Recreate it only after the render tree is rebuilt.
      const exportSelection = Selection.create(doc, nodes, true);
      doc.selection = exportSelection;
      const records = doc.export(outputPath, options, FileExportArea.createForSelection(exportSelection));
      for (const record of records.all) if (record.isSuccess) success = true;
    } catch (_) {
      // Some live-adjustment groups are valid structural parents but cannot be
      // exported directly. A group preview must still represent its complete
      // assembled image: substituting its first child makes a real editable
      // component look unrelated to an equivalent flattened RasterNode.
      success = false;
    }
    if (!success && childCount > 0) {
      try {
        const directChildren = [];
        for (const child of node.children) directChildren.push(child);
        if (directChildren.length) {
          const childSelection = Selection.create(doc, directChildren, true);
          doc.selection = childSelection;
          const childRecords = doc.export(outputPath, options, FileExportArea.createForSelection(childSelection));
          for (const record of childRecords.all) if (record.isSuccess) success = true;
        }
      } catch (_) {
        // The structural fallback below remains available only when even the
        // direct-child composite cannot be rendered by Affinity.
      }
    }
    restoreVisibility(localChangedNodes, localChangedStates);
    const componentRecord = {
      index: exportIndex,
      name: cluster.length > 1 && cluster[0].parentName ? cluster[0].parentName : nodeName(node),
      affinityType: nodeType(node),
      bounds: { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) },
      childCount,
      descendantCount,
      textCount,
      semanticNames,
      path: outputPath,
      hierarchyKey: cluster[0].hierarchyKey,
      parentHierarchyKey: cluster[0].parentHierarchyKey || '',
      hierarchyDepth: Number(cluster[0].hierarchyDepth || 0),
      previewFallback: false,
      members: cluster.map((item) => ({
        path: item.path,
        name: nodeName(item.node),
        affinityType: nodeType(item.node),
        bounds: nodeBounds(item.node),
      })),
      grouping: cluster.length > 1 ? 'overlap' : (childCount > 0 ? 'existing-group' : 'single'),
    };
    if (success) exported.push(componentRecord);
    else if (childCount > 0) structuralFallbacks.push(componentRecord);
  }
  for (const parent of structuralFallbacks) {
    const prefix = parent.hierarchyKey + '.';
    const childPreview = exported.find((component) => component.hierarchyKey.indexOf(prefix) === 0);
    if (!childPreview) continue;
    parent.path = childPreview.path;
    parent.previewFallback = true;
    exported.push(parent);
  }
  exported.sort((left, right) => left.index - right.index);
} finally {
  // Reconcile only nodes whose visibility was actually changed. Restoring the
  // complete candidate set after every partition was a dominant cost on large
  // documents, while this retains the same failure safety boundary.
  restoreVisibility(changedVisibilityNodes, changedVisibilityStates);
  doc.selection = Selection.create(doc, original, true);
}

console.log('KRYEO_COMPONENT_SCAN:' + JSON.stringify({
  documentTitle: String(doc.title || 'Untitled'),
  documentSessionUuid: String(doc.sessionUuid || ''),
  sourceName,
  components: exported,
  totalCandidates: candidates.length,
  totalPartitions: scanScope === 'document' ? (providedPartitionCount || partitions.length) : 1,
  partitionIndex: exportPartitionStart,
  partitionPlan: partitions.map((partition) => ({
    path: partition.path,
    parentPath: partition.parentPath,
    parentName: partition.parentName,
    parentType: partition.parentType,
    parentHierarchyKey: partition.parentHierarchyKey,
    hierarchyDepth: partition.hierarchyDepth,
    mode: partition.mode,
    ancestorPaths: partition.ancestorPaths,
    estimatedWork: partition.estimatedWork,
  })),
}));`;
      let batch: AffinityComponentExportBatch;
      const requestStartedAt = Date.now();
      requestCount += 1;
      const recordRequestDuration = () => {
        const duration = Date.now() - requestStartedAt;
        totalRequestMs += duration;
        slowestRequestMs = Math.max(slowestRequestMs, duration);
        return duration;
      };
      try {
        const result = await this.callTool('execute_script', { script: probe }, 120_000);
        assertActive();
        const output = textFromResult(result);
        const marker = 'KRYEO_COMPONENT_SCAN:';
        const markerIndex = output.lastIndexOf(marker);
        if (result.isError || markerIndex < 0) throw new Error(output || 'Affinity could not scan the document components.');
        const line = output.slice(markerIndex + marker.length).split(/\r?\n/, 1)[0];
        batch = JSON.parse(line) as AffinityComponentExportBatch;
      } catch (error) {
        recordRequestDuration();
        const failedPartition = scope === 'document' ? partitionPlan[start] : undefined;
        if (signal?.aborted || !isRecoverableComponentExportError(error) || !failedPartition) throw error;
        retryCount += 1;
        await this.connect();
        // A timeout means the current work estimate was optimistic. Tighten
        // both dimensions before retrying, while retaining the existing
        // split/reconnect recovery behaviour.
        workBudget = Math.max(MIN_COMPONENT_EXPORT_BATCH_WORK, Math.floor(workBudget / 2));
        if (requestedPartitionCount > 1) {
          // The aggregate remote script exceeded Affinity's window. Retry the
          // same range in smaller units before splitting its document structure.
          chunkSize = Math.max(1, Math.floor(requestedPartitionCount / 2));
          onProgress?.({ completedPartitions: start, totalPartitions });
          continue;
        }
        const retryKey = failedPartition.path.join('.');
        const closedConnection = /(?:MCP error -32000|connection closed|connection was interrupted)/i.test(
          error instanceof Error ? error.message : String(error),
        );
        if (closedConnection && !singlePartitionRetries.has(retryKey)) {
          // A closed SSE transport can happen after Affinity completed the
          // script but before its result reached Electron. Reconnecting once is
          // cheaper and safer than immediately fragmenting a valid component.
          singlePartitionRetries.add(retryKey);
          onProgress?.({ completedPartitions: start, totalPartitions });
          continue;
        }
        if (failedPartition.path.length >= 14) throw error;
        const narrowerPartitions = await this.splitComponentScanPartition(failedPartition);
        if (narrowerPartitions.length < 2) throw new Error('Affinity timed out while rendering one component section. Select that group in Affinity and scan the selection instead.');
        splitCount += 1;
        partitionPlan.splice(start, 1, ...narrowerPartitions);
        totalPartitions = partitionPlan.length;
        onProgress?.({ completedPartitions: start, totalPartitions });
        continue;
      }
      const requestDurationMs = recordRequestDuration();
      if (!firstBatch) firstBatch = batch;
      if (planning) {
        partitionPlan = Array.isArray(batch.partitionPlan) ? batch.partitionPlan : [];
        partitionPlanReady = true;
        totalPartitions = partitionPlan.length;
        onProgress?.({ completedPartitions: 0, totalPartitions });
        if (totalPartitions === 0) break;
        continue;
      }
      components.push(...batch.components);
      totalCandidates += Number(batch.totalCandidates ?? batch.components.length);
      totalPartitions = Number(batch.totalPartitions ?? (partitionPlan.length || 1));
      if (requestDurationMs < FAST_COMPONENT_EXPORT_BATCH_MS) {
        chunkSize = Math.min(
          MAX_COMPONENT_EXPORT_PARTITIONS,
          Math.max(chunkSize, requestedPartitionCount) + 2,
        );
        workBudget = Math.min(
          MAX_COMPONENT_EXPORT_BATCH_WORK,
          workBudget + Math.max(4, Math.ceil(workBudget / 3)),
        );
      } else if (requestDurationMs > SLOW_COMPONENT_EXPORT_BATCH_MS) {
        chunkSize = Math.max(1, Math.min(chunkSize, Math.floor(requestedPartitionCount / 2)));
        workBudget = Math.max(MIN_COMPONENT_EXPORT_BATCH_WORK, Math.floor(workBudget * 0.6));
      }
      if (requestedPartitionCount === 1) singlePartitionRetries.delete(partitionPlan[start]?.path.join('.') || '');
      onProgress?.({
        completedPartitions: Math.min(totalPartitions, end),
        totalPartitions,
      });
      if (totalPartitions <= end || batch.totalPartitions === undefined) break;
      start = end;
    }
    if (!firstBatch) throw new Error('Affinity could not scan the document components.');
    // Parent-preserving partitions intentionally overlap child partitions.
    // Affinity identifies a source node by its hierarchy path, so collapse
    // those transport-level overlaps before candidates enter visual analysis.
    // This is not visual deduplication: distinct nodes with matching pixels
    // remain available for the editable-group preference stage.
    const componentsByHierarchy = new Map<string, AffinityComponentExport>();
    for (const component of components) {
      const key = component.hierarchyKey || `index:${component.index}`;
      const current = componentsByHierarchy.get(key);
      if (!current || (component.childCount > current.childCount)) {
        componentsByHierarchy.set(key, component);
      }
    }
    return {
      ...firstBatch,
      components: [...componentsByHierarchy.values()].sort((left, right) => left.index - right.index),
      totalCandidates,
      exportDiagnostics: {
        requestCount,
        retryCount,
        splitCount,
        slowestRequestMs,
        averageRequestMs: Math.round(totalRequestMs / Math.max(1, requestCount)),
      },
    };
    } finally {
      await this.restoreScanViewport(originalViewportZoom);
    }
  }

  private async splitComponentScanPartition(partition: AffinityScanPartitionPlan): Promise<AffinityScanPartitionPlan[]> {
    const script = `
'use strict';
const { Document } = require('/document');
const doc = Document.current;
if (!doc) throw new Error('Open an Affinity document before scanning components.');
const descriptor = ${JSON.stringify(partition)};
function childNodes(node) {
  const children = [];
  try { for (const child of node.children) children.push(child); } catch (_) {}
  return children;
}
function nodeName(node) {
  return String(node.userDescription || node.description || node.defaultDescriptionForDisplay || node.defaultDescription || 'Unnamed layer');
}
function nodeType(node) {
  try { return String(node.constructor && node.constructor.name || Object.prototype.toString.call(node)); }
  catch (_) { return 'Node'; }
}
function nodeDescendantCount(node) {
  try { return Math.max(0, Number(node.children.all.length || 0)); } catch (_) { return 0; }
}
function nodeBounds(node) {
  const boxes = [];
  try { boxes.push(node.exactSpreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadVisibleBox); } catch (_) {}
  try { boxes.push(node.spreadBaseBox); } catch (_) {}
  for (const box of boxes) {
    if (!box) continue;
    const result = { width: Number(box.width), height: Number(box.height) };
    if (result.width > 0 && result.height > 0) return result;
  }
  return null;
}
function estimatedWork(node) {
  const descendants = nodeDescendantCount(node);
  const bounds = nodeBounds(node);
  const megapixels = bounds ? Math.max(0, (bounds.width * bounds.height) / (1024 * 1024)) : 0;
  return Math.max(1, Math.min(96, Math.min(48, descendants + 1) + Math.min(48, Math.ceil(megapixels) * 3)));
}
function nodeAtPath(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  let current = null;
  let spreadIndex = 0;
  for (const spread of doc.spreads) {
    if (spreadIndex === Number(path[0])) { current = spread; break; }
    spreadIndex += 1;
  }
  if (!current) return null;
  for (let index = 1; index < path.length; index += 1) {
    current = childNodes(current)[Number(path[index])];
    if (!current) return null;
  }
  return current;
}
const node = nodeAtPath(descriptor.path);
if (!node) throw new Error('The Affinity document hierarchy changed during Component Scan.');
console.log('KRYEO_COMPONENT_PARTITION_CHILDREN:' + JSON.stringify({
  parentName: nodeName(node),
  parentType: nodeType(node),
  count: childNodes(node).length,
  children: childNodes(node).map((child) => ({ estimatedWork: estimatedWork(child) })),
}));`;
    const result = await this.callTool('execute_script', { script }, 30_000);
    const output = textFromResult(result);
    const marker = 'KRYEO_COMPONENT_PARTITION_CHILDREN:';
    const markerIndex = output.lastIndexOf(marker);
    if (result.isError || markerIndex < 0) throw new Error(output || 'Affinity could not narrow the timed-out component section.');
    const line = output.slice(markerIndex + marker.length).split(/\r?\n/, 1)[0];
    const response = JSON.parse(line) as {
      parentName: string;
      parentType: string;
      count: number;
      children?: Array<{ estimatedWork?: number }>;
    };
    const ancestorPaths = [...(partition.ancestorPaths || []), partition.path];
    return Array.from({ length: Math.max(0, response.count) }, (_, index) => ({
      path: [...partition.path, index],
      parentPath: partition.path,
      parentName: response.parentName,
      parentType: response.parentType,
      parentHierarchyKey: partition.path.join('.'),
      hierarchyDepth: partition.hierarchyDepth + 1,
      mode: 'subtree' as const,
      ancestorPaths,
      estimatedWork: response.children?.[index]?.estimatedWork,
    }));
  }
  async applyComponentOrganization(request: ApplyComponentOrganizationRequest): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = 'Organize Affinity components';
    await this.connect();
    try {
      const script = `
'use strict';
const { Document } = require('/document');
const { Selection } = require('/selections');
const { AddChildNodesCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands');
const { ContainerNodeDefinition } = require('/nodes');
const request = ${JSON.stringify(request)};
const doc = Document.current;
if (!doc || String(doc.sessionUuid || '') !== request.documentSessionUuid) {
  throw new Error('The active Affinity document changed after Component Scan. Scan it again before applying organization.');
}
function itemAt(collection, wanted) {
  let index = 0;
  for (const item of collection) {
    if (index === wanted) return item;
    index += 1;
  }
  return null;
}
function resolvePath(path) {
  if (!Array.isArray(path) || path.length < 2 || path[0] < 0) return null;
  let node = itemAt(doc.spreads, path[0]);
  if (!node) return null;
  for (let index = 1; index < path.length; index += 1) {
    node = itemAt(node.children, path[index]);
    if (!node) return null;
  }
  return node;
}
const plans = request.components.map((component) => ({
  name: String(component.name || 'UI Component').slice(0, 80),
  nodes: component.memberPaths.map(resolvePath),
}));
for (const plan of plans) {
  if (plan.nodes.some((node) => !node)) throw new Error('The Affinity layer hierarchy changed after scanning. No layers were reorganized; scan the document again.');
}
const organized = [];
for (const plan of plans) {
  if (plan.nodes.length === 1) {
    const selection = Selection.create(doc, plan.nodes[0], true);
    doc.executeCommand(DocumentCommand.createSetDescription(selection, plan.name));
    organized.push(plan.nodes[0]);
    continue;
  }
  const sourceSelection = Selection.create(doc, plan.nodes, true);
  doc.selection = sourceSelection;
  const builder = AddChildNodesCommandBuilder.create();
  builder.addContainerNode(ContainerNodeDefinition.create(plan.name));
  builder.setInsertionTargetSelection(sourceSelection);
  const addCommand = builder.createCommand(false, NodeChildType.Main);
  doc.executeCommand(addCommand);
  const group = addCommand.newNodes[0];
  if (!group) throw new Error('Affinity could not create the proposed component group.');
  doc.executeCommand(DocumentCommand.createMoveNodes(
    Selection.create(doc, plan.nodes, true),
    group,
    NodeMoveType.Inside,
    NodeChildType.Main
  ));
  doc.executeCommand(DocumentCommand.createSetDescription(Selection.create(doc, group, true), plan.name));
  organized.push(group);
}
doc.selection = Selection.create(doc, organized, true);
console.log('KRYEO_COMPONENTS_ORGANIZED:' + JSON.stringify({ count: organized.length, title: String(doc.title || 'Untitled') }));`;
      const result = await this.callTool('execute_script', { script }, 120_000);
      const output = textFromResult(result);
      if (result.isError || output.lastIndexOf('KRYEO_COMPONENTS_ORGANIZED:') < 0) {
        throw new Error(output || 'Affinity could not apply the component organization.');
      }
      return {
        ok: true,
        title,
        output: `Organized and named ${request.components.length} ${request.components.length === 1 ? 'component' : 'components'} in Affinity.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        title,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async applyLayerNames(request: ApplyLayerNamesRequest): Promise<ScriptRunResult> {
    const startedAt = new Date().toISOString();
    const title = 'Name Affinity layers';
    await this.connect();
    try {
      const script = `
'use strict';
const { Document } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const request = ${JSON.stringify(request)};
const doc = Document.current;
if (!doc || String(doc.sessionUuid || '') !== request.documentSessionUuid) {
  throw new Error('The active Affinity document changed after Component Scan. Scan it again before applying names.');
}
function itemAt(collection, wanted) {
  let index = 0;
  for (const item of collection) {
    if (index === wanted) return item;
    index += 1;
  }

  return null;
}
function resolvePath(path) {
  if (!Array.isArray(path) || path.length < 2 || path[0] < 0) return null;
  let node = itemAt(doc.spreads, path[0]);
  if (!node) return null;
  for (let index = 1; index < path.length; index += 1) {
    node = itemAt(node.children, path[index]);
    if (!node) return null;
  }
  return node;
}
const resolved = request.layers.map((layer) => ({ name: String(layer.name || '').slice(0, 80), node: resolvePath(layer.path) }));
if (resolved.some((entry) => !entry.node)) throw new Error('The Affinity layer hierarchy changed after scanning. No names were applied; scan the document again.');
const renamed = [];
for (const entry of resolved) {
  doc.executeCommand(DocumentCommand.createSetDescription(Selection.create(doc, entry.node, true), entry.name));
  renamed.push(entry.node);
}
doc.selection = Selection.create(doc, renamed, true);
console.log('KRYEO_LAYERS_NAMED:' + JSON.stringify({ count: renamed.length, title: String(doc.title || 'Untitled') }));`;
      const result = await this.callTool('execute_script', { script }, 120_000);
      const output = textFromResult(result);
      if (result.isError || output.lastIndexOf('KRYEO_LAYERS_NAMED:') < 0) throw new Error(output || 'Affinity could not apply the layer names.');
      return {
        ok: true,
        title,
        output: `Named ${request.layers.length} ${request.layers.length === 1 ? 'layer' : 'layers'} in Affinity.`,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        title,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async exportConfirmedComponentAssets(documentSessionUuid: string, assets: AffinityComponentAssetRequest[]): Promise<AffinityComponentAssetResult[]> {
    if (!assets.length) return [];
    await this.connect();
    const script = `
'use strict';
const { Document, FileExportArea, FileExportOptions } = require('/document');
const { Selection } = require('/selections');
const { DocumentCommand } = require('/commands');
const request = ${JSON.stringify({ documentSessionUuid, assets })};
const doc = Document.current;
if (!doc || String(doc.sessionUuid || '') !== request.documentSessionUuid) throw new Error('The active Affinity document changed after Component Scan. Scan it again before creating assets.');
function at(collection, wanted) { let i = 0; for (const item of collection) { if (i++ === wanted) return item; } return null; }
function resolve(target, parts) { let node = at(target.spreads, parts[0]); for (let i = 1; node && i < parts.length; i += 1) node = at(node.children, parts[i]); return node; }
function children(node) { const output = []; try { for (const child of node.children) output.push(child); } catch (_) {} return output; }
function retain(target, selected) {
  const keep = new Set();
  const mark = (node) => { keep.add(node); for (const child of children(node)) mark(child); };
  for (const node of selected) mark(node);
  const visit = (node) => { if (keep.has(node)) return; let hasKeptChild = false; for (const child of children(node)) { visit(child); if (keep.has(child)) hasKeptChild = true; } if (hasKeptChild) keep.add(node); else target.executeCommand(DocumentCommand.createDeleteSelection(Selection.create(target, node, true), true)); };
  for (const spread of target.spreads) for (const node of children(spread)) visit(node);
}
const snapshotCount = doc.snapshots.length;
doc.executeCommand(DocumentCommand.createAddDocumentSnapshot('Kryeo component export'), false);
const snapshot = doc.snapshots[snapshotCount];
if (!snapshot) throw new Error('Affinity could not create a safe component snapshot.');
const output = [];
try {
  for (const asset of request.assets) {
    const clone = snapshot.createDocument();
    try {
      const selected = asset.sourcePaths.map((parts) => resolve(clone, parts));
      if (selected.some((node) => !node)) throw new Error('The Affinity layer hierarchy changed after scanning.');
      retain(clone, selected);
      clone.saveAs(asset.sourcePath);
      const records = clone.export(asset.rasterPath, FileExportOptions.createWithPresetName('PNG'), FileExportArea.createForSelection(Selection.create(clone, selected, true)));
      let exported = false; for (const record of records.all) if (record.isSuccess) exported = true;
      if (!exported) throw new Error('Affinity could not export the component PNG.');
      output.push({ id: asset.id, sourcePath: asset.sourcePath, rasterPath: asset.rasterPath });
    } finally { try { clone.close(); } catch (_) {} }
  }
} finally { try { doc.executeCommand(DocumentCommand.createDeleteDocumentSnapshot(snapshot), false); } catch (_) {} }
console.log('KRYEO_COMPONENT_ASSETS:' + JSON.stringify(output));`;
    const result = await this.callTool('execute_script', { script }, 240_000);
    const output = textFromResult(result);
    const marker = 'KRYEO_COMPONENT_ASSETS:';
    const index = output.lastIndexOf(marker);
    if (result.isError || index < 0) throw new Error(output || 'Affinity could not create the component assets.');
    return JSON.parse(output.slice(index + marker.length).split(/\r?\n/, 1)[0]) as AffinityComponentAssetResult[];
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (transport) {
      try {
        await withTimeout(transport.close(), 800);
      } catch {
        // Closing a stale transport is best effort.
      }
    }
  }
}
