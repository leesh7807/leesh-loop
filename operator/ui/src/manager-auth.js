export async function bootstrapManagerToken(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('/api/v1/session', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
    throw new Error(body.error || 'Manager sign-in could not be confirmed. Open Manager again with `leesh-loop`.');
  }
  return body.token;
}
