import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AffinityService } from '../src/main/affinity-service.ts';
import { LibraryService } from '../src/main/library-service.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kryeo-embedded-library-'));

try {
  const library = new LibraryService(() => workspace);
  const roots = await library.storagePaths();

  assert.equal(roots.home, path.join(workspace, 'asset-library'));
  assert.equal(roots.assets, path.join(roots.home, 'assets'));
  assert.equal(roots.exports, path.join(roots.home, 'exports'));
  assert.equal(roots.staging, path.join(roots.assets, 'KryeoStaging'));
  assert.ok(!roots.home.toLowerCase().includes(`${path.sep}desktop${path.sep}asset library`));
  assert.ok(existsSync(path.join(roots.home, 'asset-library.config.json')));
  assert.ok(existsSync(path.join(roots.assets, 'GlobalIndex.json')));
  assert.ok(existsSync(roots.staging));

  const snapshot = await library.snapshot();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.root, roots.assets);

  await library.prepareSaveDestination({
    displayName: 'Test asset',
    codeName: 'test_asset',
    project: 'Smoke project',
    category: 'Icons',
    subcategory: '',
    tags: '',
    notes: '',
    batch: false,
    update: true,
    baseCopy: true,
    rasterCopy: true,
  });
  assert.ok(existsSync(path.join(roots.assets, 'Smoke project', 'Icons')));

  const planned = await library.componentAssetDestinations('Scan project', 'Screen.afdesign', [{
    id: 'component-1', name: 'Play Button', codeName: 'play_button', category: 'Buttons', subcategory: 'Primary',
    sourcePaths: [[0, 1]],
  }]);
  assert.equal(planned.length, 1);
  assert.equal(existsSync(planned[0].sourcePath), false, 'planning must not touch the final source path');
  await fs.writeFile(planned[0].stagedSourcePath, 'native-affinity-fixture');
  await fs.writeFile(planned[0].stagedRasterPath, 'png-fixture');
  const created = await library.recordComponentAssets({
    project: 'Scan project', documentTitle: 'Screen.afdesign', documentSessionUuid: 'session-1', structureFingerprint: 'structure-1',
    assets: [{ ...planned[0], role: 'ImageButton', bounds: { x: 12, y: 24, width: 80, height: 30 }, sourcePaths: [[0, 1]] }],
  });
  assert.equal(created.assetCount, 1);
  const importManifest = JSON.parse(await fs.readFile(created.manifestPath, 'utf8'));
  assert.equal(importManifest.schema, 'kryeo.roblox.v1');
  assert.equal(importManifest.assets[0].bounds.x, 12);
  assert.equal(importManifest.assets[0].codeName, 'play_button');
  assert.equal(importManifest.assets[0].version, 1);
  assert.deepEqual(importManifest.assets[0].sourcePaths, [[0, 1]]);
  assert.ok(existsSync(planned[0].sourcePath));
  assert.ok(existsSync(planned[0].rasterPath));
  assert.equal(existsSync(planned[0].transactionRoot), false, 'a committed transaction should remove its staging directory');

  const collision = await library.componentAssetDestinations('Scan project', 'Other Screen.afdesign', [{
    id: 'component-2', name: 'Play Button', codeName: 'play_button', category: 'Buttons', subcategory: 'Primary',
    sourcePaths: [[0, 2]],
  }]);
  assert.notEqual(collision[0].sourcePath, planned[0].sourcePath, 'a later same-name asset must receive a distinct source path');
  assert.notEqual(collision[0].rasterPath, planned[0].rasterPath, 'a later same-name asset must receive a distinct PNG path');
  assert.equal(collision[0].name, 'Play Button 2');
  assert.equal(collision[0].codeName, 'play_button_2');
  await fs.writeFile(collision[0].stagedSourcePath, 'second-native-affinity-fixture');
  await fs.writeFile(collision[0].stagedRasterPath, 'second-png-fixture');
  await library.recordComponentAssets({
    project: 'Scan project', documentTitle: 'Other Screen.afdesign', documentSessionUuid: 'session-2', structureFingerprint: 'structure-2',
    assets: [{ ...collision[0], role: 'ImageButton', bounds: { x: 120, y: 24, width: 80, height: 30 }, sourcePaths: [[0, 2]] }],
  });
  const collisionManifest = JSON.parse(await fs.readFile(created.manifestPath, 'utf8'));
  assert.equal(collisionManifest.assets.length, 2, 'an incremental build must preserve earlier project assets in the manifest');
  assert.deepEqual(new Set(collisionManifest.assets.map((asset) => asset.codeName)), new Set(['play_button', 'play_button_2']));

  const rebuildPlan = await library.componentAssetDestinations('Scan project', 'Screen.afdesign', [{
    id: 'component-1', name: 'Play Button', codeName: 'play_button', category: 'Buttons', subcategory: 'Primary',
    sourcePaths: [[0, 1]],
  }]);
  assert.equal(rebuildPlan[0].sourcePath, planned[0].sourcePath, 'the same source boundary should reuse its stable destination');
  await fs.writeFile(rebuildPlan[0].stagedSourcePath, 'updated-native-affinity-fixture');
  await fs.writeFile(rebuildPlan[0].stagedRasterPath, 'updated-png-fixture');
  const rebuilt = await library.recordComponentAssets({
    project: 'Scan project', documentTitle: 'Screen.afdesign', documentSessionUuid: 'session-3', structureFingerprint: 'structure-3',
    assets: [{ ...rebuildPlan[0], role: 'ImageButton', bounds: { x: 12, y: 24, width: 80, height: 30 }, sourcePaths: [[0, 1]] }],
  });
  const rebuiltManifest = JSON.parse(await fs.readFile(rebuilt.manifestPath, 'utf8'));
  const rebuiltAsset = rebuiltManifest.assets.find((asset) => asset.codeName === 'play_button');
  assert.equal(rebuiltAsset.id, importManifest.assets[0].id, 'the same source boundary should retain its Kryeo asset ID');
  assert.equal(rebuiltAsset.version, 2, 'rebuilding the same asset should increment its version');
  assert.equal(rebuiltManifest.assets.length, 2, 'rebuilding one asset must retain the rest of the project manifest');
  assert.equal(await fs.readFile(planned[0].sourcePath, 'utf8'), 'updated-native-affinity-fixture');
  const rebuiltSnapshot = await library.snapshot();
  assert.equal(rebuiltSnapshot.assets.filter((asset) => asset.project === 'Scan project').length, 2, 'rebuilding must update the stable record without losing other assets');

  const incomplete = await library.componentAssetDestinations('Scan project', 'Broken Screen.afdesign', [{
    id: 'component-3', name: 'Broken Button', codeName: 'broken_button', category: 'Buttons', subcategory: 'Primary',
    sourcePaths: [[0, 3]],
  }]);
  await fs.writeFile(incomplete[0].stagedSourcePath, 'incomplete-source-only');
  await assert.rejects(
    library.recordComponentAssets({
      project: 'Scan project', documentTitle: 'Broken Screen.afdesign', documentSessionUuid: 'session-4', structureFingerprint: 'structure-4',
      assets: [{ ...incomplete[0], role: 'ImageButton', bounds: { x: 220, y: 24, width: 80, height: 30 }, sourcePaths: [[0, 3]] }],
    }),
    /incomplete/,
  );
  assert.equal(existsSync(incomplete[0].sourcePath), false, 'an incomplete transaction must not create a final asset');
  const manifestAfterFailure = JSON.parse(await fs.readFile(created.manifestPath, 'utf8'));
  assert.deepEqual(manifestAfterFailure.assets, rebuiltManifest.assets, 'an incomplete transaction must not rewrite the project manifest');
  await library.discardComponentAssetTransaction(incomplete);

  const rollback = await library.componentAssetDestinations('Rollback project', 'Rollback.afdesign', [{
    id: 'rollback-component', name: 'Rollback Icon', codeName: 'rollback_icon', category: 'Icons', subcategory: 'General',
    sourcePaths: [[0, 4]],
  }]);
  await fs.writeFile(rollback[0].stagedSourcePath, 'rollback-source');
  await fs.writeFile(rollback[0].stagedRasterPath, 'rollback-raster');
  const blockedManifestPath = path.join(roots.home, 'Delivered', 'Roblox', 'Rollback project', 'KryeoManifest.json');
  await fs.mkdir(`${blockedManifestPath}.bak`, { recursive: true });
  await assert.rejects(
    library.recordComponentAssets({
      project: 'Rollback project', documentTitle: 'Rollback.afdesign', documentSessionUuid: 'session-5', structureFingerprint: 'structure-5',
      assets: [{ ...rollback[0], role: 'ImageLabel', bounds: { x: 0, y: 0, width: 16, height: 16 }, sourcePaths: [[0, 4]] }],
    }),
    /rolled back/,
  );
  assert.equal(existsSync(rollback[0].sourcePath), false, 'a manifest failure must roll back the promoted source file');
  assert.equal(existsSync(rollback[0].rasterPath), false, 'a manifest failure must roll back the promoted PNG');
  assert.ok(existsSync(rollback[0].stagedSourcePath), 'rollback should retain the staged source for recovery');
  assert.ok(existsSync(rollback[0].stagedRasterPath), 'rollback should retain the staged PNG for recovery');
  const snapshotAfterRollback = await library.snapshot();
  assert.equal(snapshotAfterRollback.assets.some((asset) => asset.project === 'Rollback project'), false, 'a failed commit must restore the previous index');
  await fs.rm(`${blockedManifestPath}.bak`, { recursive: true, force: true });
  await library.discardComponentAssetTransaction(rollback);

  const affinity = new AffinityService(() => library.storagePaths());
  let executedScript = '';
  affinity.connect = async () => undefined;
  affinity.callTool = async (name, args) => {
    if (name === 'list_library_scripts') {
      return { content: [{ type: 'text', text: 'Asset Library - Load v4' }] };
    }
    if (name === 'read_library_script') {
      return {
        content: [{ type: 'text', text: `'use strict';
function configuredLibraryRoot() {
  return 'old-assets';
}
function getSetupConfig() {
  return { assetsRoot: 'old-assets', exportsRoot: 'old-exports' };
}
function exportRoot() {
  return 'old-exports';
}
function libraryRoot() {
  return 'old-assets';
}` }],
      };
    }
    if (name === 'execute_script') {
      executedScript = String(args.script || '');
      if (executedScript.includes('KRYEO_COMPONENT_ASSETS:')) {
        return { content: [{ type: 'text', text: 'KRYEO_COMPONENT_ASSETS:[{"id":"component-1","sourcePath":"C:/source.afdesign","rasterPath":"C:/preview.png"}]' }] };
      }
      return { content: [{ type: 'text', text: 'KRYEO_LIBRARY_OK' }] };
    }
    throw new Error(`Unexpected Affinity tool: ${name}`);
  };
  const patchedRun = await affinity.runTool('Asset Library - Load v4');
  assert.equal(patchedRun.ok, true);
  assert.ok(executedScript.includes(JSON.stringify(roots.assets)), 'embedded scripts should receive the Kryeo asset root');
  assert.ok(executedScript.includes(JSON.stringify(roots.exports)), 'embedded scripts should receive the Kryeo export root');
  assert.ok(!executedScript.includes('old-assets'), 'the old desktop library root must not survive patching');
  assert.ok(!executedScript.includes('old-exports'), 'the old desktop export root must not survive patching');

  const exported = await affinity.exportConfirmedComponentAssets('session-1', [{
    id: 'component-1', name: 'Play Button', sourcePaths: [[0, 1]], sourcePath: 'C:/source.afdesign', rasterPath: 'C:/preview.png',
  }]);
  assert.equal(exported[0].id, 'component-1');
  assert.match(executedScript, /createAddDocumentSnapshot/);
  assert.match(executedScript, /clone\.saveAs/);
  assert.match(executedScript, /FileExportArea\.createForSelection/);

  console.log('Embedded library storage smoke test passed.');
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
