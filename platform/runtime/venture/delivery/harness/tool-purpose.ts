// Chausar delivery harness: what each tool did, in the owner's words. A leaf module with no imports, so the run sheet
// (views/runs.ts) and the repeat-failure breaker (breaker.ts, which the loop loads) can both read it at load time
// without an import cycle reaching it before it is set. Moved here from views/runs.ts by Ink v2 wave 4 (4F2).

/** What each tool did, in the owner's words. */
export const TOOL_PURPOSE: Readonly<Record<string, string>> = Object.freeze({
  'files.list': "Looked at the client's files", 'files.read': 'Read a client file',
  'dictionary.browse': 'Looked up your business terms', 'dictionary.resolve': 'Checked what a term means',
  'calc.sum': 'Added up amounts with the calculator', 'calc.totals': 'Worked out totals with the calculator',
  'books.reconcile': 'Matched the bank statement to the bills', 'bills.pick': 'Picked bill amounts from PDFs',
  'sandbox.transform': 'Reshaped a table in the sandbox', 'sandbox.python': 'Ran a small program in a container',
  'handoff.client': 'Asked a question for the client', 'handoff.owner': 'Asked you a question',
  'outbox.propose': 'Proposed an outside action, held for you', 'agent.delegate': 'Asked for heavy work by your own tool',
  'tax.income': 'Worked out income tax with the calculator', 'tax.interest': 'Worked out interest on late tax with the calculator',
  'tax.gst': 'Worked out the GST working with the calculator', 'tax.tds': 'Worked out the TDS working with the calculator',
  'tax.statements': 'Matched the tax statements to the books', 'tax.portal': "Compared the portal's figures with the receipts",
  'youtube.hooks': 'Scored the hooks', 'youtube.editList': 'Built the edit list',
  'youtube.chapters': 'Drafted chapters from the pauses', 'youtube.retention': 'Read the retention export',
  'social.report': 'Worked out the report figures from the exports', 'evidence.record': 'Noted where a client fact came from',
});
