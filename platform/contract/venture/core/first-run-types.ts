// Canonical browser-safe types, shared by the engine and renderer.


export type FamilyId =
  | 'money-tax' | 'teaching' | 'creative' | 'writing' | 'local-services' | 'documents' | 'research' | 'people' | 'shop-office' | 'tech' | 'licensed';

export type FamilyOffer = { name: string; line: string };

export type NeedConnect = { kind: 'sign-in' | 'key' | 'guide' | 'none'; connectorId: string | null; place: 'connections' | 'connections/ai' | null };

export type NeedLabel = 'write' | 'read' | 'handoff' | 'planned';

export type NeedView = {
  id: string; name: string; why: string; label: NeedLabel; connect: NeedConnect;
  /** Planned only: who or what it waits on, and the manual path until then. */
  waitsOn: string | null; meanwhile: string | null;
  /** Never true: skipping every service still leaves a working business. */
  required: false;
};

export type NeedsList = { family: { id: FamilyId; label: string } | null; needs: NeedView[] };
