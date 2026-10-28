import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const uiRoot = resolve(import.meta.dirname, '..');
const { act } = React;

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 409, json: async () => body };
}

function waitFor(predicate, description) {
  const deadline = Date.now() + 2000;
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      if (predicate()) return resolveWait();
      if (Date.now() >= deadline) return rejectWait(new Error(`Timed out waiting for ${description}.`));
      setTimeout(check, 0);
    };
    check();
  });
}

test('project Worker settings save, clear, and rejected update interactions keep saved values and feedback aligned', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1:4320' });
  const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const previousGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const vite = await createServer({
    root: uiRoot,
    configFile: resolve(uiRoot, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  let root;
  try {
    const { ProjectWorkerSettings } = await vite.ssrLoadModule('/src/project-worker-settings.jsx');
    const { createRoot } = await import('react-dom/client');
    const selected = {
      id: 'settings-instance',
      repository_name: 'settings-worker',
      repository_root: '/tmp/settings-worker',
      status: 'Stopped',
      process_absence_confirmed: true
    };
    const saved = { codex_model: null, codex_reasoning_effort: 'high' };
    const requests = [];
    let rejectNextWrite = false;
    const apiFetch = async (path, options = {}) => {
      const request = { path, ...options };
      requests.push(request);
      if (options.method !== 'PUT') return response({
        project: { name: selected.repository_name, repositoryPath: selected.repository_root },
        status: 'Stopped',
        canUpdate: true,
        settings: { ...saved }
      });

      const patch = JSON.parse(options.body);
      if (rejectNextWrite) {
        rejectNextWrite = false;
        return response({ error: 'Stop this Loop in Manager before changing its settings.' }, false);
      }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete saved[key];
        else saved[key] = value;
      }
      return response({
        project: { name: selected.repository_name, repositoryPath: selected.repository_root },
        status: 'Stopped',
        canUpdate: true,
        settings: { codex_model: saved.codex_model ?? null, codex_reasoning_effort: saved.codex_reasoning_effort ?? null }
      });
    };
    const responseJson = async result => {
      const body = await result.json();
      if (!result.ok) throw new Error(body.error || `Request failed (${result.status}).`);
      return body;
    };
    root = createRoot(document.getElementById('root'));

    await act(async () => {
      root.render(React.createElement(ProjectWorkerSettings, { selected, apiFetch, responseJson }));
    });
    await waitFor(() => document.querySelector('#codex-model') !== null, 'settings fields to load');
    assert.equal(new URL(requests[0].path, dom.window.location.href).searchParams.get('repositoryPath'), selected.repository_root);
    const savedText = key => {
      const field = key === 'codex_model' ? '#codex-model' : '#codex-reasoning-effort';
      return document.querySelector(field)?.closest('.project-worker-setting')?.querySelector('.project-worker-setting-heading span')?.textContent;
    };
    const inputValue = id => document.querySelector(`#${id}`).value;
    const button = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
    const click = async (label, expectedFeedback) => {
      const target = button(label);
      assert.ok(target, `button ${label} exists`);
      await act(async () => { target.click(); });
      await waitFor(() => [...document.querySelectorAll('[role="status"], [role="alert"]')]
        .some(item => item.textContent.includes(expectedFeedback)), `feedback for ${label}`);
    };
    const change = async (id, value) => act(async () => {
      const input = document.querySelector(`#${id}`);
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    assert.equal(savedText('codex_model'), 'Saved: Not set (Codex default)');
    assert.equal(savedText('codex_reasoning_effort'), 'Saved: high');
    await change('codex-model', 'gpt-6-luna');
    await click('Save model', 'codex_model saved');
    assert.deepEqual(JSON.parse(requests.find(item => item.method === 'PUT').body), { codex_model: 'gpt-6-luna' });
    assert.equal(savedText('codex_model'), 'Saved: gpt-6-luna');
    assert.equal(savedText('codex_reasoning_effort'), 'Saved: high');
    assert.match(document.querySelector('[role="status"]').textContent, /codex_model saved.*next Loop start/);

    await click('Clear reasoning effort', 'codex_reasoning_effort saved');
    assert.deepEqual(JSON.parse(requests.filter(item => item.method === 'PUT')[1].body), { codex_reasoning_effort: null });
    assert.equal(savedText('codex_model'), 'Saved: gpt-6-luna');
    assert.equal(savedText('codex_reasoning_effort'), 'Saved: Not set (Codex default)');

    rejectNextWrite = true;
    await change('codex-model', 'rejected-model');
    await click('Save model', 'Stop this Loop in Manager');
    assert.equal(savedText('codex_model'), 'Saved: gpt-6-luna');
    assert.equal(inputValue('codex-model'), 'rejected-model');
    assert.match(document.querySelector('[role="alert"]').textContent, /Stop this Loop in Manager/);
  } finally {
    if (root) await act(async () => { root.unmount(); });
    await vite.close();
    dom.window.close();
    for (const name of globalNames) {
      const descriptor = previousGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
