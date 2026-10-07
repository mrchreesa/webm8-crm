import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFormAnswers } from '../src/form-answers';

test('Meta arrays and legacy scalar answers remain readable', () => {
  assert.deepEqual(
    readFormAnswers(
      JSON.stringify([
        { name: 'services', values: ['Cleaning', 'Windows'] },
        { name: 'company', value: 'Legacy business' },
        { name: 'size', values: 0 },
        { name: 'optional' },
      ]),
    ),
    {
      answers: [
        { name: 'services', values: ['Cleaning', 'Windows'] },
        { name: 'company', values: ['Legacy business'] },
        { name: 'size', values: ['0'] },
        { name: 'optional', values: [] },
      ],
      incomplete: false,
    },
  );
});

test('malformed answers cannot take down a lead detail page', () => {
  for (const raw of ['{', 'null', '{}', '42'])
    assert.deepEqual(readFormAnswers(raw), { answers: [], incomplete: true });
  assert.deepEqual(
    readFormAnswers(
      JSON.stringify([null, {}, { name: 'mixed', values: ['Valid', { unexpected: true }] }]),
    ),
    { answers: [{ name: 'mixed', values: ['Valid'] }], incomplete: true },
  );
});
