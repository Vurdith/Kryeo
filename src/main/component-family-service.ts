import { createHash } from 'node:crypto';
import type {
  ComponentAssetType,
  ComponentCandidate,
  ComponentDecision,
  ComponentVisualFamily,
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

function readableSourceName(value: string): string {
  return value
    .replace(/\.(?:png|jpe?g|webp|gif|tiff?|afdesign)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function words(value: string): string[] {
  return readableSourceName(value).toLowerCase().split(/\s+/).filter(Boolean);
}

function isGenericModelName(value: string): boolean {
  const normalized = words(value).join(' ').trim();
  return !normalized || GENERIC_MODEL_NAMES.has(normalized) || /^family\s+\d+\s+member\s+\d+$/i.test(normalized);
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
  if (isMeaninglessName(component.name)) return '';
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

  const aspect = component.bounds.width / Math.max(1, component.bounds.height);
  const largeLandscape = component.bounds.width >= 800
    && component.bounds.height >= 450
    && aspect >= 1.25;
  const metrics = component.visualMetrics;
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
        analysisPreviewUrls: member.analysisPreviewUrls || [],
        visualMetrics: member.visualMetrics,
      })),
      representativeHash: members[0].visualHash,
      exactInstanceCount: Math.max(
        members.length,
        ...members.map((member) => Math.max(1, member.duplicateCount)),
      ),
      hierarchyContext,
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
    // A clear human-authored layer type is intent, not visual noise. The visual
    // model still handles generic names and explicit visual conflicts upstream.
    const semanticAnchor = component.semanticType && component.nameSource !== 'visual' ? component.semanticType : undefined;
    const treatmentRefinement = Boolean(
      semanticAnchor
      && ['Texture', 'Overlay'].includes(semanticAnchor)
      && ['Texture', 'Overlay'].includes(analysis.assetType)
      && semanticAnchor !== analysis.assetType,
    );
    const hostedEvidence = Object.values(analysis.evidence || {}).some((score) => Number(score) >= 0.72)
      && Number(analysis.confidence || 0) >= 0.72
      && !analysis.reviewNeeded;
    const localVisualAnchor = visualAnchor
      && visualAnchor.confidence >= 0.9
      && (!hostedEvidence || analysis.assetType !== component.visualStructureType)
      ? visualAnchor.type
      : undefined;
    const assetType = localVisualAnchor
      || (treatmentRefinement ? analysis.assetType : semanticAnchor || analysis.assetType);
    let anchoredName = semanticAnchor && !treatmentRefinement
      ? component.name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+\d+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      : '';
    if (semanticAnchor && anchoredName) {
      const typeWords = semanticAnchor.replace(/([a-z])([A-Z])/g, '$1 $2');
      const leadingType = new RegExp(`^${typeWords}\\s+(.+)$`, 'i').exec(anchoredName);
      if (leadingType) anchoredName = `${leadingType[1]} ${typeWords}`;
    }
    const proposedName = memberName || analysis.familyName;
    const sourceIdentity = sourceIdentityName(component, assetType, proposedName);
    const sourceIdentityIsGeneric = isGenericModelName(sourceIdentity);
    const visualDescriptionName = nameFromVisualDescription(analysis.visualDescription || '', assetType);
    const familyName = anchoredName
      || (sourceIdentity && !sourceIdentityIsGeneric ? sourceIdentity : '')
      || (!isGenericModelName(proposedName) ? proposedName : '')
      || visualDescriptionName
      || assetType;
    const semanticReason = localVisualAnchor
      ? visualAnchor?.reason || `The rendered geometry provides stronger evidence for ${localVisualAnchor} than the hosted family suggestion.`
      : semanticAnchor
      ? `The layer name clearly identifies this as a ${semanticAnchor.toLowerCase()}; that user intent takes priority over the visual description.`
      : analysis.reason;
    return {
      ...component,
      familyFingerprint: family.fingerprint,
      familyMemberHashes: family.members.map((member) => member.visualHash),
      familyName,
      assetType,
      role: analysis.role,
      reviewCategory: reviewCategory(assetType),
      diveMode: component.childHierarchyKeys.length ? analysis.diveMode : component.diveMode,
      aiSuggestedName: familyName,
      aiSuggestedType: assetType,
      aiSuggestedRole: analysis.role,
      aiConfidence: analysis.confidence,
      aiEvidence: analysis.evidence,
      aiSource: localVisualAnchor ? 'model' : semanticAnchor ? 'name' : 'model',
      aiReason: semanticReason,
      analysisSource: 'hosted-family',
      analysisState: analysis.reviewNeeded || analysis.conflict ? 'needs-review' : 'analyzed',
      analysisReason: semanticReason,
      analysisAlternatives: analysis.alternatives,
      semanticConflict: analysis.conflict,
      semanticConflictMessage: analysis.conflictMessage,
      remembered: false,
    };
  });
}
