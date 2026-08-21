import {
  Activity,
  Archive,
  ArrowRight,
  ArrowLeft,
  Blocks,
  Box,
  BrainCircuit,
  Cable,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Command,
  Clock3,
  ExternalLink,
  Download,
  FileCode2,
  FolderOpen,
  Gamepad2,
  HardDrive,
  LayoutDashboard,
  Layers3,
  LibraryBig,
  LoaderCircle,
  MessageSquare,
  MousePointer2,
  Package,
  Palette,
  Play,
  Pin,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Send,
  Settings,
  ScanSearch,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AffinityStatus,
  AssistantAction,
  AssistantStatus,
  AssetLibrarySnapshot,
  AssetRecord,
  ComponentAssetType,
  ComponentDecision,
  ComponentDiveMode,
  ComponentScanProgress,
  ComponentScanResult,
  ComponentScanMode,
  ComponentScanScope,
  HostedAiStatus,
  LocalAiStatus,
  ConnectorSnapshot,
  ConfiguredToolRequest,
  DocumentContext,
  DeveloperLogEntry,
  DeveloperLogSnapshot,
  KryeoTool,
  KryeoConnector,
  LibraryLogs,
  PlaceAssetRequest,
  ScriptRunResult,
  SaveAssetRequest,
  ToolCategory,
  JobRecord,
  RobloxUiRole,
  WorkspaceSnapshot,
  WorkflowPreset,
} from '../../shared/types';
import kryeoMark from './assets/kryeo-mark.png';

declare const __KRYEO_VERSION__: string;

const APP_VERSION = __KRYEO_VERSION__;

type Page = 'home' | 'assistant' | 'learning' | 'connectors' | 'tools' | 'import' | 'assets' | 'activity' | 'settings' | 'save' | 'configure' | 'place';
type SettingsStartPage = Extract<Page, 'home' | 'assistant' | 'learning' | 'connectors' | 'tools' | 'import' | 'assets' | 'activity'>;

const SETTINGS_START_PAGES: Array<{ id: SettingsStartPage; label: string }> = [
  { id: 'home', label: 'Pipeline' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'assets', label: 'Assets' },
  { id: 'tools', label: 'Workflows' },
  { id: 'import', label: 'Scan & export' },
  { id: 'learning', label: 'Learning' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'activity', label: 'Activity' },
];

interface ActivityEntry extends ScriptRunResult {
  id: string;
}

const EMPTY_STATUS: AffinityStatus = {
  state: 'connecting',
  message: 'Connecting to Affinity...',
  serverUrl: 'http://localhost:6767/sse',
  checkedAt: new Date().toISOString(),
};

const EMPTY_DOCUMENT: DocumentContext = {
  open: false,
  title: '',
  path: '',
  selectionCount: 0,
  selectionNames: [],
  sessionUuid: '',
};

const EMPTY_LIBRARY: AssetLibrarySnapshot = {
  available: false,
  root: '',
  assets: [],
  totalVersions: 0,
  projects: [],
  categories: [],
  updatedAt: '',
  message: 'Loading the asset library...',
  versions: [],
  duplicateCodeNames: [],
  unhealthyCount: 0,
};

const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  jobs: [], presets: [], links: [], preferences: [], componentDecisions: [], componentManifests: [], scanIntentProfiles: [], assistantMemories: [], assistantSessions: [], assistantMessages: [], projectKnowledge: [], updatedAt: '',
};

const EMPTY_DEVELOPER_LOG: DeveloperLogSnapshot = {
  enabled: false,
  entries: [],
  filePath: '',
};

const EMPTY_CONNECTORS: ConnectorSnapshot = {
  connectors: [],
  routes: [],
  scannedAt: '',
  machineName: '',
};

const toolIcons = {
  save: Save,
  'folder-open': FolderOpen,
  refresh: RefreshCw,
  package: Package,
  wand: WandSparkles,
  symmetry: Sparkles,
  script: FileCode2,
};

const categoryOrder: ToolCategory[] = ['Assets', 'Pixel tools', 'Symmetry', 'Utilities'];
const minimumBootMs = import.meta.env.DEV ? Number(import.meta.env.VITE_KRYEO_BOOT_MS || 2400) : 2400;
const ASSET_TYPES = [
  'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text', 'TextBox',
  'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor', 'Tooltip', 'Modal', 'Input',
  'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
];
const ASSET_STATES = ['', 'Idle', 'Hover', 'Pressed', 'Selected', 'Disabled', 'Active', 'Inactive', 'Focused', 'Checked', 'Empty', 'Filled', 'Locked'];
const ROBLOX_UI_ROLES: RobloxUiRole[] = ['Unknown', 'ImageButton', 'ImageLabel', 'Frame', 'TextButton', 'TextLabel', 'TextBox'];
const COMPONENT_ASSET_TYPES: ComponentAssetType[] = ['Unknown', ...ASSET_TYPES] as ComponentAssetType[];

function codePart(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/'/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
}

function categoryForType(type: string): string {
  return `${type}s`;
}

function hostedModelLabel(model?: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return 'Cloud reviewer';
  const lower = normalized.toLowerCase();
  if (lower.includes('gemini-3.1-flash-lite')) return 'Gemini 3.1 Flash Lite';
  if (lower.includes('gemini-3-flash')) return 'Gemini 3 Flash';
  if (lower.includes('gemini')) return 'Gemini cloud reviewer';
  if (lower.includes('qwen3.7') || lower.includes('qwen-3.7') || lower.includes('qwen 3.7')) return 'Cloud Qwen 3.7 Flash';
  if (lower.includes('qwen')) return 'Cloud Qwen reviewer';
  return normalized.split('/').pop()?.replace(/[-_]+/g, ' ') || 'Cloud reviewer';
}

