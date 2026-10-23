import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearPublicationDraft, readPublicationDraft, writePublicationDraft } from './publication-draft.js';
import { groupTasksForOperatorDisplay } from './operator-task-display-order.js';
import { readTaskDetailDraft } from './task-detail-draft.js';
import './style.css';

const REFRESH_INTERVAL_MS = 7500;
const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value);
const taskUrl = id => `/api/v1/tasks/${encodeURIComponent(id)}`;
const taskDraftKey = id => `leesh-loop.operator.task-draft.v1:${id}`;

async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function TaskCard({ task, selected, onSelect }) {
  return (
    <article className={`task-row${selected ? ' selected' : ''}`}>
      <button type="button" className="task-open" onClick={() => onSelect(task.id)} aria-current={selected ? 'page' : undefined}>
        <span className="task-open-title">{task.title || '(Untitled)'}</span>
        <span className="task-open-state">{task.state}</span>
      </button>
      <p className="task-identifier">{task.identifier}</p>
      {task.blockedBy.length > 0 && <BlockerSummary blockers={task.blockedBy} />}
      <div className="task-metadata">
        {task.priority !== null && <span>Priority {task.priority}</span>}
        {task.labels.map(label => <span key={label}>{label}</span>)}
      </div>
    </article>
  );
}

