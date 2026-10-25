import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const uiRoot = resolve(repositoryRoot, 'operator/ui/dist');
const port = Number(process.env.MANAGER_CAPTURE_PORT || 4180);
const activeRuntime = { id: '9f29e12fc6ebec575a5d17e2a5f6d58e5a4ea10f76d604d59d7496d19ecaf0ed', version: '2026.10.24' };
const priorRuntime = { id: 'ef031c26b182c9abecec5a5baee5bc236d7331f062a673cab5506463923bd97a', version: '2026.10.18' };
const instances = [
  {
    id: 'demo-payments',
    repository_name: 'payments-api',
    repository_root: '/home/demo/work/payments-api',
    base_branch: 'main',
    status: 'Running',
    port: 43107,
    runtime_version: priorRuntime.id
  },
  {
    id: 'demo-docs',
    repository_name: 'docs-site',
    repository_root: '/home/demo/work/docs-site',
    base_branch: 'main',
    status: 'Stopped',
    port: null,
    runtime_version: activeRuntime.id
  }
];

const workflowCurrent = `# Payment service workflow\n\n## Task execution\n\n- Read the accepted task before editing.\n- Keep changes within the selected repository.\n- Run the focused checks for changed behavior.\n\n## Completion\n\n- Record the result in the task Workpad.\n- Report any failed check and remaining work.\n`;

const workflowCandidate = `# Payment service workflow\n\n## Task execution\n\n- Read the accepted task and linked workpad before editing.\n- Keep changes within the selected repository.\n- Run focused checks and inspect the final diff.\n\n## Completion\n\n- Record the result and verification in the task Workpad.\n- Report failed checks, remaining work, and external blockers.\n`;

const tasks = [
  {
    id: 'demo-task-184',
    identifier: 'PAY-184',
    title: 'Centralize payment retry policy',
    state: 'In Progress',
    blockedBy: [],
    priority: 2,
    labels: ['runtime']
  },
  {
    id: 'demo-task-179',
    identifier: 'PAY-179',
    title: 'Document idempotency key behavior',
    state: 'Human Review',
    blockedBy: [],
    priority: 3,
    labels: ['docs']
  },
  {
    id: 'demo-task-171',
    identifier: 'PAY-171',
    title: 'Add webhook delivery audit fields',
    state: 'Ready',
    blockedBy: [],
    priority: 2,
    labels: ['api']
  }
];

function hasStartingStatus(request) {
  return (request.headers.cookie || '').split(';').some(value => value.trim() === 'manager-demo-status=starting');
}

function respond(response, status, body, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method !== 'GET') return respond(response, 405, { error: 'This fixture is read-only.' });
  if (pathname === '/api/v1/instances') {
    const visibleInstances = hasStartingStatus(request)
      ? instances.map(instance => instance.id === 'demo-payments' ? { ...instance, status: 'Starting' } : instance)
      : instances;
    return respond(response, 200, { instances: visibleInstances });
  }
  if (pathname === '/api/v1/runtime') {
    return respond(response, 200, { active: activeRuntime, distributions: [activeRuntime, priorRuntime], manager_runtime_version: activeRuntime.id });
  }
  if (pathname === '/api/v1/config') {
    return respond(response, 200, {
      githubRepositoryName: 'payments-api',
      githubBrowserRepositoryUrl: 'https://github.com/example/payments-api',
      defaultState: 'Ready',
      states: ['Backlog', 'Ready', 'In Progress', 'Human Review', 'Done', 'Cancelled']
    });
  }
  if (pathname === '/api/v1/tasks') return respond(response, 200, { tasks });
  if (/^\/api\/v1\/instances\/[^/]+\/workflow$/.test(pathname)) {
    return respond(response, 200, { current: workflowCurrent, candidate: workflowCandidate, changed: true });
  }
  if (/^\/api\/v1\/instances\/[^/]+\/logs$/.test(pathname)) {
    return respond(response, 200, { logs: `Loop Process started · ${priorRuntime.id}\nSymphony endpoint ready · 127.0.0.1:43107` });
  }
  if (pathname.startsWith('/api/')) return respond(response, 404, { error: 'No fixture response for this API path.' });

  let requestedPath = resolve(uiRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!requestedPath.startsWith(`${uiRoot}${sep}`) && requestedPath !== resolve(uiRoot, 'index.html')) {
    return respond(response, 403, { error: 'Path is outside the built UI.' });
  }
  try {
    let body = await readFile(requestedPath);
    if (requestedPath === resolve(uiRoot, 'index.html') && url.searchParams.has('showWorkflow')) {
      const html = body.toString('utf8').replace('</body>', `<script>
        let attempts = 0;
        const openWorkflow = setInterval(() => {
          const details = document.querySelector('.manager-folders > details');
          if (details) {
            details.open = true;
            clearInterval(openWorkflow);
          }
          if (++attempts >= 80) clearInterval(openWorkflow);
        }, 50);
      </script></body>`);
      body = Buffer.from(html);
    }
    const contentType = extname(requestedPath) === '.js' ? 'text/javascript; charset=utf-8'
      : extname(requestedPath) === '.css' ? 'text/css; charset=utf-8'
        : extname(requestedPath) === '.svg' ? 'image/svg+xml'
          : 'text/html; charset=utf-8';
    const headers = { 'cache-control': 'no-store', 'content-type': contentType };
    if (requestedPath === resolve(uiRoot, 'index.html')) {
      headers['set-cookie'] = `manager-demo-status=${url.searchParams.get('status') === 'starting' ? 'starting' : 'running'}; Path=/; SameSite=Strict; HttpOnly`;
    }
    response.writeHead(200, headers);
    response.end(body);
  } catch {
    respond(response, 404, { error: 'Built UI asset not found. Build operator/ui first.' });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Manager design fixture: http://127.0.0.1:${port}/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
