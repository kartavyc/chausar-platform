// Canonical browser-safe types, shared by the engine and renderer.


export type KeyedPeopleServiceId = Exclude<PeopleServiceId, 'tofler'>;

export type PeopleServiceId = 'happenstance' | 'probe42' | 'tofler';

export type PeopleSearchView = { services: PeopleServiceView[]; line: string };

export type PeopleServiceView = {
  id: PeopleServiceId; name: string; covers: string; label: 'fixture-tested' | 'planned'; needs: string; docs: string;
  saved: { keyHint: string; savedAt: string } | null;
  planned: { waitsOn: string; meanwhile: string } | null;
};

export type SavedPeopleKeys = Partial<Record<KeyedPeopleServiceId, { keyHint: string; savedAt: string }>>;
