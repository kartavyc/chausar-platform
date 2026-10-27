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
  // Ink v2 wave 5 (package 5-0 wrote each line in this leaf file, so it keeps no imports; each package keeps its own)
  // the kit (5A3, 5A4, 5A6)
  'ideas.add': 'Added an idea to your list',
  'assets.record': 'Recorded where a delivered file came from',
  'media.clean': 'Removed location and camera data from a file',
  'localapp.run': 'Ran an app you installed, as you approved',
  'mail.read': 'Read imported mail',
  'speech.say': 'Made speech from text with your provider',
  // YouTube (5B1 to 5B3)
  'youtube.editOps': 'Applied the edit requests to the transcript',
  'youtube.clean': 'Found the silences and fillers to cut',
  'youtube.captions': 'Made captions from the word times',
  'youtube.coverage': 'Checked the take against the script',
  'youtube.dictionary': 'Checked names against your names list',
  'youtube.style': 'Measured the style of your videos',
  'youtube.clips': 'Picked clips that stand alone',
  'youtube.broll': 'Planned the b-roll beats',
  'youtube.beats': 'Timed the beats',
  'youtube.export': 'Wrote the edit files for your editor',
  'youtube.afterPublish': 'Read the Studio export after publishing',
  'youtube.outliers': 'Found the videos that did best',
  'youtube.niche': 'Worked out the niche figures',
  'youtube.comments': 'Sorted the comments',
  'youtube.publicStats': 'Read public video stats with your key',
  'youtube.archive': 'Searched your past transcripts',
  // the CA firm (5C1, 5C2)
  'tax.citations': 'Checked the section references',
  'tax.formChooser': 'Picked the ITR form',
  'tax.advance': 'Worked out advance tax dates and shares',
  'tax.whatIf': 'Compared tax under other choices',
  'books.healthCheck': 'Read every ledger line for problems',
  'docs.entry': 'Read a statement or bill into entries',
  // social (5D1 to 5D3)
  'social.formats': 'Picked each channel\'s format',
  'social.inventory': 'Listed what the source holds',
  'social.slots': 'Planned value and selling slots',
  'social.montage': 'Planned the reel from the clips',
  'social.inbox': 'Sorted the comments and messages',
  'social.diagnose': 'Checked a post against its export',
  'social.health': 'Read the account\'s health figures',
  'social.adStyle': 'Picked the ad style',
  'social.fairPrice': 'Worked out a fair creator price',
  'social.keywords': 'Grouped the keywords',
  // seo-visibility (5E1, 5E2)
  'seo.diagnose': 'Checked the client\'s site',
  'seo.aiAccess': 'Checked what AI fetchers can read',
  'seo.panel': 'Worked out the answer panel figures',
  'seo.siteCheck': 'Ran the website check',
  'seo.corroborate': 'Looked for a second source for each number',
  'seo.lint': 'Checked the article\'s words',
  'seo.meta': 'Drafted titles, descriptions and structured data',
  'seo.impact': 'Measured the change from the export',
  'seo.refresh': 'Planned which pages to refresh',
  'seo.local': 'Checked the business listings',
  // online-seller (5F1, 5F2, 5F3)
  'seller.unitEconomics': 'Worked out the profit per item',
  'seller.ads': 'Read the ads report',
  'seller.settlement': 'Checked the marketplace payouts',
  'seller.listing': 'Checked the listings',
  'seller.stage': 'Staged a listing change for you',
  'seller.alerts': 'Found what needs attention today',
  'seller.stock': 'Counted the stock',
  'seller.shortlist': 'Shortlisted products to research',
  'seller.catalogueSheet': 'Filled a marketplace upload sheet',
  'seller.multiStore': 'Compared the stores',
  // support-desk (5G)
  'support.match': 'Found the matching answer',
  'support.ticket': 'Updated a support ticket',
  // recruiting-desk (5H)
  'recruit.criteria': 'Turned the role into clear rules',
  'recruit.ledger': 'Updated the candidate ledger',
  'recruit.slots': 'Found interview times',
  // job-search-desk (5I)
  'career.facts': 'Listed the client\'s facts',
  'career.capture': 'Saved a job listing',
  'career.shortlist': 'Shortlisted jobs',
  'career.score': 'Scored a job against the client\'s facts',
  // translation-studio (5J1, 5J2)
  'translate.check': 'Checked the translation',
  'translate.terms': 'Checked the glossary terms',
  'subtitle.check': 'Checked the subtitles',
  'dub.align': 'Lined the dub up with the video',
  'dub.verify': 'Listened back to the dub',
  // bookkeeping-cfo (5K1, 5K2)
  'cfo.ratios': 'Worked out the money ratios',
  'cfo.scenarios': 'Worked out what-if cash',
  'collections.ladder': 'Planned the reminders for what is owed',
  'money.checkup': 'Ran the money check-up',
  'books.write': 'Wrote entries to the books, as you approved',
  'vouchers.draft': 'Drafted vouchers for you to approve',
  // podcast-to-article (5L)
  'article.ledger': 'Tied each sentence to the transcript',
  'article.style': 'Checked the article\'s style',
  // lead-generation (5M)
  'leads.osm': 'Found businesses on OpenStreetMap',
  'leads.enrich': 'Looked up a business\'s public details',
  'leads.dedupe': 'Removed duplicate leads',
  'community.vote': 'Counted the community\'s votes',
  // newsletter-studio (5N)
  'newsletter.presend': 'Checked the issue before it goes',
  'newsletter.import': 'Read the subscriber list',
  'newsletter.slices': 'Split the list into groups',
  'newsletter.stats': 'Read the issue\'s figures',
  // tender-desk (5O)
  'tender.questions': 'Listed every question in the tender',
  'tender.ground': 'Found each answer in the client\'s documents',
  // website-studio (5P)
  'site.requirements': 'Listed the site\'s requirements',
  'site.uiReport': 'Checked the site\'s screens',
  'site.flow': 'Checked the screen flow',
  'site.preview': 'Opened a preview of the site',
  // narration-studio (5Q)
  'narration.markup': 'Marked up the script for reading',
  'narration.verify': 'Listened back to the narration',
  // virtual-assistant (5R1)
  'va.brief': 'Wrote the client\'s brief',
  // data-entry-desk (5R2)
  'forms.map': 'Matched the fields to the form',
  'forms.readBack': 'Read back a saved record',
  // app-testing (5R3)
  'apptest.logcat': 'Read the app\'s logs',
  'demo.plan': 'Planned the demo video',
  // dev-agency (5R4)
  'qa.verdict': 'Gave the test verdict',
  'security.scan': 'Scanned the code for security problems',
  // monitored-data (5R5)
  'monitor.extract': 'Read the watched page',
  // it-triage (5R5)
  'triage.summary': 'Summed up the IT problem',
  // phone-receptionist (5R6)
  'calls.cost': 'Worked out the cost of calls',
  'calls.log': 'Logged a call',
});
