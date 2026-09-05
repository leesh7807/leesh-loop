import path from 'node:path';

export function identifierFromPlan(planPath: string): string {
  const name = path.basename(planPath);
  if (!name.endsWith('.md')) throw new Error('Plan artifact must be a Markdown file');
  const id = name.slice(0, -3);
  if (!id) throw new Error('Plan identifier cannot be empty');
  return id;
}

export function titleFromPlan(content: string): string {
  const heading = content.split(/\r?\n/).find(line => /^#\s+\S/.test(line));
  if (!heading) throw new Error('Plan must contain a level-one heading');
  const title = heading.replace(/^#\s+/, '').replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '').replace(/[-_]+/g, ' ').trim();
  if (!title) throw new Error('Plan title cannot be derived');
  return title.replace(/\b\w/g, c => c.toUpperCase());
}
