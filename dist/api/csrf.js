// benchy's API is unauthenticated on localhost, so a website the user visits can
// script requests to it (CSRF). That's harmless for most routes but not for ones
// that arrange local code execution. A cross-site request carries the attacker's
// Origin, and a browser can NEVER forge that to localhost; requests from benchy's
// own UI are same-origin (Origin absent, or a localhost Origin — including the
// dev server on another localhost port). So: absent-or-localhost Origin is
// trusted, anything else is a cross-site attempt and must be refused.
export function isLocalRequest(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    try {
        const host = new URL(origin).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    }
    catch {
        return false;
    }
}
