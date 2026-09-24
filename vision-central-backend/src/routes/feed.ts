import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../feedWorker/database';
import { nextDailyExecution } from '../feedWorker/schedule';
import { storage } from '../feedWorker/storage';

export const feedRouter = Router();
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const configuredMaxUploadMb = Number(process.env.COLLECTOR_MAX_UPLOAD_MB || 500);
const maxUploadMb = Number.isFinite(configuredMaxUploadMb) ? Math.min(1024, Math.max(100, configuredMaxUploadMb)) : 500;
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_req, file, callback) => callback(null, `vision-feed-${Date.now()}-${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { files: 1, fileSize: maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, acceptedTypes.has(file.mimetype)) });

function receiveCollectorUpload(req: any, res: any, next: any) {
  upload.single('file')(req, res, (error: any) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `A publicacao ultrapassa o limite de ${maxUploadMb} MB do coletor.` });
    }
    return res.status(400).json({ error: error.message || 'Falha ao receber a midia do coletor.' });
  });
}

function bearer(req: any) { return String(req.get('authorization') || ''); }
function hasSecret(req: any, name: 'CRON_SECRET' | 'COLLECTOR_SECRET') {
  const expected = process.env[name]?.trim();
  return Boolean(expected && bearer(req) === `Bearer ${expected}`);
}
function requireCollector(req: any, res: any, next: any) {
  if (!process.env.COLLECTOR_SECRET?.trim()) return res.status(503).json({ error: 'COLLECTOR_SECRET nao configurado.' });
  if (!hasSecret(req, 'COLLECTOR_SECRET')) return res.status(401).json({ error: 'Nao autorizado.' });
  next();
}

function nextRandomizedExecution(source: any) {
  const base = new Date(nextDailyExecution(source.horario_execucao || '08:00', source.timezone || 'America/Bahia'));
  const configuredWindow = Number(process.env.FEED_RANDOM_WINDOW_MINUTES || 120);
  const windowMinutes = Number.isFinite(configuredWindow) ? Math.min(360, Math.max(30, configuredWindow)) : 120;
  base.setTime(base.getTime() + Math.floor(Math.random() * windowMinutes * 60_000));
  return base.toISOString();
}

feedRouter.post('/run-due', async (req, res) => {
  if (!process.env.CRON_SECRET?.trim()) return res.status(503).json({ error: 'CRON_SECRET nao configurado.' });
  if (!hasSecret(req, 'CRON_SECRET')) return res.status(401).json({ error: 'Nao autorizado.' });
  try {
    const { runDueSources } = await import('../feedWorker/scheduler');
    const result = await runDueSources('external-cron');
    return res.status(202).json({ success: true, message: 'Fontes adicionadas a fila.', ...result });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

feedRouter.post('/sync/:id', async (req, res) => {
  try {
    const source = await db.getFeedSourceById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Fonte de feed nao encontrada.' });
    const job = await db.enqueueFeedJob(source.id);
    await db.updateFeedSource(source.id, { status: 'queued', ultimo_erro: null });
    return res.status(202).json({ success: true, message: 'Consulta aguardando um coletor.', jobId: job.id });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

feedRouter.delete('/:id', async (req, res) => {
  try {
    const source = await db.getFeedSourceById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Fonte de feed nao encontrada.' });
    const removed = await db.deleteFeedSourceAndMedia(source.id);
    if (removed.storagePath) await storage.removeMedia(removed.storagePath).catch(error => console.warn('[Feed] Midia removida do banco, mas falhou no R2:', error));
    return res.json({ success: true, message: 'Fonte, fila e midia removidas da playlist.' });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

feedRouter.post('/collector/claim', requireCollector, async (req, res) => {
  try {
    const workerId = String(req.body?.workerId || '').trim().slice(0, 100);
    if (!workerId) return res.status(400).json({ error: 'workerId obrigatorio.' });
    const job = await db.claimFeedJob(workerId);
    if (!job) return res.json({ job: null });
    const source = await db.getFeedSourceById(job.source_id);
    if (!source || !source.ativo) {
      await db.updateFeedJob(job.id, { status: 'failed', completed_at: new Date().toISOString(), error: 'Fonte inexistente ou inativa.' });
      return res.json({ job: null });
    }
    await db.updateFeedSource(source.id, { status: 'processing', ultimo_erro: null });
    return res.json({ job: { id: job.id, attempts: job.attempts, source } });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

feedRouter.post('/collector/jobs/:id/complete', requireCollector, receiveCollectorUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo nao enviado.' });
    const workerId = String(req.body?.workerId || '');
    const itemId = String(req.body?.itemId || '').trim().slice(0, 150);
    const rawDurationSeconds = Number(req.body?.durationSeconds);
    const durationSeconds = Number.isFinite(rawDurationSeconds) && rawDurationSeconds > 0
      ? Math.min(24 * 60 * 60, Math.ceil(rawDurationSeconds))
      : 0;
    if (!itemId) return res.status(400).json({ error: 'itemId obrigatorio.' });
    const job = await db.getFeedJob(req.params.id);
    if (job.status !== 'processing' || job.locked_by !== workerId) return res.status(409).json({ error: 'Tarefa nao pertence a este coletor.' });
    const source = await db.getFeedSourceById(job.source_id);
    if (!source) return res.status(404).json({ error: 'Fonte nao encontrada.' });

    // Uma unica coleta atende todos os vinculos ativos do mesmo @perfil.
    const profileSources = await db.getActiveFeedSourcesByProfile(source.perfil);
    const targets = profileSources.length > 0 ? profileSources : [source];
    const nextExecution = nextRandomizedExecution(source);
    const extension = req.file.mimetype === 'video/mp4' ? 'mp4' : req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const now = new Date();
    const mediaIds: string[] = [];
    let changed = 0;

    for (const target of targets) {
      const existingSlot = await db.getFeedMediaSlot(target.id);
      const needsMedia = target.ultimo_item_id !== itemId || !existingSlot?.midia_id;
      if (needsMedia) {
        const key = `feed/instagram/${target.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${itemId}-${randomUUID()}.${extension}`;
        const publicUrl = await storage.uploadMediaFile(req.file.path, req.file.size, key, req.file.mimetype);
        const saved = await db.saveLatestFeedMedia({ sourceId: target.id, playlistId: target.playlist_id, itemId,
          name: `INSTAGRAM @${target.perfil} - postagem mais recente`, type: req.file.mimetype === 'video/mp4' ? 'video' : 'image', publicUrl, storagePath: key,
          durationSeconds: req.file.mimetype === 'video/mp4' ? durationSeconds || 15 : 10 });
        mediaIds.push(saved.mediaId);
        changed += 1;
        if (saved.previousStoragePath && saved.previousStoragePath !== key) await storage.removeMedia(saved.previousStoragePath).catch(console.warn);
      } else if (req.file.mimetype === 'video/mp4' && durationSeconds > 0) {
        await db.updateFeedMediaDuration(target.id, durationSeconds);
      }
      await db.updateFeedSource(target.id, { status: 'success', ultimo_erro: null, ultima_execucao: new Date().toISOString(),
        ultimo_item_id: itemId, proxima_execucao: nextExecution,
        quantidade_importada: Number(target.quantidade_importada || 0) + (needsMedia ? 1 : 0) });
    }

    await db.completeActiveFeedJobsForSources(targets.map(target => target.id), itemId);
    return res.json({ success: true, unchanged: changed === 0, updatedSources: changed, mediaIds });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  } finally {
    if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
  }
});

feedRouter.post('/collector/jobs/:id/fail', requireCollector, async (req, res) => {
  try {
    const job = await db.getFeedJob(req.params.id);
    if (job.status !== 'processing' || job.locked_by !== String(req.body?.workerId || '')) return res.status(409).json({ error: 'Tarefa nao pertence a este coletor.' });
    const message = String(req.body?.error || 'Falha no coletor.').slice(0, 1000);
    const retry = Number(job.attempts || 0) < 3;
    const retryMinutes = Math.min(60, 10 * Math.max(1, Number(job.attempts || 1))) + Math.floor(Math.random() * 10);
    await db.updateFeedJob(job.id, retry
      ? { status: 'pending', available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(), locked_at: null, locked_by: null, lock_expires_at: null, error: message }
      : { status: 'failed', completed_at: new Date().toISOString(), error: message });
    const failedSource = await db.getFeedSourceById(job.source_id);
    await db.updateFeedSource(job.source_id, {
      status: retry ? 'queued' : 'error', ultimo_erro: message,
      ...(!retry && failedSource ? { proxima_execucao: nextRandomizedExecution(failedSource) } : {}),
    });
    return res.json({ success: true, retry });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});
