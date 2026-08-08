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
  HostedFamilyEvidenceRequest,
  HostedFamilyEvidenceResult,
  WorkspaceSnapshot,
} from '../shared/types';
import type { AssistantVisualContext } from './assistant-service';
import { buildHostedFamilyContactSheet } from './hosted-contact-sheet';

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

const familyAnalysisSchema = z.object({
  requestId: z.string(),
  cached: z.number().int().nonnegative(),
  analyses: z.array(z.object({
    familyId: z.string(),
    fingerprint: z.string(),
    familyName: z.string().min(1),
    assetType: z.string(),
    role: z.string(),
    modelFamilyName: z.string().min(1).optional(),
    modelAssetType: z.string().optional(),
    normalizationReason: z.string().optional(),
    memberNames: z.array(z.object({ visualHash: z.string(), name: z.string().min(1) })),
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
  usage: hostedUsageSchema.optional(),
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
const DETAILED_FAMILY_BATCH_SIZE = 8;
const SIMPLE_FAMILY_BATCH_SIZE = 16;
const PROGRESSIVE_FAMILY_CONCURRENCY = 2;

function needsDetailedLiteBatch(family: ComponentVisualFamily): boolean {
  const signal = family.reviewSignals;
  if (signal?.semanticConflict || Number(signal?.hierarchyAmbiguity || 0) >= 0.55) return true;
  if (Number(signal?.localMargin ?? 1) < 0.08) return true;
  return family.members.some((member) => {
    const width = Number(member.bounds?.width || 0);
    const height = Number(member.bounds?.height || 0);
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const visible = Number(member.visualMetrics?.visiblePixelRatio ?? 1);
    // Detail crops are sent only on the escalation lane. Treating their mere
    // existence as a Lite-batch constraint used to cut ordinary contact-sheet
    // batches to eight without sending any extra pixels to the hosted model.
    return aspect > 4
      || aspect < 0.25
      || visible < 0.08;
  });
}

function adaptiveFamilyBatches(
  families: ComponentVisualFamily[],
  tier: HostedFamilyAnalysisRequest['reviewTier'],
): ComponentVisualFamily[][] {
  if (tier === 'escalation') {
    return Array.from({ length: Math.ceil(families.length / DETAILED_FAMILY_BATCH_SIZE) }, (_, index) => (
      families.slice(index * DETAILED_FAMILY_BATCH_SIZE, (index + 1) * DETAILED_FAMILY_BATCH_SIZE)
    ));
  }
  const batches: ComponentVisualFamily[][] = [];
  let batch: ComponentVisualFamily[] = [];
  let limit = SIMPLE_FAMILY_BATCH_SIZE;
  for (const family of families) {
    const familyLimit = needsDetailedLiteBatch(family) ? DETAILED_FAMILY_BATCH_SIZE : SIMPLE_FAMILY_BATCH_SIZE;
    const nextLimit = Math.min(limit, familyLimit);
    if (batch.length >= nextLimit) {
      batches.push(batch);
      batch = [];
      limit = SIMPLE_FAMILY_BATCH_SIZE;
    }
    batch.push(family);
    limit = Math.min(limit, familyLimit);
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

  private async request<T>(route: string, init: RequestInit, timeoutMs = 120_000, externalSignal?: AbortSignal): Promise<T> {
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
      return { ...status, configured: Boolean(configuration.endpoint), endpoint: configuration.endpoint };
    } catch (error) {
      return {
        available: false,
        configured: Boolean(configuration.endpoint),
        endpoint: configuration.endpoint,
        model: 'Hosted Qwen3.7 Flash',
        modelLite: 'qwen/qwen3.7-flash',
        modelEscalation: 'qwen/qwen3.7-flash',
        queueDepth: 0,
        familyBatchSize: SIMPLE_FAMILY_BATCH_SIZE,
        serviceTier: 'auto',
        promptCacheEnabled: false,
        scanTargetUsd: 0.01,
        scanBudgetUsd: 0.03,
        scanBudgetEnforced: true,
        maxHostedFamiliesPerScan: 0,
        maxEscalationFamiliesPerScan: 1,
        liteInputPricePerMillion: 0.03,
        liteOutputPricePerMillion: 0.13,
        escalationInputPricePerMillion: 0.03,
        escalationOutputPricePerMillion: 0.13,
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
        .map((member) => ({
          ...member,
          analysisPreviewUrls: request.reviewTier === 'escalation' && (
            member.bounds.width > 640 || member.bounds.height > 640
          )
            ? member.analysisPreviewUrls.slice(0, 2)
            : [],
        })),
    }));
    const familyContactSheet = request.reviewTier === 'escalation'
      ? undefined
      : await buildHostedFamilyContactSheet(compactFamilies);
    // The gateway owns bounded provider recovery. Retrying the complete desktop
    // request here can repurchase a successful cloud call when the response was
    // merely lost between the gateway and Electron.
    const result = await this.request<unknown>('/v1/families/analyze', {
      method: 'POST',
      body: JSON.stringify({ ...request, families: compactFamilies, familyContactSheet }),
    }, 180_000, signal);
    return familyAnalysisSchema.parse(result) as HostedFamilyAnalysisResponse;
  }

  async explainFamily(
    request: HostedFamilyEvidenceRequest,
    signal?: AbortSignal,
  ): Promise<HostedFamilyEvidenceResult> {
    const result = await this.request<unknown>('/v1/families/explain', {
      method: 'POST',
      body: JSON.stringify(request),
    }, 120_000, signal);
    return familyEvidenceSchema.parse(result) as HostedFamilyEvidenceResult;
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
      const responses = await Promise.all(
        batches.map((batch) => this.analyzeFamilies({ ...request, families: batch }, signal)),
      );
      let waveCompleted = 0;
      responses.forEach((response, responseIndex) => {
        const batch = batches[responseIndex];
        combined.requestId ||= response.requestId;
        combined.cached += response.cached;
        combined.analyses.push(...response.analyses);
        combined.failures.push(...response.failures);
        combined.skippedFamilyIds?.push(...(response.skippedFamilyIds || []));
        combined.budgetLimited ||= Boolean(response.budgetLimited);
        combined.model ||= response.model;
        combined.reviewTier ||= response.reviewTier;
        if (typeof response.estimatedCostUsd === 'number') {
          combined.estimatedCostUsd = (combined.estimatedCostUsd || 0) + response.estimatedCostUsd;
        }
        if (typeof response.scanProviderCostUsd === 'number') {
          combined.scanProviderCostUsd = Math.max(combined.scanProviderCostUsd || 0, response.scanProviderCostUsd);
        }
        if (typeof response.scanCommittedCostUsd === 'number') {
          combined.scanCommittedCostUsd = Math.max(combined.scanCommittedCostUsd || 0, response.scanCommittedCostUsd);
        }
        waveCompleted += batch.length;
        onProgress(Math.min(completedFamilies + waveCompleted, unresolved.length), unresolved.length, response);
      });
      completedFamilies += batches.reduce((total, batch) => total + batch.length, 0);
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
