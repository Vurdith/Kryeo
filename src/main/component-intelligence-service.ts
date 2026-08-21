import type {
  ComponentCandidate,
  ComponentDiveMode,
  ComponentReviewPriority,
} from '../shared/types';
import { cosineSimilarity, decodeEmbedding } from './embedding-utils.ts';

function intersectionArea(left: ComponentCandidate['bounds'], right: ComponentCandidate['bounds']): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function area(bounds: ComponentCandidate['bounds']): number {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function separatedRatio(children: ComponentCandidate[]): number {
  let separated = 0;
  let compared = 0;
  for (let left = 0; left < children.length; left += 1) {
    for (let right = left + 1; right < children.length; right += 1) {
      compared += 1;
      const smaller = Math.max(1, Math.min(area(children[left].bounds), area(children[right].bounds)));
      if (intersectionArea(children[left].bounds, children[right].bounds) / smaller < 0.08) separated += 1;
    }
  }
  return compared ? separated / compared : 0;
}

const COMPOSED_PARENT_TYPES = new Set<ComponentCandidate['assetType']>([
  'Bar',
  'Button',
  'Frame',
  'Input',
  'Modal',
  'Panel',
  'Slot',
  'Tab',
  'TextBox',
  'Tooltip',
]);

const INDEPENDENT_CHILD_TYPES = new Set<ComponentCandidate['assetType']>([
  'Badge',
  'Bar',
  'Button',
  'Cursor',
  'Icon',
  'Input',
  'Label',
  'ScrollBar',
  'Slot',
  'Tab',
  'Text',
  'TextBox',
  'Tile',
  'Tooltip',
]);

const GENERIC_GROUP_NAME = /^(?:group|container|layers?|items?|components?|elements?|children|content|holder|wrapper|root)(?:[\s_-]*\d+)?$/i;
const GENERIC_FAMILY_NAME = /^(?:layer|group|frame|button|icon|panel|slot|element|component|asset|image|object|raster|vector|unknown)(?:[\s_-]*\d+)?$/i;

function childCoverageRatio(component: ComponentCandidate, children: ComponentCandidate[]): number {
  const parentArea = Math.max(1, area(component.bounds));
  const covered = children.reduce((total, child) => total + intersectionArea(component.bounds, child.bounds), 0);
  return Math.min(1, covered / parentArea);
}

function diveStructureSignature(component: ComponentCandidate, children: ComponentCandidate[]): string {
  if (!children.length) return 'leaf';
  const separationBucket = Math.round(separatedRatio(children) * 4);
  const coverageBucket = Math.round(childCoverageRatio(component, children) * 4);
  const childVisuals = children.map((child) => child.visualHash.slice(0, 12)).sort().join(',');
  return `v1:${children.length}:${separationBucket}:${coverageBucket}:${childVisuals}`;
}

function structuralRecommendation(component: ComponentCandidate, children: ComponentCandidate[]): {
  mode: ComponentDiveMode;
  confidence: number;
  reasons: string[];
} {
  const separation = separatedRatio(children);
  const coverage = childCoverageRatio(component, children);
  const repeatedChildFamily = children.length >= 2
    && children.every((child) =>
      child.visualHash === children[0].visualHash
      || (
        Boolean(child.similarityFamily)
        && child.similarityFamily === children[0].similarityFamily
      ));
  const independentChildren = children.filter((child) => INDEPENDENT_CHILD_TYPES.has(child.assetType)).length;
  const genericContainer = GENERIC_GROUP_NAME.test(component.name.trim());

  if (repeatedChildFamily && separation >= 0.6) {
    return {
      mode: genericContainer ? 'children-only' : 'parent-and-children',
      confidence: genericContainer ? 0.98 : 0.9,
      reasons: genericContainer
        ? ['Repeated child visuals occupy separate regions, so the parent behaves like an organizational container.']
        : ['A meaningfully named repeated collection is useful as an assembled asset and also contains reusable child instances.'],
    };
  }

  if (separation <= 0.35 && coverage >= 0.52) {
    return {
      mode: 'keep-together',
      confidence: 0.94,
      reasons: ['Child artwork overlaps into one composed visual; exporting the pieces separately would break the component.'],
    };
  }

  if (COMPOSED_PARENT_TYPES.has(component.assetType) && independentChildren >= 2 && separation >= 0.45) {
    return {
      mode: 'parent-and-children',
      confidence: 0.86,
      reasons: ['The parent is a useful assembled UI component and also contains spatially independent reusable children.'],
    };
  }

  if (genericContainer && independentChildren >= 2 && separation >= 0.45) {
    return {
      mode: 'children-only',
      confidence: 0.88,
      reasons: ['A generically named container holds separate reusable child components.'],
    };
  }

  return {
    mode: 'keep-together',
    confidence: 0.66,
    reasons: ['The hierarchy is structurally ambiguous, so Kryeo keeps the group intact as the safer reversible default.'],
  };
}

/**
 * Affinity can expose a flattened RasterNode and the editable GroupNode that
 * renders exactly the same pixels. The raster is useful visual evidence, but
 * exporting it instead of the group loses the user's actual layer assembly.
 * Prefer the editable composition only for exact pixel matches; similar art
 * remains independently reviewable.
 */
function preferEditableExactComposites(components: ComponentCandidate[]): void {
  const byVisualHash = new Map<string, ComponentCandidate[]>();
  for (const component of components) {
    component.keptInsideParent = false;
    const renderIdentity = component.renderHash || component.visualHash;
    const family = byVisualHash.get(renderIdentity) || [];
    family.push(component);
    byVisualHash.set(renderIdentity, family);
  }
  for (const family of byVisualHash.values()) {
    const groups = family.filter((component) => component.childHierarchyKeys.length > 0);
    const flatCopies = family.filter((component) => component.childHierarchyKeys.length === 0);
    if (!groups.length || !flatCopies.length) continue;
    const owner = [...groups].sort((left, right) => (
      right.childHierarchyKeys.length - left.childHierarchyKeys.length
      || left.hierarchyDepth - right.hierarchyDepth
      || left.hierarchyKey.localeCompare(right.hierarchyKey)
    ))[0];
    for (const flatCopy of flatCopies) flatCopy.keptInsideParent = true;
    if (owner.diveRemembered) continue;
    owner.diveMode = 'keep-together';
    owner.recommendedDiveMode = 'keep-together';
    owner.diveConfidence = 1;
    owner.diveReasons = ['An exact flattened copy exists, so Kryeo preserves the editable composed group as the export owner.'];
    owner.diveConflict = false;
    owner.diveConflictMessage = undefined;
  }
}

function reviewAssessment(component: ComponentCandidate): {
  priority: ComponentReviewPriority;
  reasons: string[];
} {
  const critical: string[] = [];
  const reasons: string[] = [];
  const structuralOnly = ['duplicate-representation', 'organizational-parent']
    .includes(component.assetBoundary || '');
  if (structuralOnly || (!component.assetBoundary && component.exportTarget === false)) return { priority: 'ready', reasons: [] };
  // A semantic candidate excluded for uncertainty still belongs in the review
  // lane. Only structural non-assets are allowed to disappear from it.
  const reviewsAsset = true;
  if (reviewsAsset && component.semanticConflict) critical.push(component.semanticConflictMessage || 'Visual and semantic evidence disagree.');
  if (component.diveConflict) critical.push(component.diveConflictMessage || 'The cloud group-export choice conflicts with structural evidence.');
  if (reviewsAsset && component.assetType === 'Unknown') critical.push('No reliable asset type was assigned.');
  if (reviewsAsset && component.namingIssues?.length) critical.push(...component.namingIssues);
  if (reviewsAsset && component.automationIssues?.length) critical.push(...component.automationIssues);
  // A provisional candidate is useful audit information, but it is never an
  // automatic export decision. Keep it visible without pretending it is ready.
  if (reviewsAsset && component.analysisState === 'needs-review' && !component.semanticConflict && !component.diveConflict) {
    reasons.push('The cloud reviewer marked this candidate uncertain, so Kryeo kept it out of the export queue.');
  }
  if (reviewsAsset && (component.analysisState === 'provisional' || component.analysisState === 'queued')) {
    critical.push('This family does not have a complete cloud classification.');
  }
  const productionName = component.exportName || component.familyName;
  const normalizedFamilyName = productionName.replace(/[\s_-]+/g, '').toLowerCase();
  const normalizedAssetType = component.assetType.replace(/[\s_-]+/g, '').toLowerCase();
  if (reviewsAsset && (GENERIC_FAMILY_NAME.test(productionName.trim()) || normalizedFamilyName === normalizedAssetType)) {
    critical.push(`“${productionName}” is too generic to be a production asset name.`);
  }
  if (reviewsAsset && component.aiConfidence !== undefined && component.aiConfidence < 0.72) {
    reasons.push(`Classification confidence is ${Math.round(component.aiConfidence * 100)}%; this remains a candidate rather than an accepted export decision.`);
  }
  if (component.childHierarchyKeys.length > 0 && component.diveConfidence < 0.8) {
    reasons.push('The group-export decision has mixed structural evidence; Kryeo chose the safer reversible boundary.');
  }
  if (reviewsAsset && (component.analysisSource === 'unavailable' || !component.analysisSource)) {
    reasons.push('Cloud analysis was unavailable; no automatic export decision was made.');
  }
  if (critical.length || reasons.length) return { priority: 'check', reasons: [...new Set([...critical, ...reasons])] };
  return { priority: 'ready', reasons: [] };
}

function applySimilarityFamilies(components: ComponentCandidate[]): void {
  const unique = [...new Map(components.map((component) => [component.visualHash, component])).values()];
  const vectors = unique.map((component) => decodeEmbedding(component.visualEmbedding || ''));
  const parents = unique.map((_, index) => index);
  const root = (value: number): number => {
    while (parents[value] !== value) {
      parents[value] = parents[parents[value]];
      value = parents[value];
    }
    return value;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      if (!vectors[left].length || !vectors[right].length) continue;
      const leftComponent = unique[left];
      const rightComponent = unique[right];
      const similarity = cosineSimilarity(vectors[left], vectors[right]);
      const sameParent = Boolean(
        leftComponent.parentHierarchyKey
        && leftComponent.parentHierarchyKey === rightComponent.parentHierarchyKey,
      );
      const leftAspect = leftComponent.bounds.width / Math.max(1, leftComponent.bounds.height);
      const rightAspect = rightComponent.bounds.width / Math.max(1, rightComponent.bounds.height);
      const aspectDistance = Math.abs(Math.log(Math.max(0.01, leftAspect) / Math.max(0.01, rightAspect)));
      const areaRatio = Math.min(area(leftComponent.bounds), area(rightComponent.bounds))
        / Math.max(1, Math.max(area(leftComponent.bounds), area(rightComponent.bounds)));
      const geometryCompatible = aspectDistance <= 0.48 && areaRatio >= 0.42;
      const threshold = sameParent && geometryCompatible
        ? 0.9
        : geometryCompatible ? 0.945 : 0.975;
      if (similarity >= threshold) join(left, right);
    }
  }
  const families = new Map<number, ComponentCandidate[]>();
  unique.forEach((component, index) => {
    const key = root(index);
    const family = families.get(key) || [];
    family.push(component);
    families.set(key, family);
  });
  const familyByHash = new Map<string, { id: string; count: number }>();
  const occurrencesByHash = new Map<string, number>();
  for (const component of components) {
    occurrencesByHash.set(component.visualHash, (occurrencesByHash.get(component.visualHash) || 0) + 1);
  }
  for (const family of families.values()) {
    const id = family.map((component) => component.visualHash).sort()[0].slice(0, 12);
    const count = family.reduce((total, member) => total + (occurrencesByHash.get(member.visualHash) || 0), 0);
    for (const member of family) familyByHash.set(member.visualHash, { id, count });
  }
  for (const component of components) {
    const family = familyByHash.get(component.visualHash);
    component.similarityFamily = family?.id || component.visualHash.slice(0, 12);
    component.similarCount = family?.count || component.duplicateCount;
    component.duplicateKind = component.duplicateCount > 1
      ? 'exact'
      : component.similarCount > 1 ? 'similar' : 'unique';
  }
}

