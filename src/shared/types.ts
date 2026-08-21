export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface AffinityStatus {
  state: ConnectionState;
  message: string;
  serverUrl: string;
  checkedAt: string;
}

export interface DocumentContext {
  open: boolean;
  title: string;
  path: string;
  selectionCount: number;
  selectionNames: string[];
  sessionUuid: string;
}

export type ToolCategory = 'Assets' | 'Pixel tools' | 'Symmetry' | 'Utilities';

export interface KryeoTool {
  id: string;
  title: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  version: string;
  icon: 'save' | 'folder-open' | 'refresh' | 'package' | 'wand' | 'symmetry' | 'script';
  featured: boolean;
}

export interface ScriptRunResult {
  ok: boolean;
  title: string;
  output: string;
  startedAt: string;
  completedAt: string;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface JobRecord {
  id: string;
  operation: 'tool' | 'open' | 'save' | 'configured' | 'place' | 'delivery' | 'cleanup';
  title: string;
  status: JobStatus;
  progress: number;
  stage: string;
  payload: unknown;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  output: string;
  cancelRequested: boolean;
}

export interface WorkflowPreset {
  id: string;
  kind: ConfiguredToolKind;
  name: string;
  values: Record<string, string | number | boolean>;
  updatedAt: string;
}

export interface PlacementLink {
  id: string;
  assetId: string;
  assetPath: string;
  displayName: string;
  version: number;
  layerKind: PlaceAssetRequest['layerKind'];
  targetDocument: string;
  targetSessionUuid: string;
  placedAt: string;
}

export interface AssetPreference {
  assetId: string;
  favourite: boolean;
  collections: string[];
}

export type RobloxUiRole = 'Unknown' | 'ImageButton' | 'ImageLabel' | 'Frame' | 'TextButton' | 'TextLabel' | 'TextBox';
export type ComponentAssetType = 'Unknown' | 'Frame' | 'Button' | 'Icon' | 'Panel' | 'Slot' | 'Bar' | 'Badge' | 'Label' | 'Text' | 'TextBox' | 'ScrollBar' | 'Divider' | 'Background' | 'Wallpaper' | 'Texture' | 'Overlay' | 'Cursor' | 'Tooltip' | 'Modal' | 'Input' | 'Tab' | 'Tile' | 'Ornament' | 'Border' | 'Corner' | 'Edge' | 'Fill' | 'FX';
export type ComponentScanScope = 'document' | 'selection';
export type ComponentScanMode = 'smart' | 'group-first' | 'layer-inclusive';
export type ComponentDiveMode = 'keep-together' | 'children-only' | 'parent-and-children';
/**
 * Structural ownership is decided before semantic classification. It answers
 * which rendered node is a real export decision, without inventing a name or
 * type from document-specific hierarchy text.
 */
export type ComponentAssetBoundary = 'standalone' | 'composed-parent' | 'construction-child' | 'organizational-parent' | 'duplicate-representation';
export type ComponentAnalysisSource = 'approved-family' | 'hosted-family' | 'local-provisional' | 'unavailable';
export type ComponentAnalysisState = 'approved' | 'analyzed' | 'provisional' | 'needs-review' | 'queued';
export type ComponentReviewPriority = 'ready' | 'check' | 'critical';
export type ComponentDecisionStatus = 'generated' | 'accepted' | 'corrected';

export interface ComponentDecision {
  visualHash: string;
  familyFingerprint?: string;
  familyMemberHashes?: string[];
  memberNames?: Array<{ visualHash: string; name: string }>;
  project?: string;
  scope?: 'project' | 'library' | 'global';
  approved?: boolean;
  /** Generated results are cache only; accepted/corrected results may influence future scans. */
  decisionStatus?: ComponentDecisionStatus;
  analysisSource?: ComponentAnalysisSource;
  role: RobloxUiRole;
  assetType?: ComponentAssetType;
  /** Canonical AI-owned asset identity. */
  familyName: string;
  /** Legacy mirror of familyName, kept for existing workspace data. */
  layerLabel?: string;
  /** Legacy mirror of familyName, used by manifests and export organization. */
  exportName?: string;
  codeName?: string;
  semanticHint?: string;
  suggestedName?: string;
  suggestedType?: ComponentAssetType;
  suggestedRole?: RobloxUiRole;
  correctionCount?: number;
  embedding?: string;
  diveMode?: ComponentDiveMode;
  diveDecisions?: Array<{ signature: string; mode: ComponentDiveMode }>;
  documentTitle?: string;
  provenance?: {
    source: 'scan-review' | 'learning-editor' | 'assistant';
    originalName?: string;
    originalType?: ComponentAssetType;
    originalRole?: RobloxUiRole;
  };
  /** Generalized evidence from a user correction; never stores artwork-specific rules. */
  learningContext?: {
    visualStructureType?: ComponentAssetType;
    sourceTypeHint?: ComponentAssetType;
    hierarchyKind: 'standalone' | 'composed-parent' | 'construction-child';
  };
  influenceCount?: number;
  lastInfluencedAt?: string;
  confidenceSamples?: number;
  confidenceCorrect?: number;
  updatedAt: string;
}

export interface ComponentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentVisualMetrics {
  visiblePixelRatio: number;
  opaquePixelRatio: number;
  meanAlpha: number;
  edgeVisibleRatio: number;
  centerVisibleRatio: number;
  /** Visible density inside the middle of the artwork's own occupied bounds. */
  innerVisibleRatio?: number;
  /** Visible density in a perimeter band relative to occupied bounds, ignoring transparent canvas padding. */
  contentPerimeterVisibleRatio?: number;
  /** Average top/right/bottom/left coverage of that occupied-bounds perimeter. */
  contentPerimeterCoverage?: number;
}

export interface ComponentMember {
  path: number[];
  name: string;
  affinityType: string;
  bounds: ComponentBounds;
}

export interface ComponentCandidate {
  id: string;
  name: string;
  affinityType: string;
  bounds: ComponentBounds;
  childCount: number;
  descendantCount: number;
  textCount: number;
  previewUrl: string;
  hostedPreviewUrl?: string;
  analysisPreviewUrls?: string[];
  visualMetrics?: ComponentVisualMetrics;
  visualHash: string;
  /** Rendered-pixel identity retained when a structural fallback needs its own analysis hash. */
  renderHash?: string;
  duplicateFamily: string;
  duplicateCount: number;
  /** Legacy semantic family identity returned by analysis. */
  familyName: string;
  /** Readable label for the Affinity/document hierarchy. */
  layerLabel?: string;
  /** Production name used only when this node is exported as an asset. */
  exportName?: string;
  /** Deterministic snake_case identity used by files, manifests, and Roblox handoff. */
  codeName?: string;
  /** Whether the current hierarchy policy exports this node itself. */
  exportTarget?: boolean;
  /** Structural relationship to the export decision selected for this node. */
  assetBoundary?: ComponentAssetBoundary;
  /** Hierarchy key of the owning export node when this node is not standalone. */
  boundaryOwnerHierarchyKey?: string;
  /** Context-scoped identity used to prevent global pixel hashes from smearing decisions across a document. */
  decisionScopeKey?: string;
  /** Boundary plan captured before semantic AI classification; only an explicit user grouping edit may replace it. */
  structuralDiveMode?: ComponentDiveMode;
  /** Human-readable structural explanation; never used as naming evidence. */
  boundaryReason?: string;
  /** Short explanation of how the structural/export names were derived. */
  namingReason?: string;
  /** Contract violations that require an exception instead of silent automation. */
  namingIssues?: string[];
  robloxClassReason?: string;
  automationState?: 'ready' | 'exception';
  automationIssues?: string[];
  suggestedRole: RobloxUiRole;
  role: RobloxUiRole;
  assetType: ComponentAssetType;
  remembered: boolean;
  members: ComponentMember[];
  grouping: 'single' | 'existing-group' | 'overlap';
  hierarchyKey: string;
  parentHierarchyKey: string;
  hierarchyDepth: number;
  childHierarchyKeys: string[];
  diveMode: ComponentDiveMode;
  diveRemembered?: boolean;
  learnedDiveMode?: ComponentDiveMode;
  recommendedDiveMode: ComponentDiveMode;
  diveConfidence: number;
  diveReasons: string[];
  diveConflict?: boolean;
  diveConflictMessage?: string;
  diveStructureSignature?: string;
  learnedDiveDecisions?: Array<{ signature: string; mode: ComponentDiveMode }>;
  visualEmbedding?: string;
  learnedFrom?: number;
  nearestLearnedSimilarity?: number;
  similarityFamily: string;
  similarCount: number;
  duplicateKind: 'unique' | 'exact' | 'similar';
  keptInsideParent?: boolean;
  aiSuggestedName?: string;
  aiSuggestedRole?: RobloxUiRole;
  aiSuggestedType?: ComponentAssetType;
  aiModelSuggestedName?: string;
  aiModelSuggestedType?: ComponentAssetType;
  aiNormalizationReason?: string;
  aiEvidenceSupportsClassification?: boolean;
  aiEvidenceSuggestedName?: string;
  aiEvidenceSuggestedType?: ComponentAssetType;
  aiEvidenceSuggestedRole?: RobloxUiRole;
  aiConfidence?: number;
  aiMargin?: number;
  aiAlternatives?: Array<{ assetType: ComponentAssetType; score: number }>;
  aiEvidence?: {
    visual: number;
    layerName: number;
    hierarchy: number;
    learned: number;
  };
  aiSource?: 'model' | 'memory' | 'name';
  aiReason?: string;
  semanticHint?: string;
  semanticType?: ComponentAssetType;
  visualStructureType?: ComponentAssetType;
  visualStructureConfidence?: number;
  semanticConflict?: boolean;
  semanticConflictMessage?: string;
  reviewCategory?: 'ui' | 'construction' | 'background';
  nameSource?: 'visual' | 'layer-name' | 'both' | 'memory';
  familyFingerprint?: string;
  familyMemberHashes?: string[];
  analysisSource?: ComponentAnalysisSource;
  analysisState?: ComponentAnalysisState;
  analysisReason?: string;
  analysisAlternatives?: Array<{ assetType: ComponentAssetType; reason: string }>;
  reviewPriority?: ComponentReviewPriority;
  reviewReasons?: string[];
}

export interface LocalAiStatus {
  available: boolean;
  model: string;
  endpoint: string;
  message: string;
  provider?: 'embedded';
}

export interface ComponentAiSuggestion {
  visualHash: string;
  name: string;
  assetType: ComponentAssetType;
  role: RobloxUiRole;
  confidence: number;
  margin?: number;
  source: 'model' | 'memory' | 'name';
  reason: string;
  alternatives?: Array<{ assetType: ComponentAssetType; score: number }>;
  classifierType?: ComponentAssetType;
  classifierConfidence?: number;
  prototypeType?: ComponentAssetType;
  prototypeConfidence?: number;
  inferencePath?: 'compact-classifier' | 'prototype-fallback' | 'baseline-taxonomy' | 'user-memory';
  embedding?: string;
  learnedFrom?: number;
  nearestLearnedSimilarity?: number;
  learnedDiveMode?: ComponentDiveMode;
  semanticHint?: string;
  visualStructureType?: ComponentAssetType;
  visualStructureConfidence?: number;
  semanticType?: ComponentAssetType;
  semanticConflict?: boolean;
  semanticConflictMessage?: string;
  reviewCategory: 'ui' | 'construction' | 'background';
  nameSource: 'visual' | 'layer-name' | 'both' | 'memory';
}

export interface ComponentFamilyMember {
  id: string;
  visualHash: string;
  name: string;
  affinityType: string;
  bounds: ComponentBounds;
  hierarchyKey: string;
  parentHierarchyKey: string;
  childHierarchyKeys: string[];
  previewUrl: string;
  hostedPreviewUrl?: string;
  analysisPreviewUrls: string[];
  visualMetrics?: ComponentVisualMetrics;
}

export interface ComponentVisualFamily {
  id: string;
  fingerprint: string;
  project: string;
  documentTitle: string;
  /** Opaque structural scope used to plan related visual names together. */
  namingScopeKey?: string;
  /** Decision scope prevents visually identical nodes in different hierarchy roles from sharing one semantic packet. */
  decisionScopeKey?: string;
  /** Whether this family is a standalone asset or an editable composed parent. */
  assetBoundary?: ComponentAssetBoundary;
  /**
   * Hierarchy planning is fixed before visual semantics are requested. The
   * model reports this value as part of its atomic packet but cannot silently
   * turn a parent into loose children (or the reverse) during naming.
   */
  structuralDiveMode?: ComponentDiveMode;
  /** One-based document order among export-capable siblings in the immediate scope. */
  siblingOrdinal?: number;
  /** Number of export-capable siblings in the immediate scope. */
  siblingCount?: number;
  /** Supporting direct-child visuals for a composed parent; never receive this family's semantic decision. */
  contextMembers?: ComponentFamilyMember[];
  parentNames: string[];
  members: ComponentFamilyMember[];
  representativeHash: string;
  exactInstanceCount: number;
  hierarchyContext?: Array<{
    hierarchyKey: string;
    parentName: string;
    ancestorNames: string[];
    childNames: string[];
    siblingNames: string[];
  }>;
  reviewSignals?: ComponentFamilyReviewSignals;
  approvedDecision?: ComponentDecision;
}

export interface ComponentFamilyReviewSignals {
  localConfidence: number;
  localMargin: number;
  visualStructureConfidence: number;
  semanticConflict: boolean;
  meaningfulLayerName: boolean;
  hierarchyAmbiguity: number;
  learnedSimilarity: number;
  learnedFrom: number;
  localTypeAgreement: number;
  localAssetType?: ComponentAssetType;
  localRole?: RobloxUiRole;
}

export type HostedReviewTier = 'lite' | 'escalation';

export interface HostedFamilyReviewPlan {
  tier: 'local' | HostedReviewTier;
  riskScore: number;
  reasons: string[];
}

export interface HostedFamilyAnalysis {
  familyId: string;
  fingerprint: string;
  familyName: string;
  assetType: ComponentAssetType;
  role: RobloxUiRole;
  modelFamilyName?: string;
  modelAssetType?: ComponentAssetType;
  normalizationReason?: string;
  memberNames: Array<{ visualHash: string; name: string }>;
  diveMode: ComponentDiveMode;
  reason: string;
  visualDescription?: string;
  confidence?: number;
  evidence?: {
    visual: number;
    layerName: number;
    hierarchy: number;
    learned: number;
  };
  conflict?: boolean;
  conflictMessage?: string;
  reviewNeeded: boolean;
  alternatives: Array<{ assetType: ComponentAssetType; reason: string }>;
}

export interface HostedFamilyAnalysisRequest {
  project: string;
  documentTitle: string;
  documentSessionUuid: string;
  families: ComponentVisualFamily[];
  documentPreviewUrl?: string;
  instructions?: string[];
  projectKnowledge?: ProjectKnowledge;
  reviewTier?: HostedReviewTier;
  includeDocumentContext?: boolean;
  maxMemberImages?: number;
  hostedScanId?: string;
  /** Stable desktop-to-gateway correlation for one scan or evidence request. */
  correlationId?: string;
  serviceTier?: 'default' | 'flex' | 'priority' | 'scale';
}

export interface HostedFamilyBatchReviewRequest extends HostedFamilyAnalysisRequest {
  currentAnalyses: HostedFamilyAnalysis[];
  challengeReasons: Record<string, string[]>;
}

export interface HostedFamilyEvidenceRequest {
  hostedScanId?: string;
  correlationId?: string;
  challengeReasons?: string[];
  peerDecisionNames?: string[];
  siblingOrdinal?: number;
  siblingCount?: number;
  familyFingerprint?: string;
  visualHash: string;
  familyName: string;
  assetType: ComponentAssetType;
  role: RobloxUiRole;
  sourceName: string;
  affinityType: string;
  bounds: ComponentBounds;
  previewUrl: string;
  visualMetrics?: ComponentVisualMetrics;
  parentName?: string;
  childNames?: string[];
  siblingNames?: string[];
}

export interface HostedFamilyEvidenceResult {
  reason: string;
  visualDescription: string;
  confidence: number;
  evidence: {
    visual: number;
    layerName: number;
    hierarchy: number;
    learned: number;
  };
  conflict: boolean;
  conflictMessage: string;
  supportsClassification: boolean;
  suggestedName?: string;
  suggestedType?: ComponentAssetType;
  suggestedRole?: RobloxUiRole;
  alternatives: Array<{ assetType: ComponentAssetType; reason: string }>;
  cached: boolean;
  scanProviderCostUsd?: number;
  scanProviderRequests?: number;
}

export interface HostedAiUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd?: number;
  providerCostUsd?: number;
  coalescedRequests?: number;
  contextCacheHits?: number;
  sharedCacheHits?: number;
  explanationCacheHits?: number;
  serviceTiers?: Record<string, number>;
  byModel?: Record<string, Omit<HostedAiUsage, 'byModel'>>;
}

