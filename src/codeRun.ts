import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

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
// A grace window after the kill signal: a grandchild that inherited the stdout
// pipe can keep 'close' from ever firing, so we force-resolve rather than hang.
const KILL_GRACE_MS = 3_000
const MAX_OUTPUT_BYTES = 512 * 1024
// The harness prints exactly this prefix + a per-run nonce; we read the model's
// result only from a line carrying that nonce, so the model (which never sees the
// nonce) can't spoof a result by printing the marker itself.
const MARKER = 'BENCHY_TESTS::'

// Pull the runnable solution out of a model's answer. Models fence code in
// ```lang … ``` (often alongside prose or a throwaway example test); take the
// LARGEST block — preferring one tagged with the run language — because the
// solution is almost always the biggest, and joining every block would drag the
// model's own example tests into the score. Falls back to the whole text when
// the model answered with bare code.
export function extractCode(text: string, language?: CodeLanguage): string {
  const fence = /```[ \t]*([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g
  const blocks: { lang: string; body: string }[] = []
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) blocks.push({ lang: m[1].toLowerCase(), body: m[2].trim() })
  if (!blocks.length) return text.trim()
  const tags = language === 'python' ? ['python', 'py']
    : language === 'javascript' ? ['javascript', 'js', 'jsx', 'node', 'mjs'] : []
  const preferred = tags.length ? blocks.filter(b => tags.includes(b.lang)) : []
  const pool = preferred.length ? preferred : blocks
  return pool.reduce((a, b) => b.body.length > a.body.length ? b : a).body
}

// How many tests the source declares — the denominator when execution dies before
// the harness can report (so a solution that won't compile scores 0/N, not
// "unscored"). Matched to what each harness actually runs: TOP-LEVEL `def test_*`
// (Python) and `test('…', …)` registrations (JavaScript).
function countTests(language: CodeLanguage, testSource: string): number {
  const re = language === 'python'
    ? /^(?:async[ \t]+)?def[ \t]+test_\w+/gm
    : /\btest\s*\(\s*[`'"]/g
  return (testSource.match(re) ?? []).length
}

function pythonRunner(solution: string, tests: string, nonce: string): string {
  return `import sys, json
${solution}

# Only tests introduced by the test source count — a solution that defines its
# own test_* functions can't pad the denominator.
__benchy_pre = set(globals().keys())

${tests}

def __benchy_main():
    cases = []
    for __n in sorted(list(globals().keys())):
        if __n.startswith('test_') and __n not in __benchy_pre and callable(globals()[__n]):
            try:
                globals()[__n]()
                cases.append({"name": __n, "ok": True})
            except Exception as __e:
                cases.append({"name": __n, "ok": False, "err": repr(__e)[:300]})
    __p = sum(1 for __c in cases if __c["ok"])
    sys.stdout.write("\\n${MARKER}${nonce}::" + json.dumps({"passed": __p, "total": len(cases), "cases": cases}) + "\\n")

__benchy_main()
`
}

