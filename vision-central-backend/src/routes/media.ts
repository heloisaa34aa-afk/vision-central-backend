import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { deleteFromR2, getR2KeyFromPublicUrl, isR2Configured, uploadToR2 } from '../storage/r2';

export const mediaRouter = Router();

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const accepted = allowedMimeTypes.has(file.mimetype);
    if (!accepted) {
      callback(new Error('Formato nao permitido.'));
      return;
    }
    callback(null, true);
  },
});

function safeSegment(value: string | undefined, fallback: string): string {
  const cleaned = (value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

mediaRouter.get('/status', (_req, res) => {
  const configured = isR2Configured();
  res.json({ configured, provider: configured ? 'cloudflare-r2' : 'supabase-fallback' });
});

mediaRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!isR2Configured()) return res.status(503).json({ error: 'Cloudflare R2 nao configurado no backend.' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo nao enviado.' });

    const extensionByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
    };
    const now = new Date();
    const clientId = safeSegment(req.body.clientId, 'sem-cliente');
    const originalName = safeSegment(req.file.originalname.replace(/\.[^.]+$/, ''), 'midia');
    const key = [
      'clientes', clientId, String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}-${originalName}.${extensionByMime[req.file.mimetype]}`,
    ].join('/');

    const url = await uploadToR2(req.file.buffer, key, req.file.mimetype);
    return res.status(201).json({ url, key, provider: 'cloudflare-r2' });
  } catch (error: any) {
    console.error('[Media] Falha no upload R2:', error);
    return res.status(500).json({ error: error?.message || 'Falha ao enviar a midia.' });
  }
});

mediaRouter.delete('/', async (req, res) => {
  try {
    if (!isR2Configured()) return res.status(503).json({ error: 'Cloudflare R2 nao configurado no backend.' });
    const fileUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const key = getR2KeyFromPublicUrl(fileUrl);
    if (!key) return res.status(400).json({ error: 'A URL nao pertence ao bucket R2 configurado.' });
    await deleteFromR2(key);
    return res.json({ deleted: true, key });
  } catch (error: any) {
    console.error('[Media] Falha ao excluir do R2:', error);
    return res.status(500).json({ error: error?.message || 'Falha ao excluir a midia.' });
  }
});