export interface HostedFamilyAnalysisResponse {
  requestId: string;
  cached: number;
  analyses: HostedFamilyAnalysis[];
  failures: Array<{ familyIds: string[]; message: string }>;
  model?: string;
  reviewTier?: HostedReviewTier;
  skippedFamilyIds?: string[];
  budgetLimited?: boolean;
  estimatedCostUsd?: number;
  scanProviderCostUsd?: number;
  scanCommittedCostUsd?: number;
  scanProviderRequests?: number;
  usage?: HostedAiUsage;
  diagnostics?: HostedAnalysisDiagnostics;
}

export interface HostedProviderCallDiagnostic {
  requestId?: string;
  model?: string;
  transport?: string;
  attempts: number;
  httpStatuses: number[];
  requestBytes?: number;
  responseBytes?: number;
  durationMs?: number;
  parsed?: boolean;
  error?: string;
}

export interface HostedAnalysisDiagnostics {
  correlationId?: string;
  requestId?: string;
  route?: string;
  reviewTier?: HostedReviewTier;
  requestedFamilies?: number;
  cachedFamilies?: number;
  analyzedFamilies?: number;
  incompleteFamilies?: string[];
  providerCalls?: HostedProviderCallDiagnostic[];
  recovery?: Record<string, number>;
}

