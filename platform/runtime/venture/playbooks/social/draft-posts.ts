// Chausar flagship playbook, social media agency: the posts of a drafted reply and the calendar slots they fill (Ink v2
// wave 2). The draft checks (playbooks/draft-checks.ts), the drafting task (delivery/playbook.ts flagshipDraft) and the
// calendar file read a draft's posts and its slots here, so they all number and date them the same way:
// - a post is a text line "Channel: text" (post-lines.ts postOfLine), numbered post-1, post-2, ... by counting the post
//   lines only, in text order: the count posting and share links use on the rendered draft (run-approvals.ts
//   postsOfText, where each post line is its own line), so '<run>.post-n' names one post everywhere;
// - the slots are planned by code from the order's calendar (calendar.ts planCalendar), never by a model;
// - for each channel, the nth post under Drafts takes the nth slot of that channel, so a post's date is its slot's.
import type { Deliverable, IsoDate, OrderIntake } from '../../contracts.ts';
import { planCalendar, type CalendarSlot } from './calendar.ts';
import { channelCapability, type SocialChannel } from './channels.ts';
import { postOfLine } from './post-lines.ts';

/** The section a drafting step writes its posts under (playbook.ts, the drafts step). */
export const DRAFTS_SECTION = 'Drafts';

export type SocialDraftPost = { id: string; section: string; channel: SocialChannel; text: string };
export type SlotFill = { post: SocialDraftPost; slot: CalendarSlot };
export type SlotAssignment = {
  slots: CalendarSlot[];
  /** Each post with the slot it fills, in the slots' order. */
  filled: SlotFill[];
  /** Plain lines for every channel whose post count differs from its slot count; empty when every slot has its post. */
  problems: string[];
};

/**
 * Every post a draft holds, in text order, numbered by counting post lines from 1 (an intro line before the first post
 * takes no number). Lines that name no channel are not posts.
 */
export function socialDraftPosts(deliverable: Pick<Deliverable, 'sections'>): SocialDraftPost[] {
  const posts: SocialDraftPost[] = [];
  for (const section of deliverable.sections) {
    for (const part of section.parts) {
      const post = part.kind === 'text' ? postOfLine(part.text) : null;
      if (post) posts.push({ id: `post-${posts.length + 1}`, section: section.heading, channel: post.channel, text: post.text });
    }
  }
  return posts;
}

/** The order's calendar slots, planned by code, or null when the order has no calendar. */
export function calendarSlots(intake: OrderIntake | null | undefined): CalendarSlot[] | null {
  return intake?.calendar ? planCalendar(intake.calendar) : null;
}

/** The slots planned from intake, or [] when there is no calendar or it can no longer be planned. Never throws. */
export function calendarSlotsOrNone(intake: OrderIntake | null | undefined): CalendarSlot[] {
  try { return calendarSlots(intake) ?? []; } catch { return []; }
}

/**
 * The posts the calendar counts: those under Drafts when the draft has that section (a line under Alt text that starts
 * with a channel's name is not a post for a slot), else every post.
 */
export function calendarPosts(deliverable: Pick<Deliverable, 'sections'>): SocialDraftPost[] {
  const posts = socialDraftPosts(deliverable);
  return deliverable.sections.some(section => section.heading === DRAFTS_SECTION) ? posts.filter(post => post.section === DRAFTS_SECTION) : posts;
}

/**
 * Which slot each post fills (posts: calendarPosts of the draft): for each channel in the calendar, its posts in text
 * order take its slots in order. A channel with fewer or more posts than slots, or posts on a channel the calendar does
 * not hold, is a problem line.
 */
export function assignSlots(posts: readonly SocialDraftPost[], slots: readonly CalendarSlot[]): SlotAssignment {
  const counted = [...posts];
  const channels = [...new Set([...slots.map(slot => slot.channel), ...counted.map(post => post.channel)])];
  const filled: SlotFill[] = [];
  const problems: string[] = [];
  for (const channel of channels) {
    const own = slots.filter(slot => slot.channel === channel);
    const drafted = counted.filter(post => post.channel === channel);
    const name = channelCapability(channel).name;
    if (!own.length) problems.push(`${name} has no slots in this calendar, and the draft has ${drafted.length} ${drafted.length === 1 ? 'post' : 'posts'} for it.`);
    else if (own.length !== drafted.length) problems.push(`${name} has ${own.length} ${own.length === 1 ? 'slot' : 'slots'} and ${drafted.length} ${drafted.length === 1 ? 'post' : 'posts'}.`);
    own.forEach((slot, index) => { if (drafted[index]) filled.push({ post: drafted[index], slot }); });
  }
  const order = new Map(slots.map((slot, index) => [slot.id, index]));
  filled.sort((a, b) => order.get(a.slot.id)! - order.get(b.slot.id)!);
  return { slots: [...slots], filled, problems };
}

/** The date of each post that fills a slot, by post id: the slot's date from code. */
export function postDates(assignment: SlotAssignment): ReadonlyMap<string, IsoDate> {
  return new Map(assignment.filled.map(item => [item.post.id, item.slot.date]));
}

/**
 * The drafting task's lines for a calendar order: each channel's slots with their ids and dates from code, in slot
 * order. The drafting step's own guidance says to write one post per slot and no dates (playbooks/steps.ts).
 */
export function calendarGuidance(slots: readonly CalendarSlot[]): string[] {
  const channels = [...new Set(slots.map(slot => slot.channel))];
  return channels.map(channel => `${channelCapability(channel).name} slots from code: ${slots.filter(slot => slot.channel === channel).map(slot => `${slot.id} on ${slot.date}`).join(', ')}.`);
}
