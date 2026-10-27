const activeStateOrder = new Map([
  ['Merging', 0],
  ['In Progress', 1],
  ['Ready', 2],
  ['Rework', 3]
]);

export function groupTasksForOperatorDisplay(tasks) {
  const humanReview = [];
  const activeWork = [];
  const backlog = [];
  const pastTasks = [];

  tasks.forEach((task, index) => {
    const entry = { task, index };
    if (task.state === 'Human Review') humanReview.push(entry);
    else if (activeStateOrder.has(task.state)) activeWork.push(entry);
    else if (task.state === 'Backlog') backlog.push(entry);
    else pastTasks.push(entry);
  });

  activeWork.sort((first, second) => activeStateOrder.get(first.task.state) - activeStateOrder.get(second.task.state) || first.index - second.index);

  return {
    humanReview: humanReview.map(entry => entry.task),
    activeWork: activeWork.map(entry => entry.task),
    backlog: backlog.map(entry => entry.task),
    pastTasks: pastTasks.map(entry => entry.task)
  };
}
