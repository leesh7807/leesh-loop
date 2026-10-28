import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSerializedRefreshQueue } from './refresh-queue.js';
import { clearPublicationDraft, readPublicationDraft, writePublicationDraft } from './publication-draft.js';
import { groupTasksForOperatorDisplay } from './operator-task-display-order.js';
import { readTaskDetailDraft, writeTaskDetailDraft } from './task-detail-draft.js';
import { bootstrapManagerToken } from './manager-auth.js';
import { createManagerApiFetch } from './manager-api.js';
import { managerLifecycleAction, managerStartBlockedByRuntimeRepair } from './manager-lifecycle-action.js';
import { managerFailedGuidance } from './manager-failed-guidance.js';
import { createManagerInstanceListGate } from './manager-instance-list-gate.js';
import { createManagerSelectionGate } from './manager-selection-gate.js';
import { InstanceOperationFeedback, WorkflowOperationFeedback } from './manager-operation-feedback.js';
import { initialInstanceOperationFeedback, initialManagerFeedback, instanceOperationFeedbackFor, instanceOperationFeedbackReducer, managerFeedbackReducer, managerOperationAnnouncement, managerOperationCompletionMessage } from './manager-feedback.js';
import { logsPanelViewState, logsReadFailureState, logsReadStartState, managerInventoryViewState, managerRuntimeAttentionState, operatorConfigViewState, readFailureState, sharedRuntimeViewState, workflowComparisonViewState } from './manager-read-state.js';
import { workflowUpdateEligibility } from './workflow-update-eligibility.js';
import { workflowComparisonAfterApply } from './workflow-apply-result.js';
import { createWorkflowDiff } from './workflow-diff.js';
import { runtimeLabel } from './runtime-label.js';
import { canUnregisterLoop } from './manager-unregister-eligibility.js';
import { runtimeUpdateCompletionMessage } from './manager-runtime-feedback.js';
import './style.css';

const REFRESH_INTERVAL_MS = 7500;
const MANAGER_SELECTION_KEY = 'leesh-loop.manager.selected-instance.v1';
const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(value);
const taskUrl = id => `/api/v1/tasks/${encodeURIComponent(id)}`;
const taskDraftKey = id => `leesh-loop.operator.task-draft.v1:${id}`;
const selectedTaskKey = id => `leesh-loop.operator.selected-task.v1:${id}`;
const publicationReceiptKey = id => `leesh-loop.operator.publication-receipt.v1:${id}`;
const tokenProvider = () => bootstrapManagerToken();
const apiFetch = createManagerApiFetch({ tokenProvider });

function readSessionValue(key) {
  try { return window.sessionStorage.getItem(key); }
  catch { return null; }
}

function readSessionJson(key) {
  try { return JSON.parse(readSessionValue(key) || 'null'); }
  catch { return null; }
}

function writeSessionJson(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* Work state remains available in React for this page session. */ }
}

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

