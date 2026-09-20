export function extractNotionDatabaseId(databaseUrl) {
  const url = new URL(databaseUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['notion.so', 'app.notion.com'].includes(host) && !host.endsWith('.notion.so') && !host.endsWith('.notion.site')) {
    throw new Error('E2E database URL must be an HTTP(S) Notion URL');
  }
  const raw = url.pathname.split('/').pop() || '';
  const match = raw.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{32})$/i);
  if (!match) throw new Error('E2E database URL must end in a Notion database id');
  const compact = match[1].replaceAll('-', '').toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
