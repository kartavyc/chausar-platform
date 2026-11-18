import { describe, expect, it } from 'vitest';
import { kindOf } from '../../src/shell/BusinessMenu';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

/**
 * Re-check 082 (17 Nov 2026): a home baker of custom cakes for offices read "Local services" under the business name,
 * the field of salons and home visits. venture.get now says what the accepted plan sells (its first offer's own name,
 * platform/tests/venture-business-line-fix5.test.ts); the line says it after a way to earn, before the field.
 */
const t = (key: string) => ({ 'business.kind.other': 'Service business', 'business.kind.studio': 'Creative studio' }[key] ?? key);

describe('the line under the business name: what the plan sells', () => {
  it('says the way to earn first, then what the plan sells, then the field', () => {
    const venture = { serviceType: 'local-services' };
    expect(kindOf(t, { venture, sells: 'Custom cakes', field: { label: 'Local services' } })).toBe('Custom cakes');
    expect(kindOf(t, { venture, playbook: { id: 'own-way', label: 'Wedding films' }, sells: 'Custom cakes', field: { label: 'Local services' } })).toBe('Wedding films');
    expect(kindOf(t, { venture, field: { label: 'Local services' } })).toBe('Local services');
  });

  it('the fake says what its accepted plan sells, as the engine does', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const view = await client.request('venture.get', {});
    const plan = await client.request('venture.blueprint.get', {});
    expect(plan?.blueprint.status).toBe('accepted');
    expect(view?.sells).toBe(plan!.blueprint.offers[0]!.name.value);
    const fresh = createFakeClient(new FakeEngine({ fresh: true }));
    await fresh.request('workspace.create', { name: 'Indore Custom Cakes', pack: 'services', folder: null });
    await fresh.request('venture.create', { idea: 'I bake custom cakes and cupcakes from my home kitchen in Indore.', countryCode: 'IN', workingName: 'Indore Custom Cakes' });
    expect((await fresh.request('venture.get', {}))?.sells).toBeUndefined();
  });
});
