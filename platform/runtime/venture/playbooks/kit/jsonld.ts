// Chausar playbook kit (Ink v2 wave 5, package 5A5): JSON-LD structured data for a client's page (SEO5's fixes, Y11's
// clip pages), built only from fields observed on the page or recorded at intake, never from what a model wrote. Each
// value names where it was seen. Only eight types are allowed at the top (Organization, LocalBusiness, Product, Offer,
// Article, VideoObject, FAQPage, BreadcrumbList), each with the properties listed here; a postal address, a question
// and its answer, and a breadcrumb's list item appear only inside the type they belong to, and a list item's position
// is counted by code. Values are validated (addresses are http or https, dates are dates, a price is a plain decimal)
// and the script text is escaped, so a value holding </script> can never end the tag. A parsed JSON-LD block is not a
// promise of rich results (the measurement-boundaries rule, P6). The idea (catalogue row SEO5) comes from seo-agent and
// beyondseo (both MIT); no code of theirs was read or copied. Written for Chausar from schema.org's published vocabulary.
import { ChausarError } from '../../../contracts.ts';

/** The types a JSON-LD block may have at its top. */
export const JSONLD_TYPES = Object.freeze(['Organization', 'LocalBusiness', 'Product', 'Offer', 'Article', 'VideoObject', 'FAQPage', 'BreadcrumbList'] as const);
export type JsonLdType = typeof JSONLD_TYPES[number];
/** Types that appear only inside another: an address, a question and its answer, a breadcrumb's item. */
export type JsonLdInnerType = 'PostalAddress' | 'Question' | 'Answer' | 'ListItem';
/** One value and where it was seen: on the client's page (where: its http or https address) or at intake (where: the field's id). */
export type JsonLdObserved = { value: string; seen: 'page' | 'intake'; where: string };
export type JsonLdValue = JsonLdObserved | JsonLdNode;
/** A node to build: its type and its fields, each an observed value, a nested node, or a list of them. */
export type JsonLdNode = { type: JsonLdType | JsonLdInnerType; fields: Readonly<Record<string, JsonLdValue | readonly JsonLdValue[]>> };

type ValueKind = 'text' | 'url' | 'date' | 'duration' | 'price' | 'currency' | 'availability';
type Property = { value: ValueKind; many?: true } | { nodes: readonly (JsonLdType | JsonLdInnerType)[]; many?: true };

const text: Property = { value: 'text' }, url: Property = { value: 'url' }, urls: Property = { value: 'url', many: true }, date: Property = { value: 'date' };
const organization: Property = { nodes: ['Organization'] };
const ORGANIZATION: Readonly<Record<string, Property>> = {
  name: text, url, logo: url, sameAs: urls, telephone: text, email: text, description: text, address: { nodes: ['PostalAddress'] },
};
/** Each type's properties, and which of them it needs. */
const SCHEMA: Readonly<Record<JsonLdType | JsonLdInnerType, { properties: Readonly<Record<string, Property>>; required: readonly string[] }>> = Object.freeze({
  Organization: { properties: ORGANIZATION, required: ['name'] },
  LocalBusiness: { properties: { ...ORGANIZATION, image: urls, openingHours: { value: 'text', many: true }, priceRange: text, areaServed: { value: 'text', many: true } }, required: ['name'] },
  Product: { properties: { name: text, description: text, image: urls, sku: text, url, brand: organization, offers: { nodes: ['Offer'], many: true } }, required: ['name'] },
  Offer: { properties: { price: { value: 'price' }, priceCurrency: { value: 'currency' }, availability: { value: 'availability' }, url, seller: organization }, required: ['price'] },
  Article: { properties: { headline: text, description: text, image: urls, datePublished: date, dateModified: date, url, mainEntityOfPage: url, author: { nodes: ['Organization'], many: true }, publisher: organization }, required: ['headline'] },
  VideoObject: { properties: { name: text, description: text, thumbnailUrl: urls, uploadDate: date, duration: { value: 'duration' }, contentUrl: url, embedUrl: url, url }, required: ['name'] },
  FAQPage: { properties: { name: text, mainEntity: { nodes: ['Question'], many: true } }, required: ['mainEntity'] },
  BreadcrumbList: { properties: { itemListElement: { nodes: ['ListItem'], many: true } }, required: ['itemListElement'] },
  PostalAddress: { properties: { streetAddress: text, addressLocality: text, addressRegion: text, postalCode: text, addressCountry: text }, required: [] },
  Question: { properties: { name: text, acceptedAnswer: { nodes: ['Answer'] } }, required: ['name', 'acceptedAnswer'] },
  Answer: { properties: { text }, required: ['text'] },
  ListItem: { properties: { name: text, item: url }, required: ['name'] },
});
const AVAILABILITY = new Set(['InStock', 'OutOfStock', 'PreOrder', 'SoldOut', 'LimitedAvailability', 'OnlineOnly', 'InStoreOnly'].map(name => `https://schema.org/${name}`));

