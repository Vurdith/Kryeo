import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WorkspaceService } from '../src/main/workspace-service.ts';

const root = path.resolve('tmp', 'assistant-session-smoke');
await fs.rm(root, { recursive: true, force: true });
const service = new WorkspaceService(() => root);

let snapshot = await service.createAssistantSession('Devil Hunter');
const session = snapshot.assistantSessions[0];
assert.equal(session.title, 'New conversation');

snapshot = await service.saveAssistantExchange(
  { id: 'user', project: 'Devil Hunter', sessionId: session.id, role: 'user', text: 'Review the hotbar hierarchy', createdAt: new Date().toISOString() },
  { id: 'assistant', project: 'Devil Hunter', sessionId: session.id, role: 'assistant', text: 'Ready to review it.', createdAt: new Date().toISOString() },
  [{ id: 'memory', project: 'Devil Hunter', scope: 'project', kind: 'hierarchy', text: 'Keep borders inside slots.', createdAt: new Date().toISOString() }],
);
assert.equal(snapshot.assistantSessions[0].title, 'Review the hotbar hierarchy');
assert.equal(snapshot.assistantMessages.length, 2);

snapshot = await service.updateAssistantSession(session.id, { pinned: true, title: 'Hotbar review' });
assert.equal(snapshot.assistantSessions[0].pinned, true);
snapshot = await service.setAssistantMemoryScope('memory', 'global', 'Devil Hunter');
assert.equal(snapshot.assistantMemories[0].scope, 'global');
assert.equal(snapshot.assistantMemories[0].project, 'General');

snapshot = await service.importAssistantSession('Devil Hunter', 'Imported notes', [
  { id: 'old', project: 'Other', role: 'user', text: 'Imported question', createdAt: new Date().toISOString() },
]);
assert.equal(snapshot.assistantSessions.length, 2);
assert.equal(snapshot.assistantMessages.at(-1)?.text, 'Imported question');

snapshot = await service.deleteAssistantSession(session.id);
assert.equal(snapshot.assistantSessions.length, 1);
assert.equal(snapshot.assistantMessages.some((message) => message.sessionId === session.id), false);

console.log(JSON.stringify({ sessions: snapshot.assistantSessions.length, messages: snapshot.assistantMessages.length, memories: snapshot.assistantMemories.length }, null, 2));
