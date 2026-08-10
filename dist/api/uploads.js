import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat, unlink, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, getBenchyDir } from '../db/index.js';
export const ALLOWED_MIME_TYPES = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
};
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// The declared Content-Type is client-controlled, so also sniff the leading
// bytes: a valid mime on a garbage/renamed file would otherwise be shipped to
// providers. Images must carry their signature at offset 0; a PDF header may
// sit behind a small amount of leading junk that real readers tolerate.
export function contentMatchesMime(mimeType, buf) {
    const startsWith = (...sig) => sig.length <= buf.length && sig.every((b, i) => buf[i] === b);
    switch (mimeType) {
        case 'image/png': return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
        case 'image/jpeg': return startsWith(0xff, 0xd8, 0xff);
        case 'image/gif': // full "GIF87a" / "GIF89a" header, not just "GIF8"
            return startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
        case 'image/webp': // "RIFF"...."WEBP"
            return buf.length >= 12 &&
                startsWith(0x52, 0x49, 0x46, 0x46) &&
                buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
        // Scan the first ~1 KB; the 1029 window (1024 + the 5-byte marker) keeps a
        // header that straddles the 1024-byte boundary from being falsely rejected.
        case 'application/pdf': return buf.subarray(0, 1029).includes(Buffer.from('%PDF-'));
        default: return false;
    }
}
export function getUploadsDir() {
    return join(getBenchyDir(), 'uploads');
}
export function uploadPath(id, mimeType) {
    return join(getUploadsDir(), `${id}${ALLOWED_MIME_TYPES[mimeType] ?? ''}`);
}
export function getAttachmentRow(id) {
    return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id);
}
// Deletes every attachment bound to a run — files on disk AND DB rows. Called
// when a run is deleted so "deleted" media doesn't linger on disk/URL and
// storage doesn't leak unbounded (the attachments table has no FK cascade
// because it predates the run when unbound).
// The bulk twin of deleteAttachmentsForRun, for clearing every run at once.
// Written as two statements rather than a loop over deleteAttachmentsForRun
// because that is one prepared-statement execution per run, and this runs
// against a whole history.
//
// Only rows whose run_id is set are touched: a dataset's source file and a
// still-unbound upload both survive, since neither belongs to a run.
export async function deleteAttachmentsForRuns(runIds) {
    if (runIds.length === 0)
        return;
    const db = getDb();
    const holes = runIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, mime_type FROM attachments WHERE run_id IN (${holes})`)
        .all(...runIds);
    // Unlink BEFORE the delete, and outside any transaction — better-sqlite3
    // transactions are synchronous and cannot await.
    for (const row of rows) {
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    }
    db.prepare(`DELETE FROM attachments WHERE run_id IN (${holes})`).run(...runIds);
}
export async function deleteAttachmentsForRun(runId) {
    const db = getDb();
    const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id = ?')
        .all(runId);
    for (const row of rows) {
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    }
    db.prepare('DELETE FROM attachments WHERE run_id = ?').run(runId);
}
// Copies a source run's attachments (files + rows) onto a target run, keeping
// prompt_index, so a forked run re-runs with the same media instead of
// silently losing it.
export async function cloneAttachmentsForRun(sourceRunId, targetRunId) {
    const db = getDb();
    const rows = db.prepare('SELECT id, prompt_index, mime_type, name, size FROM attachments WHERE run_id = ? ORDER BY created_at').all(sourceRunId);
    const insert = db.prepare('INSERT INTO attachments (id, run_id, prompt_index, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const row of rows) {
        const newId = randomUUID();
        await copyFile(uploadPath(row.id, row.mime_type), uploadPath(newId, row.mime_type)).catch(() => { });
        insert.run(newId, targetRunId, row.prompt_index, row.mime_type, row.name, row.size, Date.now());
    }
}
// Copies one turn's attachments onto a target turn (independent files). Used by
// regenerate, which re-runs a single cell on a throwaway run — without this the
// re-run loses the turn's image and answers as if nothing was attached.
export async function cloneAttachmentsForTurn(sourceRunId, sourcePromptIndex, targetRunId, targetPromptIndex) {
    const db = getDb();
    const rows = db.prepare('SELECT id, mime_type, name, size FROM attachments WHERE run_id = ? AND prompt_index = ? ORDER BY created_at').all(sourceRunId, sourcePromptIndex);
    const insert = db.prepare('INSERT INTO attachments (id, run_id, prompt_index, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const row of rows) {
        const newId = randomUUID();
        await copyFile(uploadPath(row.id, row.mime_type), uploadPath(newId, row.mime_type)).catch(() => { });
        insert.run(newId, targetRunId, targetPromptIndex, row.mime_type, row.name, row.size, Date.now());
    }
}
// Binds an upload to a dataset item: it stops being an abandoned upload (the GC
// skips dataset_id rows) and becomes permanent until the item/dataset is gone.
export function bindAttachmentToDataset(id, datasetId) {
    getDb().prepare('UPDATE attachments SET dataset_id = ? WHERE id = ?').run(datasetId, id);
}
// Copies one attachment (file + row) onto a run turn, independent of the source.
// A dataset item's file is unbound (run_id NULL, dataset_id set), so it can't be
// found by run+prompt_index — a dataset run clones it by id onto (run, item idx).
export async function cloneAttachmentOnto(attachmentId, targetRunId, targetPromptIndex) {
    const row = getAttachmentRow(attachmentId);
    if (!row)
        return;
    const newId = randomUUID();
    await copyFile(uploadPath(row.id, row.mime_type), uploadPath(newId, row.mime_type)).catch(() => { });
    getDb().prepare('INSERT INTO attachments (id, run_id, prompt_index, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, targetRunId, targetPromptIndex, row.mime_type, row.name, row.size, Date.now());
}
// Deletes one attachment (file + row) regardless of how it's bound. Used when a
// dataset item or a whole dataset is removed.
export async function deleteAttachment(id) {
    const row = getAttachmentRow(id);
    if (!row)
        return;
    await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    getDb().prepare('DELETE FROM attachments WHERE id = ?').run(id);
}
// Removes every attachment owned by a dataset (files + rows) — the dataset_items
// FK cascade drops the item rows, but attachments have no FK (see the table).
export async function deleteAttachmentsForDataset(datasetId) {
    const db = getDb();
    const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE dataset_id = ?')
        .all(datasetId);
    for (const row of rows) {
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    }
    db.prepare('DELETE FROM attachments WHERE dataset_id = ?').run(datasetId);
}
// Sweeps abandoned uploads: rows never bound to a run (user attached then
// removed the chip or closed the tab without sending) older than the cutoff.
// Dataset files are unbound to a run but permanent, so dataset_id rows are
// exempt. Runs on startup — bounds the disk leak without touching an in-flight
// upload.
export async function gcUnboundUploads(olderThanMs) {
    const db = getDb();
    const cutoff = Date.now() - olderThanMs;
    const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id IS NULL AND dataset_id IS NULL AND created_at < ?')
        .all(cutoff);
    for (const row of rows) {
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    }
    db.prepare('DELETE FROM attachments WHERE run_id IS NULL AND dataset_id IS NULL AND created_at < ?').run(cutoff);
    return rows.length;
}
export async function registerUploadsRoutes(app) {
    const { default: fastifyMultipart } = await import('@fastify/multipart');
    await app.register(fastifyMultipart, {
        limits: { fileSize: MAX_FILE_SIZE, files: 8 },
    });
    app.post('/api/uploads', async (req, reply) => {
        const file = await req.file();
        if (!file)
            return reply.code(400).send({ error: 'No file in request' });
        const mimeType = file.mimetype;
        if (!ALLOWED_MIME_TYPES[mimeType]) {
            return reply.code(400).send({
                error: `Unsupported file type "${mimeType}" — allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`,
            });
        }
        let buf;
        try {
            buf = await file.toBuffer();
        }
        catch {
            // @fastify/multipart throws when the stream exceeds the fileSize limit
            return reply.code(413).send({ error: `File is too large — the limit is ${MAX_FILE_SIZE / 1024 / 1024} MB` });
        }
        // toBuffer() doesn't always throw at the limit — @fastify/multipart can
        // silently truncate the stream and set `truncated`. Reject those too (before
        // writing) so a corrupted 10 MB file never gets persisted and served.
        if (file.file.truncated) {
            return reply.code(413).send({ error: `File is too large — the limit is ${MAX_FILE_SIZE / 1024 / 1024} MB` });
        }
        if (!contentMatchesMime(mimeType, buf)) {
            return reply.code(400).send({
                error: `File content doesn't match its declared type "${mimeType}" — the bytes aren't a valid ${mimeType}`,
            });
        }
        const id = randomUUID();
        await mkdir(getUploadsDir(), { recursive: true });
        await writeFile(uploadPath(id, mimeType), buf);
        const name = file.filename || `file${ALLOWED_MIME_TYPES[mimeType]}`;
        getDb().prepare('INSERT INTO attachments (id, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, mimeType, name, buf.length, Date.now());
        return reply.code(201).send({ data: { id, name, mimeType, size: buf.length } });
    });
    app.get('/api/uploads/:id', async (req, reply) => {
        const row = getAttachmentRow(req.params.id);
        if (!row)
            return reply.code(404).send({ error: 'Attachment not found' });
        const path = uploadPath(row.id, row.mime_type);
        try {
            await stat(path);
        }
        catch {
            return reply.code(404).send({ error: 'Attachment file missing on disk' });
        }
        reply.header('Content-Type', row.mime_type);
        reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.name)}"`);
        reply.header('X-Content-Type-Options', 'nosniff');
        return reply.send(createReadStream(path));
    });
    // Only unbound uploads can be deleted this way — removing a chip before send.
    // A bound attachment belongs to a run and is cleaned up with it, never here.
    app.delete('/api/uploads/:id', async (req, reply) => {
        const row = getAttachmentRow(req.params.id);
        if (!row)
            return reply.code(404).send({ error: 'Attachment not found' });
        if (row.run_id)
            return reply.code(409).send({ error: 'Attachment is bound to a run — delete the run instead' });
        if (row.dataset_id)
            return reply.code(409).send({ error: 'Attachment belongs to a dataset — delete the dataset item instead' });
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
        getDb().prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
        return reply.code(204).send();
    });
}
