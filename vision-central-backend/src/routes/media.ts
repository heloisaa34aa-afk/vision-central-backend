import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { getRequester } from '../auth/requester';
import { createR2UploadUrl, deleteFromR2, getR2KeyFromPublicUrl, isR2Configured, uploadToR2 } from '../storage/r2';

export const mediaRouter = Router();

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const MAX_DIRECT_UPLOAD_BYTES = 500 * 1024 * 1024;
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

function buildMediaKey(clientIdValue: string | undefined, fileName: string, mimeType: string): string {
  const extensionByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
  };
  const now = new Date();
  const clientId = safeSegment(clientIdValue, 'sem-cliente');
  const originalName = safeSegment(fileName.replace(/\.[^.]+$/, ''), 'midia');
  return [
    'clientes', clientId, String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomUUID()}-${originalName}.${extensionByMime[mimeType]}`,
  ].join('/');
}

mediaRouter.get('/status', (_req, res) => {
  const configured = isR2Configured();
  res.json({ configured, provider: configured ? 'cloudflare-r2' : 'supabase-fallback' });
});

mediaRouter.post('/upload-url', async (req, res) => {
  try {
    if (!isR2Configured()) return res.status(503).json({ error: 'Cloudflare R2 nao configurado no backend.' });

    const requester = await getRequester(req);
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
    const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : '';
    const fileSize = Number(req.body?.fileSize);

    if (requester.role !== 'admin' && requester.clienteId !== clientId) {
      return res.status(403).json({ error: 'Este usuario nao pode enviar midia para esse cliente.' });
    }
    if (!fileName || !clientId || !allowedMimeTypes.has(contentType)) {
      return res.status(400).json({ error: 'Nome, cliente ou formato de arquivo invalido.' });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_DIRECT_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'O arquivo deve ter no maximo 500 MB.' });
    }

    const key = buildMediaKey(clientId, fileName, contentType);
    const { uploadUrl, publicUrl } = await createR2UploadUrl(key, contentType);
    return res.json({ uploadUrl, url: publicUrl, key, expiresIn: 900, provider: 'cloudflare-r2' });
  } catch (error: any) {
    const status = ['AUTH_REQUIRED', 'INVALID_SESSION'].includes(error?.message) ? 401
      : error?.message === 'ACCESS_DENIED' ? 403 : 500;
    if (status === 500) console.error('[Media] Falha ao autorizar upload direto no R2:', error);
    return res.status(status).json({ error: status === 500 ? 'Falha ao autorizar o envio da midia.' : 'Sessao sem permissao.' });
  }
});

mediaRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!isR2Configured()) return res.status(503).json({ error: 'Cloudflare R2 nao configurado no backend.' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo nao enviado.' });

    const key = buildMediaKey(req.body.clientId, req.file.originalname, req.file.mimetype);

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
