// Browser-only social intake and delivery preflight, matching the real order boundary.
import { fakeKitIntake } from './fake-kit-intake';
import { EngineError, type OfferIntakeLite, type OrderLite, type BlueprintViewLite, type CalendarIntakeLite } from './types';
import { localPathProblem } from '../../../../platform/runtime/local-paths';
import { socialSourceText } from '../../../../platform/runtime/venture/playbooks/social/source-text';
import { sourceInventory } from '../../../../platform/runtime/venture/playbooks/social/inventory';
import { communityDecision, requireCommunityGo } from '../../../../platform/runtime/venture/playbooks/social/community';
import { socialFormats } from '../../../../platform/runtime/venture/playbooks/social/formats';
function invalid(line: string): never { throw new EngineError('INVALID_VENTURE_REQUEST', line); }
function object(value: unknown, line: string): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(line);
 return value as Record<string, unknown>;
}
function calendarOf(value: unknown, key: string, today: string): CalendarIntakeLite {
 if (key !== 'content-calendar') invalid('This offer posts on no calendar, so it takes none.');
 const body = object(value, 'Send the calendar as its month, channels, posts per channel and weekdays.');
 const extra = Object.keys(body).find(name => !['month', 'channels', 'postsPerChannel', 'weekdays'].includes(name));
 if (extra) invalid(`The calendar has no field called ${extra}.`);
 const { month, channels, postsPerChannel, weekdays } = body;
 const match = typeof month === 'string' && /^(\d{4})-(\d{2})$/.exec(month);
 if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) invalid('Give the month like 2026-11.');
 if (!Array.isArray(channels) || !channels.length || new Set(channels).size !== channels.length || channels.some(channel => !['instagram','facebook','linkedin','x','threads','tiktok','youtube-shorts'].includes(channel))) invalid('Pick one or more channels, each once.');
 if (!Number.isInteger(postsPerChannel) || Number(postsPerChannel) < 1 || Number(postsPerChannel) > 31) invalid('Posts per channel is a whole number from one to thirty-one.');
 if (!Array.isArray(weekdays) || !weekdays.length || new Set(weekdays).size !== weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) invalid('Pick posting weekdays from Monday (1) to Sunday (7), each once.');
 const year = Number(match[1]), number = Number(match[2]), days: string[] = [];
 for (let day = 1; day <= new Date(Date.UTC(year, number, 0)).getUTCDate(); day++) if (weekdays.includes(((new Date(Date.UTC(year, number - 1, day)).getUTCDay() + 6) % 7) + 1)) days.push(`${month}-${String(day).padStart(2,'0')}`);
 if (Number(postsPerChannel) > days.length) invalid(`${month} has ${days.length} posting days on the weekdays you picked, fewer than the posts per channel. Add a weekday or post less.`);
 const past = Array.from({ length: Number(postsPerChannel) }, (_, i) => days[Math.floor(i * days.length / Number(postsPerChannel))]!).filter(day => day < today).sort();
 if (past.length) invalid(`The calendar for ${month} has posts on days before today, from ${past[0]}. Pick a later month.`);
 return { month: month as string, channels: [...channels], postsPerChannel: postsPerChannel as number, weekdays: [...weekdays] };
}
export function fakeSocialIntake(raw: unknown, ask: OfferIntakeLite, key: string, meta: { by: string; at: string; today: string; hosted?: boolean }, consents: () => import('./types').VoiceConsentsView = () => ({consents:[],line:''})): NonNullable<OrderLite['intake']> {
 const body = raw === undefined ? {} : object(raw, 'Send the intake as named fields.');
 const { fields, moneyRupees, ...base } = body;
 const own = fakeKitIntake({ fields, ...(ask.rights.length ? {rights:base.rights} : {}), ...(moneyRupees === undefined ? {} : { moneyRupees }) }, ask, consents, meta)!;
 const extra = Object.keys(base).find(name => !['rights','format','aiVoice','aiPresenter','paidPromotion','cutFile','calendar','clientRules'].includes(name));
 if (extra) invalid(`The intake has no field called ${extra}.`);
 if (!ask.rights.length && base.rights !== undefined && base.rights !== null) invalid('This offer cuts no footage, so it records no rights.');
 if (base.format !== undefined && base.format !== 'long' && base.format !== 'short') invalid('Choose a long video or Shorts.');
 const flag = (name: string, label: string) => { if (base[name] !== undefined && typeof base[name] !== 'boolean') invalid(`Say yes or no to ${label}.`); return base[name] === true; };
 const aiVoice = flag('aiVoice', 'an AI voice'), aiPresenter = flag('aiPresenter', 'an AI presenter'), paidPromotion = flag('paidPromotion', 'paid promotion');
 let cutFile: string | null = null;
 if (base.cutFile !== undefined && base.cutFile !== null) {
  if (meta.hosted) invalid("The hosted server can't read a file on your computer. Name the cut in the desktop app.");
  const problem = localPathProblem(base.cutFile, 'win32');
  if (problem) invalid(`The cut: ${problem}`);
  if (typeof base.cutFile !== 'string' || !/\.(mp4|mov|m4v|mkv|webm)$/i.test(base.cutFile)) invalid('Name the cut as a full path to an MP4, MOV, M4V, MKV or WEBM file on this computer.');
  cutFile = base.cutFile as string;
 }
 const calendar = base.calendar === undefined || base.calendar === null ? {} : { calendar: calendarOf(base.calendar, key, meta.today) };
 let rules = {};
 if (base.clientRules !== undefined && base.clientRules !== null) {
  const values = object(base.clientRules, "Send the client's word lists as named lists.");
  const names = ['bannedWords','bannedTopics','competitors','protectedPhrases'];
  const extra = Object.keys(values).find(name => !names.includes(name));
  if (extra) invalid(`The client's word lists have no list called ${extra}.`);
  rules = { clientRules: Object.fromEntries(names.map(name => {
   const raw = values[name] ?? [];
   if (!Array.isArray(raw) || raw.length > 50) invalid(`Send ${name} as a list of at most 50 entries.`);
   const words = raw.map(item => { const text = typeof item === 'string' ? item.trim().replace(/\s+/g,' ') : ''; if (!text || text.length > 80 || /[\u0000-\u001F\u007F]/.test(text)) invalid(`Each entry in ${name} is plain words of at most 80 characters.`); return text; });
   return [name, [...new Set(words)]];
  })) };
 }
 return { ...own, rights: own?.rights ?? null, format: base.format === 'short' ? 'short' : 'long', aiVoice, aiPresenter, paidPromotion, cutFile, ...calendar, ...rules };
}
export function fakeSocialPreflight(plan: BlueprintViewLite | null, order: OrderLite, files: { id: string; format: string; contentBase64: string }[]): void {
 if (plan?.playbook?.id !== 'social-agency') return;
 const key = plan.blueprint.offers.find(offer => offer.id === order.offerId)?.playbookOffer, fields = order.intake?.fields ?? {};
 try {
  if (key === 'community-replies') requireCommunityGo(communityDecision({ rules: typeof fields.communityRules === 'string' ? fields.communityRules : '', promotion: fields.communityPromotion as boolean, links: fields.communityLinks as boolean, flair: typeof fields.communityFlair === 'string' ? fields.communityFlair : '' }));
  if (key === 'repurpose-pack') {
   const file = files.find(file => file.id === fields.sourceFile);
   if (!file?.contentBase64) throw new EngineError('UPLOAD_NOT_FOUND', 'Add the source transcript to this order.');
   const raw = new TextDecoder().decode(Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0)));
   if (sourceInventory(socialSourceText(file.format, raw)).counts.total < 4) throw new EngineError('SOURCE_THIN', 'The source is too thin for a week of posts. Send a longer piece or a voice note.');
   socialFormats({ channels: fields.channels as Parameters<typeof socialFormats>[0]['channels'], footage: false, images: false });
  }
  if (fields.sellingCap !== undefined && !(typeof fields.sellingCap === 'string' && /^\d{1,3}$/.test(fields.sellingCap) && Number(fields.sellingCap) <= 100)) throw new EngineError('SOCIAL_INPUT_INVALID', 'The selling cap is a whole percentage from 0 to 100.');
 } catch (error) { if (error instanceof EngineError) throw error; const problem = error as Error & { code?: string }; throw new EngineError(problem.code ?? 'SOCIAL_INPUT_INVALID', problem.message); }
}