function recommendation(component: ComponentCandidate, children: ComponentCandidate[]): {
  mode: ComponentDiveMode;
  confidence: number;
  reasons: string[];
  conflict?: boolean;
  conflictMessage?: string;
} {
  if (children.length === 0) return { mode: 'keep-together', confidence: 1, reasons: ['No independently reviewable child components.'] };
  if (component.diveRemembered) {
    return {
      mode: component.diveMode,
      confidence: 1,
      reasons: ['Using the group export choice previously confirmed for this exact visual.'],
    };
  }
  const structural = structuralRecommendation(component, children);
  if (component.analysisSource === 'hosted-family') {
    const hostedMode = component.diveMode;
    if (hostedMode === structural.mode) {
      return {
        ...structural,
        confidence: Math.max(structural.confidence, component.analysisState === 'needs-review' ? 0.62 : 0.9),
        reasons: [...structural.reasons, 'Cloud and structural group analysis agree.'],
      };
    }
    if (structural.confidence >= 0.84) {
      return {
        ...structural,
        confidence: Math.min(0.68, structural.confidence),
        reasons: [...structural.reasons, `Cloud analysis proposed ${hostedMode.replace(/-/g, ' ')}.`],
        conflict: true,
        conflictMessage: `Cloud analysis proposed ${hostedMode.replace(/-/g, ' ')}, but strong hierarchy and geometry evidence supports ${structural.mode.replace(/-/g, ' ')}.`,
      };
    }
    return {
      mode: hostedMode,
      confidence: component.analysisState === 'needs-review' ? 0.45 : 0.72,
      reasons: [...structural.reasons, `Cloud analysis selected ${hostedMode.replace(/-/g, ' ')}; Kryeo kept a conservative group boundary automatically.`],
    };
  }
  if (component.learnedDiveMode && component.nearestLearnedSimilarity && component.nearestLearnedSimilarity >= 0.92) {
    if (component.learnedDiveMode === structural.mode) {
      return {
        ...structural,
        confidence: Math.max(structural.confidence, Math.min(0.99, component.nearestLearnedSimilarity)),
        reasons: [...structural.reasons, 'A visually similar saved group choice agrees with the current structure.'],
      };
    }
    if (structural.confidence >= 0.84) {
      return {
        ...structural,
        confidence: Math.min(0.68, structural.confidence),
        reasons: [...structural.reasons, `Visual memory proposed ${component.learnedDiveMode.replace(/-/g, ' ')}.`],
        conflict: true,
        conflictMessage: `A visually similar saved choice proposed ${component.learnedDiveMode.replace(/-/g, ' ')}, but this instance has different strong structural evidence for ${structural.mode.replace(/-/g, ' ')}.`,
      };
    }
    return {
      mode: component.learnedDiveMode,
      confidence: 0.72,
      reasons: [...structural.reasons, 'A similar saved group choice was used, but this structure still needs a quick check.'],
    };
  }
  return structural;
}

