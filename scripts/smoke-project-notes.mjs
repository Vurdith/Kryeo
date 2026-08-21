import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WorkspaceService } from '../src/main/workspace-service.ts';

const root = path.resolve('tmp', 'project-notes-smoke');
await fs.rm(root, { recursive: true, force: true });
const service = new WorkspaceService(() => root);

let snapshot = await service.saveProjectNote({
  project: 'Example Project',
  text: 'Brush: Textured Shadow. Palette uses #FF5733 and #3357FF.',
  tags: ['brush', 'style:pixel'],
});
assert.equal(snapshot.projectKnowledge.length, 1);
assert.equal(snapshot.projectKnowledge[0].notes.length, 1);
assert.deepEqual(snapshot.projectKnowledge[0].metadata.brushes, ['Textured Shadow']);
assert.equal(snapshot.projectKnowledge[0].metadata.colors?.color1, '#FF5733');
assert.equal(snapshot.projectKnowledge[0].metadata.design?.style, 'pixel');

snapshot = await service.mergeProjectKnowledge('Example Project', {
  project: 'Imported',
  notes: [{ id: 'foreign', text: 'Keep the moon icons blue.', tags: ['color'], createdAt: '', updatedAt: '' }],
  metadata: { design: { mood: 'occult' } },
  updatedAt: '',
});
assert.equal(snapshot.projectKnowledge[0].notes.length, 2);
assert.equal(snapshot.projectKnowledge[0].metadata.design?.mood, 'occult');
assert.equal(snapshot.projectKnowledge[0].metadata.design?.style, 'pixel');

const noteId = snapshot.projectKnowledge[0].notes[0].id;
snapshot = await service.deleteProjectNote('Example Project', noteId);
assert.equal(snapshot.projectKnowledge[0].notes.length, 1);

console.log(JSON.stringify(snapshot.projectKnowledge[0], null, 2));
