function diffOperations(beforeText, afterText) {
  const before = String(beforeText).replace(/\r\n/g, '\n').split('\n');
  const after = String(afterText).replace(/\r\n/g, '\n').split('\n');
  const maximum = before.length + after.length;
  const offset = maximum + 1;
  const traceLimit = 4_000_000;
  const furthest = new Int32Array(2 * maximum + 3);
  furthest.fill(-1);
  furthest[offset + 1] = 0;
  const trace = [];

  for (let distance = 0; distance <= maximum; distance += 1) {
    if ((trace.length + 1) * furthest.length > traceLimit) {
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
      return {
        operations: [],
        simplified: {
          prefix,
          suffix,
          removed: before.length - prefix - suffix,
          added: after.length - prefix - suffix
        }
      };
    }
    trace.push(furthest.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const index = offset + diagonal;
      let x = diagonal === -distance || (diagonal !== distance && furthest[index - 1] < furthest[index + 1])
        ? furthest[index + 1]
        : furthest[index - 1] + 1;
      if (x < 0) x = 0;
      let y = x - diagonal;

      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }

      furthest[index] = x;
      if (x >= before.length && y >= after.length) {
        return { operations: backtrack(trace, before, after, offset), simplified: null };
      }
    }
  }

  return { operations: [], simplified: null };
}

function backtrack(trace, before, after, offset) {
  let x = before.length;
  let y = after.length;
  const reversed = [];

  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const furthest = trace[distance];
    const diagonal = x - y;
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && furthest[offset + diagonal - 1] < furthest[offset + diagonal + 1])
      ? diagonal + 1
      : diagonal - 1;
    const previousX = furthest[offset + previousDiagonal];
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reversed.push({ type: 'equal', text: before[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (x === previousX) {
      reversed.push({ type: 'added', text: after[y - 1] });
      y -= 1;
    } else {
      reversed.push({ type: 'removed', text: before[x - 1] });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    reversed.push({ type: 'equal', text: before[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reversed.push({ type: 'removed', text: before[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    reversed.push({ type: 'added', text: after[y - 1] });
    y -= 1;
  }

  return reversed.reverse();
}

export function createWorkflowDiff(beforeText, afterText, context = 3) {
  const { operations, simplified } = diffOperations(beforeText, afterText);
  if (simplified) {
    const before = String(beforeText).replace(/\r\n/g, '\n').split('\n');
    const after = String(afterText).replace(/\r\n/g, '\n').split('\n');
    const visible = [];
    for (let index = Math.max(0, simplified.prefix - context); index < simplified.prefix; index += 1) {
      visible.push({ type: 'equal', text: before[index], oldNumber: index + 1, newNumber: index + 1 });
    }
    visible.push({ type: 'replacement', removed: simplified.removed, added: simplified.added });
    for (let index = 0; index < Math.min(context, simplified.suffix); index += 1) {
      const oldNumber = before.length - simplified.suffix + index + 1;
      const newNumber = after.length - simplified.suffix + index + 1;
      visible.push({ type: 'equal', text: before[oldNumber - 1], oldNumber, newNumber });
    }
    return visible;
  }
  const changedIndexes = operations.flatMap((line, index) => line.type === 'equal' ? [] : [index]);
  if (changedIndexes.length === 0) return [];

  let oldNumber = 1;
  let newNumber = 1;
  const numbered = operations.map(line => {
    const result = {
      ...line,
      ...(line.type === 'added' ? { newNumber } : line.type === 'removed' ? { oldNumber } : { oldNumber, newNumber })
    };
    if (line.type !== 'added') oldNumber += 1;
    if (line.type !== 'removed') newNumber += 1;
    return result;
  });

  const ranges = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - context);
    const end = Math.min(numbered.length - 1, index + context);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }

  const visible = [];
  for (const [rangeIndex, range] of ranges.entries()) {
    if (rangeIndex > 0) {
      const previous = ranges[rangeIndex - 1];
      const hidden = range.start - previous.end - 1;
      if (hidden > 0) visible.push({ type: 'gap', count: hidden });
    }
    visible.push(...numbered.slice(range.start, range.end + 1));
  }
  return visible;
}
