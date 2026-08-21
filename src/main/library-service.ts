import { existsSync, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { AssetLibrarySnapshot, AssetRecord, DeliveryResult, LibraryLogs, RobloxUiRole, SaveAssetRequest } from '../shared/types';

interface LibraryConfig {
  assetsRoot?: string;
  exportsRoot?: string;
}

interface GlobalIndex {
  assets?: AssetRecord[];
}

export interface LibraryStoragePaths {
  home: string;
  assets: string;
  exports: string;
  staging: string;
}

export interface ComponentAssetDestination {
  id: string;
  assetId: string;
  name: string;
  codeName: string;
  category: string;
  subcategory: string;
  sourcePath: string;
  rasterPath: string;
  stagedSourcePath: string;
  stagedRasterPath: string;
  transactionRoot: string;
}

export function stableComponentAssetId(project: string, documentTitle: string, sourcePaths: number[][]): string {
  return `kryeo_${createHash('sha256')
    .update(JSON.stringify([project.trim().toLowerCase(), documentTitle.trim().toLowerCase(), sourcePaths]))
    .digest('hex')
    .slice(0, 24)}`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.tmp`;
  const backup = `${filePath}.bak`;
  let backedUp = false;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rm(backup, { force: true });
    if (existsSync(filePath)) {
      await fs.rename(filePath, backup);
      backedUp = true;
    }
    await fs.rename(temporary, filePath);
    await fs.rm(backup, { force: true });
    backedUp = false;
  } catch (error) {
    if (backedUp && !existsSync(filePath) && existsSync(backup)) await fs.rename(backup, filePath).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function latestAssetRecords(records: AssetRecord[]): AssetRecord[] {
  const latest = new Map<string, AssetRecord>();
  for (const record of records) {
    const current = latest.get(record.id);
    if (!current || Number(record.version) > Number(current.version)) latest.set(record.id, record);
  }
  return [...latest.values()];
}

function normalizedPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function derivedRasterPath(roots: LibraryStoragePaths, asset: AssetRecord): string {
  if (asset.previewPath) return asset.previewPath;
  const relative = path.relative(roots.assets, asset.path || '');
  return path.join(roots.exports, relative).replace(/\.afdesign$/i, '.png');
}

function manifestAsset(roots: LibraryStoragePaths, asset: AssetRecord) {
  return {
    id: asset.id,
    name: asset.displayName || asset.name,
    codeName: asset.codeName,
    category: asset.category,
    subcategory: asset.subcategory,
    version: asset.version,
    source: asset.path,
    raster: derivedRasterPath(roots, asset),
    tags: asset.tags || [],
    robloxClass: asset.metadata?.robloxClass || 'ImageLabel',
    bounds: asset.metadata?.bounds,
    sourcePaths: asset.metadata?.sourcePaths || [],
  };
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
    try {
      return JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8')) as T;
    } catch {
      return null;
    }
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
  private readonly userDataPath: () => string;
  private initialization: Promise<LibraryStoragePaths> | null = null;

  constructor(userDataPath?: () => string) {
    this.userDataPath = userDataPath || (() => path.join(os.homedir(), 'AppData', 'Roaming', 'Kryeo'));
  }

  private embeddedRoots(): LibraryStoragePaths {
    const home = path.join(this.userDataPath(), 'asset-library');
    const assets = path.join(home, 'assets');
    return {
      home,
      assets,
      exports: path.join(home, 'exports'),
      staging: path.join(assets, 'KryeoStaging'),
    };
  }

  private async legacyRoots(): Promise<LibraryStoragePaths> {
    const home = path.join(os.homedir(), 'Desktop', 'Asset Library');
    const config = await readJson<LibraryConfig>(path.join(home, 'asset-library.config.json'));
    const assets = config?.assetsRoot || path.join(home, 'Assets');
    return {
      home,
      assets,
      exports: config?.exportsRoot || path.join(home, 'Exported Assets'),
      staging: path.join(assets, 'KryeoStaging'),
    };
  }

  private async roots(): Promise<{ embedded: LibraryStoragePaths; legacy: LibraryStoragePaths }> {
    return { embedded: this.embeddedRoots(), legacy: await this.legacyRoots() };
  }

  private async initializeEmbeddedLibrary(): Promise<LibraryStoragePaths> {
    const roots = this.embeddedRoots();
    await Promise.all([
      fs.mkdir(roots.home, { recursive: true }),
      fs.mkdir(roots.assets, { recursive: true }),
      fs.mkdir(roots.exports, { recursive: true }),
      fs.mkdir(roots.staging, { recursive: true }),
    ]);

    const configPath = path.join(roots.home, 'asset-library.config.json');
    if (!existsSync(configPath)) {
      await fs.writeFile(configPath, JSON.stringify({
        formatVersion: 1,
        home: roots.home,
        assetsRoot: roots.assets,
        exportsRoot: roots.exports,
        managedBy: 'Kryeo',
        updatedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
    }

    const indexPath = path.join(roots.assets, 'GlobalIndex.json');
    if (!existsSync(indexPath)) {
      const legacy = await this.legacyRoots();
      const legacyIndex = await readJson<GlobalIndex>(path.join(legacy.assets, 'GlobalIndex.json'));
      const assets = Array.isArray(legacyIndex?.assets) ? legacyIndex.assets : [];
      await fs.writeFile(indexPath, JSON.stringify({
        formatVersion: 1,
        libraryRoot: roots.assets,
        migratedFrom: assets.length ? legacy.home : undefined,
        assets,
      }, null, 2), 'utf8');
    }

    return roots;
  }

  private async ensureEmbeddedLibrary(): Promise<LibraryStoragePaths> {
    if (!this.initialization) {
      this.initialization = this.initializeEmbeddedLibrary().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async storagePaths(): Promise<LibraryStoragePaths> {
    return this.ensureEmbeddedLibrary();
  }

  private async root(): Promise<string> {
    return (await this.ensureEmbeddedLibrary()).assets;
  }

  async snapshot(): Promise<AssetLibrarySnapshot> {
    const { embedded, legacy } = await this.roots();
    const { assets: root } = await this.ensureEmbeddedLibrary();
    const indexPath = path.join(root, 'GlobalIndex.json');

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
      const source = [embedded, legacy].find((candidate) => {
        const candidateRoot = path.resolve(candidate.assets);
        const assetPath = path.resolve(asset.path || '');
        return assetPath === candidateRoot || assetPath.startsWith(candidateRoot + path.sep);
      }) || embedded;
      const relative = path.relative(source.assets, asset.path || '');
      const previewPath = path.join(source.exports, relative).replace(/\.afdesign$/i, '.png');
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
      message: assets.length
        ? `${assets.length} assets across ${versions.length} saved versions.`
        : 'Your Kryeo library is ready. Save an asset from the Assets workflow to see it here.',
      versions,
      duplicateCodeNames,
      unhealthyCount: assets.filter((asset) => asset.health !== 'ready').length,
    };
  }

  async assetByPath(candidate: string): Promise<AssetRecord | undefined> {
    const snapshot = await this.snapshot();
    return snapshot.versions.find((asset) => path.resolve(asset.path) === path.resolve(candidate));
  }

  async componentAssetDestinations(project: string, documentTitle: string, assets: Array<{
    id: string;
    name: string;
    codeName: string;
    category: string;
    subcategory: string;
    sourcePaths: number[][];
  }>): Promise<ComponentAssetDestination[]> {
    const roots = await this.ensureEmbeddedLibrary();
    const index = await readJson<GlobalIndex>(path.join(roots.assets, 'GlobalIndex.json')) || {};
    const existing = latestAssetRecords(Array.isArray(index.assets) ? index.assets : []);
    const existingById = new Map(existing.map((asset) => [asset.id, asset]));
    const usedPaths = new Set(existing.flatMap((asset) => [normalizedPath(asset.path), normalizedPath(derivedRasterPath(roots, asset))]));
    const usedCodeNames = new Set(existing.filter((asset) => asset.project === project).map((asset) => asset.codeName.toLowerCase()));
    const plannedIds = new Set<string>();
    const transactionRoot = path.join(roots.staging, `component-build-${randomUUID()}`);
    await Promise.all([
      fs.mkdir(path.join(transactionRoot, 'source'), { recursive: true }),
      fs.mkdir(path.join(transactionRoot, 'raster'), { recursive: true }),
    ]);
    try {
      return await Promise.all(assets.map(async (asset, index) => {
        const assetId = stableComponentAssetId(project, documentTitle, asset.sourcePaths);
        if (plannedIds.has(assetId)) throw new Error(`The scan proposed the same source boundary more than once (${asset.name}). Rescan before building.`);
        plannedIds.add(assetId);
        const previous = existingById.get(assetId);
        const category = safeSegment(asset.category, 'Uncategorised');
        const subcategory = String(asset.subcategory || '')
          .split(/[\\/]+/)
          .map((segment) => safeSegment(segment, ''))
          .filter(Boolean)
          .slice(0, 5);
        const directory = [safeSegment(project, 'Untitled'), category, ...(subcategory.length ? subcategory : ['General'])];
        const base = safeSegment(asset.name, `Asset ${index + 1}`);
        let fileName = base;
        const sourceDirectory = path.join(roots.assets, ...directory);
        const rasterDirectory = path.join(roots.exports, ...directory);
        let sourcePath = previous?.path || path.join(sourceDirectory, `${fileName}.afdesign`);
        let rasterPath = previous ? derivedRasterPath(roots, previous) : path.join(rasterDirectory, `${fileName}.png`);
        let ordinal = 2;
        if (!previous) {
          while (usedPaths.has(normalizedPath(sourcePath)) || usedPaths.has(normalizedPath(rasterPath)) || existsSync(sourcePath) || existsSync(rasterPath)) {
            fileName = `${base} ${ordinal++}`;
            sourcePath = path.join(sourceDirectory, `${fileName}.afdesign`);
            rasterPath = path.join(rasterDirectory, `${fileName}.png`);
          }
        }
        const codeBase = safeSegment(asset.codeName, `asset_${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let codeName = codeBase;
        let codeOrdinal = 2;
        if (previous) usedCodeNames.delete(previous.codeName.toLowerCase());
        while (usedCodeNames.has(codeName)) codeName = `${codeBase}_${codeOrdinal++}`;
        usedCodeNames.add(codeName);
        usedPaths.add(normalizedPath(sourcePath));
        usedPaths.add(normalizedPath(rasterPath));
        await Promise.all([fs.mkdir(sourceDirectory, { recursive: true }), fs.mkdir(rasterDirectory, { recursive: true })]);
        return {
          id: asset.id,
          assetId,
          name: previous ? asset.name : fileName,
          codeName,
          category,
          subcategory: subcategory.join('/'),
          sourcePath,
          rasterPath,
          stagedSourcePath: path.join(transactionRoot, 'source', `${assetId}.afdesign`),
          stagedRasterPath: path.join(transactionRoot, 'raster', `${assetId}.png`),
          transactionRoot,
        };
      }));
    } catch (error) {
      await fs.rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async discardComponentAssetTransaction(assets: ComponentAssetDestination[]): Promise<void> {
    const roots = new Set(assets.map((asset) => asset.transactionRoot).filter(Boolean));
    await Promise.all([...roots].map((transactionRoot) => fs.rm(transactionRoot, { recursive: true, force: true })));
  }

  async recordComponentAssets(input: {
    project: string;
    documentTitle: string;
    documentSessionUuid: string;
    structureFingerprint: string;
    assets: Array<ComponentAssetDestination & { role: RobloxUiRole; bounds: { x: number; y: number; width: number; height: number }; sourcePaths: number[][] }>;
  }): Promise<{ manifestPath: string; assetCount: number }> {
    const roots = await this.ensureEmbeddedLibrary();
    const indexPath = path.join(roots.assets, 'GlobalIndex.json');
    const index = await readJson<GlobalIndex>(indexPath) || {};
    const now = new Date().toISOString();
    const existingAssets = Array.isArray(index.assets) ? index.assets : [];
    const originalIndex = { ...index, assets: existingAssets };
    if (!input.assets.length) throw new Error('No exported component assets were available to register.');
    for (const asset of input.assets) {
      const [sourceStat, rasterStat] = await Promise.all([
        fs.stat(asset.stagedSourcePath).catch(() => null),
        fs.stat(asset.stagedRasterPath).catch(() => null),
      ]);
      if (!sourceStat?.isFile() || sourceStat.size <= 0 || !rasterStat?.isFile() || rasterStat.size <= 0) {
        throw new Error(`Kryeo did not commit ${asset.name} because its staged Affinity or PNG file was incomplete. The existing library is unchanged; recovery files remain at ${asset.transactionRoot}.`);
      }
    }
    const records: AssetRecord[] = input.assets.map((asset) => {
      const previous = existingAssets.find((candidate) => candidate.id === asset.assetId);
      return {
        id: asset.assetId,
        name: asset.name,
        displayName: asset.name,
        codeName: asset.codeName,
        project: input.project,
        category: asset.category,
        subcategory: asset.subcategory,
        tags: ['kryeo-component-scan'],
        version: (previous?.version || 0) + 1,
        fileName: path.basename(asset.sourcePath),
        path: asset.sourcePath,
        updatedAt: now,
      notes: `Created from ${input.documentTitle} by Component Scan.`,
      previewPath: asset.rasterPath,
      metadata: { robloxClass: asset.role, sourcePaths: asset.sourcePaths, bounds: asset.bounds },
      };
    });
    const delivery = path.join(roots.home, 'Delivered', 'Roblox', safeSegment(input.project, 'Untitled'));
    await fs.mkdir(delivery, { recursive: true });
    const manifestPath = path.join(delivery, 'KryeoManifest.json');
    const previousManifest = await readJson<unknown>(manifestPath);
    const updatedIds = new Set(records.map((record) => record.id));
    const updatedAssets = [...existingAssets.filter((asset) => !updatedIds.has(asset.id)), ...records];
    const projectAssets = latestAssetRecords(updatedAssets).filter((asset) => asset.project === input.project);
    const backups: Array<{ finalPath: string; stagedPath: string; backupPath: string; hadPrevious: boolean }> = [];
    try {
      for (const asset of input.assets) {
        for (const [stagedPath, finalPath] of [[asset.stagedSourcePath, asset.sourcePath], [asset.stagedRasterPath, asset.rasterPath]]) {
          await fs.mkdir(path.dirname(finalPath), { recursive: true });
          const backupPath = path.join(asset.transactionRoot, 'backup', createHash('sha256').update(finalPath).digest('hex'));
          const hadPrevious = existsSync(finalPath);
          if (hadPrevious) {
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.rename(finalPath, backupPath);
          }
          backups.push({ finalPath, stagedPath, backupPath, hadPrevious });
          await fs.rename(stagedPath, finalPath);
        }
      }
      index.assets = updatedAssets;
      await writeJsonAtomic(indexPath, { ...index, formatVersion: 1, libraryRoot: roots.assets, assets: index.assets });
      await writeJsonAtomic(manifestPath, {
        schema: 'kryeo.roblox.v1',
        target: 'roblox',
        project: input.project,
        generatedAt: now,
        latestBuild: {
          documentTitle: input.documentTitle,
          documentSessionUuid: input.documentSessionUuid,
          structureFingerprint: input.structureFingerprint,
        },
        assets: projectAssets.map((asset) => manifestAsset(roots, asset)),
      });
    } catch (error) {
      for (const entry of [...backups].reverse()) {
        try {
          if (existsSync(entry.finalPath)) {
            await fs.mkdir(path.dirname(entry.stagedPath), { recursive: true });
            await fs.rename(entry.finalPath, entry.stagedPath);
          }
          if (entry.hadPrevious && existsSync(entry.backupPath)) await fs.rename(entry.backupPath, entry.finalPath);
        } catch {
          // Keep attempting the remaining rollback entries. Staging is retained for recovery.
        }
      }
      await writeJsonAtomic(indexPath, originalIndex).catch(() => undefined);
      if (previousManifest) await writeJsonAtomic(manifestPath, previousManifest).catch(() => undefined);
      else await fs.rm(manifestPath, { force: true }).catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${detail} The existing library was rolled back; recovery files remain at ${input.assets[0].transactionRoot}.`);
    }
    await this.discardComponentAssetTransaction(input.assets).catch(() => undefined);
    return { manifestPath, assetCount: records.length };
  }

  async deliverProject(project: string, target: DeliveryResult['target']): Promise<DeliveryResult> {
    const snapshot = await this.snapshot();
    const assets = snapshot.assets.filter((asset) => asset.project === project);
    if (!assets.length) return { ok: false, target, path: '', assetCount: 0, message: `No assets were found for ${project}.` };
    const roots = await this.ensureEmbeddedLibrary();
    const destination = path.join(roots.home, 'Delivered', 'Roblox', safeSegment(project, 'Untitled'));
    await fs.mkdir(destination, { recursive: true });
    const manifestPath = path.join(destination, 'KryeoManifest.json');
    const manifest = {
      schema: 'kryeo.roblox.v1', target, project, generatedAt: new Date().toISOString(),
      assets: assets.map((asset) => manifestAsset(roots, asset)),
    };
    await writeJsonAtomic(manifestPath, manifest);
    return { ok: true, target, path: manifestPath, assetCount: assets.length, message: `Prepared ${assets.length} asset(s) for Roblox Studio.` };
  }

  async cleanupStaging(maxAgeHours = 24): Promise<{ removed: number; path: string }> {
    const staging = path.join(await this.root(), 'KryeoStaging');
    if (!existsSync(staging)) return { removed: 0, path: staging };
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of await fs.readdir(staging, { withFileTypes: true })) {
      const candidate = path.join(staging, entry.name);
      const stat = await fs.stat(candidate);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(candidate, { recursive: entry.isDirectory(), force: true });
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

  async isAllowedPath(candidate: string): Promise<boolean> {
    const resolved = path.resolve(candidate);
    const { embedded, legacy } = await this.roots();
    return [embedded.home, legacy.home].some((root) => {
      const resolvedRoot = path.resolve(root);
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    });
  }

  async isAllowedAssetFile(candidate: string): Promise<boolean> {
    return (
      await this.isAllowedPath(candidate)
      && path.extname(candidate).toLowerCase() === '.afdesign'
      && existsSync(candidate)
    );
  }
}
