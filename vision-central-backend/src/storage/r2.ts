import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const requiredEnvironment = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
] as const;

type R2EnvironmentName = (typeof requiredEnvironment)[number];

export function isR2Configured(): boolean {
  return requiredEnvironment.every(name => Boolean(process.env[name]?.trim()));
}

function requireEnvironment(name: R2EnvironmentName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel ${name} nao configurada.`);
  return value;
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const accountId = requireEnvironment('R2_ACCOUNT_ID');
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnvironment('R2_ACCESS_KEY_ID'),
        secretAccessKey: requireEnvironment('R2_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

function normalizeKey(key: string): string {
  const normalized = key.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('../')) throw new Error('Caminho de arquivo invalido.');
  return normalized;
}

export function getR2PublicUrl(key: string): string {
  const baseUrl = requireEnvironment('R2_PUBLIC_URL').replace(/\/+$/, '');
  const encodedKey = normalizeKey(key)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl}/${encodedKey}`;
}

export function getR2KeyFromPublicUrl(fileUrl: string): string | null {
  try {
    const publicUrl = new URL(requireEnvironment('R2_PUBLIC_URL'));
    const candidate = new URL(fileUrl);
    if (candidate.origin !== publicUrl.origin) return null;
    const basePath = publicUrl.pathname.replace(/\/+$/, '');
    if (basePath && !candidate.pathname.startsWith(`${basePath}/`)) return null;
    const relativePath = candidate.pathname.slice(basePath.length).replace(/^\/+/, '');
    return normalizeKey(relativePath.split('/').map(decodeURIComponent).join('/'));
  } catch {
    return null;
  }
}

export async function uploadToR2(
  body: Uint8Array | Buffer | ArrayBuffer,
  key: string,
  contentType: string,
): Promise<string> {
  const normalizedKey = normalizeKey(key);
  await getClient().send(new PutObjectCommand({
    Bucket: requireEnvironment('R2_BUCKET_NAME'),
    Key: normalizedKey,
    Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return getR2PublicUrl(normalizedKey);
}

export async function deleteFromR2(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({
    Bucket: requireEnvironment('R2_BUCKET_NAME'),
    Key: normalizeKey(key),
  }));
}