export interface DocumentReconciliationIssue {
  familyId: string;
  message: string;
  suggestedType?: ComponentAssetType;
  suggestedRole?: RobloxUiRole;
  suggestedName?: string;
}

export interface DocumentReconciliation {
  summary: string;
  issues: DocumentReconciliationIssue[];
}

export interface HostedAiStatus {
  available: boolean;
  configured: boolean;
  endpoint: string;
  model: string;
  provider?: string;
  modelApiKeyConfigured?: boolean;
  queueDepth: number;
  modelActive?: number;
  modelQueued?: number;
  modelConcurrency?: number;
  maxMemberImagesPerFamily?: number;
  modelLite?: string;
  modelEscalation?: string;
  providerSort?: string;
  serviceTier?: string;
  responseCacheEnabled?: boolean;
  promptCacheEnabled?: boolean;
  analysisVersion?: string;
  cacheEntries?: number;
  maxCacheEntries?: number;
  cacheEvictions?: number;
  familyBatchSize?: number;
  scanTargetUsd?: number;
  scanBudgetUsd?: number;
  scanBudgetEnforced?: boolean;
  maxHostedFamiliesPerScan?: number;
  maxEscalationFamiliesPerScan?: number;
  estimatedInputTokensPerImage?: number;
  estimatedTextTokensPerFamily?: number;
  estimatedOutputTokensPerFamily?: number;
  liteInputPricePerMillion?: number;
  liteOutputPricePerMillion?: number;
  escalationInputPricePerMillion?: number;
  escalationOutputPricePerMillion?: number;
  costEstimateSafetyFactor?: number;
  maxModelRetries?: number;
  usage?: HostedAiUsage;
  activeRequests?: number;
  maxInflightPerToken?: number;
  message: string;
}

