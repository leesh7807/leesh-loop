import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { open, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '2026-10-27-manager-cli-experience-redesign');
const filename = process.argv[2] || '';
if (!/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g)$/i.test(filename) || basename(filename) !== filename) {
  throw new Error('Provide a filename ending in .png, .jpg, or .jpeg.');
}

const outputPath = resolve(evidenceRoot, filename);
const token = randomBytes(32);
const maxBytes = 12 * 1024 * 1024;
let received = false;

function validImage(bytes, contentType) {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/capture' || received) {
    response.writeHead(404).end();
    return;
  }
  const suppliedHex = String(request.headers['x-capture-token'] || '');
  const supplied = /^[a-f0-9]{64}$/i.test(suppliedHex) ? Buffer.from(suppliedHex, 'hex') : Buffer.alloc(0);
  if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
    response.writeHead(403).end('Invalid capture token.');
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      response.writeHead(413).end('Image is too large.');
      server.close();
      return;
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0];
  const extensionMatches = (contentType === 'image/png' && filename.toLowerCase().endsWith('.png'))
    || (contentType === 'image/jpeg' && /\.jpe?g$/i.test(filename));
  if (!validImage(bytes, contentType) || !extensionMatches) {
    response.writeHead(415).end('Expected a PNG or JPEG screenshot.');
    return;
  }

  await mkdir(evidenceRoot, { recursive: true });
  const file = await open(outputPath, 'wx');
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
  received = true;
  response.writeHead(201, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ filename, bytes: bytes.length }));
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({
    url: `http://127.0.0.1:${address.port}/capture`,
    token: token.toString('hex'),
    filename
  }) + '\n');
});
