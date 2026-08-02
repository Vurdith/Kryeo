import type { ComponentAssetType, ComponentCandidate } from '../shared/types';
import { isMeaninglessName } from './name-quality.ts';

const GENERIC_NAME = /^(layer|group|object|shape|curve|pixel|image|raster|rectangle|ellipse|artboard|container)[\s_-]*\d*$/i;
const STRUCTURAL_WORDS = new Set([
  'ui', 'root', 'container', 'containers', 'group', 'groups', 'layer', 'layers',
  'middle', 'outer', 'inner', 'center', 'centre', 'base', 'main', 'foreground',
  'background', 'backdrop', 'border', 'borders', 'frame', 'frames', 'corner',
  'corners', 'edge', 'edges', 'fill', 'fills', 'outline', 'outlines', 'content',
  'contents', 'top', 'bottom', 'left', 'right', 'side', 'sides',
]);

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function singularType(type: ComponentAssetType): string {
  return type;
}

function pluralType(type: ComponentAssetType): string {
  const irregular: Partial<Record<ComponentAssetType, string>> = {
    Text: 'Text',
    FX: 'FX',
    ScrollBar: 'Scroll Bars',
    TextBox: 'Text Boxes',
  };
  return irregular[type] || `${type}s`;
}

function stripTrailingType(value: string, type: ComponentAssetType): string {
  const singular = singularType(type).replace(/\s+/g, '\\s*');
  const plural = pluralType(type).replace(/\s+/g, '\\s*');
  return value
    .replace(new RegExp(`\\s+(?:${singular}|${plural})$`, 'i'), '')
    .trim();
}

function isStructuralLabel(value: string): boolean {
  const tokens = titleCase(value).toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => STRUCTURAL_WORDS.has(token));
}

function dedupeIdentity(ancestor: string, own: string): string {
  if (!ancestor) return own;
  if (!own) return ancestor;
  const normalizedAncestor = ancestor.toLowerCase();
  const normalizedOwn = own.toLowerCase();
  if (normalizedOwn === normalizedAncestor || normalizedOwn.startsWith(`${normalizedAncestor} `)) return own;
  if (normalizedAncestor.startsWith(`${normalizedOwn} `)) return ancestor;
  return `${ancestor} ${own}`.trim();
}

function parentIdentity(parent: ComponentCandidate, childType: ComponentAssetType, ancestorDescriptor = ''): {
  collection: string;
  item: string;
} {
  const family = titleCase(parent.familyName);
  const source = !family || GENERIC_NAME.test(family) || family.toLowerCase() === childType.toLowerCase()
    ? titleCase(parent.name)
    : family;
  const descriptor = stripTrailingType(source, childType)
    .replace(/\s+\d+$/i, '')
    .trim();
  const ownDescriptor = descriptor
    && !GENERIC_NAME.test(descriptor)
    && (!isStructuralLabel(descriptor) || !ancestorDescriptor)
    ? descriptor
    : '';
  const meaningfulDescriptor = dedupeIdentity(ancestorDescriptor, ownDescriptor);
  return {
    collection: `${meaningfulDescriptor ? `${meaningfulDescriptor} ` : ''}${pluralType(childType)}`.slice(0, 80),
    item: `${meaningfulDescriptor ? `${meaningfulDescriptor} ` : ''}${singularType(childType)}`.slice(0, 72),
  };
}

function isConstructionType(type: ComponentAssetType): boolean {
  return ['Frame', 'Border', 'Corner', 'Edge', 'Ornament', 'Fill'].includes(type);
}

function isGenericLayerName(value: string): boolean {
  return GENERIC_NAME.test(titleCase(value));
}

function namedConstructionType(value: string): ComponentAssetType | undefined {
  const source = titleCase(value).toLowerCase();
  if (/\bborder(?:s)?\b/.test(source)) return 'Border';
  if (/\bcorner(?:s)?\b/.test(source)) return 'Corner';
  if (/\bedge(?:s)?\b/.test(source)) return 'Edge';
  if (/\bornament(?:s)?\b/.test(source)) return 'Ornament';
  if (/\bframe(?:s)?\b/.test(source)) return 'Frame';
  if (/\bfill(?:s)?\b/.test(source)) return 'Fill';
  return undefined;
}

