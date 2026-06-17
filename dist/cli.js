#!/usr/bin/env node
import { program } from 'commander';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from './server.js';
function resolveConfigDir(path) {
    if (path === '~')
        return homedir();
    if (path.startsWith('~/') || path.startsWith('~\\')) {
        return resolve(homedir(), path.slice(2));
    }
    return resolve(path);
}
async function startServer(opts) {
    if (opts.configDir) {
        process.env.BENCHY_DIR = resolveConfigDir(opts.configDir);
    }
    const port = parseInt(opts.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid port: ${opts.port}`);
    }
    const url = `http://localhost:${port}`;
    await createServer(port);
    console.log(`benchy running at ${url}`);
    if (opts.open) {
        const { default: open } = await import('open');
        await open(url);
    }
}
program
    .name('benchy')
    .description('Self-hosted AI model benchmarking tool')
    .version('0.1.0')
    .option('-p, --port <number>', 'port to listen on', '4242')
    .option('--config-dir <path>', 'directory for config and database files')
    .option('--no-open', 'do not open browser on start')
    .action(startServer);
program
    .command('start')
    .description('Start the benchy server')
    .option('-p, --port <number>', 'port to listen on', '4242')
    .option('--config-dir <path>', 'directory for config and database files')
    .option('--no-open', 'do not open browser on start')
    .action(startServer);
program.parseAsync().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
