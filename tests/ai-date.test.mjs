import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiAssessmentDate } from '../src/lib/date/normalize-ai-assessment-date.ts';
const now = new Date('2026-09-20T00:00:00Z');
for (const [value, expected] of [
  ['2026-09-24', '2026-09-24'], ['2026. 9. 24.', '2026-09-24'],
  ['2026년 9월 24일 (목)', '2026-09-24'], ['26/9/24', '2026-09-24'],
  ['9월 24일', '2026-09-24'], ['2024-02-29', '2024-02-29'],
  ['2026-02-29', null], ['2026-04-31', null], ['2026-13-01', null],
  ['2026-00-01', null], ['날짜 미상', null], ['', null], [null, null],
  [undefined, null], ['2026-09-24 ~ 2026-09-25', null],
]) test(`AI date ${String(value)}`, () => assert.equal(normalizeAiAssessmentDate(value, now), expected));
