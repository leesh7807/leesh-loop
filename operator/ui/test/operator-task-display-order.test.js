import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTasksForOperatorDisplay } from '../src/operator-task-display-order.js';

const task = (title, state) => ({ title, state });

test('the Operator view groups Human Review first and sorts active States ahead of remaining work', () => {
  const tasks = [
    task('Completed task', 'Done'),
    task('Work in progress', 'In Progress'),
    task('Waiting task', 'Backlog'),
    task('Review needed', 'Human Review'),
    task('Ready task', 'Ready'),
    task('Merging task', 'Merging'),
    task('Rework task', 'Rework')
  ];

  const groups = groupTasksForOperatorDisplay(tasks);

  assert.deepEqual(groups.humanReview.map(item => item.title), ['Review needed']);
  assert.deepEqual(groups.activeWork.map(item => item.title), ['Merging task', 'Work in progress', 'Ready task', 'Rework task']);
  assert.deepEqual(groups.remainingTasks.map(item => item.title), ['Completed task', 'Waiting task']);
});

test('tasks with equal attention retain their canonical read order', () => {
  const tasks = [
    task('First review', 'Human Review'),
    task('First in progress', 'In Progress'),
    task('Second review', 'Human Review'),
    task('Merging task', 'Merging'),
    task('Second in progress', 'In Progress'),
    task('First backlog', 'Backlog'),
    task('Done task', 'Done'),
    task('Second backlog', 'Backlog')
  ];

  const groups = groupTasksForOperatorDisplay(tasks);

  assert.deepEqual(groups.humanReview.map(item => item.title), ['First review', 'Second review']);
  assert.deepEqual(groups.activeWork.map(item => item.title), ['Merging task', 'First in progress', 'Second in progress']);
  assert.deepEqual(groups.remainingTasks.map(item => item.title), ['First backlog', 'Done task', 'Second backlog']);
  assert.deepEqual(tasks.map(item => item.title), [
    'First review', 'First in progress', 'Second review', 'Merging task', 'Second in progress', 'First backlog', 'Done task', 'Second backlog'
  ]);
});
