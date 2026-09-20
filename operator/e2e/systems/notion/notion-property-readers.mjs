export function textValue(property) {
  const values = property?.type === 'title' ? property.title : property?.type === 'rich_text' ? property.rich_text : null;
  return Array.isArray(values) ? values.map(value => value?.plain_text ?? value?.text?.content ?? '').join('') : null;
}

export function selectValue(property) {
  return property?.type === 'select' && (property.select === null || typeof property.select?.name === 'string') ? property.select?.name ?? '' : null;
}

export function relationIds(property) {
  if (property?.type !== 'relation' || !Array.isArray(property.relation)) return null;
  return property.relation.map(value => value?.id).every(value => typeof value === 'string') ? property.relation.map(value => value.id) : null;
}

export function paragraphText(blocks) {
  return blocks.map(block => block?.type === 'paragraph' ? (block.paragraph?.rich_text || []).map(value => value?.plain_text ?? value?.text?.content ?? '').join('') : '').join('');
}
