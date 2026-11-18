// Seen in the real app on Windows (17 Nov 2026, re-check 057): an agent hired by hand to draft Instagram captions for
// cake photos was offered Operations as its department. A hand hire started every draft in Operations; it now starts in
// the department its own job and duties speak of (team-proposal.ts departmentFor), and the owner still chooses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentFor } from '../runtime/venture/agents/team-proposal.ts';
import { agentBusiness, consent } from './venture-agent-helpers.ts';

const CAPTIONS = { name: 'Crumb', job: 'Drafts short Instagram captions for your cake photos.', duties: ['drafts caption options for you to review and post', 'suggests hashtags and wording for you to choose from', 'keeps a list of caption ideas for you'] };
const READS = { reads: [{ read: 'notes', why: 'To keep caption ideas.' }] };

test('marketing work by its own words: captions, social media, reels, ads and outreach copy', () => {
  const role = (job: string, duties: string[] = []) => departmentFor({ job, duties, reads: [] });
  assert.equal(role(CAPTIONS.job), 'marketing', 'the job alone names captions');
  assert.equal(role(CAPTIONS.job, CAPTIONS.duties), 'marketing');
  assert.equal(role('Plans your Instagram and Facebook reels.', ['Suggests hashtags for each reel']), 'marketing');
  assert.equal(role('Writes outreach copy and flyers for your approval.'), 'marketing');
  // Customers and follow ups stay in Sales and clients; nothing of the kind stays in Operations.
  assert.equal(role('Lists office customers for you.', ['Tracks follow ups with each lead']), 'sales');
  assert.equal(role('Keeps pottery orders organised for you.', ['Tracks pottery orders for you']), 'operations');
});

test('a hand hire starts in the department its drafted role speaks of, follows the owner\'s edit, and keeps the owner\'s choice', async () => {
  const env = await agentBusiness();
  await consent(env, 'story-editor');
  let role: unknown = CAPTIONS;
  env.models.respond['agent-chat'] = task => {
    if (task.schemaName === 'venture-hire-role') return role;
    if (task.schemaName === 'venture-hire-reads') return READS;
    return { tone: 'Warm', replyLength: 'short', greeting: '', handOffLine: '', blockedTopics: [], signOff: '' };
  };
  const made = await env.agents('venture.agents.hire.start', { sentence: 'someone who writes Instagram captions for my cake photos' });
  assert.equal(made.department, 'marketing');
  const reads = await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'role' });
  assert.equal(reads.department, 'marketing', 'the department picker opens on Marketing');
  // The owner rewrites the role: the default follows the words they kept.
  role = CAPTIONS;
  const other = await env.agents('venture.agents.hire.start', { sentence: 'someone for my customers' });
  const edited = await env.agents('venture.agents.hire.answer', { hireId: other.id, phase: 'role', edits: { job: 'Lists office customers for you.', duties: ['Tracks follow ups with each lead'] } });
  assert.equal(edited.department, 'sales');
  // The owner's own choice stands.
  const voice = await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'reads', edits: { department: 'operations' } });
  assert.equal(voice.department, 'operations');
});
