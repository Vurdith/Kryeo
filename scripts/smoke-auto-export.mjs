import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryService } from '../src/main/library-service.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const destination = path.join(projectRoot, 'tmp', 'auto-export-smoke');
const project = process.argv[2] || 'Devil Hunter';

const library = new LibraryService();
const result = await library.publishProjectExports(project, destination);

console.log(JSON.stringify(result, null, 2));
