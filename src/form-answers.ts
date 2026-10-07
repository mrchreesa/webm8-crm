export type FormAnswer = { name: string; values: string[] };

export function readFormAnswers(raw: string): { answers: FormAnswer[]; incomplete: boolean } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { answers: [], incomplete: true };
  }
  if (!Array.isArray(data)) return { answers: [], incomplete: true };
  let incomplete = false;
  const answers: FormAnswer[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
      incomplete = true;
      continue;
    }
    // Older imports may use a scalar value rather than Meta's values array.
    const value = entry.values ?? entry.value;
    const supplied = value == null ? [] : Array.isArray(value) ? value : [value];
    const values = supplied.flatMap((item: unknown) => {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        return [String(item)];
      incomplete = true;
      return [];
    });
    answers.push({ name: entry.name, values });
  }
  return { answers, incomplete };
}
