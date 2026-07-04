// Thin wrapper kept for backward compatibility.
// index.ts now starts the API server and forks the orchestrator itself,
// so events stream live via IPC and DB writes are visible to the API.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isCompiled = __dirname.endsWith('/dist') || __dirname.endsWith('\\dist');
const ext = isCompiled ? 'js' : 'ts';
const execArgv = isCompiled ? [] : ['--import', 'tsx'];

const child = spawn('node', [...execArgv, resolve(__dirname, `index.${ext}`)], {
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
