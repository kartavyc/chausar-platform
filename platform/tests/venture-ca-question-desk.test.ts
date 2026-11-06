// CA7 fact-check notes: original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuestionNote } from '../runtime/venture/playbooks/ca-firm/question-desk.ts';
const note = { supports: [{ claim: 'The deduction has statutory conditions.', sourceIds: ['ita2025-123-80C'] }], conflicts: [], unknowns: ['The client has not provided the payment date.'], coverage: 'One deduction question; eligibility remains with the CA.' };
test('every supports/conflicts claim needs a real source id and every fact-check section is present', () => {
    assert.equal(checkQuestionNote(note, ['ita2025-123-80C']).passed, true);
    assert.equal(checkQuestionNote({ ...note, supports: [{ claim: 'Eligible.', sourceIds: ['invented'] }] }, ['ita2025-123-80C']).passed, false);
    assert.equal(checkQuestionNote({ ...note, conflicts: [{ claim: 'Other evidence conflicts.', sourceIds: [] }] }, ['ita2025-123-80C']).passed, false);
    assert.equal(checkQuestionNote({ ...note, coverage: '' }, ['ita2025-123-80C']).passed, false);
});
