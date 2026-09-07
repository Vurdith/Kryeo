import type { ComponentAssetType, ComponentCandidate, RobloxUiRole } from '../shared/types';

const STATE_WORDS = new Map([
  ['idle', 'Idle'], ['hover', 'Hover'], ['pressed', 'Pressed'], ['selected', 'Selected'],
  ['disabled', 'Disabled'], ['active', 'Active'], ['inactive', 'Inactive'], ['focused', 'Focused'],
  ['checked', 'Checked'], ['empty', 'Empty'], ['filled', 'Filled'], ['locked', 'Locked'],
]);

const GENERIC_PRODUCTION_NAME = /^(?:untitled(?: asset)?|unknown|asset|component|family|layer|group|object|shape|pixel|image|raster|rectangle|ellipse|artboard|container)(?:\s+\d+)?$/i;
const STYLE_ONLY = /^(?:pixel art|ui art|game ui|interface art|graphic|artwork)$/i;
const BARE_ASSET_TYPE = /^(?:frame|button|icon|panel|slot|bar|badge|label|text|textbox|scrollbar|divider|background|wallpaper|texture|overlay|cursor|tooltip|modal|input|tab|tile|ornament|border|corner|edge|fill|fx)s?$/i;



const FILE_ARTIFACT_WORDS = new Set([
  'file', 'filename', 'attachment', 'download', 'upload', 'export',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'psd', 'afdesign',
]);

export const componentAssetTypes = Object.freeze([
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor',
  'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
] as ComponentAssetType[]);

const COMPATIBLE_NAME_SUBTYPES: Partial<Record<ComponentAssetType, ReadonlySet<ComponentAssetType>>> = {


  Border: new Set(['Corner', 'Edge', 'Ornament', 'Fill']),
};

export function compatibleNameSubtypes(assetType: ComponentAssetType): ReadonlySet<ComponentAssetType> {
  return COMPATIBLE_NAME_SUBTYPES[assetType] || new Set<ComponentAssetType>();
}



const TYPE_TO_ROLE: Record<ComponentAssetType, RobloxUiRole> = {
  Unknown: 'Unknown', Frame: 'Frame', Button: 'ImageButton', Icon: 'ImageLabel', Panel: 'ImageLabel',
  Slot: 'ImageButton', Bar: 'ImageLabel', Badge: 'ImageLabel', Label: 'TextLabel', Text: 'TextLabel',
  TextBox: 'TextBox', ScrollBar: 'Frame', Divider: 'ImageLabel', Background: 'ImageLabel',
  Wallpaper: 'ImageLabel', Texture: 'ImageLabel', Overlay: 'ImageLabel', Cursor: 'ImageLabel',
  Tooltip: 'ImageLabel', Modal: 'ImageLabel', Input: 'TextBox', Tab: 'ImageButton', Tile: 'ImageButton',
  Ornament: 'ImageLabel', Border: 'ImageLabel', Corner: 'ImageLabel', Edge: 'ImageLabel',
  Fill: 'ImageLabel', FX: 'ImageLabel',
};

function titleWords(value: string): string[] {
  return String(value || '')
    .replace(/\.(?:png|jpe?g|webp|gif|tiff?|afdesign)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase() === 'FX' ? 'FX' : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
}

function deduplicateWords(words: string[]): string[] {
  return words.filter((word, index) => index === 0 || words[index - 1].toLowerCase() !== word.toLowerCase());
}

/**
 * A formatting boundary, not a naming engine. It never adds type words,
 * parent names, positional labels, ordinals, or descriptive content. The AI
 * is the sole author of semantic identity; Kryeo only makes its text stable
 * enough for files, manifests, and Studio.
 */
export function normalizeAiName(value: string): { displayName: string; codeName: string; issues: string[] } {
  const words = deduplicateWords(titleWords(value));
  const normalizedWords = words.map((word) => STATE_WORDS.get(word.toLowerCase()) || word);
  const displayName = normalizedWords.join(' ').slice(0, 80).trim();
  const codeName = displayName
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 80);
  const issues: string[] = [];
  if (!displayName || GENERIC_PRODUCTION_NAME.test(displayName) || STYLE_ONLY.test(displayName) || BARE_ASSET_TYPE.test(displayName)) {
    issues.push('The AI did not provide a distinctive semantic asset name.');
  }
  const rawWords = titleWords(value).map((word) => word.toLowerCase());
  if (rawWords.some((word) => FILE_ARTIFACT_WORDS.has(word)) || rawWords.some((word) => /^\d{5,}$/.test(word))) {
    issues.push('The AI name contains a file or export artefact instead of a visual identity.');
  }
  if (!codeName) issues.push('A Roblox-safe code name could not be generated.');
  return { displayName, codeName, issues };
}