function BlockerSummary({ blockers }) {
  const visibleBlockers = blockers.slice(0, 2);
  const remainingBlockers = blockers.slice(visibleBlockers.length);
  return (
    <div className="task-blockers">
      <span className="task-blockers-count">Blocked by {blockers.length}</span>
      <ul className="task-blocker-preview">
        {visibleBlockers.map(blocker => <li key={blocker.taskId || blocker.id}>{blocker.title} · {blocker.state}</li>)}
      </ul>
      {remainingBlockers.length > 0 && (
        <details className="all-blockers">
          <summary>Show {remainingBlockers.length} more {remainingBlockers.length === 1 ? 'blocker' : 'blockers'}</summary>
          <ul>{remainingBlockers.map(blocker => <li key={blocker.taskId || blocker.id}>{blocker.title} · {blocker.state}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function BlockerOptions({ tasks, selectedItems, onToggle, disabled }) {
  const [query, setQuery] = useState('');
  const selectedIds = new Set(selectedItems.map(item => item.id));
  const normalizedQuery = query.trim().toLowerCase();
  const matchingTasks = tasks.filter(task => !normalizedQuery || [task.title, task.identifier, task.state]
    .some(value => String(value || '').toLowerCase().includes(normalizedQuery)));

  return (
    <>
      <label className="blocker-search">
        <span>Find a task by title, identifier, or State</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />
      </label>
      {matchingTasks.length ? (
        <div className="blocker-options">
          {matchingTasks.map(task => (
            <label className="blocker-option" key={task.id}>
              <input type="checkbox" checked={selectedIds.has(task.id)} disabled={disabled} onChange={() => onToggle(task)} />
              <span>{task.title} <small>{task.identifier} · {task.state}</small></span>
            </label>
          ))}
        </div>
      ) : <p className="quiet">No tasks match this search.</p>}
      {selectedItems.length > 0 && (
        <details className="selected-blockers">
          <summary>Review selected blockers · {selectedItems.length}</summary>
          <ul>
            {selectedItems.map(item => (
              <li key={item.id}>
                <span>{item.title} <small>{item.identifier} · {item.state}</small></span>
                <button type="button" className="text-button" onClick={() => onToggle(item)} disabled={disabled}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function TaskSurface({ tasks, selectedTaskId, loading, error, refreshedAt, onRetry, onSelect }) {
  const groups = groupTasksForOperatorDisplay(tasks);
  const taskGroup = (name, items, groupClass) => (
    <section className={`task-group ${groupClass}`} aria-labelledby={`${groupClass}-heading`}>
      <div className="task-group-heading">
        <h3 id={`${groupClass}-heading`}>{name}</h3>
        <span className="task-group-count">{items.length}</span>
      </div>
      {items.length ? (
        <div className="task-list">
          {items.map(task => <TaskCard key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} />)}
        </div>
      ) : <p className="group-empty">No tasks</p>}
    </section>
  );
  const otherCount = groups.remainingTasks.length;

  return (
    <aside className="task-surface" aria-labelledby="tasks-heading" aria-busy={loading && !refreshedAt}>
      <div className="surface-header">
        <div><p className="eyebrow">Work queue</p><h2 id="tasks-heading">Tasks</h2></div>
        <div className="task-surface-meta">
          <span className="task-total">{tasks.length}</span>
          <button type="button" className="quiet-button" onClick={onRetry} disabled={loading}>Refresh</button>
        </div>
      </div>
      <p className="refresh-meta" aria-live="polite">
        {loading && !refreshedAt ? 'Loading tasks' : refreshedAt ? `Updated ${formatTime(refreshedAt)}` : ''}
      </p>
      {error && (
        <div className="inline-message failure" role="status">
          <strong>Refresh failed.</strong> Showing the last successful task read{refreshedAt ? ` from ${formatTime(refreshedAt)}` : ''}.
          {!refreshedAt && <button type="button" className="text-button" onClick={onRetry}>Try again</button>}
        </div>
      )}
      {!refreshedAt && loading && <p className="empty-state">Reading the current task list…</p>}
      {!loading && !error && tasks.length === 0 && <p className="empty-state">There are no tasks yet. Publish the first Accepted Plan.</p>}
      {tasks.length > 0 && (
        <div className="task-groups">
          {groups.humanReview.length > 0 && taskGroup('Human Review', groups.humanReview, 'review-work')}
          {groups.activeWork.length > 0 && taskGroup('In progress', groups.activeWork, 'active-work')}
          <details className="remaining-tasks">
            <summary><span>Other tasks</span><span className="task-group-count">{otherCount}</span></summary>
            {groups.remainingTasks.length
              ? <div className="task-list">{groups.remainingTasks.map(task => <TaskCard key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} />)}</div>
              : <p className="group-empty">No other tasks</p>}
          </details>
        </div>
      )}
    </aside>
  );
}

function PublicationSurface({ config, plan, state, selectedBlockers, publishing, onDraftChange, onReset, onPublished }) {
  const [result, setResult] = useState(null);
  const submitInFlight = useRef(false);

  useEffect(() => {
    const current = { plan, state, selectedBlockers };
    if (result?.kind === 'success') clearPublicationDraft();
    else writePublicationDraft(current);
  }, [plan, state, selectedBlockers, result]);

  async function submit(event) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setResult(null);
    const submittedBlockers = [...selectedBlockers];
    writePublicationDraft({ plan, state, selectedBlockers: submittedBlockers });
    onDraftChange({ publishing: true });
    try {
      const response = await fetch('/api/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, state, blockedBy: submittedBlockers.map(task => task.taskId) })
      });
      const body = await responseJson(response);
      setResult({ kind: 'success', ...body, blockers: submittedBlockers });
      clearPublicationDraft();
      onPublished(body);
    } catch (error) {
      setResult({ kind: 'failure', message: error.message || 'Publishing failed.' });
    } finally {
      submitInFlight.current = false;
      onDraftChange({ publishing: false });
    }
  }

  function reset() {
    setResult(null);
    onReset();
  }

  return (
    <section className="work-panel publication-panel" aria-labelledby="publish-heading">
      <p className="eyebrow">New task</p>
      <h2 id="publish-heading">Publish a Plan</h2>
      <p className="panel-intro">Paste the Accepted Plan. The Local Publisher creates the task and keeps this copy unchanged.</p>
      <form onSubmit={submit}>
        <div className="plan-field">
          <label htmlFor="plan">Accepted Plan</label>
          <textarea id="plan" name="plan" value={plan} onChange={event => onDraftChange({ plan: event.target.value })} spellCheck="false" aria-label="Accepted Plan Markdown" disabled={publishing} required />
        </div>
        <fieldset className="form-section">
          <legend>Blocked By</legend>
          <p className="field-help">Choose tasks that must finish before this task can run.</p>
          {config.tasks.length ? (
            <BlockerOptions
              tasks={config.tasks}
              selectedItems={selectedBlockers.map(value => ({ id: value.taskId, title: value.title, identifier: value.identifier, state: value.state }))}
              onToggle={task => onDraftChange({ togglePublishBlocker: task })}
              disabled={publishing}
            />
          ) : <p className="quiet">No existing tasks to select.</p>}
        </fieldset>
        <div className="publish-controls">
          <div>
            <label htmlFor="publish-state">State</label>
            <select id="publish-state" value={state} onChange={event => onDraftChange({ state: event.target.value })} disabled={publishing}>
              {config.states.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
          </div>
          <button type="submit" className="primary-action" disabled={publishing || !plan.trim()} aria-busy={publishing}>{publishing ? 'Publishing…' : 'Publish Accepted Plan'}</button>
        </div>
      </form>
      {result && (
        <section className={`publication-result ${result.kind}`} role={result.kind === 'success' ? 'status' : 'alert'} aria-labelledby="publication-result-heading">
          <p className="eyebrow">Publication result</p>
          <h3 id="publication-result-heading">{result.kind === 'success' ? 'Plan published' : 'Publish failed'}</h3>
          {result.kind === 'success' ? (
            <>
              <p><code>{result.identifier}</code> · <strong>{result.state}</strong></p>
              <p>Task ID <code>{result.page_id}</code> was saved. Its detail is open.</p>
              <button className="text-button" type="button" onClick={reset}>Publish another Plan</button>
            </>
          ) : (
            <>
              <p className="error-detail">{result.message}</p>
              <p>Your Plan, State, and Blocked By choices remain in the form. Review the input before retrying.</p>
            </>
          )}
        </section>
      )}
    </section>
  );
}

function TaskDetail({ config, taskId, publicationReceipt, onBackToPublish, onTaskChanged, onTaskListRefresh }) {
  const [task, setTask] = useState(null);
  const [workpad, setWorkpad] = useState([]);
  const [comments, setComments] = useState([]);
  const [stateDraft, setStateDraft] = useState('');
  const [blockerDraft, setBlockerDraft] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState('');
  const [saving, setSaving] = useState('');
  const [stateFeedback, setStateFeedback] = useState(null);
  const [blockerFeedback, setBlockerFeedback] = useState(null);
  const [commentFeedback, setCommentFeedback] = useState(null);
  const taskRef = useRef(null);
  const refreshVersion = useRef(0);
  const mutationInFlight = useRef(false);
  const detailLoaded = useRef(false);

  const refresh = useCallback(async () => {
    const requestVersion = ++refreshVersion.current;
    try {
      const response = await fetch(taskUrl(taskId), { headers: { accept: 'application/json' } });
      const body = await responseJson(response);
      if (requestVersion !== refreshVersion.current) return;
      const firstRead = !detailLoaded.current;
      const previousTask = taskRef.current;
      if (previousTask && previousTask.state !== body.task.state) {
        setStateDraft(current => current === previousTask.state ? body.task.state : current);
        setStateFeedback(current => current?.kind === 'success' && current.savedState !== body.task.state ? null : current);
      }
      taskRef.current = body.task;
      setTask(body.task);
      setWorkpad(body.workpad);
      setComments(body.comments);
      setRefreshError('');
      if (firstRead) {
        const draft = readTaskDetailDraft(body.task);
        setStateDraft(draft.state);
        setBlockerDraft(draft.blockedBy);
      }
      detailLoaded.current = true;
    } catch (error) {
      if (requestVersion !== refreshVersion.current) return;
      setRefreshError(error.message || 'Task detail could not be refreshed.');
      if (!detailLoaded.current) setTask(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    detailLoaded.current = false;
    setTask(null);
    setWorkpad([]);
    setComments([]);
    setStateDraft('');
    setBlockerDraft([]);
    setCommentDraft('');
    setStateFeedback(null);
    setBlockerFeedback(null);
    setCommentFeedback(null);
    taskRef.current = null;
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function saveState(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    refreshVersion.current += 1;
    setSaving('state');
    setStateFeedback(null);
    try {
      const response = await fetch(`${taskUrl(taskId)}/state`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: stateDraft })
      });
      const body = await responseJson(response);
      taskRef.current = body.task;
      setTask(body.task);
      setStateDraft(body.task.state);
      setStateFeedback({ kind: 'success', savedState: body.task.state, text: `Saved as ${body.task.state}.` });
      onTaskChanged(body.task);
      onTaskListRefresh();
    } catch (error) {
      setStateFeedback({ kind: 'failure', text: error.message || 'State could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      refreshVersion.current += 1;
      setSaving('');
    }
  }

  async function saveBlockers(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    refreshVersion.current += 1;
    setSaving('blockers');
    setBlockerFeedback(null);
    try {
      const response = await fetch(`${taskUrl(taskId)}/blocked-by`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blockedBy: blockerDraft })
      });
      const body = await responseJson(response);
      taskRef.current = body.task;
      setTask(body.task);
      setBlockerDraft(body.task.blockedBy);
      setBlockerFeedback({ kind: 'success', text: 'Blocked By saved.' });
      onTaskChanged(body.task);
      onTaskListRefresh();
    } catch (error) {
      setBlockerFeedback({ kind: 'failure', text: error.message || 'Blocked By could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      refreshVersion.current += 1;
      setSaving('');
    }
  }

  async function addComment(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    refreshVersion.current += 1;
    setSaving('comment');
    setCommentFeedback(null);
    try {
      const response = await fetch(`${taskUrl(taskId)}/comments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: commentDraft })
      });
      const body = await responseJson(response);
      setComments(current => [...current, body.comment]);
      setCommentDraft('');
      setCommentFeedback({ kind: 'success', text: 'Comment saved.' });
      onTaskListRefresh();
    } catch (error) {
      setCommentFeedback({ kind: 'failure', text: error.message || 'Comment could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      refreshVersion.current += 1;
      setSaving('');
    }
  }

  if (loading && !task) return <section className="work-panel" aria-busy="true"><p className="empty-state">Loading task detail…</p></section>;
  if (!task) return <section className="work-panel"><button type="button" className="text-button" onClick={onBackToPublish}>Back to Plan publication</button><p className="inline-message failure" role="alert">{refreshError || 'Task detail is unavailable.'}</p><button type="button" className="text-button" onClick={refresh}>Try again</button></section>;

  const availableBlockers = config.tasks.filter(value => value.id !== taskId);
  const selectedBlockerItems = blockerDraft.map(id => availableBlockers.find(value => value.id === id)
    || { id, title: id, identifier: id, state: 'Unavailable' });
  const stateOptions = config.states.includes(task.state) ? config.states : [task.state, ...config.states];

  return (
    <section className="work-panel detail-panel" aria-labelledby="task-detail-heading">
      <div className="detail-topline">
        <button type="button" className="text-button" onClick={onBackToPublish}>Publish a Plan</button>
        <span className="detail-identifier">{task.identifier}</span>
      </div>
      <h2 id="task-detail-heading">{task.title}</h2>
      <form className="state-toolbar" onSubmit={saveState} aria-label="Change task State">
        <p className="current-state"><span>Saved State</span><strong>{task.state}</strong></p>
        <div className="state-controls">
          <label htmlFor="next-state">Choose next State</label>
          <select id="next-state" value={stateDraft} onChange={event => { setStateDraft(event.target.value); setStateFeedback(null); }} disabled={Boolean(saving)}>
            {stateOptions.map(value => <option value={value} key={value}>{value}</option>)}
          </select>
          <button type="submit" className="primary-action" disabled={Boolean(saving) || !stateDraft || stateDraft === task.state} aria-busy={saving === 'state'}>{saving === 'state' ? 'Saving…' : 'Save State'}</button>
        </div>
        {stateFeedback && <p className={`action-feedback ${stateFeedback.kind}`} role={stateFeedback.kind === 'failure' ? 'alert' : 'status'}>{stateFeedback.text}</p>}
      </form>
      {publicationReceipt?.page_id === taskId && (
        <div className="publication-receipt" role="status">
          <span>Published</span>
          <code>{publicationReceipt.identifier}</code>
          <span>· Created in {publicationReceipt.state}</span>
          <span>· Task ID <code>{publicationReceipt.page_id}</code></span>
          <p>The task below reflects its latest saved State. Its Accepted Plan is preserved below.</p>
        </div>
      )}
      {refreshError && <p className="inline-message failure" role="status">Refresh failed. Showing the last successful detail. {refreshError}</p>}

      <details className="detail-section accepted-plan-section" aria-labelledby="accepted-plan-heading">
        <summary className="section-title">
          <span className="section-title-copy"><span className="eyebrow">Original input</span><h3 id="accepted-plan-heading">Accepted Plan</h3></span>
          <span className="disclosure-hint">View original</span>
        </summary>
        <pre className="long-text">{task.acceptedPlan}</pre>
      </details>

      <section className="detail-section" aria-labelledby="workpad-heading">
        <div className="section-title"><p className="eyebrow">Worker record</p><h3 id="workpad-heading">Workpad</h3></div>
        {workpad.length ? (
          <ol className="record-list">{workpad.map(record => <li key={record.id}><p className="record-meta">{record.author} · {record.createdAt}</p><pre className="long-text">{record.content}</pre></li>)}</ol>
        ) : <p className="quiet">No Workpad entries yet.</p>}
      </section>

      <section className="detail-section" aria-labelledby="comments-heading">
        <div className="section-title"><p className="eyebrow">Human input</p><h3 id="comments-heading">Comments</h3></div>
        {comments.length ? (
          <ol className="record-list comment-list">
            {comments.map(comment => (
              <li key={comment.id}>
                <p className="record-meta">
                  <span>{comment.author} · {comment.createdAt}</span>
                  <code>{comment.id}</code>
                </p>
                <pre className="long-text">{comment.content}</pre>
              </li>
            ))}
          </ol>
        ) : <p className="quiet">No comments yet.</p>}
        <form className="comment-form" onSubmit={addComment}>
          <label htmlFor="comment">Add a comment</label>
          <textarea id="comment" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} disabled={Boolean(saving)} required />
          <button type="submit" disabled={Boolean(saving) || !commentDraft.trim()}>{saving === 'comment' ? 'Saving…' : 'Add comment'}</button>
          {commentFeedback && <p className={`action-feedback ${commentFeedback.kind}`} role={commentFeedback.kind === 'failure' ? 'alert' : 'status'}>{commentFeedback.text}</p>}
        </form>
      </section>

      <section className="detail-section management-section" aria-labelledby="manage-task-heading">
        <div className="section-title"><p className="eyebrow">Next action</p><h3 id="manage-task-heading">Manage task</h3></div>
        <form className="management-form" onSubmit={saveBlockers}>
          <span className="field-label">Blocked By</span>
          {availableBlockers.length || selectedBlockerItems.length ? (
            <BlockerOptions
              tasks={availableBlockers}
              selectedItems={selectedBlockerItems}
              onToggle={value => setBlockerDraft(current => current.includes(value.id) ? current.filter(id => id !== value.id) : [...current, value.id])}
              disabled={Boolean(saving)}
            />
          ) : <p className="quiet">No other tasks are available as blockers.</p>}
          <button type="submit" disabled={Boolean(saving)}>{saving === 'blockers' ? 'Saving…' : 'Save Blocked By'}</button>
          {blockerFeedback && <p className={`action-feedback ${blockerFeedback.kind}`} role={blockerFeedback.kind === 'failure' ? 'alert' : 'status'}>{blockerFeedback.text}</p>}
        </form>
      </section>
    </section>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [publicationReceipt, setPublicationReceipt] = useState(null);
  const [draft, setDraft] = useState(() => readPublicationDraft());
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const requestInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const taskListVersion = useRef(0);
  const hasReadTasks = useRef(false);
  const { plan, state, selectedBlockers } = draft;

  const refresh = useCallback(async () => {
    if (requestInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    requestInFlight.current = true;
    const requestVersion = taskListVersion.current;
    if (!hasReadTasks.current) setLoading(true);
    try {
      const response = await fetch('/api/v1/tasks', { headers: { accept: 'application/json' } });
      const body = await responseJson(response);
      if (requestVersion !== taskListVersion.current) {
        refreshQueued.current = true;
        return;
      }
      setTasks(body.tasks);
      setDraft(current => {
        const available = new Map(body.tasks.map(task => [task.id, task]));
        const refreshed = current.selectedBlockers.map(selected => {
          const task = available.get(selected.taskId);
          return task ? { taskId: task.id, title: task.title, state: task.state, identifier: task.identifier } : selected;
        });
        const unchanged = refreshed.every((task, index) => task.taskId === current.selectedBlockers[index].taskId
          && task.title === current.selectedBlockers[index].title
          && task.state === current.selectedBlockers[index].state
          && task.identifier === current.selectedBlockers[index].identifier);
        return unchanged ? current : { ...current, selectedBlockers: refreshed };
      });
      setError(false);
      setRefreshedAt(new Date());
      hasReadTasks.current = true;
    } catch {
      if (requestVersion === taskListVersion.current) setError(true);
    } finally {
      setLoading(false);
      requestInFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/config').then(responseJson).then(value => { if (active) setConfig(value); }).catch(() => { if (active) setConfig(null); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (config?.githubRepositoryName) document.title = `${config.githubRepositoryName} · Loop`;
  }, [config?.githubRepositoryName]);

  function updateDraft(values) {
    setDraft(current => {
      if (values.togglePublishBlocker) {
        const task = values.togglePublishBlocker;
        const selectedBlockers = current.selectedBlockers.some(value => value.taskId === task.id)
          ? current.selectedBlockers.filter(value => value.taskId !== task.id)
          : [...current.selectedBlockers, { taskId: task.id, title: task.title, state: task.state, identifier: task.identifier }];
        return { ...current, selectedBlockers };
      }
      return { ...current, ...values };
    });
  }

  function openTask(id) {
    window.scrollTo(0, 0);
    setSelectedTaskId(id);
  }
  function openPublishedTask(publication) {
    taskListVersion.current += 1;
    resetDraft();
    setPublicationReceipt(publication);
    openTask(publication.page_id);
    void refresh();
  }
  function returnToPublication() {
    window.scrollTo(0, 0);
    setSelectedTaskId(null);
  }
  function resetDraft() {
    const emptyDraft = { plan: '', state: config?.defaultState || 'Ready', selectedBlockers: [] };
    clearPublicationDraft();
    setDraft(emptyDraft);
  }
  function handleTaskChanged(task) {
    taskListVersion.current += 1;
    setTasks(current => current.map(value => value.id === task.id ? { ...value, state: task.state, blockedBy: task.blockedBy.map(id => {
      const blocker = current.find(entry => entry.id === id);
      return blocker ? { taskId: id, identifier: blocker.identifier, title: blocker.title, state: blocker.state } : { taskId: id, identifier: id, title: id, state: 'Unavailable' };
    }) } : value));
  }

  if (!config) return <main className="page-shell"><p className="inline-message failure" role="alert">The Operator configuration could not be loaded. Refresh the page to retry.</p></main>;
  const publishDraft = { plan, state: state || config.defaultState, selectedBlockers };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="project-identity"><p className="eyebrow">Local Task Store</p><h1>{config.githubRepositoryName || 'Project work'}</h1></div>
        <nav className="related-work" aria-label="Project links">
          {config.githubBrowserRepositoryUrl && <a href={config.githubBrowserRepositoryUrl} target="_blank" rel="noreferrer">GitHub repository ↗</a>}
        </nav>
      </header>
      <main className="work-layout">
        <TaskSurface tasks={tasks} selectedTaskId={selectedTaskId} loading={loading} error={error} refreshedAt={refreshedAt} onRetry={refresh} onSelect={openTask} />
        {selectedTaskId ? (
          <TaskDetail
            key={selectedTaskId}
            config={{ ...config, tasks }}
            taskId={selectedTaskId}
            publicationReceipt={publicationReceipt}
            onBackToPublish={returnToPublication}
            onTaskChanged={handleTaskChanged}
            onTaskListRefresh={refresh}
          />
        ) : (
          <PublicationSurface
            config={{ ...config, tasks }}
            plan={publishDraft.plan}
            state={publishDraft.state}
            selectedBlockers={publishDraft.selectedBlockers}
            publishing={publishing}
            onDraftChange={values => {
              if (Object.hasOwn(values, 'publishing')) setPublishing(values.publishing);
              const { publishing: _publishing, ...draftValues } = values;
              updateDraft(draftValues);
            }}
            onReset={resetDraft}
            onPublished={openPublishedTask}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