function ancestorDescriptor(parent: ComponentCandidate, byKey: ReadonlyMap<string, ComponentCandidate>): string {
  let ancestor = parent.parentHierarchyKey ? byKey.get(parent.parentHierarchyKey) : undefined;
  while (ancestor) {
    const family = titleCase(ancestor.familyName).replace(/\s+\d+$/i, '').trim();
    if (family && !GENERIC_NAME.test(family) && !isStructuralLabel(family)) {
      const plural = ancestor.assetType !== 'Unknown' ? pluralType(ancestor.assetType) : '';
      const collectionPattern = plural ? new RegExp(`\\s+${plural.replace(/\s+/g, '\\s*')}$`, 'i') : undefined;
      const root = collectionPattern ? family.replace(collectionPattern, '').trim() : family;
      if (root && !GENERIC_NAME.test(root) && !isStructuralLabel(root)) return root;
      if (!collectionPattern) return family;
    }

    const source = titleCase(ancestor.name).replace(/\s+\d+$/i, '').trim();
    if (!GENERIC_NAME.test(source) && !isStructuralLabel(source)) {
      const type = ancestor.semanticType || namedConstructionType(source) || ancestor.assetType;
      const trimmed = type && type !== 'Unknown' ? stripTrailingType(source, type) : source;
      if (trimmed && !GENERIC_NAME.test(trimmed) && !isStructuralLabel(trimmed)) return trimmed;
    }
    ancestor = ancestor.parentHierarchyKey ? byKey.get(ancestor.parentHierarchyKey) : undefined;
  }
  return '';
}

function visualNameWithType(name: string, type: ComponentAssetType): string {
  const clean = titleCase(name)
    .replace(/\.(?:png|jpe?g|webp|gif|tiff?)$/i, '')
    .replace(/[.:;]+$/g, '')
    .trim()
    .slice(0, 64);
  if (!clean) return type;
  return new RegExp(`\\b${type}\\b`, 'i').test(clean) ? clean : `${clean} ${type}`.slice(0, 80);
}

function mayRefineName(component: ComponentCandidate): boolean {
  if (component.remembered) return false;
  const current = component.familyName.trim();
  return isMeaninglessName(component.name)
    || isMeaninglessName(current)
    || GENERIC_NAME.test(current)
    || current.toLowerCase() === component.assetType.toLowerCase();
}

export function componentCategory(type: ComponentAssetType): string {
  const irregular: Partial<Record<ComponentAssetType, string>> = {
    Text: 'Text',
    FX: 'FX',
    ScrollBar: 'ScrollBars',
    TextBox: 'TextBoxes',
  };
  return irregular[type] || (type === 'Unknown' ? 'Uncategorised' : `${type}s`);
}

export function componentSubcategory(component: ComponentCandidate, components: ComponentCandidate[]): string {
  if (!component.parentHierarchyKey) return '';
  const parent = components.find((candidate) => candidate.hierarchyKey === component.parentHierarchyKey);
  if (!parent || parent.diveMode === 'keep-together') return '';
  return titleCase(parent.familyName || parent.name).slice(0, 80);
}

