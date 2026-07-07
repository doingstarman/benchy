// Separate from cli.ts so tests can import it — importing cli.ts would
// execute the CLI (program.parseAsync runs at module top level).
export function findPidsOnPort(port, platform, execCmd) {
    if (platform === 'win32') {
        const out = execCmd(`netstat -ano -p tcp | findstr :${port}`);
        const pids = new Set();
        for (const line of out.split('\n')) {
            const cols = line.trim().split(/\s+/);
            // Proto Local Foreign State PID — match only listeners on our port
            if (cols.length >= 5 && cols[1].endsWith(`:${port}`) && cols[3] === 'LISTENING') {
                const pid = parseInt(cols[4], 10);
                if (Number.isInteger(pid) && pid > 0)
                    pids.add(pid);
            }
        }
        return [...pids];
    }
    const out = execCmd(`lsof -ti tcp:${port} -s tcp:listen`);
    return out.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
}
