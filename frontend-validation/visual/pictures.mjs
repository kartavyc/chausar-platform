// The design's reference pictures and the preview state that draws each (used by capture.mjs,
// diff.mjs and the node tests; no imports, so a test can read it without Vite or Playwright).
/**
 * Each reference picture and the preview state that draws the same screen. `drive` names a
 * scripted walk for states an address alone cannot reach. `lane` is the lane that owns the screen.
 */
export const PICTURES = [
  { name: 'S01-Today', lane: 'frame-today', scenario: 'populated', view: 'guided', language: 'en', address: '#/today/today' },
  { name: 'S14-Today-Simple', lane: 'frame-today', scenario: 'populated', view: 'simple', language: 'hi', address: '#/today' },
  { name: 'S15-Today-Books', lane: 'frame-today', scenario: 'populated', view: 'books', language: 'en', address: '#/today' },
  { name: 'S09-Setup', lane: 'frame-today', scenario: 'first-run', view: 'guided', language: 'en', address: '', drive: 'meanings' },
  { name: 'S02-Answer', lane: 'ask', scenario: 'populated', view: 'guided', language: 'en', address: '#/ask/new' },
  { name: 'S03-Why', lane: 'ask', address: null, reason: 'other lane: the why-did-it-change bridge has no address of its own in the preview' },
  { name: 'S04-Approval', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/work/approvals' },
  { name: 'S05-Job', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/work/jobs' },
  { name: 'S06-Sources', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/sources' },
  { name: 'S07-Meaning', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/meanings' },
  { name: 'S08-History', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/history' },
  { name: 'S10-Trust', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/trust/rules' },
  { name: 'S11-People', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/trust/people' },
  { name: 'S12-SmallApp', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/tools/smallapps' },
  { name: 'S13-Plugin', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/tools/plugins' },
  { name: 'S16-Phone-Messages', lane: 'hosted-link', address: null, reason: 'not drawable: a message on the phone, outside the desktop app' },
  { name: 'S17-Phone-Page', lane: 'hosted-link', address: null, reason: 'not drawable: the paired phone page (after day 10)' },
  { name: 'S18-Enterprise-Home', lane: 'enterprise', address: null, reason: 'not drawable: the preview draws the desktop shell only' },
  { name: 'S19-CA-Console', lane: 'enterprise', address: null, reason: 'not drawable: the preview draws the desktop shell only' },
];
