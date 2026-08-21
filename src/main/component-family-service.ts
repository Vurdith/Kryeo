import { createHash } from 'node:crypto';
import type {
  ComponentAssetType,
  ComponentAssetBoundary,
  ComponentCandidate,
  ComponentDecision,
  ComponentFamilyReviewSignals,
  ComponentVisualFamily,
  HostedFamilyReviewPlan,
  HostedFamilyAnalysis,
  HostedFamilyEvidenceResult,
} from '../shared/types';
import { isMeaninglessName } from './name-quality.ts';
import {
  componentAssetTypes,
  normalizeAiName,
  strictProductionName,
} from './asset-intelligence-service.ts';

function isOpaqueModelName(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  return !compact
    || /^\d+$/.test(compact)
    || /^(?:layer|group|image|asset|export)\s*\d*$/i.test(value)
    || /^[a-f0-9]{12,}$/i.test(compact);
}

export function reviewCategory(assetType: ComponentCandidate['assetType']): ComponentCandidate['reviewCategory'] {
  if (['Background', 'Wallpaper', 'Texture', 'Overlay'].includes(assetType)) return 'background';
  if (['Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX', 'Frame'].includes(assetType)) return 'construction';
  return 'ui';
}

interface VisualStructureAnchor {
  type: 'Border' | 'Wallpaper' | 'Background';
  confidence: number;
  reason: string;
}

/**
 * Keep a strong rendered-structure signal alive even when the hosted model
 * returns a weak or incomplete family result. This is intentionally based on
 * generic layer geometry and rendered coverage, never on a project or asset
 * name.
 */
export function visualStructureAnchor(component: ComponentCandidate): VisualStructureAnchor | undefined {
  const visualType = component.visualStructureType;
  if (
    (visualType === 'Border' || visualType === 'Wallpaper' || visualType === 'Background')
    && component.visualStructureConfidence
    && component.visualStructureConfidence >= 0.9
  ) {
    return {
      type: visualType,
      confidence: component.visualStructureConfidence,
      reason: 'The embedded visual pass found a strong rendered-structure signal.',
    };
  }

  const metrics = component.visualMetrics;
  const contentRelativePerimeter = Boolean(
    metrics
    && metrics.innerVisibleRatio !== undefined
    && metrics.contentPerimeterVisibleRatio !== undefined
    && metrics.innerVisibleRatio < 0.12
    && metrics.contentPerimeterVisibleRatio > 0.05
    && metrics.contentPerimeterVisibleRatio > metrics.innerVisibleRatio * 2
    && (metrics.contentPerimeterCoverage ?? 1) >= 0.28,
  );
  const stronglyPerimeterOnly = Boolean(
    contentRelativePerimeter
    || (
      metrics
      && metrics.centerVisibleRatio < 0.16
      && metrics.edgeVisibleRatio > 0.06
      && metrics.edgeVisibleRatio > metrics.centerVisibleRatio * 2.2
    ),
  );
  if (stronglyPerimeterOnly) {
    return {
      type: 'Border',
      confidence: 0.94,
      reason: 'The exported PNG has a transparent centre with substantially denser perimeter artwork.',
    };
  }

  const aspect = component.bounds.width / Math.max(1, component.bounds.height);
  const largeLandscape = component.bounds.width >= 800
    && component.bounds.height >= 450
    && aspect >= 1.25;
  const renderedImage = /ImageNode/i.test(component.affinityType);
  const hasDenseRenderedContent = !metrics
    || (
      metrics.centerVisibleRatio >= 0.45
      && metrics.visiblePixelRatio >= 0.35
      && metrics.meanAlpha >= 0.35
    );

  // A large, densely rendered imported image is a visual scene/wallpaper
  // candidate. The layer kind is more reliable here than a generic model noun
  // such as "background" or "scene".
  if (largeLandscape && renderedImage && hasDenseRenderedContent) {
    return {
      type: 'Wallpaper',
      confidence: 0.94,
      reason: 'The rendered layer is a large, densely covered imported image, which is structurally a wallpaper scene.',
    };
  }

  return undefined;
}

function sourceTypeHint(name: string): ComponentAssetType | undefined {
  const normalized = String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || isMeaninglessName(normalized)) return undefined;
  const matches = componentAssetTypes
    .filter((type) => type !== 'Unknown')
    .flatMap((type) => {
      const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, '\\s+');
      const match = new RegExp(`\\b${words}s?\\b`, 'i').exec(normalized);
      return match ? [{ type, index: match.index }] : [];
    })
    .sort((left, right) => right.index - left.index || right.type.length - left.type.length);
  return matches[0]?.type;
}

/**
 * A human label is evidence, never a local override. When it meaningfully
 * disagrees with the visual result, request an independent visual audit.
 */
export function familySourceTypeHint(family: ComponentVisualFamily): ComponentAssetType | undefined {
  const hints = [...new Set(family.members.map((member) => sourceTypeHint(member.name)).filter(Boolean))];
  return hints.length === 1 ? hints[0] : undefined;
}

export function requiresIndependentFamilyReview(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): boolean {
  if (analysis.conflict || analysis.reviewNeeded || Number(analysis.confidence || 0) < 0.72) return true;
  return familyDecisionConsistencyIssues(analysis, family).length > 0;
}

