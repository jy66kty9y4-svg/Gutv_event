import assert from 'node:assert/strict';
import { participantsError } from '../app/participants-validation.ts';
for (const value of ['1', '5', '5 человек', '2 человека', '5 чел.', '5–10 человек', '5-10', '5 — 10 ЧЕЛ.', '  20 человек  ', '5-5']) assert.equal(participantsError(value), null, `Valid: ${value}`);
for (const value of ['', ' ', '-5', '−5', '0', '0.5', '0,5', '1.5', 'abc1', '5abc', '5 людей abc', '5-0', '10–5', '5--10', '5-10-15', '1e3', '+5', 'Infinity', 'NaN', '01', '5\nabc', '1'.repeat(81), 5, null, {}, ['5']]) assert.equal(typeof participantsError(value), 'string', `Invalid: ${JSON.stringify(value)}`);
console.log('PASS participant counts: positive integers/ranges, labels, range order, negatives, fractions, arbitrary input, types and length');
