// Browser-safe LinkedIn structure data shared by drafting and rehearsal.
export const LINKEDIN_STRUCTURES = Object.freeze([
    { id: 'story', name: 'Story', beats: ['Situation', 'Turning point', 'Lesson', 'Question'] },
    { id: 'problem-solution', name: 'Problem and solution', beats: ['Problem', 'Why it matters', 'Practical solution', 'Next action'] },
    { id: 'how-to', name: 'How to', beats: ['Useful outcome', 'Steps', 'Caution', 'Try it'] },
    { id: 'contrarian', name: 'Different view', beats: ['Common belief', 'Different view', 'Source or experience', 'Question'] },
    { id: 'lesson', name: 'Lesson learned', beats: ['Experience', 'Mistake', 'Learning', 'Useful takeaway'] },
] as const);
export const LINKEDIN_GUIDANCE = 'For LinkedIn ghostwriting write exactly the selected eight or twelve posts. Use all five structures: ' + LINKEDIN_STRUCTURES.map(s => s.name + ' (' + s.id + '): ' + s.beats.join(', ')).join('; ') + '. Give each post a section heading Post N | Structure name and one text part starting LinkedIn:. Keep facts grounded in the client source. LinkedIn is copy-and-open only.';
export function structureOf(heading: string) { const name = heading.split('|').at(-1)?.trim().toLowerCase(); return LINKEDIN_STRUCTURES.find(s => s.id === name || s.name.toLowerCase() === name)?.id ?? null; }
export function ghostwritingSections(intake: { fields?: Record<string, unknown> } | null | undefined): string[] { const count = String(intake?.fields?.postCount ?? '8') === '12' ? 12 : 8; return Array.from({ length: count }, (_, n) => `Post ${n + 1} | ${LINKEDIN_STRUCTURES[n % 5]!.name}`); }
