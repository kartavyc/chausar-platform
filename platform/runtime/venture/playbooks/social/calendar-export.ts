// Chausar flagship playbook, social media agency: the calendar file (Ink v2 wave 2 package 2F2, catalogue S1 calendar
// export). venture.social.calendar { runId } (read) builds, by code, the CSV of a content calendar's posts from the
// approved draft only. Nothing here posts, schedules or stores anything: the owner imports the file into their own
// scheduler or copies from it.
// - The posts are the draft's as posting reads them (run-approvals.ts draftPostsOf: the words the client sees, ids
//   '<run>.post-<n>' counted over post lines only), so a row and a Post button name the same post, and a post goes in
//   exactly when posting would take it (draftApprovalsOfRun reads the client's answer on the whole draft).
// - The calendar counts only the posts under the Drafts heading when the draft has one, as the calendar check does
//   (draft-posts.ts calendarPosts). The owner's edit is plain text, so the headings are read from its '## ' lines: an
//   intro line is no post, and an Alt text line that starts with a channel's name is no post for a slot.
// - Each post takes its slot's date from code (calendar.ts planCalendar through draft-posts.ts assignSlots), never
//   from a model. The dates are days of the business's own calendar month; the approval times are the business's own
//   clock with its offset (local-day.ts localTimeAt), never UTC by default.
// - A post goes in only when the draft-before-schedule gate lets it (approvals.ts scheduleGate through run-approvals.ts
//   scheduleReasons): checks passed, the owner approved, the client approved, and its text is the approved text. Every
//   other post is listed with every reason. approvals.ts calendarExport makes the file and checks the gate again, on
//   the draft exactly as approved.
// - A post longer than one post on a channel with threads (X, Threads) is written as the numbered parts code split it
//   into (post-lines.ts threadParts), in one cell, only when the cell is written: the file keeps one row per post and
//   its six columns, and the screen says to post a thread by hand, part by part.
// - A cell that starts with a mark spreadsheets read as a formula gets an apostrophe first (calendarExport); the posts
//   it happened to are named, so the owner removes it before posting. The file starts with a UTF-8 byte order mark so a
//   spreadsheet on Windows reads emoji, the rupee sign and Devanagari right.
import { check, type Context } from '../../../contracts.ts';
import type { CountryProfile, IsoDate, SocialCalendarFile, VentureDeps } from '../../contracts.ts';
import { exactPayload, identifier, listRecords, readVenture } from '../../records.ts';
import { clientDraft } from '../../build/draft-text.ts';
import { localTimeAt } from '../../local-day.ts';
import { calendarExport, calendarText, startsLikeFormula, type CalendarItem } from './approvals.ts';
import { channelCapability } from './channels.ts';
import { DRAFTS_SECTION, assignSlots, calendarSlots } from './draft-posts.ts';
import { postOfLine, threadParts } from './post-lines.ts';
import { draftApprovalsOfRun, needsClientApproval, scheduleReasons, type RunPostApproval } from './run-approvals.ts';
import { SOCIAL_AGENCY_ID } from './registration.ts';

export const CALENDAR_WORDS = Object.freeze({
  notSocial: 'Only a social media draft has a calendar file.',
  noSlots: 'This order has no calendar, so code planned no slots. Only a content calendar order has a calendar file.',
  noDraft: 'This run has no draft yet. The calendar file comes from a draft you approved.',
  practice: 'A practice draft never goes to a client.',
  noSlot: 'This post has no slot in the calendar.',
});
/** A UTF-8 byte order mark: spreadsheets on Windows then read the file as UTF-8. */
const BOM = '﻿';
const HEADING = /^##[ \t]+(.+?)[ \t]*$/;

/**
 * The heading each post line of a text sits under, in post order (post lines counted as run-approvals.ts postsOfText
 * counts them; a '## ' heading line is never a post line), and whether the text has a Drafts heading at all.
 */
function postHeadings(text: string): { headings: string[]; hasDrafts: boolean } {
  const headings: string[] = [];
  let current = '';
  let hasDrafts = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = heading[1];
      hasDrafts ||= current === DRAFTS_SECTION;
    } else if (postOfLine(line)) headings.push(current);
  }
  return { headings, hasDrafts };
}

/**
 * One row's input for calendarExport, for a post the gate let through: the draft and its approval exactly as the gate
 * read them, so calendarExport's own gate checks the approved digest again. The thread parts go only into the cell. The
 * approval times are the business's own clock.
 */
