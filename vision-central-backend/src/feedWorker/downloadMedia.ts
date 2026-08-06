export async function downloadMedia(url: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro ao baixar mídia de ${url}`);
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = await response.arrayBuffer();
  return { buffer, contentType };
}
