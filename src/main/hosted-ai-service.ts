import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';
import type {
  AssistantAction,
  AssistantChatRequest,
  AssistantMemory,
  ComponentVisualFamily,
  DocumentReconciliation,
  HostedAiConfiguration,
  HostedAiStatus,
  HostedFamilyAnalysisRequest,
  HostedFamilyAnalysisResponse,
  HostedFamilyBatchReviewRequest,
  HostedFamilyEvidenceRequest,
  HostedFamilyEvidenceResult,
  WorkspaceSnapshot,
} from '../shared/types';
import type { AssistantVisualContext } from './assistant-service';

const confidenceScoreSchema = z.preprocess(
  (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0),
  z.number().min(0).max(1),
);

const hostedUsageSchema = z.object({
  requests: z.number().int().nonnegative().default(0),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().optional(),
  providerCostUsd: z.number().nonnegative().optional(),
}).passthrough();

const hostedProviderCallDiagnosticSchema = z.object({
  requestId: z.string().optional(),
  model: z.string().optional(),
  transport: z.string().optional(),
  attempts: z.number().int().nonnegative(),
  httpStatuses: z.array(z.number().int().nonnegative()),
  requestBytes: z.number().int().nonnegative().optional(),
  responseBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  parsed: z.boolean().optional(),
  error: z.string().optional(),
}).passthrough();

const hostedDiagnosticsSchema = z.object({
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
  route: z.string().optional(),
  reviewTier: z.enum(['lite', 'escalation']).optional(),
  requestedFamilies: z.number().int().nonnegative().optional(),
  cachedFamilies: z.number().int().nonnegative().optional(),
  analyzedFamilies: z.number().int().nonnegative().optional(),
  incompleteFamilies: z.array(z.string()).optional(),
  providerCalls: z.array(hostedProviderCallDiagnosticSchema).optional(),
  recovery: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).passthrough();

const familyAnalysisSchema = z.object({
  requestId: z.string(),
  cached: z.number().int().nonnegative(),
  analyses: z.array(z.object({
    familyId: z.string(),
    fingerprint: z.string(),
    // An empty name is a valid, explicit AI uncertainty signal. It must reach
    // the scan pipeline so Kryeo can flag the asset instead of failing the
    // entire cloud response.
    familyName: z.string(),
    assetType: z.string(),
    role: z.string(),
    modelFamilyName: z.string().optional(),
    modelAssetType: z.string().optional(),
    normalizationReason: z.string().optional(),
    memberNames: z.array(z.object({ visualHash: z.string(), name: z.string() })),
    diveMode: z.enum(['keep-together', 'children-only', 'parent-and-children']),
    reason: z.string().min(1),
    visualDescription: z.string().optional(),
    confidence: confidenceScoreSchema.optional(),
    evidence: z.object({
      visual: confidenceScoreSchema,
      layerName: confidenceScoreSchema,
      hierarchy: confidenceScoreSchema,
      learned: confidenceScoreSchema,
    }).optional(),
    conflict: z.boolean().optional(),
    conflictMessage: z.string().optional(),
    reviewNeeded: z.boolean(),
    alternatives: z.array(z.object({ assetType: z.string(), reason: z.string() })).default([]),
  })),
  failures: z.array(z.object({
    familyIds: z.array(z.string()),
    message: z.string(),
  })).default([]),
  model: z.string().optional(),
  reviewTier: z.enum(['lite', 'escalation']).optional(),
  skippedFamilyIds: z.array(z.string()).default([]),
  budgetLimited: z.boolean().default(false),
  estimatedCostUsd: z.number().nonnegative().optional(),
  scanProviderCostUsd: z.number().nonnegative().optional(),
  scanCommittedCostUsd: z.number().nonnegative().optional(),
  scanProviderRequests: z.number().int().nonnegative().optional(),
  usage: hostedUsageSchema.optional(),
  diagnostics: hostedDiagnosticsSchema.optional(),
});

const familyEvidenceSchema = z.object({
  reason: z.string().min(1),
  visualDescription: z.string().min(1),
  confidence: confidenceScoreSchema,
  evidence: z.object({
    visual: confidenceScoreSchema,
    layerName: confidenceScoreSchema,
    hierarchy: confidenceScoreSchema,
    learned: confidenceScoreSchema,
  }),
  conflict: z.boolean().default(false),
  conflictMessage: z.string().default(''),
  supportsClassification: z.boolean().default(true),
  suggestedName: z.string().min(1).optional(),
  suggestedType: z.string().optional(),
  suggestedRole: z.string().optional(),
  alternatives: z.array(z.object({ assetType: z.string(), reason: z.string() })).default([]),
  cached: z.boolean().default(false),
  scanProviderCostUsd: z.number().nonnegative().optional(),
  scanProviderRequests: z.number().int().nonnegative().optional(),
});

const reconciliationSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({
    familyId: z.string(),
    message: z.string(),
    suggestedType: z.string().optional(),
    suggestedRole: z.string().optional(),
    suggestedName: z.string().optional(),
  })),
});

