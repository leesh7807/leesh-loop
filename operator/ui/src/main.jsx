import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const REFRESH_INTERVAL_MS = 7500;
const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value);

function TaskCard({ task, selected, selectionDisabled, onToggle }) {
  return (
    <article className={`task-card${selected ? ' selected-blocker' : ''}`}>
      <div className="task-heading">
        <div className="task-title-block">
          <h3>{task.title || '(Untitled)'}</h3>
          {task.identifier && <p className="task-identifier">{task.identifier}</p>}
        </div>
        <div className="task-actions">
          <div className="task-state"><span className="meta-label">State</span><strong>{task.state}</strong></div>
          <label className="blocker-choice">
            <input
              type="checkbox"
              checked={selected}
              disabled={selectionDisabled}
              onChange={() => onToggle(task)}
              aria-label={`Use ${task.title || '(Untitled)'} in State ${task.state} as a Blocked By task`}
            />
            <span>{selected ? 'Selected as blocker' : 'Use as Blocked By'}</span>
          </label>
        </div>
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

function TaskSurface({ tasks, selectedBlockers, selectionDisabled, loading, error, refreshedAt, onRetry, onToggleBlocker }) {
  const selectedIds = new Set(selectedBlockers.map(task => task.taskId));
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
      <p className="task-help">Choose one or more existing tasks here. Their title and State stay visible while you add them to this Plan’s publication context.</p>
      <p className="selection-count" aria-live="polite">{selectedBlockers.length ? `${selectedBlockers.length} blocker${selectedBlockers.length === 1 ? '' : 's'} selected for this Plan` : 'No blockers selected'}</p>
      {error && (
        <div className="refresh-error" role="status">
          <p><strong>Refresh failed.</strong> Showing the last successful task read{refreshedAt ? ` from ${formatTime(refreshedAt)}` : ''}. The Operator will retry automatically.</p>
          {!refreshedAt && <button type="button" className="text-button" onClick={onRetry}>Try again</button>}
        </div>
      )}
      {!refreshedAt && loading ? <p className="empty-state">Reading the current task list…</p> : null}
      {!loading && !error && tasks.length === 0 ? <p className="empty-state">There are no current tasks.</p> : null}
      {tasks.length > 0 && (
        <div className="task-list">
          {tasks.map(task => <TaskCard key={task.taskId || task.taskUrl} task={task} selected={selectedIds.has(task.taskId)} selectionDisabled={selectionDisabled} onToggle={onToggleBlocker} />)}
        </div>
      )}
    </section>
  );
}

function PublicationSurface({ config, selectedBlockers, publishing, setPublishing, onRemoveBlocker, onReset }) {
  const [plan, setPlan] = useState('');
  const [state, setState] = useState('');
  const [result, setResult] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setPublishing(true);
    setResult(null);
    const submittedBlockers = [...selectedBlockers];
    try {
      const response = await fetch('/api/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, state, blockedBy: submittedBlockers.map(task => task.taskId) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Publishing failed.');
      setResult({ kind: 'success', ...body, blockers: submittedBlockers });
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
    onReset();
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
          <textarea id="plan" name="plan" value={plan} onChange={event => setPlan(event.target.value)} spellCheck="false" aria-label="Plan Markdown" disabled={publishing} />
        </div>
        <section className="publication-blockers" aria-labelledby="publication-blockers-heading">
          <div className="context-heading">
            <h3 id="publication-blockers-heading">2. Confirm Blocked By</h3>
            <p className="field-help">Selected from the current Tasks list; included when this Plan is published.</p>
          </div>
          {selectedBlockers.length ? (
            <ul className="selected-blockers">
              {selectedBlockers.map(task => (
                <li key={task.taskId}>
                  <span className="selected-task-name">{task.title || '(Untitled)'}</span>
                  <span className="selected-task-state">State: {task.state}</span>
                  <button type="button" className="remove-blocker" onClick={() => onRemoveBlocker(task.taskId)} disabled={publishing} aria-label={`Remove ${task.title || '(Untitled)'} from Blocked By`}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className="no-selected-blockers">No blockers selected. This Plan will publish without a Blocked By relation.</p>}
        </section>
        <div className="publish-decision">
          <div>
            <label htmlFor="state">3. Choose publication State</label>
            <select id="state" name="state" value={state} onChange={event => setState(event.target.value)} disabled={publishing}>
              <option value="">Publisher default ({config.defaultState})</option>
              {config.states.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
            <p className="field-help">State choices come from the current Publisher configuration.</p>
          </div>
          <button type="submit" disabled={publishing} aria-busy={publishing}>{publishing ? 'Publishing…' : '4. Publish Plan'}</button>
        </div>
      </form>

      {result && (
        <section className={`publication-result ${result.kind}`} role={result.kind === 'success' ? 'status' : 'alert'} aria-labelledby="result-heading">
          <p className="eyebrow">5. Publication result</p>
          <h3 id="result-heading">{result.kind === 'success' ? 'Plan published' : 'Publish failed'}</h3>
          {result.kind === 'success' ? (
            <>
              <p>Task <code>{result.identifier}</code> was published with State <strong>{result.state}</strong>.</p>
              {result.blockers.length ? (
                <div className="published-blockers">
                  <p><strong>Blocked By</strong></p>
                  <ul>{result.blockers.map(task => <li key={task.taskId}>{task.title || '(Untitled)'} <span>({task.state})</span></li>)}</ul>
                </div>
              ) : <p>This task was published without blockers.</p>}
              {result.url && <a href={result.url} target="_blank" rel="noreferrer">Open published task in Notion ↗</a>}
              <button className="text-button" type="button" onClick={reset}>Publish another Plan</button>
            </>
          ) : (
            <>
              <p className="error-detail">{result.message}</p>
              <p>Your Plan, publication State, and selected Blocked By tasks are still in the form. Correct the input if needed, then retry.</p>
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
  const [selectedBlockers, setSelectedBlockers] = useState([]);
  const [publishing, setPublishing] = useState(false);
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

  function toggleBlocker(task) {
    setSelectedBlockers(current => current.some(selected => selected.taskId === task.taskId)
      ? current.filter(selected => selected.taskId !== task.taskId)
      : [...current, task]);
  }

  function removeBlocker(taskId) {
    setSelectedBlockers(current => current.filter(task => task.taskId !== taskId));
  }

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
        <TaskSurface tasks={tasks} selectedBlockers={selectedBlockers} selectionDisabled={publishing} loading={loading} error={error} refreshedAt={refreshedAt} onRetry={refresh} onToggleBlocker={toggleBlocker} />
        {config ? (
          <PublicationSurface
            config={config}
            selectedBlockers={selectedBlockers}
            publishing={publishing}
            setPublishing={setPublishing}
            onRemoveBlocker={removeBlocker}
            onReset={() => setSelectedBlockers([])}
          />
        ) : <section className="surface"><p className="empty-state">Loading Publisher configuration…</p></section>}
      </main>
      <footer className="page-footer"><span>Task and Plan details remain in Notion.</span><span>Runtime details remain in Symphony.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