export type ComponentScanPhase =
  | 'preparing'
  | 'capturing-context'
  | 'discovering-layers'
  | 'local-analysis'
  | 'hosted-analysis'
  | 'reconciliation'
  | 'finalizing'
  | 'complete';

export interface ComponentScanProgress {
  phase: ComponentScanPhase;
  label: string;
  detail: string;
  progress: number;
  completedFamilies?: number;
  totalFamilies?: number;
  cachedFamilies?: number;
  failedFamilies?: number;
  localFamilies?: number;
  hostedFamilies?: number;
  budgetLimitedFamilies?: number;
  partialResult?: ComponentScanResult;
  trace?: ComponentScanTraceEntry;
}

/** Opt-in diagnostic record. It never contains image bytes, prompts, or API keys. */
export interface ComponentScanTraceEntry {
  at: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
}

export type DeveloperLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DeveloperLogEntry {
  id: string;
  at: string;
  level: DeveloperLogLevel;
  source: string;
  event: string;
  message: string;
  correlationId?: string;
  data?: unknown;
}

export interface DeveloperLogSnapshot {
  enabled: boolean;
  entries: DeveloperLogEntry[];
  totalEntries: number;
  filePath: string;
  fileBytes?: number;
  maxFileBytes?: number;
}

export interface ScanIntentAnswer {
  id: 'ungrouped-layers' | 'repeated-children' | 'document-purpose';
  value: string;
}