function exportItem(item: RunPostApproval, date: IsoDate, country: Pick<CountryProfile, 'code'>): CalendarItem {
  const parts = threadParts(item.draft.channel, item.draft.text);
  const local = (at: string | null) => (at ? localTimeAt(at, country) : null);
  const { approval } = item;
  return {
    date, draft: item.draft, ...(parts ? { parts } : {}),
    approval: { ...approval, owner: { ...approval.owner, at: local(approval.owner.at) }, client: { ...approval.client, at: local(approval.client.at) } },
  };
}

/**
 * venture.social.calendar { runId } (read): the calendar file of a content calendar draft, built by code. csv holds a
 * row per post the draft-before-schedule gate lets through, in date order, each on its slot's date; blocked lists every
 * other calendar post with its channel, words and every reason, in text order; defused, threads and gaps say what the
 * owner should know before posting from the file. Refused for a draft that is not a social one
 * (CALENDAR_NOT_A_SOCIAL_DRAFT), an order with no calendar (CALENDAR_NO_SLOTS), a practice draft and a run with no
 * draft yet.
 */
export async function socialCalendarHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SocialCalendarFile> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Draft');
  const { state, venture } = readVenture(deps, ctx);
  const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === runId);
  check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
  const playbook = listRecords(state, 'venture-playbook', venture.id).find(item => item.id === run.playbookId);
  check(playbook?.flagship === SOCIAL_AGENCY_ID, 'CALENDAR_NOT_A_SOCIAL_DRAFT', CALENDAR_WORDS.notSocial);
  check(!run.practice, 'PRACTICE_DRAFT', CALENDAR_WORDS.practice);
  const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === run.orderId);
  const slots = calendarSlots(order?.intake);
  check(slots && order?.intake?.calendar, 'CALENDAR_NO_SLOTS', CALENDAR_WORDS.noSlots);
  const text = clientDraft(run).text;
  check(text && text.trim().length > 0, 'DELIVERY_NOT_READY', CALENDAR_WORDS.noDraft);

  const { headings, hasDrafts } = postHeadings(text);
  const counted = draftApprovalsOfRun(state, run.id).filter(item => !hasDrafts || headings[item.post.n - 1] === DRAFTS_SECTION);
  const assignment = assignSlots(counted.map(item => ({ id: item.post.draftId, section: headings[item.post.n - 1] ?? '', channel: item.post.channel, text: item.post.text })), slots);
  const dates = new Map(assignment.filled.map(fill => [fill.post.id, fill.slot.date]));
  const options = { clientApproval: needsClientApproval(state, run) };

  const blocked: SocialCalendarFile['blocked'] = [];
  const items: { draftId: string; item: CalendarItem }[] = [];
  for (const item of counted) {
    const { draftId, channel, text: words } = item.post;
    const name = channelCapability(channel).name;
    const date = dates.get(draftId);
    if (!date) {
      const problem = assignment.problems.find(line => line.startsWith(`${name} has `));
      blocked.push({ draftId, name, text: words, line: problem ? `${CALENDAR_WORDS.noSlot} ${problem}` : CALENDAR_WORDS.noSlot });
      continue;
    }
    const reasons = [...new Set(scheduleReasons(item, options).map(reason => reason.line))];
    if (reasons.length) blocked.push({ draftId, name, text: words, line: reasons.join(' ') });
    else items.push({ draftId, item: exportItem(item, date, venture.country) });
  }
  // assignment.filled is in slot order; calendarExport sorts by date and keeps slot order within a day.
  const slotOrder = (draftId: string) => assignment.filled.findIndex(fill => fill.post.id === draftId);
  items.sort((a, b) => slotOrder(a.draftId) - slotOrder(b.draftId));
  return {
    csv: `${BOM}${calendarExport(items.map(entry => entry.item), options)}`,
    fileName: `chausar-calendar-${order.intake.calendar.month}.csv`,
    rows: items.length,
    blocked,
    defused: counted.map(entry => entry.post.draftId).filter(id => items.some(entry => entry.draftId === id && startsLikeFormula(calendarText(entry.item)))),
    threads: counted.map(entry => entry.post.draftId).filter(id => items.some(entry => entry.draftId === id && entry.item.parts)),
    gaps: [...assignment.problems],
  };
}