function typeWordsInName(value: string): ComponentAssetType[] {
  const normalized = titleWords(value).join(' ');
  return componentAssetTypes
    .filter((type) => type !== 'Unknown')
    .filter((type) => {
      const words = titleWords(type).join('\\s+');
      return new RegExp(`\\b${words}s?\\b`, 'i').test(normalized);
    });
}

const POST_TYPE_QUALIFIERS = new Set([
  'hover', 'pressed', 'disabled', 'active', 'selected', 'focused', 'default', 'empty', 'filled', 'glow',
  'set', 'sets', 'collection', 'collections', 'assembly', 'assemblies', 'group', 'groups', 'series', 'pack', 'packs',
]);

const STRUCTURAL_NAME_WORDS = new Set([
  'untitled', 'asset', 'component', 'family', 'layer', 'group', 'object', 'shape', 'pixel', 'image', 'raster',
  'export', 'rectangle', 'ellipse', 'artboard', 'container', 'piece', 'part', 'element', 'visual',
]);

interface TypePhraseRange {
  type: ComponentAssetType;
  start: number;
  end: number;
}

function typePhraseRanges(words: string[]): TypePhraseRange[] {
  const phrases = componentAssetTypes
    .filter((type) => type !== 'Unknown')
    .map((type) => ({ type, words: titleWords(type).map((word) => word.toLowerCase()) }))
    .sort((left, right) => right.words.length - left.words.length || right.type.length - left.type.length);
  const ranges: TypePhraseRange[] = [];
  for (let index = 0; index < words.length;) {
    const match = phrases.find((phrase) => phrase.words.every((word, offset) => {
      const candidate = words[index + offset]?.toLowerCase();
      return candidate === word || candidate === `${word}s`;
    }));
    if (!match) {
      index += 1;
      continue;
    }
    ranges.push({ type: match.type, start: index, end: index + match.words.length });
    index = match.words.length + index;
  }
  return ranges;
}

function isCompatibleTypePhrase(type: ComponentAssetType, selectedType: ComponentAssetType): boolean {
  return type === selectedType || compatibleNameSubtypes(selectedType).has(type);
}

function isPostTypeQualifier(word: string): boolean {
  return /^\d+$/.test(word) || POST_TYPE_QUALIFIERS.has(word.toLowerCase());
}

/**
 * Canonicalise only the grammar of a model-owned name. This splits source-like
 * CamelCase, preserves every semantic word, and moves the already-selected
 * type behind its descriptors. It never adds, removes, or substitutes a type
 * or visual identity, so a disputed semantic packet still has to be replaced
 * by the visual reviewer.
 */
export function canonicalAiNameForType(value: string, assetType: ComponentAssetType): string {
  const normalized = normalizeAiName(value).displayName;
  if (!normalized || assetType === 'Unknown') return normalized;
  const words = titleWords(normalized);
  const ranges = typePhraseRanges(words);
  const selected = ranges.filter((range) => range.type === assetType);
  if (selected.length !== 1 || ranges.some((range) => !isCompatibleTypePhrase(range.type, assetType))) {
    return normalized;
  }
  const target = selected[0];
  const before = words.slice(0, target.start);
  const after = words.slice(target.end);
  const trailingQualifiers = after.filter(isPostTypeQualifier);
  const trailingDescriptors = after.filter((word) => !isPostTypeQualifier(word));
  const descriptor = [...before, ...trailingDescriptors];
  if (!descriptor.some((word) => !/^\d+$/.test(word))) return normalized;
  return normalizeAiName([
    ...descriptor,
    ...words.slice(target.start, target.end),
    ...trailingQualifiers,
  ].join(' ')).displayName;
}

