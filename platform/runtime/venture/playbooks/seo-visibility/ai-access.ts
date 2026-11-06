// Chausar SEO access checks. seo-agent (MIT), GEOHub (AGPL ideas only); independently written.
// Vendor bot classifications read from official docs on 27 October 2026, linked in rules.ts. Never fetch as these bots.
export const AI_AGENTS = [
    { token: 'Googlebot', kind: 'search' }, { token: 'OAI-SearchBot', kind: 'search' },
    { token: 'Claude-SearchBot', kind: 'search' }, { token: 'PerplexityBot', kind: 'search' },
    { token: 'Google-Extended', kind: 'training' }, { token: 'GPTBot', kind: 'training' }, { token: 'ClaudeBot', kind: 'training' },
] as const;
/** Evaluate a published robots rule for a named product, without making a disguised request. */
export function botAllowed(robots: string, token: string, path: string): boolean {
    const groups: {
        agents: string[];
        rules: {
            allow: boolean;
            path: string;
        }[];
    }[] = [];
    let group: typeof groups[number] | undefined;
    let hasRules = false;
    for (const raw of robots.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const match = /^([^:]+):(.*)$/.exec(line);
        if (!match)
            continue;
        const field = match[1].trim().toLowerCase(), value = match[2].trim();
        if (field === 'user-agent') {
            if (!group || hasRules) {
                group = { agents: [], rules: [] };
                groups.push(group);
                hasRules = false;
            }
            group.agents.push(value.toLowerCase());
        }
        else if (group && (field === 'allow' || field === 'disallow')) {
            hasRules = true;
            if (value)
                group.rules.push({ allow: field === 'allow', path: value });
        }
    }
    const named = groups.filter(item => item.agents.includes(token.toLowerCase()));
    const selected = named.length ? named : groups.filter(item => item.agents.includes('*'));
    const matches = selected.flatMap(item => item.rules).filter(rule => {
        const end = rule.path.endsWith('$');
        const pattern = (end ? rule.path.slice(0, -1) : rule.path).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp('^' + pattern + (end ? '$' : '')).test(path);
    }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
    return matches[0]?.allow ?? true;
}
/** Visible plain text from raw HTML, bounded by the caller's guarded fetch limit. */
export function htmlText(html: string): string {
    return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Search and training access stay separate; unknown inputs never become a failed check. */
export function assessAiAccess(input: {
    robots: string | null;
    path: string;
    html: string | null;
    llms?: {
        status: number;
        contentType: string;
        text: string;
    } | null;
    cdnBlocked?: boolean | null;
}) {
    const agents = AI_AGENTS.map(agent => ({ ...agent, checkedOn: '2026-10-27', allowed: input.robots === null ? null : botAllowed(input.robots, agent.token, input.path) }));
    const search = agents.filter(agent => agent.kind === 'search');
    const findings: string[] = [];
    if (input.html !== null && htmlText(input.html).length < 80 && /<(?:div|main)[^>]*id=["'](?:root|app|__next)["']/i.test(input.html) && /<script\b/i.test(input.html))
        findings.push('empty-without-javascript');
    if (input.llms?.status === 200 && (/text\/html/i.test(input.llms.contentType) || /^\s*<(?:!doctype|html|head|body)/i.test(input.llms.text)))
        findings.push('llms-html-response');
    return {
        agents, search: { allowed: search.filter(agent => agent.allowed === true).length, of: search.length, unknown: search.filter(agent => agent.allowed === null).length }, findings,
        cdn: input.cdnBlocked === true || input.cdnBlocked === false
            ? { state: 'owner-settings', blocked: input.cdnBlocked, line: 'Read from the owner supplied CDN settings.' }
            : { state: 'manual-check', blocked: null, line: 'In Cloudflare, open Security, then Bots.' },
    };
}
