import { createHash } from 'node:crypto';
import type { ComponentCandidate, ComponentScanMode, ScanIntentAnswer, ScanIntentProfile } from '../shared/types';

export function structureFingerprint(components: ComponentCandidate[]): string {
  const shape = components
    .map((component) => [
      component.hierarchyKey,
      component.parentHierarchyKey,
      component.grouping,
      component.childCount,
      component.descendantCount,
      component.affinityType,
    ].join('|'))
    .sort()
    .join('\n');
  return createHash('sha256').update(shape).digest('hex').slice(0, 24);
}

export function normalizeScanIntent(
  intent: Partial<Pick<ScanIntentProfile, 'mode' | 'answers'>> | undefined,
): Pick<ScanIntentProfile, 'mode' | 'answers'> {
  const mode: ComponentScanMode = ['smart', 'group-first', 'layer-inclusive'].includes(String(intent?.mode))
    ? intent?.mode as ComponentScanMode
    : 'smart';
  const allowed = new Set(['ungrouped-layers', 'repeated-children', 'document-purpose']);
  const answers = (Array.isArray(intent?.answers) ? intent.answers : [])
    .filter((answer): answer is ScanIntentAnswer => Boolean(answer) && allowed.has(answer.id) && typeof answer.value === 'string')
    .map((answer) => ({ id: answer.id, value: answer.value.trim().slice(0, 80) }))
    .filter((answer) => answer.value)
    .slice(0, 3);
  return { mode, answers };
}

export function scanIntentContext(intent: Pick<ScanIntentProfile, 'mode' | 'answers'>): string {
  const normalized = normalizeScanIntent(intent);
  const modeDescription = {
    smart: 'Prefer meaningful Affinity groups as assets. Treat standalone layers as assets only when their visual role is independently reusable.',
    'group-first': 'Treat groups and composed parents as assets. Keep ordinary ungrouped construction layers inside their nearest meaningful parent.',
    'layer-inclusive': 'Include meaningful ungrouped visual layers as independent asset candidates when they are visible and reusable.',
  }[normalized.mode];
  const answers = normalized.answers.map((answer) => `${answer.id}=${answer.value}`).join('; ');
  return `Confirmed scan intent: ${modeDescription}${answers ? ` Designer context: ${answers}.` : ''}`;
}

export function applyScanIntent(components: ComponentCandidate[], intent: Pick<ScanIntentProfile, 'mode' | 'answers'>): ComponentCandidate[] {
  const normalized = normalizeScanIntent(intent);
  const ungrouped = normalized.answers.find((answer) => answer.id === 'ungrouped-layers')?.value;
  const includeSingles = normalized.mode === 'layer-inclusive' || ungrouped === 'standalone-assets';
  const excludeSingles = normalized.mode === 'group-first' || ungrouped === 'construction-only';
  return components.map((component) => {
    if (component.grouping !== 'single' || component.childCount > 0) return component;
    if (includeSingles) return { ...component, exportTarget: true };
    if (excludeSingles) return { ...component, exportTarget: false, keptInsideParent: true };
    return component;
  });
}
