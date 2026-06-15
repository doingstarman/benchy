import { program } from 'commander'
import { createServer } from './server.js'

program
  .name('benchy')
  .description('Self-hosted AI model benchmarking tool')
  .version('0.1.0')

program
  .command('start')
  .description('Start the benchy server')
  .option('-p, --port <number>', 'port to listen on', '4242')
  .option('--no-open', 'do not open browser on start')
  .action(async (opts: { port: string; open: boolean }) => {
    const port = parseInt(opts.port, 10)
    const url = `http://localhost:${port}`

    await createServer(port)
    console.log(`benchy running at ${url}`)

    if (opts.open) {
      const { default: open } = await import('open')
      await open(url)
    }
  })

program.parse()
