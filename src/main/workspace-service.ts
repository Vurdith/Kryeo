import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AssetPreference,
  AssistantMemory,
  AssistantMessage,
  AssistantSession,
  ComponentDecision,
  ComponentHierarchyManifest,
  JobRecord,
  PlacementLink,
  ProjectKnowledge,
  ProjectRecipe,
  SaveProjectNoteRequest,
  ScriptRunResult,
  SaveComponentReviewRequest,
  WorkflowPreset,
  WorkspaceSnapshot,
} from '../shared/types';
import { componentCategory, componentSubcategory } from './component-context-service.ts';

interface WorkspaceData {
  jobs: JobRecord[];
  recipes: ProjectRecipe[];
  presets: WorkflowPreset[];
  links: PlacementLink[];
  preferences: AssetPreference[];
  componentDecisions: ComponentDecision[];
  componentManifests: ComponentHierarchyManifest[];
  assistantMemories: AssistantMemory[];
  assistantSessions: AssistantSession[];
  assistantMessages: AssistantMessage[];
  projectKnowledge: ProjectKnowledge[];
}

const emptyData = (): WorkspaceData => ({ jobs: [], recipes: [], presets: [], links: [], preferences: [], componentDecisions: [], componentManifests: [], assistantMemories: [], assistantSessions: [], assistantMessages: [], projectKnowledge: [] });

function enrichMetadataFromNote(knowledge: ProjectKnowledge, text: string, tags: string[]): void {
  const colors = [...text.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toUpperCase());
  if (colors.length) {
    const existing = Object.values(knowledge.metadata.colors || {});
    knowledge.metadata.colors = Object.fromEntries([...new Set([...existing, ...colors])].slice(0, 24).map((color, index) => [`color${index + 1}`, color]));
  }
  const brush = text.match(/\bbrush(?:es)?\s*:\s*([^.;\n]+)/i)?.[1]?.trim();
  if (brush) knowledge.metadata.brushes = [...new Set([...(knowledge.metadata.brushes || []), brush])].slice(0, 24);
  const design = { ...(knowledge.metadata.design || {}) };
  for (const tag of tags) {
    const separator = tag.indexOf(':');
    if (separator > 0) design[tag.slice(0, separator).trim()] = tag.slice(separator + 1).trim();
  }
  if (Object.keys(design).length) knowledge.metadata.design = design;
}

export class WorkspaceService {
  private data: WorkspaceData = emptyData();
  private loaded = false;
  private writing = Promise.resolve();
  private readonly userDataPath: () => string;

  constructor(userDataPath: () => string) {
    this.userDataPath = userDataPath;
  }

