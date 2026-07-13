import { join } from 'node:path';
import { getVersionInfo } from '../version.js';
import { getBenchyDir } from '../db/index.js';
export async function registerVersionRoutes(app) {
    // ?check=1 bypasses the 30-min remote cache — used by the "Check for updates"
    // button; the passive load (banner) uses the cached value.
    app.get('/api/version', async (req) => {
        const addr = app.server.address();
        const dir = getBenchyDir();
        const runtime = {
            port: addr && typeof addr !== 'string' ? addr.port : null,
            configPath: join(dir, 'config.json'),
            dbPath: join(dir, 'benchy.db'),
        };
        return { data: await getVersionInfo(runtime, req.query.check === '1') };
    });
}
