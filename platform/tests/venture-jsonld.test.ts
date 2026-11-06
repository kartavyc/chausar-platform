// Ink v2 wave 5, package 5A5 (the JSON-LD builder SEO5 and Y11 use): structured data built only from fields observed on
// the page or recorded at intake, for an allowed list of types, validated and escaped for a script tag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSONLD_TYPES, jsonLdObject, jsonLdScript, type JsonLdNode } from '../runtime/venture/playbooks/kit/jsonld.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const page = (value: string) => ({ value, seen: 'page' as const, where: 'https://cafe.example.in/' });
const intake = (value: string) => ({ value, seen: 'intake' as const, where: 'businessName' });

test('the allowed types are the eight the plan lists', () => {
  assert.deepEqual([...JSONLD_TYPES], ['Organization', 'LocalBusiness', 'Product', 'Offer', 'Article', 'VideoObject', 'FAQPage', 'BreadcrumbList']);
});

test('a LocalBusiness from observed fields, with a nested address, comes out as schema.org JSON-LD', () => {
  const node: JsonLdNode = {
    type: 'LocalBusiness',
    fields: {
      name: intake('Cafe Aroma'), url: page('https://cafe.example.in/'), telephone: page('+91 20 1234 5678'),
      address: { type: 'PostalAddress', fields: { streetAddress: page('12 FC Road'), addressLocality: page('Pune'), postalCode: page('411004'), addressCountry: page('IN') } },
      sameAs: [page('https://www.instagram.com/cafearoma')],
    },
  };
  assert.deepEqual(jsonLdObject(node), {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Cafe Aroma', url: 'https://cafe.example.in/', telephone: '+91 20 1234 5678',
    address: { '@type': 'PostalAddress', streetAddress: '12 FC Road', addressLocality: 'Pune', postalCode: '411004', addressCountry: 'IN' },
    sameAs: ['https://www.instagram.com/cafearoma'],
  });
});

test('a type outside the allowed list is refused, at the top and nested where it does not belong', () => {
  assert.throws(() => jsonLdObject({ type: 'Event' as never, fields: { name: page('Launch') } }), code('JSONLD_TYPE_REFUSED'));
  assert.throws(() => jsonLdObject({ type: 'Question' as never, fields: { name: page('Why?') } }), code('JSONLD_TYPE_REFUSED'));
  assert.throws(() => jsonLdObject({ type: 'Product', fields: { name: page('Mug'), offers: { type: 'Review' as never, fields: {} } } }), code('JSONLD_TYPE_REFUSED'));
});

test('only observed fields: a value the model wrote, an unknown property or a bad value is refused', () => {
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { name: { value: 'Cafe', seen: 'model' as never, where: 'draft' } } }), code('JSONLD_UNOBSERVED'));
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { name: { value: 'Cafe', seen: 'page', where: '' } } }), code('JSONLD_UNOBSERVED'));
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { aggregateRating: page('5') } }), code('JSONLD_FIELD_REFUSED'));
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { url: page('javascript:alert(1)') } }), code('JSONLD_INVALID'));
  assert.throws(() => jsonLdObject({ type: 'VideoObject', fields: { name: page('Ep 1'), uploadDate: page('yesterday') } }), code('JSONLD_INVALID'));
  assert.throws(() => jsonLdObject({ type: 'Offer', fields: { price: page('about 500') } }), code('JSONLD_INVALID'));
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: {} }), code('JSONLD_INVALID'));
});

test('FAQPage and BreadcrumbList: questions, answers and list items only inside them; positions counted by code', () => {
  const faq = jsonLdObject({ type: 'FAQPage', fields: { mainEntity: [
    { type: 'Question', fields: { name: page('Do you deliver?'), acceptedAnswer: { type: 'Answer', fields: { text: page('Yes, within 5 km.') } } } },
  ] } });
  assert.deepEqual(faq, { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Do you deliver?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, within 5 km.' } }] });
  const crumbs = jsonLdObject({ type: 'BreadcrumbList', fields: { itemListElement: [
    { type: 'ListItem', fields: { name: page('Home'), item: page('https://cafe.example.in/') } },
    { type: 'ListItem', fields: { name: page('Menu'), item: page('https://cafe.example.in/menu') } },
  ] } });
  assert.deepEqual((crumbs.itemListElement as { position: number }[]).map(item => item.position), [1, 2]);
  assert.throws(() => jsonLdObject({ type: 'Article', fields: { headline: page('Hi'), mainEntity: [{ type: 'Question', fields: { name: page('x') } }] } }), code('JSONLD_FIELD_REFUSED'));
});

test('the script tag escapes </script>, angle brackets, ampersands and line separators inside values', () => {
  const SEP = String.fromCharCode(0x2028);
  const headline = `Tips </script><script>alert(1)</script> & more${SEP}here`;
  const script = jsonLdScript({ type: 'Article', fields: { headline: page(headline), datePublished: page('2026-10-01') } });
  assert.ok(script.startsWith('<script type="application/ld+json">') && script.endsWith('</script>'));
  const inner = script.slice('<script type="application/ld+json">'.length, -'</script>'.length);
  assert.equal(inner.includes('<'), false);
  assert.equal(inner.includes('>'), false);
  assert.equal(inner.includes('&'), false);
  assert.equal(inner.includes(SEP), false);
  assert.equal(JSON.parse(inner).headline, headline);
  assert.equal(script, jsonLdScript({ type: 'Article', fields: { headline: page(headline), datePublished: page('2026-10-01') } }), 'the same input gives the same text');
});

test('a value seen on a page names the page by its address; one from intake names its field', () => {
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { name: { value: 'Cafe', seen: 'page', where: 'the home page' } } }), code('JSONLD_UNOBSERVED'));
  assert.throws(() => jsonLdObject({ type: 'Organization', fields: { name: { value: 'Cafe', seen: 'page', where: 'javascript:void(0)' } } }), code('JSONLD_UNOBSERVED'));
  assert.equal(jsonLdObject({ type: 'Organization', fields: { name: { value: 'Cafe', seen: 'intake', where: 'businessName' } } }).name, 'Cafe');
});