  private filePath(): string {
    return path.join(this.userDataPath(), 'pipeline-workspace.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath(), 'utf8')) as Partial<WorkspaceData>;
      this.data = {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
        links: Array.isArray(parsed.links) ? parsed.links : [],
        preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
        componentDecisions: Array.isArray(parsed.componentDecisions) ? parsed.componentDecisions : [],
        componentManifests: Array.isArray(parsed.componentManifests) ? parsed.componentManifests : [],
        assistantMemories: Array.isArray(parsed.assistantMemories) ? parsed.assistantMemories : [],
        assistantSessions: Array.isArray(parsed.assistantSessions) ? parsed.assistantSessions : [],
        assistantMessages: Array.isArray(parsed.assistantMessages) ? parsed.assistantMessages : [],
        projectKnowledge: Array.isArray(parsed.projectKnowledge) ? parsed.projectKnowledge : [],
      };
      this.data.recipes = this.data.recipes.map((recipe) => ({
        ...recipe,
        targets: recipe.targets.filter((target) => target === 'folder' || target === 'roblox'),
      }));
      this.migrateAssistantData();
    } catch {
      this.data = emptyData();
    }
    const now = new Date().toISOString();
    for (const job of this.data.jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'interrupted';
        job.stage = 'Interrupted when Kryeo closed';
        job.completedAt = now;
        job.updatedAt = now;
        job.output ||= 'Kryeo closed before this operation reported completion. Check Affinity and the asset library before retrying.';
      }
    }
    this.loaded = true;
    await this.persist();
  }

  private migrateAssistantData(): void {
    const now = new Date().toISOString();
    this.data.assistantMemories = this.data.assistantMemories.map((memory) => ({
      ...memory,
      scope: memory.scope || (memory.project === 'General' ? 'global' : 'project'),
    }));
    const byProject = new Map<string, AssistantSession>();
    for (const session of this.data.assistantSessions) byProject.set(session.project, session);
    for (const message of this.data.assistantMessages) {
      if (message.sessionId) continue;
      let session = byProject.get(message.project);
      if (!session) {
        session = {
          id: randomUUID(), project: message.project, title: 'Previous conversation', pinned: false,
          archived: false, createdAt: message.createdAt || now, updatedAt: message.createdAt || now,
        };
        this.data.assistantSessions.push(session);
        byProject.set(message.project, session);
      }
      message.sessionId = session.id;
      if (message.createdAt > session.updatedAt) session.updatedAt = message.createdAt;
    }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      const file = this.filePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      await fs.rm(file, { force: true });
      await fs.rename(temporary, file);
    });
    return this.writing;
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    return {
      jobs: this.data.jobs.slice(0, 80),
      recipes: [...this.data.recipes],
      presets: [...this.data.presets],
      links: this.data.links.slice(0, 200),
      preferences: [...this.data.preferences],
      componentDecisions: [...this.data.componentDecisions],
      componentManifests: [...this.data.componentManifests],
      assistantMemories: [...this.data.assistantMemories],
      assistantSessions: [...this.data.assistantSessions],
      assistantMessages: [...this.data.assistantMessages],
      projectKnowledge: this.data.projectKnowledge.map((knowledge) => ({
        ...knowledge,
        notes: knowledge.notes.map((note) => ({ ...note, tags: [...note.tags] })),
        metadata: { ...knowledge.metadata },
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  async runJob(
    operation: JobRecord['operation'],
    title: string,
    payload: unknown,
    task: (update: (progress: number, stage: string) => Promise<void>, cancelled: () => boolean) => Promise<ScriptRunResult>,
  ): Promise<ScriptRunResult> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(), operation, title, status: 'queued', progress: 0, stage: 'Queued', payload,
      startedAt: now, updatedAt: now, completedAt: '', output: '', cancelRequested: false,
    };
    this.data.jobs.unshift(job);
    this.data.jobs = this.data.jobs.slice(0, 80);
    await this.persist();
    const update = async (progress: number, stage: string) => {
      job.status = 'running';
      job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
      job.stage = stage;
      job.updatedAt = new Date().toISOString();
      await this.persist();
    };
    try {
      await update(5, 'Preparing');
      if (job.cancelRequested) throw new Error('Operation cancelled before it started.');
      const result = await task(update, () => job.cancelRequested);
      job.status = result.ok ? 'succeeded' : 'failed';
      job.progress = 100;
      job.stage = result.ok ? 'Complete' : 'Needs attention';
      job.output = result.output;
      job.completedAt = result.completedAt || new Date().toISOString();
      job.updatedAt = job.completedAt;
      await this.persist();
      return result;
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      job.status = job.cancelRequested ? 'cancelled' : 'failed';
      job.progress = job.cancelRequested ? job.progress : 100;
      job.stage = job.cancelRequested ? 'Cancelled' : 'Failed';
      job.output = output;
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      await this.persist();
      return { ok: false, title, output, startedAt: job.startedAt, completedAt: job.completedAt };
    }
  }

  async cancelJob(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const job = this.data.jobs.find((candidate) => candidate.id === id);
    if (!job || !['queued', 'running'].includes(job.status)) return false;
    job.cancelRequested = true;
    job.stage = 'Cancellation requested';
    job.updatedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  async saveRecipe(recipe: ProjectRecipe): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const index = this.data.recipes.findIndex((candidate) => candidate.project === recipe.project);
    if (index >= 0) this.data.recipes[index] = recipe;
    else this.data.recipes.push(recipe);
    await this.persist();
    return this.snapshot();
  }

  async savePreset(input: Omit<WorkflowPreset, 'id' | 'updatedAt'> & { id?: string }): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const preset: WorkflowPreset = { ...input, id: input.id || randomUUID(), updatedAt: new Date().toISOString() };
    const index = this.data.presets.findIndex((candidate) => candidate.id === preset.id);
    if (index >= 0) this.data.presets[index] = preset;
    else this.data.presets.push(preset);
    await this.persist();
    return this.snapshot();
  }

  async deletePreset(id: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.presets = this.data.presets.filter((preset) => preset.id !== id);
    await this.persist();
    return this.snapshot();
  }

  async setAssetPreference(preference: AssetPreference): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const index = this.data.preferences.findIndex((candidate) => candidate.assetId === preference.assetId);
    if (index >= 0) this.data.preferences[index] = preference;
    else this.data.preferences.push(preference);
    await this.persist();
    return this.snapshot();
  }

  async saveComponentDecisions(decisions: Array<Omit<ComponentDecision, 'updatedAt'>>): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const updatedAt = new Date().toISOString();
    for (const input of decisions) {
      const previous = this.data.componentDecisions.find((candidate) =>
        candidate.visualHash === input.visualHash
        || Boolean(input.familyFingerprint && candidate.familyFingerprint === input.familyFingerprint));
      const corrected = Boolean(
        (input.suggestedName
          && input.familyName.trim().toLowerCase() !== input.suggestedName.trim().toLowerCase())
        || (input.suggestedType && input.assetType !== input.suggestedType)
        || (input.suggestedRole && input.role !== input.suggestedRole)
      );
      const decision: ComponentDecision = {
        visualHash: input.visualHash,
        familyFingerprint: input.familyFingerprint,
        familyMemberHashes: input.familyMemberHashes,
        memberNames: input.memberNames,
        project: input.project,
        scope: input.scope || 'project',
        approved: input.approved !== false,
        analysisSource: input.analysisSource,
        role: input.role,
        assetType: input.assetType || 'Unknown',
        familyName: input.familyName.trim().slice(0, 120),
        semanticHint: input.semanticHint,
        suggestedName: input.suggestedName,
        suggestedType: input.suggestedType,
        suggestedRole: input.suggestedRole,
        correctionCount: (previous?.correctionCount || 0) + (corrected ? 1 : 0),
        embedding: input.embedding,
        diveMode: input.diveMode || 'keep-together',
        diveDecisions: input.diveDecisions,
        documentTitle: input.documentTitle,
        provenance: input.provenance || previous?.provenance,
        influenceCount: previous?.influenceCount || input.influenceCount || 0,
        lastInfluencedAt: previous?.lastInfluencedAt || input.lastInfluencedAt,
        confidenceSamples: (previous?.confidenceSamples || 0) + 1,
        confidenceCorrect: (previous?.confidenceCorrect || 0) + (corrected ? 0 : 1),
        updatedAt,
      };
      const index = this.data.componentDecisions.findIndex((candidate) =>
        candidate.visualHash === decision.visualHash
        || Boolean(decision.familyFingerprint && candidate.familyFingerprint === decision.familyFingerprint));
      if (index >= 0) this.data.componentDecisions[index] = decision;
      else this.data.componentDecisions.push(decision);
    }
    this.data.componentDecisions = this.data.componentDecisions.slice(-2000);
    await this.persist();
    return this.snapshot();
  }

  async forgetComponentDecision(visualHash: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.componentDecisions = this.data.componentDecisions.filter((decision) => decision.visualHash !== visualHash);
    await this.persist();
    return this.snapshot();
  }

  async setComponentDecisionScope(visualHash: string, scope: 'project' | 'global'): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const decision = this.data.componentDecisions.find((candidate) => candidate.visualHash === visualHash);
    if (!decision) throw new Error('The learned visual family no longer exists.');
    decision.scope = scope;
    decision.updatedAt = new Date().toISOString();
    await this.persist();
    return this.snapshot();
  }

  async recordComponentInfluences(fingerprints: string[]): Promise<void> {
    await this.ensureLoaded();
    const used = new Set(fingerprints.filter(Boolean));
    if (!used.size) return;
    const now = new Date().toISOString();
    let changed = false;
    for (const decision of this.data.componentDecisions) {
      if (!decision.familyFingerprint || !used.has(decision.familyFingerprint)) continue;
      decision.influenceCount = (decision.influenceCount || 0) + 1;
      decision.lastInfluencedAt = now;
      changed = true;
    }
    if (changed) await this.persist();
  }

  async clearComponentDecisions(): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.componentDecisions = [];
    await this.persist();
    return this.snapshot();
  }

  async saveComponentReview(request: SaveComponentReviewRequest): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const included = new Set(request.includedIds);
    const grouped = new Map<string, typeof request.components>();
    for (const component of request.components) {
      const key = component.familyFingerprint || component.visualHash;
      const family = grouped.get(key) || [];
      family.push(component);
      grouped.set(key, family);
    }
    await this.saveComponentDecisions([...grouped.values()].map((family) => {
      const component = family[0];
      return {
        visualHash: component.visualHash,
        familyFingerprint: component.familyFingerprint,
        familyMemberHashes: [...new Set(family.map((member) => member.visualHash))],
        memberNames: family.map((member) => ({ visualHash: member.visualHash, name: member.familyName })),
        project: request.project,
        scope: 'project' as const,
        approved: true,
        analysisSource: component.analysisSource,
        role: component.role,
        assetType: component.assetType,
        familyName: component.familyName,
        semanticHint: component.semanticHint,
        suggestedName: component.aiSuggestedName,
        suggestedType: component.aiSuggestedType,
        suggestedRole: component.aiSuggestedRole,
        correctionCount: 0,
        embedding: component.visualEmbedding,
        diveMode: component.diveMode,
        diveDecisions: [...new Map(family
          .filter((member) => member.childHierarchyKeys.length > 0 && member.diveStructureSignature)
          .map((member) => [member.diveStructureSignature, {
            signature: member.diveStructureSignature as string,
            mode: member.diveMode,
          }])).values()],
        documentTitle: request.documentTitle,
        provenance: {
          source: 'scan-review' as const,
          originalName: component.aiSuggestedName,
          originalType: component.aiSuggestedType,
          originalRole: component.aiSuggestedRole,
        },
      };
    }));

    const createdAt = new Date().toISOString();
    const safeTitle = request.documentTitle.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Untitled';
    const directory = path.join(this.userDataPath(), 'ComponentManifests');
    const manifestPath = path.join(directory, `${safeTitle}.json`);
    const manifest: ComponentHierarchyManifest = {
      id: randomUUID(),
      documentTitle: request.documentTitle,
      documentSessionUuid: request.documentSessionUuid,
      createdAt,
      path: manifestPath,
      nodes: request.components.map((component) => ({
        id: component.hierarchyKey,
        parentId: component.parentHierarchyKey,
        familyName: component.familyName,
        assetType: component.assetType,
        category: componentCategory(component.assetType),
        subcategory: componentSubcategory(component, request.components),
        robloxRole: component.role,
        visualHash: component.visualHash,
        similarityFamily: component.similarityFamily,
        duplicateKind: component.duplicateKind,
        diveMode: component.diveMode,
        included: included.has(component.id),
        sourcePaths: component.members.map((member) => member.path),
      })),
    };
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${manifestPath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rm(manifestPath, { force: true });
    await fs.rename(temporary, manifestPath);
    this.data.componentManifests = [manifest, ...this.data.componentManifests.filter((item) => item.documentTitle !== request.documentTitle)].slice(0, 40);
    await this.persist();
    return this.snapshot();
  }

  async saveAssistantExchange(user: AssistantMessage, assistant: AssistantMessage, memories: AssistantMemory[]): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.assistantMessages = [...this.data.assistantMessages, user, assistant].slice(-160);
    const session = this.data.assistantSessions.find((item) => item.id === user.sessionId);
    if (session) {
      session.updatedAt = assistant.createdAt;
      if (session.title === 'New conversation') {
        session.title = user.text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New conversation';
      }
    }
    for (const memory of memories) {
      const duplicate = this.data.assistantMemories.some((item) => item.project === memory.project && item.text.toLowerCase() === memory.text.toLowerCase());
      if (!duplicate) this.data.assistantMemories.push(memory);
    }
    this.data.assistantMemories = this.data.assistantMemories.slice(-240);
    await this.persist();
    return this.snapshot();
  }

  async forgetAssistantMemory(id: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.assistantMemories = this.data.assistantMemories.filter((memory) => memory.id !== id);
    await this.persist();
    return this.snapshot();
  }

  async clearAssistantMemories(): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.assistantMemories = [];
    await this.persist();
    return this.snapshot();
  }

  async setAssistantMemoryScope(id: string, scope: 'project' | 'global', project: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const memory = this.data.assistantMemories.find((item) => item.id === id);
    if (!memory) throw new Error('Assistant memory was not found.');
    memory.scope = scope;
    memory.project = scope === 'global' ? 'General' : project;
    await this.persist();
    return this.snapshot();
  }

  async createAssistantSession(project: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    this.data.assistantSessions.push({
      id: randomUUID(), project: project.trim() || 'General', title: 'New conversation',
      pinned: false, archived: false, createdAt: now, updatedAt: now,
    });
    await this.persist();
    return this.snapshot();
  }

  async updateAssistantSession(id: string, changes: Partial<Pick<AssistantSession, 'title' | 'pinned' | 'archived'>>): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const session = this.data.assistantSessions.find((item) => item.id === id);
    if (!session) throw new Error('Assistant conversation was not found.');
    if (typeof changes.title === 'string') session.title = changes.title.replace(/\s+/g, ' ').trim().slice(0, 64) || session.title;
    if (typeof changes.pinned === 'boolean') session.pinned = changes.pinned;
    if (typeof changes.archived === 'boolean') session.archived = changes.archived;
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return this.snapshot();
  }

  async deleteAssistantSession(id: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    this.data.assistantSessions = this.data.assistantSessions.filter((session) => session.id !== id);
    this.data.assistantMessages = this.data.assistantMessages.filter((message) => message.sessionId !== id);
    await this.persist();
    return this.snapshot();
  }

  async assistantSession(id: string): Promise<{ session: AssistantSession; messages: AssistantMessage[] } | undefined> {
    await this.ensureLoaded();
    const session = this.data.assistantSessions.find((item) => item.id === id);
    if (!session) return undefined;
    return { session: { ...session }, messages: this.data.assistantMessages.filter((message) => message.sessionId === id) };
  }

  async importAssistantSession(project: string, title: string, messages: AssistantMessage[]): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const session: AssistantSession = {
      id: randomUUID(), project: project.trim() || 'General', title: title.slice(0, 64) || 'Imported conversation',
      pinned: false, archived: false, createdAt: now, updatedAt: now,
    };
    this.data.assistantSessions.push(session);
    this.data.assistantMessages.push(...messages.map((message) => ({
      ...message, id: randomUUID(), project: session.project, sessionId: session.id,
    })));
    this.data.assistantMessages = this.data.assistantMessages.slice(-160);
    await this.persist();
    return this.snapshot();
  }

  async saveProjectNote(request: SaveProjectNoteRequest): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const project = request.project.trim() || 'General';
    const now = new Date().toISOString();
    let knowledge = this.data.projectKnowledge.find((item) => item.project === project);
    if (!knowledge) {
      knowledge = { project, notes: [], metadata: {}, updatedAt: now };
      this.data.projectKnowledge.push(knowledge);
    }
    const tags = [...new Set(request.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
    const existing = request.id ? knowledge.notes.find((note) => note.id === request.id) : undefined;
    if (existing) {
      existing.text = request.text.trim().slice(0, 1200);
      existing.tags = tags;
      existing.updatedAt = now;
    } else {
      knowledge.notes.unshift({
        id: randomUUID(),
        text: request.text.trim().slice(0, 1200),
        tags,
        createdAt: now,
        updatedAt: now,
      });
    }
    enrichMetadataFromNote(knowledge, request.text, tags);
    knowledge.notes = knowledge.notes.filter((note) => note.text).slice(0, 300);
    knowledge.updatedAt = now;
    await this.persist();
    return this.snapshot();
  }

  async deleteProjectNote(project: string, id: string): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const knowledge = this.data.projectKnowledge.find((item) => item.project === project);
    if (knowledge) {
      knowledge.notes = knowledge.notes.filter((note) => note.id !== id);
      knowledge.updatedAt = new Date().toISOString();
      await this.persist();
    }
    return this.snapshot();
  }

  async mergeProjectKnowledge(project: string, imported: Partial<ProjectKnowledge>): Promise<WorkspaceSnapshot> {
    await this.ensureLoaded();
    const safeProject = project.trim() || 'General';
    const now = new Date().toISOString();
    let knowledge = this.data.projectKnowledge.find((item) => item.project === safeProject);
    if (!knowledge) {
      knowledge = { project: safeProject, notes: [], metadata: {}, updatedAt: now };
      this.data.projectKnowledge.push(knowledge);
    }
    const notes = Array.isArray(imported.notes) ? imported.notes : [];
    for (const candidate of notes) {
      if (!candidate || typeof candidate.text !== 'string' || !candidate.text.trim()) continue;
      const duplicate = knowledge.notes.some((note) => note.text.toLowerCase() === candidate.text.trim().toLowerCase());
      if (!duplicate) {
        knowledge.notes.push({
          id: randomUUID(),
          text: candidate.text.trim().slice(0, 1200),
          tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) : [],
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (imported.metadata && typeof imported.metadata === 'object') {
      const importedBrushes = Array.isArray(imported.metadata.brushes) ? imported.metadata.brushes : [];
      knowledge.metadata = {
        ...knowledge.metadata,
        ...imported.metadata,
        brushes: [...new Set([...(knowledge.metadata.brushes || []), ...importedBrushes])],
        colors: { ...(knowledge.metadata.colors || {}), ...(imported.metadata.colors || {}) },
        design: { ...(knowledge.metadata.design || {}), ...(imported.metadata.design || {}) },
      };
    }
    knowledge.notes = knowledge.notes.slice(-300);
    knowledge.updatedAt = now;
    await this.persist();
    return this.snapshot();
  }

  async recordPlacement(link: Omit<PlacementLink, 'id' | 'placedAt'>): Promise<void> {
    await this.ensureLoaded();
    this.data.links.unshift({ ...link, id: randomUUID(), placedAt: new Date().toISOString() });
    this.data.links = this.data.links.slice(0, 200);
    await this.persist();
  }

  async recipe(project: string): Promise<ProjectRecipe | undefined> {
    await this.ensureLoaded();
    return this.data.recipes.find((candidate) => candidate.project === project);
  }
}
