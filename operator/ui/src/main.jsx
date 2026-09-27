import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const REFRESH_INTERVAL_MS = 7500;
const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value);

function TaskCard({ task }) {
  return (
    <article className="task-card">
      <div className="task-heading">
        <div className="task-title-block">
          <h3>{task.title || '(Untitled)'}</h3>
          {task.identifier && <p className="task-identifier">{task.identifier}</p>}
        </div>
        <div className="task-state"><span className="meta-label">State</span><strong>{task.state}</strong></div>
      </div>

      <section className="blocker-section" aria-label={`Blocked By for ${task.title}`}>
        <h4>Blocked By</h4>
        {task.blockedBy.length ? (
          <ul className="blocker-list">
            {task.blockedBy.map(blocker => (
              <li key={`${blocker.url}-${blocker.title}`}>
                <a href={blocker.url} target="_blank" rel="noreferrer">{blocker.title}</a>
                <span className="blocker-state">{blocker.state}</span>
              </li>
            ))}
          </ul>
        ) : <p className="quiet">No blockers</p>}
      </section>

      {(task.priority !== null || task.labels.length > 0) && (
        <div className="task-metadata" aria-label="Additional task details">
          {task.priority !== null && <span>Priority {task.priority}</span>}
          {task.labels.map(label => <span key={label}>{label}</span>)}
        </div>
      )}

      <div className="task-links">
        <a href={task.taskUrl} target="_blank" rel="noreferrer">Open task in Notion ↗</a>
        {task.planUrl && <a href={task.planUrl} target="_blank" rel="noreferrer">Open Accepted Plan ↗</a>}
      </div>
    </article>
  );
}

function TaskSurface({ tasks, loading, error, refreshedAt, onRetry }) {
  return (
    <section className="surface task-surface" aria-labelledby="tasks-heading" aria-busy={loading && !refreshedAt}>
      <div className="surface-header">
        <div>
          <p className="eyebrow">Current project work</p>
          <h2 id="tasks-heading">Tasks</h2>
        </div>
        <p className="refresh-meta" aria-live="polite">
          {loading && !refreshedAt ? 'Loading tasks' : refreshedAt ? `Updated ${formatTime(refreshedAt)}` : ''}
        </p>
      </div>
      {error && (
        <div className="refresh-error" role="status">
          <p><strong>Refresh failed.</strong> Showing the last successful task read{refreshedAt ? ` from ${formatTime(refreshedAt)}` : ''}. The Operator will retry automatically.</p>
          {!refreshedAt && <button type="button" className="text-button" onClick={onRetry}>Try again</button>}
        </div>
      )}
      {!refreshedAt && loading ? <p className="empty-state">Reading the current task list…</p> : null}
      {!loading && !error && tasks.length === 0 ? <p className="empty-state">There are no current tasks.</p> : null}
      {tasks.length > 0 && <div className="task-list">{tasks.map((task, index) => <TaskCard key={`${task.taskUrl}-${index}`} task={task} />)}</div>}
    </section>
  );
}

function PublicationSurface({ config }) {
  const [plan, setPlan] = useState('');
  const [state, setState] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setPublishing(true);
    setResult(null);
    try {
      const response = await fetch('/api/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, state })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Publishing failed.');
      setResult({ kind: 'success', ...body });
    } catch (error) {
      setResult({ kind: 'failure', message: error.message || 'Publishing failed.' });
    } finally {
      setPublishing(false);
    }
  }

  function reset() {
    setPlan('');
    setState('');
    setResult(null);
  }

  return (
    <section className="surface publication-surface" aria-labelledby="publish-heading">
      <div className="surface-header">
        <div>
          <p className="eyebrow">Create project work</p>
          <h2 id="publish-heading">Publish a Plan</h2>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="plan-field">
          <label htmlFor="plan">1. Review the Plan</label>
          <p className="field-help">The Publisher keeps the accepted Plan and task details in Notion.</p>
          <textarea id="plan" name="plan" value={plan} onChange={event => setPlan(event.target.value)} spellCheck="false" aria-label="Plan Markdown" />
        </div>
        <div className="publish-decision">
          <div>
            <label htmlFor="state">2. Choose publication State</label>
            <select id="state" name="state" value={state} onChange={event => setState(event.target.value)}>
              <option value="">Publisher default ({config.defaultState})</option>
              {config.states.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
            <p className="field-help">State choices come from the current Publisher configuration.</p>
          </div>
          <button type="submit" disabled={publishing} aria-busy={publishing}>{publishing ? 'Publishing…' : '3. Publish Plan'}</button>
        </div>
      </form>

      {result && (
        <section className={`publication-result ${result.kind}`} role={result.kind === 'success' ? 'status' : 'alert'} aria-labelledby="result-heading">
          <p className="eyebrow">4. Publication result</p>
          <h3 id="result-heading">{result.kind === 'success' ? 'Plan published' : 'Publish failed'}</h3>
          {result.kind === 'success' ? (
            <>
              <p>Task <code>{result.identifier}</code> was published with State <strong>{result.state}</strong>.</p>
              {result.url && <a href={result.url} target="_blank" rel="noreferrer">Open published task in Notion ↗</a>}
              <button className="text-button" type="button" onClick={reset}>Publish another Plan</button>
            </>
          ) : (
            <>
              <p className="error-detail">{result.message}</p>
              <p>Your Plan and selected State are still in the form. Correct the Plan if needed, then try again.</p>
            </>
          )}
        </section>
      )}
    </section>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const requestInFlight = useRef(false);
  const hasReadTasks = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!hasReadTasks.current) setLoading(true);
    try {
      const response = await fetch('/api/v1/tasks', { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not refresh tasks.');
      setTasks(body.tasks);
      setError(false);
      setRefreshedAt(new Date());
      hasReadTasks.current = true;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/config').then(response => response.json()).then(value => { if (active) setConfig(value); }).catch(() => { if (active) setConfig(null); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Leesh Loop · Operator</p>
          <h1>Project work</h1>
          <p className="lede">Review current tasks and publish the next Plan in one place.</p>
        </div>
        <nav className="related-work" aria-label="Related work">
          <a href={config?.notionTasksUrl || '#'} target="_blank" rel="noreferrer">Notion Tasks ↗</a>
          <a href={config?.dashboardUrl || '#'} target="_blank" rel="noreferrer">Symphony Dashboard ↗</a>
        </nav>
      </header>
      <main className="work-layout">
        <TaskSurface tasks={tasks} loading={loading} error={error} refreshedAt={refreshedAt} onRetry={refresh} />
        {config ? <PublicationSurface config={config} /> : <section className="surface"><p className="empty-state">Loading Publisher configuration…</p></section>}
      </main>
      <footer className="page-footer"><span>Task and Plan details remain in Notion.</span><span>Runtime details remain in Symphony.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
