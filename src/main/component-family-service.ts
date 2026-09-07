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
  canonicalAiNameForType,
  componentAssetTypes,
  hasCompatibleRobloxRole,
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




  if (largeLandscape && renderedImage && hasDenseRenderedContent) {
    return {
      type: 'Wallpaper',
      confidence: 0.94,
      reason: 'The rendered layer is a large, densely covered imported image, which is structurally a wallpaper scene.',
    };
  }

  return undefined;
}






export function finalizeFamilyDecisionContract(
  analysis: HostedFamilyAnalysis,
  _family: ComponentVisualFamily | undefined,
): HostedFamilyAnalysis {
  return analysis;
}

function sourceTypeHint(name: string): ComponentAssetType | undefined {
  const normalized = String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
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

function uniqueSourceTypeHints(names: string[]): ComponentAssetType[] {
  return [...new Set(names.map((name) => sourceTypeHint(name)).filter(Boolean))] as ComponentAssetType[];
}

// These words describe a document's structure or the allowed output
// taxonomy. They do not identify an individual target. Keeping this list
// generic lets us detect a parent-name leak without turning any source label
// into a local naming rule.
const NON_IDENTITY_SOURCE_WORDS = new Set([
  ...componentAssetTypes
    .filter((type) => type !== 'Unknown')
    .flatMap((type) => type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/))
    .flatMap((word) => [word, `${word}s`]),
  'ui', 'root', 'container', 'containers', 'group', 'groups', 'layer', 'layers',
  'middle', 'outer', 'inner', 'center', 'centre', 'base', 'main', 'foreground',
  'backdrop', 'outline', 'outlines', 'content', 'contents', 'top', 'bottom',
  'left', 'right', 'side', 'sides', 'glow', 'shine', 'highlight', 'light', 'shadow',
]);

function sourceIdentityWords(value: string): string[] {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !/^\d+$/.test(word) && !NON_IDENTITY_SOURCE_WORDS.has(word));
}

/**
 * Detect one narrow failure: a model used an ancestor's distinctive identity
 * as the target name while omitting the target's own meaningful identity.
 * This only requests a fresh complete visual decision; it never generates or
 * substitutes a name from the source document.
 */
export function familySourceIdentityLeakageIssues(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): string[] {
  if (!family || !analysis.familyName) return [];
  const directNames = [...new Set(family.members
    .map((member) => member.name)
    .filter((name) => !isMeaninglessName(name))
    .filter((name) => sourceIdentityWords(name).length > 0))];
  // A family with several distinct direct labels is genuinely ambiguous. Do
  // not pretend local text can decide which identity should win.
  if (directNames.length !== 1) return [];
  const directWords = new Set(sourceIdentityWords(directNames[0]));
  const ancestorWords = new Set([
    ...family.parentNames,
    ...(family.hierarchyContext || []).flatMap((context) => [
      context.parentName,
      ...(context.ancestorNames || []),
    ]),
  ].flatMap(sourceIdentityWords));
  const proposedWords = new Set(sourceIdentityWords(analysis.familyName));
  const copiedAncestorIdentity = [...proposedWords].some((word) => ancestorWords.has(word));
  const omittedDirectIdentity = [...directWords].every((word) => !proposedWords.has(word));
  if (!copiedAncestorIdentity || !omittedDirectIdentity) return [];
  return [
    'The proposed name reused an ancestor identity while omitting the meaningful direct identity of this target; an independent visual reviewer must return one complete target-specific decision.',
  ];
}

/**
 * A human label is evidence, never a local override. When it meaningfully
 * disagrees with the visual result, request an independent visual audit.
 */
export function familySourceTypeHint(family: ComponentVisualFamily): ComponentAssetType | undefined {
  const hints = uniqueSourceTypeHints(family.members.map((member) => member.name));
  return hints.length === 1 ? hints[0] : undefined;
}

/**
 * A direct source label can challenge a primary visual packet, but it can
 * never select the replacement. Keeping this separate from the final
 * consistency validator is important: once an independent visual reviewer
 * has returned a complete packet, Kryeo accepts that visual decision even if
 * the old Affinity label disagrees with it.
 */
export function familyPrimaryEvidenceIssues(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): string[] {
  if (!family || analysis.assetType === 'Unknown') return [];
  const directTypeHint = family.sourceTypeHint || familySourceTypeHint(family);
  if (!directTypeHint || directTypeHint === analysis.assetType) return [];
  return [
    `The target's direct source type cue suggests ${directTypeHint}, while the primary visual packet selected ${analysis.assetType}; an independent visual reviewer must resolve the disagreement with one complete decision. The source cue is evidence only and does not choose the answer.`,
  ];
}

