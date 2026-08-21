import type { ComponentAssetType, ComponentCandidate, RobloxUiRole } from '../shared/types';

const STATE_WORDS = new Map([
  ['idle', 'Idle'], ['hover', 'Hover'], ['pressed', 'Pressed'], ['selected', 'Selected'],
  ['disabled', 'Disabled'], ['active', 'Active'], ['inactive', 'Inactive'], ['focused', 'Focused'],
  ['checked', 'Checked'], ['empty', 'Empty'], ['filled', 'Filled'], ['locked', 'Locked'],
]);

const GENERIC_PRODUCTION_NAME = /^(?:untitled(?: asset)?|unknown|asset|component|family|layer|group|object|shape|pixel|image|raster|rectangle|ellipse|artboard|container)(?:\s+\d+)?$/i;
const STYLE_ONLY = /^(?:pixel art|ui art|game ui|interface art|graphic|artwork)$/i;
const BARE_ASSET_TYPE = /^(?:frame|button|icon|panel|slot|bar|badge|label|text|textbox|scrollbar|divider|background|wallpaper|texture|overlay|cursor|tooltip|modal|input|tab|tile|ornament|border|corner|edge|fill|fx)s?$/i;

export const componentAssetTypes = Object.freeze([
  'Unknown', 'Frame', 'Button', 'Icon', 'Panel', 'Slot', 'Bar', 'Badge', 'Label', 'Text',
  'TextBox', 'ScrollBar', 'Divider', 'Background', 'Wallpaper', 'Texture', 'Overlay', 'Cursor',
  'Tooltip', 'Modal', 'Input', 'Tab', 'Tile', 'Ornament', 'Border', 'Corner', 'Edge', 'Fill', 'FX',
] as ComponentAssetType[]);

// This is implementation policy, not a naming policy. Raster exports need a
// deterministic Studio class after the model has named and typed the artwork.
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

/**
 * A validation boundary, not a rewriting boundary. The complete visual
 * decision owns both name and type; silently swapping a type word in a name
 * after that decision recreates the exact split-brain result Kryeo must avoid.
 */
export function strictProductionName(value: string, assetType: ComponentAssetType) {
  const naming = normalizeAiName(value);
  if (assetType === 'Unknown') return naming;
  const mentioned = typeWordsInName(naming.displayName);
  const issues = [...naming.issues];
  const selectedTypePattern = new RegExp(`\\b${titleWords(assetType).join('\\s+')}s?\\b`, 'gi');
  const selectedTypeMatches = [...naming.displayName.matchAll(selectedTypePattern)];
  if (!mentioned.includes(assetType)) {
    issues.push(`The AI name must include the final ${assetType} type.`);
  }
  if (selectedTypeMatches.length > 1) {
    issues.push(`The AI name must include the final ${assetType} type exactly once.`);
  }
  if (mentioned.some((type) => type !== assetType)) {
    issues.push('The AI name contains a type that conflicts with the final classification.');
  }
  const finalTypeMatch = selectedTypeMatches.at(-1);
  if (finalTypeMatch) {
    const prefix = naming.displayName.slice(0, finalTypeMatch.index || 0).trim();
    const suffix = naming.displayName.slice((finalTypeMatch.index || 0) + finalTypeMatch[0].length).trim();
    const allowedSuffixes = new Set(['hover', 'pressed', 'disabled', 'active', 'selected', 'focused', 'default', 'empty', 'filled', 'glow']);
    if (!prefix || (suffix && !suffix.toLowerCase().split(/\s+/).every((word) => /^\d+$/.test(word) || allowedSuffixes.has(word)))) {
      issues.push(`The AI name must place the final ${assetType} type after its descriptive identity.`);
    }
  }
  return { ...naming, issues: [...new Set(issues)] };
}

export function roleForAssetType(type: ComponentAssetType): RobloxUiRole {
  return TYPE_TO_ROLE[type] || 'Unknown';
}

export function buildProductionIdentity(component: ComponentCandidate): {
  displayName: string;
  codeName: string;
  robloxClass: RobloxUiRole;
  robloxClassReason: string;
  issues: string[];
} {
  const naming = strictProductionName(
    component.exportName || component.aiSuggestedName || component.aiModelSuggestedName || '',
    component.assetType,
  );
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
    robloxClass,
    robloxClassReason: robloxClass === 'Unknown'
      ? 'A Studio class is deferred until the AI returns a complete decision.'
      : `The AI selected ${robloxClass} together with the ${component.assetType} classification.`,
    issues: [...new Set(issues)],
  };
}
