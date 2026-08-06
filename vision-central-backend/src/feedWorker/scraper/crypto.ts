import * as crypto from 'crypto';

const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const configuredKey = process.env.SESSION_ENCRYPTION_KEY;
  if (!configuredKey || configuredKey.length < 24) {
    throw new Error('SESSION_ENCRYPTION_KEY ausente ou muito curta. Configure uma chave aleatoria no Render.');
  }
  return crypto.createHash('sha256').update(configuredKey, 'utf8').digest();
}

export function encrypt(text: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift() as string, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return null;
  }
}
