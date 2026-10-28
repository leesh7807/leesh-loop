import { useEffect, useState } from 'react';

export function ProjectWorkerSettings({ selected, apiFetch, responseJson }) {
  const [readState, setReadState] = useState('loading');
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ codex_model: '', codex_reasoning_effort: '' });
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ repositoryPath: selected.repository_root });
    setReadState('loading');
    setSettings(null);
    setError('');
    setNotice('');
    apiFetch(`/api/v1/project-worker-settings?${query}`)
      .then(responseJson)
      .then(result => {
        if (!active) return;
        setSettings(result);
        setDraft({
          codex_model: result.settings.codex_model ?? '',
          codex_reasoning_effort: result.settings.codex_reasoning_effort ?? ''
        });
        setReadState('loaded');
      })
      .catch(requestError => {
        if (!active) return;
        setError(requestError.message || 'Could not read project Worker settings.');
        setReadState('error');
      });
    return () => { active = false; };
  }, [selected.id, selected.repository_root, selected.status, selected.process_absence_confirmed]);

  async function saveSetting(key, value) {
    const query = new URLSearchParams({ repositoryPath: selected.repository_root });
    setSaving(key);
    setError('');
    setNotice('');
    try {
      const result = await responseJson(await apiFetch(`/api/v1/project-worker-settings?${query}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      }));
      setSettings(result);
      setDraft({
        codex_model: result.settings.codex_model ?? '',
        codex_reasoning_effort: result.settings.codex_reasoning_effort ?? ''
      });
      setNotice(`${key} saved. Changes apply on the next Loop start; a running Loop is unchanged.`);
    } catch (requestError) {
      setError(requestError.message || `Could not update ${key}.`);
    } finally {
      setSaving('');
    }
  }

  const canUpdate = settings?.canUpdate === true;
  const statusGuidance = canUpdate
    ? 'Manager confirms this Loop has no active process.'
    : settings?.status === 'Running'
      ? 'Stop this Loop in Manager before changing its settings.'
      : settings?.status === 'Failed'
        ? 'Manager must confirm the Failed Loop has no active process before changes are allowed.'
        : settings?.status === 'Unconfirmed'
          ? 'Review the Loop diagnosis and resolve process ownership before trying again.'
          : 'Wait until Manager confirms this Loop is Stopped before changing its settings.';

  function field(key, label, inputId) {
    const saved = settings?.settings[key] ?? null;
    return (
      <div className="project-worker-setting" key={key}>
        <div className="project-worker-setting-heading">
          <label htmlFor={inputId}>{label}</label>
          <span>Saved: <code>{saved ?? 'Not set (Codex default)'}</code></span>
        </div>
        <div className="project-worker-setting-controls">
          <input id={inputId} type="text" value={draft[key]} autoComplete="off" spellCheck="false"
            aria-describedby={`${inputId}-help`} disabled={readState !== 'loaded' || Boolean(saving)}
            onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
          <button type="button" className="manager-action secondary" disabled={!canUpdate || Boolean(saving)}
            onClick={() => void saveSetting(key, draft[key])}>{saving === key ? 'Saving…' : `Save ${label}`}</button>
          <button type="button" className="manager-action secondary" disabled={!canUpdate || Boolean(saving) || saved === null}
            onClick={() => void saveSetting(key, null)}>{saving === key ? 'Saving…' : `Clear ${label}`}</button>
        </div>
        <p className="manager-help" id={`${inputId}-help`}>Leave unset to use the Codex default. {statusGuidance}</p>
      </div>
    );
  }

  return (
    <section className="project-worker-settings" aria-labelledby="project-worker-settings-heading">
      <div className="project-worker-settings-heading">
        <div>
          <h3 id="project-worker-settings-heading">Codex Worker settings</h3>
          <p className="manager-help">Optional model and reasoning overrides for a new Worker. Changes never alter a running Loop or Worker.</p>
        </div>
        {settings && <span className={`manager-status status-${settings.status.toLowerCase()}`}>Loop {settings.status}</span>}
      </div>
      {readState === 'loading' && <p className="manager-help" role="status">Reading saved Worker settings…</p>}
      {readState === 'error' && <p className="inline-message failure" role="alert">{error}</p>}
      {readState === 'loaded' && <>
        {field('codex_model', 'model', 'codex-model')}
        {field('codex_reasoning_effort', 'reasoning effort', 'codex-reasoning-effort')}
      </>}
      {notice && <p className="inline-message success" role="status">{notice}</p>}
      {error && readState === 'loaded' && <p className="inline-message failure" role="alert">{error}</p>}
    </section>
  );
}
