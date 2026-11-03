// A2: the tool edge accepts exactly two slips models often make when they call a tool, and coerces nothing else.
// 1. null for a field the schema lets the caller leave out and that does not itself take null: read as left out.
// 2. an array sent as JSON text, for a field whose schema is an array: read as that array.
// Only top-level fields of the tool's own schema are looked at. Required fields, numbers sent as text, strings, nested
// values and unknown fields are passed on unchanged, so the usual check refuses them as before.

export type Rule = { type?: unknown };
type Schema = { properties?: Record<string, Rule>; required?: unknown };

const takes = (rule: Rule, type: string) => rule.type === type || (Array.isArray(rule.type) && rule.type.includes(type));

/** The arguments with the two accepted slips undone; anything else is returned as it came. */
export function acceptModelSlips(schema: unknown, args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype) return args;
  // A2 review: an own __proto__ key is never copied (it would set a prototype); the arguments go on as they came.
  if (Object.hasOwn(args, '__proto__')) return args;
  const { properties = {}, required = [] } = (schema ?? {}) as Schema;
  const needed = new Set(Array.isArray(required) ? required : []);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const rule = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (rule && value === null && !needed.has(key) && !takes(rule, 'null')) continue;
    if (rule && typeof value === 'string' && takes(rule, 'array') && !takes(rule, 'string') && /^\s*\[/.test(value)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) { result[key] = parsed; continue; }
      } catch { /* not JSON: left as text for the check to refuse */ }
    }
    result[key] = value;
  }
  return result;
}
