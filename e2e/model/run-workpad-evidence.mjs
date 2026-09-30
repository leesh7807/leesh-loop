const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const WORKPAD_SECTION_HEADINGS = new Set([
  'Human Review',
  'Human Review Entered',
  'Review Input',
  'Merging',
  'Rework Reset Complete'
]);

function parseField(lines, name) {
  const expression = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\S+)[ \\t]*$`);
  return lines.map(line => expression.exec(line)?.[1]).findLast(Boolean) || null;
}

export function parseRunWorkpadEvidence(workpad) {
  const lines = String(workpad || '').split(/\r?\n/);
  const deliveryMarkers = [...String(workpad || '').matchAll(/^[ \t]*delivered_pr:[ \t]*(\S+)[ \t]*$/gm)]
    .map(match => match[1]);
  const deliveryPrs = deliveryMarkers.filter(identity => identity !== 'none');
  const mergeTargets = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== 'Merging') continue;
    let end = index + 1;
    while (end < lines.length && !WORKPAD_SECTION_HEADINGS.has(lines[end].trim())) end += 1;
    const section = lines.slice(index + 1, end);
    const approvedPr = parseField(section, 'approved_pr');
    const mergeTargetHead = parseField(section, 'merge_target_head');
    if (approvedPr && COMMIT_SHA.test(mergeTargetHead || '')) {
      mergeTargets.push({
        cycle: parseField(section, 'cycle'),
        approved_pr: approvedPr,
        approved_head: parseField(section, 'approved_head'),
        merge_target_head: mergeTargetHead
      });
    }
    index = end - 1;
  }

  return {
    delivery_prs: [...new Set(deliveryPrs)],
    has_delivery_marker: deliveryMarkers.length > 0,
    latest_delivery_pr: deliveryMarkers.at(-1) && deliveryMarkers.at(-1) !== 'none' ? deliveryMarkers.at(-1) : null,
    merge_targets: mergeTargets
  };
}

export function recordRunWorkpadEvidence(record, workpad) {
  const evidence = parseRunWorkpadEvidence(workpad);
  const artifacts = record.artifacts ||= {};
  artifacts.workpad_delivery_prs ||= [];
  for (const identity of evidence.delivery_prs) {
    if (!artifacts.workpad_delivery_prs.includes(identity)) artifacts.workpad_delivery_prs.push(identity);
  }
  if (evidence.has_delivery_marker) artifacts.workpad_latest_delivery_pr = evidence.latest_delivery_pr;
  artifacts.workpad_merge_targets ||= [];
  for (const target of evidence.merge_targets) {
    const existingIndex = artifacts.workpad_merge_targets.findIndex(existing =>
      existing.cycle === target.cycle && existing.approved_pr === target.approved_pr);
    if (existingIndex === -1) artifacts.workpad_merge_targets.push(target);
    else artifacts.workpad_merge_targets[existingIndex] = target;
  }
  return evidence;
}

export function recordSnapshotWorkpadEvidence(record) {
  for (const snapshot of record.evidence?.snapshots || []) {
    const workpad = snapshot.notion?.workpad;
    if (typeof workpad === 'string') recordRunWorkpadEvidence(record, workpad);
  }
}