function jsRunner(solution: string, tests: string, nonce: string): string {
  return `import __nodeAssert from 'node:assert'
const __realAssert = Object.assign((cond, msg) => __nodeAssert.ok(cond, msg), __nodeAssert)
let __cases = []
const __realTest = (name, fn) => { __cases.push([String(name), fn]) }
globalThis.assert = __realAssert
globalThis.test = __realTest

${solution}

// Re-establish the harness API and drop anything the solution registered or
// tampered with, so only the hidden tests below are measured.
globalThis.assert = __realAssert
globalThis.test = __realTest
__cases = []

${tests}

;(async () => {
  const results = []
  for (const [name, fn] of __cases) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (e) { results.push({ name, ok: false, err: String((e && e.stack) || e).slice(0, 300) }) }
  }
  const passed = results.filter(r => r.ok).length
  process.stdout.write("\\n${MARKER}${nonce}::" + JSON.stringify({ passed, total: results.length, cases: results }) + "\\n")
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
      const r = spawnSync(cmd, ['--version'], { timeout: 3000, windowsHide: true })
      if (r.status === 0) { found = cmd; break }
    } catch { /* not this candidate */ }
  }
  interpreterCache.set('python', found)
  return found
}

// Run the model's solution against the item's tests in a throwaway subprocess.
// Returns the pass count; execution failures (compile error, timeout, crash) come
// back as error !== null with passed = 0 and total = the source's declared count.
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

  const solution = extractCode(modelText, language)
  const nonce = randomBytes(9).toString('hex')
  const script = language === 'python' ? pythonRunner(solution, testSource, nonce) : jsRunner(solution, testSource, nonce)
  const dir = await mkdtemp(join(tmpdir(), 'benchy-code-'))
  const file = join(dir, language === 'python' ? 'main.py' : 'main.mjs')

  try {
    await writeFile(file, script, 'utf-8')
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const { stdout, timedOut, code } = await exec(cmd, file, dir, timeoutMs)
    if (timedOut) return fail(`timed out after ${timeoutMs}ms`)

    const parsed = parseResult(stdout, nonce)
    if (!parsed) return fail(code === 0 ? 'no test output' : `exited with code ${code}`)
    return { passed: parsed.passed, total: parsed.total, cases: parsed.cases, error: null }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ })
  }
}

function exec(cmd: string, file: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; timedOut: boolean; code: number | null }> {
  return new Promise(resolve => {
    const child = spawn(cmd, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    let bytes = 0
    let timedOut = false
    let settled = false
    let killTimer: NodeJS.Timeout
    let hardTimer: NodeJS.Timeout
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      clearTimeout(hardTimer)
      resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), timedOut, code })
    }
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      bytes += chunk.length
      // The marker is printed LAST, so cap by dropping from the FRONT — a chatty
      // solution can't push the result line out of the captured window.
      while (bytes > MAX_OUTPUT_BYTES && chunks.length > 1) { bytes -= chunks[0].length; chunks.shift() }
    })
    child.stderr.on('data', () => { /* drained so a full pipe can't block the child */ })
    killTimer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
    // A killed process whose grandchild holds the stdout pipe never emits 'close';
    // this deadline force-resolves so a run can never hang on it.
    hardTimer = setTimeout(() => { timedOut = true; killTree(child); finish(null) }, timeoutMs + KILL_GRACE_MS)
    child.on('error', () => finish(null))
    child.on('close', code => finish(code))
  })
}

// Kill the whole process tree: a solution can spawn children, and killing only
// the interpreter would orphan them. Windows uses taskkill /T; elsewhere SIGKILL
// the process (best effort — the hard deadline covers any survivor).
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid == null) { child.kill('SIGKILL'); return }
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => {}) }
    catch { child.kill('SIGKILL') }
  } else {
    child.kill('SIGKILL')
  }
}

function parseResult(stdout: string, nonce: string): { passed: number; total: number; cases: TestCase[] } | null {
  const prefix = `${MARKER}${nonce}::`
  const lines = stdout.split('\n').filter(l => l.startsWith(prefix))
  const last = lines[lines.length - 1]
  if (!last) return null
  try {
    const obj = JSON.parse(last.slice(prefix.length)) as unknown
    if (!obj || typeof obj !== 'object') return null
    const o = obj as { passed?: unknown; total?: unknown; cases?: unknown }
    // Reject a nonsensical tally (e.g. passed > total) so a bad line can't push a
    // score above 1 and poison the average.
    if (!Number.isInteger(o.passed) || !Number.isInteger(o.total)) return null
    const passed = o.passed as number
    const total = o.total as number
    if (passed < 0 || total < 0 || passed > total) return null
    const cases = Array.isArray(o.cases)
      ? o.cases.filter((c): c is TestCase => !!c && typeof (c as TestCase).name === 'string' && typeof (c as TestCase).ok === 'boolean')
      : []
    return { passed, total, cases }
  } catch { return null }
}
