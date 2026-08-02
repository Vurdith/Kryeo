import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetLibrarySnapshot, AssetRecord, DeliveryResult, LibraryLogs, SaveAssetRequest } from '../shared/types';

interface LibraryConfig {
  assetsRoot?: string;
  exportsRoot?: string;
}

interface GlobalIndex {
  assets?: AssetRecord[];
}

export interface ProjectPublishResult {
  project: string;
  destination: string;
  files: string[];
  skipped: string[];
  manifestPath: string;
}

function safeSegment(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readTail(filePath: string, maxCharacters = 12000): Promise<string> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.slice(-maxCharacters);
  } catch {
    return '';
  }
}

export class LibraryService {
  private async roots(): Promise<{ home: string; assets: string; exports: string }> {
    const home = path.join(os.homedir(), 'Desktop', 'Asset Library');
    const config = await readJson<LibraryConfig>(path.join(home, 'asset-library.config.json'));
    return {
      home,
      assets: config?.assetsRoot || path.join(home, 'Assets'),
      exports: config?.exportsRoot || path.join(home, 'Exported Assets'),
    };
  }

  private async root(): Promise<string> {
    return (await this.roots()).assets;
  }

  async exportDestination(outputRoot = ''): Promise<string> {
    const configured = (await this.roots()).exports;
    if (!outputRoot.trim()) return configured;
    const resolved = path.resolve(outputRoot.trim());
    if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
      throw new Error('Choose a folder rather than the root of a drive.');
    }
    return resolved;
  }

  async publishProjectExports(project: string, outputRoot = ''): Promise<ProjectPublishResult> {
    const snapshot = await this.snapshot();
    const assets = snapshot.assets.filter((asset) => asset.project === project);
    if (!assets.length) throw new Error(`No saved assets were found for ${project}.`);

    const destinationRoot = await this.exportDestination(outputRoot);
    const projectRoot = path.join(destinationRoot, safeSegment(project, 'Default Project'));
    await fs.mkdir(projectRoot, { recursive: true });

    const files: string[] = [];
    const skipped: string[] = [];
    const publishedAssets: Array<Record<string, unknown>> = [];
    for (const asset of assets) {
      if (!asset.previewPath || !existsSync(asset.previewPath)) {
        skipped.push(asset.displayName || asset.codeName || asset.name);
        continue;
      }
      const folderParts = [safeSegment(asset.category, 'Uncategorised')];
      if (asset.subcategory) folderParts.push(safeSegment(asset.subcategory, ''));
      const folder = path.join(projectRoot, ...folderParts);
      await fs.mkdir(folder, { recursive: true });
      const destination = path.join(folder, `${safeSegment(asset.codeName || asset.name, 'asset')}.png`);
      if (path.resolve(asset.previewPath) !== path.resolve(destination)) {
        const temporary = `${destination}.kryeo-tmp`;
        await fs.copyFile(asset.previewPath, temporary);
        await fs.rm(destination, { force: true });
        await fs.rename(temporary, destination);
      }
      files.push(destination);
      publishedAssets.push({
        id: asset.id,
        displayName: asset.displayName,
        codeName: asset.codeName,
        version: asset.version,
        category: asset.category,
        subcategory: asset.subcategory,
        file: destination,
      });
    }

    if (!files.length) {
      throw new Error(`Affinity completed the export, but no Raster PNGs were found for ${project}.`);
    }

    const manifestPath = path.join(projectRoot, 'KryeoAutoExport.json');
    const manifest = {
      schema: 'kryeo.auto-export.v1',
      project,
      generatedAt: new Date().toISOString(),
      destination: projectRoot,
      assets: publishedAssets,
      skipped,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { project, destination: projectRoot, files, skipped, manifestPath };
  }

  async snapshot(): Promise<AssetLibrarySnapshot> {
    const { assets: root, exports: exportsRoot } = await this.roots();
    const indexPath = path.join(root, 'GlobalIndex.json');
    if (!existsSync(indexPath)) {
      return {
        available: false,
        root,
        assets: [],
        totalVersions: 0,
        projects: [],
        categories: [],
        updatedAt: new Date().toISOString(),
        message: 'Run Asset Library Setup in Affinity to create your index.',
        versions: [],
        duplicateCodeNames: [],
        unhealthyCount: 0,
      };
    }

    const index = await readJson<GlobalIndex>(indexPath);
    const versions = Array.isArray(index?.assets) ? index.assets : [];
    const latest = new Map<string, AssetRecord>();
    for (const asset of versions) {
      const current = latest.get(asset.id);
      if (!current || Number(asset.version) > Number(current.version)) latest.set(asset.id, asset);
    }
    const codeCounts = new Map<string, number>();
    for (const asset of latest.values()) {
      const code = String(asset.codeName || '').toLowerCase();
      if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    }
    const duplicateCodeNames = [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code).sort();
    const enriched = await Promise.all([...latest.values()].map(async (asset): Promise<AssetRecord> => {
      const relative = path.relative(root, asset.path || '');
      const previewPath = path.join(exportsRoot, relative).replace(/\.afdesign$/i, '.png');
      const sourceExists = Boolean(asset.path) && existsSync(asset.path);
      const previewExists = sourceExists && existsSync(previewPath);
      let health: AssetRecord['health'] = 'ready';
      let healthMessage = 'Source and exported preview are available.';
      let previewUrl = '';
      if (!sourceExists) {
        health = 'missing-source';
        healthMessage = 'The indexed Affinity document is missing.';
      } else if (!previewExists) {
        health = 'missing-export';
        healthMessage = 'No matching PNG export was found.';
      } else {
        const [sourceStat, previewStat] = await Promise.all([fs.stat(asset.path), fs.stat(previewPath)]);
        if (previewStat.mtimeMs < sourceStat.mtimeMs) {
          health = 'export-outdated';
          healthMessage = 'The PNG export is older than the Affinity document.';
        }
        if (previewStat.size <= 2_000_000) {
          previewUrl = `data:image/png;base64,${(await fs.readFile(previewPath)).toString('base64')}`;
        }
      }
      return { ...asset, previewPath: previewExists ? previewPath : '', previewUrl, health, healthMessage };
    }));
    const assets = enriched.sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    );
    const projects = [...new Set(assets.map((asset) => asset.project).filter(Boolean))].sort();
    const categories = [...new Set(assets.map((asset) => asset.category).filter(Boolean))].sort();

    return {
      available: true,
      root,
      assets,
      totalVersions: versions.length,
      projects,
      categories,
      updatedAt: new Date().toISOString(),
      message: `${assets.length} assets across ${versions.length} saved versions.`,
      versions,
      duplicateCodeNames,
      unhealthyCount: assets.filter((asset) => asset.health !== 'ready').length,
    };
  }

  async assetByPath(candidate: string): Promise<AssetRecord | undefined> {
    const snapshot = await this.snapshot();
    return snapshot.versions.find((asset) => path.resolve(asset.path) === path.resolve(candidate));
  }

  async deliverProject(project: string, target: DeliveryResult['target']): Promise<DeliveryResult> {
    const snapshot = await this.snapshot();
    const assets = snapshot.assets.filter((asset) => asset.project === project);
    if (!assets.length) return { ok: false, target, path: '', assetCount: 0, message: `No assets were found for ${project}.` };
    const roots = await this.roots();
    const destination = path.join(roots.home, 'Delivered', 'Roblox', project);
    await fs.mkdir(destination, { recursive: true });
    const manifestPath = path.join(destination, 'KryeoManifest.json');
    const manifest = {
      schema: 'kryeo.delivery.v1', target, project, generatedAt: new Date().toISOString(),
      assets: assets.map((asset) => ({
        id: asset.id, displayName: asset.displayName, codeName: asset.codeName, category: asset.category,
        subcategory: asset.subcategory, version: asset.version, source: asset.path,
        raster: asset.previewPath || '', tags: asset.tags || [], health: asset.health,
        robloxClass: /button/i.test(asset.category || asset.displayName) ? 'ImageButton' : 'ImageLabel',
      })),
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, target, path: manifestPath, assetCount: assets.length, message: `Prepared ${assets.length} asset(s) for Roblox Studio.` };
  }

  async cleanupStaging(maxAgeHours = 24): Promise<{ removed: number; path: string }> {
    const staging = path.join(await this.root(), 'KryeoStaging');
    if (!existsSync(staging)) return { removed: 0, path: staging };
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of await fs.readdir(staging, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const candidate = path.join(staging, entry.name);
      const stat = await fs.stat(candidate);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(candidate);
        removed += 1;
      }
    }
    return { removed, path: staging };
  }

  async logs(): Promise<LibraryLogs> {
    const root = await this.root();
    return {
      run: await readTail(path.join(root, 'last-run.txt')),
      error: await readTail(path.join(root, 'last-error.txt')),
      root,
    };
  }

  async prepareKryeoStaging(): Promise<string> {
    const staging = path.join(await this.root(), 'KryeoStaging');
    await fs.mkdir(staging, { recursive: true });
    return staging;
  }

  async prepareSaveDestination(request: SaveAssetRequest): Promise<void> {
    const root = await this.root();
    const parts = [safeSegment(request.project, 'Default Project')];
    const category = safeSegment(request.category, '');
    const subcategory = safeSegment(request.subcategory, '');
    if (category) parts.push(category);
    if (category && subcategory) parts.push(subcategory);
    await fs.mkdir(path.join(root, ...parts), { recursive: true });
  }

  async prepareSetupPaths(home: string, assets: string, exportsRoot: string): Promise<void> {
    const desktop = path.resolve(path.join(os.homedir(), 'Desktop'));
    const candidates = [home, assets, exportsRoot, path.join(home, 'Tools')].map((candidate) => path.resolve(candidate));
    for (const candidate of candidates) {
      if (candidate !== desktop && !candidate.startsWith(desktop + path.sep)) {
        throw new Error('Asset Library setup folders must remain on the Desktop.');
      }
    }
    await Promise.all(candidates.map((candidate) => fs.mkdir(candidate, { recursive: true })));
  }

  async isAllowedPath(candidate: string): Promise<boolean> {
    const root = path.resolve(await this.root());
    const resolved = path.resolve(candidate);
    return resolved === root || resolved.startsWith(root + path.sep);
  }

  async isAllowedAssetFile(candidate: string): Promise<boolean> {
    return (
      await this.isAllowedPath(candidate)
      && path.extname(candidate).toLowerCase() === '.afdesign'
      && existsSync(candidate)
    );
  }
}