/**
 * These are review triggers, never local corrections. A second visual model
 * must provide a complete replacement decision before anything changes.
 */
export function familyDecisionConsistencyIssues(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): string[] {
  const issues: string[] = [];
  // Source labels deliberately do not create a review by themselves. They are
  // useful context for the visual model, but they are neither a taxonomy rule
  // nor an independent visual observation. Escalating every name/type mismatch
  // caused harmless Affinity labels to overwhelm the reviewer lane and let
  // hierarchy wording compete with the artwork itself.
  const structureTypes = family
    ? [...new Set(family.members
      .map((member) => visualStructureAnchor(member as ComponentCandidate)?.type)
      .filter(Boolean))]
    : [];
  if (structureTypes.length === 1 && structureTypes[0] !== analysis.assetType) {
    issues.push('Strong rendered structure and visual proposal disagree.');
  }
  const normalized = normalizeAiName(analysis.familyName || '').displayName;
  if (!normalized) issues.push('The visual proposal has no usable overall name.');
  if (analysis.assetType !== 'Unknown') {
    issues.push(...strictProductionName(analysis.familyName || '', analysis.assetType).issues);
  }
  const mentionedTypes = componentAssetTypes
    .filter((type) => type !== 'Unknown')
    .filter((type) => new RegExp(`\\b${type.replace(/([a-z])([A-Z])/g, '$1\\s*$2')}s?\\b`, 'i').test(normalized));
  if (mentionedTypes.some((type) => type !== analysis.assetType)) {
    issues.push('The visual proposal name contains a type that disagrees with its final type.');
  }
  if (analysis.assetType !== 'Unknown' && !mentionedTypes.includes(analysis.assetType)) {
    issues.push(`The visual proposal name is missing its final ${analysis.assetType} type.`);
  }
  if (family && family.members.length > 1 && analysis.memberNames.length > 0) {
    const named = new Set(analysis.memberNames.map((member) => member.visualHash));
    if (family.members.some((member) => !named.has(member.visualHash))) {
      issues.push('The visual proposal omitted one or more construction siblings.');
    }
  }
  if (family) {
    const proposalWords = normalized.toLowerCase().split(/\s+/).filter(Boolean);
    const directWords = new Set(family.members.flatMap((member) => member.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
    for (const parent of family.hierarchyContext?.map((context) => context.parentName).filter(Boolean) || []) {
      const parentWords = parent.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !componentAssetTypes.some((type) => type.toLowerCase() === word));
      if (parentWords.length >= 2 && parentWords.every((word) => proposalWords.includes(word)) && !parentWords.every((word) => directWords.has(word))) {
        issues.push('The visual proposal repeats an ancestor identity that is absent from the target family.');
        break;
      }
    }
  }
  return [...new Set(issues)];
}

/**
 * Checks coherent sibling names without renaming them. Any issue is routed
 * back through the same complete-decision reviewer as a normal uncertainty.
 */
export function familyBatchConsistencyIssues(
  analyses: HostedFamilyAnalysis[],
  families: ComponentVisualFamily[],
): Map<string, string[]> {
  const byId = new Map(families.map((family) => [family.id, family]));
  const scopes = new Map<string, HostedFamilyAnalysis[]>();
  for (const analysis of analyses) {
    const family = byId.get(analysis.familyId);
    if (!family || analysis.assetType === 'Unknown') continue;
    if (!family.members.every((member) => isMeaninglessName(member.name))) continue;
    const key = family.namingScopeKey || family.members[0]?.parentHierarchyKey;
    if (!key) continue;
    const scope = scopes.get(key) || [];
    scope.push(analysis);
    scopes.set(key, scope);
  }
  const issues = new Map<string, string[]>();
  for (const scope of scopes.values()) {
    if (scope.length < 2) continue;
    const ordered = [...scope].sort((left, right) => {
      const leftFamily = byId.get(left.familyId);
      const rightFamily = byId.get(right.familyId);
      const ordinalDelta = (leftFamily?.siblingOrdinal || Number.MAX_SAFE_INTEGER) - (rightFamily?.siblingOrdinal || Number.MAX_SAFE_INTEGER);
      if (ordinalDelta) return ordinalDelta;
      const leftKey = leftFamily?.members[0]?.hierarchyKey || '';
      const rightKey = rightFamily?.members[0]?.hierarchyKey || '';
      return leftKey.localeCompare(rightKey, undefined, { numeric: true });
    });
    const typeWords = componentAssetTypes
      .filter((type) => type !== 'Unknown')
      .map((type) => type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const roots = ordered.map((analysis) => normalizeAiName(analysis.familyName)
      .displayName.toLowerCase()
      .replace(new RegExp(`\\b(?:${typeWords})s?\\b`, 'gi'), '')
      .replace(/\b\d+\b/g, '')
      .replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const numbered = ordered.map((analysis) => Number(/\b(\d+)\s*$/.exec(analysis.familyName)?.[1] || 0));
    const inconsistentTypes = new Set(ordered.map((analysis) => analysis.assetType)).size > 1;
    const inconsistentRoot = new Set(roots).size > 1;
    const outOfOrderNumbering = numbered.some((number, index) => number !== index + 1);
    if (!inconsistentTypes && !inconsistentRoot && !outOfOrderNumbering) continue;
    const reason = inconsistentTypes
      ? 'Anonymous construction siblings disagree on their shared construction type.'
      : inconsistentRoot
        ? 'Anonymous construction siblings do not share one visual root.'
        : 'Anonymous construction sibling numbering does not follow document order.';
    for (const analysis of ordered) issues.set(analysis.familyId, [reason]);
  }
  return issues;
}

function fingerprint(memberHashes: string[], parentNames: string[], sourceNames: string[] = [], hierarchyKeys: string[] = []): string {
  return createHash('sha256')
    .update(JSON.stringify({
      members: [...new Set(memberHashes)].sort(),
      parents: [...new Set(parentNames.map((name) => name.trim().toLowerCase()).filter(Boolean))].sort(),
      names: [...new Set(sourceNames.map((name) => name.trim().toLowerCase()).filter(Boolean))].sort(),
      hierarchy: [...new Set(hierarchyKeys)].sort(),
    }))
    .digest('hex');
}

function approvedDecisionFor(
  _memberHashes: string[],
  familyFingerprint: string,
  decisions: ComponentDecision[],
  project: string,
): ComponentDecision | undefined {
  return decisions
    .filter((decision) => decision.approved !== false && decision.decisionStatus !== 'generated')
    .filter((decision) => !decision.project || decision.scope === 'global' || decision.project === project)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    // An accepted correction may inform the local learner by visual hash, but
    // it cannot bypass a new hierarchy decision. Only an exact decision graph
    // fingerprint is safe to reuse as a final answer.
    .find((decision) => decision.familyFingerprint === familyFingerprint);
}

function score(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : 0;
}

function familyReviewSignals(members: ComponentCandidate[]): ComponentFamilyReviewSignals {
  const localTypes = members
    .map((member) => member.assetType)
    .filter((assetType) => assetType && assetType !== 'Unknown');
  const typeCounts = new Map<ComponentAssetType, number>();
  for (const assetType of localTypes) typeCounts.set(assetType, (typeCounts.get(assetType) || 0) + 1);
  const majorityTypeCount = Math.max(0, ...typeCounts.values());
  const roleCounts = new Map<ComponentCandidate['role'], number>();
  for (const member of members) {
    if (member.role && member.role !== 'Unknown') roleCounts.set(member.role, (roleCounts.get(member.role) || 0) + 1);
  }
  return {
    // A family is only as reliable as its least certain member. This prevents
    // one confident duplicate from hiding an uncertain variant.
    localConfidence: members.length ? Math.min(...members.map((member) => score(member.aiConfidence))) : 0,
    localMargin: members.length ? Math.min(...members.map((member) => score(member.aiMargin))) : 0,
    visualStructureConfidence: members.length
      ? Math.min(...members.map((member) => score(member.visualStructureConfidence)))
      : 0,
    semanticConflict: members.some((member) => Boolean(member.semanticConflict)),
    meaningfulLayerName: members.some((member) => (
      ['layer-name', 'both', 'memory'].includes(member.nameSource || '')
      && !isMeaninglessName(member.name)
    )),
    hierarchyAmbiguity: members.length
      ? Math.max(...members.map((member) => (
        member.childHierarchyKeys.length ? 1 - score(member.diveConfidence) : 0
      )))
      : 1,
    learnedSimilarity: Math.max(0, ...members.map((member) => score(member.nearestLearnedSimilarity))),
    learnedFrom: Math.max(0, ...members.map((member) => Number(member.learnedFrom || 0))),
    localTypeAgreement: localTypes.length ? majorityTypeCount / localTypes.length : 0,
    localAssetType: [...typeCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0],
    localRole: [...roleCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0],
  };
}

/**
 * Decide whether the embedded classifier is safe to trust for this family.
 * The local path may skip hosted review only when several independent signals
 * agree. A conflict, weak margin, or ambiguous hierarchy always keeps the
 * family on a hosted path, so a confidently wrong local prediction is not
 * silently promoted to a final answer.
 */
export function planHostedFamilyReview(family: ComponentVisualFamily): HostedFamilyReviewPlan {
  if (family.approvedDecision) {
    return { tier: 'local', riskScore: 0, reasons: ['Reused an existing user-approved family decision.'] };
  }
  const signals = family.reviewSignals;
  if (!signals) {
    return {
      tier: 'escalation',
      riskScore: 1,
      reasons: ['No local review signals were available, so cloud review is required.'],
    };
  }
  const reasons: string[] = [];
  if (signals.semanticConflict) reasons.push('The semantic name signal conflicts with the visual classifier.');
  if (signals.localConfidence < 0.9) reasons.push('Local confidence is below the safe auto-accept threshold.');
  if (signals.localMargin < 0.18) reasons.push('The local classifier has a narrow margin over its alternatives.');
  if (signals.visualStructureConfidence > 0 && signals.visualStructureConfidence < 0.82) {
    reasons.push('Rendered structure evidence is incomplete or weak.');
  }
  if (signals.hierarchyAmbiguity > 0.2) reasons.push('The family has hierarchy or dive ambiguity.');
  if (!signals.meaningfulLayerName) reasons.push('There is no meaningful human-authored layer-name evidence.');

  const clearSignals = [
    signals.localConfidence >= 0.9 && signals.localMargin >= 0.18,
    signals.visualStructureConfidence >= 0.82,
    !signals.semanticConflict && signals.localTypeAgreement >= 0.85,
    signals.meaningfulLayerName,
    signals.hierarchyAmbiguity <= 0.2,
    signals.learnedFrom > 0 && signals.learnedSimilarity >= 0.96,
  ].filter(Boolean).length;
  const escalationSignals = [
    signals.semanticConflict && (
      signals.localConfidence < 0.78
      || signals.localMargin < 0.12
      || (signals.visualStructureConfidence > 0 && signals.visualStructureConfidence < 0.6)
    ),
    signals.localConfidence < 0.58,
    signals.localMargin < 0.06,
    signals.visualStructureConfidence > 0 && signals.visualStructureConfidence < 0.45,
    signals.hierarchyAmbiguity > 0.55,
  ].filter(Boolean).length;
  const riskScore = Math.max(
    signals.semanticConflict ? 0.35 : 0,
    (1 - signals.localConfidence) * 0.9,
    (1 - signals.localMargin) * 0.65,
    signals.hierarchyAmbiguity * 0.5,
    signals.visualStructureConfidence > 0 ? (1 - signals.visualStructureConfidence) * 0.45 : 0.18,
  );

  if (escalationSignals >= 2 || (
    signals.semanticConflict
    && (signals.localConfidence < 0.68 || signals.localMargin < 0.1)
  )) {
    return {
      tier: 'escalation',
      riskScore: Math.min(1, riskScore),
      reasons: reasons.length ? reasons : ['Multiple local signals disagree.'],
    };
  }
  if (
    clearSignals >= 3
    && signals.localConfidence >= 0.88
    && signals.localMargin >= 0.15
    && !signals.semanticConflict
  ) {
    return {
      tier: 'local',
      riskScore: Math.min(1, riskScore),
      reasons: ['Local confidence, alternatives margin, hierarchy, and semantic evidence agree.'],
    };
  }
  return {
    tier: 'lite',
    riskScore: Math.min(1, riskScore),
    reasons: reasons.length ? reasons : ['The family is not safe for local-only classification yet.'],
  };
}

/**
 * Count families resolved without a cloud request for the current availability
 * path. Approved decisions stay local when the gateway is available; when the
 * gateway is unavailable, unresolved families remain local and provisional.
 */
export function countLocallyHandledFamilies(
  families: ComponentVisualFamily[],
  cloudAvailable: boolean,
): number {
  return families.filter((family) => cloudAvailable ? Boolean(family.approvedDecision) : !family.approvedDecision).length;
}

function boundaryMember(component: ComponentCandidate): ComponentVisualFamily['members'][number] {
  return {
    id: component.id,
    visualHash: component.visualHash,
    name: component.name,
    affinityType: component.affinityType,
    bounds: component.bounds,
    hierarchyKey: component.hierarchyKey,
    parentHierarchyKey: component.parentHierarchyKey,
    childHierarchyKeys: component.childHierarchyKeys,
    previewUrl: component.previewUrl,
    hostedPreviewUrl: component.hostedPreviewUrl,
    analysisPreviewUrls: component.analysisPreviewUrls || [],
    visualMetrics: component.visualMetrics,
  };
}

function boundaryReason(boundary: ComponentAssetBoundary): string {
  switch (boundary) {
    case 'composed-parent':
      return 'This editable group is the composed export owner for its overlapping construction layers.';
    case 'construction-child':
      return 'This layer is construction artwork inside an owned composed asset, so it is not a competing export decision.';
    case 'organizational-parent':
      return 'This group is structural organization only; its children are the export decisions.';
    case 'duplicate-representation':
      return 'An editable composed representation renders the same pixels, so this flattened duplicate is retained only as evidence.';
    default:
      return 'This layer is an independent export decision.';
  }
}

/**
 * Export ownership and semantic naming are separate concerns. A construction
 * layer cannot compete with its composed parent in the export plan, but it
 * still needs a visual name and classification so the document remains
 * intelligible and can be organised consistently.
 */
function receivesSemanticDecision(component: ComponentCandidate): boolean {
  return ['standalone', 'composed-parent', 'construction-child']
    .includes(component.assetBoundary || 'standalone');
}

function ownsAssetExport(component: ComponentCandidate): boolean {
  return ['standalone', 'composed-parent'].includes(component.assetBoundary || 'standalone');
}

function semanticExportReady(component: ComponentCandidate): boolean {
  if (component.analysisSource === 'local-provisional' || component.analysisSource === 'unavailable' || component.analysisState === 'provisional' || component.analysisState === 'queued') return false;
  if (component.analysisSource === 'hosted-family' && (
    component.analysisState === 'needs-review'
    || component.semanticConflict
    || component.assetType === 'Unknown'
    || component.role === 'Unknown'
  )) return false;
  return true;
}

/**
 * Establish structural ownership before any hosted semantic decision. This is
 * deliberately generic: it only uses hierarchy, dive policy, and exact render
 * identity. Names and asset types remain entirely model-owned later.
 */
export function applyAssetBoundaries(components: ComponentCandidate[]): ComponentCandidate[] {
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  const duplicateOwnerByRender = new Map<string, ComponentCandidate>();
  for (const component of components) {
    const render = component.renderHash || component.visualHash;
    if (!component.childHierarchyKeys.length) continue;
    const current = duplicateOwnerByRender.get(render);
    if (!current
      || component.childHierarchyKeys.length > current.childHierarchyKeys.length
      || (component.childHierarchyKeys.length === current.childHierarchyKeys.length
        && component.hierarchyDepth < current.hierarchyDepth)
    ) {
      duplicateOwnerByRender.set(render, component);
    }
  }

  const visit = (component: ComponentCandidate, inheritedOwner?: ComponentCandidate): void => {
    const render = component.renderHash || component.visualHash;
    const duplicateOwner = duplicateOwnerByRender.get(render);
    const children = component.childHierarchyKeys
      .map((key) => byKey.get(key))
      .filter((child): child is ComponentCandidate => Boolean(child));
    const boundaryDiveMode = component.structuralDiveMode || component.diveMode;
    if (!component.structuralDiveMode) component.structuralDiveMode = boundaryDiveMode;
    component.diveMode = boundaryDiveMode;

    if (
      !children.length
      && duplicateOwner
      && duplicateOwner.hierarchyKey !== component.hierarchyKey
      && (component.keptInsideParent || (component.renderHash || component.visualHash) === (duplicateOwner.renderHash || duplicateOwner.visualHash))
    ) {
      component.assetBoundary = 'duplicate-representation';
      component.boundaryOwnerHierarchyKey = duplicateOwner.hierarchyKey;
      component.decisionScopeKey = duplicateOwner.hierarchyKey;
      component.boundaryReason = boundaryReason(component.assetBoundary);
      component.exportTarget = false;
      component.reviewPriority = 'ready';
      component.reviewReasons = [];
      return;
    }
    if (inheritedOwner) {
      component.assetBoundary = 'construction-child';
      component.boundaryOwnerHierarchyKey = inheritedOwner.hierarchyKey;
      component.decisionScopeKey = inheritedOwner.hierarchyKey;
      component.boundaryReason = boundaryReason(component.assetBoundary);
      component.exportTarget = false;
      component.reviewPriority = 'ready';
      component.reviewReasons = [];
      children.forEach((child) => visit(child, inheritedOwner));
      return;
    }
    if (!children.length) {
      component.assetBoundary = 'standalone';
      component.boundaryOwnerHierarchyKey = component.hierarchyKey;
      component.decisionScopeKey = byKey.has(component.parentHierarchyKey)
        ? component.parentHierarchyKey
        : component.hierarchyKey;
      component.boundaryReason = boundaryReason(component.assetBoundary);
      component.exportTarget = semanticExportReady(component);
      return;
    }
    if (boundaryDiveMode === 'children-only') {
      component.assetBoundary = 'organizational-parent';
      component.boundaryOwnerHierarchyKey = component.hierarchyKey;
      component.decisionScopeKey = component.hierarchyKey;
      component.boundaryReason = boundaryReason(component.assetBoundary);
      component.exportTarget = false;
      component.reviewPriority = 'ready';
      component.reviewReasons = [];
      children.forEach((child) => visit(child));
      return;
    }
    component.assetBoundary = 'composed-parent';
    component.boundaryOwnerHierarchyKey = component.hierarchyKey;
    component.decisionScopeKey = component.hierarchyKey;
    component.boundaryReason = boundaryReason(component.assetBoundary);
    component.exportTarget = semanticExportReady(component);
    children.forEach((child) => visit(child, boundaryDiveMode === 'keep-together' ? component : undefined));
  };

  const roots = components.filter((component) => !component.parentHierarchyKey || !byKey.has(component.parentHierarchyKey));
  roots.forEach((component) => visit(component));
  // Be defensive about malformed hierarchy exports: every node still gets a
  // deterministic structural boundary rather than silently retaining stale state.
  for (const component of components) {
    if (!component.assetBoundary) visit(component);
  }
  return components;
}

export function buildVisualFamilies(
  components: ComponentCandidate[],
  decisions: ComponentDecision[],
  project: string,
  documentTitle: string,
): ComponentVisualFamily[] {
  applyAssetBoundaries(components);
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  const grouped = new Map<string, ComponentCandidate[]>();
  for (const component of components) {
    // Pixel equality is a render-deduplication signal, not semantic identity.
    // A group, its flattened raster duplicate, and a child fragment may render
    // identical pixels while belonging to different export decisions.
    if (!receivesSemanticDecision(component)) continue;
    const renderIdentity = component.renderHash || component.visualHash;
    const key = [component.assetBoundary, component.decisionScopeKey || component.hierarchyKey, renderIdentity].join('|');
    const family = grouped.get(key) || [];
    family.push(component);
    grouped.set(key, family);
  }

  const families = [...grouped.entries()].map(([decisionIdentity, members]) => {
    const owner = members[0];
    const decisionScopeKey = owner.decisionScopeKey || owner.hierarchyKey;
    const ownerParent = byKey.get(owner.parentHierarchyKey);
    const exportSiblings = (ownerParent?.childHierarchyKeys || [owner.hierarchyKey])
      .map((key) => byKey.get(key))
      .filter((sibling): sibling is ComponentCandidate => Boolean(sibling))
      .filter((sibling) => receivesSemanticDecision(sibling));
    const siblingOrdinal = exportSiblings.findIndex((sibling) => sibling.hierarchyKey === owner.hierarchyKey) + 1;
    const id = `scope-${createHash('sha256').update(decisionIdentity).digest('hex').slice(0, 24)}`;
    const parentNames = members
      .map((member) => byKey.get(member.parentHierarchyKey)?.name || '')
      .filter(Boolean);
    const memberHashes = members.map((member) => member.visualHash);
    const familyFingerprint = fingerprint(
      memberHashes,
      parentNames,
      members.map((member) => member.name),
      members.map((member) => `${member.parentHierarchyKey}>${member.hierarchyKey}`),
    );
    const hierarchyContext = members.map((member) => {
      const parent = byKey.get(member.parentHierarchyKey);
      const ancestorNames: string[] = [];
      let ancestor = parent;
      while (ancestor && ancestorNames.length < 5) {
        ancestorNames.push(ancestor.name);
        ancestor = byKey.get(ancestor.parentHierarchyKey);
      }
      return {
        hierarchyKey: member.hierarchyKey,
        parentName: parent?.name || '',
        ancestorNames,
        childNames: member.childHierarchyKeys.map((key) => byKey.get(key)?.name || '').filter(Boolean),
        siblingNames: parent?.childHierarchyKeys
          .filter((key) => key !== member.hierarchyKey)
          .map((key) => byKey.get(key)?.name || '')
          .filter(Boolean)
          .slice(0, 16) || [],
      };
    });
    const contextMembers = owner.assetBoundary === 'composed-parent'
      ? owner.childHierarchyKeys
        .map((key) => byKey.get(key))
        .filter((child): child is ComponentCandidate => Boolean(child))
        .slice(0, 12)
        .map(boundaryMember)
      : [];
    return {
      id,
      fingerprint: familyFingerprint,
      project,
      documentTitle,
      namingScopeKey: decisionScopeKey,
      decisionScopeKey,
      assetBoundary: owner.assetBoundary,
      structuralDiveMode: owner.structuralDiveMode || owner.diveMode,
      ...(siblingOrdinal > 0 ? { siblingOrdinal, siblingCount: exportSiblings.length } : {}),
      parentNames: [...new Set(parentNames)],
      members: members.map(boundaryMember),
      ...(contextMembers.length ? { contextMembers } : {}),
      representativeHash: members[0].visualHash,
      exactInstanceCount: Math.max(
        members.length,
        ...members.map((member) => Math.max(1, member.duplicateCount)),
      ),
      hierarchyContext,
      reviewSignals: familyReviewSignals(members),
      approvedDecision: approvedDecisionFor(memberHashes, familyFingerprint, decisions, project),
    };
  });
  // Similarity is visual evidence, not authority to merge semantic scopes.
  // Separate hierarchy roots stay separate even when they look alike; only an
  // exact flattened representation can be suppressed by applyAssetBoundaries.
  return families;
}

export function applyApprovedFamilies(
  components: ComponentCandidate[],
  families: ComponentVisualFamily[],
): ComponentCandidate[] {
  const familyByHierarchyKey = new Map<string, ComponentVisualFamily>();
  for (const family of families) {
    for (const member of family.members) familyByHierarchyKey.set(member.hierarchyKey, family);
  }
  return components.map((component) => {
    if (!receivesSemanticDecision(component)) {
      return {
        ...component,
        familyName: '',
        layerLabel: component.name,
        exportName: undefined,
        codeName: undefined,
        assetType: 'Unknown',
        role: 'Unknown',
        exportTarget: false,
        analysisSource: 'local-provisional',
        analysisState: 'analyzed',
        analysisReason: component.boundaryReason || 'This structural layer is not an independent export decision.',
        automationState: 'ready',
        automationIssues: undefined,
      };
    }
    const family = familyByHierarchyKey.get(component.hierarchyKey);
    const decision = family?.approvedDecision;
    if (!family || !decision) {
      return {
        ...component,
        familyFingerprint: family?.fingerprint,
        familyMemberHashes: family?.members.map((member) => member.visualHash),
        analysisSource: 'unavailable',
        analysisState: 'queued',
        analysisReason: 'This visual family has not been reviewed yet.',
      };
    }
    return {
      ...component,
      familyFingerprint: family.fingerprint,
      familyMemberHashes: family.members.map((member) => member.visualHash),
      familyName: decision.memberNames?.find((member) => member.visualHash === component.visualHash)?.name || decision.exportName || decision.familyName,
      layerLabel: decision.memberNames?.find((member) => member.visualHash === component.visualHash)?.name || decision.exportName || decision.familyName,
      exportName: decision.memberNames?.find((member) => member.visualHash === component.visualHash)?.name || decision.exportName || decision.familyName,
      assetType: decision.assetType || 'Unknown',
      role: decision.role,
      reviewCategory: reviewCategory(decision.assetType || 'Unknown'),
      diveMode: decision.diveMode || component.diveMode,
      structuralDiveMode: decision.diveMode || component.structuralDiveMode || component.diveMode,
      remembered: true,
      analysisSource: 'approved-family',
      analysisState: 'approved',
      analysisReason: 'Reused from an approved visual family.',
      aiSuggestedName: decision.suggestedName,
      aiSuggestedType: decision.suggestedType,
      aiSuggestedRole: decision.suggestedRole,
      aiSource: 'memory',
    };
  });
}

export function applyHostedFamilyAnalyses(
  components: ComponentCandidate[],
  families: ComponentVisualFamily[],
  analyses: HostedFamilyAnalysis[],
): ComponentCandidate[] {
  const familyByHierarchyKey = new Map<string, ComponentVisualFamily>();
  for (const family of families) {
    for (const member of family.members) familyByHierarchyKey.set(member.hierarchyKey, family);
  }
  const analysisById = new Map(analyses.map((analysis) => [analysis.familyId, analysis]));
  return components.map((component) => {
    if (!receivesSemanticDecision(component)) {
      return {
        ...component,
        familyName: '',
        layerLabel: component.name,
        exportName: undefined,
        codeName: undefined,
        assetType: 'Unknown',
        role: 'Unknown',
        exportTarget: false,
        analysisSource: 'local-provisional',
        analysisState: 'analyzed',
        analysisReason: component.boundaryReason || 'This structural layer is not an independent export decision.',
        automationState: 'ready',
        automationIssues: undefined,
      };
    }
    if (component.analysisSource === 'approved-family') return component;
    const family = familyByHierarchyKey.get(component.hierarchyKey);
    const analysis = family ? analysisById.get(family.id) : undefined;
    if (!family || !analysis) {
      return {
        ...component,
        familyFingerprint: family?.fingerprint,
        familyMemberHashes: family?.members.map((member) => member.visualHash),
        // A missing cloud packet is not a semantic decision. Do not leave the
        // local bootstrap guess in the export fields where it can be mistaken
        // for an accepted AI classification.
        familyName: '',
        layerLabel: undefined,
        exportName: undefined,
        codeName: undefined,
        assetType: 'Unknown',
        role: 'Unknown',
        exportTarget: false,
        automationState: 'exception',
        automationIssues: ['This visual family did not receive a complete cloud decision. Rescan before exporting it.'],
        analysisSource: 'local-provisional',
        analysisState: 'provisional',
        analysisReason: 'No cloud result was returned for this visual family. The current values are provisional.',
      };
    }
    const memberName = analysis.memberNames.find((member) => member.visualHash === component.visualHash)?.name;
    const assetType = analysis.assetType;
    const role = analysis.role;
    const rawName = memberName || analysis.familyName || '';
    const normalizedName = normalizeAiName(rawName).displayName;
    const proposedName = isOpaqueModelName(normalizedName) ? '' : normalizedName;
    // The hosted model is the sole author of semantic identity. Kryeo may flag
    // a weak name later, but it must retain the model's actual proposal rather
    // than erase, replace, or create a second local name.
    const namePacketIsUsable = assetType !== 'Unknown'
      && role !== 'Unknown'
      && strictProductionName(proposedName, assetType).issues.length === 0;
    const familyName = namePacketIsUsable ? proposedName : '';
    const consistencyIssues = familyDecisionConsistencyIssues(analysis, family);
    const semanticReason = analysis.reason;
    const plannedDiveMode = component.structuralDiveMode || component.diveMode;
    const groupingConflict = component.childHierarchyKeys.length > 0 && analysis.diveMode !== plannedDiveMode;
    const completeDecision = namePacketIsUsable;
    const semanticConflict = Boolean(analysis.conflict || analysis.reviewNeeded || !completeDecision || groupingConflict || consistencyIssues.length);
    const semanticConflictMessage = analysis.conflictMessage
      || (groupingConflict
        ? 'The visual grouping proposal disagrees with the already planned hierarchy boundary, so this scope needs one complete review decision.'
        : consistencyIssues[0]);
    return {
      ...component,
      familyFingerprint: family.fingerprint,
      familyMemberHashes: family.members.map((member) => member.visualHash),
      familyName,
      assetType,
      role,
      aiModelSuggestedName: analysis.modelFamilyName || analysis.familyName,
      aiModelSuggestedType: analysis.modelAssetType || analysis.assetType,
      aiNormalizationReason: analysis.normalizationReason,
      reviewCategory: reviewCategory(assetType),
      // The boundary graph was established before semantics. A model may
      // challenge grouping, but it cannot split a group after its children
      // were intentionally excluded from classification.
      diveMode: plannedDiveMode,
      aiSuggestedName: familyName,
      aiSuggestedType: assetType,
      aiSuggestedRole: role,
      aiConfidence: analysis.confidence,
      aiEvidence: analysis.evidence,
      aiSource: 'model',
      aiReason: semanticReason,
      analysisSource: 'hosted-family',
      analysisState: analysis.reviewNeeded || semanticConflict ? 'needs-review' : 'analyzed',
      analysisReason: semanticReason,
      analysisAlternatives: analysis.alternatives,
      semanticConflict,
      semanticConflictMessage: semanticConflictMessage || (!completeDecision
        ? 'The cloud response did not contain one usable name, type, and Roblox role decision.'
        : undefined),
      // A complete child decision is used for Affinity naming and hierarchy
      // context, never to create a second PNG beside its composed parent.
      exportTarget: ownsAssetExport(component) && !semanticConflict,
      automationState: semanticConflict ? 'exception' : 'ready',
      automationIssues: semanticConflict
        ? ['Kryeo kept this visual out of the export queue until one complete decision is available.']
        : undefined,
      remembered: false,
    };
  });
}

/**
 * A challenge is allowed to replace a family only as one complete decision.
 * Keeping the primary result intact when a reviewer supplies partial criticism
 * prevents the name/type/role contradictions that used to leak into the UI.
 */
export function resolveChallengedFamilyAnalysis(
  primary: HostedFamilyAnalysis,
  challenge: HostedFamilyEvidenceResult,
): HostedFamilyAnalysis {
  const hasCompleteReplacement = challenge.supportsClassification === false
    && Boolean(challenge.suggestedName)
    && Boolean(challenge.suggestedType)
    && Boolean(challenge.suggestedRole)
    && strictProductionName(challenge.suggestedName || '', challenge.suggestedType || 'Unknown').issues.length === 0;
  if (!hasCompleteReplacement) {
    // A reviewer that rejects the primary decision without supplying the
    // complete replacement is useful evidence, but not safe authorization to
    // partially mutate a decision. Keep the complete primary packet intact
    // and expose it as unresolved instead of allowing the UI to call it ready.
    if (challenge.supportsClassification === false || challenge.conflict) {
      return {
        ...primary,
        conflict: true,
        conflictMessage: challenge.conflictMessage
          || 'An independent visual review found a conflict but did not return a complete replacement decision.',
        reviewNeeded: true,
        alternatives: challenge.alternatives?.length ? challenge.alternatives : primary.alternatives,
        normalizationReason: 'The original name, type, and role were kept together because the independent review did not provide a complete replacement.',
      };
    }
    return primary;
  }
  const replacementName = normalizeAiName(challenge.suggestedName || '').displayName;
  if (!replacementName) return primary;
  return {
    ...primary,
    familyName: replacementName,
    assetType: challenge.suggestedType!,
    role: challenge.suggestedRole!,
    memberNames: primary.memberNames.map((member) => ({ ...member, name: replacementName })),
    reason: challenge.reason,
    visualDescription: challenge.visualDescription,
    confidence: challenge.confidence,
    evidence: challenge.evidence,
    // The reviewer has supplied a complete replacement, so the resolver has
    // chosen it. Keep the replacement accepted; retaining `conflict: true`
    // here used to turn every valid reviewer correction into an unresolved
    // export exception even though name, type, role, and members were atomic.
    conflict: false,
    conflictMessage: '',
    reviewNeeded: false,
    alternatives: challenge.alternatives,
    modelFamilyName: primary.modelFamilyName || primary.familyName,
    modelAssetType: primary.modelAssetType || primary.assetType,
    normalizationReason: 'A complete independent visual replacement was applied atomically to the name, type, and Roblox role.',
  };
}

export function resolveIndependentFamilyAnalysis(
  primary: HostedFamilyAnalysis,
  reviewer: HostedFamilyAnalysis | undefined,
): HostedFamilyAnalysis {
  const primaryComplete = primary.assetType !== 'Unknown'
    && primary.role !== 'Unknown'
    && strictProductionName(primary.familyName || '', primary.assetType).issues.length === 0;
  const complete = Boolean(reviewer)
    && reviewer!.assetType !== 'Unknown'
    && reviewer!.role !== 'Unknown'
    && !reviewer!.conflict
    && strictProductionName(reviewer!.familyName || '', reviewer!.assetType).issues.length === 0;
  if (!complete || !reviewer) {
    if (primaryComplete) {
      // The resolver must choose one whole decision. A reviewer that returns
      // criticism, an invalid row, or no row cannot partially erase a usable
      // primary packet; retain that original atomically and record the failed
      // challenge in the reason/normalization metadata for developer review.
      return {
        ...primary,
        conflict: false,
        conflictMessage: '',
        reviewNeeded: false,
        alternatives: reviewer?.alternatives?.length ? reviewer.alternatives : primary.alternatives,
        reason: `${primary.reason} The independent visual review did not return a complete replacement, so Kryeo retained the complete primary decision atomically.`,
        normalizationReason: 'The reviewer response was incomplete; the complete primary name, type, role, grouping, and member names were retained together.',
      };
    }
    return {
      ...primary,
      conflict: true,
      reviewNeeded: true,
      conflictMessage: 'The independent visual review did not return one complete replacement decision.',
    };
  }
  const changed = reviewer.familyName !== primary.familyName
    || reviewer.assetType !== primary.assetType
    || reviewer.role !== primary.role
    || reviewer.diveMode !== primary.diveMode;
  return {
    ...reviewer,
    familyId: primary.familyId,
    fingerprint: primary.fingerprint,
    // A complete reviewer packet is the deterministic resolver's selected
    // decision, whether it confirms or replaces the primary. A replacement
    // is recorded in normalizationReason, not left marked as a live conflict.
    conflict: false,
    conflictMessage: '',
    // A reviewer may mark a genuinely close visual reading as uncertain while
    // still returning a complete best decision. The uncertainty remains
    // visible through confidence/alternatives, but it must not block the
    // atomic replacement or leave every challenged family unresolved.
    reviewNeeded: false,
    alternatives: reviewer.alternatives?.length ? reviewer.alternatives : primary.alternatives,
    modelFamilyName: primary.modelFamilyName || primary.familyName,
    modelAssetType: primary.modelAssetType || primary.assetType,
    normalizationReason: changed
      ? 'A complete independent visual replacement was applied atomically to name, type, role, grouping, and member names.'
      : 'The independent visual reviewer confirmed the complete primary decision.',
  };
}