/** A compact, user-confirmed interpretation of how this Affinity document becomes assets. */
export interface ScanIntentProfile {
  id: string;
  project: string;
  documentTitle: string;
  structureFingerprint: string;
  mode: ComponentScanMode;
  answers: ScanIntentAnswer[];
  updatedAt: string;
}

export interface ComponentScanRequest {
  scope?: ComponentScanScope;
  intent?: Pick<ScanIntentProfile, 'mode' | 'answers'>;
  /** Enables local, verbose scan tracing for troubleshooting. */
  developerMode?: boolean;
}

export interface HostedAiConfiguration {
  endpoint: string;
  token: string;
}

export interface ComponentManifestNode {
  id: string;
  parentId: string;
  familyName: string;
  layerLabel?: string;
  exportName?: string;
  codeName?: string;
  assetType: ComponentAssetType;
  category: string;
  subcategory: string;
  robloxRole: RobloxUiRole;
  visualHash: string;
  similarityFamily: string;
  duplicateKind: ComponentCandidate['duplicateKind'];
  diveMode: ComponentDiveMode;
  included: boolean;
  sourcePaths: number[][];
}

export interface ComponentHierarchyManifest {
  id: string;
  documentTitle: string;
  documentSessionUuid: string;
  createdAt: string;
  path: string;
  scanIntent?: Pick<ScanIntentProfile, 'mode' | 'answers' | 'structureFingerprint'>;
  nodes: ComponentManifestNode[];
}