interface HostedChatResult {
  text: string;
  memories: AssistantMemory[];
  actions: AssistantAction[];
  visionUsed: boolean;
}

interface StoredConfiguration {
  endpoint: string;
  token: string;
}

interface StoredConfigurationFile {
  endpoint?: string;
  token?: string;
  encryptedToken?: string;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787';
// The desktop and local gateway share a decision contract. Refuse a gateway
// from an older release rather than silently applying stale classifications.
const REQUIRED_ANALYSIS_VERSION = 'family-v70';
const DETAILED_FAMILY_BATCH_SIZE = 2;
const SIMPLE_FAMILY_BATCH_SIZE = 8;
const PROGRESSIVE_FAMILY_CONCURRENCY = 2;

function compactGatewayMember(
  member: ComponentVisualFamily['members'][number],
  preferDetailedPreview: boolean,
): ComponentVisualFamily['members'][number] {
  // The gateway only needs one labelled target image per member. Keeping both
  // the UI thumbnail and the hosted thumbnail in every request made large
  // documents hit the gateway body limit late in a scan, after earlier batches
  // had already succeeded.
  const previewUrl = preferDetailedPreview
    ? (member.previewUrl || member.hostedPreviewUrl || '')
    : (member.hostedPreviewUrl || member.previewUrl || '');
  return {
    ...member,
    previewUrl,
    hostedPreviewUrl: undefined,
    analysisPreviewUrls: [],
  };
}

function compactGatewayContextMember(member: NonNullable<ComponentVisualFamily['contextMembers']>[number]): Omit<typeof member, 'previewUrl' | 'hostedPreviewUrl' | 'analysisPreviewUrls'> {
  const {
    previewUrl: _previewUrl,
    hostedPreviewUrl: _hostedPreviewUrl,
    analysisPreviewUrls: _analysisPreviewUrls,
    ...metadata
  } = member;
  return metadata;
}

function mergeFamilyAnalysisResponse(
  target: HostedFamilyAnalysisResponse,
  response: HostedFamilyAnalysisResponse,
): void {
  target.requestId ||= response.requestId;
  target.cached += response.cached;
  target.analyses.push(...response.analyses);
  target.failures.push(...response.failures);
  target.skippedFamilyIds?.push(...(response.skippedFamilyIds || []));
  target.budgetLimited ||= Boolean(response.budgetLimited);
  target.model ||= response.model;
  target.reviewTier ||= response.reviewTier;
  if (typeof response.estimatedCostUsd === 'number') {
    target.estimatedCostUsd = (target.estimatedCostUsd || 0) + response.estimatedCostUsd;
  }
  if (typeof response.scanProviderCostUsd === 'number') {
    target.scanProviderCostUsd = Math.max(target.scanProviderCostUsd || 0, response.scanProviderCostUsd);
  }
  if (typeof response.scanCommittedCostUsd === 'number') {
    target.scanCommittedCostUsd = Math.max(target.scanCommittedCostUsd || 0, response.scanCommittedCostUsd);
  }
  if (typeof response.scanProviderRequests === 'number') {
    target.scanProviderRequests = Math.max(target.scanProviderRequests || 0, response.scanProviderRequests);
  }
  if (response.diagnostics) {
    target.diagnostics = {
      ...target.diagnostics,
      ...response.diagnostics,
      providerCalls: [
        ...(target.diagnostics?.providerCalls || []),
        ...(response.diagnostics.providerCalls || []),
      ],
      incompleteFamilies: [
        ...new Set([
          ...(target.diagnostics?.incompleteFamilies || []),
          ...(response.diagnostics.incompleteFamilies || []),
        ]),
      ],
    };
  }
}

function adaptiveFamilyBatches(
  families: ComponentVisualFamily[],
  tier: HostedFamilyAnalysisRequest['reviewTier'],
): ComponentVisualFamily[][] {
  const maximum = tier === 'escalation' ? DETAILED_FAMILY_BATCH_SIZE : SIMPLE_FAMILY_BATCH_SIZE;
  const scopes = new Map<string, ComponentVisualFamily[]>();
  for (const family of families) {
    const key = family.namingScopeKey || family.id;
    const scope = scopes.get(key) || [];
    scope.push(family);
    scopes.set(key, scope);
  }
  const batches: ComponentVisualFamily[][] = [];
  let batch: ComponentVisualFamily[] = [];
  for (const scope of scopes.values()) {
    for (let start = 0; start < scope.length; start += maximum) {
      const unit = scope.slice(start, start + maximum);
      if (batch.length && batch.length + unit.length > maximum) {
        batches.push(batch);
        batch = [];
      }
      batch.push(...unit);
    }
    if (batch.length >= maximum) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export class HostedAiService {
  private configuration: StoredConfiguration | null = null;
  private configurationWarning = '';
  private readonly userDataPath: () => string;

  constructor(userDataPath: () => string) {
    this.userDataPath = userDataPath;
  }

  private configurationPath(): string {
    return path.join(this.userDataPath(), 'hosted-ai.json');
  }

  private async loadConfiguration(): Promise<StoredConfiguration> {
    if (this.configuration) return this.configuration;
    let stored: StoredConfigurationFile = {};
    try {
      stored = JSON.parse(await fs.readFile(this.configurationPath(), 'utf8')) as StoredConfigurationFile;
    } catch {
      // A missing configuration file is expected on first launch.
    }
    let token = String(stored.token || process.env.KRYEO_AI_TOKEN || '');
    if (stored.encryptedToken) {
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
        token = safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
      } catch {
        this.configurationWarning = 'The saved access token could not be unlocked. Enter it again and choose Save and test.';
      }
    }
    this.configuration = {
      endpoint: String(stored.endpoint || process.env.KRYEO_AI_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      token,
    };
    return this.configuration;
  }

  async configure(input: HostedAiConfiguration): Promise<HostedAiStatus> {
    const endpoint = input.endpoint.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(endpoint)) throw new Error('The Kryeo AI endpoint must use HTTP or HTTPS.');
    if (input.token.length > 500) throw new Error('The Kryeo AI token is too long.');
    const previous = await this.loadConfiguration();
    this.configuration = { endpoint, token: input.token.trim() || previous.token };
    this.configurationWarning = '';
    await fs.mkdir(path.dirname(this.configurationPath()), { recursive: true });
    const stored: StoredConfigurationFile = safeStorage.isEncryptionAvailable()
      ? {
          endpoint,
          encryptedToken: safeStorage.encryptString(this.configuration.token).toString('base64'),
        }
      : { endpoint, token: this.configuration.token };
    await fs.writeFile(this.configurationPath(), JSON.stringify(stored, null, 2), 'utf8');
    return this.status();
  }

  private async request<T>(route: string, init: RequestInit, timeoutMs = 120_000, externalSignal?: AbortSignal, correlationId = ''): Promise<T> {
    const configuration = await this.loadConfiguration();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${configuration.endpoint}${route}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(correlationId ? { 'x-kryeo-correlation-id': correlationId } : {}),
          ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {}),
          ...init.headers,
        },
      });
      const body = await response.text();
      if (!response.ok) {
        let message = body;
        try {
          message = String((JSON.parse(body) as { error?: unknown }).error || body);
        } catch {
          // Keep the original response body.
        }
        throw new Error(message || `Kryeo AI returned HTTP ${response.status}.`);
      }
      return JSON.parse(body) as T;
    } catch (error) {
      if (timedOut) throw new Error(`Kryeo AI exceeded the ${Math.round(timeoutMs / 1000)} second safety limit.`);
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  async status(): Promise<HostedAiStatus> {
    const configuration = await this.loadConfiguration();
    try {
      const status = await this.request<HostedAiStatus>('/health', { method: 'GET' }, 3_500);
      if (status.analysisVersion !== REQUIRED_ANALYSIS_VERSION) {
        return {
          ...status,
          available: false,
          configured: Boolean(configuration.endpoint),
          endpoint: configuration.endpoint,
          message: `The Kryeo AI gateway is running ${status.analysisVersion || 'an unknown decision contract'}, but this app requires ${REQUIRED_ANALYSIS_VERSION}. Restart or update the gateway before scanning so old cached rules cannot be used.`,
        };
      }
      return { ...status, configured: Boolean(configuration.endpoint), endpoint: configuration.endpoint };
    } catch (error) {
      return {
        available: false,
        configured: Boolean(configuration.endpoint),
        endpoint: configuration.endpoint,
        model: 'Cloud Qwen 3.7 Flash',
        modelLite: 'qwen/qwen3.7-flash',
        modelEscalation: 'qwen/qwen3.7-flash',
        queueDepth: 0,
        familyBatchSize: SIMPLE_FAMILY_BATCH_SIZE,
        serviceTier: 'auto',
        promptCacheEnabled: false,
        analysisVersion: REQUIRED_ANALYSIS_VERSION,
        scanTargetUsd: 0.01,
        scanBudgetUsd: 0.03,
        scanBudgetEnforced: true,
        maxHostedFamiliesPerScan: 0,
        maxEscalationFamiliesPerScan: 1,
        liteInputPricePerMillion: 0.03,
        liteOutputPricePerMillion: 0.13,
        escalationInputPricePerMillion: 0.104,
        escalationOutputPricePerMillion: 0.416,
        costEstimateSafetyFactor: 2,
        message: this.configurationWarning || (error instanceof Error ? error.message : 'Kryeo AI is unavailable.'),
      };
    }
  }

  async analyzeFamilies(
    request: HostedFamilyAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<HostedFamilyAnalysisResponse> {
    const unresolved = request.families.filter((family) => !family.approvedDecision);
    if (!unresolved.length) return { requestId: 'memory-only', cached: request.families.length, analyses: [], failures: [] };
    const compactFamilies = unresolved.map((family) => ({
      ...family,
      members: [...new Map(family.members.map((member) => [member.visualHash, member])).values()]
        .slice(0, 6)
        .map((member) => compactGatewayMember(member, family.assetBoundary === 'composed-parent')),
      contextMembers: (family.contextMembers || []).slice(0, 4).map(compactGatewayContextMember),
    }));
    // The gateway owns bounded provider recovery. Retrying the complete desktop
    // request here can repurchase a successful cloud call when the response was
    // merely lost between the gateway and Electron.
    const result = await this.request<unknown>('/v1/families/analyze', {
      method: 'POST',
      body: JSON.stringify({ ...request, families: compactFamilies }),
    }, 50_000, signal, request.correlationId || request.hostedScanId || '');
    return familyAnalysisSchema.parse(result) as HostedFamilyAnalysisResponse;
  }

  private async analyzeFamiliesResilient(
    request: HostedFamilyAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<HostedFamilyAnalysisResponse> {
    try {
      return await this.analyzeFamilies(request, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // A failed request is one unresolved batch, not a request to recursively
      // split and re-buy every family. The gateway already returns partial
      // results when it has them, and the next scan can retry the remainder.
      return {
        requestId: 'desktop-recovery',
        cached: 0,
        analyses: [],
        failures: [{
          familyIds: request.families.map((family) => family.id),
          message: error instanceof Error ? error.message : 'Cloud analysis failed for this visual family.',
        }],
        skippedFamilyIds: [],
        budgetLimited: false,
        reviewTier: request.reviewTier,
      };
    }
  }

  async explainFamily(
    request: HostedFamilyEvidenceRequest,
    signal?: AbortSignal,
  ): Promise<HostedFamilyEvidenceResult> {
    const result = await this.request<unknown>('/v1/families/explain', {
      method: 'POST',
      body: JSON.stringify(request),
    }, 75_000, signal, request.correlationId || request.hostedScanId || '');
    return familyEvidenceSchema.parse(result) as HostedFamilyEvidenceResult;
  }

  async reviewFamilies(
    request: HostedFamilyBatchReviewRequest,
    signal?: AbortSignal,
  ): Promise<HostedFamilyAnalysisResponse> {
    const compactFamilies = request.families.slice(0, 8).map((family) => ({
      ...family,
      members: [...new Map(family.members.map((member) => [member.visualHash, member])).values()]
        .slice(0, 1)
        .map((member) => compactGatewayMember(member, family.assetBoundary === 'composed-parent')),
      contextMembers: (family.contextMembers || []).slice(0, 4).map(compactGatewayContextMember),
    }));
    const result = await this.request<unknown>('/v1/families/review', {
      method: 'POST',
      body: JSON.stringify({ ...request, families: compactFamilies, reviewTier: 'escalation' }),
    }, 50_000, signal, request.correlationId || request.hostedScanId || '');
    return familyAnalysisSchema.parse(result) as HostedFamilyAnalysisResponse;
  }

  async analyzeFamiliesProgressively(
    request: HostedFamilyAnalysisRequest,
    onProgress: (completed: number, total: number, response: HostedFamilyAnalysisResponse) => void,
    signal?: AbortSignal,
  ): Promise<HostedFamilyAnalysisResponse> {
    const unresolved = request.families.filter((family) => !family.approvedDecision);
    if (!unresolved.length) return { requestId: 'memory-only', cached: request.families.length, analyses: [], failures: [] };
    const combined: HostedFamilyAnalysisResponse = {
      requestId: '',
      cached: 0,
      analyses: [],
      failures: [],
      skippedFamilyIds: [],
      budgetLimited: false,
    };
    const adaptiveBatches = adaptiveFamilyBatches(unresolved, request.reviewTier);
    let completedFamilies = 0;
    for (let index = 0; index < adaptiveBatches.length; index += PROGRESSIVE_FAMILY_CONCURRENCY) {
      if (signal?.aborted) throw new DOMException('Component scan cancelled.', 'AbortError');
      const batches = adaptiveBatches.slice(index, index + PROGRESSIVE_FAMILY_CONCURRENCY);
      await Promise.all(batches.map(async (batch) => {
        const response = await this.analyzeFamiliesResilient({ ...request, families: batch }, signal);
        mergeFamilyAnalysisResponse(combined, response);
        completedFamilies += batch.length;
        // Report each concurrent batch as soon as it completes. Waiting for its
        // slower sibling made healthy work look frozen for the full timeout.
        onProgress(Math.min(completedFamilies, unresolved.length), unresolved.length, response);
      }));
    }
    return combined;
  }

  async reconcile(
    project: string,
    documentTitle: string,
    families: ComponentVisualFamily[],
    analyses: HostedFamilyAnalysisResponse['analyses'],
    signal?: AbortSignal,
  ): Promise<DocumentReconciliation> {
    if (!analyses.length) return { summary: 'All classifications came from approved visual families.', issues: [] };
    const result = await this.request<unknown>('/v1/documents/reconcile', {
      method: 'POST',
      body: JSON.stringify({
        project,
        documentTitle,
        families: families.map((family) => ({
          id: family.id,
          fingerprint: family.fingerprint,
          memberCount: family.members.length,
          parentNames: family.parentNames,
          exactInstanceCount: family.exactInstanceCount,
          members: family.members.map((member, order) => ({
            order: order + 1,
            visualHash: member.visualHash,
            sourceName: member.name,
            affinityType: member.affinityType,
            bounds: member.bounds,
            childCount: member.childHierarchyKeys.length,
            visualMetrics: member.visualMetrics,
          })),
        })),
        analyses,
      }),
    }, 90_000, signal);
    return reconciliationSchema.parse(result) as DocumentReconciliation;
  }

  async chat(
    request: AssistantChatRequest,
    workspace: WorkspaceSnapshot,
    visual?: AssistantVisualContext,
  ): Promise<HostedChatResult> {
    const images = await Promise.all((visual?.images || []).slice(0, 6).map(async (image) => ({
      label: image.label,
      dataUrl: `data:image/png;base64,${(await fs.readFile(image.imagePath)).toString('base64')}`,
    })));
    return this.request<HostedChatResult>('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        request,
        images,
        recentMessages: workspace.assistantMessages.filter((message) => message.sessionId === request.sessionId).slice(-12),
        memories: workspace.assistantMemories.filter((memory) => memory.scope === 'global' || memory.project === request.project).slice(-24),
        projectKnowledge: workspace.projectKnowledge.find((knowledge) => knowledge.project === request.project),
        manifests: workspace.componentManifests.filter((manifest) => manifest.documentTitle === request.document.title).slice(0, 2),
      }),
    }, 120_000);
  }
}
