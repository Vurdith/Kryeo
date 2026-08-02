import type { AssistantMemory, ComponentAssetType, ComponentCandidate, RobloxUiRole } from '../shared/types';

const TYPE_NAMES: Array<[RegExp, ComponentAssetType]> = [
  [/progress\s*bar|status\s*bar|health\s*bar/i, 'Bar'], [/scroll\s*bar/i, 'ScrollBar'], [/text\s*box/i, 'TextBox'],
  [/button/i, 'Button'], [/slot/i, 'Slot'], [/panel/i, 'Panel'], [/frame/i, 'Frame'],
  [/icon/i, 'Icon'], [/badge/i, 'Badge'], [/label/i, 'Label'], [/divider/i, 'Divider'],
  [/texture|pattern/i, 'Texture'], [/overlay/i, 'Overlay'],
  [/wallpaper/i, 'Wallpaper'], [/background/i, 'Background'], [/cursor/i, 'Cursor'], [/tooltip/i, 'Tooltip'],
  [/modal/i, 'Modal'], [/input/i, 'Input'], [/tab/i, 'Tab'], [/tile/i, 'Tile'], [/ornament|decoration/i, 'Ornament'],
  [/border/i, 'Border'], [/corner/i, 'Corner'], [/edge/i, 'Edge'], [/fill/i, 'Fill'], [/effect|\bfx\b/i, 'FX'], [/\btext\b/i, 'Text'],
];

const ROLE_BY_TYPE: Partial<Record<ComponentAssetType, RobloxUiRole>> = {
  Button: 'ImageButton', Slot: 'ImageButton', Tab: 'ImageButton', Tile: 'ImageButton', Icon: 'ImageLabel', Background: 'ImageLabel',
  Wallpaper: 'ImageLabel', Texture: 'ImageLabel', Overlay: 'ImageLabel', Ornament: 'ImageLabel', Border: 'ImageLabel', Corner: 'ImageLabel', Edge: 'ImageLabel', Fill: 'ImageLabel', FX: 'ImageLabel',
  Bar: 'ImageLabel', Badge: 'ImageLabel', Divider: 'ImageLabel', Cursor: 'ImageLabel', Label: 'TextLabel', Text: 'TextLabel', TextBox: 'TextBox', Input: 'TextBox',
  Panel: 'Frame', Frame: 'Frame', Tooltip: 'Frame', Modal: 'Frame', ScrollBar: 'Frame',
};

const ROLE_NAMES: Array<[RegExp, RobloxUiRole]> = [
  [/image\s*button/i, 'ImageButton'], [/image\s*label/i, 'ImageLabel'],
  [/text\s*button/i, 'TextButton'], [/text\s*label/i, 'TextLabel'],
  [/text\s*box/i, 'TextBox'], [/frame/i, 'Frame'],
];

function normalized(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function singularPhrase(value: string): string {
  return normalized(value).split(' ').map((word) => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word).join(' ');
}

export interface AssistantClassificationRule {
  subject: string;
  type?: ComponentAssetType;
  role?: RobloxUiRole;
}

export function parseAssistantClassificationRule(value: string): AssistantClassificationRule | undefined {
  if (value.trim().endsWith('?') || /^(?:what|why|how|when|where|can|could|should|is|are|do|does)\b/i.test(value.trim())) return undefined;
  const text = normalized(value.replace(/^remember(?: that| this)?\s*/i, ''));
  const match = text.match(/(?:(?:every|all|treat)\s+)?(.+?)\s+(?:is|are|as|should be|must be)\s+(?:a |an )?(.+)$/i);
  if (!match) return undefined;
  const role = ROLE_NAMES.find(([pattern]) => pattern.test(match[2]))?.[1];
  const type = role ? undefined : TYPE_NAMES.find(([pattern]) => pattern.test(match[2]))?.[1];
  if (!role && !type) return undefined;
  return { subject: singularPhrase(match[1]), type, role };
}

function keepInsideTerms(memory: AssistantMemory): string[] {
  if (!/(stay|stays|keep|kept).*inside|inside.*parent/i.test(memory.text)) return [];
  return normalized(memory.text).split(' ').filter((word) => /border|decoration|ornament|shadow|glow|stroke|fill/.test(word));
}

export function applyAssistantMemoryRules(components: ComponentCandidate[], memories: AssistantMemory[], documentTitle: string): ComponentCandidate[] {
  const applicable = memories.filter((memory) => memory.project === 'General' || memory.project === documentTitle || memory.documentTitle === documentTitle);
  for (const memory of applicable) {
    const rule = parseAssistantClassificationRule(memory.text);
    if (rule) {
      for (const component of components) {
        const identity = singularPhrase(`${component.name} ${component.familyName} ${component.assetType}`);
        if (!identity.includes(rule.subject)) continue;
        if (rule.type) component.assetType = rule.type;
        component.role = rule.role || (rule.type ? ROLE_BY_TYPE[rule.type] : undefined) || component.role;
        component.aiSuggestedType = component.assetType;
        component.aiSuggestedRole = component.role;
        component.aiConfidence = 0.99;
        component.aiSource = 'memory';
      }
    }
    const insideTerms = keepInsideTerms(memory);
    if (insideTerms.length) {
      for (const component of components) {
        if (!component.parentHierarchyKey) continue;
        const identity = normalized(`${component.name} ${component.familyName}`);
        if (insideTerms.some((term) => identity.includes(term))) component.keptInsideParent = true;
      }
    }
  }
  return components;
}
