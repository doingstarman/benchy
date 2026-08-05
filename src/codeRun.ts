import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CodeLanguage = 'python' | 'javascript'

export interface TestCase { name: string; ok: boolean; err?: string }
export interface RunTestsResult {
  passed: number
  total: number
  cases: TestCase[]
  // Set when execution itself failed (compile error, timeout, crash) rather than
  // a test merely failing. total then falls back to the count parsed from source.
  error: string | null
}

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 512 * 1024
// The harness prints exactly this line last; we read the model's result from it.
const MARKER = 'BENCHY_TESTS::'

// Pull runnable code out of a model's answer. Models fence code in ```lang …```
// (often with prose around it); take every fenced block joined together, or the
// whole text when the model answered with bare code.
export function extractCode(text: string): string {
  const fence = /```[ \t]*[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)```/g
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) blocks.push(m[1].trim())
  return (blocks.length ? blocks.join('\n\n') : text).trim()
}

// How many tests the source declares — the denominator when execution dies
// before the harness can report (so a solution that won't compile scores 0/N,
// not "unscored"). Python: `def test_*`; JavaScript: `test('…', …)` calls.
function countTests(language: CodeLanguage, testSource: string): number {
  const re = language === 'python'
    ? /^[ \t]*(?:async[ \t]+)?def[ \t]+test_\w+/gm
    : /\btest\s*\(\s*[`'"]/g
  return (testSource.match(re) ?? []).length
}

function pythonRunner(solution: string, tests: string): string {
  return `import sys, json
${solution}

${tests}

def __benchy_main():
    cases = []
    for __n in sorted(list(globals().keys())):
        if __n.startswith('test_') and callable(globals()[__n]):
            try:
                globals()[__n]()
                cases.append({"name": __n, "ok": True})
            except Exception as __e:
                cases.append({"name": __n, "ok": False, "err": repr(__e)[:300]})
    __p = sum(1 for __c in cases if __c["ok"])
    sys.stdout.write("\\n${MARKER}" + json.dumps({"passed": __p, "total": len(cases), "cases": cases}) + "\\n")

__benchy_main()
`
}

function jsRunner(solution: string, tests: string): string {
  return `import __nodeAssert from 'node:assert'
const __cases = []
globalThis.test = (name, fn) => { __cases.push([String(name), fn]) }
globalThis.assert = Object.assign((cond, msg) => __nodeAssert.ok(cond, msg), __nodeAssert)

${solution}

${tests}

;(async () => {
  const results = []
  for (const [name, fn] of __cases) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (e) { results.push({ name, ok: false, err: String((e && e.stack) || e).slice(0, 300) }) }
  }
  const passed = results.filter(r => r.ok).length
  process.stdout.write("\\n${MARKER}" + JSON.stringify({ passed, total: results.length, cases: results }) + "\\n")
})()
`
}

const PY_CANDIDATES = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
const interpreterCache = new Map<CodeLanguage, string | null>()

// The command that runs a given language, or null when none is on PATH. The node
// running benchy always runs JavaScript; Python is probed once and cached.
export function interpreterCommand(language: CodeLanguage): string | null {
  if (language === 'javascript') return process.execPath
  if (interpreterCache.has('python')) return interpreterCache.get('python') ?? null
  let found: string | null = null
  for (const cmd of PY_CANDIDATES) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 5000, windowsHide: true })
      if (r.status === 0) { found = cmd; break }
    } catch { /* not this candidate */ }
  }
  interpreterCache.set('python', found)
  return found
}

// Run the model's solution against the item's tests in a throwaway subprocess.
// Returns the pass count; execution failures (compile error, timeout, crash)
// come back as error !== null with passed = 0 and total = the source's test count.
export async function runTests(
  language: CodeLanguage,
  modelText: string,
  testSource: string,
  opts: { timeoutMs?: number } = {},
): Promise<RunTestsResult> {
  const declared = countTests(language, testSource)
  const fail = (error: string): RunTestsResult => ({ passed: 0, total: declared, cases: [], error })

  const cmd = interpreterCommand(language)
  if (!cmd) return fail(`no ${language === 'python' ? 'Python' : 'Node'} interpreter on PATH`)

  const solution = extractCode(modelText)
  const script = language === 'python' ? pythonRunner(solution, testSource) : jsRunner(solution, testSource)
  const dir = await mkdtemp(join(tmpdir(), 'benchy-code-'))
  const file = join(dir, language === 'python' ? 'main.py' : 'main.mjs')

  try {
    await writeFile(file, script, 'utf-8')
    const { stdout, timedOut, code } = await exec(cmd, file, dir, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (timedOut) return fail(`timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)

    const parsed = parseResult(stdout)
    if (!parsed) {
      // The harness never reported — a compile/import error before it ran.
      return fail(code === 0 ? 'no test output' : `exited with code ${code}`)
    }
    return { passed: parsed.passed, total: parsed.total, cases: parsed.cases, error: null }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ })
  }
}

function exec(cmd: string, file: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; timedOut: boolean; code: number | null }> {
  return new Promise(resolve => {
    const child = spawn(cmd, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let bytes = 0
    let timedOut = false
    const cap = (chunk: Buffer) => {
      if (bytes >= MAX_OUTPUT_BYTES) return
      bytes += chunk.length
      out += chunk.toString('utf-8')
    }
    child.stdout.on('data', cap)
    // stderr is drained so a chatty process can't block on a full pipe buffer.
    child.stderr.on('data', () => { /* discarded — the marker line carries the result */ })
    // SIGKILL, not SIGTERM: a tight synchronous loop never returns to the event
    // loop to handle a catchable signal, so only a hard kill reliably stops it.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.on('error', () => { clearTimeout(timer); resolve({ stdout: out, timedOut, code: null }) })
    child.on('close', code => { clearTimeout(timer); resolve({ stdout: out, timedOut, code }) })
  })
}

function parseResult(stdout: string): { passed: number; total: number; cases: TestCase[] } | null {
  // The harness prints the marker last; a model that echoes it earlier can't win.
  const lines = stdout.split('\n').filter(l => l.startsWith(MARKER))
  const last = lines[lines.length - 1]
  if (!last) return null
  try {
    const obj = JSON.parse(last.slice(MARKER.length)) as unknown
    if (!obj || typeof obj !== 'object') return null
    const o = obj as { passed?: unknown; total?: unknown; cases?: unknown }
    if (typeof o.passed !== 'number' || typeof o.total !== 'number') return null
    const cases = Array.isArray(o.cases)
      ? o.cases.filter((c): c is TestCase => !!c && typeof (c as TestCase).name === 'string' && typeof (c as TestCase).ok === 'boolean')
      : []
    return { passed: o.passed, total: o.total, cases }
  } catch { return null }
}