export function applyComponentSceneContext(
  components: ComponentCandidate[],
  visualNames: ReadonlyMap<string, string> = new Map(),
): ComponentCandidate[] {
  const byKey = new Map(components.map((component) => [component.hierarchyKey, component]));

  for (const component of components) {
    if (!component.remembered) {
      component.familyName = titleCase(component.familyName).slice(0, 80);
      const readableSource = titleCase(component.name);
      const sourceWithoutNumber = readableSource.replace(/\s+\d+$/i, '').trim();
      const familyWithoutNumber = component.familyName.replace(/\s+\d+$/i, '').trim();
      if (
        component.duplicateCount > 1
        && sourceWithoutNumber !== readableSource
        && familyWithoutNumber.toLowerCase() === sourceWithoutNumber.toLowerCase()
      ) {
        component.familyName = familyWithoutNumber;
      }
    }
    const sourceName = titleCase(component.name);
    const sourceNamesItsType = component.assetType !== 'Unknown'
      && new RegExp(`\\b${component.assetType}(?:s|\\s*\\d+)?\\b`, 'i').test(sourceName);
    if (
      !component.remembered
      && !isMeaninglessName(component.name)
      && sourceNamesItsType
      && mayRefineName(component)
    ) {
      component.familyName = sourceName.slice(0, 80);
      component.nameSource = 'layer-name';
    }
    const namedType = namedConstructionType(component.name);
    if (
      !component.remembered
      && namedType
      && (
        component.assetType === 'Unknown'
        || component.assetType !== namedType && component.nameSource !== 'visual'
      )
    ) {
      component.assetType = namedType;
      component.aiSuggestedType = namedType;
      component.reviewCategory = 'construction';
    }
    const visualName = visualNames.get(component.hierarchyKey);
    if (visualName && mayRefineName(component)) component.familyName = visualNameWithType(visualName, component.assetType);
  }

  // Apply a direct parent's identity before naming its children. The later
  // group pass is depth-ordered so grandchildren inherit the fully resolved
  // root identity instead of the nearest structural layer label.
  for (const child of components) {
    if (child.remembered || !child.parentHierarchyKey || child.assetType === 'Unknown') continue;
    const parent = byKey.get(child.parentHierarchyKey);
    if (!parent || parent.remembered) continue;
    const source = titleCase(child.name);
    const typeName = singularType(child.assetType);
    const pluralName = pluralType(child.assetType);
    const typePattern = `(?:${typeName.replace(/\s+/g, '\\s*')}|${pluralName.replace(/\s+/g, '\\s*')})`;
    if (!new RegExp(`\\b${typePattern}\\b`, 'i').test(source)) continue;
    const remainder = source
      .replace(new RegExp(`\\b${typePattern}\\b`, 'ig'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (remainder && !isStructuralLabel(remainder)) continue;
    const parentName = titleCase(parent.familyName);
    if (!parentName || GENERIC_NAME.test(parentName) || isStructuralLabel(parentName)) continue;
    const collectionType = new RegExp(`\\b${pluralName.replace(/\s+/g, '\\s*')}\\b`, 'i').test(source)
      ? pluralName
      : typeName;
    child.familyName = `${parentName} ${collectionType}`.replace(/\s+/g, ' ').trim().slice(0, 80);
    child.nameSource = 'visual';
  }

  const parentsInHierarchyOrder = [...components].sort((left, right) => left.hierarchyDepth - right.hierarchyDepth);
  for (const parent of parentsInHierarchyOrder) {
    const children = parent.childHierarchyKeys
      .map((key) => byKey.get(key))
      .filter((child): child is ComponentCandidate => Boolean(child));
    const parentSemanticType = parent.semanticType && parent.nameSource !== 'visual'
      ? parent.semanticType
      : namedConstructionType(parent.name);

    // A named construction group such as "OuterBorders" gives its anonymous
    // direct children a shared semantic role. Broad containers (for example UI)
    // do not qualify, so they cannot rename unrelated asset families.
    if (parentSemanticType && isConstructionType(parentSemanticType)) {
      for (const child of children) {
        if (child.remembered || !isGenericLayerName(child.name)) continue;
        child.assetType = parentSemanticType;
        child.aiSuggestedType = parentSemanticType;
        child.reviewCategory = 'construction';
      }
    }

    const byType = new Map<ComponentAssetType, ComponentCandidate[]>();
    for (const child of children) {
      if (child.assetType === 'Unknown' || child.assetType === 'FX') continue;
      const group = byType.get(child.assetType) || [];
      group.push(child);
      byType.set(child.assetType, group);
    }

    const broadContainer = /^(ui|root|container|group|layer)$/i.test(titleCase(parent.name));
    const coherentConstructionGroup = Boolean(parentSemanticType && isConstructionType(parentSemanticType))
      || (!broadContainer && byType.size === 1);
    if (!coherentConstructionGroup) continue;

    for (const [childType, typedChildren] of byType) {
      const uniqueHashes = [...new Set(typedChildren.map((child) => child.visualHash))];
      if (typedChildren.length < 2 && !(parentSemanticType && isConstructionType(parentSemanticType))) continue;

      const effects = children.filter((child) =>
        child.assetType === 'FX'
        && /(glow|shine|highlight|light|shadow)/i.test(`${child.name} ${child.familyName}`));
      const ordered = children.filter((child) => typedChildren.includes(child) || effects.includes(child));
      const identity = parentIdentity(parent, childType, ancestorDescriptor(parent, byKey));
      if (!parent.remembered) {
        parent.familyName = identity.collection;
        parent.nameSource = 'visual';
      }

      const numberByHash = new Map<string, number>();
      let nextNumber = 1;
      const needsOrdinal = typedChildren.length > 1 || uniqueHashes.length > 1;
      for (const child of ordered) {
        if (child.remembered) continue;
        let number = numberByHash.get(child.visualHash);
        if (!number) {
          number = nextNumber;
          numberByHash.set(child.visualHash, number);
          nextNumber += 1;
        }
        const suffix = child.assetType === 'FX' ? ' Glow' : '';
        child.familyName = `${identity.item}${needsOrdinal ? ` ${number}` : ''}${suffix}`.slice(0, 80);
        child.nameSource = 'visual';
        child.aiReason = `Named within ${identity.collection} so sibling exports share one identity and remain ordered.`;
      }
    }
  }

  return components;
}
