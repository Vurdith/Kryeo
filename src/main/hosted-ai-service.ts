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
  WorkspaceSnapshot,
} from '../shared/types';
import type { AssistantVisualContext } from './assistant-service';

const confidenceScoreSchema = z.preprocess(
  (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0),
  z.number().min(0).max(1),
);

const familyAnalysisSchema = z.object({
  requestId: z.string(),
  cached: z.number().int().nonnegative(),
  analyses: z.array(z.object({
    familyId: z.string(),
    fingerprint: z.string(),
    familyName: z.string().min(1),
    assetType: z.string(),
    role: z.string(),
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
const PROGRESSIVE_FAMILY_BATCH_SIZE = 8;

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
        model: 'Qwen3.5-9B',
        queueDepth: 0,
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
          analysisPreviewUrls: (
            member.bounds.width > 640 || member.bounds.height > 640
              ? member.analysisPreviewUrls.slice(0, 4)
              : []
          ),
        })),
    }));
    const result = await this.request<unknown>('/v1/families/analyze', {
      method: 'POST',
      body: JSON.stringify({ ...request, families: compactFamilies }),
    }, 180_000, signal);
    return familyAnalysisSchema.parse(result) as HostedFamilyAnalysisResponse;
  }

  async analyzeFamiliesProgressively(
    request: HostedFamilyAnalysisRequest,
    onProgress: (completed: number, total: number, response: HostedFamilyAnalysisResponse) => void,
    signal?: AbortSignal,
  ): Promise<HostedFamilyAnalysisResponse> {
    const unresolved = request.families.filter((family) => !family.approvedDecision);
    if (!unresolved.length) return { requestId: 'memory-only', cached: request.families.length, analyses: [], failures: [] };
    const combined: HostedFamilyAnalysisResponse = { requestId: '', cached: 0, analyses: [], failures: [] };
    for (let index = 0; index < unresolved.length; index += PROGRESSIVE_FAMILY_BATCH_SIZE) {
      if (signal?.aborted) throw new DOMException('Component scan cancelled.', 'AbortError');
      const batch = unresolved.slice(index, index + PROGRESSIVE_FAMILY_BATCH_SIZE);
      const response = await this.analyzeFamilies({ ...request, families: batch }, signal);
      combined.requestId ||= response.requestId;
      combined.cached += response.cached;
      combined.analyses.push(...response.analyses);
      combined.failures.push(...response.failures);
      onProgress(Math.min(index + batch.length, unresolved.length), unresolved.length, response);
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