/**
 * Reconcile a model's semantic words with the final type without inventing a
 * new visual identity. This is the atomic name/type boundary: it removes a
 * contradictory taxonomy word, moves a positional descriptor before the
 * terminal type, and appends a missing final type when the model supplied a
 * meaningful identity. It deliberately leaves structural placeholders such
 * as `Layer 1` unresolved.
 */
export function reconcileAiNameForType(value: string, assetType: ComponentAssetType): string {
  const normalized = normalizeAiName(value).displayName;
  if (!normalized || assetType === 'Unknown') return normalized;
  const words = titleWords(normalized);
  const ranges = typePhraseRanges(words);
  const target = ranges.find((range) => range.type === assetType);
  const removableTypeWordAt = new Set<number>();
  for (const range of ranges) {
    // Keep one final selected-type phrase. A model name can already contain
    // its type (for example `Health Bar`); copying that name into a sibling
    // normalizer must not turn it into `Health Bar Bar`.
    if (range.type === assetType && range !== target) {
      for (let index = range.start; index < range.end; index += 1) removableTypeWordAt.add(index);
      continue;
    }
    if (isCompatibleTypePhrase(range.type, assetType)) continue;
    for (let index = range.start; index < range.end; index += 1) removableTypeWordAt.add(index);
  }

  if (target) {
    const before = words.slice(0, target.start).filter((_word, index) => !removableTypeWordAt.has(index));
    const after = words.slice(target.end).filter((_word, index) => !removableTypeWordAt.has(target.end + index));
    const descriptor = [...before, ...after.filter((word) => !isPostTypeQualifier(word))]
      .filter((word) => !STRUCTURAL_NAME_WORDS.has(word.toLowerCase()));
    const qualifiers = after.filter(isPostTypeQualifier);
    const meaningfulDescriptor = descriptor.filter((word) => !/^\d+$/.test(word));
    if (!meaningfulDescriptor.length || meaningfulDescriptor.every((word) => STRUCTURAL_NAME_WORDS.has(word.toLowerCase()))) return normalized;
    return normalizeAiName([...meaningfulDescriptor, ...titleWords(assetType), ...qualifiers].join(' ')).displayName;
  }

  const descriptor = words.filter((_word, index) => !removableTypeWordAt.has(index));
  const identity = descriptor
    .filter((word) => !isPostTypeQualifier(word) && !/^\d+$/.test(word))
    .filter((word) => !STRUCTURAL_NAME_WORDS.has(word.toLowerCase()));
  if (!identity.length || identity.every((word) => STRUCTURAL_NAME_WORDS.has(word.toLowerCase()))) return normalized;
  const qualifiers = descriptor.filter(isPostTypeQualifier);
  return normalizeAiName([...identity, ...titleWords(assetType), ...qualifiers].join(' ')).displayName;
}

/**
 * A validation boundary, not a rewriting boundary. The complete visual
 * decision owns both name and type; silently swapping a type word in a name
 * after that decision recreates the exact split-brain result Kryeo must avoid.
 */
