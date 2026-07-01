#!/usr/bin/env node
import { program } from 'commander'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from './server.js'

interface StartOptions {
  port: string
  configDir?: string
  open: boolean
}

function resolveConfigDir(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }
  return resolve(path)
}

async function startServer(opts: StartOptions): Promise<void> {
  if (opts.configDir) {
    process.env.BENCHY_DIR = resolveConfigDir(opts.configDir)
  }

  const port = parseInt(opts.port, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${opts.port}`)
  }

  const url = `http://localhost:${port}`

  await createServer(port)
  console.log(`benchy running at ${url}`)

  if (opts.open) {
    const { default: open } = await import('open')
    await open(url)
  }
}

program
  .name('benchy')
  .description('Self-hosted AI model benchmarking tool')
  .version('0.1.0')

// Default command: start server (runs when no subcommand given)
program
  .command('start', { isDefault: true })
  .description('Start the benchy server')
  .option('-p, --port <number>', 'port to listen on', '4242')
  .option('--config-dir <path>', 'directory for config and database files')
  .option('--no-open', 'do not open browser on start')
  .action(async (opts: StartOptions) => {
    await startServer(opts)
  })

program
  .command('update')
  .description('Update benchy to the latest version from GitHub')
  .action(async () => {
    const { spawnSync } = await import('node:child_process')

    const c = {
      reset: '\x1b[0m',
      dim: '\x1b[2m',
      green: '\x1b[32m',
      cyan: '\x1b[36m',
      yellow: '\x1b[33m',
      bold: '\x1b[1m',
      red: '\x1b[31m',
    }

    process.stdout.write(`${c.dim}Checking for updates…${c.reset}\n`)
    type CommitEntry = { sha: string; commit: { message: string } }
    let commits: CommitEntry[] = []
    try {
      const res = await fetch('https://api.github.com/repos/doingstarman/benchy/commits?per_page=5&sha=main')
      if (res.ok) commits = await res.json() as CommitEntry[]
    } catch { /* no network info */ }

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let fi = 0
    process.stdout.write('\x1b[?25l')
    const spinner = setInterval(() => {
      process.stdout.write(`\r${c.cyan}${frames[fi++ % frames.length]}${c.reset} Installing latest benchy…`)
    }, 80)

    const result = spawnSync('npm', ['install', '-g', 'https://github.com/doingstarman/benchy/tarball/main'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      encoding: 'utf8',
    })

    clearInterval(spinner)
    process.stdout.write('\x1b[?25h')
    process.stdout.write('\r' + ' '.repeat(50) + '\r')

    if (result.status !== 0) {
      console.error(`${c.red}✗ Update failed.${c.reset}`)
      if (result.stderr) console.error(c.dim + result.stderr.trim() + c.reset)
      process.exit(1)
    }

    console.log(`${c.green}${c.bold}✓ benchy updated${c.reset}`)

    if (commits.length > 0) {
      console.log(`\n${c.dim}Recent changes:${c.reset}`)
      for (const entry of commits.slice(0, 3)) {
        const msg = entry.commit.message.split('\n')[0]
        const sha = entry.sha.slice(0, 7)
        console.log(`  ${c.yellow}${sha}${c.reset}  ${msg}`)
      }
    }

    console.log(`\n${c.dim}Restart benchy to apply the update.${c.reset}`)
    process.exit(0)
  })

program.parseAsync().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