export function applyComponentIntelligence(
  components: ComponentCandidate[],
  recomputeSimilarity = true,
): ComponentCandidate[] {
  // Family geometry and embeddings are fixed by the Affinity export. Hosted
  // responses change semantic labels, not the visual-family graph, so callers
  // rendering progressive cloud updates can reuse that expensive graph.
  if (recomputeSimilarity) applySimilarityFamilies(components);
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));
  for (const component of components) {
    const children = component.childHierarchyKeys
      .map((key) => byKey.get(key))
      .filter((child): child is ComponentCandidate => Boolean(child));
    component.diveStructureSignature = diveStructureSignature(component, children);
    const exactDiveDecision = component.learnedDiveDecisions
      ?.find((decision) => decision.signature === component.diveStructureSignature);
    if (exactDiveDecision) {
      component.diveMode = exactDiveDecision.mode;
      component.diveRemembered = true;
    } else if (component.learnedDiveDecisions?.length) {
      component.diveRemembered = false;
    }
    const proposed = recommendation(component, children);
    component.recommendedDiveMode = proposed.mode;
    component.diveConfidence = proposed.confidence;
    component.diveReasons = proposed.reasons;
    component.diveConflict = Boolean(proposed.conflict);
    component.diveConflictMessage = proposed.conflictMessage;
    if (!component.diveRemembered) component.diveMode = proposed.mode;
    const review = reviewAssessment(component);
    component.reviewPriority = review.priority;
    component.reviewReasons = review.reasons;
  }
  preferEditableExactComposites(components);
  return components;
}
