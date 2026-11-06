// Canonical browser-safe types, shared by the engine and renderer.


export type EditWord = { id: string; text: string; startMs: number; endMs: number };

export type EditDocument = {
  durationMs: number;
  words: EditWord[];
  cuts: (WordRange & { startMs: number; endMs: number; manual?: boolean })[];
  settings: { title?: string; layout?: string; captions?: string; hook?: WordRange; clips?: WordRange[]; zooms?: (WordRange & { scale: number })[] };
};

export type WordRange = { from: string; to: string };
