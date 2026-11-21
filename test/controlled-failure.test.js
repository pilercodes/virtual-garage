import assert from 'node:assert/strict';
import { test } from 'node:test';

test('controlled GitHub test failure', () => {
  assert.equal('intentional failure', 'corrected');
});