export function strictProductionName(value: string, assetType: ComponentAssetType) {
  const canonicalName = canonicalAiNameForType(value, assetType);
  const naming = normalizeAiName(canonicalName);
  if (assetType === 'Unknown') return naming;
  const mentioned = typeWordsInName(naming.displayName);
  const issues = [...naming.issues];
  if (/\b(?:layer|group|node|raster|shape|image|asset|element)\s*\d*\b/i.test(naming.displayName)) {
    issues.push('The AI name contains an editor-default construction label.');
  }
  const selectedTypePattern = new RegExp(`\\b${titleWords(assetType).join('\\s+')}s?\\b`, 'gi');
  const selectedTypeMatches = [...naming.displayName.matchAll(selectedTypePattern)];
  if (!mentioned.includes(assetType)) {
    issues.push(`The AI name must include the final ${assetType} type.`);
  }
  if (selectedTypeMatches.length > 1) {
    issues.push(`The AI name must include the final ${assetType} type exactly once.`);
  }
  if (mentioned.some((type) => type !== assetType && !compatibleNameSubtypes(assetType).has(type))) {
    issues.push('The AI name contains a type that conflicts with the final classification.');
  }
  const finalTypeMatch = selectedTypeMatches.at(-1);
  if (finalTypeMatch) {
    const prefix = naming.displayName.slice(0, finalTypeMatch.index || 0).trim();
    const suffix = naming.displayName.slice((finalTypeMatch.index || 0) + finalTypeMatch[0].length).trim();
    const allowedSuffixes = new Set([
      'hover', 'pressed', 'disabled', 'active', 'selected', 'focused', 'default', 'empty', 'filled', 'glow',
      'top', 'bottom', 'left', 'right', 'center', 'middle', 'inner', 'outer', 'inset', 'outline',
      'edge', 'edges', 'side', 'sides', 'corner', 'corners', 'segment', 'segments', 'cluster', 'clusters',
      'ornament', 'ornaments', 'ornamental', 'border', 'borders', 'frame', 'frames', 'fill', 'background',
      'holder', 'panel', 'centered', 'structural', 'solid', 'partial', 'full', 'heavy', 'light', 'complete',
      'set', 'sets', 'collection', 'collections', 'assembly', 'assemblies', 'group', 'groups', 'series', 'pack', 'packs',
    ]);
    // A taxonomy word plus a number is a placeholder, not an identity. The
    // sibling resolver may add an ordinal to an already meaningful name, but
    // it must never make `Border 1` or `Wallpaper 8` export-ready by itself.
    if (!prefix || (suffix && !suffix.toLowerCase().split(/\s+/).every((word) => /^\d+$/.test(word) || allowedSuffixes.has(word)))) {
      issues.push(`The AI name must place the final ${assetType} type after its descriptive identity.`);
    }
  }
  return { ...naming, issues: [...new Set(issues)] };
}

export function roleForAssetType(type: ComponentAssetType): RobloxUiRole {
  return TYPE_TO_ROLE[type] || 'Unknown';
}

/**
 * This is the global Roblox export contract, not an artwork heuristic. Kryeo
 * may use it to reject an incoherent model packet and request a complete
 * model replacement, but it must never change the model's type or role.
 */
export function hasCompatibleRobloxRole(type: ComponentAssetType, role: RobloxUiRole): boolean {
  return type !== 'Unknown' && role !== 'Unknown' && roleForAssetType(type) === role;
}

export function buildProductionIdentity(component: ComponentCandidate): {
  displayName: string;
  codeName: string;
  robloxClass: RobloxUiRole;
  robloxClassReason: string;
  issues: string[];
} {
  const naming = strictProductionName(
    component.exportName || component.aiSuggestedName || component.familyName || '',
    component.assetType,
  );
  // A generic source label is not a production identity. Keep genuinely
  // descriptive proposals visible when another field is disputed, but never
  // let placeholders such as “Layer 7” leak into Affinity, PNG, or manifest
  // names while the family is unresolved.
  const hasDistinctiveName = !naming.issues.some((issue) => (
    /distinctive semantic asset name|Roblox-safe code name could not/i.test(issue)
  ));
  const displayName = hasDistinctiveName ? naming.displayName : '';
  const codeName = displayName ? naming.codeName : '';
  // The visual model returns type and Roblox role as one atomic decision.
  // This production boundary may derive a safe code name, but it must never
  // replace just the role from a type lookup after the decision was accepted.
  const robloxClass = component.role;
  const issues = [...naming.issues];
  if (component.assetType === 'Unknown' || robloxClass === 'Unknown') {
    issues.push('The AI did not provide one complete asset type and Roblox role decision.');
  }
  return {
    ...naming,
    displayName,
    codeName,
    robloxClass,
    robloxClassReason: robloxClass === 'Unknown'
      ? 'A Studio class is deferred until the AI returns a complete decision.'
      : `The AI selected ${robloxClass} together with the ${component.assetType} classification.`,
    issues: [...new Set(issues)],
  };
}
