import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearPublicationDraft, readPublicationDraft, writePublicationDraft } from './publication-draft.js';
import { groupTasksForOperatorDisplay } from './operator-task-display-order.js';
import './style.css';

const REFRESH_INTERVAL_MS = 7500;
const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value);
const draftKey = (plan, state, selectedBlockers) => JSON.stringify({ plan, state, blockedBy: selectedBlockers.map(task => task.taskId) });

function TaskCard({ task, selected, selectionDisabled, onToggle }) {
  const title = task.title || '(Untitled)';
  return (
    <article className="task-row">
      <div className="task-row-primary">
        <div className="task-title-block">
          <h4><a href={task.taskUrl} target="_blank" rel="noreferrer" aria-label={`Open ${title} in Notion`}>{title}<span className="task-link-cue" aria-hidden="true">↗</span></a></h4>
          <p className="task-state" role="group" aria-label={`State: ${task.state}`}>{task.state}</p>
        </div>
      </div>

      <details className="task-details">
        <summary>Details and links</summary>
        <div className="task-details-content">
          <div className="task-blocker-action">
            <button
              type="button"
              className="text-button blocker-toggle"
              aria-label={`${selected ? 'Remove' : 'Use'} ${title} in State ${task.state} as a Blocked By task`}
              disabled={selectionDisabled}
              onClick={() => onToggle(task)}
            >
              {selected ? 'Remove from Blocked By' : 'Use as Blocked By'}
            </button>
          </div>
          {task.blockedBy.length > 0 && (
            <section className="blocker-section" aria-label={`Blockers for ${title}`}>
              <h5>Blocked By</h5>
              <ul className="blocker-list">
                {task.blockedBy.map(blocker => (
                  <li key={`${blocker.url}-${blocker.title}`}>
                    <a href={blocker.url} target="_blank" rel="noreferrer">{blocker.title}</a>
                    <span className="blocker-state">{blocker.state}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {task.blockedBy.length === 0 && <p className="quiet blocker-section">No blockers</p>}

          {(task.priority !== null || task.labels.length > 0) && (
            <div className="task-metadata" aria-label="Additional task details">
              {task.priority !== null && <span>Priority {task.priority}</span>}
              {task.labels.map(label => <span key={label}>{label}</span>)}
            </div>
          )}

          {task.planUrl && <div className="task-links"><a href={task.planUrl} target="_blank" rel="noreferrer">Open Accepted Plan ↗</a></div>}
        </div>
      </details>
    </article>
  );
}

function TaskSurface({ tasks, selectedBlockers, selectionDisabled, loading, error, refreshedAt, onRetry, onToggleBlocker }) {
  const selectedIds = new Set(selectedBlockers.map(task => task.taskId));
  const groups = groupTasksForOperatorDisplay(tasks);
  const otherCount = groups.remainingTasks.length;
  const taskGroup = (name, items, groupClass) => (
    <section className={`task-group ${groupClass}`} aria-labelledby={`${groupClass}-heading`}>
      <div className="task-group-heading">
        <h3 id={`${groupClass}-heading`}>{name}</h3>
        <span className="task-group-count" aria-label={`${items.length} tasks`}>{items.length}</span>
      </div>
      {items.length ? (
        <div className="task-list">
          {items.map(task => <TaskCard key={task.taskId || task.taskUrl} task={task} selected={selectedIds.has(task.taskId)} selectionDisabled={selectionDisabled} onToggle={onToggleBlocker} />)}
        </div>
      ) : <p className="group-empty">No tasks</p>}
    </section>
  );

  return (
    <section className="task-surface" aria-labelledby="tasks-heading" aria-busy={loading && !refreshedAt}>
      <div className="surface-header">
        <div>
          <h2 id="tasks-heading">Tasks</h2>
        </div>
        <div className="task-surface-meta">
          <span className="task-total">{tasks.length} tasks</span>
          <p className="refresh-meta" aria-live="polite">
            {loading && !refreshedAt ? 'Loading tasks' : refreshedAt ? `Updated ${formatTime(refreshedAt)}` : ''}
          </p>
        </div>
      </div>
      {selectedBlockers.length > 0 && (
        <p className="selection-count" aria-live="polite">{selectedBlockers.length} blocker{selectedBlockers.length === 1 ? '' : 's'} selected for this Plan</p>
      )}
      {error && (
        <div className="refresh-error" role="status">
          <p><strong>Refresh failed.</strong> Showing the last successful task read{refreshedAt ? ` from ${formatTime(refreshedAt)}` : ''}. The Operator will retry automatically.</p>
          {!refreshedAt && <button type="button" className="text-button" onClick={onRetry}>Try again</button>}
        </div>
      )}
      {!refreshedAt && loading ? <p className="empty-state">Reading the current task list…</p> : null}
      {!loading && !error && tasks.length === 0 ? <p className="empty-state">There are no current tasks.</p> : null}
      {tasks.length > 0 && (
        <div className="task-groups">
          {groups.humanReview.length > 0 && taskGroup('Needs your review', groups.humanReview, 'review-work')}
          {groups.activeWork.length > 0 && taskGroup('Active work', groups.activeWork, 'active-work')}
          <details className="remaining-tasks">
            <summary><span className="remaining-tasks-label"><span className="disclosure-indicator" aria-hidden="true" />Other tasks</span><span className="task-group-count" aria-label={`${otherCount} tasks`}>{otherCount}</span></summary>
            {groups.remainingTasks.length ? (
              <div className="task-list">
                {groups.remainingTasks.map(task => <TaskCard key={task.taskId || task.taskUrl} task={task} selected={selectedIds.has(task.taskId)} selectionDisabled={selectionDisabled} onToggle={onToggleBlocker} />)}
              </div>
            ) : <p className="group-empty">No other tasks</p>}
          </details>
        </div>
      )}
    </section>
  );
}

function PublicationSurface({ config, plan, state, selectedBlockers, publishing, setPublishing, onDraftChange, onRemoveBlocker, onReset }) {
  const [result, setResult] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const currentKey = draftKey(plan, state, selectedBlockers);
    if (result?.kind === 'success' && result.draftKey === currentKey) clearPublicationDraft();
    else writePublicationDraft({ plan, state, selectedBlockers });
  }, [plan, state, selectedBlockers, result]);

  async function submit(event) {
    event.preventDefault();
    setPublishing(true);
    setResult(null);
    const submittedBlockers = [...selectedBlockers];
    writePublicationDraft({ plan, state, selectedBlockers: submittedBlockers });
    try {
      const response = await fetch('/api/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, state, blockedBy: submittedBlockers.map(task => task.taskId) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Publishing failed.');
      setResult({ kind: 'success', ...body, blockers: submittedBlockers, draftKey: draftKey(plan, state, submittedBlockers) });
      clearPublicationDraft();
    } catch (error) {
      setResult({ kind: 'failure', message: error.message || 'Publishing failed.' });
    } finally {
      setPublishing(false);
    }
  }

  function reset() {
    setResult(null);
    onReset();
  }

  return (
    <details className="surface publication-surface" onToggle={event => setFormOpen(event.currentTarget.open)}>
      <summary className="publication-summary">
        <div>
          <h2 id="publish-heading">Publish a Plan</h2>
        </div>
        <span className="publication-hint">{formOpen ? 'Close form' : 'Open form'}</span>
      </summary>
      <div className="publication-content">
      <form onSubmit={submit}>
        <div className="plan-field">
          <label htmlFor="plan">1. Review the Plan</label>
          <textarea id="plan" name="plan" value={plan} onChange={event => onDraftChange({ plan: event.target.value })} spellCheck="false" aria-label="Plan Markdown" disabled={publishing} />
        </div>
        <section className="publication-blockers" aria-labelledby="publication-blockers-heading">
          <div className="context-heading">
            <h3 id="publication-blockers-heading">2. Confirm Blocked By</h3>
            <p className="field-help">Selected tasks become this Plan’s Blocked By relation.</p>
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
            <select id="state" name="state" value={state} onChange={event => onDraftChange({ state: event.target.value })} disabled={publishing}>
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
      </div>
    </details>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [draft, setDraft] = useState(() => readPublicationDraft());
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const requestInFlight = useRef(false);
  const hasReadTasks = useRef(false);
  const { plan, state, selectedBlockers } = draft;

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!hasReadTasks.current) setLoading(true);
    try {
      const response = await fetch('/api/v1/tasks', { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not refresh tasks.');
      setTasks(body.tasks);
      setDraft(current => {
        const available = new Map(body.tasks.map(task => [task.taskId, task]));
        const refreshed = current.selectedBlockers.map(selected => {
          const task = available.get(selected.taskId);
          return task ? { taskId: task.taskId, title: task.title, state: task.state, identifier: task.identifier } : selected;
        });
        const unchanged = refreshed.every((task, index) => task.taskId === current.selectedBlockers[index].taskId
          && task.title === current.selectedBlockers[index].title
          && task.state === current.selectedBlockers[index].state
          && task.identifier === current.selectedBlockers[index].identifier);
        if (unchanged) return current;
        return { ...current, selectedBlockers: refreshed };
      });
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

  useEffect(() => {
    if (config?.githubRepositoryName) document.title = `${config.githubRepositoryName} · Loop`;
  }, [config?.githubRepositoryName]);

  function toggleBlocker(task) {
    setDraft(current => {
      const selectedBlockers = current.selectedBlockers.some(selected => selected.taskId === task.taskId)
        ? current.selectedBlockers.filter(selected => selected.taskId !== task.taskId)
        : [...current.selectedBlockers, { taskId: task.taskId, title: task.title, state: task.state, identifier: task.identifier }];
      return { ...current, selectedBlockers };
    });
  }

  function removeBlocker(taskId) {
    setDraft(current => {
      return { ...current, selectedBlockers: current.selectedBlockers.filter(task => task.taskId !== taskId) };
    });
  }

  function updateDraft(values) {
    setDraft(current => {
      return { ...current, ...values };
    });
  }

  function resetDraft() {
    const emptyDraft = { plan: '', state: '', selectedBlockers: [] };
    clearPublicationDraft();
    setDraft(emptyDraft);
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="project-identity">
          <h1>{config?.githubRepositoryName || 'Project work'}</h1>
        </div>
        <nav className="related-work" aria-label="Project navigation">
          {config?.githubBrowserRepositoryUrl && <a href={config.githubBrowserRepositoryUrl} target="_blank" rel="noreferrer">GitHub repository ↗</a>}
          {config?.notionTasksUrl && <a href={config.notionTasksUrl} target="_blank" rel="noreferrer">Notion Tasks ↗</a>}
          {config?.dashboardUrl && <a className="runtime-details" href={config.dashboardUrl} target="_blank" rel="noreferrer">Runtime details ↗</a>}
        </nav>
      </header>
      <main className="work-layout">
        <TaskSurface tasks={tasks} selectedBlockers={selectedBlockers} selectionDisabled={publishing} loading={loading} error={error} refreshedAt={refreshedAt} onRetry={refresh} onToggleBlocker={toggleBlocker} />
        {config ? (
          <PublicationSurface
            config={config}
            plan={plan}
            state={state}
            selectedBlockers={selectedBlockers}
            publishing={publishing}
            setPublishing={setPublishing}
            onDraftChange={updateDraft}
            onRemoveBlocker={removeBlocker}
            onReset={resetDraft}
          />
        ) : <section className="surface"><p className="empty-state">Loading Publisher configuration…</p></section>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
