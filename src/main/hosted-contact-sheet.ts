import sharp from 'sharp';
import type { ComponentVisualFamily, HostedFamilyContactSheet } from '../shared/types';

const SMALL_CONTACT_SHEET_SIZE = 384;
const LARGE_CONTACT_SHEET_SIZE = 512;
const CONTACT_SHEET_MAX_FAMILIES = 16;
const CELL_GAP = 4;

function pngBuffer(dataUrl: string): Buffer | null {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1], 'base64');
    return buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG' ? buffer : null;
  } catch {
    return null;
  }
}

function labelOverlay(size: number, columns: number, cellWidth: number, cellHeight: number, count: number): Buffer {
  const cells = Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    return [
      `<rect x="${left + 1}" y="${top + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="none" stroke="#151515" stroke-width="2"/>`,
      `<rect x="${left + 5}" y="${top + 5}" width="24" height="20" rx="3" fill="#151515"/>`,
      `<text x="${left + 17}" y="${top + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${index + 1}</text>`,
    ].join('');
  }).join('');
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`,
  );
}

/**
 * Packs one representative preview from each Lite-review family into a single
 * cloud-cheap image. Numbered cells remain in request order so the gateway can
 * map any still-uncached subset without relying on shifted array positions.
 */
export async function buildHostedFamilyContactSheet(
  families: ComponentVisualFamily[],
): Promise<HostedFamilyContactSheet | undefined> {
  const candidates = families.slice(0, CONTACT_SHEET_MAX_FAMILIES).flatMap((family) => {
    const member = family.members[0];
    const source = member ? pngBuffer(member.hostedPreviewUrl || member.previewUrl) : null;
    return source ? [{ familyId: family.id, source }] : [];
  });
  if (candidates.length < 2) return undefined;

  const large = candidates.length > 8;
  const size = large ? LARGE_CONTACT_SHEET_SIZE : SMALL_CONTACT_SHEET_SIZE;
  const columns = large ? 4 : 2;
  const rows = Math.ceil(candidates.length / columns);
  const cellWidth = size / columns;
  const cellHeight = Math.floor(size / rows);
  const tiles = await Promise.all(candidates.map(async (candidate, index) => ({
    input: await sharp(candidate.source, { failOn: 'error' })
      .toColourspace('srgb')
      .ensureAlpha()
      .resize({
        width: cellWidth - (CELL_GAP * 2),
        height: cellHeight - (CELL_GAP * 2),
        fit: 'contain',
        background: { r: 242, g: 240, b: 231, alpha: 1 },
        withoutEnlargement: false,
      })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    left: (index % columns) * cellWidth + CELL_GAP,
    top: Math.floor(index / columns) * cellHeight + CELL_GAP,
  })));

  const output = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 242, g: 240, b: 231, alpha: 1 },
    },
  })
    .composite([
      ...tiles,
      { input: labelOverlay(size, columns, cellWidth, cellHeight, candidates.length), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    previewUrl: `data:image/png;base64,${output.toString('base64')}`,
    familyIds: candidates.map((candidate) => candidate.familyId),
  };
}
