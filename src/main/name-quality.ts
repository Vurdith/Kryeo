const EXTENSION = /\.(?:png|jpe?g|webp|gif|tiff?|afdesign)$/i;
const DEFAULT_LAYER = /^(?:layer|group|object|shape|curve|pixel|image|raster|rectangle|ellipse|artboard|container|copy|untitled|new layer)[\s_-]*\d*$/i;
const CAMERA_EXPORT = /^(?:img|dsc|photo|pic|image|screenshot|screen shot|export|asset)[\s_-]*(?:\d[\d_-]*)$/i;
const GUID_OR_HASH = /^(?:[a-f0-9]{16,}|[a-f0-9]{8}-[a-f0-9-]{20,})$/i;

function splitWords(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function nameMeaninglessness(input: string): number {
  const raw = input.trim();
  if (!raw) return 1;
  const base = raw.replace(EXTENSION, '').trim();
  if (!base) return 1;
  if (DEFAULT_LAYER.test(base) || CAMERA_EXPORT.test(base) || GUID_OR_HASH.test(base)) return 1;
  if (/^\d{5,}$/.test(base)) return 1;

  const compact = base.replace(/[^a-z0-9]/gi, '');
  if (!compact) return 1;
  const digits = (compact.match(/\d/g) || []).length;
  if (compact.length >= 8 && digits / compact.length >= 0.55) return 0.96;
  if (/^[a-z0-9]{12,}$/i.test(compact) && /[a-z]/i.test(compact) && /\d/.test(compact)) return 0.9;

  const words = splitWords(base);
  const alphabetic = words.filter((word) => /^[a-z]+$/i.test(word));
  const readable = alphabetic.filter((word) => word.length >= 2 && /[aeiouy]/i.test(word));
  if (words.length >= 2 && readable.length >= Math.ceil(alphabetic.length * 0.6)) return 0.05;

  if (words.length === 1 && /^[a-z]+$/i.test(words[0])) {
    const word = words[0];
    if (word.length <= 3 && word === word.toLowerCase()) return 0.78;
    const vowelRatio = (word.match(/[aeiouy]/gi) || []).length / word.length;
    if (word.length >= 7 && (vowelRatio < 0.16 || /[bcdfghjklmnpqrstvwxz]{5,}/i.test(word))) return 0.86;
    return 0.12;
  }

  if (readable.length > 0) return 0.18;
  return 0.72;
}

export function isMeaninglessName(input: string, threshold = 0.7): boolean {
  return nameMeaninglessness(input) >= threshold;
}
