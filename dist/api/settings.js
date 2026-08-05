import { getCodeExecutionEnabled, setCodeExecutionEnabled } from '../config.js';
import { isLocalRequest } from './csrf.js';
// Server-side settings the UI can read and flip. Kept separate from provider
// config because these are app-wide toggles, not per-provider credentials.
export async function registerSettingsRoutes(app) {
    app.get('/api/settings', async () => {
        return { data: { codeExecution: await getCodeExecutionEnabled() } };
    });
    app.put('/api/settings', async (req, reply) => {
        // Enabling code execution from a cross-site page would be a CSRF foothold —
        // refuse anything that isn't same-origin/localhost.
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const { codeExecution } = req.body;
        if (codeExecution !== undefined) {
            if (typeof codeExecution !== 'boolean') {
                return reply.code(400).send({ error: 'codeExecution must be a boolean' });
            }
            await setCodeExecutionEnabled(codeExecution);
        }
        return { data: { codeExecution: await getCodeExecutionEnabled() } };
    });
}
