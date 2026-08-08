import type { ComponentCandidate, ComponentDiveMode } from '../shared/types';
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
} {
  if (children.length === 0) return { mode: 'keep-together', confidence: 1, reasons: ['No independently reviewable child components.'] };
  if (component.analysisSource === 'hosted-family') {
    return {
      mode: component.diveMode,
      confidence: component.analysisState === 'needs-review' ? 0.5 : 1,
      reasons: [component.analysisReason || 'Using the visual-family group recommendation.'],
    };
  }
  if (component.diveRemembered) {
    return {
      mode: component.diveMode,
      confidence: 1,
      reasons: ['Using the group export choice previously confirmed for this exact visual.'],
    };
  }
  if (component.learnedDiveMode && component.nearestLearnedSimilarity && component.nearestLearnedSimilarity >= 0.92) {
    return {
      mode: component.learnedDiveMode,
      confidence: Math.min(0.99, component.nearestLearnedSimilarity),
      reasons: ['Matched a visually similar group decision remembered on this computer.'],
    };
  }

  const repeatedChildFamily = children.length >= 2
    && children.every((child) =>
      child.visualHash === children[0].visualHash
      || child.similarityFamily === children[0].similarityFamily
      || child.duplicateKind === 'exact');
  if (repeatedChildFamily && separatedRatio(children) >= 0.6) {
    return {
      mode: 'children-only',
      confidence: 1,
      reasons: ['Repeated child visuals occupy separate regions; the parent is treated as a container.'],
    };
  }
  return {
    mode: 'keep-together',
    confidence: 1,
    reasons: ['Kept together until a visual-family analysis or user decision says otherwise.'],
  };
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
    const proposed = recommendation(component, children);
    component.recommendedDiveMode = proposed.mode;
    component.diveConfidence = proposed.confidence;
    component.diveReasons = proposed.reasons;
    if (!component.diveRemembered) component.diveMode = proposed.mode;
  }
  return components;
}
