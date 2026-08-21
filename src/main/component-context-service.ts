import type { ComponentAssetType, ComponentCandidate } from '../shared/types';
import { buildProductionIdentity, normalizeAiName } from './asset-intelligence-service.ts';

function cleanLabel(value: string): string {
  return normalizeAiName(value).displayName;
}

function canonicalName(component: ComponentCandidate): string {
  const remembered = component.remembered ? cleanLabel(component.exportName || '') : '';
  if (remembered) return remembered;
  // `aiModelSuggestedName` is the raw proposal, not an accepted decision.
  // The hosted resolver deliberately clears the production fields when a
  // packet is incomplete or challenged without a complete replacement. Never
  // resurrect that stale proposal during the later context pass.
  const unresolved = component.analysisSource === 'local-provisional'
    || component.analysisSource === 'unavailable'
    || ['provisional', 'queued'].includes(component.analysisState || '');
  const aiName = unresolved
    ? ''
    : cleanLabel(component.aiSuggestedName || component.familyName || '');
  if (aiName) return aiName;
  return '';
}

export function componentCategory(type: ComponentAssetType): string {
  const irregular: Partial<Record<ComponentAssetType, string>> = {
    Text: 'Text', FX: 'FX', ScrollBar: 'ScrollBars', TextBox: 'TextBoxes',
  };
  return irregular[type] || (type === 'Unknown' ? 'Uncategorised' : `${type}s`);
}

export function componentSubcategory(component: ComponentCandidate, components: ComponentCandidate[]): string {
  const byKey = new Map(components.map((candidate) => [candidate.hierarchyKey, candidate]));
  const segments: string[] = [];
  let parent = byKey.get(component.parentHierarchyKey);
  while (parent && segments.length < 5) {
    const label = cleanLabel(parent.exportName || parent.layerLabel || parent.name || '');
    if (label && !segments.some((segment) => segment.toLowerCase() === label.toLowerCase())) segments.unshift(label);
    parent = byKey.get(parent.parentHierarchyKey);
  }
  // The slash is intentional: LibraryService converts this structural chain
  // into nested safe directory segments while manifests retain one readable path.
  return segments.join('/');
}

/**
 * Context is deliberately non-creative. The model owns semantic naming;
 * Kryeo only preserves user-approved names, formats safe text, and reports
 * when a family has no defensible identity instead of inventing one from
 * layer geometry, hierarchy, or an asset-type lookup table.
 */
export function applyComponentSceneContext(
  components: ComponentCandidate[],
  visualNames: ReadonlyMap<string, string> = new Map(),
): ComponentCandidate[] {
  for (const component of components) {
    // Construction children are not PNG export owners, but they are still
    // editable Affinity layers with their own completed AI decision. Keeping
    // that name preserves the parent/child organisation the scan discovered.
    // Only a flattened duplicate or a purely organisational node has no
    // semantic identity of its own.
    if (component.exportTarget === false && ['duplicate-representation', 'organizational-parent'].includes(component.assetBoundary || '')) {
      component.familyName = '';
      component.layerLabel = component.name;
      component.exportName = undefined;
      component.codeName = undefined;
      component.namingReason = component.boundaryReason || 'This structural layer is not an independent export decision.';
      component.namingIssues = [];
      component.automationIssues = [];
      component.automationState = 'ready';
      continue;
    }
    const modelName = cleanLabel(visualNames.get(component.hierarchyKey) || component.aiSuggestedName || component.familyName || '');
    const selectedName = canonicalName(component);

    // One AI-owned identity drives every destination. Legacy fields remain
    // mirrors for persisted-workspace compatibility, never separate names.
    component.familyName = selectedName;
    component.layerLabel = selectedName;
    component.exportName = selectedName;
    component.namingReason = component.remembered && Boolean(selectedName)
      ? 'Using the production name previously accepted for this visual family.'
      : Boolean(modelName)
        ? 'Using the AI semantic identity for this visual family.'
        : 'No trustworthy AI semantic name was available; Kryeo did not invent one.';

    // Build from the selected semantic name, not from a persisted Affinity
    // label or raw model proposal that may still be present on the candidate.
    const identity = buildProductionIdentity({ ...component, exportName: selectedName });
    component.familyName = identity.displayName;
    component.layerLabel = identity.displayName;
    component.exportName = identity.displayName;
    component.codeName = identity.codeName;
    component.namingIssues = identity.issues;
    component.robloxClassReason = identity.robloxClassReason;
    const semanticIssues = [
      component.semanticConflict
        ? (component.semanticConflictMessage || 'Visual and semantic evidence disagree; one complete decision is required.')
        : '',
      component.assetType === 'Unknown' || component.role === 'Unknown'
        ? 'The AI did not provide one complete asset type and Roblox role decision.'
        : '',
      ['needs-review', 'provisional', 'queued'].includes(component.analysisState || '')
        ? 'This visual family does not have one complete accepted decision.'
        : '',
    ].filter(Boolean);
    component.automationIssues = [...new Set([...identity.issues, ...semanticIssues])];
    component.automationState = component.automationIssues.length ? 'exception' : 'ready';
  }
  return components;
}