function readActivity(): ActivityEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem('kryeo.activity') || '[]');
    return Array.isArray(value) ? value.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(milliseconds: number): string {
  const duration = Math.max(0, Math.round(milliseconds));
  if (duration < 1_000) return `${duration}ms`;
  if (duration < 60_000) return `${(duration / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(duration / 60_000);
  const seconds = Math.round((duration % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function relativeDate(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function StatusDot({ status }: { status: AffinityStatus }) {
  return <span className={`status-dot status-dot--${status.state}`} aria-hidden="true" />;
}

function ToolIcon({ tool, size = 19 }: { tool: KryeoTool; size?: number }) {
  const Icon = toolIcons[tool.icon];
  return <Icon size={size} strokeWidth={1.8} />;
}

function AssetPreviewCanvas({ source, label }: { source: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let disposed = false;
    const image = new window.Image();
    const draw = () => {
      if (disposed || !image.naturalWidth || !image.naturalHeight) return;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;

      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      const backingWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
      const backingHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.imageSmoothingEnabled = false;

      const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
      const width = Math.max(1, Math.floor(image.naturalWidth * scale));
      const height = Math.max(1, Math.floor(image.naturalHeight * scale));
      const x = Math.floor((bounds.width - width) / 2);
      const y = Math.floor((bounds.height - height) / 2);
      context.drawImage(image, x, y, width, height);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    image.addEventListener('load', draw);
    image.src = source;

    return () => {
      disposed = true;
      observer.disconnect();
      image.removeEventListener('load', draw);
    };
  }, [source]);

  return <canvas ref={canvasRef} className="asset-preview-canvas" role="img" aria-label={label} />;
}

function App() {
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>(() => {
    const preferred = localStorage.getItem('kryeo.start-page') as Page | null;
    const saved = preferred || localStorage.getItem('kryeo.page') as Page | null;
    return saved && ['home', 'assistant', 'connectors', 'tools', 'import', 'assets', 'activity', 'settings', 'save', 'configure', 'place'].includes(saved) ? saved : 'home';
  });
  const [status, setStatus] = useState<AffinityStatus>(EMPTY_STATUS);
  const [document, setDocument] = useState<DocumentContext>(EMPTY_DOCUMENT);
  const [tools, setTools] = useState<KryeoTool[]>([]);
  const [library, setLibrary] = useState<AssetLibrarySnapshot>(EMPTY_LIBRARY);
  const [connectors, setConnectors] = useState<ConnectorSnapshot>(EMPTY_CONNECTORS);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [logs, setLogs] = useState<LibraryLogs>({ run: '', error: '', root: '' });
  const [activities, setActivities] = useState<ActivityEntry[]>(readActivity);
  const [runningTitle, setRunningTitle] = useState('');
  const [openingAssetPath, setOpeningAssetPath] = useState('');
  const [savingAsset, setSavingAsset] = useState(false);
  const [configuredTool, setConfiguredTool] = useState<KryeoTool | null>(null);
  const [placingAsset, setPlacingAsset] = useState(false);
  const [search, setSearch] = useState('');
  const [toolCategory, setToolCategory] = useState<ToolCategory | 'All'>('All');
  const [assetProject, setAssetProject] = useState('All');
  const [assetCategory, setAssetCategory] = useState('All');
  const [logTab, setLogTab] = useState<'run' | 'error'>('run');
  const [loading, setLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [bootState, setBootState] = useState<'active' | 'leaving' | 'done'>('active');
  const [savingKey, setSavingKey] = useState(false);
  const [developerMode, setDeveloperMode] = useState(() => localStorage.getItem('kryeo.developer-mode') === 'true');
  const [developerLog, setDeveloperLog] = useState<DeveloperLogSnapshot>(EMPTY_DEVELOPER_LOG);
  const developerModeSync = useRef(developerMode);

  const refreshDocument = useCallback(async () => {
    try {
      const context = await window.kryeo.getDocumentContext();
      setDocument(context);
      const currentStatus = await window.kryeo.getStatus();
      setStatus(currentStatus);
    } catch {
      setDocument(EMPTY_DOCUMENT);
      setStatus(await window.kryeo.getStatus());
    }
  }, []);

  const refreshAll = useCallback(async (forceReconnect = false) => {
    setLoading(true);
    try {
      const nextStatus = forceReconnect
        ? await window.kryeo.reconnect()
        : await window.kryeo.getStatus();
      setStatus(nextStatus);

      // Connector scanning is supplementary. It must never block the established
      // Affinity workflows, library, or activity data from becoming available.
      void (forceReconnect ? window.kryeo.refreshConnectors() : window.kryeo.getConnectors())
        .then(setConnectors)
        .catch(() => undefined);

      const [libraryResult, logResult, workspaceResult] = await Promise.allSettled([
        window.kryeo.getAssetLibrary(),
        window.kryeo.getLibraryLogs(),
        window.kryeo.getWorkspace(),
      ]);
      if (libraryResult.status === 'fulfilled') setLibrary(libraryResult.value);
      if (logResult.status === 'fulfilled') setLogs(logResult.value);
      if (workspaceResult.status === 'fulfilled') setWorkspace(workspaceResult.value);

      if (nextStatus.state === 'connected') {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const nextTools = await window.kryeo.listTools();
            if (nextTools.length === 0) throw new Error('Affinity returned an empty workflow list.');
            setTools(nextTools);
            setWorkflowError('');
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 650));
          }
        }
        if (lastError) {
          setWorkflowError(lastError instanceof Error ? lastError.message : String(lastError));
        }
        await refreshDocument();
      } else {
        setDocument(EMPTY_DOCUMENT);
        setWorkflowError('Affinity is offline. Reconnect to load its workflows.');
      }
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [refreshDocument]);

  useEffect(() => {
    const unsubscribe = window.kryeo.onDeveloperLog((entry) => {
      setDeveloperLog((current) => ({
        ...current,
        entries: [...current.entries, entry].slice(-5000),
      }));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    let exitTimer = 0;
    void (async () => {
      try {
        setDeveloperLog(await window.kryeo.setDeveloperMode(developerMode));
      } catch {
        // Developer logging is optional and must not hold up the boot flow.
      }
      await Promise.all([
        refreshAll(true),
        new Promise((resolve) => window.setTimeout(resolve, minimumBootMs)),
      ]);
      if (!active) return;
      setBootState('leaving');
      exitTimer = window.setTimeout(() => {
        if (active) setBootState('done');
      }, 360);
    })();
    return () => {
      active = false;
      window.clearTimeout(exitTimer);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (developerModeSync.current === developerMode) return;
    developerModeSync.current = developerMode;
    void window.kryeo.setDeveloperMode(developerMode)
      .then(setDeveloperLog)
      .catch(() => undefined);
  }, [developerMode]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!runningTitle && !placingAsset) void refreshDocument();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [placingAsset, refreshDocument, runningTitle]);

  useEffect(() => {
    let active = true;
    const syncConnectorHealth = async () => {
      const nextStatus = await window.kryeo.getStatus();
      if (!active) return;
      setStatus(nextStatus);
      if (nextStatus.state !== 'connected') {
        setDocument(EMPTY_DOCUMENT);
        setTools([]);
        setWorkflowError('Affinity is offline. Reconnect to load its workflows.');
      }
      void window.kryeo.getConnectors().then((next) => {
        if (active) setConnectors(next);
      }).catch(() => undefined);
    };
    void syncConnectorHealth();
    const interval = window.setInterval(() => void syncConnectorHealth(), 1200);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => void window.kryeo.getWorkspace().then(setWorkspace).catch(() => undefined), 1200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem('kryeo.page', page);
    workspaceContentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem('kryeo.activity', JSON.stringify(activities.slice(0, 30)));
  }, [activities]);

  const runTool = useCallback(async (tool: KryeoTool) => {
    if (runningTitle) return;
    if (tool.icon === 'folder-open' && /asset library\s*-\s*load/i.test(tool.title)) {
      setSearch('');
      setPage('assets');
      return;
    }
    if (tool.icon === 'save' && /asset library\s*-\s*save/i.test(tool.title)) {
      setSearch('');
      setPage('save');
      return;
    }
    if (tool.id === 'place-asset') {
      setSearch('');
      setPage('place');
      return;
    }
    if (/asset library\s*-\s*(export|update)|pixel helper\s*-\s*hand shade/i.test(tool.title)) {
      setConfiguredTool(tool);
      setPage('configure');
      return;
    }
    setRunningTitle(tool.title);
    const result = await window.kryeo.runTool(tool.title);
    const entry: ActivityEntry = {
      ...result,
      id: `${result.completedAt}-${tool.id}`,
    };
    setActivities((current) => [entry, ...current].slice(0, 30));
    setRunningTitle('');
    await Promise.all([
      refreshDocument(),
      window.kryeo.getAssetLibrary().then(setLibrary),
      window.kryeo.getLibraryLogs().then(setLogs),
    ]);
  }, [refreshDocument, runningTitle]);

  const runConfiguredTool = useCallback(async (request: ConfiguredToolRequest) => {
    if (runningTitle) return;
    setRunningTitle(request.title);
    const result = await window.kryeo.runConfiguredTool(request);
    setActivities((current) => [{ ...result, id: `${result.completedAt}-configured-${request.kind}` }, ...current].slice(0, 30));
    setRunningTitle('');
    const [nextLibrary, nextLogs] = await Promise.all([window.kryeo.getAssetLibrary(), window.kryeo.getLibraryLogs()]);
    setLibrary(nextLibrary);
    setLogs(nextLogs);
    await refreshDocument();
  }, [refreshDocument, runningTitle]);

  const placeAsset = useCallback(async (request: PlaceAssetRequest) => {
    if (placingAsset) return;
    setPlacingAsset(true);
    const result = await window.kryeo.placeAsset(request);
    setActivities((current) => [{ ...result, id: `${result.completedAt}-place-${request.layerKind}` }, ...current].slice(0, 30));
    setPlacingAsset(false);
    await refreshDocument();
  }, [placingAsset, refreshDocument]);

  const openAsset = useCallback(async (asset: AssetRecord) => {
    if (openingAssetPath) return;
    setOpeningAssetPath(asset.path);
    const result = await window.kryeo.openAsset(asset.path, asset.displayName || asset.name);
    const entry: ActivityEntry = {
      ...result,
      id: `${result.completedAt}-open-${asset.id}`,
    };
    setActivities((current) => [entry, ...current].slice(0, 30));
    setOpeningAssetPath('');
    await refreshDocument();
  }, [openingAssetPath, refreshDocument]);

  const saveAsset = useCallback(async (request: SaveAssetRequest) => {
    if (savingAsset) return;
    setSavingAsset(true);
    const result = await window.kryeo.saveAsset(request);
    const entry: ActivityEntry = {
      ...result,
      id: `${result.completedAt}-save-${request.codeName}`,
    };
    setActivities((current) => [entry, ...current].slice(0, 30));
    setSavingAsset(false);
    const [nextLibrary, nextLogs] = await Promise.all([
      window.kryeo.getAssetLibrary(),
      window.kryeo.getLibraryLogs(),
    ]);
    setLibrary(nextLibrary);
    setLogs(nextLogs);
    await refreshDocument();
    if (result.ok) setPage('assets');
  }, [refreshDocument, savingAsset]);

  const featuredTools = useMemo(() => tools.filter((tool) => tool.featured).slice(0, 4), [tools]);
  const filteredTools = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tools.filter((tool) => {
      const categoryMatch = toolCategory === 'All' || tool.category === toolCategory;
      const queryMatch = !query || `${tool.displayName} ${tool.description} ${tool.category}`.toLowerCase().includes(query);
      return categoryMatch && queryMatch;
    });
  }, [search, toolCategory, tools]);
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return library.assets.filter((asset) => {
      const projectMatch = assetProject === 'All' || asset.project === assetProject;
      const categoryMatch = assetCategory === 'All' || asset.category === assetCategory;
      const queryMatch = !query || `${asset.displayName} ${asset.codeName} ${asset.project} ${asset.category}`.toLowerCase().includes(query);
      return projectMatch && categoryMatch && queryMatch;
    });
  }, [assetCategory, assetProject, library.assets, search]);
  const activeJob = workspace.jobs.find((job) => job.status === 'running' || job.status === 'queued');
  const showInspector = document.open || Boolean(activeJob);

  const retryJob = useCallback(async (job: JobRecord) => {
    const payload = job.payload as Record<string, unknown>;
    if (job.operation === 'tool') await window.kryeo.runTool(String(payload.title || job.title));
    if (job.operation === 'open') await window.kryeo.openAsset(String(payload.path || ''), String(payload.displayName || job.title));
    if (job.operation === 'save') await window.kryeo.saveAsset(payload as unknown as SaveAssetRequest);
    if (job.operation === 'configured') await window.kryeo.runConfiguredTool(payload as unknown as ConfiguredToolRequest);
    if (job.operation === 'place') await window.kryeo.placeAsset(payload as unknown as PlaceAssetRequest);
    if (job.operation === 'delivery') await window.kryeo.deliverProject(String(payload.project || ''), 'roblox');
    if (job.operation === 'cleanup') await window.kryeo.cleanupStaging();
    setWorkspace(await window.kryeo.getWorkspace());
  }, []);

  const savePreference = useCallback(async (assetId: string, favourite: boolean, collections: string[]) => {
    setWorkspace(await window.kryeo.setAssetPreference({ assetId, favourite, collections }));
  }, []);

  const navItems: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'home', label: 'Pipeline', icon: LayoutDashboard },
    { id: 'assistant', label: 'Assistant', icon: MessageSquare },
    { id: 'learning', label: 'Learning', icon: BrainCircuit },
    { id: 'connectors', label: 'Connectors', icon: Cable },
    { id: 'tools', label: 'Workflows', icon: Blocks },
    { id: 'import', label: 'Import', icon: ScanSearch },
    { id: 'assets', label: 'Assets', icon: LibraryBig },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className={`app-shell ${showInspector ? '' : 'app-shell--no-inspector'}`}>
      <header className="titlebar">
        <div className="brand-mark" aria-hidden="true"><img src={kryeoMark} alt="" /></div>
        <span className="brand-name">Kryeo</span>
      </header>

      <aside className="command-rail" aria-label="Primary navigation">
        <div className="rail-spacer" />
        <nav className="rail-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`rail-button ${page === id ? 'is-active' : ''}`}
              onClick={() => setPage(id)}
              title={label}
              aria-label={label}
            >
              <Icon size={20} strokeWidth={1.8} />
              <span className="rail-label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <aside className="section-nav">
        <SectionNavigation
          page={page}
          toolCategory={toolCategory}
          setToolCategory={setToolCategory}
          assetProject={assetProject}
          setAssetProject={setAssetProject}
          assetCategory={assetCategory}
          setAssetCategory={setAssetCategory}
          library={library}
        />
      </aside>

      <main className="workspace">
        <div className="workspace-toolbar">
          <div className="toolbar-leading">
          {page === 'save' || page === 'configure' || page === 'place' ? (
            <button className="back-button" onClick={() => setPage('tools')}><ArrowLeft size={16} />Back to tools</button>
          ) : page === 'assets' || page === 'tools' ? (
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={page === 'assets' ? 'Search assets' : 'Search tools'}
                aria-label={page === 'assets' ? 'Search assets' : 'Search tools'}
              />
            </div>
          ) : (
            <div className="toolbar-context">
              <Cable size={16} />
              <span>{connectors.connectors.find((connector) => connector.id === 'affinity')?.configured ? 'Affinity connected' : 'Affinity offline'} · {connectors.connectors.filter((connector) => connector.installed).length} applications installed</span>
            </div>
          )}
          <button className="icon-button" onClick={() => setCommandOpen(true)} title="Command palette (Ctrl+K)" aria-label="Open command palette"><Command size={17} /></button>
          </div>
          {activeJob && <button className="global-job" onClick={() => setPage('activity')} title={activeJob.stage}><span>{activeJob.title}</span><i><b style={{ width: `${activeJob.progress}%` }} /></i><small>{activeJob.progress}%</small></button>}
        </div>

        <div className="workspace-content" ref={workspaceContentRef}>
          {page === 'home' && (
            <HomePage
              status={status}
              document={document}
              tools={featuredTools}
              assets={library.assets.slice(0, 5)}
              connectors={connectors}
              loading={loading}
              runningTitle={runningTitle}
              onRun={runTool}
              onNavigate={setPage}
            />
          )}
          {page === 'tools' && (
            <ToolsPage
              tools={filteredTools}
              loading={loading}
              runningTitle={runningTitle}
              connected={status.state === 'connected'}
              workflowError={tools.length === 0 ? workflowError : ''}
              onRetry={() => void refreshAll(true)}
              onRun={runTool}
            />
          )}
          {page === 'connectors' && (
            <ConnectorsPage
              snapshot={connectors}
              onRefresh={async () => {
                const next = await window.kryeo.refreshConnectors();
                setConnectors(next);
                return next;
              }}
            />
          )}
          {page === 'assistant' && (
            <AssistantPage
              document={document}
              projects={library.projects}
              workspace={workspace}
              onWorkspace={setWorkspace}
              onNavigate={setPage}
            />
          )}
          {page === 'learning' && (
            <LearningPage workspace={workspace} onWorkspace={setWorkspace} />
          )}
          {page === 'import' && (
            <ComponentScanPage
              document={document}
              connected={status.state === 'connected'}
              onWorkspace={setWorkspace}
              developerMode={developerMode}
            />
          )}
          {page === 'assets' && (
            <AssetsPage
              library={library}
              assets={filteredAssets}
              openingAssetPath={openingAssetPath}
              connected={status.state === 'connected'}
              onOpen={openAsset}
              onReveal={(path) => void window.kryeo.revealPath(path)}
              workspace={workspace}
              project={assetProject === 'All' ? (filteredAssets[0]?.project || library.projects[0] || 'General') : assetProject}
              onWorkspace={setWorkspace}
              onPreference={savePreference}
              onNavigate={setPage}
            />
          )}
          {page === 'activity' && (
            <ActivityPage
              activities={activities}
              jobs={workspace.jobs}
              onCancel={(id) => void window.kryeo.cancelJob(id).then(() => window.kryeo.getWorkspace()).then(setWorkspace)}
              onRetry={(job) => void retryJob(job)}
              logs={logs}
              tab={logTab}
              setTab={setLogTab}
            />
          )}
          {page === 'settings' && (
            <SettingsPage version={APP_VERSION} status={status} onReconnect={() => void refreshAll(true)} onWorkspace={setWorkspace} developerMode={developerMode} onDeveloperModeChange={setDeveloperMode} developerLog={developerLog} onDeveloperLogChange={setDeveloperLog} />
          )}
          {page === 'save' && (
            <SavePage
              document={document}
              library={library}
              connected={status.state === 'connected'}
              saving={savingAsset}
              onSave={saveAsset}
            />
          )}
          {page === 'configure' && configuredTool && (
            <ConfiguredToolPage
              tool={configuredTool}
              document={document}
              library={library}
              connected={status.state === 'connected'}
              running={runningTitle === configuredTool.title}
              onRun={runConfiguredTool}
              workspace={workspace}
              onWorkspace={setWorkspace}
            />
          )}
          {page === 'place' && (
            <PlaceAssetPage
              document={document}
              library={library}
              connected={status.state === 'connected'}
              placing={placingAsset}
              onPlace={placeAsset}
            />
          )}
        </div>
      </main>

      {showInspector && <aside className="inspector">
        <Inspector
          status={status}
          document={document}
          activities={activities.slice(0, 4)}
          connectors={connectors}
          jobs={workspace.jobs.slice(0, 4)}
        />
      </aside>}
      {commandOpen && <CommandPalette query={commandQuery} setQuery={setCommandQuery} tools={tools} assets={library.assets} onClose={() => setCommandOpen(false)} onPage={(next) => { setPage(next); setCommandOpen(false); }} onTool={(tool) => { void runTool(tool); setCommandOpen(false); }} onAsset={(asset) => { void openAsset(asset); setCommandOpen(false); }} />}
      {bootState !== 'done' && <BootScreen leaving={bootState === 'leaving'} />}
    </div>
  );
}

interface SectionNavigationProps {
  page: Page;
  toolCategory: ToolCategory | 'All';
  setToolCategory: (category: ToolCategory | 'All') => void;
  assetProject: string;
  setAssetProject: (project: string) => void;
  assetCategory: string;
  setAssetCategory: (category: string) => void;
  library: AssetLibrarySnapshot;
}

function SectionNavigation(props: SectionNavigationProps) {
  const titles: Record<Page, string> = {
    home: 'Pipeline',
    assistant: 'Assistant',
    learning: 'Learning',
    connectors: 'Connectors',
    tools: 'Workflows',
    import: 'Scan & export',
    assets: 'Assets',
    activity: 'Activity',
    settings: 'Settings',
    save: 'Save asset',
    configure: 'Configure tool',
    place: 'Place asset',
  };
  const descriptions: Record<Page, string> = {
    home: 'Move visual work from a live Affinity document into production-ready assets.',
    assistant: 'Keep project decisions and visual context together while you work.',
    learning: 'Review the visual rules Kryeo remembers for this workspace.',
    connectors: 'Check the applications that can send work into and out of Kryeo.',
    tools: 'Run focused operations against the current Affinity document.',
    import: 'Inspect a document, keep the hierarchy intact, then build reusable assets.',
    assets: 'Browse, inspect, and place the reusable pieces your project depends on.',
    activity: 'Follow active jobs and recent work without losing your place.',
    settings: 'Tune the local workspace, connection, and assistant behavior.',
    save: 'Name a selected layer once and store a safe, reusable version.',
    configure: 'Set the workflow inputs before Kryeo changes the source document.',
    place: 'Choose a library asset and place the right working version in Affinity.',
  };
  const title = titles[props.page];

  return (
    <div className="section-nav-inner">
      <div className="section-heading">
        <h1>{title}</h1>
        <p>{descriptions[props.page]}</p>
      </div>

      {props.page === 'tools' && (
        <div className="filter-list">
          {(['All', ...categoryOrder] as Array<ToolCategory | 'All'>).map((category) => (
            <button
              key={category}
              className={props.toolCategory === category ? 'is-selected' : ''}
              onClick={() => props.setToolCategory(category)}
            >
              <span>{category}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      )}

      {props.page === 'assets' && (
        <div className="filter-stack">
          <label>
            Project
            <select value={props.assetProject} onChange={(event) => props.setAssetProject(event.target.value)}>
              <option>All</option>
              {props.library.projects.map((project) => <option key={project}>{project}</option>)}
            </select>
          </label>
          <label>
            Category
            <select value={props.assetCategory} onChange={(event) => props.setAssetCategory(event.target.value)}>
              <option>All</option>
              {props.library.categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
        </div>
      )}

    </div>
  );
}

interface HomePageProps {
  status: AffinityStatus;
  document: DocumentContext;
  tools: KryeoTool[];
  assets: AssetRecord[];
  connectors: ConnectorSnapshot;
  loading: boolean;
  runningTitle: string;
  onRun: (tool: KryeoTool) => void;
  onNavigate: (page: Page) => void;
}

function HomePage(props: HomePageProps) {
  const affinity = props.connectors.connectors.find((connector) => connector.id === 'affinity');
  const targets = props.connectors.connectors.filter((connector) => connector.role === 'production-target');
  return (
    <div className="page-stack enter-page">
      <section className="context-band">
        <div className="context-icon"><Layers3 size={25} /></div>
        <div className="context-copy">
          <strong>{props.document.open ? props.document.title : 'No document detected'}</strong>
          <p>
            {props.document.open
              ? `${props.document.selectionCount} selected ${props.document.selectionCount === 1 ? 'layer' : 'layers'}`
              : props.status.state === 'connected' ? 'Open a document in Affinity to begin.' : 'Connect Affinity to inspect your selection.'}
          </p>
        </div>
        <div className="context-state">
          <StatusDot status={props.status} />
          {props.status.state === 'connected' ? 'Affinity connected' : 'Affinity offline'}
        </div>
      </section>

      <section className="pipeline-board" aria-label="Kryeo transfer pipeline">
        <div className="pipeline-column">
          <span className="pipeline-label">Creative source</span>
          <div className={`pipeline-node ${affinity?.state === 'connected' ? 'is-online' : ''}`}>
            <Palette size={22} />
            <div><strong><span className={`presence-dot presence-dot--${affinity?.state || 'planned'}`} />Affinity</strong><small>{affinity?.state === 'connected' ? 'MCP connected' : affinity?.installed ? 'Installed locally' : 'Not installed'}</small></div>
          </div>
        </div>
        <div className="pipeline-transfer">
          <ArrowRight size={24} aria-label="Local bridge from Affinity to production targets" />
        </div>
        <div className="pipeline-column pipeline-column--targets">
          <span className="pipeline-label">Production targets</span>
          {targets.map((connector) => (
            <div className="pipeline-node" key={connector.id}>
              <Gamepad2 size={21} />
              <div><strong><span className={`presence-dot presence-dot--${connector.state}`} />{connector.name}</strong><small>{connector.installed ? 'Installed locally' : 'Not installed'}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="pipeline-actions">
        <button onClick={() => props.onNavigate('connectors')}><Cable size={17} /><span><b>Manage connectors</b></span><ChevronRight size={16} /></button>
        <button onClick={() => props.onNavigate('assets')}><HardDrive size={17} /><span><b>Open asset library</b></span><ChevronRight size={16} /></button>
        <button onClick={() => props.onNavigate('tools')}><Blocks size={17} /><span><b>Run a workflow</b></span><ChevronRight size={16} /></button>
      </section>

      <section className="content-section">
        <div className="section-title-row">
          <div>
            <h2>Active connector workflows</h2>
          </div>
          <button className="text-button" onClick={() => props.onNavigate('tools')}>View all <ChevronRight size={15} /></button>
        </div>
        <div className="tool-grid">
          {props.loading && props.tools.length === 0
            ? Array.from({ length: 4 }, (_, index) => <div className="tool-card skeleton" key={index} />)
            : props.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} runningTitle={props.runningTitle} connected={props.status.state === 'connected'} onRun={props.onRun} />
            ))}
        </div>
      </section>

      <section className="content-section content-section--flush">
        <div className="section-title-row">
          <div>
            <h2>Recent assets</h2>
          </div>
          <button className="text-button" onClick={() => props.onNavigate('assets')}>Browse library <ChevronRight size={15} /></button>
        </div>
        <AssetTable assets={props.assets} compact />
      </section>
    </div>
  );
}

function ToolCard({ tool, runningTitle, connected, onRun }: {
  tool: KryeoTool;
  runningTitle: string;
  connected: boolean;
  onRun: (tool: KryeoTool) => void;
}) {
  const isRunning = runningTitle === tool.title;
  const disabled = !connected || Boolean(runningTitle);
  const configurable = tool.id === 'place-asset' || /asset library\s*-\s*(export|update)|pixel helper\s*-\s*hand shade/i.test(tool.title);
  return (
    <article className="tool-card">
      <div className="tool-card-top">
        <span className="tool-icon"><ToolIcon tool={tool} /></span>
      </div>
      <div className="tool-card-copy">
        <h3>{tool.displayName}</h3>
        <p>{tool.description}</p>
      </div>
      <button className="run-button" disabled={disabled} onClick={() => onRun(tool)}>
        {isRunning ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
        {isRunning ? 'Running' : tool.icon === 'folder-open' ? 'Choose' : tool.icon === 'save' || configurable ? 'Configure' : 'Run'}
      </button>
    </article>
  );
}

function ToolsPage({ tools, loading, runningTitle, connected, workflowError, onRetry, onRun }: {
  tools: KryeoTool[];
  loading: boolean;
  runningTitle: string;
  connected: boolean;
  workflowError: string;
  onRetry: () => void;
  onRun: (tool: KryeoTool) => void;
}) {
  const groups = categoryOrder
    .map((category) => ({ category, tools: tools.filter((tool) => tool.category === category) }))
    .filter((group) => group.tools.length > 0);
  return (
    <div className="page-stack enter-page">
      {!connected && !workflowError && !loading && tools.length > 0 && (
        <div className="notice notice--warning">
          <CircleAlert size={18} />
          <div><strong>Affinity is offline</strong><span>Open Affinity and enable its MCP server before running tools.</span></div>
        </div>
      )}
      {loading && tools.length === 0 ? (
        <div className="tool-grid">{Array.from({ length: 6 }, (_, index) => <div className="tool-card skeleton" key={index} />)}</div>
      ) : workflowError ? (
        <div className="empty-state empty-state--connection">
          <div className="empty-state-icon empty-state-icon--warning"><CircleAlert size={25} strokeWidth={2.8} /></div>
          <h2>{connected ? 'Workflows could not be loaded' : 'Connect Affinity to load workflows'}</h2>
          <p>{connected ? workflowError : 'Start Affinity, then enable its MCP server.'}</p>
          <button className="run-button" onClick={onRetry}><RotateCw size={18} strokeWidth={2.8} />{connected ? 'Try again' : 'Reconnect Affinity'}</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state"><Blocks size={30} /><h2>No matching tools</h2><p>Try a different search or category.</p></div>
      ) : groups.map((group) => (
        <section className="content-section" key={group.category}>
          <div className="section-title-row"><div><h2>{group.category}</h2></div></div>
          <div className="tool-grid">
            {group.tools.map((tool) => <ToolCard key={tool.id} tool={tool} runningTitle={runningTitle} connected={connected} onRun={onRun} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConnectorIcon({ connector, size = 22 }: { connector: KryeoConnector; size?: number }) {
  if (connector.id === 'affinity') return <Palette size={size} />;
  if (connector.id === 'photoshop') return <Layers3 size={size} />;
  if (connector.id === 'roblox-studio') return <Gamepad2 size={size} />;
  return <Box size={size} />;
}

function ConnectorsPage({ snapshot, onRefresh }: {
  snapshot: ConnectorSnapshot;
  onRefresh: () => Promise<ConnectorSnapshot>;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ state: 'complete' | 'error'; message: string } | null>(null);
  const refresh = async () => {
    if (scanning) return;
    setScanning(true);
    setScanFeedback(null);
    try {
      const [next] = await Promise.all([
        onRefresh(),
        new Promise((resolve) => window.setTimeout(resolve, 700)),
      ]);
      const installed = next.connectors.filter((connector) => connector.installed).length;
      setScanFeedback({ state: 'complete', message: `Scan complete. ${installed} ${installed === 1 ? 'application' : 'applications'} installed.` });
    } catch (error) {
      setScanFeedback({ state: 'error', message: error instanceof Error ? error.message : 'Application scan failed.' });
    } finally {
      setScanning(false);
    }
  };
  const sources = snapshot.connectors.filter((connector) => connector.role !== 'production-target');
  const targets = snapshot.connectors.filter((connector) => connector.role === 'production-target');

  return (
    <div className={`page-stack enter-page connector-page ${scanFeedback?.state === 'complete' ? 'is-scan-complete' : ''}`}>
      <section className={`connector-intro ${scanning ? 'is-scanning' : ''}`}>
        <div>
          <h2>Application connectors</h2>
          <p>Discover what is ready on this device before you start a workflow.</p>
        </div>
        <button className="secondary-button" onClick={() => void refresh()} disabled={scanning}>
          {scanning ? <LoaderCircle className="spin" size={16} /> : <ScanSearch size={16} />}
          {scanning ? 'Scanning' : 'Scan applications'}
        </button>
        <div className={`scan-feedback ${scanFeedback ? `scan-feedback--${scanFeedback.state}` : ''}`} role="status" aria-live="polite">
          {scanFeedback ? <>{scanFeedback.state === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}<span>{scanFeedback.message}</span></> : <span aria-hidden="true">&nbsp;</span>}
        </div>
      </section>

      <ConnectorGroup title="Creative sources" connectors={sources} />
      <ConnectorGroup title="Production targets" connectors={targets} />
    </div>
  );
}

function ConnectorGroup({ title, connectors }: {
  title: string;
  connectors: KryeoConnector[];
}) {
  return (
    <section className="content-section">
      <div className="section-title-row"><div><h2>{title}</h2><p>{connectors.length} {connectors.length === 1 ? 'application' : 'applications'} available to check</p></div></div>
      <div className="connector-grid">
        {connectors.map((connector) => (
          <article className="connector-card" key={connector.id}>
            <div className="connector-card-head">
              <span className="connector-icon"><ConnectorIcon connector={connector} /></span>
              <span className={`connector-state connector-state--${connector.state}`}>{connectorStateLabel(connector)}</span>
            </div>
            <div className="connector-card-copy">
              <h3>{connector.name}</h3>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function connectorStateLabel(connector: KryeoConnector): string {
  if (connector.state === 'connected') return 'Active';
  if (connector.state === 'detected') return connector.configured ? 'Ready' : 'Detected';
  if (connector.state === 'error') return 'Offline';
  if (connector.state === 'missing') return 'Not detected';
  return 'Planned';
}

const SHADE_STYLES = [
  ['Controlled pixel fade', 23],
  ['Smooth', 0],
  ['Soft center fade', 7],
  ['Vignette fade', 10],
  ['Frame edge fade', 11],
  ['Stroke thickness fade', 12],
  ['Material glaze fade', 13],
  ['Balanced frame gradient', 16],
  ['Soft balanced frame', 17],
  ['Lift dark bar fade', 18],
  ['Visible pixel ramp', 22],
] as const;

function configuredKind(title: string): ConfiguredToolRequest['kind'] {
  if (/export/i.test(title)) return 'export';
  if (/update/i.test(title)) return 'update';
  return 'shade';
}

function CheckField({ checked, onChange, title, description }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="save-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><b>{title}</b><small>{description}</small></span>
    </label>
  );
}

function ConfiguredToolPage({ tool, document, library, connected, running, onRun, workspace, onWorkspace }: {
  tool: KryeoTool;
  document: DocumentContext;
  library: AssetLibrarySnapshot;
  connected: boolean;
  running: boolean;
  onRun: (request: ConfiguredToolRequest) => void;
  workspace: WorkspaceSnapshot;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
}) {
  const kind = configuredKind(tool.title);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [presetName, setPresetName] = useState('');
  const presets = workspace.presets.filter((preset) => preset.kind === kind);

  useEffect(() => {
    if (kind === 'export') setValues({ project: library.projects[0] || '', preset: 'PNG (Pixel)', latest: true, stable: true });
    if (kind === 'update') setValues({ rebuildBase: true, rebuildRaster: true, defaultVisibility: true, changeNote: '' });
    if (kind === 'shade') setValues({
      light: 0, mode: 0, style: 23, scope: 0, fadeMode: 0, palette: 1, detailScale: 1,
      affect: 0, outlineMode: 1, protectOutlines: false, protectHighlights: false,
      strength: 1, texture: 1, highlightVariation: 1, placement: 0, dither: false,
    });
  }, [kind, library.projects, tool.title]);

  const setValue = (key: string, value: string | number | boolean) => setValues((current) => ({ ...current, [key]: value }));
  const needsSelection = kind === 'shade';
  const needsDocument = kind === 'shade' || kind === 'update';
  const ready = connected && (!needsDocument || document.open) && (!needsSelection || document.selectionCount > 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready && !running) onRun({ kind, title: tool.title, values });
  };

  return (
    <form className="workflow-page enter-page" onSubmit={submit}>
      <section className="save-context-band">
        <div className="context-icon"><ToolIcon tool={tool} size={23} /></div>
        <div>
          <strong>{needsDocument ? (document.open ? document.title : 'No Affinity document detected') : tool.displayName}</strong>
          <p>{tool.description}</p>
          {needsSelection && document.selectionNames.length > 0 && <div className="selected-layer-names">{document.selectionNames.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}</div>}
        </div>
        <div className={`save-readiness ${ready ? 'is-ready' : ''}`}>{ready ? 'Ready' : needsSelection ? 'Selection required' : 'Document required'}</div>
      </section>

      <section className="save-section workflow-fields">
        <div className="save-section-heading"><div><h2>{tool.displayName}</h2></div></div>
        <div className="preset-bar">
          <label>Preset<select defaultValue="" onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value); if (preset) setValues(preset.values); }}><option value="">Current settings</option>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
          <label>Save as<input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="My preset" /></label>
          <button type="button" className="secondary-button" disabled={!presetName.trim()} onClick={() => void window.kryeo.savePreset({ kind, name: presetName.trim(), values }).then((next) => { onWorkspace(next); setPresetName(''); })}><Save size={15} />Save preset</button>
        </div>

        {kind === 'export' && <>
          <div className="workflow-grid">
            <label>Project<select value={String(values.project || '')} onChange={(event) => setValue('project', event.target.value)}>{library.projects.map((project) => <option key={project}>{project}</option>)}</select></label>
            <label>PNG export preset<input value={String(values.preset || '')} onChange={(event) => setValue('preset', event.target.value)} /></label>
          </div>
          <div className="save-options-grid">
            <CheckField checked={Boolean(values.latest)} onChange={(value) => setValue('latest', value)} title="Latest versions" description="Export each asset's newest saved version." />
            <CheckField checked={Boolean(values.stable)} onChange={(value) => setValue('stable', value)} title="Stable versions" description="Include versions marked stable by the library." />
          </div>
        </>}

        {kind === 'update' && <>
          <div className="save-options-grid">
            <CheckField checked={Boolean(values.rebuildBase)} onChange={(value) => setValue('rebuildBase', value)} title="Rebuild Base" description="Refresh the clean reusable version from Master." />
            <CheckField checked={Boolean(values.rebuildRaster)} onChange={(value) => setValue('rebuildRaster', value)} title="Rebuild Raster" description="Create a fresh rasterised version from Master." />
            <CheckField checked={Boolean(values.defaultVisibility)} onChange={(value) => setValue('defaultVisibility', value)} title="Restore default visibility" description="Leave Master visible and generated copies hidden." />
          </div>
          <div className="workflow-grid workflow-grid--single"><label>What changed<input value={String(values.changeNote || '')} onChange={(event) => setValue('changeNote', event.target.value)} placeholder="Improved highlights and spacing" /></label></div>
        </>}

        {kind === 'shade' && <>
          <div className="workflow-grid workflow-grid--three">
            <label>Light direction<select value={Number(values.light ?? 0)} onChange={(event) => setValue('light', Number(event.target.value))}><option value={0}>Top left</option><option value={1}>Top right</option><option value={2}>Bottom left</option><option value={3}>Bottom right</option><option value={4}>Center</option></select></label>
            <label>Shading style<select value={Number(values.style ?? 23)} onChange={(event) => setValue('style', Number(event.target.value))}>{SHADE_STYLES.map(([name, index]) => <option value={index} key={index}>{name}</option>)}</select></label>
            <label>Strength<select value={Number(values.strength ?? 1)} onChange={(event) => setValue('strength', Number(event.target.value))}><option value={0}>Subtle</option><option value={1}>Medium</option><option value={2}>Strong</option></select></label>
            <label>Coverage<select value={Number(values.mode ?? 0)} onChange={(event) => setValue('mode', Number(event.target.value))}><option value={0}>Whole form</option><option value={1}>Edges only</option><option value={2}>Whole form + edges</option></select></label>
            <label>Fade tones<select value={Number(values.fadeMode ?? 0)} onChange={(event) => setValue('fadeMode', Number(event.target.value))}><option value={0}>Shadow + highlight</option><option value={1}>Shadow only</option><option value={2}>Highlight only</option></select></label>
            <label>Texture<select value={Number(values.texture ?? 1)} onChange={(event) => setValue('texture', Number(event.target.value))}><option value={0}>Clean</option><option value={1}>Light</option><option value={2}>Chunky</option></select></label>
            <label>Object handling<select value={Number(values.scope ?? 0)} onChange={(event) => setValue('scope', Number(event.target.value))}><option value={0}>Whole selected layer</option><option value={1}>Shade each island</option></select></label>
            <label>Detail size<select value={Number(values.detailScale ?? 1)} onChange={(event) => setValue('detailScale', Number(event.target.value))}><option value={0}>Normal</option><option value={1}>Small details</option></select></label>
            <label>Extra light<select value={Number(values.highlightVariation ?? 1)} onChange={(event) => setValue('highlightVariation', Number(event.target.value))}><option value={0}>Off</option><option value={1}>Light</option><option value={2}>Medium</option><option value={3}>Sparkly</option></select></label>
            <label>Output position<select value={Number(values.placement ?? 0)} onChange={(event) => setValue('placement', Number(event.target.value))}><option value={0}>Same visual position</option><option value={1}>Inside original parent</option></select></label>
          </div>
          <div className="save-options-grid"><CheckField checked={Boolean(values.dither)} onChange={(value) => setValue('dither', value)} title="Pixel dither" description="Use a deliberate pixel pattern between shade levels." /></div>
        </>}
      </section>

      <footer className="save-footer"><div><strong>{tool.displayName}</strong><span>{ready ? 'Affinity will run with these settings.' : 'Resolve the source requirement above.'}</span></div><button className="run-button save-submit" disabled={!ready || running}>{running ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}{running ? 'Running' : `Run ${tool.displayName}`}</button></footer>
    </form>
  );
}

function PlaceAssetPage({ document, library, connected, placing, onPlace }: {
  document: DocumentContext;
  library: AssetLibrarySnapshot;
  connected: boolean;
  placing: boolean;
  onPlace: (request: PlaceAssetRequest) => void;
}) {
  const [assetId, setAssetId] = useState(library.assets[0]?.id || '');
  const [layerKind, setLayerKind] = useState<PlaceAssetRequest['layerKind']>('master');
  const asset = library.assets.find((item) => item.id === assetId) || library.assets[0];
  const ready = connected && document.open && Boolean(document.sessionUuid) && Boolean(asset);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !asset || placing) return;
    onPlace({ path: asset.path, displayName: asset.displayName || asset.name, layerKind, targetSessionUuid: document.sessionUuid });
  };
  return (
    <form className="workflow-page enter-page" onSubmit={submit}>
      <section className="save-context-band">
        <div className="context-icon"><MousePointer2 size={23} /></div>
        <div><strong>{document.open ? document.title : 'No Affinity document detected'}</strong></div>
        <div className={`save-readiness ${ready ? 'is-ready' : ''}`}>{ready ? 'Target ready' : 'Document required'}</div>
      </section>
      <section className="save-section workflow-fields">
        <div className="save-section-heading"><div><h2>Choose asset</h2></div></div>
        <div className="workflow-grid workflow-grid--single"><label>Asset<select value={asset?.id || ''} onChange={(event) => setAssetId(event.target.value)}>{library.assets.map((item) => <option value={item.id} key={item.id}>{item.project} / {item.category} / {item.displayName || item.name} v{item.version}</option>)}</select></label></div>
        <div className="version-choice" role="radiogroup" aria-label="Asset version">
          {(['master', 'base', 'raster'] as const).map((kind) => <button type="button" className={layerKind === kind ? 'is-active' : ''} onClick={() => setLayerKind(kind)} key={kind}><b>{kind[0].toUpperCase() + kind.slice(1)}</b><span>{kind === 'master' ? 'Editable source hierarchy' : kind === 'base' ? 'Clean reusable copy' : 'Flattened pixel version'}</span></button>)}
        </div>
      </section>
      <footer className="save-footer"><div><strong>{asset ? `${asset.displayName || asset.name} - ${layerKind}` : 'No asset selected'}</strong><span>{document.open ? `Destination: ${document.title}` : 'Open the destination document in Affinity.'}</span></div><button className="run-button save-submit" disabled={!ready || placing}>{placing ? <LoaderCircle className="spin" size={16} /> : <MousePointer2 size={16} />}{placing ? 'Placing' : 'Place asset'}</button></footer>
    </form>
  );
}

function SavePage({ document, library, connected, saving, onSave }: {
  document: DocumentContext;
  library: AssetLibrarySnapshot;
  connected: boolean;
  saving: boolean;
  onSave: (request: SaveAssetRequest) => void;
}) {
  const [type, setType] = useState('Frame');
  const [theme, setTheme] = useState('');
  const [variant, setVariant] = useState('');
  const [component, setComponent] = useState('');
  const [state, setState] = useState('');
  const [displayName, setDisplayName] = useState('Frame');
  const [codeName, setCodeName] = useState('frame');
  const [project, setProject] = useState(library.projects[0] || 'Default Project');
  const [category, setCategory] = useState('Frames');
  const [subcategory, setSubcategory] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [batch, setBatch] = useState(false);
  const [update, setUpdate] = useState(true);
  const [baseCopy, setBaseCopy] = useState(true);
  const [rasterCopy, setRasterCopy] = useState(true);

  useEffect(() => {
    const displayParts = [theme, variant, component, type, state].map((part) => part.trim()).filter(Boolean);
    const codeParts = [type, theme, variant, component, state].map(codePart).filter(Boolean);
    setDisplayName(displayParts.join(' ') || 'Asset');
    setCodeName(codeParts.join('_') || 'asset');
    setCategory(categoryForType(type));
  }, [component, state, theme, type, variant]);

  const canSave = connected && document.open && document.selectionCount > 0 && displayName.trim() && codeName.trim() && project.trim();
  const location = [project || 'Default Project', category, subcategory ? `${subcategory} ${category}` : ''].filter(Boolean).join(' / ');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || saving) return;
    onSave({
      displayName: displayName.trim(),
      codeName: codeNameFromDisplayName(codeName),
      project: project.trim(),
      category: category.trim(),
      subcategory: subcategory.trim(),
      tags: tags.trim(),
      notes: notes.trim(),
      batch,
      update,
      baseCopy,
      rasterCopy,
    });
  };

  return (
    <form className="save-workflow enter-page" onSubmit={submit}>
      <section className="save-context-band">
        <div className="context-icon"><Save size={23} /></div>
        <div>
          <strong>{document.selectionCount === 1 ? document.selectionNames[0] || 'Selected layer' : document.open ? document.title : 'No Affinity document detected'}</strong>
          <p>{document.selectionCount > 0 ? `${document.title || 'Affinity document'} - ${document.selectionCount} selected ${document.selectionCount === 1 ? 'layer' : 'layers'}` : 'Select the layer or group you want to save.'}</p>
        </div>
        <div className={`save-readiness ${canSave ? 'is-ready' : ''}`}>{canSave ? 'Ready to save' : document.selectionCount > 0 ? 'Complete required fields' : 'Selection required'}</div>
      </section>

      <section className="save-section">
        <div className="save-section-heading">
          <div><h2>Smart name</h2><p>Describe the asset in plain parts. Kryeo builds both names for you.</p></div>
        </div>
        <div className="smart-name-grid">
          <label>Color theme<input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="Blue" /></label>
          <label>Variant<input value={variant} onChange={(event) => setVariant(event.target.value)} placeholder="Optional" /></label>
          <label>Component<input value={component} onChange={(event) => setComponent(event.target.value)} placeholder="Stat" /></label>
          <label>Type<select value={type} onChange={(event) => setType(event.target.value)}>{ASSET_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>State<select value={state} onChange={(event) => setState(event.target.value)}>{ASSET_STATES.map((item) => <option key={item} value={item}>{item || 'None'}</option>)}</select></label>
        </div>
        <div className="generated-names">
          <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>Code name<input value={codeName} onChange={(event) => setCodeName(event.target.value)} spellCheck={false} /></label>
        </div>
      </section>

      <section className="save-section">
        <div className="save-section-heading">
          <div><h2>Library location</h2><p>Type fills Category automatically. Subcategory is always your choice.</p></div>
        </div>
        <div className="location-grid">
          <label>Project<input list="kryeo-projects" value={project} onChange={(event) => setProject(event.target.value)} /></label>
          <datalist id="kryeo-projects">{library.projects.map((item) => <option value={item} key={item} />)}</datalist>
          <label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label>Subcategory<input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} placeholder="Optional folder" /></label>
        </div>
        <div className="save-path-preview"><FolderOpen size={15} /><span>{location}</span></div>
      </section>

      <section className="save-section">
        <div className="save-section-heading">
          <div><h2>Output</h2></div>
        </div>
        <div className="save-options-grid">
          <label className="save-option"><input type="checkbox" checked={update} onChange={(event) => setUpdate(event.target.checked)} /><span><b>Version safely</b><small>Create the next version instead of overwriting.</small></span></label>
          <label className="save-option"><input type="checkbox" checked={baseCopy} onChange={(event) => setBaseCopy(event.target.checked)} /><span><b>Create Base</b><small>Keep a copy without risky live adjustments.</small></span></label>
          <label className="save-option"><input type="checkbox" checked={rasterCopy} onChange={(event) => setRasterCopy(event.target.checked)} /><span><b>Create Raster</b><small>Required by the current export workflow.</small></span></label>
          <label className={`save-option ${document.selectionCount < 2 ? 'is-disabled' : ''}`}><input type="checkbox" checked={batch} disabled={document.selectionCount < 2} onChange={(event) => setBatch(event.target.checked)} /><span><b>Save separately</b><small>Make one asset for each selected root layer.</small></span></label>
        </div>
        <div className="metadata-grid">
          <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="inventory, ornate, blue" /></label>
          <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context for future you" /></label>
        </div>
      </section>

      <footer className="save-footer">
        <div><strong>{displayName || 'Unnamed asset'}</strong><span>{codeName || 'asset'}</span></div>
        <button className="run-button save-submit" type="submit" disabled={!canSave || saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
          {saving ? 'Saving in Affinity' : `Save ${document.selectionCount === 1 ? 'selected layer' : 'selection'}`}
        </button>
      </footer>
    </form>
  );
}

function codeNameFromDisplayName(value: string): string {
  return codePart(value) || 'asset';
}

function AssistantPage({ document, projects, workspace, onWorkspace, onNavigate }: {
  document: DocumentContext;
  projects: string[];
  workspace: WorkspaceSnapshot;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
  onNavigate: (page: Page) => void;
}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [hostedStatus, setHostedStatus] = useState<HostedAiStatus | null>(null);
  const [project, setProject] = useState(document.title || projects[0] || 'General');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [useVision, setUseVision] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<AssistantAction[]>([]);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const creatingForProject = useRef('');
  const sessions = workspace.assistantSessions
    .filter((session) => session.project === project && (showArchived || !session.archived))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
  const activeSession = workspace.assistantSessions.find((session) => session.id === activeSessionId && session.project === project);
  const messages = workspace.assistantMessages.filter((message) => message.sessionId === activeSessionId);
  const memories = workspace.assistantMemories.filter((memory) => memory.scope === 'global' || memory.project === project);

  useEffect(() => {
    void window.kryeo.getAssistantStatus().then(setStatus).catch(() => undefined);
    void window.kryeo.getHostedAiStatus().then(setHostedStatus).catch(() => undefined);
  }, []);
  useEffect(() => { conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length]);
  useEffect(() => {
    const available = workspace.assistantSessions.filter((session) => session.project === project && !session.archived);
    if (available.some((session) => session.id === activeSessionId)) return;
    if (available[0]) {
      setActiveSessionId(available.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt))[0].id);
      return;
    }
    if (creatingForProject.current === project) return;
    creatingForProject.current = project;
    void window.kryeo.createAssistantSession(project).then((next) => {
      const created = next.assistantSessions.filter((session) => session.project === project).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (created) setActiveSessionId(created.id);
      onWorkspace(next);
      creatingForProject.current = '';
    }).catch(() => { creatingForProject.current = ''; });
  }, [activeSessionId, onWorkspace, project, workspace.assistantSessions]);

  const install = async (modelPack: 'portable' | 'balanced' = 'portable') => {
    setInstalling(true);
    setError('');
    const poll = window.setInterval(() => { void window.kryeo.getAssistantStatus().then(setStatus).catch(() => undefined); }, 500);
    try { setStatus(await window.kryeo.installAssistant(modelPack)); }
    catch (installError) { setError(installError instanceof Error ? installError.message : String(installError)); }
    finally { window.clearInterval(poll); setInstalling(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !activeSessionId) return;
    setBusy(true);
    setError('');
    setDraft('');
    try {
      const response = await window.kryeo.chatWithAssistant({ project, sessionId: activeSessionId, message, document, useVision });
      onWorkspace(response.workspace);
      setActions(response.actions);
      const [nextLocal, nextHosted] = await Promise.all([
        window.kryeo.getAssistantStatus(),
        window.kryeo.getHostedAiStatus(),
      ]);
      setStatus(nextLocal);
      setHostedStatus(nextHosted);
    } catch (chatError) {
      setDraft(message);
      setError(chatError instanceof Error ? chatError.message : String(chatError));
    } finally { setBusy(false); }
  };

  const newSession = async () => {
    const next = await window.kryeo.createAssistantSession(project);
    const created = next.assistantSessions.filter((session) => session.project === project).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (created) setActiveSessionId(created.id);
    setActions([]);
    onWorkspace(next);
  };

  const updateSession = async (id: string, changes: { title?: string; pinned?: boolean; archived?: boolean }) => {
    onWorkspace(await window.kryeo.updateAssistantSession({ id, ...changes }));
  };

  const commitRename = async (id: string) => {
    if (renameDraft.trim()) await updateSession(id, { title: renameDraft });
    setRenamingId('');
  };

  const removeSession = async (id: string) => {
    if (!window.confirm('Delete this conversation and its messages? This cannot be undone.')) return;
    const next = await window.kryeo.deleteAssistantSession(id);
    setActiveSessionId('');
    onWorkspace(next);
  };

  const runAction = (action: AssistantAction) => {
    if (action.type === 'open-component-scan') onNavigate('import');
    if (action.type === 'review-assets') onNavigate('assets');
    if (action.type === 'open-workflows') onNavigate('tools');
  };

  return (
    <div className="assistant-page">
      <header className="assistant-context-bar">
        <div className="assistant-context-icon"><BrainCircuit size={25} /></div>
        <div><h2>{document.open ? document.title : 'No active Affinity document'}</h2></div>
        <button className={`assistant-vision-control${useVision && document.open ? ' is-active' : ''}`} disabled={!document.open} onClick={() => setUseVision((current) => !current)} title="Include or exclude a rendered preview of the active Affinity context"><ScanSearch size={16} />{document.open ? (useVision ? (document.selectionCount > 0 ? 'Selection included' : 'Document included') : 'Text context only') : 'No document'}</button>
        <label>Project<select value={project} onChange={(event) => { setProject(event.target.value); setActiveSessionId(''); setActions([]); }}><option>General</option>{projects.map((item) => <option key={item}>{item}</option>)}</select></label>
      </header>

      {!hostedStatus?.available && !status?.installed ? (
        <section className="assistant-install animated-dash-box">
          <BrainCircuit size={38} />
          <h2>Kryeo AI is offline</h2>
          <p>Install an offline assistant from Settings when you want private local help.</p>
          <div className="delivery-buttons">
            <button className="run-button" disabled={installing} onClick={() => void install('portable')}>{installing ? <LoaderCircle className="spin" size={17} /> : <HardDrive size={17} />}{installing ? 'Downloading intelligence pack' : 'Install Portable'}</button>
            {(status?.memoryGB || 0) >= 12 && <button className="secondary-button" disabled={installing} onClick={() => void install('balanced')}><BrainCircuit size={17} />Install Balanced</button>}
          </div>
          {installing && <div className="assistant-install-progress"><div><i style={{ width: `${status?.progress || 2}%` }} /></div><span>{status?.stage || 'Preparing local model'}</span></div>}
          <small>Portable uses LFM2.5-VL 450M. Balanced uses the more capable 1.6B model on systems with at least 12 GB memory. Both run locally; internet is required once.</small>
        </section>
      ) : (
        <div className="assistant-workspace">
          <aside className="assistant-sessions">
            <div className="assistant-sessions-head"><div><strong>Conversations</strong></div><button title="New conversation" onClick={() => void newSession()}><Plus size={17} /></button></div>
            <div className="assistant-session-list">
              {sessions.map((session) => <article className={`assistant-session${session.id === activeSessionId ? ' is-active' : ''}`} key={session.id} onClick={() => { setActiveSessionId(session.id); setActions([]); }}>
                <div>
                  {renamingId === session.id
                    ? <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onBlur={() => void commitRename(session.id)} onKeyDown={(event) => { if (event.key === 'Enter') void commitRename(session.id); if (event.key === 'Escape') setRenamingId(''); }} onClick={(event) => event.stopPropagation()} />
                    : <button className="assistant-session-title" title="Double-click to rename" onDoubleClick={(event) => { event.stopPropagation(); setRenamingId(session.id); setRenameDraft(session.title); }}>{session.pinned && <Pin size={11} />}{session.title}</button>}
                  <time>{relativeDate(session.updatedAt)}</time>
                </div>
                <nav>
                  <button title={session.pinned ? 'Unpin conversation' : 'Pin conversation'} onClick={(event) => { event.stopPropagation(); void updateSession(session.id, { pinned: !session.pinned }); }}><Pin size={13} /></button>
                  <button title={session.archived ? 'Restore conversation' : 'Archive conversation'} onClick={(event) => { event.stopPropagation(); void updateSession(session.id, { archived: !session.archived }); }}><Archive size={13} /></button>
                  <button title="Delete conversation" onClick={(event) => { event.stopPropagation(); void removeSession(session.id); }}><Trash2 size={13} /></button>
                </nav>
              </article>)}
              {sessions.length === 0 && <div className="assistant-session-empty">No {showArchived ? 'archived ' : ''}conversations.</div>}
            </div>
            <div className="assistant-session-tools">
              <button className={showArchived ? 'is-active' : ''} onClick={() => setShowArchived((current) => !current)}><Archive size={14} />{showArchived ? 'Hide archived' : 'Show archived'}</button>
              <button disabled={!activeSession} onClick={() => activeSession && void window.kryeo.exportAssistantSession(activeSession.id)}><Download size={14} />Export</button>
              <button onClick={() => void window.kryeo.importAssistantSession(project).then(onWorkspace)}><Upload size={14} />Import</button>
            </div>
          </aside>

          <div className="assistant-layout">
          <section className="assistant-conversation">
            <div className="assistant-conversation-head"><div><span>{hostedStatus?.available ? hostedModelLabel(hostedStatus.model) : status?.model || 'Kryeo AI'}</span><h2>{activeSession?.title || 'New conversation'}</h2></div><b><i />{hostedStatus?.available ? 'Connected' : 'Local fallback'}</b></div>
            <div className="assistant-messages">
              {messages.length === 0 && <div className="assistant-welcome"><MessageSquare size={28} /><h3>Talk through the project</h3><p>Say hello, ask about the active document, teach Kryeo a rule, or plan the next production step.</p><div><button onClick={() => setDraft('Hi, what can you help me with?')}>Meet Kryeo</button><button onClick={() => setDraft('Organize the active document into reusable UI components.')}>Plan document organization</button></div></div>}
              {messages.map((message) => <article className={`assistant-message is-${message.role}`} key={message.id}><span>{message.role === 'user' ? 'You' : 'Kryeo'}{message.visionUsed && <ScanSearch size={12} aria-label="Active document inspected" />}</span><p>{message.text}</p></article>)}
              {busy && <article className="assistant-message is-assistant is-thinking"><span>Kryeo</span><p><LoaderCircle className="spin" size={16} />{useVision && document.open ? 'Inspecting the active document...' : 'Reading project context...'}</p></article>}
              <div ref={conversationEnd} />
            </div>
            {actions.length > 0 && <div className="assistant-actions">{actions.map((action) => <button key={action.id} onClick={() => runAction(action)}><div><b>{action.label}</b><small>{action.description}</small></div><ArrowRight size={17} /></button>)}</div>}
            {error && <div className="inline-notice inline-notice--error"><CircleAlert size={17} /><div><b>Assistant stopped</b><span>{error}</span></div></div>}
            <form className="assistant-composer" onSubmit={(event) => void submit(event)}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Message Kryeo about this project..." aria-label="Message Kryeo" title="Press Enter to send. Use Shift+Enter for a new line." rows={3} maxLength={1200} /><button className="run-button" disabled={busy || !draft.trim() || !activeSessionId} type="submit"><Send size={17} />Send</button></form>
          </section>

          <aside className="assistant-memory">
            <div><span>Project memory</span><strong>{memories.length}</strong></div>
            {memories.length === 0 ? <div className="assistant-memory-empty">No project instructions yet.</div> : memories.map((memory) => <article key={memory.id}>
              <span>{memory.scope === 'global' ? 'Global' : memory.kind}</span><p>{memory.text}</p>
              <nav><button title={memory.scope === 'global' ? 'Keep this rule in the current project' : 'Use this rule in every project'} onClick={() => void window.kryeo.setAssistantMemoryScope(memory.id, memory.scope === 'global' ? 'project' : 'global', project).then(onWorkspace)}>{memory.scope === 'global' ? <Layers3 size={13} /> : <Pin size={13} />}</button><button title="Forget instruction" onClick={() => void window.kryeo.forgetAssistantMemory(memory.id).then(onWorkspace)}><Trash2 size={14} /></button></nav>
            </article>)}
          </aside>
          </div>
        </div>
      )}
    </div>
  );
}

function hierarchySelection(components: ComponentScanResult['components']): Set<string> {
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  const included = new Set<string>();
  const visit = (component: ComponentScanResult['components'][number], includeSelf: boolean) => {
    if (includeSelf && !component.keptInsideParent && component.exportTarget !== false) included.add(component.id);
    if (component.diveMode === 'keep-together') return;
    if (component.diveMode === 'children-only') included.delete(component.id);
    for (const childKey of component.childHierarchyKeys) {
      const child = byKey.get(childKey);
      if (child) visit(child, true);
    }
  };
  for (const component of components) {
    if (!component.parentHierarchyKey || !byKey.has(component.parentHierarchyKey)) visit(component, true);
  }
  return included;
}

function componentOverallName(component: ComponentScanResult['components'][number]): string {
  return component.exportName?.trim() || component.familyName || component.layerLabel?.trim() || '';
}

// Compatibility helpers for list, hierarchy, and save code. Both resolve to
// the single canonical asset name; they no longer represent independent labels.
function componentLayerLabel(component: ComponentScanResult['components'][number]): string {
  return componentOverallName(component);
}

function componentExportName(component: ComponentScanResult['components'][number]): string {
  return componentOverallName(component);
}

function isStructuralContextOnly(component: ComponentScanResult['components'][number]): boolean {
  return ['duplicate-representation', 'organizational-parent'].includes(component.assetBoundary || '');
}

function isConstructionContext(component: ComponentScanResult['components'][number]): boolean {
  return component.assetBoundary === 'construction-child';
}

function needsCompleteSemanticDecision(component: ComponentScanResult['components'][number]): boolean {
  if (isStructuralContextOnly(component)) return false;
  return component.assetType === 'Unknown'
    || component.role === 'Unknown'
    || component.analysisState === 'provisional'
    || component.analysisState === 'queued';
}

function initialComponentExpansion(components: ComponentScanResult['components']): Set<string> {
  if (components.length > 120) return new Set();
  return new Set(components
    .filter((component) => component.childHierarchyKeys.length > 0)
    .map((component) => component.hierarchyKey));
}

function reviewPriority(component: ComponentScanResult['components'][number]): 'ready' | 'check' {
  const exportsAsset = component.exportTarget !== false;
  if (needsCompleteSemanticDecision(component)) return 'check';
  if (!exportsAsset && (isConstructionContext(component) || isStructuralContextOnly(component))) return 'ready';
  if (exportsAsset && component.semanticConflict) return 'check';
  if (component.diveConflict) return 'check';
  if (component.reviewPriority) return component.reviewPriority === 'ready' ? 'ready' : 'check';
  if (component.analysisState === 'needs-review') return 'check';
  return component.analysisState === 'approved' || component.analysisState === 'analyzed' ? 'ready' : 'check';
}

function componentReviewKey(component: ComponentScanResult['components'][number]): string {
  return component.familyFingerprint || `hierarchy:${component.hierarchyKey}`;
}

function ComponentScanPage({ document, connected, onWorkspace, developerMode }: {
  document: DocumentContext;
  connected: boolean;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
  developerMode: boolean;
}) {
  const [scan, setScan] = useState<ComponentScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ComponentScanProgress | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState(0);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [scanScope, setScanScope] = useState<ComponentScanScope>('document');
  const [scanMode, setScanMode] = useState<ComponentScanMode>('smart');
  const [ungroupedLayers, setUngroupedLayers] = useState('ask');
  const [repeatedChildren, setRepeatedChildren] = useState('ask');
  const [documentPurpose, setDocumentPurpose] = useState('mixed');
  const [intentCustomized, setIntentCustomized] = useState(false);
  const [showScanOptions, setShowScanOptions] = useState(false);
  const [localAi, setLocalAi] = useState<LocalAiStatus | null>(null);
  const [hostedAi, setHostedAi] = useState<HostedAiStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [evidenceLoading, setEvidenceLoading] = useState<Set<string>>(new Set());
  const [reviewFilter, setReviewFilter] = useState<'all' | 'ui' | 'construction' | 'background'>('all');
  const [reviewLane, setReviewLane] = useState<'check' | 'structure' | 'ready' | 'all'>('all');
  const [reviewQuery, setReviewQuery] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [watchSelection, setWatchSelection] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [developerTrace, setDeveloperTrace] = useState<Array<NonNullable<ComponentScanProgress['trace']>>>([]);
  const activeModelRequests = hostedAi?.modelActive ?? (hostedAi?.queueDepth ? 1 : 0);
  const queuedModelRequests = hostedAi?.modelQueued ?? Math.max(0, (hostedAi?.queueDepth || 0) - activeModelRequests);
  const hostedReviewer = hostedModelLabel(hostedAi?.model);

  const runScan = async (scope: ComponentScanScope = scanScope) => {
    if (!connected || scanning) return;
    setScanScope(scope);
    setScanning(true);
    setScanStartedAt(Date.now());
    setScanElapsed(0);
    setEvidenceLoading(new Set());
    setDeveloperTrace([]);
    setSelectedReviewId('');
    setReviewLane('all');
    setScanProgress({
      phase: 'preparing',
      label: 'Preparing scan',
      detail: `Starting a ${scope} scan in Affinity.`,
      progress: 2,
    });
    setError('');
    setMessage('');
    try {
      const intent = {
        mode: scanMode,
        answers: [
          ...(ungroupedLayers === 'ask' ? [] : [{ id: 'ungrouped-layers' as const, value: ungroupedLayers }]),
          ...(repeatedChildren === 'ask' ? [] : [{ id: 'repeated-children' as const, value: repeatedChildren }]),
          { id: 'document-purpose' as const, value: documentPurpose },
        ],
      };
      const result = await window.kryeo.scanComponents({ ...(intentCustomized ? { scope, intent } : { scope }), developerMode });
      setScan(result);
      const exportTargets = hierarchySelection(result.components);
      setIncluded(exportTargets);
      setExpanded(initialComponentExpansion(result.components));
      if (result.scanIntent) {
        setScanMode(result.scanIntent.mode);
        onWorkspace(await window.kryeo.saveScanIntentProfile({
          project: result.sourceName || result.documentTitle,
          documentTitle: result.documentTitle,
          structureFingerprint: result.scanIntent.structureFingerprint,
          mode: result.scanIntent.mode,
          answers: result.scanIntent.answers,
        }));
        if (scope === 'document') {
          try {
            onWorkspace(await window.kryeo.saveComponentReview({
              project: result.sourceName || result.documentTitle,
              documentTitle: result.documentTitle,
              documentSessionUuid: result.documentSessionUuid,
              components: result.components,
              includedIds: [...exportTargets],
              scanIntent: result.scanIntent,
              decisionStatus: 'generated',
            }));
            const incomplete = result.components.filter((component) => (
              component.analysisState === 'provisional'
              || component.analysisState === 'queued'
              || component.assetType === 'Unknown'
            )).length;
            setMessage(incomplete
              ? `Scan saved, but ${incomplete} ${incomplete === 1 ? 'family needs' : 'families need'} a complete cloud decision. Rescan before building.`
              : 'AI decisions cached. Kryeo is ready to build the asset library.');
          } catch (cacheError) {
            setError(`The scan finished, but AI decisions could not be cached: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
          }
        }
      }
    } catch (scanError) {
      setScan(null);
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => window.kryeo.onComponentScanProgress((progress) => {
    if (progress.trace) {
      setDeveloperTrace((entries) => [...entries, progress.trace!].slice(-500));
      return;
    }
    setScanProgress(progress);
    if (!progress.partialResult) return;
    setScan(progress.partialResult);
    setIncluded(hierarchySelection(progress.partialResult.components));
    setExpanded(initialComponentExpansion(progress.partialResult.components));
  }), []);

  useEffect(() => {
    if (!scanning || !scanStartedAt) return;
    const updateElapsed = () => setScanElapsed(Math.max(0, Math.floor((Date.now() - scanStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [scanStartedAt, scanning]);

  useEffect(() => {
    if (!connected) {
      setLocalAi(null);
      setHostedAi(null);
      return;
    }
    void window.kryeo.getLocalAiStatus().then(setLocalAi).catch(() => setLocalAi(null));
    const refreshHostedStatus = () => void window.kryeo.getHostedAiStatus().then(setHostedAi).catch(() => setHostedAi(null));
    refreshHostedStatus();
    const timer = window.setInterval(refreshHostedStatus, scanning ? 2000 : 10000);
    return () => window.clearInterval(timer);
  }, [connected, scanning]);

  useEffect(() => {
    if (!watchSelection || !connected || !document.open || document.selectionCount === 0 || scanning) return;
    const timer = window.setTimeout(() => void runScan('selection'), 700);
    return () => window.clearTimeout(timer);
  }, [connected, document.open, document.selectionCount, document.selectionNames.join('|'), watchSelection]);

  const updateFamily = (reviewedComponent: ComponentScanResult['components'][number], patch: Partial<Pick<ComponentScanResult['components'][number], 'role' | 'assetType' | 'familyName' | 'layerLabel' | 'exportName'>>) => {
    setScan((current) => current ? {
      ...current,
      components: (() => {
        const target = current.components.find((component) => component.id === reviewedComponent.id);
        return current.components.map((component) => {
          const sameFamily = target?.familyFingerprint
            ? component.familyFingerprint === target.familyFingerprint
            : component.id === reviewedComponent.id;
          return sameFamily ? { ...component, ...patch } : component;
        });
      })(),
    } : current);
    setMessage('');
  };

  const updateDiveMode = (component: ComponentScanResult['components'][number], diveMode: ComponentDiveMode) => {
    setScan((current) => {
      if (!current) return current;
      const reviewKey = componentReviewKey(component);
      const updated = current.components.map((candidate) => componentReviewKey(candidate) === reviewKey ? {
        ...candidate,
        diveMode,
        structuralDiveMode: diveMode,
        diveRemembered: true,
        diveConflict: false,
        diveConflictMessage: undefined,
      } : candidate);
      const selection = hierarchySelection(updated);
      const components = updated.map((candidate) => ({ ...candidate, exportTarget: selection.has(candidate.id) }));
      setIncluded(selection);
      return { ...current, components };
    });
    setMessage('');
  };

  const setComponentExportTarget = (componentId: string, exportTarget: boolean) => {
    setIncluded((current) => {
      const next = new Set(current);
      if (exportTarget) next.add(componentId); else next.delete(componentId);
      return next;
    });
    setScan((current) => current ? {
      ...current,
      components: current.components.map((component) => component.id === componentId ? { ...component, exportTarget } : component),
    } : current);
    setMessage('');
  };

  const loadFamilyEvidence = async (component: ComponentScanResult['components'][number]) => {
    if (!scan || !hostedAi?.available) return;
    const familyKey = component.familyFingerprint || component.visualHash;
    if (evidenceLoading.has(familyKey) || Object.values(component.aiEvidence || {}).some((score) => Number(score) > 0)) return;
    setEvidenceLoading((current) => new Set(current).add(familyKey));
    try {
      const parent = scan.components.find((candidate) => candidate.hierarchyKey === component.parentHierarchyKey);
      const childNames = component.childHierarchyKeys
        .map((key) => scan.components.find((candidate) => candidate.hierarchyKey === key)?.name || '')
        .filter(Boolean);
      const siblingNames = parent
        ? parent.childHierarchyKeys
          .filter((key) => key !== component.hierarchyKey)
          .map((key) => scan.components.find((candidate) => candidate.hierarchyKey === key)?.name || '')
          .filter(Boolean)
        : [];
      const evidence = await window.kryeo.explainComponentFamily({
        familyFingerprint: component.familyFingerprint,
        visualHash: component.visualHash,
        familyName: componentOverallName(component),
        assetType: component.assetType,
        role: component.role,
        sourceName: component.name,
        affinityType: component.affinityType,
        bounds: component.bounds,
        previewUrl: component.previewUrl,
        visualMetrics: component.visualMetrics,
        parentName: parent?.name,
        childNames,
        siblingNames,
      });
      setScan((current) => current ? {
        ...current,
        components: current.components.map((candidate) => {
          const sameFamily = candidate.familyFingerprint
            ? candidate.familyFingerprint === component.familyFingerprint
            : candidate.visualHash === component.visualHash;
          const hasCompleteReplacement = evidence.supportsClassification === false
            && Boolean(evidence.suggestedName)
            && Boolean(evidence.suggestedType)
            && Boolean(evidence.suggestedRole);
          return sameFamily ? {
            ...candidate,
            ...(hasCompleteReplacement ? {
              familyName: evidence.suggestedName!,
              layerLabel: evidence.suggestedName!,
              exportName: evidence.suggestedName!,
              codeName: evidence.suggestedName!.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
              assetType: evidence.suggestedType!,
              role: evidence.suggestedRole!,
              aiSuggestedName: evidence.suggestedName!,
              aiSuggestedType: evidence.suggestedType!,
              aiSuggestedRole: evidence.suggestedRole!,
              analysisState: 'analyzed' as const,
            } : {}),
            aiConfidence: evidence.confidence,
            aiEvidence: evidence.evidence,
            aiReason: evidence.reason,
            analysisReason: evidence.reason,
            analysisAlternatives: evidence.alternatives,
            aiEvidenceSupportsClassification: evidence.supportsClassification,
            aiEvidenceSuggestedName: evidence.suggestedName,
            aiEvidenceSuggestedType: evidence.suggestedType,
            aiEvidenceSuggestedRole: evidence.suggestedRole,
            semanticConflict: Boolean(candidate.semanticConflict || evidence.conflict),
            semanticConflictMessage: evidence.conflictMessage || candidate.semanticConflictMessage,
            analysisState: hasCompleteReplacement ? 'analyzed' : (evidence.conflict || evidence.confidence < 0.72 ? 'needs-review' : candidate.analysisState),
          } : candidate;
        }),
      } : current);
    } catch (evidenceError) {
      setError(evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
    } finally {
      setEvidenceLoading((current) => {
        const next = new Set(current);
        next.delete(familyKey);
        return next;
      });
    }
  };

  const rememberChoices = async () => {
    if (!scan || saving) return;
    setSaving(true);
    setError('');
    try {
      const corrected = scan.components.some((component) => (
        (component.aiSuggestedName && componentOverallName(component).trim().toLowerCase() !== component.aiSuggestedName.trim().toLowerCase())
        || (component.aiSuggestedType && component.assetType !== component.aiSuggestedType)
        || (component.aiSuggestedRole && component.role !== component.aiSuggestedRole)
      ));
      onWorkspace(await window.kryeo.saveComponentReview({
        project: scan.sourceName || scan.documentTitle,
        documentTitle: scan.documentTitle,
        documentSessionUuid: scan.documentSessionUuid,
        components: scan.components,
        includedIds: [...included],
        scanIntent: scan.scanIntent,
        decisionStatus: corrected ? 'corrected' : 'accepted',
      }));
      setScan({ ...scan, components: scan.components.map((component) => ({ ...component, remembered: true })) });
      const families = new Set(scan.components.map((component) => component.familyFingerprint || component.visualHash)).size;
      setMessage(`Learned ${families} visual ${families === 1 ? 'family' : 'families'} and saved the production hierarchy.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const applyOrganization = async () => {
    if (!scan || applying || scanScope !== 'document') return;
    const components = scan.components.filter((component) => included.has(component.id));
    if (components.length === 0) {
      setError('Include at least one proposed component before applying organization.');
      return;
    }
    setApplying(true);
    setError('');
    try {
      const result = await window.kryeo.applyComponentOrganization({
        documentSessionUuid: scan.documentSessionUuid,
        components: components.map((component) => ({
          name: componentExportName(component),
          memberPaths: component.members.map((member) => member.path),
        })),
      });
      if (!result.ok) throw new Error(result.output);
      setScan(null);
      setIncluded(new Set());
      setMessage(result.output);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setApplying(false);
    }
  };

  const applyNames = async () => {
    if (!scan || applying || scanScope !== 'document') return;
    const byPath = new Map<string, { name: string; path: number[] }>();
    for (const component of [...scan.components].sort((left, right) => right.hierarchyDepth - left.hierarchyDepth)) {
      if (!component.members.length) continue;
      component.members.forEach((member, index) => {
        const name = component.members.length === 1
          ? componentLayerLabel(component)
          : `${componentLayerLabel(component)} Part ${index + 1}`;
        const key = member.path.join('.');
        if (!byPath.has(key) && name !== member.name) byPath.set(key, { name, path: member.path });
      });
    }
    const layers = [...byPath.values()];
    if (!layers.length) {
      setMessage('The document already uses the generated layer labels.');
      return;
    }
    setApplying(true);
    setError('');
    try {
      const result = await window.kryeo.applyLayerNames({ documentSessionUuid: scan.documentSessionUuid, layers });
      if (!result.ok) throw new Error(result.output);
      setMessage(result.output);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setApplying(false);
    }
  };

  const canScanDocument = connected && document.open && !scanning;
  const canScanSelection = canScanDocument && document.selectionCount > 0;
  const cancelScan = async () => {
    if (!scanning) return;
    await window.kryeo.cancelComponentScan();
    setScanning(false);
    setError('Component scan cancelled. Partial local and cloud results remain available to inspect.');
  };

  const createAssets = async () => {
    if (!scan || exporting || scanScope !== 'document' || !scan.scanIntent) return;
    if (!included.size) return;
    const unresolved = scan.components.filter((component) => component.analysisState === 'provisional' || component.analysisState === 'queued' || component.assetType === 'Unknown');
    if (unresolved.length) {
      setError(`Kryeo cannot build this library yet: ${unresolved.length} ${unresolved.length === 1 ? 'family has' : 'families have'} no complete cloud decision. Rescan the document first.`);
      return;
    }
    const layers = [...scan.components]
      .sort((left, right) => right.hierarchyDepth - left.hierarchyDepth)
      .flatMap((component) => component.members.map((member, index) => ({
        name: component.members.length === 1
          ? componentLayerLabel(component)
          : `${componentLayerLabel(component)} Part ${index + 1}`,
        path: member.path,
      })))
      .filter((layer, index, all) => all.findIndex((candidate) => candidate.path.join('.') === layer.path.join('.')) === index);
    setExporting(true);
    setApplying(true);
    setError('');
    try {
      onWorkspace(await window.kryeo.saveComponentReview({
        project: scan.sourceName || scan.documentTitle,
        documentTitle: scan.documentTitle,
        documentSessionUuid: scan.documentSessionUuid,
        components: scan.components,
        includedIds: [...included],
        scanIntent: scan.scanIntent,
        decisionStatus: 'generated',
      }));
      if (layers.length) {
        const naming = await window.kryeo.applyLayerNames({ documentSessionUuid: scan.documentSessionUuid, layers });
        if (!naming.ok) throw new Error(naming.output);
      }
      const result = await window.kryeo.createComponentAssets({
        project: scan.sourceName || scan.documentTitle,
        documentTitle: scan.documentTitle,
        documentSessionUuid: scan.documentSessionUuid,
        components: scan.components,
        includedIds: [...included],
        scanIntent: scan.scanIntent,
        structureFingerprint: scan.scanIntent.structureFingerprint,
      });
      if (!result.ok) throw new Error(result.output);
      setMessage(`AI applied the layer names and built the asset library. ${result.output}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExporting(false);
      setApplying(false);
    }
  };
  const componentLocation = (component: ComponentScanResult['components'][number]): string => {
    const irregular: Partial<Record<ComponentAssetType, string>> = {
      Text: 'Text',
      FX: 'FX',
      ScrollBar: 'ScrollBars',
      TextBox: 'TextBoxes',
    };
    const category = irregular[component.assetType]
      || (component.assetType === 'Unknown' ? 'Uncategorised' : `${component.assetType}s`);
    const parent = scan?.components.find((candidate) => candidate.hierarchyKey === component.parentHierarchyKey);
    const subcategory = parent && parent.diveMode !== 'keep-together' ? componentExportName(parent) : '';
    return [category, subcategory].filter(Boolean).join(' / ');
  };
  const componentContextLabel = (component: ComponentScanResult['components'][number]): string => {
    if (component.namingReason) return component.namingReason;
    const parent = scan?.components.find((candidate) => candidate.hierarchyKey === component.parentHierarchyKey);
    if (parent) return `Parent: ${componentLayerLabel(parent)} / ${componentLocation(component)}`;
    const source = component.nameSource === 'both'
      ? 'Visual and layer name agree'
      : component.nameSource === 'layer-name'
        ? 'Based on the current layer name'
        : component.nameSource === 'memory'
          ? 'Learned from a correction'
          : 'Based on visual analysis';
    return `${source} / Export category: ${componentLocation(component)}`;
  };
  const reviewRows = useMemo(() => {
    if (!scan) return [];
    const seenExact = new Set<string>();
    return scan.components.filter((component) => {
      if (component.duplicateKind !== 'exact') return true;
      const key = componentReviewKey(component);
      if (seenExact.has(key)) return false;
      seenExact.add(key);
      return true;
    });
  }, [scan]);
  const reviewStats = useMemo(() => {
    const checks = reviewRows.filter((component) => reviewPriority(component) === 'check');
    return {
      automated: checks.length,
      check: checks.length,
      structure: reviewRows.filter((component) => component.childHierarchyKeys.length > 0).length,
      ready: reviewRows.filter((component) => reviewPriority(component) === 'ready').length,
      all: reviewRows.length,
    };
  }, [reviewRows]);
  const unresolvedComponentCount = useMemo(() => (
    reviewRows.filter(needsCompleteSemanticDecision).length
  ), [reviewRows]);
  const scanStep: 1 | 2 | 3 = !scan ? 1 : 3;
  const visibleComponents = useMemo(() => {
    if (!scan) return [];
    const normalizedQuery = reviewQuery.trim().toLocaleLowerCase();
    const byParent = new Map<string, ComponentScanResult['components']>();
    const byKey = new Map(scan.components.map((component) => [component.hierarchyKey, component]));
    for (const component of scan.components) {
      const parentKey = byKey.has(component.parentHierarchyKey) ? component.parentHierarchyKey : '';
      const siblings = byParent.get(parentKey) || [];
      siblings.push(component);
      byParent.set(parentKey, siblings);
    }
    const ordered: ComponentScanResult['components'] = [];
    const visit = (parentKey: string) => {
      for (const component of byParent.get(parentKey) || []) {
        ordered.push(component);
        if (reviewLane !== 'all' || reviewFilter !== 'all' || normalizedQuery || expanded.has(component.hierarchyKey)) visit(component.hierarchyKey);
      }
    };
    visit('');
    const seenExact = new Set<string>();
    return ordered.filter((component) => {
      if (reviewFilter !== 'all' && (component.reviewCategory || 'ui') !== reviewFilter) return false;
      if (normalizedQuery && ![
        component.name,
        component.familyName,
        componentLayerLabel(component),
        componentExportName(component),
        component.assetType,
        component.role,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))) return false;
      const priority = reviewPriority(component);
      if (reviewLane === 'check' && priority !== 'check') return false;
      if (reviewLane === 'structure' && component.childHierarchyKeys.length === 0) return false;
      if (reviewLane === 'ready' && priority !== 'ready') return false;
      if (component.duplicateKind !== 'exact') return true;
      const key = componentReviewKey(component);
      if (seenExact.has(key)) return false;
      seenExact.add(key);
      return true;
    });
  }, [expanded, reviewFilter, reviewLane, reviewQuery, scan]);

  const selectedComponent = visibleComponents.find((component) => component.id === selectedReviewId) || visibleComponents[0];
  const selectedIndex = selectedComponent ? visibleComponents.findIndex((component) => component.id === selectedComponent.id) : -1;
  const selectedPriority = selectedComponent ? reviewPriority(selectedComponent) : 'ready';
  const selectedStructuralContextOnly = selectedComponent ? isStructuralContextOnly(selectedComponent) : false;
  const selectedConstructionContext = selectedComponent ? isConstructionContext(selectedComponent) : false;
  const selectedFamilyEvidenceKey = selectedComponent ? selectedComponent.familyFingerprint || selectedComponent.visualHash : '';
  const selectedEvidenceAvailable = selectedComponent
    ? Object.values(selectedComponent.aiEvidence || {}).some((score) => Number(score) > 0)
    : false;
  const selectedEvidenceLoading = evidenceLoading.has(selectedFamilyEvidenceKey);
  const selectedInstances = selectedComponent && scan
    ? scan.components.filter((item) => item.visualHash === selectedComponent.visualHash)
    : [];

  useEffect(() => {
    if (!visibleComponents.length) {
      if (selectedReviewId) setSelectedReviewId('');
      return;
    }
    if (!visibleComponents.some((component) => component.id === selectedReviewId)) {
      setSelectedReviewId(visibleComponents[0].id);
    }
  }, [selectedReviewId, visibleComponents]);

  const moveReviewSelection = (offset: number) => {
    if (!visibleComponents.length) return;
    const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
    const nextIndex = Math.max(0, Math.min(visibleComponents.length - 1, currentIndex + offset));
    setSelectedReviewId(visibleComponents[nextIndex].id);
  };

  return (
    <div className="component-scan-page">
      <section className="component-scan-source">
        <div className="component-scan-source-icon"><ScanSearch size={25} /></div>
        <div>
          <span className="scan-eyebrow">Component scan · step {scanStep} of 3</span>
          <h1>{document.open ? document.title : 'Open an Affinity document'}</h1>
          <p>{document.open
             ? scan
               ? 'Kryeo has named and organized the layers automatically. Build the asset library when you are ready.'
              : 'Kryeo will scan your layers, suggest names, and help you build an asset library.'
            : 'Open a document in Affinity, then return here to scan its layers.'}</p>
        </div>
        <div className="component-scan-source-actions">
          <button className="run-button" disabled={!canScanDocument} onClick={() => void runScan('document')}>
            {scanning && scanScope === 'document' ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}
            {scanning && scanScope === 'document' ? 'Scanning document' : scan ? 'Rescan document' : 'Scan document'}
          </button>
          <button className="secondary-button" disabled={!canScanSelection} onClick={() => void runScan('selection')}>
            {scanning && scanScope === 'selection' ? <LoaderCircle className="spin" size={16} /> : <MousePointer2 size={16} />}
            Scan selected layers
          </button>
        </div>
      </section>

      <ol className="scan-flow" aria-label="Asset workflow">
        {([
          ['Scan document', 'Find the layers', 1],
          ['AI prepares', 'Name and group automatically', 2],
          ['Build asset library', 'Save files to your library', 3],
        ] as const).map(([label, detail, step]) => (
          <li className={scanStep === step ? 'is-active' : scanStep > step ? 'is-complete' : ''} key={label as string}>
            <b>{scanStep > step ? <CircleCheck size={15} /> : step}</b>
            <span><strong>{label}</strong><small>{detail}</small></span>
          </li>
        ))}
      </ol>

      <details className="scan-options" open={showScanOptions} onToggle={(event) => setShowScanOptions(event.currentTarget.open)}>
        <summary>
          <span className="scan-options-icon"><WandSparkles size={16} /></span>
          <span className="scan-options-copy"><strong>Customize how Kryeo scans this document</strong><small>Optional. Smart defaults work for most documents.</small></span>
          <span className="scan-options-status">{intentCustomized ? 'Custom choices saved' : 'Using smart defaults'}</span>
          <ChevronRight size={17} />
        </summary>
        <div className="scan-options-body">
          <label>
            <span>Scan approach</span>
            <select value={scanMode} onChange={(event) => { setIntentCustomized(true); setShowScanOptions(true); setScanMode(event.target.value as ComponentScanMode); }}>
              <option value="smart">Smart: groups first</option>
              <option value="group-first">Keep construction layers inside groups</option>
              <option value="layer-inclusive">Include meaningful single layers</option>
            </select>
            <small>Choose whether Kryeo should prioritize grouped artwork or individual layers.</small>
          </label>
          <label>
            <span>Single layers</span>
            <select value={ungroupedLayers} onChange={(event) => { setIntentCustomized(true); setShowScanOptions(true); setUngroupedLayers(event.target.value); }}>
              <option value="ask">Let Kryeo decide</option>
              <option value="standalone-assets">Treat them as separate assets</option>
              <option value="construction-only">Keep them as construction pieces</option>
            </select>
            <small>Useful when designers leave standalone artwork outside groups.</small>
          </label>
          <label>
            <span>Repeated layers</span>
            <select value={repeatedChildren} onChange={(event) => { setIntentCustomized(true); setShowScanOptions(true); setRepeatedChildren(event.target.value); }}>
              <option value="ask">Let Kryeo decide</option>
              <option value="separate-assets">Make them reusable assets</option>
              <option value="keep-with-parent">Keep them with their group</option>
            </select>
            <small>Tell Kryeo whether repeated artwork should be reusable on its own.</small>
          </label>
          <label>
            <span>Document type</span>
            <select value={documentPurpose} onChange={(event) => { setIntentCustomized(true); setShowScanOptions(true); setDocumentPurpose(event.target.value); }}>
              <option value="mixed">Mixed screen and asset sheet</option>
              <option value="screen">One UI screen</option>
              <option value="kit">Reusable component kit</option>
            </select>
            <small>Helps Kryeo understand whether the document is a screen or an asset source.</small>
          </label>
          <label className={`watch-selection scan-options-watch ${watchSelection ? 'is-active' : ''}`} title="Automatically rescan when the Affinity selection changes">
            <input type="checkbox" checked={watchSelection} onChange={(event) => setWatchSelection(event.target.checked)} />
            <MousePointer2 size={15} />
            <span><strong>Watch the Affinity selection</strong><small>Rescan selected layers automatically when the selection changes.</small></span>
          </label>
        </div>
      </details>

      {!connected && <div className="inline-notice"><CircleAlert size={18} /><div><b>Affinity is offline</b><span>Reconnect before scanning components.</span></div></div>}
      {error && <div className="inline-notice inline-notice--error"><CircleAlert size={18} /><div><b>Component Scan stopped</b><span>{error}</span></div></div>}
      {connected && (hostedAi || localAi) && (
        <section className={`local-ai-strip ${hostedAi?.available || localAi?.available ? 'is-available' : ''}`}>
          <BrainCircuit size={18} />
          <div>
            <b>{hostedAi?.available ? 'Cloud suggestions are ready' : localAi?.available ? 'Local grouping is ready' : 'Visual analysis unavailable'}</b>
            <span>{hostedAi?.available
              ? scanning
                ? queuedModelRequests
                  ? `${hostedReviewer} is checking the document. ${queuedModelRequests} ${queuedModelRequests === 1 ? 'request is' : 'requests are'} waiting.`
                  : activeModelRequests
                    ? `${hostedReviewer} is checking the layers now.`
                    : `Kryeo will use ${hostedReviewer} to help name and group your layers.`
                : activeModelRequests || queuedModelRequests
                  ? `${hostedReviewer} is processing the current scan.`
                  : `Cloud naming and grouping is ready for the next scan · ${hostedReviewer}.`
              : hostedAi?.message || 'Kryeo can group obvious duplicates locally; detailed suggestions resume when Cloud Qwen reconnects.'}</span>
          </div>
        </section>
      )}

      {connected && scanning && (
        <section className="component-scan-progress" role="status" aria-live="polite">
          <div className="component-scan-progress-heading">
            <div className="component-scan-progress-icon"><LoaderCircle className="spin" size={20} /></div>
            <div>
              <span>{scanProgress?.label || 'Scanning document'}</span>
              <p>{scanProgress?.detail || 'Kryeo is preparing the component scan.'}</p>
            </div>
            <div className="component-scan-progress-tools">
              <div className="component-scan-progress-time"><Clock3 size={15} />{scanElapsed}s</div>
              <button className="secondary-button" onClick={() => void cancelScan()}><X size={15} />Cancel</button>
            </div>
          </div>
          <div
            className={`component-scan-progress-track ${scanProgress?.phase === 'hosted-analysis' ? 'is-model-phase' : ''}`}
            aria-label={`${scanProgress?.progress || 2}% complete`}
          >
            <div style={{ width: `${scanProgress?.progress || 2}%` }} />
          </div>
          <div className="component-scan-progress-footer">
            <span>{scanProgress?.completedFamilies !== undefined && scanProgress.totalFamilies
              ? `${scanProgress.completedFamilies} of ${scanProgress.totalFamilies} families · ${scanProgress.cachedFamilies || 0} cached${scanProgress.failedFamilies ? ` · ${scanProgress.failedFamilies} failed` : ''}`
              : `${scanProgress?.progress || 2}%`}</span>
            <span>{scanProgress?.phase === 'hosted-analysis' ? 'Cloud reviewer response times vary for uncached artwork.' : 'Keep Kryeo and Affinity open.'}</span>
          </div>
        </section>
      )}

      {!scan && connected && !scanning && (
        <section className="scan-empty animated-dash-box">
          <div className="scan-empty-icon"><Layers3 size={30} /></div>
          <span className="scan-empty-kicker">Start here</span>
          <h2>{document.open ? 'Scan the active document' : 'Open a document in Affinity'}</h2>
          <p>{document.open
             ? 'Kryeo will find groups and individual layers, use AI to name and organize them, and build the asset library for you.'
            : 'Kryeo needs an open Affinity document before it can find layers or create assets.'}</p>
          <ol className="scan-empty-steps">
            <li><b>1</b><span><strong>Scan</strong><small>Read the current layer structure.</small></span></li>
            <li><b>2</b><span><strong>AI prepares</strong><small>Name, classify, and group automatically.</small></span></li>
            <li><b>3</b><span><strong>Build</strong><small>Export editable files and PNGs.</small></span></li>
          </ol>
        </section>
      )}

      {scan && (
        <>
          <section className="scan-summary">
            <div><span>Layers found</span><strong>{scan.components.length}</strong></div>
            <div><span>Possible assets</span><strong>{included.size}</strong></div>
            <div><span>Needs attention</span><strong>{reviewStats.automated}</strong></div>
            <div><span>Complete decisions</span><strong>{reviewStats.ready}</strong></div>
          </section>
          {scan.diagnostics && (
            <details className="scan-diagnostics">
              <summary>
                Scan diagnostics · {scan.diagnostics.hostedRequestCount} gateway {scan.diagnostics.hostedRequestCount === 1 ? 'batch' : 'batches'}
                {' · '}{scan.diagnostics.providerRequestCount ?? scan.diagnostics.hostedRequestCount} provider {((scan.diagnostics.providerRequestCount ?? scan.diagnostics.hostedRequestCount) === 1) ? 'call' : 'calls'}
              </summary>
              <div>
                <span>Affinity export <b>{formatDuration(scan.diagnostics.stages.affinityExportMs)}</b></span>
                <span>Image preparation <b>{formatDuration(scan.diagnostics.stages.imagePreparationMs)}</b></span>
                <span>Local analysis <b>{formatDuration(scan.diagnostics.stages.localAnalysisMs)}</b></span>
                <span>Document context <b>{formatDuration(scan.diagnostics.stages.contextCaptureMs)}</b></span>
                <span>Cloud analysis <b>{formatDuration(scan.diagnostics.stages.hostedAnalysisMs)}</b></span>
                <span>Finalization <b>{formatDuration(scan.diagnostics.stages.finalizationMs)}</b></span>
                <span>
                  Affinity batches <b>{scan.diagnostics.affinityRequestCount ?? 0}</b>
                  {' · '}retries <b>{scan.diagnostics.affinityRetryCount ?? 0}</b>
                  {' · '}splits <b>{scan.diagnostics.affinitySplitCount ?? 0}</b>
                  {' · '}slowest <b>{formatDuration(scan.diagnostics.affinitySlowestRequestMs ?? 0)}</b>
                </span>
                <span>{scan.diagnostics.visualFamilyCount} visual families · {scan.diagnostics.cachedFamilyCount} cached · {scan.diagnostics.failedFamilyCount} failed · {scan.diagnostics.budgetLimitedFamilyCount} budget-limited</span>
                {(scan.diagnostics.failureMessages || []).map((message) => <span className="scan-diagnostics-failure" key={message}>{message}</span>)}
                {(scan.diagnostics.notes || []).map((note) => <span className="scan-diagnostics-note" key={note}>{note}</span>)}
                {scan.diagnostics.warnings.map((warning) => <span className="scan-diagnostics-warning" key={warning}>{warning}</span>)}
              </div>
            </details>
          )}
          {developerMode && (scanning || developerTrace.length > 0) && (
            <details className="scan-diagnostics developer-trace" open={scanning}>
              <summary>Developer scan trace · {developerTrace.length} events</summary>
              <div className="developer-trace-actions">
                <span>Compact scan trace. Open Settings → Developer console for the complete redacted event log.</span>
                <button className="secondary-button" type="button" disabled={!developerTrace.length} onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(developerTrace, null, 2)).then(() => setMessage('Developer trace copied to clipboard.')).catch(() => setError('Could not copy the developer trace.'));
                }}>Copy trace</button>
              </div>
              <pre>{developerTrace.map((entry) => `${entry.at}  [${entry.stage}] ${entry.message}${entry.data ? ` ${JSON.stringify(entry.data)}` : ''}`).join('\n')}</pre>
            </details>
          )}
          {scan.hostedAnalysisError && (
            <div className="inline-notice inline-notice--error">
              <CircleAlert size={18} />
              <div>
                <b>Cloud analysis could not finish</b>
                <span>{scan.hostedAnalysisError}</span>
              </div>
            </div>
          )}
          {scan.reconciliation && (
            <div className={`inline-notice ${scan.reconciliation.issues.length ? 'inline-notice--error' : ''}`}>
              {scan.reconciliation.issues.length ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
              <div>
                <b>{scan.reconciliation.issues.length ? `${scan.reconciliation.issues.length} families received safe AI fallbacks` : 'Document consistency checked'}</b>
                <span>{scan.reconciliation.summary}</span>
              </div>
            </div>
          )}

          <section className="component-workbench" aria-label="AI decision workspace">
            <header className="component-workbench-header">
              <div className="component-workbench-title">
                <div>
                        <span>Step 2 · AI prepares your library</span>
                        <h2>{unresolvedComponentCount ? 'Kryeo needs complete decisions' : 'Kryeo handled the decisions'}</h2>
                      </div>
                 <p>{unresolvedComponentCount
                   ? `${unresolvedComponentCount} ${unresolvedComponentCount === 1 ? 'family is' : 'families are'} unresolved because cloud analysis did not return a complete decision. Rescan before building the library.`
                   : reviewStats.automated
                   ? `AI made ${reviewStats.automated} conservative choice${reviewStats.automated === 1 ? '' : 's'} automatically. You can inspect them, but nothing needs approval.`
                   : 'Everything is ready. Inspect any layer if you want, then build your asset library.'}</p>
               </div>
             </header>

            <nav className="component-workbench-lanes" aria-label="Layer views">
              {([
                 ['check', 'Needs attention', reviewStats.automated],
                 ['structure', 'Groups', reviewStats.structure],
                 ['ready', 'Ready', reviewStats.ready],
                ['all', 'All layers', reviewStats.all],
              ] as const).map(([lane, label, count]) => (
                <button className={reviewLane === lane ? 'is-active' : ''} key={lane} type="button" onClick={() => setReviewLane(lane)}>
                  <span>{label}</span><b>{count}</b>
                </button>
              ))}
            </nav>

            <div className="component-workbench-tools">
              <label className="component-layer-search">
                <Search size={15} />
                <input value={reviewQuery} onChange={(event) => setReviewQuery(event.target.value)} placeholder="Find a layer, type, or role" aria-label="Search layers" />
                {reviewQuery && <button type="button" title="Clear search" onClick={() => setReviewQuery('')}><X size={14} /></button>}
              </label>
              <label className="component-layer-filter">
                <span>Category</span>
                <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}>
                  <option value="all">All categories</option>
                  <option value="ui">UI</option>
                  <option value="construction">Construction</option>
                  <option value="background">Background</option>
                </select>
              </label>
              <span className="component-workbench-count">{visibleComponents.length} shown</span>
            </div>

            <div className="component-workbench-body">
              <aside className="component-layer-panel" aria-label="Document layers">
                <div className="component-layer-panel-heading">
                   <span>Layers in this document</span>
                   <small>Select one to inspect</small>
                </div>
                <div
                  className="component-layer-tree"
                  role="tree"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveReviewSelection(1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveReviewSelection(-1);
                    }
                  }}
                >
                  {visibleComponents.length === 0 && (
                    <div className="component-layer-empty">
                      <CircleCheck size={24} />
                      <b>{reviewLane === 'check' ? 'No incomplete decisions' : 'No layers match'}</b>
                      <span>{reviewLane === 'check' ? 'Every visible family has a complete decision.' : 'Clear the search or choose another view.'}</span>
                      {reviewLane === 'check' && <button type="button" onClick={() => setReviewLane('all')}>Browse all layers</button>}
                    </div>
                  )}
                  {visibleComponents.map((component, index) => {
                    const priority = reviewPriority(component);
                    const hasChildren = component.childHierarchyKeys.length > 0;
                    return (
                      <div
                        className={`component-layer-row component-layer-depth-${Math.min(6, component.hierarchyDepth)} is-${priority}${included.has(component.id) ? '' : ' is-excluded'}${selectedComponent?.id === component.id ? ' is-selected' : ''}`}
                        key={component.id}
                        role="treeitem"
                        aria-level={component.hierarchyDepth + 1}
                        aria-selected={selectedComponent?.id === component.id}
                      >
                        <label className="component-layer-include" title="Include this layer in the asset library">
                          <input type="checkbox" checked={included.has(component.id)} onChange={(event) => setComponentExportTarget(component.id, event.target.checked)} />
                        </label>
                        {hasChildren && reviewLane === 'all'
                          ? <button
                              className={`component-layer-toggle ${expanded.has(component.hierarchyKey) ? 'is-expanded' : ''}`}
                              type="button"
                              title={expanded.has(component.hierarchyKey) ? 'Collapse children' : 'Expand children'}
                              onClick={() => setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(component.hierarchyKey)) next.delete(component.hierarchyKey); else next.add(component.hierarchyKey);
                                return next;
                              })}
                            ><ChevronRight size={14} /></button>
                          : hasChildren
                            ? <span className="component-layer-branch"><ChevronRight size={14} /></span>
                            : <span className="component-layer-spacer" />}
                        <button className="component-layer-main" type="button" onClick={() => setSelectedReviewId(component.id)}>
                          <span className="component-layer-thumbnail">
                            {component.previewUrl && <img src={component.previewUrl} alt={`Preview of ${component.name}`} loading="lazy" />}
                          </span>
                          <span className="component-layer-copy">
                            <b>{componentLayerLabel(component)}</b>
                            <small>{included.has(component.id) && componentExportName(component) !== componentLayerLabel(component)
                              ? `Asset: ${componentExportName(component)}`
                              : componentLayerLabel(component) === component.name ? component.affinityType : `${component.name} · ${component.affinityType}`}</small>
                          </span>
                          {component.duplicateCount > 1 && <span className="component-layer-instances">×{component.duplicateCount}</span>}
                        </button>
                        <span className="component-layer-status" title={priority === 'check' ? 'Needs attention' : isStructuralContextOnly(component) ? 'Structural context only' : isConstructionContext(component) ? 'Context classification complete' : 'Complete decision'} />
                        <span className="component-layer-number">{index + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <section className="component-inspector" aria-label="Selected layer decision">
                {!selectedComponent ? (
                  <div className="component-inspector-empty"><MousePointer2 size={28} /><b>Select a layer</b><span>Its name, type, and export decision will appear here.</span></div>
                ) : (
                  <>
                    <header className="component-inspector-header">
                      <div>
                        <span>{selectedPriority === 'check' ? 'Needs attention' : selectedStructuralContextOnly ? 'Structural context only' : selectedConstructionContext ? 'Context classification complete' : 'Complete decision'}</span>
                        <h3>{componentLayerLabel(selectedComponent)}</h3>
                      </div>
                      <nav aria-label="Move between visible layers">
                        <button type="button" title="Previous layer" disabled={selectedIndex <= 0} onClick={() => moveReviewSelection(-1)}><ArrowLeft size={15} /></button>
                        <span>{selectedIndex + 1} / {visibleComponents.length}</span>
                        <button type="button" title="Next layer" disabled={selectedIndex >= visibleComponents.length - 1} onClick={() => moveReviewSelection(1)}><ArrowRight size={15} /></button>
                      </nav>
                    </header>

                    <div className="component-inspector-scroll">
                      <div className="component-inspector-overview">
                        <div className="component-inspector-preview">
                          <AssetPreviewCanvas source={selectedComponent.previewUrl} label={`${selectedComponent.name} preview`} />
                        </div>
                        <div>
                          <span>Affinity layer</span>
                          <b>{selectedComponent.name}</b>
                          <small>{Math.round(selectedComponent.bounds.width)} × {Math.round(selectedComponent.bounds.height)} px · {selectedComponent.affinityType}</small>
                          <small>{selectedComponent.duplicateKind === 'exact'
                            ? `${selectedComponent.duplicateCount} identical instances`
                            : selectedComponent.duplicateKind === 'similar'
                              ? `${selectedComponent.similarCount} related visuals`
                              : 'Unique visual'}</small>
                        </div>
                      </div>

                      {selectedPriority !== 'ready' && (
                        <div className={`component-inspector-alert is-${selectedPriority}`}>
                          <CircleCheck size={17} />
                          <div>
                            <b>{selectedComponent.analysisState === 'provisional' || selectedComponent.analysisState === 'queued' || selectedComponent.assetType === 'Unknown'
                              ? 'Kryeo needs a complete AI decision'
                              : 'Kryeo kept this out of the export queue'}</b>
                            {(selectedComponent.reviewReasons?.length ? selectedComponent.reviewReasons : [
                              selectedComponent.analysisState === 'provisional' || selectedComponent.analysisState === 'queued' || selectedComponent.assetType === 'Unknown'
                                ? 'No complete visual name, type, and Roblox role were returned for this asset.'
                                : 'The visual evidence needs a complete replacement decision before this asset can be exported.',
                            ])
                              .slice(0, 3)
                              .map((reason) => <span key={reason}>{reason}</span>)}
                          </div>
                        </div>
                      )}

                      <label className="component-inspector-include">
                        <input type="checkbox" checked={included.has(selectedComponent.id)} onChange={(event) => setComponentExportTarget(selectedComponent.id, event.target.checked)} />
                         Include in asset library
                      </label>

                      <div className="component-inspector-form">
                        <label className="component-family-field">
                          Overall asset name
                          <input
                            value={componentOverallName(selectedComponent)}
                            onChange={(event) => updateFamily(selectedComponent, {
                              familyName: event.target.value,
                              layerLabel: event.target.value,
                              exportName: event.target.value,
                            })}
                          />
                          <span>AI-owned name used for the Affinity layer, editable file, PNG, and manifest.</span>
                        </label>
                        {included.has(selectedComponent.id) && selectedComponent.codeName && (
                          <div className="component-code-name"><span>Roblox-safe name</span><code>{selectedComponent.codeName}</code></div>
                        )}
                        <div className="component-classification-fields">
                          <label className="component-role-field">
                            What is it?
                            <select value={selectedComponent.assetType} onChange={(event) => updateFamily(selectedComponent, { assetType: event.target.value as ComponentAssetType })}>
                              {COMPONENT_ASSET_TYPES.map((type) => <option key={type}>{type}</option>)}
                            </select>
                          </label>
                          <label className="component-role-field">
                            Roblox object
                            <select value={selectedComponent.role} onChange={(event) => updateFamily(selectedComponent, { role: event.target.value as RobloxUiRole })}>
                              {ROBLOX_UI_ROLES.map((role) => <option key={role}>{role}</option>)}
                            </select>
                          </label>
                          {selectedComponent.childHierarchyKeys.length > 0 && (
                            <label className="component-dive-field">
                                 Group this as
                              <select value={selectedComponent.diveMode} onChange={(event) => updateDiveMode(selectedComponent, event.target.value as ComponentDiveMode)}>
                                <option value="keep-together">One combined asset</option>
                                <option value="children-only">Child assets only</option>
                                <option value="parent-and-children">Group and child assets</option>
                              </select>
                              <span>{selectedComponent.diveRemembered
                                ? 'Using your saved choice for matching groups.'
                                : selectedComponent.diveReasons[0]
                                  || (selectedComponent.diveMode === selectedComponent.recommendedDiveMode
                                    ? 'Chosen from the group structure and visual overlap.'
                                    : `Kryeo recommends ${selectedComponent.recommendedDiveMode.replace(/-/g, ' ')}.`)}</span>
                            </label>
                          )}
                        </div>
                      </div>

                      {selectedComponent.semanticConflict && <div className="semantic-conflict"><CircleAlert size={13} /><span>{selectedComponent.semanticConflictMessage}</span></div>}
                      {selectedComponent.diveConflict && <div className="semantic-conflict"><CircleAlert size={13} /><span>{selectedComponent.diveConflictMessage}</span></div>}
                      {Boolean(selectedComponent.automationIssues?.length) && <div className="component-automation-issues"><CircleAlert size={15} /><div><b>Kryeo needs one decision</b>{selectedComponent.automationIssues?.slice(0, 3).map((issue) => <span key={issue}>{issue}</span>)}</div></div>}
                      {selectedComponent.keptInsideParent && <div className="component-inspector-note">This layer stays inside its parent because of a project rule.</div>}

                      <details
                        className={`component-inspector-details ${selectedComponent.semanticConflict ? 'has-conflict' : ''}`}
                        onToggle={(event) => {
                          if (event.currentTarget.open && selectedComponent.aiConfidence !== undefined && !selectedEvidenceAvailable) void loadFamilyEvidence(selectedComponent);
                        }}
                      >
                         <summary>Why Kryeo made this decision</summary>
                        <div>
                          <p>{selectedComponent.analysisReason || 'Kryeo combined the artwork, layer name, hierarchy, and learned project choices.'}</p>
                          {selectedComponent.aiConfidence !== undefined && <b>{Math.round(selectedComponent.aiConfidence * 100)}% model confidence</b>}
                          {selectedEvidenceLoading && <span>Loading detailed evidence from {hostedReviewer}…</span>}
                          {selectedEvidenceAvailable && (
                            <div className="component-evidence-grid">
                              <span>Visual <b>{Math.round((selectedComponent.aiEvidence?.visual || 0) * 100)}%</b></span>
                              <span>Name <b>{Math.round((selectedComponent.aiEvidence?.layerName || 0) * 100)}%</b></span>
                              <span>Hierarchy <b>{Math.round((selectedComponent.aiEvidence?.hierarchy || 0) * 100)}%</b></span>
                              <span>Memory <b>{Math.round((selectedComponent.aiEvidence?.learned || 0) * 100)}%</b></span>
                            </div>
                          )}
                          {selectedComponent.aiEvidenceSupportsClassification === false && (
                            <span className="component-evidence-warning">
                              {selectedComponent.aiEvidenceSuggestedType
                                ? `An independent review proposes ${selectedComponent.aiEvidenceSuggestedType}; this decision is marked for review until that replacement is applied.`
                                : 'An independent review found a contradiction but did not provide a replacement; this decision is marked for review.'}
                            </span>
                          )}
                          {Boolean(selectedComponent.analysisAlternatives?.length) && (
                            <span className="component-evidence-alternative">
                              Alternative considered: {selectedComponent.analysisAlternatives?.map((alternative) => `${alternative.assetType} — ${alternative.reason}`).join(' · ')}
                            </span>
                          )}
                          {selectedComponent.aiModelSuggestedType && <span>{selectedComponent.aiEvidenceSupportsClassification === false ? 'Original cloud proposal:' : 'Cloud proposal:'} {selectedComponent.aiModelSuggestedName || selectedComponent.familyName} · {selectedComponent.aiModelSuggestedType}</span>}
                          {selectedComponent.aiNormalizationReason && <span>{selectedComponent.aiNormalizationReason}</span>}
                        </div>
                      </details>

                      {selectedInstances.length > 1 && (
                        <details className="component-instances component-inspector-details">
                          <summary>{selectedInstances.length} matching instances</summary>
                          <div>{selectedInstances.map((item) => <span key={item.id}>{item.name} · {item.members[0]?.path.join('.') || 'unknown path'}</span>)}</div>
                        </details>
                      )}
                    </div>

                    <footer className="component-inspector-action">
                      <span>{selectedPriority === 'check'
                        ? <><CircleAlert size={16} />Incomplete decision</>
                        : selectedStructuralContextOnly
                          ? <><CircleCheck size={16} />Structural context only</>
                          : selectedConstructionContext
                            ? <><CircleCheck size={16} />Context classification ready</>
                            : <><CircleCheck size={16} />AI decision ready</>}</span>
                    </footer>
                  </>
                )}
              </section>
            </div>
          </section>

          <footer className="scan-actions">
            <div>{unresolvedComponentCount
              ? <><CircleAlert size={16} />{unresolvedComponentCount} {unresolvedComponentCount === 1 ? 'family needs' : 'families need'} a complete decision before build</>
              : message
              ? <><CircleCheck size={16} />{message}</>
              : <><CircleCheck size={16} />{included.size} {included.size === 1 ? 'asset target' : 'asset targets'} selected · AI decisions are ready</>}</div>
            <button className="text-button" disabled={scanning} onClick={() => void runScan()}><RefreshCw size={15} />Rescan</button>
            <details className="scan-more-actions">
              <summary>More actions <ChevronRight size={15} /></summary>
              <div>
                <button className="secondary-button" disabled={saving} onClick={() => void rememberChoices()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? 'Saving decisions' : 'Save decisions & teach Kryeo'}</button>
                <button className="secondary-button" disabled={applying || scanScope !== 'document'} onClick={() => void applyNames()}>{applying ? <LoaderCircle className="spin" size={16} /> : <FileCode2 size={16} />}{applying ? 'Applying names' : 'Reapply AI names'}</button>
                <button className="secondary-button" disabled={applying || scanScope !== 'document' || included.size === 0} onClick={() => void applyOrganization()}>{applying ? <LoaderCircle className="spin" size={16} /> : <Layers3 size={16} />}{applying ? 'Organizing layers' : 'Organize Affinity layers'}</button>
              </div>
            </details>
            <button className="run-button" disabled={exporting || applying || scanScope !== 'document' || included.size === 0 || unresolvedComponentCount > 0} onClick={() => void createAssets()}>{exporting || applying ? <LoaderCircle className="spin" size={16} /> : <Package size={16} />}{exporting || applying ? 'Building asset library' : unresolvedComponentCount ? 'Rescan required' : 'Build asset library'}</button>
          </footer>
        </>
      )}
    </div>
  );
}

function ProjectNotesPanel({ project, workspace, onWorkspace }: {
  project: string;
  workspace: WorkspaceSnapshot;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
}) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');
  const [age, setAge] = useState<'all' | '7' | '30'>('all');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const knowledge = workspace.projectKnowledge.find((item) => item.project === project);
  const notes = (knowledge?.notes || []).filter((note) => {
    const needle = query.trim().toLowerCase();
    const matchesText = !needle || note.text.toLowerCase().includes(needle) || note.tags.some((tag) => tag.includes(needle));
    const matchesAge = age === 'all' || Date.now() - new Date(note.updatedAt).getTime() <= Number(age) * 86_400_000;
    return matchesText && matchesAge;
  });
  const saveNote = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      onWorkspace(await window.kryeo.saveProjectNote({
        project,
        text: text.trim(),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      }));
      setText('');
      setTags('');
      setExpanded(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={`project-notes ${expanded ? 'is-expanded' : ''}`}>
      <button className="project-notes-heading" type="button" onClick={() => setExpanded((value) => !value)}>
        <MessageSquare size={19} />
        <span><b>{project} notes</b></span>
        <ChevronRight size={17} />
      </button>
      {expanded && <div className="project-notes-body">
        <div className="project-note-compose">
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a decision, technique, palette, or project detail..." />
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, separated by commas" />
          <button className="run-button" disabled={!text.trim() || saving} onClick={() => void saveNote()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}Add note</button>
        </div>
        <div className="project-notes-tools">
          <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes or tags" /></label>
          <select value={age} onChange={(event) => setAge(event.target.value as typeof age)} aria-label="Filter notes by age"><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
          <button className="icon-button" title="Import project notes" onClick={() => void window.kryeo.importProjectKnowledge(project).then(onWorkspace)}><Upload size={15} /></button>
          <button className="icon-button" title="Export project notes" onClick={() => void window.kryeo.exportProjectKnowledge(project)}><Download size={15} /></button>
        </div>
        <div className="project-note-list">
          {notes.length ? notes.map((note) => <article key={note.id}>
            <p>{note.text}</p>
            <div><span>{note.tags.length ? note.tags.join(' / ') : 'Untagged'}</span><time>{relativeDate(note.updatedAt)}</time><button title="Delete note" onClick={() => void window.kryeo.deleteProjectNote(project, note.id).then(onWorkspace)}><Trash2 size={14} /></button></div>
          </article>) : <div className="project-note-empty">{query ? 'No notes match this search.' : 'No project notes yet.'}</div>}
        </div>
      </div>}
    </section>
  );
}

function AssetsPage({ library, assets, openingAssetPath, connected, onOpen, onReveal, workspace, project, onWorkspace, onPreference, onNavigate }: {
  library: AssetLibrarySnapshot;
  assets: AssetRecord[];
  openingAssetPath: string;
  connected: boolean;
  onOpen: (asset: AssetRecord) => void;
  onReveal: (path: string) => void;
  workspace: WorkspaceSnapshot;
  project: string;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
  onPreference: (assetId: string, favourite: boolean, collections: string[]) => void;
  onNavigate: (page: Page) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = assets.find((asset) => asset.id === selectedId) || assets[0];
  const preference = workspace.preferences.find((item) => item.assetId === selected?.id);
  const versions = selected ? library.versions.filter((item) => item.id === selected.id || item.codeName === selected.codeName).sort((a, b) => b.version - a.version) : [];

  useEffect(() => {
    if (selected && !assets.some((asset) => asset.id === selectedId)) setSelectedId(selected.id);
  }, [assets, selected, selectedId]);

  if (!library.available) {
    return <div className="empty-state enter-page"><LibraryBig size={31} /><h2>Preparing your Kryeo library</h2><p>{library.message}</p></div>;
  }
  if (library.assets.length === 0) {
    return <div className="empty-state empty-state--library enter-page"><LibraryBig size={31} /><h2>Your asset library is ready</h2><p>Scan an Affinity document and Kryeo will name, classify, organize, and export the assets automatically.</p><button className="run-button" onClick={() => onNavigate('import')}><ScanSearch size={17} />Scan &amp; export</button></div>;
  }
  return (
    <div className="page-stack enter-page">
      <ProjectNotesPanel project={project} workspace={workspace} onWorkspace={onWorkspace} />
      <section className="metrics-row">
        <div><span>Current assets</span><strong>{library.assets.length}</strong></div>
        <div><span>Saved versions</span><strong>{library.totalVersions}</strong></div>
        <div><span>Projects</span><strong>{library.projects.length}</strong></div>
        <div><span>Needs attention</span><strong>{library.unhealthyCount}</strong></div>
        <div><span>Storage</span><strong>Kryeo</strong></div>
      </section>
      <div className="asset-browser-layout">
        <section className="content-section content-section--flush asset-results">
          <div className="section-title-row">
            <div><h2>Kryeo asset library</h2><p>Browse previews, versions, and notes without leaving Kryeo.</p></div>
          </div>
          <AssetTable
            assets={assets}
            selectedId={selected?.id}
            onSelect={setSelectedId}
            onReveal={onReveal}
          />
        </section>
        <aside className="asset-detail-panel">
          {selected ? (
            <>
              <div className="asset-preview">{selected.previewUrl ? <AssetPreviewCanvas source={selected.previewUrl} label={`${selected.displayName || selected.name} preview`} /> : <Box size={28} />}</div>
              <div className="asset-detail-heading">
                <span className={`asset-health asset-health--${selected.health || 'ready'}`}>{selected.health === 'ready' ? <CircleCheck size={14} /> : <CircleAlert size={14} />}<span>{selected.health === 'ready' ? 'Export is current' : selected.healthMessage}</span></span>
                <h2>{selected.displayName || selected.name}</h2>
                <code>{selected.codeName}</code>
              </div>
              <div className="asset-actions"><button className={`icon-button ${preference?.favourite ? 'is-favourite' : ''}`} onClick={() => onPreference(selected.id, !preference?.favourite, preference?.collections || [])} title="Favourite asset"><Star size={16} fill={preference?.favourite ? 'currentColor' : 'none'} /></button><label>Collections<input value={(preference?.collections || []).join(', ')} onChange={(event) => onPreference(selected.id, Boolean(preference?.favourite), event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder="HUD, inventory" /></label></div>
              <dl className="asset-facts">
                <div><dt>Location</dt><dd>{[selected.project, selected.category, selected.subcategory].filter(Boolean).join(' / ')}</dd></div>
                <div><dt>Version</dt><dd>v{selected.version}</dd></div>
                <div><dt>Tags</dt><dd>{selected.tags?.length ? selected.tags.join(', ') : 'None'}</dd></div>
                <div><dt>Updated</dt><dd>{formatDate(selected.updatedAt)}</dd></div>
                {selected.notes && <div><dt>Notes</dt><dd>{selected.notes}</dd></div>}
                <div><dt>History</dt><dd>{versions.map((item) => `v${item.version}`).join(', ') || `v${selected.version}`}</dd></div>
              </dl>
              {library.duplicateCodeNames.includes(selected.codeName.toLowerCase()) && <p className="asset-detail-warning">This code name is also used by another current asset.</p>}
              <button
                className="run-button asset-open-button"
                disabled={!connected || Boolean(openingAssetPath)}
                onClick={() => onOpen(selected)}
              >
                {openingAssetPath === selected.path ? <LoaderCircle className="spin" size={16} /> : <FolderOpen size={16} />}
                {openingAssetPath === selected.path ? 'Opening' : 'Open in Affinity'}
              </button>
              {!connected && <p className="asset-detail-warning">Connect Affinity before opening an asset.</p>}
            </>
          ) : (
            <div className="table-empty"><Box size={22} /><span>No matching asset selected.</span></div>
          )}
        </aside>
      </div>
    </div>
  );
}

function AssetTable({ assets, compact = false, selectedId, onSelect, onReveal }: {
  assets: AssetRecord[];
  compact?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onReveal?: (path: string) => void;
}) {
  if (assets.length === 0) {
    return <div className="table-empty"><Box size={22} /><span>No assets to show.</span></div>;
  }
  return (
    <div className={`asset-table ${compact ? 'asset-table--compact' : ''}`}>
      <div className="asset-row asset-row--header">
        <span>Asset</span><span>Project</span><span>Category</span><span>Version</span><span>Updated</span><span />
      </div>
      {assets.map((asset) => (
        <div
          className={`asset-row ${selectedId === asset.id ? 'is-selected' : ''} ${onSelect ? 'is-selectable' : ''}`}
          key={asset.id}
          onClick={() => onSelect?.(asset.id)}
          onKeyDown={(event) => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(asset.id); } }}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-pressed={onSelect ? selectedId === asset.id : undefined}
        >
          <span className="asset-name"><i><Box size={16} /></i><b>{asset.displayName || asset.name}</b><small>{asset.codeName}</small></span>
          <span>{asset.project || 'Unsorted'}</span>
          <span>{asset.category || 'Unsorted'}</span>
          <span>v{asset.version}</span>
          <span>{relativeDate(asset.updatedAt)}</span>
          <span>
            {onReveal && (
              <button className="icon-button icon-button--small" onClick={(event) => { event.stopPropagation(); onReveal(asset.path); }} title="Show in folder" aria-label={`Show ${asset.displayName} in folder`}>
                <ExternalLink size={14} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActivityPage({ activities, jobs, logs, tab, setTab, onCancel, onRetry }: {
  activities: ActivityEntry[];
  jobs: JobRecord[];
  logs: LibraryLogs;
  tab: 'run' | 'error';
  setTab: (tab: 'run' | 'error') => void;
  onCancel: (id: string) => void;
  onRetry: (job: JobRecord) => void;
}) {
  return (
    <div className="activity-layout enter-page">
      <section className="operation-list">
        <div className="section-title-row"><div><h2>Operations</h2></div></div>
        {jobs.length === 0 && activities.length === 0 ? (
          <div className="table-empty"><Clock3 size={21} /><span>No Kryeo operations yet.</span></div>
        ) : jobs.length > 0 ? jobs.map((job) => (
          <article className={`operation-row job-row job-row--${job.status}`} key={job.id}>
            {job.status === 'succeeded' ? <CircleCheck className="success" size={18} /> : job.status === 'running' || job.status === 'queued' ? <LoaderCircle className="spin" size={18} /> : <CircleAlert className="danger" size={18} />}
            <div><strong>{job.title}</strong><span>{job.stage}{job.output ? `: ${job.output}` : ''}</span><i className="job-progress"><b style={{ width: `${job.progress}%` }} /></i></div>
            <time>{formatDate(job.completedAt || job.updatedAt)}</time>
            <div className="job-actions">{(job.status === 'running' || job.status === 'queued') && <button className="icon-button icon-button--small" onClick={() => onCancel(job.id)} title="Cancel"><X size={14} /></button>}{['failed', 'interrupted', 'cancelled'].includes(job.status) && <button className="secondary-button" onClick={() => onRetry(job)}><RotateCw size={14} />Retry</button>}</div>
          </article>
        )) : activities.map((entry) => (
          <article className="operation-row" key={entry.id}>
            {entry.ok ? <CircleCheck className="success" size={18} /> : <CircleAlert className="danger" size={18} />}
            <div><strong>{entry.title}</strong><span>{entry.output}</span></div>
            <time>{formatDate(entry.completedAt)}</time>
          </article>
        ))}
      </section>
      <section className="log-viewer">
        <div className="log-toolbar">
          <div className="segmented-control">
            <button className={tab === 'run' ? 'is-active' : ''} onClick={() => setTab('run')}>Run log</button>
            <button className={tab === 'error' ? 'is-active' : ''} onClick={() => setTab('error')}>Last error</button>
          </div>
        </div>
        <pre>{(tab === 'run' ? logs.run : logs.error) || 'No log entries.'}</pre>
      </section>
    </div>
  );
}

function LearningPage({ workspace, onWorkspace }: {
  workspace: WorkspaceSnapshot;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
}) {
  const [view, setView] = useState<'visual' | 'rules'>('visual');
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const decisions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...workspace.componentDecisions]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((decision) => !needle || [
        decision.familyName,
        decision.assetType,
        decision.role,
        decision.suggestedName,
        decision.suggestedType,
        decision.suggestedRole,
        decision.documentTitle,
      ].some((value) => value?.toLowerCase().includes(needle)));
  }, [query, workspace.componentDecisions]);
  const memories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...workspace.assistantMemories]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((memory) => !needle || [memory.text, memory.project, memory.kind, memory.documentTitle]
        .some((value) => value?.toLowerCase().includes(needle)));
  }, [query, workspace.assistantMemories]);
  const corrected = workspace.componentDecisions.filter((decision) => Boolean(decision.correctionCount)).length;
  const globalLearning = workspace.assistantMemories.filter((memory) => memory.scope === 'global').length
    + workspace.componentDecisions.filter((decision) => decision.scope === 'global').length;

  const clearVisuals = async () => {
    if (!window.confirm('Forget every learned visual family? New scans will run the AI analysis again.')) return;
    setBusyKey('clear-visual');
    try {
      onWorkspace(await window.kryeo.clearComponentDecisions());
    } finally {
      setBusyKey('');
    }
  };
  const clearRules = async () => {
    if (!window.confirm('Forget every written Assistant rule? This does not delete conversations or project notes.')) return;
    setBusyKey('clear-rules');
    try {
      onWorkspace(await window.kryeo.clearAssistantMemories());
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="learning-page enter-page">
      <section className="learning-summary">
        <div><ScanSearch size={19} /><span>Learned families</span><strong>{workspace.componentDecisions.length}</strong></div>
        <div><CircleCheck size={19} /><span>User corrections</span><strong>{corrected}</strong></div>
        <div><MessageSquare size={19} /><span>Written rules</span><strong>{workspace.assistantMemories.length}</strong></div>
        <div><Layers3 size={19} /><span>Global learning</span><strong>{globalLearning}</strong></div>
      </section>

      <section className="learning-workbench">
        <header className="learning-toolbar">
          <div className="segmented-control learning-switch" aria-label="Learning record type">
            <button className={view === 'visual' ? 'is-active' : ''} onClick={() => setView('visual')}>Visual families</button>
            <button className={view === 'rules' ? 'is-active' : ''} onClick={() => setView('rules')}>Written rules</button>
          </div>
          <label className="learning-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view === 'visual' ? 'visual decisions' : 'written rules'}`} />
          </label>
          <button
            className="secondary-button learning-clear"
            disabled={busyKey !== '' || (view === 'visual' ? workspace.componentDecisions.length === 0 : workspace.assistantMemories.length === 0)}
            onClick={() => void (view === 'visual' ? clearVisuals() : clearRules())}
          >
            {busyKey.startsWith('clear') ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            Clear {view === 'visual' ? 'learned families' : 'written rules'}
          </button>
        </header>

        {view === 'visual' ? (
          <div className="learning-list">
            {decisions.length ? decisions.map((decision) => (
              <LearningDecisionRow
                key={decision.visualHash}
                decision={decision}
                busy={busyKey === decision.visualHash}
                onBusy={setBusyKey}
                onWorkspace={onWorkspace}
              />
            )) : (
               <div className="learning-empty"><ScanSearch size={28} /><h2>{query ? 'No matching visual decisions' : 'No learned visuals yet'}</h2><p>{query ? 'Try a different name, type, role, or document.' : 'AI decisions from Component Scan will appear here.'}</p></div>
            )}
          </div>
        ) : (
          <div className="learning-list">
            {memories.length ? memories.map((memory) => (
              <article className="learning-rule" key={memory.id}>
                <div className="learning-rule-copy">
                  <div><strong>{memory.scope === 'global' ? 'All projects' : memory.project}</strong><span>{memory.kind.replace(/-/g, ' ')}</span></div>
                  <p>{memory.text}</p>
                  <small>{memory.documentTitle ? `From ${memory.documentTitle} · ` : ''}{formatDate(memory.createdAt)}</small>
                </div>
                <div className="learning-rule-actions">
                  <button
                    className="secondary-button"
                    disabled={busyKey === memory.id}
                    onClick={() => {
                      setBusyKey(memory.id);
                      void window.kryeo.setAssistantMemoryScope(memory.id, memory.scope === 'global' ? 'project' : 'global', memory.project)
                        .then(onWorkspace)
                        .finally(() => setBusyKey(''));
                    }}
                  >
                    {memory.scope === 'global' ? <Pin size={14} /> : <Layers3 size={14} />}
                    {memory.scope === 'global' ? 'Keep in project' : 'Use in all projects'}
                  </button>
                  <button
                    className="icon-button learning-delete"
                    title="Forget written rule"
                    aria-label="Forget written rule"
                    disabled={busyKey === memory.id}
                    onClick={() => {
                      setBusyKey(memory.id);
                      void window.kryeo.forgetAssistantMemory(memory.id).then(onWorkspace).finally(() => setBusyKey(''));
                    }}
                  ><Trash2 size={16} /></button>
                </div>
              </article>
            )) : (
              <div className="learning-empty"><MessageSquare size={28} /><h2>{query ? 'No matching written rules' : 'No written rules yet'}</h2><p>{query ? 'Try a different phrase or project name.' : 'Rules learned through Assistant conversations will appear here.'}</p></div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LearningDecisionRow({ decision, busy, onBusy, onWorkspace }: {
  decision: ComponentDecision;
  busy: boolean;
  onBusy: (key: string) => void;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
}) {
  const [name, setName] = useState(decision.familyName);
  const [assetType, setAssetType] = useState<ComponentAssetType>(decision.assetType || 'Unknown');
  const [role, setRole] = useState<RobloxUiRole>(decision.role);
  useEffect(() => {
    setName(decision.familyName);
    setAssetType(decision.assetType || 'Unknown');
    setRole(decision.role);
  }, [decision]);
  const changed = name.trim() !== decision.familyName || assetType !== (decision.assetType || 'Unknown') || role !== decision.role;
  const corrected = Boolean(
    decision.correctionCount
    || (decision.suggestedName && decision.suggestedName.toLowerCase() !== decision.familyName.toLowerCase())
    || (decision.suggestedType && decision.suggestedType !== decision.assetType)
    || (decision.suggestedRole && decision.suggestedRole !== decision.role)
  );
  const source = [
    decision.suggestedName || 'No name proposal',
    decision.suggestedType || 'Unknown type',
    decision.suggestedRole || 'Unknown role',
  ].join(' · ');
  const save = async () => {
    if (!name.trim() || !changed) return;
    onBusy(decision.visualHash);
    try {
      const { updatedAt: _updatedAt, ...record } = decision;
      onWorkspace(await window.kryeo.saveComponentDecisions([{
        ...record,
        familyName: name.trim(),
        assetType,
        role,
        provenance: {
          source: 'learning-editor',
          originalName: decision.suggestedName,
          originalType: decision.suggestedType,
          originalRole: decision.suggestedRole,
        },
      }]));
    } finally {
      onBusy('');
    }
  };
  const forget = async () => {
    onBusy(decision.visualHash);
    try {
      onWorkspace(await window.kryeo.forgetComponentDecision(decision.visualHash));
    } finally {
      onBusy('');
    }
  };

  return (
    <article className={`learning-decision ${corrected ? 'is-corrected' : ''}`}>
      <div className="learning-decision-mark"><BrainCircuit size={21} /><span>{decision.correctionCount || 0}</span></div>
      <div className="learning-decision-body">
        <div className="learning-decision-heading">
           <div><strong>{decision.familyName}</strong><span>{corrected ? 'User corrected' : 'AI decision saved'}</span></div>
          <small>{decision.documentTitle || 'Source document unavailable'} · {formatDate(decision.updatedAt)}</small>
        </div>
        <div className="learning-origin"><span>Original proposal</span><p>{source}</p></div>
        <div className="learning-influence">
           <span>{decision.provenance?.source === 'learning-editor' ? 'Edited in Learning' : 'Saved from Component Scan'}</span>
          <span>Used in {decision.influenceCount || 0} later {(decision.influenceCount || 0) === 1 ? 'scan' : 'scans'}</span>
          {decision.lastInfluencedAt && <span>Last used {formatDate(decision.lastInfluencedAt)}</span>}
          <span>Calibration {decision.confidenceSamples
            ? `${Math.round(((decision.confidenceCorrect || 0) / decision.confidenceSamples) * 100)}% across ${decision.confidenceSamples} reviews`
            : 'waiting for reviews'}</span>
        </div>
        <div className="learning-fields">
          <label>Name<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>Asset type<select value={assetType} onChange={(event) => setAssetType(event.target.value as ComponentAssetType)}>{COMPONENT_ASSET_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Roblox role<select value={role} onChange={(event) => setRole(event.target.value as RobloxUiRole)}>{ROBLOX_UI_ROLES.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="learning-decision-meta"><span>{decision.scope === 'global' ? 'All projects' : decision.project || 'Current project'} · {decision.familyMemberHashes?.length || 1} visual{decision.familyMemberHashes?.length === 1 ? '' : 's'}</span><code title={decision.familyFingerprint || decision.visualHash}>{(decision.familyFingerprint || decision.visualHash).slice(0, 12)}</code></div>
      </div>
      <div className="learning-decision-actions">
        <button
          className="secondary-button"
          disabled={busy}
          title={decision.scope === 'global' ? 'Limit this learning to its project' : 'Use this learning in every project'}
          onClick={() => {
            if (decision.scope !== 'global' && !window.confirm('Use this visual learning in every project? Only promote decisions that describe a broadly reusable component.')) return;
            onBusy(decision.visualHash);
            void window.kryeo.setComponentDecisionScope(decision.visualHash, decision.scope === 'global' ? 'project' : 'global')
              .then(onWorkspace)
              .finally(() => onBusy(''));
          }}
        >{decision.scope === 'global' ? <Layers3 size={14} /> : <Pin size={14} />}{decision.scope === 'global' ? 'Project only' : 'Use globally'}</button>
        <button className="secondary-button" disabled={!changed || busy || !name.trim()} onClick={() => void save()}>{busy && changed ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}Save</button>
        <button className="icon-button learning-delete" title="Forget visual decision" aria-label="Forget visual decision" disabled={busy} onClick={() => void forget()}><Trash2 size={16} /></button>
      </div>
    </article>
  );
}

function SettingsPage({ version, status, onReconnect, onWorkspace, developerMode, onDeveloperModeChange, developerLog, onDeveloperLogChange }: {
  version: string;
  status: AffinityStatus;
  onReconnect: () => void;
  onWorkspace: (workspace: WorkspaceSnapshot) => void;
  developerMode: boolean;
  onDeveloperModeChange: (enabled: boolean) => void;
  developerLog: DeveloperLogSnapshot;
  onDeveloperLogChange: (snapshot: DeveloperLogSnapshot) => void;
}) {
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [assistantInstalling, setAssistantInstalling] = useState<'portable' | 'balanced' | ''>('');
  const [startPage, setStartPage] = useState<SettingsStartPage>(() => {
    const saved = localStorage.getItem('kryeo.start-page') as SettingsStartPage | null;
    return saved && SETTINGS_START_PAGES.some((option) => option.id === saved) ? saved : 'home';
  });
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  useEffect(() => { void window.kryeo.getAssistantStatus().then(setAssistantStatus).catch(() => undefined); }, []);

  const cleanTemporaryFiles = async () => {
    setMaintenanceMessage('Cleaning temporary files...');
    try {
      const result = await window.kryeo.cleanupStaging();
      setMaintenanceMessage(result.ok ? 'Temporary files cleaned.' : 'Temporary files could not be cleaned.');
      onWorkspace(await window.kryeo.getWorkspace());
    } catch {
      setMaintenanceMessage('Temporary files could not be cleaned.');
    }
  };

  const connectionReady = status.state === 'connected';
  const setDeveloperMode = (enabled: boolean) => {
    onDeveloperModeChange(enabled);
    localStorage.setItem('kryeo.developer-mode', String(enabled));
  };
  const copyDeveloperLog = () => {
    void navigator.clipboard.writeText(JSON.stringify(developerLog.entries, null, 2))
      .then(() => setMaintenanceMessage('Developer log copied to clipboard.'))
      .catch(() => setMaintenanceMessage('Developer log could not be copied.'));
  };
  const clearDeveloperLog = () => {
    void window.kryeo.clearDeveloperLog()
      .then(onDeveloperLogChange)
      .then(() => setMaintenanceMessage('Developer log cleared.'))
      .catch(() => setMaintenanceMessage('Developer log could not be cleared.'));
  };
  return (
    <div className="settings-list settings-list--preferences enter-page">
      <section className="settings-section settings-section--intro">
        <div>
          <h2>Keep Kryeo feeling like yours</h2>
          <p>Only the choices that change your day-to-day workflow belong here.</p>
        </div>
      </section>

      <section className="settings-section">
        <div><h2>Startup</h2><p>Choose the workspace Kryeo opens first.</p></div>
        <div className="settings-value settings-control-stack">
          <label className="settings-control">
            <span>Open Kryeo on</span>
            <select value={startPage} onChange={(event) => {
              const next = event.target.value as SettingsStartPage;
              setStartPage(next);
              localStorage.setItem('kryeo.start-page', next);
            }}>
              {SETTINGS_START_PAGES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <small className="settings-hint">This choice is saved on this device.</small>
        </div>
      </section>

      <section className="settings-section">
        <div><h2>Assistant</h2><p>Use review help without sending your project to another service.</p></div>
        <div className="settings-value settings-assistant-value">
          <div className="settings-status-line">
            <StatusDot status={{ ...status, state: assistantStatus?.ready ? 'connected' : 'disconnected' }} />
            <strong>{assistantStatus?.ready ? 'Offline assistant ready' : assistantStatus?.installed ? 'Assistant is preparing' : 'Offline assistant not installed'}</strong>
          </div>
          <span className="settings-hint">{assistantStatus?.ready ? 'Available on this device for private project help.' : 'Install an offline pack when you want local assistant help.'}</span>
          <div className="delivery-buttons">
            {assistantStatus?.availableModelPacks?.map((pack) => (
              <button
                key={pack.id}
                className={assistantStatus.modelPack === pack.id && pack.installed ? 'run-button' : 'secondary-button'}
                disabled={Boolean(assistantInstalling) || (pack.id === 'balanced' && (assistantStatus.memoryGB || 0) < 12)}
                title={pack.description}
                onClick={() => {
                  setAssistantInstalling(pack.id);
                  void window.kryeo.installAssistant(pack.id)
                    .then(setAssistantStatus)
                    .finally(() => setAssistantInstalling(''));
                }}
              >
                {assistantInstalling === pack.id ? <LoaderCircle className="spin" size={15} /> : <BrainCircuit size={15} />}
                {pack.installed ? `Use ${pack.name}` : `Install ${pack.name}`}
                {pack.recommended ? ' (recommended)' : ''}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div><h2>Affinity</h2><p>Connect the creative source that powers Kryeo workflows.</p></div>
        <div className="settings-value settings-connection-value">
          <div className="settings-status-line"><StatusDot status={status} /><strong>{connectionReady ? 'Connected' : 'Not connected'}</strong></div>
          <span className="settings-hint">{connectionReady ? 'Workflows and document context are ready.' : 'Open Affinity and enable its Kryeo connection to continue.'}</span>
          <button className="secondary-button" onClick={onReconnect}><RotateCw size={15} />Reconnect</button>
        </div>
      </section>

      <section className="settings-section">
        <div><h2>Local data</h2><p>Kryeo keeps workspace information on this device and clears temporary previews when asked.</p></div>
        <div className="settings-value settings-maintenance-value">
          <button className="secondary-button" onClick={() => void cleanTemporaryFiles()}><Trash2 size={15} />Clear temporary files</button>
          <span className="settings-hint">{maintenanceMessage || 'Only temporary staging files older than 24 hours are removed.'}</span>
        </div>
      </section>

      <section className="settings-section">
        <div><h2>Developer mode</h2><p>Record a complete local event stream for IPC calls, request inputs and results, timings, jobs, scan stages, renderer console messages, and failures.</p></div>
        <div className="settings-value settings-control-stack">
          <label className="settings-toggle">
            <input type="checkbox" checked={developerMode} onChange={(event) => setDeveloperMode(event.target.checked)} />
            <span><b>{developerMode ? 'Developer logging is on' : 'Developer logging is off'}</b><small>{developerMode ? `${developerLog.entries.length.toLocaleString()} recent events are available below and in the local log file.` : 'Normal operation records no developer event stream.'}</small></span>
          </label>
          <small className="settings-hint">API keys, bearer tokens, credentials, and secret query parameters are redacted before the log reaches disk, the UI, or the clipboard. Other sanitized request and result data is intentionally verbose.</small>
        </div>
      </section>

      {developerMode && (
        <section className="settings-section developer-log-section">
          <div>
            <h2>Developer console</h2>
            <p>Every event is kept as structured JSONL at the path below. The console shows the newest events first while the file retains the rolling history.</p>
          </div>
          <div className="settings-value developer-log-value">
            <div className="developer-log-meta">
              <strong>{developerLog.entries.length.toLocaleString()} events loaded</strong>
              <code>{developerLog.filePath || 'Log path unavailable until the app is ready.'}</code>
            </div>
            <pre className="developer-log-console">{developerLog.entries.slice(-400).map((entry: DeveloperLogEntry) => `${entry.at}  [${entry.level}] [${entry.source}/${entry.event}] ${entry.message}${entry.data === undefined ? '' : ` ${JSON.stringify(entry.data)}`}`).join('\n') || 'Waiting for developer events...'}</pre>
            <div className="developer-log-actions">
              <button className="secondary-button" type="button" disabled={!developerLog.entries.length} onClick={copyDeveloperLog}><FileCode2 size={15} />Copy JSONL events</button>
              <button className="secondary-button" type="button" disabled={!developerLog.entries.length} onClick={clearDeveloperLog}><Trash2 size={15} />Clear log</button>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section">
        <div><h2>Privacy</h2><p>Your workspace does not require an account.</p></div>
        <div className="settings-value settings-fact-list">
          <span>Workspace data stays on this device.</span>
          <span>Cloud review is optional and only used for component analysis.</span>
        </div>
      </section>

      <section className="settings-section settings-section--about">
        <div><h2>About Kryeo</h2></div>
        <div className="settings-value settings-fact-list"><span>Version {version}</span><span>Creative asset workflows with visual intelligence.</span></div>
      </section>
    </div>
  );
}

function Inspector({ status, document, activities, connectors, jobs }: {
  status: AffinityStatus;
  document: DocumentContext;
  activities: ActivityEntry[];
  connectors: ConnectorSnapshot;
  jobs: JobRecord[];
}) {
  const detectedTargets = connectors.connectors.filter((connector) => connector.role === 'production-target' && connector.installed);
  return (
    <div className="inspector-inner">
      <section className="document-inspector">
        <div className="document-preview"><Layers3 size={28} /></div>
        <strong>{document.open ? document.title : 'No active document'}</strong>
        <span>{document.open ? `${document.selectionCount} selected` : status.message}</span>
        {document.open && (
          <div className="document-facts">
            <div><MousePointer2 size={15} /><span>Selection</span><b>{document.selectionCount}</b></div>
            <div><FileCode2 size={15} /><span>Session</span><b>{document.sessionUuid ? document.sessionUuid.slice(0, 8) : 'Local'}</b></div>
          </div>
        )}
      </section>
      <section className="inspector-targets">
        <h3>Production targets</h3>
        {detectedTargets.length === 0 ? <p>No target applications detected.</p> : detectedTargets.map((connector) => (
          <div className="mini-connector" key={connector.id}>
            <ConnectorIcon connector={connector} size={16} />
            <span><b>{connector.name}</b><small>Installed locally; connector not configured</small></span>
          </div>
        ))}
      </section>
      <section className="inspector-activity">
        <h3>Recent activity</h3>
        {jobs.length > 0 ? jobs.map((job) => <div className="mini-activity" key={job.id}>{job.status === 'succeeded' ? <CircleCheck size={15} /> : job.status === 'running' ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}<span><b>{job.title}</b><small>{job.stage}</small></span></div>) : activities.length === 0 ? <p>Run a tool to see it here.</p> : activities.map((entry) => (
          <div className="mini-activity" key={entry.id}>
            {entry.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
            <span><b>{entry.title.replace(/^Asset Library\s*-\s*/i, '')}</b><small>{relativeDate(entry.completedAt)}</small></span>
          </div>
        ))}
      </section>
    </div>
  );
}

const bootSteps = [
  { label: 'Reading asset library', detail: 'Versions and project indexes' },
  { label: 'Detecting applications', detail: 'Creative and production tools' },
  { label: 'Starting connector layer', detail: 'Affinity workflow bridge' },
  { label: 'Opening workspace', detail: 'Pipeline ready' },
];

function BootScreen({ leaving }: { leaving: boolean }) {
  const [phase, setPhase] = useState(0);
  const activeStep = phase >= bootSteps.length
    ? { label: 'Pipeline ready', detail: 'Workspace prepared' }
    : bootSteps[phase];

  useEffect(() => {
    const timers = [1, 2, 3, 4].map((nextPhase) => window.setTimeout(() => setPhase(nextPhase), 440 * nextPhase));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div className={`boot-screen ${leaving ? 'is-leaving' : ''}`} role="status" aria-live="polite" aria-label={`Kryeo is opening. ${activeStep.label}`}>
      <header className="boot-header">
        <div className="boot-brand"><img src={kryeoMark} alt="" /><span>Kryeo</span></div>
      </header>

      <main className="boot-stage">
        <div className={`boot-route boot-route--phase-${phase}`} aria-hidden="true">
          <div className="boot-node boot-node--source">
            <Palette size={28} />
            <strong>Affinity</strong>
          </div>

          <div className="boot-link boot-link--inbound"><i /><i /><i /></div>

          <div className="boot-core">
            <div className="boot-core-frame">
              <span className="boot-corner boot-corner--one" />
              <span className="boot-corner boot-corner--two" />
              <span className="boot-corner boot-corner--three" />
              <span className="boot-corner boot-corner--four" />
              <img src={kryeoMark} alt="" />
              <div className="boot-core-scan" />
            </div>
            <strong>Kryeo core</strong>
            <span>{phase >= 4 ? 'Pipeline ready' : 'Synchronizing'}</span>
          </div>

          <div className="boot-link boot-link--outbound"><i /><i /><i /></div>

          <div className="boot-target-stack">
            <div className="boot-node boot-node--target">
              <LibraryBig size={22} />
              <div><span>Asset library</span><strong>{phase >= 4 ? 'Ready' : 'Preparing'}</strong></div>
            </div>
            <div className="boot-node boot-node--target">
              <Gamepad2 size={22} />
              <div><span>Production target</span><strong>{phase >= 4 ? 'Ready' : 'Standing by'}</strong></div>
            </div>
          </div>
        </div>

        <section className="boot-console">
          <div className="boot-console-lead">
            <strong>{activeStep.label}</strong>
            <small>{activeStep.detail}</small>
          </div>
          <div className="boot-checks">
            {bootSteps.map((step, index) => (
              <div className={`${index < phase ? 'is-complete' : ''} ${index === phase ? 'is-active' : ''}`} key={step.label}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <b>{step.label}</b>
                {index < phase ? <CircleCheck size={15} /> : index === phase ? <LoaderCircle className="spin" size={15} /> : <i />}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="boot-footer">
        <div className="boot-segments" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => <i className={index < Math.min(16, (phase + 1) * 4) ? 'is-filled' : ''} key={index} />)}
        </div>
        <b>{Math.min(100, (phase + 1) * 25)}%</b>
      </footer>
    </div>
  );
}

function CommandPalette({ query, setQuery, tools, assets, onClose, onPage, onTool, onAsset }: {
  query: string;
  setQuery: (value: string) => void;
  tools: KryeoTool[];
  assets: AssetRecord[];
  onClose: () => void;
  onPage: (page: Page) => void;
  onTool: (tool: KryeoTool) => void;
  onAsset: (asset: AssetRecord) => void;
}) {
  const needle = query.trim().toLowerCase();
  const pages: Array<[Page, string]> = [['home', 'Pipeline'], ['assistant', 'Assistant'], ['learning', 'Learning'], ['connectors', 'Connectors'], ['tools', 'Workflows'], ['import', 'Scan & export'], ['assets', 'Assets'], ['activity', 'Activity'], ['settings', 'Settings']];
  const visiblePages = pages.filter(([, label]) => !needle || label.toLowerCase().includes(needle));
  const visibleTools = tools.filter((tool) => !needle || `${tool.displayName} ${tool.description}`.toLowerCase().includes(needle)).slice(0, 6);
  const visibleAssets = assets.filter((asset) => !needle || `${asset.displayName} ${asset.codeName} ${asset.project}`.toLowerCase().includes(needle)).slice(0, 6);
  return <div className="command-overlay" onMouseDown={onClose}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}><div className="command-search"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go anywhere, run a workflow, open an asset" aria-label="Search commands, workflows, and assets" /><kbd>Esc</kbd></div><div className="command-results">{visiblePages.length > 0 && <section><h3>Navigate</h3>{visiblePages.map(([id, label]) => <button onClick={() => onPage(id)} key={id}><LayoutDashboard size={16} /><span>{label}</span><ChevronRight size={14} /></button>)}</section>}{visibleTools.length > 0 && <section><h3>Workflows</h3>{visibleTools.map((tool) => <button onClick={() => onTool(tool)} key={tool.id}><ToolIcon tool={tool} size={16} /><span>{tool.displayName}</span><small>{tool.category}</small></button>)}</section>}{visibleAssets.length > 0 && <section><h3>Assets</h3>{visibleAssets.map((asset) => <button onClick={() => onAsset(asset)} key={asset.id}><Box size={16} /><span>{asset.displayName || asset.name}</span><small>{asset.project}</small></button>)}</section>}</div></div></div>;
}

export default App;
