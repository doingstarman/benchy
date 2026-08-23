import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createTraceParser, createLineStreamer } from './protocol.js';
// A grace window between SIGTERM and SIGKILL: a well-behaved agent flushes and
// exits on the term; a wedged one (or a grandchild holding the stdout pipe) is
// force-killed after this so a run can never hang.
const KILL_GRACE_MS = 3_000;
function expandHome(p) {
    return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? homedir() + p.slice(1) : p;
}
// Graceful stop first (SIGTERM / taskkill without /f), so the agent can flush.
function termTree(child) {
    if (child.pid == null)
        return;
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(child.pid), '/t'], { windowsHide: true }).on('error', () => { });
        }
        catch {
            child.kill('SIGTERM');
        }
    }
    else {
        child.kill('SIGTERM');
    }
}
// Force the whole tree down: a grandchild would otherwise be orphaned and keep the
// pipe open.
function killTree(child) {
    if (child.pid == null) {
        child.kill('SIGKILL');
        return;
    }
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => { });
        }
        catch {
            child.kill('SIGKILL');
        }
    }
    else {
        child.kill('SIGKILL');
    }
}
// Runs a local program as a benchmark participant. The program streams its
// trajectory as JSONL on stdout (see docs/agent-protocol.md); a line that isn't
// JSON-with-a-known-type is an output token, so a plain script that just prints an
// answer still works exactly as it did before agents existed.
export const scriptAdapter = {
    async *stream(messages, config) {
        const command = config.baseUrl?.trim();
        if (!command) {
            yield { type: 'error', message: 'No script command configured' };
            return;
        }
        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        const a = config.agent ?? {};
        const parser = createTraceParser({
            model: config.model,
            pricingOverrides: a.pricingOverrides,
            payloadCapBytes: a.payloadCapBytes,
        });
        const streamer = createLineStreamer(parser);
        // Push child-process events into a queue the async generator drains.
        const queue = [];
        let notify = null;
        let finished = false;
        let terminal = false;
        let sawDone = false;
        let steps = 0;
        let costUsd = 0;
        const wake = () => { if (notify) {
            const n = notify;
            notify = null;
            n();
        } };
        const finish = () => { finished = true; wake(); };
        const emit = (chunks) => {
            if (terminal)
                return;
            for (const c of chunks) {
                queue.push(c);
                if (c.type === 'done')
                    sawDone = true;
                if (c.type === 'error' && c.scope)
                    terminal = true;
                if (c.type === 'step') {
                    steps++;
                    if (c.step.cost != null)
                        costUsd += c.step.cost;
                }
            }
            if (chunks.length)
                wake();
            if (!terminal)
                enforceLimits();
        };
        let child;
        let killTimer;
        let hardTimer;
        const stopTimers = () => { if (killTimer)
            clearTimeout(killTimer); if (hardTimer)
            clearTimeout(hardTimer); };
        const abort = (message) => {
            if (terminal)
                return;
            terminal = true;
            queue.push({ type: 'error', message, scope: 'agent' });
            stopTimers();
            termTree(child);
            hardTimer = setTimeout(() => { killTree(child); finish(); }, KILL_GRACE_MS);
            wake();
        };
        function enforceLimits() {
            if (a.maxSteps != null && steps > a.maxSteps)
                abort(`step limit reached (${a.maxSteps})`);
            else if (a.maxCostUsd != null && costUsd > a.maxCostUsd)
                abort(`cost limit reached ($${a.maxCostUsd})`);
        }
        try {
            child = spawn(cmd, args, {
                cwd: a.cwd ? expandHome(a.cwd) : undefined,
                env: a.env ? { ...process.env, ...a.env } : process.env,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                windowsHide: true,
            });
        }
        catch (e) {
            yield { type: 'error', message: e instanceof Error ? e.message : String(e), scope: 'agent' };
            return;
        }
        let stderr = '';
        const stdin = child.stdin;
        child.stdout?.on('data', (d) => { emit(streamer.feed(d.toString())); });
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        stdin?.on('error', () => { });
        child.on('error', e => { if (!terminal) {
            terminal = true;
            queue.push({ type: 'error', message: e.message, scope: 'agent' });
        } stopTimers(); finish(); });
        child.on('close', code => {
            stopTimers();
            if (terminal) {
                finish();
                return;
            }
            emit(streamer.flush());
            if (code !== 0) {
                queue.push({ type: 'error', message: stderr.trim() || `agent exited with code ${code}`, scope: 'agent' });
            }
            else if (!sawDone) {
                queue.push({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
            }
            finish();
        });
        if (a.timeoutMs != null && a.timeoutMs > 0) {
            killTimer = setTimeout(() => {
                if (terminal)
                    return;
                terminal = true;
                queue.push({ type: 'error', message: `agent timed out after ${a.timeoutMs}ms`, scope: 'agent' });
                termTree(child);
                hardTimer = setTimeout(() => { killTree(child); finish(); }, KILL_GRACE_MS);
                wake();
            }, a.timeoutMs);
        }
        try {
            stdin?.write(JSON.stringify({ messages, model: config.model }));
        }
        catch { /* ignore */ }
        try {
            stdin?.end();
        }
        catch { /* ignore */ }
        try {
            for (;;) {
                if (queue.length) {
                    yield queue.shift();
                    continue;
                }
                if (finished)
                    break;
                await new Promise(res => { notify = res; });
            }
        }
        finally {
            stopTimers();
            if (child.exitCode == null && child.signalCode == null)
                killTree(child);
        }
    },
};
