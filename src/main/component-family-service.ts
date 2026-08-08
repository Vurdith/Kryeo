import { createHash } from 'node:crypto';
import type {
  ComponentAssetType,
  ComponentCandidate,
  ComponentDecision,
  ComponentFamilyReviewSignals,
  ComponentVisualFamily,
  HostedFamilyReviewPlan,
  HostedFamilyAnalysis,
} from '../shared/types';
import { isMeaninglessName } from './name-quality.ts';

const ASSET_TYPE_NAMES: ComponentAssetType[] = [
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor',
  'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
];
const TYPE_NOUNS = new Set(ASSET_TYPE_NAMES.flatMap((type) => (
  readableSourceName(type).toLowerCase().split(/\s+/).flatMap((word) => [word, `${word}s`])
)));
const GENERIC_MODEL_NAMES = new Set([
  'scene', 'visual', 'asset', 'component', 'object', 'image', 'picture', 'artwork', 'item', 'element',
  'background', 'wallpaper', 'texture', 'overlay', 'frame', 'border', 'corner', 'edge', 'fill',
  'ornament', 'badge', 'icon', 'fx', 'scene asset', 'visual asset',
]);
const STRUCTURAL_MODEL_WORDS = new Set([
  ...TYPE_NOUNS,
  'ui', 'root', 'container', 'containers', 'group', 'groups', 'layer', 'layers',
  'middle', 'outer', 'inner', 'center', 'centre', 'base', 'main', 'foreground',
  'backdrop', 'outline', 'outlines', 'content', 'contents', 'top', 'bottom',
  'left', 'right', 'side', 'sides', 'glow', 'shine', 'highlight', 'light', 'shadow',
  'img', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'export',
]);
const BORDER_CONFLICT_TYPES = new Set<ComponentAssetType>([
  'Frame', 'Panel', 'Slot', 'Background', 'Wallpaper', 'Texture', 'Overlay',
]);

function readableSourceName(value: string): string {
  return value
    .replace(/\.(?:png|jpe?g|webp|gif|tiff?|afdesign)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function words(value: string): string[] {
  return readableSourceName(value).toLowerCase().split(/\s+/).filter(Boolean);
}

function isStructuralOnlyName(value: string): boolean {
  const semanticWords = words(value).filter((word) => !/^\d+$/.test(word));
  return semanticWords.length > 0 && semanticWords.every((word) => STRUCTURAL_MODEL_WORDS.has(word));
}

function hasDistinctiveIdentityWord(value: string): boolean {
  return words(value).some((word) => /^[a-z]+$/i.test(word) && !STRUCTURAL_MODEL_WORDS.has(word));
}

function isGenericModelName(value: string): boolean {
  const normalized = words(value).join(' ').trim();
  return !normalized
    || (isMeaninglessName(value) && !hasDistinctiveIdentityWord(value))
    || isStructuralOnlyName(value)
    || GENERIC_MODEL_NAMES.has(normalized)
    || /^family\s+\d+\s+member\s+\d+$/i.test(normalized);
}

function retargetTrailingTypeName(
  value: string,
  originalType: ComponentAssetType,
  resolvedType: ComponentAssetType,
): string {
  const name = readableSourceName(value);
  if (!name || originalType === resolvedType) return name;
  const original = readableSourceName(originalType);
  const resolved = readableSourceName(resolvedType);
  const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const escapedResolved = resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const retyped = name.replace(new RegExp(`\\b${escapedOriginal}s?$`, 'i'), resolved);
  return retyped.replace(new RegExp(`\\b${escapedResolved}(?:\\s+${escapedResolved})+\\b`, 'gi'), resolved);
}

function fallbackFamilyName(assetType: ComponentAssetType): string {
  // A bare type is especially unhelpful after a model supplied only a generic
  // name. This is intentionally conservative: a richer visible descriptor
  // still wins whenever the hosted result provided one.
  return assetType === 'Border' ? 'Decorative Border' : assetType;
}

function nameFromVisualDescription(description: string, assetType: ComponentAssetType): string {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'with', 'for', 'in', 'on', 'at', 'to', 'from', 'this',
    'that', 'is', 'are', 'appears', 'appearing', 'shows', 'showing', 'depicts', 'depicting',
    'detailed', 'image', 'visual', 'artwork', 'asset', 'scene', 'element', 'background', 'layer',
  ]);
  const descriptors = readableSourceName(description)
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !stopWords.has(word) && !TYPE_NOUNS.has(word))
    .filter((word, index, values) => values.indexOf(word) === index)
    .slice(0, 3);
  return descriptors.length ? `${descriptors.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')} ${assetType}` : '';
}

