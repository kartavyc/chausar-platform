// Original Chausar ghostwriting verdict, shared by engine and browser rehearsal.
import { structureOf } from './structures-data.ts';
import { actualSocialPostLocations } from './post-label.ts';
/** Check every actual post against the selected pack size and declared structures. */
export function ghostwritingTextChecks(text: string, postCount: unknown): { check: string; outcome: 'pass' | 'fail'; detail: string }[] {
    let heading = '';
    const headings = text.split(/\r?\n/).map(line => {
        const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
        if (match) heading = match[2]!;
        return heading;
    });
    const posts = actualSocialPostLocations(text).map(post => ({ ...post, structure: structureOf(headings[post.lineIndex]!) }));
    // Voice/calendar chain artifacts do not contain posts; the final drafts stage supplies them.
    const expected = String(postCount ?? '8');
    const otherChannel = posts.some(post => post.channel !== 'linkedin');
    const count = ['8', '12'].includes(expected) && posts.length === Number(expected) && !otherChannel;
    const structures = posts.every(p => p.structure !== null) && new Set(posts.map(p => p.structure)).size === 5;
    return [{ check: 'ghostwriting-count', outcome: count ? 'pass' : 'fail', detail: 'The selected monthly pack contains exactly eight or twelve LinkedIn posts.' }, { check: 'ghostwriting-structure', outcome: structures ? 'pass' : 'fail', detail: 'Every post names one of the five structures and the pack uses all five.' }];
}
