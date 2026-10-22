import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../../src/shell/routes';

describe('hash routes', () => {
  it('reads place, sub, sheet and filters', () => {
    expect(parseHash('#/work/runs?sheet=run:31&state=active')).toEqual({ place: 'work', sub: 'runs', sheet: { kind: 'run', id: '31' }, query: { state: 'active' } });
    expect(parseHash('#/today')).toEqual({ place: 'today', query: {} });
    expect(parseHash('#/money?sheet=receipt:R-0415')).toEqual({ place: 'money', sheet: { kind: 'receipt', id: 'R-0415' }, query: {} });
    expect(parseHash('#/business/plan')).toEqual({ place: 'business', sub: 'plan', query: {} });
  });

  it('anything unknown lands on Today, and a bad sheet is dropped', () => {
    expect(parseHash('')).toEqual({ place: 'today', query: {} });
    expect(parseHash('#token=abc')).toEqual({ place: 'today', query: {} });
    expect(parseHash('#/nowhere/x')).toEqual({ place: 'today', query: {} });
    expect(parseHash('#/today?sheet=<script>:1')).toEqual({ place: 'today', query: {} });
    expect(parseHash('#/today?sheet=run')).toEqual({ place: 'today', query: {} });
  });

  it('writes what it reads', () => {
    for (const hash of ['#/today', '#/work/runs?sheet=run%3A31&state=active', '#/team?sheet=agent%3Aeditor', '#/business/plan']) {
      expect(parseHash(formatHash(parseHash(hash)))).toEqual(parseHash(hash));
    }
    expect(formatHash({ place: 'work', sub: 'runs', sheet: { kind: 'run', id: '31' }, query: { state: 'active' } })).toBe('#/work/runs?sheet=run%3A31&state=active');
  });
});