export function requiresIndependentFamilyReview(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): boolean {






  const hasUsablePacket = analysis.assetType !== 'Unknown'
    && analysis.role !== 'Unknown'
    && hasCompatibleRobloxRole(analysis.assetType, analysis.role)
    && strictProductionName(analysis.familyName || '', analysis.assetType).issues.length === 0;
  if (!hasUsablePacket) return true;






  if (analysis.conflict) return true;
  return familyPrimaryEvidenceIssues(analysis, family).length > 0
    || familyDecisionConsistencyIssues(analysis, family).length > 0;
}





export function familyDecisionConsistencyIssues(
  analysis: HostedFamilyAnalysis,
  family: ComponentVisualFamily | undefined,
): string[] {
  const issues: string[] = [];



  if (analysis.assetType !== 'Unknown' && analysis.role !== 'Unknown'
    && !hasCompatibleRobloxRole(analysis.assetType, analysis.role)) {
    issues.push(`The model packet pairs ${analysis.assetType} with ${analysis.role}, which violates the generic Roblox export contract; an independent visual reviewer must return one complete replacement packet.`);
  }
  if (family && family.members.length > 1 && analysis.memberNames.length > 0) {
    const named = new Set(analysis.memberNames.map((member) => member.visualHash));
    if (family.members.some((member) => !named.has(member.visualHash))) {
      issues.push('The visual proposal omitted one or more construction siblings.');
    }
  }
  issues.push(...familySourceIdentityLeakageIssues(analysis, family));
  return [...new Set(issues)];
}

/**
 * Checks only genuine construction-name failures after review. Construction
 * siblings may intentionally be different asset types (for example a fill,
 * border, and slot inside one composed control), so type diversity or a
 * visual descriptor difference is never a conflict by itself.
 */
export function familyBatchConsistencyIssues(
  analyses: HostedFamilyAnalysis[],
  families: ComponentVisualFamily[],
): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  const familyById = new Map(families.map((family, index) => [family.id, { family, index }]));
  const addIssue = (familyIds: string[], message: string): void => {
    for (const familyId of familyIds) {
      const current = issues.get(familyId) || [];
      if (!current.includes(message)) current.push(message);
      issues.set(familyId, current);
    }
  };
  const peerScopes = new Map<string, Array<{
    analysis: HostedFamilyAnalysis;
    family: ComponentVisualFamily;
    order: number;
    displayName: string;
  }>>();
  for (const analysis of analyses) {
    const entry = familyById.get(analysis.familyId);
    if (!entry) continue;
    const immediateParent = entry.family.members[0]?.parentHierarchyKey || '';
    const scopeKey = entry.family.assetBoundary === 'construction-child'
      ? `children:${immediateParent || entry.family.namingScopeKey || entry.family.id}`
      : `owners:${entry.family.namingScopeKey || entry.family.decisionScopeKey || entry.family.id}`;
    const peers = peerScopes.get(scopeKey) || [];
    peers.push({
      analysis,
      family: entry.family,
      order: entry.family.siblingOrdinal || entry.index + 1,
      displayName: strictProductionName(analysis.familyName || '', analysis.assetType).displayName,
    });
    peerScopes.set(scopeKey, peers);
  }

  for (const peers of peerScopes.values()) {
    if (peers.length < 2) continue;
    const exactNames = new Map<string, typeof peers>();
    const numberedRoots = new Map<string, typeof peers>();
    for (const peer of peers) {
      const nameKey = peer.displayName.toLowerCase();
      const sameName = exactNames.get(nameKey) || [];
      sameName.push(peer);
      exactNames.set(nameKey, sameName);
      const ordinal = /^(.*\S)\s+(\d+)$/.exec(peer.displayName);
      const root = (ordinal?.[1] || peer.displayName).trim().toLowerCase();
      const rooted = numberedRoots.get(root) || [];
      rooted.push(peer);
      numberedRoots.set(root, rooted);
    }
    for (const duplicatePeers of exactNames.values()) {
      if (duplicatePeers.length < 2 || !duplicatePeers[0].displayName) continue;
      addIssue(
        duplicatePeers.map((peer) => peer.analysis.familyId),
        `Sibling decisions reused the same production name "${duplicatePeers[0].displayName}". The visual reviewer must return distinct complete names for the affected siblings.`,
      );
    }
    for (const rootPeers of numberedRoots.values()) {
      if (rootPeers.length < 2) continue;
      const ordered = [...rootPeers].sort((left, right) => left.order - right.order);
      const ordinals = ordered.map((peer) => Number(/\s(\d+)$/.exec(peer.displayName)?.[1] || 0));
      const hasOrdinal = ordinals.some((ordinal) => ordinal > 0);
      const sequenceIsValid = hasOrdinal && ordinals.every((ordinal, index) => ordinal === index + 1);
      if (hasOrdinal && !sequenceIsValid) {
        addIssue(
          ordered.map((peer) => peer.analysis.familyId),
          `Sibling names sharing "${ordered[0].displayName.replace(/\s+\d+$/, '')}" must use one unique contiguous 1-${ordered.length} ordinal sequence in document order; the current sequence is ${ordinals.map((ordinal) => ordinal || '?').join(', ')}.`,
        );
      }
    }
  }
  return issues;
}

