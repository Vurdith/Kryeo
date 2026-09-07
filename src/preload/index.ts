import { contextBridge, ipcRenderer } from 'electron';
import type { KryeoApi } from '../shared/types';

const api: KryeoApi = {
  getStatus: () => ipcRenderer.invoke('kryeo:get-status'),
  reconnect: () => ipcRenderer.invoke('kryeo:reconnect'),
  getDocumentContext: () => ipcRenderer.invoke('kryeo:get-document-context'),
  scanComponents: (request = 'document') => ipcRenderer.invoke('kryeo:scan-components', request),
  cancelComponentScan: () => ipcRenderer.invoke('kryeo:cancel-component-scan'),
  onComponentScanProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('kryeo:scan-progress', handler);
    return () => ipcRenderer.removeListener('kryeo:scan-progress', handler);
  },
  setDeveloperMode: (enabled) => ipcRenderer.invoke('kryeo:set-developer-mode', enabled),
  getDeveloperLog: () => ipcRenderer.invoke('kryeo:get-developer-log'),
  clearDeveloperLog: () => ipcRenderer.invoke('kryeo:clear-developer-log'),
  copyText: (value) => ipcRenderer.invoke('kryeo:copy-text', value),
  setDeveloperLogStreaming: (enabled) => ipcRenderer.send('kryeo:set-developer-log-streaming', enabled),
  onDeveloperLog: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, entries: Parameters<typeof listener>[0]) => listener(entries);
    ipcRenderer.on('kryeo:developer-log', handler);
    return () => ipcRenderer.removeListener('kryeo:developer-log', handler);
  },
  getLocalAiStatus: () => ipcRenderer.invoke('kryeo:get-local-ai-status'),
  getHostedAiStatus: () => ipcRenderer.invoke('kryeo:get-hosted-ai-status'),
  configureHostedAi: (configuration) => ipcRenderer.invoke('kryeo:configure-hosted-ai', configuration),
  explainComponentFamily: (request) => ipcRenderer.invoke('kryeo:explain-component-family', request),
  getAssistantStatus: () => ipcRenderer.invoke('kryeo:get-assistant-status'),
  installAssistant: (modelPack) => ipcRenderer.invoke('kryeo:install-assistant', modelPack),
  chatWithAssistant: (request) => ipcRenderer.invoke('kryeo:chat-with-assistant', request),
  forgetAssistantMemory: (id) => ipcRenderer.invoke('kryeo:forget-assistant-memory', id),
  clearAssistantMemories: () => ipcRenderer.invoke('kryeo:clear-assistant-memories'),
  setAssistantMemoryScope: (id, scope, project) => ipcRenderer.invoke('kryeo:set-assistant-memory-scope', id, scope, project),
  createAssistantSession: (project) => ipcRenderer.invoke('kryeo:create-assistant-session', project),
  updateAssistantSession: (request) => ipcRenderer.invoke('kryeo:update-assistant-session', request),
  deleteAssistantSession: (id) => ipcRenderer.invoke('kryeo:delete-assistant-session', id),
  exportAssistantSession: (id) => ipcRenderer.invoke('kryeo:export-assistant-session', id),
  importAssistantSession: (project) => ipcRenderer.invoke('kryeo:import-assistant-session', project),
  saveProjectNote: (request) => ipcRenderer.invoke('kryeo:save-project-note', request),
  deleteProjectNote: (project, id) => ipcRenderer.invoke('kryeo:delete-project-note', project, id),
  exportProjectKnowledge: (project) => ipcRenderer.invoke('kryeo:export-project-knowledge', project),
  importProjectKnowledge: (project) => ipcRenderer.invoke('kryeo:import-project-knowledge', project),
  analyzeComponents: (components) => ipcRenderer.invoke('kryeo:analyze-components', components),
  applyComponentOrganization: (request) => ipcRenderer.invoke('kryeo:apply-component-organization', request),
  applyLayerNames: (request) => ipcRenderer.invoke('kryeo:apply-layer-names', request),
  saveComponentDecisions: (decisions) => ipcRenderer.invoke('kryeo:save-component-decisions', decisions),
  forgetComponentDecision: (visualHash) => ipcRenderer.invoke('kryeo:forget-component-decision', visualHash),
  setComponentDecisionScope: (visualHash, scope) => ipcRenderer.invoke('kryeo:set-component-decision-scope', visualHash, scope),
  clearComponentDecisions: () => ipcRenderer.invoke('kryeo:clear-component-decisions'),
  saveComponentReview: (request) => ipcRenderer.invoke('kryeo:save-component-review', request),
  createComponentAssets: (request) => ipcRenderer.invoke('kryeo:create-component-assets', request),
  saveScanIntentProfile: (profile) => ipcRenderer.invoke('kryeo:save-scan-intent-profile', profile),
  listTools: () => ipcRenderer.invoke('kryeo:list-tools'),
  runTool: (title) => ipcRenderer.invoke('kryeo:run-tool', title),
  openAsset: (path, displayName) => ipcRenderer.invoke('kryeo:open-asset', path, displayName),
  saveAsset: (request) => ipcRenderer.invoke('kryeo:save-asset', request),
  runConfiguredTool: (request) => ipcRenderer.invoke('kryeo:run-configured-tool', request),
  placeAsset: (request) => ipcRenderer.invoke('kryeo:place-asset', request),
  getAssetLibrary: () => ipcRenderer.invoke('kryeo:get-asset-library'),
  getLibraryLogs: () => ipcRenderer.invoke('kryeo:get-library-logs'),
  revealPath: (path) => ipcRenderer.invoke('kryeo:reveal-path', path),
  getConnectors: () => ipcRenderer.invoke('kryeo:get-connectors'),
  refreshConnectors: () => ipcRenderer.invoke('kryeo:refresh-connectors'),
  getWorkspace: () => ipcRenderer.invoke('kryeo:get-workspace'),
  cancelJob: (id) => ipcRenderer.invoke('kryeo:cancel-job', id),
  savePreset: (preset) => ipcRenderer.invoke('kryeo:save-preset', preset),
  deletePreset: (id) => ipcRenderer.invoke('kryeo:delete-preset', id),
  setAssetPreference: (preference) => ipcRenderer.invoke('kryeo:set-asset-preference', preference),
  deliverProject: (project, target) => ipcRenderer.invoke('kryeo:deliver-project', project, target),
  cleanupStaging: () => ipcRenderer.invoke('kryeo:cleanup-staging'),
};

contextBridge.exposeInMainWorld('kryeo', api);