function refuse(code: string, message: string): never {
  throw new ChausarError(code, message);
}

function isNode(value: JsonLdValue): value is JsonLdNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'fields' in value;
}

/** An observed value, checked: seen on the page or at intake, with where, and of its property's kind. */
function observedValue(value: JsonLdValue, kind: ValueKind, field: string): string {
  if (isNode(value)) refuse('JSONLD_INVALID', `${field} takes a value, not a block.`);
  const seen = value as Partial<JsonLdObserved>;
  if ((seen.seen !== 'page' && seen.seen !== 'intake') || typeof seen.where !== 'string' || !seen.where.trim() || seen.where.length > 300) {
    refuse('JSONLD_UNOBSERVED', `${field} must come from the page or the intake, with where it was seen. Chausar never adds structured data a model wrote.`);
  }
  if (seen.seen === 'page') {
    let page: URL | null = null;
    try { page = new URL(seen.where!); } catch { page = null; }
    if (!page || (page.protocol !== 'https:' && page.protocol !== 'http:')) refuse('JSONLD_UNOBSERVED', `${field} was seen on a page: name that page by its web address.`);
  }
  const raw = typeof seen.value === 'string' ? seen.value.trim() : '';
  if (!raw || raw.length > 5000) refuse('JSONLD_INVALID', `${field} is empty or too long.`);
  const ok = kind === 'text' ? true
    : kind === 'url' ? (() => { try { const parsed = new URL(raw); return parsed.protocol === 'https:' || parsed.protocol === 'http:'; } catch { return false; } })()
      : kind === 'date' ? /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(raw) && !Number.isNaN(Date.parse(raw.slice(0, 10)))
        : kind === 'duration' ? /^P(?=\d|T\d)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(raw)
          : kind === 'price' ? /^\d{1,12}(\.\d{1,2})?$/.test(raw)
            : kind === 'currency' ? /^[A-Z]{3}$/.test(raw)
              : AVAILABILITY.has(raw);
  if (!ok) refuse('JSONLD_INVALID', `${field} is not a valid ${kind === 'url' ? 'web address' : kind === 'price' ? 'price (a plain number such as 499.00)' : kind}.`);
  return raw;
}

function build(node: JsonLdNode, allowed: readonly string[], path: string): Record<string, unknown> {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string' || !allowed.includes(node.type) || !Object.hasOwn(SCHEMA, node.type)) {
    refuse('JSONLD_TYPE_REFUSED', `${path} cannot be a ${String(node?.type)} here. Chausar writes only ${JSONLD_TYPES.join(', ')}.`);
  }
  const schema = SCHEMA[node.type];
  const fields = node.fields ?? {};
  const out: Record<string, unknown> = { '@type': node.type };
  for (const [name, given] of Object.entries(fields)) {
    if (!Object.hasOwn(schema.properties, name)) refuse('JSONLD_FIELD_REFUSED', `${node.type} does not take ${name} here.`);
    const property = schema.properties[name];
    const list = Array.isArray(given) ? given as readonly JsonLdValue[] : [given as JsonLdValue];
    if (Array.isArray(given) && !property.many) refuse('JSONLD_INVALID', `${name} takes one value.`);
    if (!list.length || list.length > 100) refuse('JSONLD_INVALID', `${name} takes 1 to 100 values.`);
    const values = list.map(item => 'nodes' in property
      ? (isNode(item) ? build(item, property.nodes, `${path}.${name}`) : refuse('JSONLD_INVALID', `${name} takes a ${property.nodes.join(' or ')} block.`))
      : observedValue(item, property.value, name));
    if (node.type === 'BreadcrumbList' && name === 'itemListElement') values.forEach((item, index) => { (item as Record<string, unknown>).position = index + 1; });
    out[name] = Array.isArray(given) ? values : values[0];
  }
  for (const name of schema.required) if (!Object.hasOwn(out, name)) refuse('JSONLD_INVALID', `${node.type} needs ${name}.`);
  return out;
}

/** The JSON-LD object for a node of one of the allowed types, with its schema.org context. */
export function jsonLdObject(node: JsonLdNode): Record<string, unknown> {
  const built = build(node, JSONLD_TYPES, 'The block');
  const { '@type': type, ...rest } = built;
  return { '@context': 'https://schema.org', '@type': type, ...rest };
}

/**
 * The script tag for a page's head: the JSON with <, >, & and the two line separators written as \u escapes, so no
 * value can close the tag or start markup. The same node gives the same text.
 */
export function jsonLdScript(node: JsonLdNode): string {
  const json = JSON.stringify(jsonLdObject(node)).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<script type="application/ld+json">${json}</script>`;
}