function WorkflowComparison({ current, candidate }) {
  const lines = useMemo(() => createWorkflowDiff(current, candidate), [current, candidate]);
  const added = lines.reduce((count, line) => count + (line.type === 'added' ? 1 : line.type === 'replacement' ? line.added : 0), 0);
  const removed = lines.reduce((count, line) => count + (line.type === 'removed' ? 1 : line.type === 'replacement' ? line.removed : 0), 0);

  return (
    <div className="workflow-review">
      <p className="manager-help">Template changes · {added} added · {removed} removed</p>
      <div className="workflow-diff" aria-label="Workflow changes">
        {lines.map((line, index) => line.type === 'gap' ? (
          <div className="workflow-diff-gap" key={`gap-${index}`}>… {line.count} unchanged {line.count === 1 ? 'line' : 'lines'} hidden …</div>
        ) : line.type === 'replacement' ? (
          <div className="workflow-diff-replacement" key={`replacement-${index}`}>{line.removed} lines removed and {line.added} lines added in this large section. Open full Workflow files to review its contents.</div>
        ) : (
          <div className={`workflow-diff-line ${line.type}`} key={`${line.type}-${line.oldNumber || ''}-${line.newNumber || ''}-${index}`}>
            <span className="workflow-diff-number">{line.oldNumber ?? ''}</span>
            <span className="workflow-diff-number">{line.newNumber ?? ''}</span>
            <span className="workflow-diff-marker" aria-hidden="true">{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span>
            <span>{line.text || ' '}</span>
          </div>
        ))}
      </div>
      <details className="workflow-full-files">
        <summary>View full Workflow files</summary>
        <div className="workflow-comparison">
          <section><h3>Current Workflow</h3><pre>{current}</pre></section>
          <section><h3>Template</h3><pre>{candidate}</pre></section>
        </div>
      </details>
    </div>
  );
}

function ManagerFeedback({ feedback, target }) {
  const readError = feedback.readErrors[target];
  const operationError = feedback.operationErrors[target];
  const notice = feedback.notices[target];
  if (!readError && !operationError && !notice) return null;
  return (
    <div className={`manager-feedback manager-feedback-${target}`}>
      {readError && <p className="inline-message failure" role="alert">{readError}</p>}
      {operationError && <p className="inline-message failure" role="alert">{operationError}</p>}
      {notice && <p className="inline-message" role="status">{notice}</p>}
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

function TaskSurface({ tasks, selectedTaskId, loading, error, refreshedAt, onRetry, onNewTask, onSelect }) {
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
  const pastTaskCount = groups.pastTasks.length;

  return (
    <aside className="task-surface" aria-labelledby="tasks-heading" aria-busy={loading && !refreshedAt}>
      <div className="surface-header">
        <div><p className="eyebrow">Work queue</p><h2 id="tasks-heading" tabIndex={-1}>Tasks</h2></div>
        <div className="task-surface-meta">
          <span className="task-total">{tasks.length}</span>
          <button type="button" className="quiet-button task-new-button" onClick={onNewTask}>New Task</button>
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
          {groups.activeWork.length > 0 && taskGroup('Active work', groups.activeWork, 'active-work')}
          {groups.backlog.length > 0 && taskGroup('Backlog', groups.backlog, 'backlog-work')}
          {pastTaskCount > 0 && (
            <details className="past-tasks">
              <summary><span>Past tasks</span><span className="task-group-count">{pastTaskCount}</span></summary>
              <div className="task-list">{groups.pastTasks.map(task => <TaskCard key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={onSelect} />)}</div>
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

function PublicationSurface({ config, instanceId, plan, state, selectedBlockers, publishing, onDraftChange, onReset, onPublished, apiFetch }) {
  const [result, setResult] = useState(null);
  const submitInFlight = useRef(false);

  useEffect(() => {
    const current = { plan, state, selectedBlockers };
    if (result?.kind === 'success') clearPublicationDraft(instanceId);
    else writePublicationDraft(current, instanceId);
  }, [instanceId, plan, state, selectedBlockers, result]);

  async function submit(event) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setResult(null);
    const submittedBlockers = [...selectedBlockers];
    writePublicationDraft({ plan, state, selectedBlockers: submittedBlockers }, instanceId);
    onDraftChange({ publishing: true });
    try {
      const response = await apiFetch('/api/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, state, blockedBy: submittedBlockers.map(task => task.taskId) })
      });
      const body = await responseJson(response);
      setResult({ kind: 'success', ...body, blockers: submittedBlockers });
      clearPublicationDraft(instanceId);
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
      <h2 id="publish-heading" className="panel-navigation-heading" tabIndex={-1}>Publish a Plan</h2>
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

function TaskDetail({ config, instanceId, taskId, publicationReceipt, onBackToPublish, onTaskChanged, onTaskListRefresh, apiFetch }) {
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
  const detailRefreshQueue = useRef(null);
  if (!detailRefreshQueue.current) detailRefreshQueue.current = createSerializedRefreshQueue();
  const currentRefresh = useRef(null);
  const mutationInFlight = useRef(false);
  const detailLoaded = useRef(false);

  const refresh = useCallback(async () => {
    const requestVersion = detailRefreshQueue.current.begin();
    if (requestVersion === null) return;
    try {
      const response = await apiFetch(taskUrl(taskId), { headers: { accept: 'application/json' } });
      const body = await responseJson(response);
      if (!detailRefreshQueue.current.isCurrent(requestVersion)) return;
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
        const draft = readTaskDetailDraft(body.task, { instanceId, states: config.states });
        setStateDraft(draft.state);
        setBlockerDraft(draft.blockedBy);
        setCommentDraft(draft.comment);
      }
      detailLoaded.current = true;
    } catch (error) {
      if (!detailRefreshQueue.current.isCurrent(requestVersion)) return;
      setRefreshError(error.message || 'Task detail could not be refreshed.');
      if (!detailLoaded.current) setTask(null);
    } finally {
      const { current, shouldRefresh } = detailRefreshQueue.current.finish(requestVersion);
      if (current) setLoading(false);
      if (shouldRefresh) void currentRefresh.current?.();
    }
  }, [apiFetch, config.states, instanceId, taskId]);
  currentRefresh.current = refresh;

  useEffect(() => {
    detailRefreshQueue.current.invalidate();
    detailRefreshQueue.current.cancelQueued();
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
    return () => {
      window.clearInterval(timer);
      detailRefreshQueue.current.invalidate();
      detailRefreshQueue.current.cancelQueued();
    };
  }, [refresh]);

  async function saveState(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    detailRefreshQueue.current.invalidate();
    setSaving('state');
    setStateFeedback(null);
    try {
      const response = await apiFetch(`${taskUrl(taskId)}/state`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: stateDraft })
      });
      const body = await responseJson(response);
      taskRef.current = body.task;
      setTask(body.task);
      setStateDraft(body.task.state);
      writeTaskDetailDraft(body.task, { state: body.task.state, blockedBy: blockerDraft, comment: commentDraft }, { instanceId });
      setStateFeedback({ kind: 'success', savedState: body.task.state, text: `Saved as ${body.task.state}.` });
      onTaskChanged(body.task);
      onTaskListRefresh();
    } catch (error) {
      setStateFeedback({ kind: 'failure', text: error.message || 'State could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      detailRefreshQueue.current.invalidate();
      setSaving('');
    }
  }

  async function saveBlockers(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    detailRefreshQueue.current.invalidate();
    setSaving('blockers');
    setBlockerFeedback(null);
    try {
      const response = await apiFetch(`${taskUrl(taskId)}/blocked-by`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blockedBy: blockerDraft })
      });
      const body = await responseJson(response);
      taskRef.current = body.task;
      setTask(body.task);
      setBlockerDraft(body.task.blockedBy);
      writeTaskDetailDraft(body.task, { state: stateDraft, blockedBy: body.task.blockedBy, comment: commentDraft }, { instanceId });
      setBlockerFeedback({ kind: 'success', text: 'Blocked By saved.' });
      onTaskChanged(body.task);
      onTaskListRefresh();
    } catch (error) {
      setBlockerFeedback({ kind: 'failure', text: error.message || 'Blocked By could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      detailRefreshQueue.current.invalidate();
      setSaving('');
    }
  }

  async function addComment(event) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    detailRefreshQueue.current.invalidate();
    setSaving('comment');
    setCommentFeedback(null);
    try {
      const response = await apiFetch(`${taskUrl(taskId)}/comments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: commentDraft })
      });
      const body = await responseJson(response);
      setComments(current => [...current, body.comment]);
      setCommentDraft('');
      writeTaskDetailDraft(taskRef.current || task, { state: stateDraft, blockedBy: blockerDraft, comment: '' }, { instanceId });
      setCommentFeedback({ kind: 'success', text: 'Comment saved.' });
      onTaskListRefresh();
    } catch (error) {
      setCommentFeedback({ kind: 'failure', text: error.message || 'Comment could not be saved.' });
    } finally {
      mutationInFlight.current = false;
      detailRefreshQueue.current.invalidate();
      setSaving('');
    }
  }

  const taskSummary = config.tasks.find(value => value.id === taskId);
  function persistTaskDraft(values) {
    if (!task) return;
    writeTaskDetailDraft(task, {
      state: values.state ?? stateDraft,
      blockedBy: values.blockedBy ?? blockerDraft,
      comment: values.comment ?? commentDraft
    }, { instanceId });
  }
  function toggleBlocker(value) {
    const blockedBy = blockerDraft.includes(value.id)
      ? blockerDraft.filter(id => id !== value.id)
      : [...blockerDraft, value.id];
    setBlockerDraft(blockedBy);
    persistTaskDraft({ blockedBy });
  }
  if (loading && !task) return <section className="work-panel detail-panel" aria-labelledby="task-detail-heading" aria-busy="true"><h2 id="task-detail-heading" className="panel-navigation-heading" tabIndex={-1}>{taskSummary?.title || 'Task detail'}</h2><p className="empty-state">Loading task detail…</p></section>;
  if (!task) return <section className="work-panel detail-panel" aria-labelledby="task-detail-heading"><h2 id="task-detail-heading" className="panel-navigation-heading" tabIndex={-1}>{taskSummary?.title || 'Task detail'}</h2><button type="button" className="text-button" onClick={onBackToPublish}>Back to Plan publication</button><p className="inline-message failure" role="alert">{refreshError || 'Task detail is unavailable.'}</p><button type="button" className="text-button" onClick={refresh}>Try again</button></section>;

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
      <h2 id="task-detail-heading" className="panel-navigation-heading" tabIndex={-1}>{task.title}</h2>
      <form className="state-toolbar" onSubmit={saveState} aria-label="Change task State">
        <p className="current-state"><span>Saved State</span><strong>{task.state}</strong></p>
        <div className="state-controls">
          <label htmlFor="next-state">Choose next State</label>
          <select id="next-state" value={stateDraft} onChange={event => { setStateDraft(event.target.value); setStateFeedback(null); persistTaskDraft({ state: event.target.value }); }} disabled={Boolean(saving)}>
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
        <div className="section-title"><span className="section-title-copy"><p className="eyebrow">Worker record</p><h3 id="workpad-heading">Workpad</h3></span></div>
        {workpad.length ? (
          <ol className="record-list">{workpad.map(record => <li key={record.id}><p className="record-meta">{record.author} · {record.createdAt}</p><pre className="long-text">{record.content}</pre></li>)}</ol>
        ) : <p className="quiet">No Workpad entries yet.</p>}
      </section>

      <section className="detail-section" aria-labelledby="comments-heading">
        <div className="section-title"><span className="section-title-copy"><p className="eyebrow">Human input</p><h3 id="comments-heading">Comments</h3></span></div>
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
          <textarea id="comment" value={commentDraft} onChange={event => { setCommentDraft(event.target.value); persistTaskDraft({ comment: event.target.value }); }} disabled={Boolean(saving)} required />
          <button type="submit" disabled={Boolean(saving) || !commentDraft.trim()}>{saving === 'comment' ? 'Saving…' : 'Add comment'}</button>
          {commentFeedback && <p className={`action-feedback ${commentFeedback.kind}`} role={commentFeedback.kind === 'failure' ? 'alert' : 'status'}>{commentFeedback.text}</p>}
        </form>
      </section>

      <section className="detail-section management-section" aria-labelledby="manage-task-heading">
        <div className="section-title"><span className="section-title-copy"><p className="eyebrow">Next action</p><h3 id="manage-task-heading">Manage task</h3></span></div>
        <form className="management-form" onSubmit={saveBlockers}>
          <span className="field-label">Blocked By</span>
          {availableBlockers.length || selectedBlockerItems.length ? (
            <BlockerOptions
              tasks={availableBlockers}
              selectedItems={selectedBlockerItems}
              onToggle={toggleBlocker}
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

function OperatorApp({ instanceId }) {
  const instanceApiFetch = useMemo(() => createManagerApiFetch({ tokenProvider, instanceId }), [instanceId]);
  const [config, setConfig] = useState(null);
  const [configReadState, setConfigReadState] = useState('loading');
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(() => {
    return readSessionValue(selectedTaskKey(instanceId)) || null;
  });
  const [navigationTarget, setNavigationTarget] = useState(null);
  const [publicationReceipt, setPublicationReceipt] = useState(() => readSessionJson(publicationReceiptKey(instanceId)));
  const [draft, setDraft] = useState(() => readPublicationDraft(instanceId));
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const taskListRefreshQueue = useRef(null);
  if (!taskListRefreshQueue.current) taskListRefreshQueue.current = createSerializedRefreshQueue();
  const hasReadTasks = useRef(false);
  const { plan, state, selectedBlockers } = draft;

  const refresh = useCallback(async () => {
    const requestVersion = taskListRefreshQueue.current.begin();
    if (requestVersion === null) return;
    if (!hasReadTasks.current) setLoading(true);
    try {
      const response = await instanceApiFetch('/api/v1/tasks', { headers: { accept: 'application/json' } });
      const body = await responseJson(response);
      if (!taskListRefreshQueue.current.isCurrent(requestVersion)) {
        taskListRefreshQueue.current.markQueued();
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
      if (taskListRefreshQueue.current.isCurrent(requestVersion)) setError(true);
    } finally {
      const { shouldRefresh } = taskListRefreshQueue.current.finish(requestVersion);
      setLoading(false);
      if (shouldRefresh) void refresh();
    }
  }, [instanceApiFetch]);

  useEffect(() => {
    let active = true;
    instanceApiFetch('/api/v1/config')
      .then(responseJson)
      .then(value => { if (active) { setConfig(value); setConfigReadState('loaded'); } })
      .catch(() => { if (active) { setConfig(null); setConfigReadState('error'); } });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [instanceApiFetch, refresh]);

  useEffect(() => {
    if (config?.githubRepositoryName) document.title = `${config.githubRepositoryName} · Loop`;
  }, [config?.githubRepositoryName]);

  useLayoutEffect(() => {
    if (!navigationTarget) return;
    if (window.matchMedia('(max-width: 960px)').matches) {
      document.querySelector('.work-layout > .work-panel:last-child')?.scrollIntoView({ block: 'start' });
      const headingId = navigationTarget === 'detail' ? 'task-detail-heading' : 'publish-heading';
      document.getElementById(headingId)?.focus({ preventScroll: true });
    }
    setNavigationTarget(null);
  }, [navigationTarget]);

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
    if (window.matchMedia('(max-width: 960px)').matches) setNavigationTarget('detail');
    setSelectedTaskId(id);
    try { window.sessionStorage.setItem(selectedTaskKey(instanceId), id); } catch { /* The selection remains available until this Operator unmounts. */ }
  }
  function openPublishedTask(publication) {
    taskListRefreshQueue.current.invalidate();
    resetDraft();
    setPublicationReceipt(publication);
    writeSessionJson(publicationReceiptKey(instanceId), {
      identifier: publication.identifier,
      page_id: publication.page_id,
      state: publication.state
    });
    openTask(publication.page_id);
    void refresh();
  }
  function returnToPublication() {
    if (window.matchMedia('(max-width: 960px)').matches) setNavigationTarget('publish');
    setSelectedTaskId(null);
    try { window.sessionStorage.removeItem(selectedTaskKey(instanceId)); } catch { /* The in-memory selection still clears. */ }
  }
  function resetDraft() {
    const emptyDraft = { plan: '', state: config?.defaultState || 'Ready', selectedBlockers: [] };
    clearPublicationDraft(instanceId);
    setDraft(emptyDraft);
  }
  function handleTaskChanged(task) {
    taskListRefreshQueue.current.invalidate();
    setTasks(current => current.map(value => value.id === task.id ? { ...value, state: task.state, blockedBy: task.blockedBy.map(id => {
      const blocker = current.find(entry => entry.id === id);
      return blocker ? { taskId: id, identifier: blocker.identifier, title: blocker.title, state: blocker.state } : { taskId: id, identifier: id, title: id, state: 'Unavailable' };
    }) } : value));
  }

  const configViewState = operatorConfigViewState(configReadState, config);
  if (configViewState === 'loading') return <main className="page-shell"><p className="manager-empty" role="status">Loading Operator configuration…</p></main>;
  if (configViewState === 'error') return <main className="page-shell"><p className="inline-message failure" role="alert">The Operator configuration could not be loaded. Refresh the page to retry.</p></main>;
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
        <TaskSurface tasks={tasks} selectedTaskId={selectedTaskId} loading={loading} error={error} refreshedAt={refreshedAt} onRetry={refresh} onNewTask={returnToPublication} onSelect={openTask} />
        {selectedTaskId ? (
          <TaskDetail
            key={selectedTaskId}
            config={{ ...config, tasks }}
            instanceId={instanceId}
            taskId={selectedTaskId}
            publicationReceipt={publicationReceipt}
            onBackToPublish={returnToPublication}
            onTaskChanged={handleTaskChanged}
            onTaskListRefresh={refresh}
            apiFetch={instanceApiFetch}
          />
        ) : (
          <PublicationSurface
            config={{ ...config, tasks }}
            instanceId={instanceId}
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
            apiFetch={instanceApiFetch}
          />
        )}
      </main>
    </div>
  );
}

async function readManagerJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Manager request failed (${response.status}).`);
  return body;
}

function ManagerApp() {
  const [instances, setInstances] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    try { return window.localStorage.getItem(MANAGER_SELECTION_KEY) || ''; }
    catch { return ''; }
  });
  const [view, setView] = useState(() => selectedId ? 'work' : 'projects');
  const selectionGateRef = useRef(null);
  if (!selectionGateRef.current) selectionGateRef.current = createManagerSelectionGate(selectedId);
  const instanceListGateRef = useRef(null);
  if (!instanceListGateRef.current) instanceListGateRef.current = createManagerInstanceListGate();
  const workflowRefreshControllerRef = useRef(null);
  const logsReadRequestRef = useRef(0);
  const [repositoryPath, setRepositoryPath] = useState('');
  const [repositoryPreview, setRepositoryPreview] = useState(null);
  const [repositoryPreviewError, setRepositoryPreviewError] = useState('');
  const [runtime, setRuntime] = useState(null);
  const [runtimeReadState, setRuntimeReadState] = useState('loading');
  const [workflow, setWorkflow] = useState(null);
  const [workflowReadState, setWorkflowReadState] = useState('idle');
  const [logs, setLogs] = useState('');
  const [logsReadState, setLogsReadState] = useState('idle');
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [busyOperation, setBusyOperation] = useState(null);
  const [feedback, dispatchFeedback] = useReducer(managerFeedbackReducer, initialManagerFeedback);
  const [instanceOperationFeedback, dispatchInstanceOperationFeedback] = useReducer(instanceOperationFeedbackReducer, initialInstanceOperationFeedback);
  const [instanceReadState, setInstanceReadState] = useState('loading');
  const [managerStopped, setManagerStopped] = useState(false);

  const selected = instances.find(instance => instance.id === selectedId) || null;
  const inventoryViewState = managerInventoryViewState(instanceReadState, instances.length);
  const runtimeViewState = sharedRuntimeViewState(runtimeReadState, runtime);
  const runtimeAttention = managerRuntimeAttentionState(runtimeReadState, runtime);
  const workflowPanelState = workflowComparisonViewState(workflowReadState, Boolean(workflow), workflowOpen);
  const logsPanelState = logsPanelViewState(logsReadState, logsOpen);
  const workflowEligibility = selected ? workflowUpdateEligibility(selected) : null;
  const selectedScopedWorkflowFeedback = instanceOperationFeedbackFor(instanceOperationFeedback, selectedId, 'workflow');
  const busyOperationInstance = busyOperation?.instanceId
    ? instances.find(instance => instance.id === busyOperation.instanceId)
    : null;
  const busyOperationMessage = managerOperationAnnouncement(busyOperation && {
    ...busyOperation,
    repositoryName: busyOperationInstance?.repository_name || busyOperation.instanceId
  });
  const selectedRuntimeVersion = runtimeLabel(selected?.runtime_version, runtime?.distributions);
  const managerRuntimeVersion = runtimeLabel(runtime?.manager_runtime_version, runtime?.distributions);
  const activeRuntimeVersion = runtimeLabel(runtime?.active?.id, runtime?.distributions);

  const selectInstance = useCallback(instanceId => {
    const selectionGate = selectionGateRef.current;
    const changed = selectionGate.instanceId !== instanceId;
    selectionGate.select(instanceId);
    if (changed) workflowRefreshControllerRef.current?.abort();
    setSelectedId(instanceId);
  }, []);

  const refreshInstances = useCallback(async () => {
    const listRevision = instanceListGateRef.current.begin();
    try {
      const body = await readManagerJson(await apiFetch('/api/v1/instances'));
      if (!instanceListGateRef.current.accept(listRevision)) return;
      setInstances(body.instances);
      setInstanceReadState('loaded');
      const current = selectionGateRef.current.instanceId;
      const next = body.instances.some(instance => instance.id === current) ? current : (body.instances[0]?.id || '');
      selectInstance(next);
      try {
        if (next) window.localStorage.setItem(MANAGER_SELECTION_KEY, next);
        else window.localStorage.removeItem(MANAGER_SELECTION_KEY);
      } catch { /* Selection remains available for this page session. */ }
      dispatchFeedback({ type: 'read-cleared', target: 'instances' });
    } catch (requestError) {
      if (!instanceListGateRef.current.accept(listRevision)) return;
      setInstanceReadState(readFailureState);
      dispatchFeedback({ type: 'read-error', target: 'instances', message: requestError.message || 'Could not load managed Loop instances.' });
    }
  }, [selectInstance]);

  const refreshRuntime = useCallback(async () => {
    try {
      setRuntime(await readManagerJson(await apiFetch('/api/v1/runtime')));
      setRuntimeReadState('loaded');
      dispatchFeedback({ type: 'read-cleared', target: 'runtime' });
    }
    catch (requestError) {
      setRuntimeReadState(readFailureState);
      dispatchFeedback({ type: 'read-error', target: 'runtime', message: requestError.message || 'Could not load the Runtime version.' });
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    const selectionGate = selectionGateRef.current;
    const requestSelection = selectionGate.capture();
    const instanceId = requestSelection.instanceId;
    if (!instanceId) return;
    const requestId = ++logsReadRequestRef.current;
    const isCurrentRequest = () => requestId === logsReadRequestRef.current && selectionGate.isCurrent(requestSelection);
    setLogsReadState(current => logsReadStartState(current));
    dispatchFeedback({ type: 'read-cleared', target: 'logs' });
    try {
      const body = await readManagerJson(await apiFetch(`/api/v1/instances/${encodeURIComponent(instanceId)}/logs`));
      if (!isCurrentRequest()) return;
      setLogs(body.logs);
      setLogsReadState('loaded');
      dispatchFeedback({ type: 'read-cleared', target: 'logs' });
    } catch (requestError) {
      if (!isCurrentRequest()) return;
      setLogsReadState(current => logsReadFailureState(current));
      dispatchFeedback({ type: 'read-error', target: 'logs', message: requestError.message || 'Could not read Loop logs.' });
    }
  }, []);

  useEffect(() => {
    if (managerStopped) return;
    void refreshInstances();
    void refreshRuntime();
    const timer = window.setInterval(() => { void refreshInstances(); }, 4000);
    return () => window.clearInterval(timer);
  }, [managerStopped, refreshInstances, refreshRuntime]);

  useEffect(() => {
    document.title = selected ? `${selected.repository_name} · Leesh Loop` : 'Leesh Loop Manager';
    setWorkflow(null);
    setWorkflowReadState('idle');
    setLogs('');
    setLogsReadState('idle');
    logsReadRequestRef.current += 1;
    setWorkflowOpen(false);
    setLogsOpen(false);
    dispatchFeedback({ type: 'instance-changed' });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !workflowOpen) return;
    let active = true;
    setWorkflowReadState('loading');
    dispatchFeedback({ type: 'read-cleared', target: 'workflow' });
    apiFetch(`/api/v1/instances/${encodeURIComponent(selectedId)}/workflow`)
      .then(readManagerJson)
      .then(body => {
        if (!active) return;
        setWorkflow(body);
        setWorkflowReadState('loaded');
        dispatchFeedback({ type: 'read-cleared', target: 'workflow' });
      })
      .catch(requestError => {
        if (!active) return;
        setWorkflowReadState('error');
        dispatchFeedback({ type: 'read-error', target: 'workflow', message: requestError.message || 'Could not compare the Workflow.' });
      });
    return () => { active = false; };
  }, [selectedId, workflowOpen]);

  useEffect(() => {
    if (!selectedId || !logsOpen) return;
    void refreshLogs();
    return () => { logsReadRequestRef.current += 1; };
  }, [selectedId, logsOpen, refreshLogs]);

  async function perform(path, { method = 'POST', body, label, operation = 'manager-action', target = 'manager', selectionSnapshot, instanceId } = {}) {
    const selectionGate = selectionGateRef.current;
    const operationSelection = selectionSnapshot || (target === 'workflow' || target === 'lifecycle' ? selectionGate.capture() : null);
    if (operationSelection && instanceId && operationSelection.instanceId !== instanceId) return null;
    const scopedInstanceId = target === 'workflow' || target === 'lifecycle'
      ? (instanceId || operationSelection?.instanceId)
      : '';
    const selectionIsCurrent = () => !operationSelection || selectionGate.isCurrent(operationSelection);
    setBusy(label || 'Working…');
    setBusyOperation({ label: label || 'Working', instanceId: scopedInstanceId });
    if (scopedInstanceId) {
      dispatchInstanceOperationFeedback({ type: 'started', instanceId: scopedInstanceId, target });
      if (selectionIsCurrent()) dispatchFeedback({ type: 'operation-started', target });
    } else dispatchFeedback({ type: 'operation-started', target });
    try {
      const result = await readManagerJson(await apiFetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      }));
      const message = operation === 'unregister-instance'
        ? `${result.instance.repository_name} was removed from Manager. Its Git repository and Loop data remain at ${result.instance.data_directory}.`
        : path === '/api/v1/runtime/update'
          ? runtimeUpdateCompletionMessage(result, managerRuntimeVersion)
          : result.instance
            ? `${result.instance.repository_name || result.instance.id}: ${result.instance.status}.`
            : managerOperationCompletionMessage(operation);
      if (scopedInstanceId) {
        const scopedMessage = managerOperationCompletionMessage(operation, result.instance);
        dispatchInstanceOperationFeedback({ type: 'success', instanceId: scopedInstanceId, target, message: scopedMessage });
      } else if (selectionIsCurrent()) dispatchFeedback({ type: 'operation-success', target, message });
      if (operation !== 'stop-manager') {
        await refreshInstances();
        await refreshRuntime();
      }
      return result;
    } catch (requestError) {
      if (scopedInstanceId) dispatchInstanceOperationFeedback({
        type: 'error', instanceId: scopedInstanceId, target,
        message: requestError.message || 'The Manager could not complete this action.'
      });
      else if (selectionIsCurrent()) dispatchFeedback({ type: 'operation-error', target, message: requestError.message || 'The Manager could not complete this action.' });
      return null;
    } finally {
      setBusy('');
      setBusyOperation(null);
    }
  }

  async function previewRepository() {
    if (!repositoryPath.trim() || busy) return;
    setRepositoryPreview(null);
    setRepositoryPreviewError('');
    setBusy('Checking repository');
    try {
      const body = await readManagerJson(await apiFetch('/api/v1/repositories/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryPath: repositoryPath.trim() })
      }));
      setRepositoryPreview(body);
    } catch (requestError) {
      setRepositoryPreviewError(requestError.message || 'Could not check this Git repository.');
    } finally {
      setBusy('');
    }
  }

  async function createInstance(event) {
    event.preventDefault();
    if (!repositoryPath.trim() || !repositoryPreview?.repository || repositoryPreview.already_managed) return;
    setBusy('Creating Loop');
    setBusyOperation({ label: 'Creating Loop', instanceId: '' });
    dispatchFeedback({ type: 'operation-started', target: 'instances' });
    try {
      const result = await readManagerJson(await apiFetch('/api/v1/instances', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repositoryPath: repositoryPath.trim() })
      }));
      const id = result.instance.id;
      instanceListGateRef.current.invalidate();
      setRepositoryPath('');
      setRepositoryPreview(null);
      setRepositoryPreviewError('');
      selectInstance(id);
      setView('work');
      try { window.localStorage.setItem(MANAGER_SELECTION_KEY, id); } catch { /* Selection remains in React state. */ }
      dispatchFeedback({ type: 'operation-success', target: 'instances', message: `Added ${result.instance.repository_name} to Manager. Its separate Workflow, Task Store and workspaces are stored under this user's Leesh Loop data.` });
      await refreshInstances();
    } catch (requestError) {
      dispatchFeedback({ type: 'operation-error', target: 'instances', message: requestError.message || 'Could not add the Git repository to Manager.' });
    } finally {
      setBusy('');
      setBusyOperation(null);
    }
  }

  async function unregisterInstance(instance) {
    if (!instance || !canUnregisterLoop(instance) || busy) return;
    const confirmed = window.confirm(
      `Unregister ${instance.repository_name} from Manager?\n\nManager confirms this Loop is ${instance.status === 'Stopped' ? 'Stopped' : 'Failed with no active process'}. This removes only its management entry. The Git repository and existing Workflow, Task Store, and workspace data stay on disk at ${instance.data_directory}.`
    );
    if (!confirmed) return;
    await perform(`/api/v1/instances/${encodeURIComponent(instance.id)}`, {
      method: 'DELETE',
      label: 'Unregistering Loop',
      operation: 'unregister-instance',
      target: 'instances'
    });
  }

  async function stopManager() {
    if (busy || managerStopped) return;
    const accepted = window.confirm('Stop the Manager Service? This closes the Manager page and its controls. Running Loops and Workers continue until you stop them separately.');
    if (!accepted) return;
    const result = await perform('/api/v1/manager/stop', { label: 'Stopping Manager', operation: 'stop-manager', target: 'manager' });
    if (result) setManagerStopped(true);
  }

  async function updateWorkflow() {
    if (!workflow?.changed || !workflowEligibility?.canApply) return;
    const selectionGate = selectionGateRef.current;
    const selectionSnapshot = selectionGate.capture();
    const instanceId = selectionSnapshot.instanceId;
    const comparisonAtApply = workflow;
    if (!instanceId || instanceId !== selectedId) return;
    const accepted = window.confirm(`Replace the Workflow for ${selected.repository_name}? A backup will be kept in this instance's data.`);
    if (!accepted) return;
    const result = await perform(`/api/v1/instances/${encodeURIComponent(instanceId)}/workflow`, {
      method: 'PUT',
      body: { confirm: true, expectedCurrent: comparisonAtApply.current, expectedCandidateDigest: comparisonAtApply.candidate_digest },
      label: 'Updating Workflow',
      operation: 'update-workflow',
      target: 'workflow',
      selectionSnapshot,
      instanceId
    });
    if (result) {
      setWorkflow(current => workflowComparisonAfterApply(current, {
        selectionGate,
        selectionSnapshot,
        candidateDigest: comparisonAtApply.candidate_digest
      }));
    }
  }

  async function refreshWorkflowComparison() {
    const selectionGate = selectionGateRef.current;
    const requestSelection = selectionGate.capture();
    const comparisonInstanceId = requestSelection.instanceId;
    if (!comparisonInstanceId) return;
    workflowRefreshControllerRef.current?.abort();
    const controller = new AbortController();
    workflowRefreshControllerRef.current = controller;
    setBusy('Refreshing Workflow');
    setBusyOperation({ label: 'Refreshing Workflow', instanceId: comparisonInstanceId });
    setWorkflowReadState('loading');
    dispatchFeedback({ type: 'operation-started', target: 'workflow' });
    try {
      const comparison = await readManagerJson(await apiFetch(`/api/v1/instances/${encodeURIComponent(comparisonInstanceId)}/workflow`, { signal: controller.signal }));
      if (!selectionGate.isCurrent(requestSelection)) return;
      setWorkflow(comparison);
      setWorkflowReadState('loaded');
      dispatchFeedback({ type: 'operation-success', target: 'workflow', message: 'Workflow comparison refreshed. Review the candidate before applying.' });
    } catch (requestError) {
      if (controller.signal.aborted || !selectionGate.isCurrent(requestSelection)) return;
      setWorkflowReadState('error');
      dispatchFeedback({ type: 'operation-error', target: 'workflow', message: requestError.message || 'Could not refresh the Workflow comparison.' });
    } finally {
      if (workflowRefreshControllerRef.current === controller) {
        workflowRefreshControllerRef.current = null;
        setBusy(current => current === 'Refreshing Workflow' ? '' : current);
        setBusyOperation(current => current?.label === 'Refreshing Workflow' && current.instanceId === comparisonInstanceId ? null : current);
      }
    }
  }

  const lifecycleAction = managerLifecycleAction(selected?.status, selected?.can_stop);
  const startBlockedByRuntimeRepair = managerStartBlockedByRuntimeRepair(lifecycleAction, runtimeAttention);
  const canUnregisterSelected = canUnregisterLoop(selected);

  const runtimePanel = (
    <section id="manager-runtime-panel" className="manager-runtime" aria-label="Central Runtime">
      <div>
        <p className="eyebrow">Runtime distribution</p>
        <h2>{runtimeViewState === 'loading'
          ? 'Loading Runtime…'
          : runtimeViewState === 'ready'
            ? `Active for new starts · ${activeRuntimeVersion}`
            : runtimeViewState === 'missing' ? 'Runtime not installed' : runtimeViewState === 'invalid' ? 'Active Runtime needs repair' : 'Runtime unavailable'}</h2>
        <p className="manager-help">Updating installs the Runtime from this checkout for future Loop starts. Running Loops keep their pinned Runtime, and Workflow files are changed only by the separate Workflow action below.</p>
        {runtime?.source?.path && <p className="manager-runtime-source">Source checkout <strong>v{runtime.source.version}</strong> · <code title={runtime.source.id}>{runtime.source.id.slice(0, 12)}</code><span>{runtime.source.path}</span></p>}
        {runtime?.source?.error && <p className="inline-message failure" role="status">Runtime source checkout is unavailable: {runtime.source.error}</p>}
        {runtime?.active_error && <p className="inline-message failure" role="status">The active Runtime could not be validated: {runtime.active_error} Install source Runtime to repair it.</p>}
        {runtime?.active_error && <p className="manager-help">Other validated Runtime distributions: {runtime.distributions?.length ? runtime.distributions.map(value => runtimeLabel(value.id, runtime.distributions)).join(', ') : 'none available'}.</p>}
        {runtime?.recovery_error && <p className="inline-message failure" role="status">Last Runtime recovery details are unavailable: {runtime.recovery_error}</p>}
        {runtime?.last_recovery && <details className="manager-runtime-recovery">
          <summary>Last Runtime recovery details</summary>
          {runtime.last_recovery.status === 'active'
            ? <p className="manager-help">Runtime {runtimeLabel(runtime.last_recovery.runtime_id, runtime.distributions)} was activated at {runtime.last_recovery.recovered_at}.</p>
            : <p className="inline-message failure" role="status">Runtime recovery has not confirmed activation yet. If this remains after the update completes, install source Runtime again.</p>}
          {runtime.last_recovery.validation_error && <p className="manager-help">Previous validation: {runtime.last_recovery.validation_error}</p>}
          {runtime.last_recovery.preserved_runtime_path && <p className="manager-help">{runtime.last_recovery.status === 'active' ? 'Damaged Runtime preserved at' : 'Planned quarantine path'} <code>{runtime.last_recovery.preserved_runtime_path}</code></p>}
        </details>}
        <p className="manager-runtime-versions">Manager service <strong title={runtime?.manager_runtime_version || undefined}>{managerRuntimeVersion}</strong><span>·</span> selected Loop <strong title={selected?.runtime_version || undefined}>{selected ? selectedRuntimeVersion : 'None'}</strong></p>
        {runtime?.active && (runtime.manager_restart_required || runtime.manager_runtime_version !== runtime.active.id) && <p className="inline-message" role="status">New starts use Runtime {activeRuntimeVersion}; Manager still requires a restart to load the active Runtime. Run <code>leesh-loop</code> to reopen Manager. Running Loops continue on their selected versions.</p>}
      </div>
      <div className="manager-runtime-action">
        <button className="manager-action secondary" type="button" disabled={Boolean(busy) || runtimeReadState === 'loading'} aria-describedby={busy ? 'manager-operation-pending' : undefined} onClick={() => void perform('/api/v1/runtime/update', { label: 'Updating Runtime', operation: 'update-runtime', target: 'runtime' })}>{busy === 'Updating Runtime' ? 'Installing…' : 'Install source Runtime'}</button>
        <ManagerFeedback feedback={feedback} target="runtime" />
      </div>
    </section>
  );

  return managerStopped ? (
    <main className="manager-stopped">
      <p className="eyebrow">Leesh Loop</p>
      <h1>Manager Service stopped</h1>
      <p>The Manager controls are closed. Running Loops and Workers continue independently.</p>
      <p>Run <code>leesh-loop</code> in a terminal to reopen Manager and reconnect to your projects.</p>
    </main>
  ) : (
    <div className="manager-shell">
      <header className="manager-topbar">
        <a className="manager-brand" href="#work" onClick={event => { event.preventDefault(); setView(selected ? 'work' : 'projects'); }}>
          <span className="eyebrow">Leesh Loop</span>
          <span className="manager-brand-name">Loop</span>
        </a>
        <nav className="manager-nav" aria-label="Manager">
          <button type="button" className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}>Work</button>
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>Projects</button>
          <button type="button" className={view === 'system' ? 'active' : ''} onClick={() => setView('system')}>System</button>
        </nav>
        <div className="manager-context">
          {selected ? (
            <>
              <label className="visually-hidden" htmlFor="project-switcher">Current project</label>
              <select id="project-switcher" value={selectedId} onChange={event => {
                const next = event.target.value;
                if (!next) { setView('projects'); return; }
                selectInstance(next);
                try { window.localStorage.setItem(MANAGER_SELECTION_KEY, next); } catch { /* Selection remains available for this page session. */ }
                setView('work');
              }}>
                {instances.map(instance => <option key={instance.id} value={instance.id}>{instance.repository_name} — {instance.repository_root}</option>)}
              </select>
              {view !== 'system' && <span className={'manager-status status-' + selected.status.toLowerCase()}>{selected.status}</span>}
              <span className="manager-context-path">{selected.repository_root}</span>
              {view !== 'system' && (lifecycleAction === 'stop' ? (
                <button className="manager-action secondary" type="button" disabled={Boolean(busy)} onClick={() => void perform('/api/v1/instances/' + encodeURIComponent(selectedId) + '/stop', { label: 'Stopping Loop', operation: 'stop-loop', target: 'lifecycle', instanceId: selectedId })}>{busyOperation?.label === 'Stopping Loop' && busyOperation.instanceId === selectedId ? 'Stopping…' : 'Stop Loop'}</button>
              ) : lifecycleAction === 'unconfirmed' ? (
                <span className="manager-lifecycle-pending">Process ownership needs review</span>
              ) : lifecycleAction === 'pending' || lifecycleAction === 'stopping' ? (
                <span className="manager-lifecycle-pending">{lifecycleAction === 'stopping' ? 'Stopping Loop…' : 'Loop is starting'}</span>
              ) : (
                <button className="manager-action" type="button" disabled={Boolean(busy) || startBlockedByRuntimeRepair} aria-describedby={startBlockedByRuntimeRepair ? 'manager-runtime-start-disabled' : undefined} onClick={() => void perform('/api/v1/instances/' + encodeURIComponent(selectedId) + '/start', { label: 'Starting Loop', operation: 'start-loop', target: 'lifecycle', instanceId: selectedId })}>{busyOperation?.label === 'Starting Loop' && busyOperation.instanceId === selectedId ? 'Starting…' : selected.status === 'Failed' ? 'Retry Loop' : 'Start Loop'}</button>
              ))}
            </>
          ) : (
            <span className="manager-empty-context">{inventoryViewState === 'loading' ? 'Loading projects…' : 'No project selected'}</span>
          )}
        </div>
        <ManagerFeedback feedback={feedback} target="lifecycle" />
        {busyOperationMessage && <p className="inline-message manager-operation-pending" id="manager-operation-pending" role="status">{busyOperationMessage}</p>}
      </header>

      {view !== 'system' && selected && (selected.status === 'Unconfirmed' || selected.status === 'Failed' || runtimeAttention) && (
        <section className="manager-attention" role="status">
          <div>
            <strong>{selected.status === 'Unconfirmed' ? 'Loop ownership needs review' : selected.status === 'Failed' ? 'Loop failed to start or stopped unexpectedly' : runtimeAttention === 'repair' ? 'Runtime repair needed' : 'Manager restart needed'}</strong>
            <p>{selected.status === 'Unconfirmed'
              ? 'Manager cannot confirm which process owns this Loop. Start, stop, and unregister are unavailable until ownership is confirmed.'
              : selected.status === 'Failed'
                ? managerFailedGuidance(selected)
                : runtimeAttention === 'repair'
                  ? 'Repair the active Runtime before starting another Loop.'
                  : 'Run leesh-loop to reload Manager onto the active Runtime. Running Loops keep their pinned versions.'}</p>
          </div>
          <button type="button" className="manager-action secondary" onClick={() => setView(runtimeAttention ? 'system' : 'projects')}>{runtimeAttention ? 'Review Runtime' : 'Review project'}</button>
        </section>
      )}

      {view === 'work' && selected && <OperatorApp key={selectedId} instanceId={selectedId} />}
      {view === 'work' && !selected && (
        <main className="manager-empty-work">
          <p className="eyebrow">Project work</p>
          <h1>{inventoryViewState === 'empty' ? 'Add a Git project to begin' : inventoryViewState === 'loading' ? 'Loading projects' : 'Choose a project'}</h1>
          <p>{inventoryViewState === 'empty'
            ? 'Each project gets its own Tasks, Workflow, workspace, and Loop state. Your Git repository stays where it is.'
            : inventoryViewState === 'loading'
              ? 'Manager is checking its registered project list.'
              : 'Select a project from the list or add an existing local Git repository.'}</p>
          <button type="button" className="manager-action" onClick={() => setView('projects')}>{inventoryViewState === 'empty' ? 'Add project' : 'Choose project'}</button>
        </main>
      )}

      {view === 'projects' && (
        <main className="manager-page">
          <header className="manager-page-heading">
            <p className="eyebrow">Project management</p>
            <h1>Projects</h1>
            <p>Choose the Git repository you want to work in. Each project keeps its Tasks, Workflow, and Loop data separate.</p>
          </header>

          <ManagerFeedback feedback={feedback} target="instances" />

          <section className="manager-project-list" aria-labelledby="projects-heading">
            <div className="manager-section-heading">
              <div><p className="eyebrow">Registered repositories</p><h2 id="projects-heading">{instances.length} {instances.length === 1 ? 'project' : 'projects'}</h2></div>
              <button type="button" className="manager-action secondary" onClick={() => void refreshInstances()}>Refresh projects</button>
            </div>
            {inventoryViewState === 'loading' && <p className="manager-help" role="status">Loading registered projects…</p>}
            {inventoryViewState === 'error' && <p className="inline-message failure" role="alert">Project list could not be loaded. {feedback.readErrors.instances || 'Check that Manager is running, then retry.'}</p>}
            {inventoryViewState === 'empty' && <p className="manager-help">No projects are registered yet. Add a local Git repository below to create its separate Loop data.</p>}
            {inventoryViewState === 'list' && (
              <div className="manager-project-grid">
                {instances.map(instance => (
                  <article className={'manager-project-card' + (selectedId === instance.id ? ' selected' : '')} key={instance.id}>
                    <div className="manager-project-card-heading">
                      <div><p className="eyebrow">{selectedId === instance.id ? 'Current project' : 'Git project'}</p><h3>{instance.repository_name}</h3></div>
                      <span className={'manager-status status-' + instance.status.toLowerCase()}>{instance.status}</span>
                    </div>
                    <p className="manager-project-path">{instance.repository_root}</p>
                    <dl className="manager-project-meta">
                      <div><dt>Upstream branch</dt><dd>{instance.base_branch}</dd></div>
                      <div><dt>Loop data</dt><dd>{instance.data_directory}</dd></div>
                    </dl>
                    <div className="manager-project-actions">
                      <button type="button" className="manager-action" onClick={() => {
                        selectInstance(instance.id);
                        try { window.localStorage.setItem(MANAGER_SELECTION_KEY, instance.id); } catch { /* Selection remains available for this page session. */ }
                        setView('work');
                      }}>Open work</button>
                      <button type="button" className="manager-action secondary" disabled={!canUnregisterLoop(instance) || Boolean(busy)} aria-describedby={!canUnregisterLoop(instance) ? `unregister-project-guidance-${instance.id}` : undefined} onClick={() => void unregisterInstance(instance)}>Unregister</button>
                    </div>
                    {!canUnregisterLoop(instance) && <p className="manager-help" id={`unregister-project-guidance-${instance.id}`}>Unregister is available after Manager confirms this Loop is Stopped or has Failed with no active process.</p>}
                    <p className="manager-help">Unregistering removes only the Manager entry. It does not stop a process or delete the Git repository, Tasks, Workflow, or workspace.</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="manager-section manager-create" aria-labelledby="add-project-heading">
            <p className="eyebrow">Add a repository</p>
            <h2 id="add-project-heading">Register a Git project</h2>
            <p className="manager-help">Use the absolute path to a Git repository root with a branch that tracks a readable upstream. Manager creates a separate Workflow, Task Store, and workspace under this user's Leesh Loop data; it does not modify the repository.</p>
            <form onSubmit={createInstance} aria-label="Register Git project">
            <label htmlFor="repository-path">Repository path</label>
            <div className="manager-input-row">
              <input id="repository-path" type="text" value={repositoryPath} onChange={event => {
                setRepositoryPath(event.target.value);
                setRepositoryPreview(null);
                setRepositoryPreviewError('');
              }} placeholder="/home/you/projects/repository" autoComplete="off" spellCheck="false" disabled={Boolean(busy)} />
              <button className="manager-action secondary" type="button" disabled={Boolean(busy) || !repositoryPath.trim()} onClick={() => void previewRepository()}>{busy === 'Checking repository' ? 'Checking…' : 'Check repository'}</button>
            </div>
            {repositoryPreviewError && <p className="inline-message failure" role="alert">{repositoryPreviewError}</p>}
            {repositoryPreview?.repository && (
              <div className="manager-repository-preview" role="status">
                <p className="eyebrow">Repository check</p>
                <h3>{repositoryPreview.repository.name}</h3>
                <dl>
                  <div><dt>Repository root</dt><dd>{repositoryPreview.repository.root}</dd></div>
                  <div><dt>Git upstream</dt><dd>{repositoryPreview.repository.upstream} · {repositoryPreview.repository.url}</dd></div>
                </dl>
                {repositoryPreview.already_managed
                  ? <p className="inline-message failure">Already registered as {repositoryPreview.already_managed.name} at {repositoryPreview.already_managed.root}. Select it from the project list.</p>
                  : <p className="manager-help">The Git repository will remain unchanged. New Task, Workflow, and workspace data will be created under your Leesh Loop user data directory.</p>}
                <button type="submit" className="manager-action" disabled={Boolean(busy) || Boolean(repositoryPreview.already_managed)}>Add project to Manager</button>
              </div>
            )}
            </form>
          </section>

          {selected && (
            <section className="manager-section" aria-labelledby="project-settings-heading">
              <div className="manager-section-heading">
                <div><p className="eyebrow">Selected project</p><h2 id="project-settings-heading">{selected.repository_name} settings</h2></div>
                <span className="manager-project-path">{selected.repository_root}</span>
              </div>
              {!workflowOpen ? (
                <button type="button" className="manager-action secondary" onClick={() => setWorkflowOpen(true)}>Compare project Workflow</button>
              ) : (
                <div className="manager-workflow-panel">
                  <div className="manager-section-heading">
                    <div><h3>Project Workflow</h3><p className="manager-help">This changes only this project's Worker instructions. A backup is kept when an update is applied.</p></div>
                    <button type="button" className="manager-action secondary" onClick={() => setWorkflowOpen(false)}>Close comparison</button>
                  </div>
                  <ManagerFeedback feedback={feedback} target="workflow" />
                  <WorkflowOperationFeedback feedback={selectedScopedWorkflowFeedback} placement="panel" />
                  {!workflow && workflowPanelState === 'loading' && <p className="manager-help" role="status">Loading Workflow comparison…</p>}
                  {!workflow && workflowPanelState === 'error' && <button type="button" className="manager-action secondary" disabled={Boolean(busy)} onClick={() => void refreshWorkflowComparison()}>{busyOperation?.label === 'Refreshing Workflow' ? 'Retrying…' : 'Retry comparison'}</button>}
                  {workflow && (
                    <div className="manager-workflow-content">
                      <p className="manager-help">Review the proposed Workflow changes before applying them.</p>
                      {workflow.changed && workflowEligibility && <p className="inline-message workflow-eligibility" id="workflow-update-eligibility" role="status">{workflowEligibility.summary}</p>}
                      {workflow.changed ? <WorkflowComparison current={workflow.current} candidate={workflow.candidate} /> : <p className="manager-help">This Workflow matches the current template.</p>}
                      <div className="workflow-update-actions">
                        <button type="button" className="manager-action secondary" disabled={Boolean(busy) || !workflow.changed || !workflowEligibility?.canApply} aria-describedby={workflow.changed && !workflowEligibility?.canApply ? 'workflow-update-disabled-reason' : undefined} onClick={() => void updateWorkflow()}>{busyOperation?.label === 'Updating Workflow' ? 'Updating…' : 'Apply Workflow Update'}</button>
                        {workflow.changed && !workflowEligibility?.canApply && <p className="manager-help" id="workflow-update-disabled-reason">{workflowEligibility?.controlHint || 'This Loop must be stopped before applying the update.'}</p>}
                        <button type="button" className="manager-action secondary" disabled={Boolean(busy)} onClick={() => void refreshWorkflowComparison()}>{busyOperation?.label === 'Refreshing Workflow' ? 'Refreshing…' : 'Refresh comparison'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selected.detail && (
                <details className="manager-diagnosis">
                  <summary>Loop diagnosis</summary>
                  <p className="manager-help">Review process ownership and logs before retrying lifecycle actions.</p>
                  <pre>{selected.detail}</pre>
                </details>
              )}
              <details className="manager-diagnosis" open={logsOpen} onToggle={event => setLogsOpen(event.currentTarget.open)}>
                <summary>Loop logs</summary>
                {logsOpen && logsPanelState === 'loading' && <p className="manager-help" role="status">Loading Loop logs…</p>}
                {logsOpen && (
                  <>
                    <button type="button" className="manager-action secondary" onClick={() => void refreshLogs()}>{logsPanelState === 'loaded' ? 'Refresh logs' : 'Load Loop logs'}</button>
                    <pre className="manager-logs">{logs || 'No Loop logs are available yet.'}</pre>
                  </>
                )}
              </details>
            </section>
          )}
        </main>
      )}

      {view === 'system' && (
        <main className="manager-page">
          <header className="manager-page-heading">
            <p className="eyebrow">System management</p>
            <h1>Runtime and Manager</h1>
            <p>These controls apply to Manager or new Loop starts across all projects.</p>
          </header>
          {runtimeAttention && <div className="manager-attention"><div><strong>{runtimeAttention === 'repair' ? 'Runtime repair needed' : 'Manager restart needed'}</strong><p>{runtimeAttention === 'repair' ? 'Repair the active Runtime before starting another Loop.' : 'New starts use the active Runtime; restart Manager to load it. Running Loops keep their pinned versions.'}</p></div></div>}
          {runtimePanel}
          <section className="manager-section manager-service-panel" aria-labelledby="manager-service-heading">
            <p className="eyebrow">Manager Service</p>
            <h2 id="manager-service-heading">Running at {window.location.host}</h2>
            <p className="manager-help">Closing this browser tab leaves Manager and every Loop running. Stopping Manager closes its control API and Task Store connections; it does not stop any Loop or Worker.</p>
            <button type="button" className="manager-action secondary" disabled={Boolean(busy)} onClick={() => void stopManager()}>{busy === 'Stopping Manager' ? 'Stopping Manager…' : 'Stop Manager Service'}</button>
            <ManagerFeedback feedback={feedback} target="manager" />
          </section>
        </main>
      )}
    </div>
  );

}

createRoot(document.getElementById('root')).render(<ManagerApp />);