/**
 * Canonicalise terminal ordinals for a same-root construction sibling set.
 * Ordinals are document-order metadata, not visual semantics: changing `2, 1`
 * to `1, 2` must never consume a second model call or make a valid packet
 * unresolved. This preserves every model-authored identity word and the final
 * type/role/grouping, then updates family and member names together as the
 * final atomic decision packet is applied.
 */
export function harmonizeFamilyNames(
  analyses: HostedFamilyAnalysis[],
  families: ComponentVisualFamily[],
): HostedFamilyAnalysis[] {
  const familyById = new Map(families.map((family, index) => [family.id, { family, index }]));
  const peerRoots = new Map<string, Array<{
    analysis: HostedFamilyAnalysis;
    order: number;
    displayName: string;
    root: string;
  }>>();

  for (const analysis of analyses) {
    const entry = familyById.get(analysis.familyId);
    if (!entry || entry.family.assetBoundary !== 'construction-child' || analysis.assetType === 'Unknown') continue;
    const nameContract = strictProductionName(analysis.familyName || '', analysis.assetType);
    if (nameContract.issues.length || !nameContract.displayName) continue;
    const ordinalMatch = /^(.*\S)\s+\d+$/.exec(nameContract.displayName);
    const root = (ordinalMatch?.[1] || nameContract.displayName).trim();
    const parentKey = entry.family.members[0]?.parentHierarchyKey || entry.family.namingScopeKey || entry.family.id;
    const key = `${parentKey}\u0000${analysis.assetType}\u0000${root.toLowerCase()}`;
    const peers = peerRoots.get(key) || [];
    peers.push({
      analysis,
      order: entry.family.siblingOrdinal || entry.index + 1,
      displayName: nameContract.displayName,
      root,
    });
    peerRoots.set(key, peers);
  }

  const replacements = new Map<string, HostedFamilyAnalysis>();
  for (const peers of peerRoots.values()) {
    if (peers.length < 2) continue;
    const ordered = [...peers].sort((left, right) => left.order - right.order);
    for (const [index, peer] of ordered.entries()) {
      const familyName = `${peer.root} ${index + 1}`;
      if (familyName === peer.displayName) continue;
      replacements.set(peer.analysis.familyId, {
        ...peer.analysis,
        familyName,
        memberNames: peer.analysis.memberNames.map((member) => ({ ...member, name: familyName })),
        normalizationReason: `${peer.analysis.normalizationReason ? `${peer.analysis.normalizationReason} ` : ''}Terminal sibling ordinal canonicalized from document order.`,
      });
    }
  }
  return analyses.map((analysis) => replacements.get(analysis.familyId) || analysis);
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
    const sourceHints = uniqueSourceTypeHints(members.map((member) => member.name));
    const hierarchyHints = uniqueSourceTypeHints([
      ...parentNames,
      ...hierarchyContext.map((context) => context.parentName),
    ]);
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
      ...(sourceHints.length === 1 ? { sourceTypeHint: sourceHints[0] } : {}),
      ...(hierarchyHints.length === 1 ? { hierarchyTypeHint: hierarchyHints[0] } : {}),
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
    // The hosted model is the sole author of semantic identity. Kryeo retains
    // its name exactly as returned and only validates whether that packet is
    // safe to export; it never repairs, derives, or substitutes a name.
    const nameContract = strictProductionName(rawName, assetType);
    const proposedName = canonicalAiNameForType(rawName, assetType);
    const namePacketIsUsable = assetType !== 'Unknown'
      && role !== 'Unknown'
      && hasCompatibleRobloxRole(assetType, role)
      && nameContract.issues.length === 0;
    const familyName = proposedName;
    const consistencyIssues = familyDecisionConsistencyIssues(analysis, family);
    const plannedDiveMode = component.structuralDiveMode || component.diveMode;
    const groupingMismatch = component.childHierarchyKeys.length > 0
      && analysis.diveMode !== plannedDiveMode;
    const semanticReason = groupingMismatch
      ? `${analysis.reason} The document's already planned structural boundary was retained; the visual model's grouping field is advisory only.`
      : analysis.reason;
    const completeDecision = namePacketIsUsable;
    // Semantic identity comes from the accepted visual packet. Structural
    // ownership is established before model analysis from the editable
    // document hierarchy, so a model-supplied grouping mismatch must not
    // erase a sound name/type/role result or force another provider call.
    const semanticConflict = Boolean(analysis.conflict || !completeDecision || consistencyIssues.length);
    const semanticConflictMessage = analysis.conflictMessage
      || consistencyIssues[0];
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
      diveMode: plannedDiveMode,
      aiSuggestedName: familyName,
      aiSuggestedType: assetType,
      aiSuggestedRole: role,
      aiConfidence: analysis.confidence,
      aiEvidence: analysis.evidence,
      aiSource: 'model',
      aiReason: semanticReason,
      analysisSource: 'hosted-family',
      analysisState: semanticConflict ? 'needs-review' : 'analyzed',
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
  const replacementName = String(challenge.suggestedName || '').trim();
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

/**
 * Primary packets are model-owned. Kryeo may provide hierarchy and source
 * evidence to the model, but never rewrites a completed name, type, role, or
 * grouping from that evidence.
 */
export function resolvePrimaryFamilyAnalysis(
  primary: HostedFamilyAnalysis,
  _family?: ComponentVisualFamily,
): HostedFamilyAnalysis {
  return primary;
}

export function resolveIndependentFamilyAnalysis(
  primary: HostedFamilyAnalysis,
  reviewer: HostedFamilyAnalysis | undefined,
  family?: ComponentVisualFamily,
): HostedFamilyAnalysis {
  const primaryComplete = primary.assetType !== 'Unknown'
    && primary.role !== 'Unknown'
    && hasCompatibleRobloxRole(primary.assetType, primary.role)
    && strictProductionName(primary.familyName || '', primary.assetType).issues.length === 0;
  const primaryEvidenceIssues = [
    ...familyPrimaryEvidenceIssues(primary, family),
    ...familyDecisionConsistencyIssues(primary, family),
  ];
  const reviewerConsistencyIssues = reviewer
    ? familyDecisionConsistencyIssues(reviewer, family)
    : [];
  const complete = Boolean(reviewer)
    && reviewer!.assetType !== 'Unknown'
    && reviewer!.role !== 'Unknown'
    && hasCompatibleRobloxRole(reviewer!.assetType, reviewer!.role)
    && strictProductionName(reviewer!.familyName || '', reviewer!.assetType).issues.length === 0
    && reviewerConsistencyIssues.length === 0;
  if (!complete || !reviewer) {
    if (primaryComplete && !primaryEvidenceIssues.length) {
      // The resolver must choose one whole decision. A reviewer that returns
      // criticism, an invalid row, or no row cannot partially erase a usable
      // primary packet; retain that original atomically and record the failed
      // challenge in the reason/normalization metadata for developer review.
      // The primary model is still the first complete visual decision. An
      // unavailable second opinion is not evidence that its entire atomic
      // name/type/role packet is invalid; treating it as such was the direct
      // cause of otherwise named layers being published with empty names.
      return {
        ...primary,
        alternatives: reviewer?.alternatives?.length ? reviewer.alternatives : primary.alternatives,
        reason: `${primary.reason} The independent visual review did not return a complete replacement, so Kryeo retained the complete primary decision atomically.`,
        conflict: false,
        conflictMessage: '',
        reviewNeeded: false,
        normalizationReason: 'The reviewer response was incomplete; Kryeo retained the complete primary packet without changing any field.',
      };
    }
    return {
      ...primary,
      conflict: true,
      reviewNeeded: true,
      conflictMessage: reviewerConsistencyIssues[0]
        || primaryEvidenceIssues[0]
        || 'The independent visual review did not return one complete replacement decision.',
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
    // A complete reviewer packet is selected as-is. Kryeo never reconciles
    // individual name, type, role, or grouping fields locally.
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