function sourceTypeSuffix(source: string): ComponentAssetType | undefined {
  return [...ASSET_TYPE_NAMES]
    .sort((left, right) => right.length - left.length)
    .find((type) => {
      const typeWords = readableSourceName(type).replace(/\s+/g, '\\s*');
      return new RegExp(`\\b${typeWords}s?$`, 'i').test(source);
    });
}

function sourceIdentityName(
  component: ComponentCandidate,
  visualType: ComponentCandidate['assetType'],
  proposedName: string,
): string {
  if (
    isStructuralOnlyName(component.name)
    || (isMeaninglessName(component.name) && !hasDistinctiveIdentityWord(component.name))
  ) return '';
  const source = readableSourceName(component.name);
  if (!source) return '';

  const sourceWords = words(source);
  const proposedWords = words(proposedName);
  const proposedWordSet = new Set(proposedWords.map((word) => word.replace(/s$/i, '')));
  const sourceIsContained = sourceWords.every((word) => proposedWordSet.has(word.replace(/s$/i, '')));
  if (sourceIsContained) return source.replace(/\s+\d+$/i, '').trim();

  const namedType = sourceTypeSuffix(source);
  if (namedType && namedType !== visualType) {
    const typeWords = readableSourceName(namedType).replace(/\s+/g, '\\s*');
    const descriptor = source.replace(new RegExp(`\\s+${typeWords}s?$`, 'i'), '').trim();
    return descriptor ? `${descriptor} ${visualType}` : visualType;
  }

  const proposedDescriptors = proposedWords.filter((word) => !TYPE_NOUNS.has(word));
  if (proposedDescriptors.length === 0) return source.replace(/\s+\d+$/i, '').trim();
  return '';
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
  memberHashes: string[],
  familyFingerprint: string,
  decisions: ComponentDecision[],
  project: string,
): ComponentDecision | undefined {
  const hashes = new Set(memberHashes);
  return decisions
    .filter((decision) => decision.approved !== false)
    .filter((decision) => !decision.project || decision.scope === 'global' || decision.project === project)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((decision) =>
      decision.familyFingerprint === familyFingerprint
      || hashes.has(decision.visualHash));
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
      reasons: ['No local review signals were available, so hosted review is required.'],
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

export function buildVisualFamilies(
  components: ComponentCandidate[],
  decisions: ComponentDecision[],
  project: string,
  documentTitle: string,
): ComponentVisualFamily[] {
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  const grouped = new Map<string, ComponentCandidate[]>();
  for (const component of components) {
    const key = component.visualHash;
    const family = grouped.get(key) || [];
    family.push(component);
    grouped.set(key, family);
  }

  return [...grouped.entries()].map(([id, members]) => {
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
    return {
      id,
      fingerprint: familyFingerprint,
      project,
      documentTitle,
      parentNames: [...new Set(parentNames)],
      members: members.map((member) => ({
        id: member.id,
        visualHash: member.visualHash,
        name: member.name,
        affinityType: member.affinityType,
        bounds: member.bounds,
        hierarchyKey: member.hierarchyKey,
        parentHierarchyKey: member.parentHierarchyKey,
        childHierarchyKeys: member.childHierarchyKeys,
        previewUrl: member.previewUrl,
        hostedPreviewUrl: member.hostedPreviewUrl,
        analysisPreviewUrls: member.analysisPreviewUrls || [],
        visualMetrics: member.visualMetrics,
      })),
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
}

export function applyApprovedFamilies(
  components: ComponentCandidate[],
  families: ComponentVisualFamily[],
): ComponentCandidate[] {
  const familyByHash = new Map<string, ComponentVisualFamily>();
  for (const family of families) {
    for (const member of family.members) familyByHash.set(member.visualHash, family);
  }
  return components.map((component) => {
    const family = familyByHash.get(component.visualHash);
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
      familyName: decision.memberNames?.find((member) => member.visualHash === component.visualHash)?.name || decision.familyName,
      assetType: decision.assetType || 'Unknown',
      role: decision.role,
      reviewCategory: reviewCategory(decision.assetType || 'Unknown'),
      diveMode: decision.diveMode || component.diveMode,
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
  const familyByHash = new Map<string, ComponentVisualFamily>();
  for (const family of families) {
    for (const member of family.members) familyByHash.set(member.visualHash, family);
  }
  const analysisById = new Map(analyses.map((analysis) => [analysis.familyId, analysis]));
  return components.map((component) => {
    if (component.analysisSource === 'approved-family') return component;
    const family = familyByHash.get(component.visualHash);
    const analysis = family ? analysisById.get(family.id) : undefined;
    const visualAnchor = visualStructureAnchor(component);
    if (!family || !analysis) {
      if (!component.remembered && visualAnchor) {
        return {
          ...component,
          assetType: visualAnchor.type,
          reviewCategory: reviewCategory(visualAnchor.type),
          aiSuggestedType: visualAnchor.type,
          aiConfidence: Math.max(component.aiConfidence || 0, visualAnchor.confidence),
          aiReason: visualAnchor.reason,
          analysisSource: 'local-provisional',
          analysisState: 'provisional',
          analysisReason: 'No hosted result was returned; the rendered structure remains the current provisional classification.',
        };
      }
      return {
        ...component,
        familyFingerprint: family?.fingerprint,
        familyMemberHashes: family?.members.map((member) => member.visualHash),
        analysisSource: 'local-provisional',
        analysisState: 'provisional',
        analysisReason: 'No hosted result was returned for this visual family. The current values are provisional.',
      };
    }
    const memberName = analysis.memberNames.find((member) => member.visualHash === component.visualHash)?.name;
    // Hosted review is normally final, but an exported PNG with a transparent
    // centre and dense perimeter is strong enough evidence to reject a
    // container-like classification. This protects decorative Affinity groups
    // from becoming Roblox Frames simply because they contain multiple layers.
    const visualStructureOverride = visualAnchor?.type === 'Border'
      && BORDER_CONFLICT_TYPES.has(analysis.assetType);
    const assetType = visualStructureOverride ? 'Border' : analysis.assetType;
    const role = visualStructureOverride ? 'ImageLabel' : analysis.role;
    const proposedName = retargetTrailingTypeName(
      memberName || analysis.familyName,
      analysis.assetType,
      assetType,
    );
    const sourceIdentity = sourceIdentityName(component, assetType, proposedName);
    const visualDescriptionName = nameFromVisualDescription(analysis.visualDescription || '', assetType);
    const familyName = (!isGenericModelName(proposedName) ? proposedName : '')
      || (!isGenericModelName(sourceIdentity) ? sourceIdentity : '')
      || visualDescriptionName
      || fallbackFamilyName(assetType);
    const semanticReason = visualStructureOverride
      ? `${visualAnchor.reason} Kryeo kept this as a Border/ImageLabel instead of the hosted ${analysis.assetType}/${analysis.role} result.`
      : analysis.reason;
    const semanticConflict = Boolean(analysis.conflict || visualStructureOverride);
    const semanticConflictMessage = analysis.conflictMessage || (visualStructureOverride
      ? `The hosted reviewer chose ${analysis.assetType}, but the transparent perimeter geometry identifies this exported artwork as a Border.`
      : undefined);
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
      diveMode: component.childHierarchyKeys.length ? analysis.diveMode : component.diveMode,
      aiSuggestedName: familyName,
      aiSuggestedType: assetType,
      aiSuggestedRole: role,
      aiConfidence: visualStructureOverride
        ? Math.max(analysis.confidence || 0, visualAnchor.confidence)
        : analysis.confidence,
      aiEvidence: analysis.evidence,
      aiSource: 'model',
      aiReason: semanticReason,
      analysisSource: 'hosted-family',
      analysisState: analysis.reviewNeeded || semanticConflict ? 'needs-review' : 'analyzed',
      analysisReason: semanticReason,
      analysisAlternatives: analysis.alternatives,
      semanticConflict,
      semanticConflictMessage,
      remembered: false,
    };
  });
}
