import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AffinityStatus, ConnectorSnapshot, KryeoConnector } from '../shared/types';

async function firstExisting(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return '';
}

async function newestExecutable(root: string, executable: string): Promise<string> {
  if (!root || !existsSync(root)) return '';
  try {
    const directories = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
    const matches = directories
      .map((directory) => path.join(directory, executable))
      .filter(existsSync)
      .sort()
      .reverse();
    return matches[0] || '';
  } catch {
    return '';
  }
}

async function detectAffinity(): Promise<string> {
  const local = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  return firstExisting([
    path.join(local, 'Packages', 'Canva.Affinity_8a0j1tnjnt4a4'),
    path.join(local, 'Microsoft', 'WindowsApps', 'Affinity.exe'),
    path.join(programFiles, 'Affinity', 'Affinity.exe'),
  ]);
}

async function detectPhotoshop(): Promise<string> {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const adobeRoot = path.join(programFiles, 'Adobe');
  if (!existsSync(adobeRoot)) return '';
  try {
    const versions = (await fs.readdir(adobeRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^Adobe Photoshop/i.test(entry.name))
      .map((entry) => path.join(adobeRoot, entry.name, 'Photoshop.exe'))
      .filter(existsSync)
      .sort()
      .reverse();
    return versions[0] || '';
  } catch {
    return '';
  }
}

async function detectRobloxStudio(): Promise<string> {
  const local = process.env.LOCALAPPDATA || '';
  return newestExecutable(path.join(local, 'Roblox', 'Versions'), 'RobloxStudioBeta.exe');
}

export class ConnectorService {
  private cached: ConnectorSnapshot | null = null;

  async snapshot(affinityStatus: AffinityStatus, force = false): Promise<ConnectorSnapshot> {
    if (this.cached && !force) {
      const affinity = this.cached.connectors.find((connector) => connector.id === 'affinity');
      if (affinity) {
        affinity.state = affinityStatus.state === 'connected' ? 'connected' : affinity.installed ? 'detected' : 'missing';
        affinity.configured = affinityStatus.state === 'connected';
        affinity.message = affinityStatus.state === 'connected'
          ? 'Connector online. Affinity workflows are available.'
          : affinity.installed ? 'Installed. Start Affinity and enable MCP to connect.' : 'Affinity was not detected.';
      }
      return this.cached;
    }

    const [affinityPath, photoshopPath, robloxPath] = await Promise.all([
      detectAffinity(), detectPhotoshop(), detectRobloxStudio(),
    ]);
    const affinityConnected = affinityStatus.state === 'connected';
    const connectors: KryeoConnector[] = [
      {
        id: 'affinity',
        name: 'Affinity',
        description: 'Create, version, place, and export production-ready visual assets.',
        role: 'creative-source',
        state: affinityConnected ? 'connected' : affinityPath ? 'detected' : 'missing',
        installed: Boolean(affinityPath),
        configured: affinityConnected,
        availableNow: true,
        installationPath: affinityPath,
        capabilities: ['Asset library', 'Versioned save', 'Master/Base/Raster placement', 'PNG export', 'Script workflows'],
        message: affinityConnected
          ? 'Connector online. Affinity workflows are available.'
          : affinityPath ? 'Installed. Start Affinity and enable MCP to connect.' : 'Affinity was not detected.',
      },
      {
        id: 'photoshop',
        name: 'Photoshop',
        description: 'Prepare layered visual sources for shared Kryeo pipelines.',
        role: 'creative-source',
        state: photoshopPath ? 'detected' : 'planned',
        installed: Boolean(photoshopPath),
        configured: false,
        availableNow: false,
        installationPath: photoshopPath,
        capabilities: ['Layered document intake', 'Production asset output', 'Connector scripts'],
        message: photoshopPath ? 'Installation detected. Connector adapter is next.' : 'Connector planned; Photoshop was not detected.',
      },
      {
        id: 'roblox-studio',
        name: 'Roblox Studio',
        description: 'Deliver named interface assets and UI structures into experiences.',
        role: 'production-target',
        state: robloxPath ? 'detected' : 'planned',
        installed: Boolean(robloxPath),
        configured: false,
        availableNow: false,
        installationPath: robloxPath,
        capabilities: ['KryeoManifest.json', 'ImageLabel / ImageButton hint', 'Asset version and PNG path'],
        message: robloxPath ? 'Installation detected. Production adapter is not configured yet.' : 'Connector planned; Roblox Studio was not detected.',
      },
    ];

    this.cached = {
      connectors,
      routes: [
        { id: 'affinity-library', source: 'affinity', target: 'kryeo-library', direction: 'sync', state: 'active', label: 'Affinity asset library' },
        { id: 'affinity-roblox', source: 'affinity', target: 'roblox-studio', direction: 'export', state: robloxPath ? 'detected' : 'planned', label: 'Affinity to Roblox Studio' },
        { id: 'photoshop-library', source: 'photoshop', target: 'kryeo-library', direction: 'sync', state: photoshopPath ? 'detected' : 'planned', label: 'Photoshop asset library' },
      ],
      scannedAt: new Date().toISOString(),
      machineName: os.hostname(),
    };
    return this.cached;
  }
}
