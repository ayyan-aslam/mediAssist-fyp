// An ILIKE pattern that matches q anywhere in the text. % and _ in q are matched as plain characters.
export function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}