export interface SaveComponentReviewRequest {
  project?: string;
  documentTitle: string;
  documentSessionUuid: string;
  components: ComponentCandidate[];
  includedIds: string[];
  decisionStatus?: ComponentDecisionStatus;
  scanIntent?: Pick<ScanIntentProfile, 'mode' | 'answers' | 'structureFingerprint'>;
}

export interface CreateComponentAssetsRequest extends SaveComponentReviewRequest {
  structureFingerprint: string;
}

export interface ApplyComponentOrganizationRequest {
  documentSessionUuid: string;
  components: Array<{
    name: string;
    memberPaths: number[][];
  }>;
}

export interface ApplyLayerNamesRequest {
  documentSessionUuid: string;
  layers: Array<{
    name: string;
    path: number[];
  }>;
}

export interface ComponentScanDiagnostics {
  correlationId?: string;
  totalMs: number;
  stages: {
    contextCaptureMs: number;
    affinityExportMs: number;
    imagePreparationMs: number;
    localAnalysisMs: number;
    hostedAnalysisMs: number;
    finalizationMs: number;
  };
  visualFamilyCount: number;
  hostedFamilyCount: number;
  hostedRequestCount: number;
  providerRequestCount: number;
  affinityRequestCount: number;
  affinityRetryCount: number;
  affinitySplitCount: number;
  affinitySlowestRequestMs: number;
  cachedFamilyCount: number;
  failedFamilyCount: number;
  budgetLimitedFamilyCount: number;
  failureMessages: string[];
  notes: string[];
  warnings: string[];
  trace?: ComponentScanTraceEntry[];
}

export interface ComponentScanResult {
  documentTitle: string;
  documentSessionUuid: string;
  sourceName: string;
  scannedAt: string;
  components: ComponentCandidate[];
  uniqueVisuals: number;
  duplicateFamilies: number;
  reusedInstances: number;
  reconciliation?: DocumentReconciliation;
  hostedAnalysisAvailable?: boolean;
  hostedAnalysisError?: string;
  hostedProviderCostUsd?: number;
  hostedTargetUsd?: number;
  hostedBudgetUsd?: number;
  scanIntent?: Pick<ScanIntentProfile, 'mode' | 'answers' | 'structureFingerprint'>;
  diagnostics?: ComponentScanDiagnostics;
}

export interface WorkspaceSnapshot {
  jobs: JobRecord[];
  presets: WorkflowPreset[];
  links: PlacementLink[];
  preferences: AssetPreference[];
  componentDecisions: ComponentDecision[];
  componentManifests: ComponentHierarchyManifest[];
  scanIntentProfiles: ScanIntentProfile[];
  assistantMemories: AssistantMemory[];
  assistantSessions: AssistantSession[];
  assistantMessages: AssistantMessage[];
  projectKnowledge: ProjectKnowledge[];
  updatedAt: string;
}

export interface ProjectNote {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectKnowledge {
  project: string;
  notes: ProjectNote[];
  metadata: {
    brushes?: string[];
    colors?: Record<string, string>;
    design?: Record<string, string>;
    [key: string]: unknown;
  };
  updatedAt: string;
}

export interface SaveProjectNoteRequest {
  project: string;
  text: string;
  tags: string[];
  id?: string;
}

export interface AssistantMemory {
  id: string;
  project: string;
  scope?: 'project' | 'global';
  kind: 'instruction' | 'naming' | 'hierarchy' | 'classification';
  text: string;
  documentTitle?: string;
  createdAt: string;
}

export interface AssistantSession {
  id: string;
  project: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: string;
  project: string;
  sessionId?: string;
  role: 'user' | 'assistant';
  text: string;
  visionUsed?: boolean;
  createdAt: string;
}

export interface AssistantStatus {
  installed: boolean;
  ready: boolean;
  loading: boolean;
  model: string;
  message: string;
  progress: number;
  stage: string;
  vision: boolean;
  toolCalling: boolean;
  profile: 'compatibility' | 'balanced' | 'enhanced';
  memoryGB: number;
  modelPack: 'portable' | 'balanced';
  recommendedProfile: 'compatibility' | 'balanced' | 'enhanced';
  availableModelPacks?: Array<{
    id: 'portable' | 'balanced';
    name: string;
    installed: boolean;
    recommended: boolean;
    description: string;
  }>;
}

export interface AssistantAction {
  id: string;
  type: 'open-component-scan' | 'review-assets' | 'open-workflows';
  label: string;
  description: string;
}

export interface AssistantChatRequest {
  project: string;
  sessionId: string;
  message: string;
  document: DocumentContext;
  useVision?: boolean;
}

export interface AssistantChatResponse {
  message: AssistantMessage;
  memories: AssistantMemory[];
  actions: AssistantAction[];
  visionUsed: boolean;
  workspace: WorkspaceSnapshot;
}

export interface UpdateAssistantSessionRequest {
  id: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface SaveAssetRequest {
  displayName: string;
  codeName: string;
  project: string;
  category: string;
  subcategory: string;
  tags: string;
  notes: string;
  batch: boolean;
  update: boolean;
  baseCopy: boolean;
  rasterCopy: boolean;
}

export type ConfiguredToolKind = 'export' | 'update' | 'shade';

export interface ConfiguredToolRequest {
  kind: ConfiguredToolKind;
  title: string;
  values: Record<string, string | number | boolean>;
}

export interface PlaceAssetRequest {
  path: string;
  displayName: string;
  layerKind: 'master' | 'base' | 'raster';
  targetSessionUuid: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  displayName: string;
  codeName: string;
  project: string;
  category: string;
  subcategory: string;
  tags: string[];
  version: number;
  fileName: string;
  path: string;
  updatedAt: string;
  notes: string;
  previewUrl?: string;
  previewPath?: string;
  health?: 'ready' | 'missing-source' | 'missing-export' | 'export-outdated';
  healthMessage?: string;
  metadata?: {
    rootCount?: number;
    nodeCount?: number;
    hasLiveFilters?: boolean;
    hasAdjustments?: boolean;
    robloxClass?: RobloxUiRole;
    sourcePaths?: number[][];
    bounds?: ComponentBounds;
  };
}

export interface AssetLibrarySnapshot {
  available: boolean;
  root: string;
  assets: AssetRecord[];
  totalVersions: number;
  projects: string[];
  categories: string[];
  updatedAt: string;
  message: string;
  versions: AssetRecord[];
  duplicateCodeNames: string[];
  unhealthyCount: number;
}

export interface DeliveryResult {
  ok: boolean;
  target: 'roblox';
  path: string;
  assetCount: number;
  message: string;
}

export interface LibraryLogs {
  run: string;
  error: string;
  root: string;
}

export type ConnectorId = 'affinity' | 'photoshop' | 'roblox-studio';
export type ConnectorRole = 'creative-source' | 'production-target' | 'both';
export type ConnectorState = 'connected' | 'detected' | 'planned' | 'missing' | 'error';

export interface KryeoConnector {
  id: ConnectorId;
  name: string;
  description: string;
  role: ConnectorRole;
  state: ConnectorState;
  installed: boolean;
  configured: boolean;
  availableNow: boolean;
  installationPath: string;
  capabilities: string[];
  message: string;
}

export interface PipelineRoute {
  id: string;
  source: ConnectorId;
  target: ConnectorId | 'kryeo-library';
  direction: 'import' | 'export' | 'sync';
  state: 'active' | 'detected' | 'planned';
  label: string;
}

export interface ConnectorSnapshot {
  connectors: KryeoConnector[];
  routes: PipelineRoute[];
  scannedAt: string;
  machineName: string;
}

export interface KryeoApi {
  getStatus(): Promise<AffinityStatus>;
  reconnect(): Promise<AffinityStatus>;
  getDocumentContext(): Promise<DocumentContext>;
  listTools(): Promise<KryeoTool[]>;
  runTool(title: string): Promise<ScriptRunResult>;
  openAsset(path: string, displayName: string): Promise<ScriptRunResult>;
  saveAsset(request: SaveAssetRequest): Promise<ScriptRunResult>;
  runConfiguredTool(request: ConfiguredToolRequest): Promise<ScriptRunResult>;
  placeAsset(request: PlaceAssetRequest): Promise<ScriptRunResult>;
  getAssetLibrary(): Promise<AssetLibrarySnapshot>;
  getLibraryLogs(): Promise<LibraryLogs>;
  revealPath(path: string): Promise<boolean>;
  getConnectors(): Promise<ConnectorSnapshot>;
  refreshConnectors(): Promise<ConnectorSnapshot>;
  getWorkspace(): Promise<WorkspaceSnapshot>;
  setDeveloperMode(enabled: boolean): Promise<DeveloperLogSnapshot>;
  getDeveloperLog(): Promise<DeveloperLogSnapshot>;
  clearDeveloperLog(): Promise<DeveloperLogSnapshot>;
  setDeveloperLogStreaming(enabled: boolean): void;
  onDeveloperLog(listener: (entries: DeveloperLogEntry[]) => void): () => void;
  cancelJob(id: string): Promise<boolean>;
  savePreset(preset: Omit<WorkflowPreset, 'id' | 'updatedAt'> & { id?: string }): Promise<WorkspaceSnapshot>;
  deletePreset(id: string): Promise<WorkspaceSnapshot>;
  setAssetPreference(preference: AssetPreference): Promise<WorkspaceSnapshot>;
  deliverProject(project: string, target: 'roblox'): Promise<DeliveryResult>;
  cleanupStaging(): Promise<ScriptRunResult>;
  scanComponents(request?: ComponentScanScope | ComponentScanRequest): Promise<ComponentScanResult>;
  cancelComponentScan(): Promise<boolean>;
  onComponentScanProgress(listener: (progress: ComponentScanProgress) => void): () => void;
  getLocalAiStatus(): Promise<LocalAiStatus>;
  getHostedAiStatus(): Promise<HostedAiStatus>;
  configureHostedAi(configuration: HostedAiConfiguration): Promise<HostedAiStatus>;
  explainComponentFamily(request: HostedFamilyEvidenceRequest): Promise<HostedFamilyEvidenceResult>;
  analyzeComponents(components: ComponentCandidate[]): Promise<ComponentAiSuggestion[]>;
  applyComponentOrganization(request: ApplyComponentOrganizationRequest): Promise<ScriptRunResult>;
  applyLayerNames(request: ApplyLayerNamesRequest): Promise<ScriptRunResult>;
  saveComponentDecisions(decisions: Array<Omit<ComponentDecision, 'updatedAt'>>): Promise<WorkspaceSnapshot>;
  forgetComponentDecision(visualHash: string): Promise<WorkspaceSnapshot>;
  setComponentDecisionScope(visualHash: string, scope: 'project' | 'global'): Promise<WorkspaceSnapshot>;
  clearComponentDecisions(): Promise<WorkspaceSnapshot>;
  saveComponentReview(request: SaveComponentReviewRequest): Promise<WorkspaceSnapshot>;
  createComponentAssets(request: CreateComponentAssetsRequest): Promise<ScriptRunResult>;
  saveScanIntentProfile(profile: Omit<ScanIntentProfile, 'id' | 'updatedAt'> & { id?: string }): Promise<WorkspaceSnapshot>;
  getAssistantStatus(): Promise<AssistantStatus>;
  installAssistant(modelPack?: 'portable' | 'balanced'): Promise<AssistantStatus>;
  chatWithAssistant(request: AssistantChatRequest): Promise<AssistantChatResponse>;
  forgetAssistantMemory(id: string): Promise<WorkspaceSnapshot>;
  clearAssistantMemories(): Promise<WorkspaceSnapshot>;
  setAssistantMemoryScope(id: string, scope: 'project' | 'global', project: string): Promise<WorkspaceSnapshot>;
  createAssistantSession(project: string): Promise<WorkspaceSnapshot>;
  updateAssistantSession(request: UpdateAssistantSessionRequest): Promise<WorkspaceSnapshot>;
  deleteAssistantSession(id: string): Promise<WorkspaceSnapshot>;
  exportAssistantSession(id: string): Promise<boolean>;
  importAssistantSession(project: string): Promise<WorkspaceSnapshot>;
  saveProjectNote(request: SaveProjectNoteRequest): Promise<WorkspaceSnapshot>;
  deleteProjectNote(project: string, id: string): Promise<WorkspaceSnapshot>;
  exportProjectKnowledge(project: string): Promise<boolean>;
  importProjectKnowledge(project: string): Promise<WorkspaceSnapshot>;
}
