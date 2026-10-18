'use strict';
/* Chausar launch screens: connect an AI, say what you want to do, a plan drawn from checked blocks, then seven places.
   A classic deferred script that runs before app.js. It defines one frozen global and does no work until
   app.js calls create(kit): no document, storage, timer or network access when it loads.
   Engine values always become text nodes. The screen never does money arithmetic: every amount it shows is
   an engine display string, and every amount the owner types goes to the engine exactly as typed. */
globalThis.ChausarLaunch = Object.freeze({
  version: 1,
  create(kit) {
    const { h, request, navigate, renderShell, renderSetup, openExternal, reserveTab, saveText, state } = kit;
    /** True on the experimental hosted web server: no passphrase, no back office, keys held by the server's custody. */
    const hosted = kit.hosted === true;

    // ---------------------------------------------------------------------------------------------
    // Fixed words
    // ---------------------------------------------------------------------------------------------
    const pages = Object.freeze([
      ['today', 'Today', 'sun'], ['business', 'Your business', 'spark'], ['build', 'Build', 'grid'],
      ['clients', 'Clients', 'message'], ['agents', 'Agents', 'check'], ['money', 'Money', 'book'],
      ['connections', 'Connections', 'layers'],
    ].map(entry => Object.freeze(entry)));

    const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
    const KEY_LINE = 'Chausar keeps this in memory only. If your browser offers to save it, choose Never.';
    const OUTLINE_LINE = "Template outline. No AI wrote this and it doesn't read the client's request.";
    const PRACTICE_LINE = 'Practice draft. Not for the client.';
    const RECORDING_LINE = 'AI answers here come from a synthetic recording.';
    const BOTH_RECORDED_LINE = 'AI answers and GitHub reads here come from a synthetic recording.';
    const REPLIT_LINE = 'Replit receives the brief when its page opens.';
    // Built-in templates say so wherever they wrote the words, as the Add your AI sheet promises.
    const TEMPLATE_LINE = 'Written from built-in templates, not by AI.';
    const PASSPHRASE_LINE = 'Chausar locks your business with this passphrase. Nobody can reset it, so keep the recovery code you see next.';
    const CUSTODY_LINE = "Chausar's server keeps this business's vault key, sealed under your account. Keep the recovery code you see next.";
    const TEN_YEARS_LINE = 'Chausar keeps your records for ten years, as tax rules expect.';
    const RECOMMENDED = 'Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans: one Anthropic key';

    const LABEL_WORDS = { 'told-by-you': 'told by you', assumption: 'assumption', computed: 'computed' };
    const DONE_BY = { you: 'You', agent: 'An agent', 'agent-then-you': 'Agent drafts, you check' };
    const PRICING = [['monthly', 'Per month'], ['project', 'Per project'], ['hourly', 'Per hour']];
    const UNIT_WORDS = { month: 'per month', project: 'per project', hour: 'per hour' };
    const RAIL_NAMES = { razorpay: 'Razorpay', cashfree: 'Cashfree', paypal: 'PayPal', stripe: 'Stripe', 'lemon-squeezy': 'Lemon Squeezy', paddle: 'Paddle' };
    // Chausar does not take payments: the site carries pay links and the owner records each payment.
    // Tax names read lower case inside a sentence unless they are letters like GST or VAT.
    const taxInSentence = label => /^[A-Z]{2,}\b/.test(label || '') ? label : String(label || '').toLowerCase();
    const railWords = rail => `Clients pay through ${RAIL_NAMES[rail] || rail} links on your site, and you record each payment here.`;
    const BUILDER_NAMES = { lovable: 'Lovable', replit: 'Replit', bolt: 'Bolt', v0: 'v0' };
    const LINK_BUILDERS = ['lovable', 'replit'];
    const PRESET_NAMES = {
      'anthropic-haiku-5-5': 'Claude Haiku 5.5', 'anthropic-sonnet-5-5': 'Claude Sonnet 5.5', 'openai-gpt-6-luna': 'GPT-6 Luna',
      'claude-code-cli': 'Claude Code', 'codex-cli': 'Codex', 'built-in-templates': 'built-in templates',
    };
    /** Cheapest first: templates cost nothing, then the per-call price tables, then the tools on your own plan. */
    const PRESET_ORDER = ['built-in-templates', 'anthropic-haiku-5-5', 'openai-gpt-6-luna', 'anthropic-sonnet-5-5', 'claude-code-cli', 'codex-cli'];
    const AVAILABILITY_WORDS = { ready: 'ready', unverified: 'unverified', 'needs-setup': 'needs setup', unavailable: 'unavailable' };
    const CAPABILITY_WORDS = { available: 'available', 'needs-setup': 'needs setup', unverified: 'unverified', planned: 'planned', unavailable: 'unavailable' };
    const STAGE_WORDS = { rehearsal: 'Rehearsal', shadow: 'Shadow', 'approve-each': 'Approve each draft', 'approve-sample': 'Approve a sample', 'auto-spot-check': 'Auto with spot checks' };
    const STAGE_ORDER = ['rehearsal', 'shadow', 'approve-each', 'approve-sample', 'auto-spot-check'];
    /** A draft the engine treats as practice now. The engine says so in practiceNow; an older answer falls back to its rule:
        made as practice, or an agent draft read at any stage but approve each. */
    function practiceDraft(run, stage) {
      if (typeof run?.practiceNow === 'boolean') return run.practiceNow;
      return run?.practice === true || (run?.servedBy === 'model' && stage !== 'approve-each');
    }
    /** The engine refuses Accept on a practice draft and after any failed check, so the screen only offers Accept when it can work. */
    function acceptRefused(run, stage) {
      if (typeof run?.canAccept === 'boolean') return !run.canAccept;
      return practiceDraft(run, stage) || (run?.checks || []).some(check => !check.passed);
    }
    /** Whether a draft belongs on Today: the engine's awaitingYou, or the same rule worked out from the stage. */
    function awaitingOwner(run, stage) {
      if (typeof run?.awaitingYou === 'boolean') return run.awaitingYou;
      if (run?.status === 'waiting-for-you') return true;
      if (run?.status === 'needs-answer') return stage === 'shadow' || stage === 'approve-each';
      return run?.status === 'ready-for-review' && (!practiceDraft(run, stage) || stage === 'shadow');
    }
    const RUN_WORDS = { 'waiting-for-you': 'to approve', 'needs-answer': 'to answer', 'ready-for-review': 'to review', accepted: 'accepted', edited: 'edited', rejected: 'rejected', failed: 'failed' };
    const ORDER_WORDS = { open: 'open', invoiced: 'invoiced', delivered: 'delivered', cancelled: 'cancelled' };
    const BUILD_WORDS = {
      'waiting-for-repo': 'Waiting for the repo', 'repo-connected': 'Repo connected', 'builder-making-changes': 'The builder is making changes',
      quiet: 'No changes for a day or more', 'sync-conflict': 'Sync conflict', 'repo-not-readable': "Chausar can't read the repo",
    };
    const BY_WORDS = { lovable: 'Lovable', replit: 'Replit', you: 'you', 'repo-account': "the repo's account", other: 'another bot' };
    const MARKER_WORDS = { found: 'Brief marker found', older: 'Brief marker from an older brief', missing: 'Brief marker missing', 'not-checked': 'Brief marker not checked' };
    const UI_RUN_WORDS = { passed: 'UI check passed', failed: 'UI check failed', 'none-reported': 'No UI check runs yet', 'not-readable': "Can't read the UI check runs" };
    const WORKFLOW_WORDS = { 'needs-fix': 'The UI check workflow needs read-only permissions.', missing: 'The UI check workflow is missing.' };
    const CHECK_WORDS = {
      'no-numeric-prose': 'No numbers in the words', 'figures-resolve': 'Every price has a receipt', 'required-sections': 'Every section is there',
      'no-outside-writes': 'Nothing sent outside', 'house-style': 'House style', 'length-bounds': 'Length', 'turn-limit': 'Turn limit',
      'questions-raised': 'Asks what is missing', 'no-done-claims': 'No claims of finished work',
    };
    const REASON_WORDS = [
      ['wrong-fact', 'A fact is wrong'], ['missing-fact', 'A fact is missing'], ['missing-section', 'A section is missing'], ['off-brief', 'Off the brief'],
      ['tone', 'The tone is wrong'], ['format', 'The format is wrong'], ['too-long', 'Too long'], ['too-short', 'Too short'], ['wrong-number', 'A number is wrong'],
      ['late', 'Too late'], ['claims-work-not-done', 'Claims work that was not done'], ['other', 'Something else'],
    ];
    // The delivery harness: client files on an order, the agent's turns and tools, its questions, work receipts.
    const FORMAT_WORDS = { csv: 'CSV', xlsx: 'XLSX', pdf: 'PDF' };
    /** The engine's own limits for client files: one desktop request each once encoded, ten to an order. */
    /** The hosted server takes a request body of at most 256 KB, so a file there (sent base64) stays under 190 KB. */
    const MAX_FILE_BYTES = hosted ? 190000 : 1450000;
    const MAX_FILES = 10;
    const FILES_LINE = 'Files stay in your vault. Parts the agent reads go to your AI only in a turn you approve.';
    const TOOLS_LINE = 'Tools run on this computer between turns. Nothing reaches the client.';
    const ANSWER_LINE = 'Your answer goes into the next turn, which shows you its exact text first.';
    /** Where the reconciliation code attached to a report begins, as the engine renders it (reconciliationBlock). */
    const RECONCILIATION_HEAD = '\n\n## Reconciliation\n';
    /** What each tool did, in plain words. name is the file or table the call worked on, as the owner knows it. */
    const TOOL_WORDS = {
      'files.list': () => 'Listed the files', 'files.read': name => `Read ${name}`,
      'dictionary.browse': () => 'Searched your business dictionary', 'dictionary.resolve': () => 'Checked words in your business dictionary',
      'calc.sum': name => `Added up a column of ${name}`, 'calc.totals': name => `Totalled ${name} by group`,
      'books.reconcile': name => `Reconciled ${name} with the bills`, 'bills.pick': () => 'Picked bill totals from the PDFs',
      'sandbox.transform': name => `Ran a row program over ${name} in the light sandbox`, 'sandbox.python': name => `Ran Python over ${name} in a container`,
      'handoff.client': () => 'Asked the client a question', 'handoff.owner': () => 'Asked you a question',
      'outbox.propose': () => 'Proposed an outside action. Nothing was sent.',
    };
    /** The input field that names the file or table a tool works on. */
    const TOOL_TARGET = { 'files.read': 'target', 'calc.sum': 'table', 'calc.totals': 'table', 'books.reconcile': 'bank', 'sandbox.transform': 'table', 'sandbox.python': 'table' };
    const OUTCOME_WORDS = { failed: 'failed', cancelled: 'skipped', timedOut: 'took too long' };
    const IMPROVE_WORDS = { 'kept-candidate': 'Kept a new version', 'kept-parent': 'Kept the version in use', incomplete: 'Stopped before a change was tried' };
    const IMPROVE_LINE = 'It rehearses the version in use against one change, with practice clients and your AI, and keeps the change only if it wins.';
    const ADOPT_LINE = 'New drafts follow it. The version in use now stays stored.';
    const PAYMENT_METHODS = [['bank-transfer', 'Bank transfer'], ['upi', 'UPI'], ['card', 'Card'], ['cash', 'Cash'], ['payment-link', 'Payment link'], ['other', 'Other']];
    const EVENT_WORDS = {
      'venture-created': 'Business started', 'retention-changed': 'Records kept ten years', 'interview-updated': 'Plan answers saved',
      'blueprint-drafted': 'Plan drafted', 'blueprint-accepted': 'Plan accepted', 'model-connected': 'AI connected', 'model-disconnected': 'AI disconnected',
      'send-policy-changed': 'Send setting changed', 'price-quoted': 'Price worked out', 'client-added': 'Client added', 'order-created': 'Order added',
      'order-delivered': 'Order delivered', 'invoice-prepared': 'Invoice prepared', 'invoice-issued': 'Invoice issued', 'payment-recorded': 'Payment recorded',
      'brief-ready': 'Brief written', 'handoff-prepared': 'Handoff prepared', 'handoff-opened': 'Builder opened', 'repo-linked': 'Repo followed',
      'repo-synced': 'GitHub checked', 'playbook-ready': 'Playbook ready', 'simulation-finished': 'Rehearsal finished', 'launch-stage-changed': 'Stage changed',
      'delivery-waiting': 'Draft waiting', 'delivery-ready': 'Draft ready', 'delivery-reviewed': 'Draft reviewed', 'signal-recorded': 'Signal recorded',
    };
    /** A copy of INDIA_STATES in platform/runtime/venture/contracts.ts, for the state picker. A test compares them. */
    const INDIA_STATES = Object.freeze({
      '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
      '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
      '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
      '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
      '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
      '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
      '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
    });

    /** States by name. Object keys like '10' come before '01' in JavaScript, so the list is sorted here. */
    function stateOptions() {
      return Object.entries(INDIA_STATES).map(([code, name]) => [code, `${name} (${code})`]).sort((a, b) => a[1].localeCompare(b[1]));
    }

    // ---------------------------------------------------------------------------------------------
    // Small parts: text, rows, buttons, fields, the sheet, the still outline
    // ---------------------------------------------------------------------------------------------
    let fieldCount = 0;
    let openSheet = null;
    let lastActor = null;
    let sheetOpener = null; // the button behind the newest owner action, so a sheet it opened can hand focus back

    const note = (value, cls = 'launch-note') => h('p', { class: cls }, value);
    const square = kind => h('span', { class: `launch-sq ${kind}`, 'aria-hidden': 'true' });
    const chip = value => h('span', { class: 'launch-chip' }, value);
    const tag = line => h('span', { class: 'launch-label' }, LABEL_WORDS[line?.label] || 'assumption');
    const filled = (value, onclick, attrs = {}) => h('button', { class: 'launch-btn', type: 'button', onclick, ...attrs }, value);
    const quiet = (value, onclick, attrs = {}) => h('button', { class: 'launch-btn quiet', type: 'button', onclick, ...attrs }, value);
    const link = (value, onclick, attrs = {}) => h('button', { class: 'launch-link', type: 'button', onclick, ...attrs }, value);
    const actions = (...children) => h('div', { class: 'launch-actions' }, ...children);
    const statusLine = () => h('div', { class: 'launch-status', role: 'status', 'aria-live': 'polite' });
    const rows = (...children) => h('div', { class: 'launch-rows' }, ...children);
    const page = (...children) => h('div', { class: 'launch-page' }, ...children);
    /** Rows that open: the summary is all that shows at rest. */
    const fold = (summary, open, ...children) => h('details', { class: 'launch-more', open: open || null }, h('summary', {}, summary), h('div', { class: 'launch-more-body' }, ...children));
    const warn = value => h('p', { class: 'launch-warn' }, square('unsure'), h('span', {}, value));
    const figureOf = (holder, key) => (holder?.figures || []).find(item => item.key === key) || null;
    const presetName = (id, model) => PRESET_NAMES[id] || model || 'your AI';
    const experimental = () => state.status?.experimental === true;
    const plain = value => (typeof value === 'string' ? value : String(value ?? ''));
    const onLaunchPage = () => pages.some(([id]) => id === state.page) && Boolean(document.getElementById('page-content'));

    function head(eyebrow, title) {
      return h('header', { class: 'launch-head' }, eyebrow ? h('p', { class: 'launch-eyebrow' }, eyebrow) : null, h('h1', { class: 'launch-title' }, title));
    }
    function section(title, ...children) {
      return h('section', { class: 'launch-section' }, title ? h('h2', { class: 'launch-section-title' }, title) : null, ...children);
    }
    function row({ mark = 'off', title, label = null, note: rowNote = null, side = null, extra = null }) {
      return h('div', { class: 'launch-row' }, square(mark),
        h('div', { class: 'launch-row-main' }, h('span', { class: 'launch-row-title' }, title), label ? h('span', { class: 'launch-label launch-row-label' }, label) : null, rowNote ? h('span', { class: 'launch-row-note' }, rowNote) : null, extra),
        side ? h('div', { class: 'launch-row-side' }, side) : null);
    }
    function field(labelText, control, help) {
      if (!control.id) control.id = `launch-field-${++fieldCount}`;
      return h('div', { class: 'launch-field' }, h('label', { for: control.id }, labelText), control, help ? h('small', {}, help) : null);
    }
    function textInput(value = '', attrs = {}) { return h('input', { type: 'text', value, autocomplete: 'off', spellcheck: 'false', ...attrs }); }
    /** A key or token field: never inside a form, never offered to the password manager, cleared after each send. */
    function secretInput(labelText) { return h('input', { type: 'password', value: '', autocomplete: 'off', spellcheck: 'false', 'aria-label': labelText }); }
    function picker(options, value) {
      const node = h('select', {}, options.map(([optionValue, optionLabel]) => h('option', { value: optionValue }, optionLabel)));
      if (value != null) node.value = String(value);
      return node;
    }
    function choiceRow(options, current, onChange) {
      const group = h('div', { class: 'launch-choices', role: 'group' });
      const paint = selected => {
        group.replaceChildren(...options.map(([value, words]) => h('button', {
          type: 'button', class: `launch-choice${value === selected ? ' on' : ''}`, 'aria-pressed': value === selected ? 'true' : 'false',
          onclick: () => { paint(value); onChange(value); },
        }, words)));
      };
      paint(current);
      return group;
    }
    /** replaceChildren that skips empty parts: a browser would draw a null as the word "null". */
    function fill(host, ...items) { host.replaceChildren(...items.flat().filter(item => item != null && item !== false)); }
    function errorNodes(error, retry) {
      if (error?.code === 'REQUEST_TIMEOUT') return [h('p', { class: 'launch-wait' }, 'Still working. Check again in a minute.'), quiet('Check again', () => (retry || reread)())];
      const message = h('p', { class: 'launch-error', role: 'alert' }, plain(error?.message || error));
      return error?.code ? [message, h('span', { class: 'launch-code' }, error.code)] : [message];
    }
    function showError(host, error, retry) { if (host) host.replaceChildren(...errorNodes(error, retry)); }
    /** Runs one owner action: the button waits, errors appear as words where the action was, nothing toasts. */
    async function act(button, status, work, retry) {
      if (button) { lastActor = button; button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      if (status) status.replaceChildren();
      try { return await work(); }
      catch (error) { showError(status, error, retry); return undefined; }
      finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
    }
    async function settle(promise) { try { return { value: await promise }; } catch (error) { return { error }; } }
    function reread() { closeSheet(); return document.getElementById('page-content') ? navigate(state.page) : afterOpen(); }

    /** A still outline in the shape of the coming view: hairlines where text will be, no fill, no motion. */
    function outline(lines = 5) {
      return h('div', { class: 'launch-outline', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, index) => h('span', { class: `launch-outline-line w${index % 4}` })));
    }
    /** While slow work runs, the host shows an outline and one line of words. Under 100 ms nothing changes. */
    async function busy(host, words, work, lines = 5) {
      const before = Array.from(host.childNodes || host.children || []);
      let shown = false;
      const timer = typeof setTimeout === 'function'
        ? setTimeout(() => { shown = true; host.replaceChildren(outline(lines), h('p', { class: 'launch-status', role: 'status' }, words)); }, 100)
        : null;
      try { return await work(); }
      catch (error) { if (shown) host.replaceChildren(...before); throw error; }
      finally { if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer); }
    }

    /** Enough to find a control again after its page is drawn anew: its order, if any, and its words. */
    function focusKey(node) {
      if (!node || typeof node.closest !== 'function') return null;
      return { order: node.closest('[data-order]')?.getAttribute('data-order') || null, words: plain(node.textContent).trim() };
    }
    function findByFocusKey(key) {
      const host = key && document.getElementById('page-content');
      if (!host || typeof host.querySelectorAll !== 'function') return null;
      const order = key.order ? Array.from(host.querySelectorAll('[data-order]')).find(node => node.getAttribute('data-order') === key.order) : null;
      if (order && !order.open) return order.querySelector('summary');
      const controls = Array.from((order || host).querySelectorAll('button, summary'));
      const match = controls.find(node => plain(node.textContent).trim() === key.words);
      if (match) return match;
      return order ? order.querySelector('summary') : null;
    }
    function closeSheet() { const current = openSheet; openSheet = null; if (current) current.close(); }
    /** One sheet at a time, on the right. Esc or Close shuts it. It opens with focus on its title, so nothing is ringed at rest. */
    function sheet(title, body, onClose) {
      // A sheet that replaces another keeps the first one's opener; otherwise the opener is what has focus, or the button that acted.
      const inherited = openSheet ? sheetOpener : null;
      const active = typeof document.activeElement === 'object' && document.activeElement !== document.body ? document.activeElement : null;
      const opener = inherited || active || (lastActor?.isConnected ? lastActor : null);
      lastActor = null;
      closeSheet();
      sheetOpener = opener;
      const dialog = h('dialog', { class: 'launch-sheet', 'aria-label': title });
      dialog.append(h('div', { class: 'launch-sheet-head' }, h('h2', { class: 'launch-sheet-title', tabindex: '-1', autofocus: true }, title), link('Close', () => dialog.close())), h('div', { class: 'launch-sheet-body' }, body));
      const openerKey = focusKey(opener);
      dialog.addEventListener('close', () => {
        if (openSheet === dialog) openSheet = null;
        dialog.remove();
        // Focus goes back to what opened the sheet, or to its copy when the page was drawn again meanwhile.
        const refocus = () => {
          if (openSheet) return;
          const target = opener?.isConnected ? opener : findByFocusKey(openerKey);
          if (target && typeof target.focus === 'function') target.focus();
        };
        const after = onClose ? onClose() : undefined;
        if (after && typeof after.then === 'function') after.then(refocus, refocus); else refocus();
      });
      document.body.append(dialog);
      openSheet = dialog;
      dialog.showModal();
      return dialog;
    }

    /** The weekday and date for a day the engine names, in the same day basis as every other date on screen. */
    function dayLine(iso) {
      const date = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? plain(iso) : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    }
    function dayText(iso) {
      if (!iso) return '';
      const date = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? plain(iso) : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    function timeText(at) {
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) return '';
      return date.toDateString() === new Date().toDateString()
        ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    /** The business's time zone, as the books summary names it. Every date the engine fills in is a day in this zone. */
    let ownerZone = null;
    function rememberDay(summary) { if (typeof summary?.timeZone === 'string' && summary.timeZone) ownerZone = summary.timeZone; }
    /** Today on the owner's calendar, the engine's day basis, offered in date fields the owner can change. Before any
        books summary named the zone, it is this computer's own day. */
    function engineDate() {
      const now = new Date();
      if (ownerZone) {
        try {
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ownerZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
          if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
        } catch { /* an unknown zone falls back to this computer's day */ }
      }
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    async function copyText(value) {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') throw new Error('This window cannot copy. Use Save instead.');
      try { await navigator.clipboard.writeText(value); }
      catch { throw new Error('This window could not copy. Use Save instead.'); }
    }
    /** Where the vault sits, for the recovery code screen. The engine named the folder; Welcome back lists it. */
    function folderWords(folder) { return `Your encrypted vault is in the folder ${folder} on this computer. Welcome back lists it, so you never type it.`; }
    async function modelStatus() { try { return await request('venture.models.status'); } catch { return null; } }
    function servedByModel(status, tier = 'main') { const current = status?.tiers?.[tier]; return Boolean(current && current.presetId !== 'built-in-templates' && current.usable); }
    const replaying = models => models?.replay?.active === true;
    function recordingNote(models) { return replaying(models) ? note(RECORDING_LINE, 'launch-note launch-recording') : null; }
    /** Who writes, in words: the connected model, or in a demo the synthetic recording that answers in its place. */
    function writtenBy(models, presetId, model) { return replaying(models) ? 'from a synthetic recording' : `with ${presetName(presetId, model)}`; }

    // ---------------------------------------------------------------------------------------------
    // Onboarding, look B: connect an AI, one open box, a plan drawn from checked blocks, prices, keep it safe,
    // then the plan in the vault and Build. The left pane holds every word a person reads; the right pane only
    // repeats it with shapes. The AI chooses blocks and views; this code draws them and never invents a word.
    // ---------------------------------------------------------------------------------------------
    /** Copies of the onboarding contract (platform/runtime/venture/onboarding-contracts.ts). A test compares them. */
    const VIEWS = Object.freeze({
      'offers-first': Object.freeze({ role: 'lead', heading: 'What you sell', shape: 'cards', rows: 2 }),
      'steps-first': Object.freeze({ role: 'lead', heading: 'How the work gets done', shape: 'flow', rows: 3 }),
      'audience-first': Object.freeze({ role: 'lead', heading: 'Who it helps', shape: 'statement', rows: 2 }),
      pages: Object.freeze({ role: 'support', heading: 'Your website', shape: 'site', rows: 3 }),
      tools: Object.freeze({ role: 'support', heading: 'Tools to connect', shape: 'chips', rows: 3 }),
      questions: Object.freeze({ role: 'support', heading: 'Quick questions', shape: 'asks', rows: 2 }),
      notes: Object.freeze({ role: 'support', heading: 'Check before you start', shape: 'lines', rows: 2 }),
    });
    const KIND_LABELS = Object.freeze({ idea: 'Your idea, as a service', skill: 'Your skill, as a service', problem: 'A service that fixes this' });
    const AI_OPTION_IDS = Object.freeze(['api-key', 'claude-code', 'codex', 'chatgpt-sign-in']);
    const AI_STATUS_CHIPS = Object.freeze({ ready: 'Can connect', unverified: 'Can connect', 'needs-setup': 'Needs setup', unavailable: 'Not here', 'not-open': 'Not open yet' });
    const AI_UNCHECKED_LINE = 'Not yet checked with a live account.';
    const AI_HALF_CONNECTED_WORDS = 'Connected for quick work only.';
    const NOT_A_SERVICE_WORDS = 'Chausar plans services you sell to other people. Try saying what you could do for them.';
    /** AVAILABILITY_REASONS.claudeTerms in platform/runtime/venture/models/presets.ts: the Claude Code terms gate is closed. */
    const CLAUDE_TERMS_REASON = "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now.";
    const COMPOSE_REFUSED_WORDS = "The AI's answer failed Chausar's checks again. No plan was saved. Both tries are listed under What was sent.";
    /** The live preview's own fixed words. Every other word there is an engine answer or what the owner typed. */
    const PREVIEW_WORDS = Object.freeze({ name: 'Your business', line: 'Takes shape as you type.', unpriced: 'Price not set', beforeTax: 'before tax', locked: 'Encrypted on this computer' });
    /** A copy of SERVICE_TYPE_LABELS in platform/runtime/venture/contracts.ts: the kind of a kept plan, which stores only its id. */
    const SERVICE_TYPE_LABELS = Object.freeze({
      agency: 'Marketing agency', studio: 'Creative studio', consulting: 'Consulting practice', bookkeeping: 'Bookkeeping studio',
      research: 'Research desk', content: 'Content shop', support: 'Support team for hire', other: 'Service business',
    });
    /** Tool names from the composed plan's connector cards, for the kept plan, which stores only the tool ids. */
    const toolNames = {};
    const MEMORY_LINE = 'Chausar keeps this in memory until you keep your plan.';
    const CLEARED_LINE = 'Your AI and plan were only kept in memory, and they were cleared. Connect again.';
    const BUILT_IN_LINE = 'Built-in plan, not fitted to what you wrote.';
    const PAIR_LINE = 'One key: Claude Haiku 5.5 for quick work, Sonnet 5.5 for plans.';
    const MODEL_NAMES = Object.freeze({ 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'gpt-6-luna': 'GPT-6 Luna' });
    const WHO_CHIP = Object.freeze({ you: 'You', agent: 'Agent', 'agent-then-you': 'Agent drafts' });
    const PRICING_WORDS = Object.freeze({ monthly: 'per month', project: 'per project', hourly: 'per hour' });
    const PURPOSE_WORDS = Object.freeze({ decide: 'Reading what you wrote', compose: 'Writing your plan' });
    const CALL_WORDS = Object.freeze({ completed: 'answered', failed: 'failed', dispatching: 'sending', preview: 'not sent', expired: 'not sent' });
    /** A failed call in words that match why it failed: only the AI itself refuses; Chausar's checks reject. */
    const FAILED_CALL_WORDS = Object.freeze({ MODEL_OUTPUT_REJECTED: "failed Chausar's checks", MODEL_REFUSAL: 'refused' });
    /** A copy of OPEN_BOX_TEXT in platform/runtime/venture/onboarding-contracts.ts: the engine's length limits for the sentence. */
    const OPEN_BOX_TEXT = Object.freeze({ min: 10, max: 2000 });
    const TOO_SHORT_WORDS = 'Say a little more: at least 10 characters.';
    const TOO_LONG_WORDS = 'Keep it shorter: at most 2000 characters.';
    /** Errors from decide that are about what was typed, not the AI: they go back to the open box. */
    const OPEN_BOX_ERRORS = Object.freeze(['INVALID_VENTURE_REQUEST', 'UNKNOWN_COUNTRY']);
    const EXAMPLES = Object.freeze([
      ['Dog walking for nurses', 'Dog walking for busy nurses in Leeds.'],
      ["I'm good at Excel", "I'm good at Excel and I want to teach it."],
      ['Cafes lose track of bills', 'Small cafes lose track of their bills.'],
    ]);
    /** The five progress segments; only the current one shows its name. On this computer the vault is made without a
        step of its own when the plan is kept. Hosted web has no AI step before the vault and keeps its Keep safe step. */
    const PROGRESS = Object.freeze(hosted
      ? [['idea', 'Idea'], ['plan', 'Plan'], ['keep', 'Keep safe'], ['accept', 'Accept'], ['build', 'Build']]
      : [['ai', 'AI'], ['idea', 'Idea'], ['plan', 'Plan'], ['accept', 'Accept'], ['build', 'Build']]);
    const SEGMENT_OF = Object.freeze({
      ai: 'ai', idea: 'idea', working: 'plan', plan: 'plan', prices: 'plan', 'not-a-service': 'plan', refused: 'plan', error: 'plan',
      keep: hosted ? 'keep' : 'accept', code: hosted ? 'keep' : 'accept', setup: hosted ? 'keep' : 'accept', open: 'accept', build: 'build',
    });

    /** "with Claude Code (Sonnet 5.5)" for a tool on the owner's plan, else "with Claude Haiku 5.5". */
    function modelWords(presetId, model) {
      if (presetId === 'claude-code-cli' || presetId === 'codex-cli') return `with ${presetName(presetId)} (${MODEL_NAMES[model] || model})`;
      return `with ${presetName(presetId, model)}`;
    }
    /** "with Claude Haiku 5.5", "with Claude Code (Sonnet 5.5)", "with Codex (GPT-6 Luna)" or "from a synthetic recording". */
    function tierWords(models, tier) {
      const current = models?.tiers?.[tier];
      if (replaying(models)) return writtenBy(models);
      return modelWords(current?.presetId, current?.model);
    }
    /** The plan's author, from the plan's own writtenBy: who wrote it, even if the owner connected another AI since.
        Only a plan without writtenBy falls back to the live status. A replay plan says so. */
    function planByWords(plan, models) {
      const by = plan?.writtenBy;
      if (by?.replay) return 'from a synthetic recording';
      if (by?.presetId) return modelWords(by.presetId, by.model);
      return replaying(models) ? 'from a synthetic recording' : tierWords(models, 'main');
    }

    // The shapes on the right: six rects, x, y, width, height, corner, turn (degrees about the centre), colour, opacity.
    const SHAPES = Object.freeze({
      idle: [[98, 46, 38, 38, 9, 0, 'p', 1], [144, 46, 38, 38, 9, 0, 'p', 1], [98, 92, 38, 38, 9, 0, 'p', 1], [144, 92, 38, 38, 9, 0, 'p', 1], [129, 77, 22, 22, 11, 0, 's', 1], [204, 40, 12, 12, 6, 0, 'a', 0]],
      ai: [[118, 34, 44, 44, 8, 45, 'a', 1], [70, 82, 32, 32, 6, 45, 's', 1], [178, 82, 32, 32, 6, 45, 'p', 1], [124, 110, 32, 32, 6, 45, 'k', 1], [134, 88, 12, 12, 6, 0, 's', 1], [204, 40, 12, 12, 6, 0, 'a', 0]],
      bookkeeping: [[72, 30, 110, 128, 12, -6, 'p', 1], [92, 22, 110, 128, 12, 0, 'k', 1], [110, 46, 62, 10, 5, 0, 's', 1], [110, 68, 46, 10, 5, 0, 'p', 1], [168, 96, 60, 60, 30, 0, 's', 1], [52, 36, 18, 18, 9, 0, 'a', 1]],
      research: [[64, 106, 24, 52, 6, 0, 'p', 1], [96, 80, 24, 78, 6, 0, 'a', 1], [128, 56, 24, 102, 6, 0, 'p', 1], [150, 24, 82, 82, 41, 0, 's', 1], [208, 96, 16, 54, 8, -45, 'k', 1], [166, 40, 50, 50, 25, 0, 't', 1]],
      content: [[66, 24, 118, 132, 14, 0, 'a', 1], [86, 48, 70, 10, 5, 0, 'p', 1], [86, 70, 84, 10, 5, 0, 'p', 1], [86, 92, 48, 10, 5, 0, 'p', 1], [164, 92, 50, 50, 8, 45, 's', 1], [206, 32, 24, 24, 12, 0, 'k', 1]],
      consulting: [[60, 98, 82, 58, 10, -6, 'p', 1], [138, 98, 82, 58, 10, 6, 'a', 1], [133, 94, 14, 66, 7, 0, 'k', 1], [118, 30, 44, 44, 8, 45, 'k', 1], [169, 52, 4, 30, 2, 0, 'k', 1], [164, 80, 14, 14, 7, 0, 's', 1]],
      studio: [[58, 56, 82, 82, 14, -8, 'a', 1], [140, 34, 82, 82, 41, 0, 's', 1], [148, 98, 60, 60, 8, 45, 'k', 1], [214, 122, 20, 20, 10, 0, 'p', 1], [40, 36, 16, 16, 4, 0, 'p', 1], [110, 140, 40, 10, 5, 0, 'p', 1]],
      agency: [[56, 62, 92, 70, 12, -6, 'a', 1], [138, 36, 74, 74, 37, 0, 's', 1], [150, 108, 62, 42, 8, 0, 'k', 1], [70, 146, 140, 10, 5, 0, 'p', 1], [214, 40, 16, 16, 8, 0, 'p', 1], [44, 40, 18, 18, 4, 45, 'k', 1]],
      support: [[58, 34, 122, 72, 18, 0, 'a', 1], [108, 88, 112, 62, 18, 0, 's', 1], [80, 58, 62, 10, 5, 0, 'p', 1], [130, 112, 52, 10, 5, 0, 'k', 1], [214, 34, 18, 18, 9, 0, 'p', 1], [46, 126, 20, 20, 10, 0, 'k', 1]],
      other: [[80, 92, 120, 66, 12, 0, 'a', 1], [100, 54, 80, 46, 10, 0, 's', 1], [120, 24, 40, 36, 8, 0, 'k', 1], [60, 148, 160, 10, 5, 0, 'p', 1], [214, 52, 20, 20, 10, 0, 'p', 1], [52, 62, 16, 16, 8, 0, 'p', 1]],
      lockOpen: [[124, 16, 64, 72, 32, 0, 'k', 1], [136, 28, 40, 60, 20, 0, 't', 1], [88, 80, 104, 80, 16, 0, 'a', 1], [128, 100, 24, 24, 12, 0, 't', 1], [135, 112, 10, 28, 5, 0, 't', 1], [110, 60, 100, 20, 0, 0, 't', 1]],
      lockShut: [[108, 34, 64, 78, 32, 0, 'k', 1], [120, 46, 40, 66, 20, 0, 't', 1], [88, 80, 104, 80, 16, 0, 'a', 1], [128, 100, 24, 24, 12, 0, 't', 1], [135, 112, 10, 28, 5, 0, 't', 1], [110, 80, 100, 0, 0, 0, 't', 0]],
    });
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs = {}, ...children) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));
      for (const child of children.flat()) if (child) node.append(child);
      return node;
    }
    /** Motion is off when the computer asks for less of it, and in any window that cannot run it. */
    function calm() {
      try { return typeof globalThis.matchMedia !== 'function' || typeof globalThis.requestAnimationFrame !== 'function' || globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch { return true; }
    }
    const round = value => String(Math.round(value * 100) / 100);
    let lastShapes = null;
    let shapeFrame = 0;
    /** Draws a shape set into every given rect group: colours by class and geometry by attributes, never an inline style. */
    let shapeKey = 'idle';
    function paintShapes(groups, key) {
      shapeKey = SHAPES[key] ? key : 'idle';
      const def = SHAPES[key] || SHAPES.idle;
      def.forEach(([, , , , , , colour], index) => groups.forEach(rects => rects[index].setAttribute('class', `ob-sh ob-sh-${colour}`)));
      const target = def.map(([x, y, w, hgt, rx, turn, , opacity]) => [x, y, w, hgt, rx, turn, opacity]);
      const draw = geometry => geometry.forEach(([x, y, w, hgt, rx, turn, opacity], index) => groups.forEach(rects => {
        const rect = rects[index];
        rect.setAttribute('x', round(x)); rect.setAttribute('y', round(y));
        rect.setAttribute('width', round(Math.max(0, w))); rect.setAttribute('height', round(Math.max(0, hgt)));
        rect.setAttribute('rx', round(Math.max(0, rx))); rect.setAttribute('opacity', round(opacity));
        rect.setAttribute('transform', `rotate(${round(turn)} ${round(x + w / 2)} ${round(y + hgt / 2)})`);
      }));
      const from = lastShapes;
      lastShapes = target;
      if (shapeFrame && typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(shapeFrame);
      shapeFrame = 0;
      if (!from || calm()) { draw(target); return; }
      draw(from);
      let start = null;
      const step = now => {
        if (start === null) start = now;
        const t = Math.min(1, Math.max(0, (now - start) / 360));
        const eased = 1 - (1 - t) * (1 - t) * (1 - t);
        draw(from.map((values, index) => values.map((value, at) => value + (target[index][at] - value) * eased)));
        shapeFrame = t < 1 ? globalThis.requestAnimationFrame(step) : 0;
      };
      shapeFrame = globalThis.requestAnimationFrame(step);
    }
    const sixRects = () => Array.from({ length: 6 }, () => svg('rect'));
    function lockMark() {
      return svg('svg', { viewBox: '0 0 14 14', class: 'ob-lock-mark', 'aria-hidden': 'true' },
        svg('rect', { x: 2, y: 6, width: 10, height: 7, rx: 2 }), svg('path', { d: 'M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6', class: 'ob-lock-loop' }));
    }
    function arrowMark() {
      return svg('svg', { viewBox: '0 0 24 24', class: 'ob-arrow', 'aria-hidden': 'true' }, svg('path', { d: 'M5 12h14M13 6l6 6-6 6' }));
    }
    function brandMark() {
      return h('img', { src: './assets/icon.svg', alt: '', width: 28, height: 28, class: 'ob-brand-mark' });
    }

    let firstFrame = true;
    let card = null;
    /** The progress segment and the lock badge of the last frame: each moves only when it changes, so motion happens once. */
    let lastSegment = null;
    let lastLocked = false;

    // ---------------------------------------------------------------------------------------------
    // The live preview on the right (preview words start). It shows the business coming together in real words: the
    // kind, the name, the one line, the offers with their prices and a small website card. Every word is an engine
    // answer, what the owner typed, or PREVIEW_WORDS. A price is the engine's display string or the owner's own text,
    // never worked out here. The pane stays aria-hidden: everything in it is also on the left or was just typed there.
    // ---------------------------------------------------------------------------------------------
    /** What the last frame's preview showed, so an offer row slots in and a price fades only when it is new. */
    let lastPreview = null;
    const SLOT_DELAYS = Object.freeze(['ob-k-1', 'ob-k-2', 'ob-k-3', 'ob-k-4', 'ob-k-5', 'ob-k-6']);
    const previewOffer = (id, name, model, price = null) => ({ id, name, per: PRICING_WORDS[model] || null, price });
    /** A price before tax, exactly as the engine formatted it. */
    const typedPrice = display => (display ? { figure: plain(display), after: PREVIEW_WORDS.beforeTax } : null);
    /** The total line of an engine price receipt: its label and its display, as given. */
    const receiptPrice = receipt => { const total = figureOf(receipt, 'total'); return total ? { before: plain(total.label), figure: plain(total.display) } : null; };
    /** The composed plan before the vault: the engine's kind label, name, one line, offers and website pages. */
    function planPreview(plan) {
      return {
        kind: plan.familyLabel, name: plan.name.value, line: plan.oneLiner.value,
        offers: plan.offers.map(offer => previewOffer(offer.id, offer.name.value, offer.pricing.model, typedPrice(offer.priceDisplay))),
        site: { pages: (plan.pages || []).map(item => item.title.value) },
      };
    }
    /** The built-in plan: template words, and the owner's price exactly as typed beside the currency code. */
    function templatePreview(preview, typed = '', name = null) {
      const price = plain(typed).trim();
      return {
        kind: preview.serviceLabel, name, line: preview.oneLiner.value,
        offers: preview.offers.map((offer, index) => previewOffer(offer.id, offer.name.value, offer.pricing?.model,
          index === 0 && price ? { figure: `${preview.country.currency} ${price}`, after: PREVIEW_WORDS.beforeTax } : null)),
        site: { pages: [] },
      };
    }
    /** The kept plan in the vault: its kind from the contract's labels, the business's name, and each receipt's total. */
    function blueprintPreview(view, blueprintView) {
      const plan = blueprintView.blueprint;
      const receipts = blueprintView.offerReceipts || {};
      return {
        kind: SERVICE_TYPE_LABELS[plan.serviceType] || null,
        name: plain(view?.venture?.workingName).trim() || plain(state.workspace?.name).trim() || plan.name.value,
        line: plan.oneLiner.value,
        offers: plan.offers.map(offer => previewOffer(offer.id, offer.name.value, offer.pricing.model, receipts[offer.id] ? receiptPrice(receipts[offer.id]) : null)),
        site: { pages: (plan.pages || []).map(item => item.title.value) },
      };
    }
    /** The card body and the website card for one preview. null draws shapes only, with no words. */
    function previewParts(preview, outline) {
      const before = lastPreview;
      const seen = before?.offers || new Map();
      const prices = new Map();
      if (!preview) {
        lastPreview = { offers: prices, site: false };
        return { body: [h('div', { class: 'ob-cblank' }, h('i'), h('i'))], site: null };
      }
      const placeholder = !preview.name;
      const kind = preview.kind ? h('p', { class: 'ob-ckind' }, preview.kind) : null;
      const name = h('h2', { class: placeholder ? 'ob-cname ob-ph' : 'ob-cname' }, preview.name || PREVIEW_WORDS.name);
      const lineWords = preview.line || (placeholder ? PREVIEW_WORDS.line : '');
      const line = h('p', { class: preview.line ? 'ob-ctag' : 'ob-ctag ob-ph', hidden: lineWords ? null : true }, lineWords);
      // New rows slot in one after another, by their order among the new rows (a fixed list of delay classes).
      const freshIds = before ? (preview.offers || []).map(offer => offer.id).filter(id => !seen.has(id)) : [];
      const offerRows = (preview.offers || []).map(offer => {
        const priceKey = offer.price ? `${offer.price.before || ''}|${offer.price.figure}` : '';
        prices.set(offer.id, priceKey);
        const fresh = !seen.has(offer.id);
        const changed = !fresh && seen.get(offer.id) !== priceKey && Boolean(priceKey);
        const cls = ['ob-coffer'];
        if (fresh && before) cls.push('ob-slot', SLOT_DELAYS[freshIds.indexOf(offer.id)] || SLOT_DELAYS[5]);
        const price = offer.price
          ? h('p', { class: changed ? 'ob-cprice ob-cprice-new' : 'ob-cprice' },
            offer.price.before ? h('span', { class: 'ob-cpre' }, offer.price.before) : null, h('b', {}, offer.price.figure),
            offer.price.after ? h('span', { class: 'ob-cpost' }, offer.price.after) : null)
          : h('p', { class: 'ob-cprice ob-unset' }, PREVIEW_WORDS.unpriced);
        return h('li', { class: cls.join(' '), 'data-offer': offer.id },
          h('div', { class: 'ob-ctop' }, h('span', { class: 'ob-coname' }, offer.name), offer.per ? h('span', { class: 'ob-cper' }, offer.per) : null), price);
      });
      const offers = offerRows.length
        ? h('ul', { class: 'ob-coffers' }, offerRows)
        : h('div', { class: 'ob-coffers ob-cempty' }, h('i'), h('i'));
      let site = null;
      if (outline) site = h('div', { class: 'ob-site ob-card-outline' }, h('div', { class: 'ob-bar' }, h('i'), h('i'), h('i'), h('span', { class: 'ob-saddr' })),
        h('div', { class: 'ob-snav' }, h('em'), h('i'), h('i'), h('i')), h('div', { class: 'ob-sbody' }, h('i'), h('i'), h('i')));
      else if (preview.site) {
        const pages = (preview.site.pages || []).slice(0, 4);
        const siteOffers = (preview.offers || []).slice(0, 2);
        site = h('div', { class: before && !before.site ? 'ob-site ob-site-new' : 'ob-site' },
          h('div', { class: 'ob-bar' }, h('i'), h('i'), h('i'), h('span', { class: 'ob-saddr' })),
          h('div', { class: 'ob-snav' }, h('em'), h('span', { class: placeholder ? 'ob-sname ob-ph' : 'ob-sname' }, preview.name || PREVIEW_WORDS.name)),
          pages.length ? h('ul', { class: 'ob-spages' }, pages.map(title => h('li', {}, title))) : h('div', { class: 'ob-spages ob-cempty' }, h('i'), h('i'), h('i')),
          preview.line ? h('p', { class: 'ob-shead' }, preview.line) : h('div', { class: 'ob-shead ob-cempty' }, h('i')),
          siteOffers.length
            ? h('ul', { class: 'ob-soffers' }, siteOffers.map(offer => h('li', {}, h('b', {}, offer.name), offer.price ? h('span', {}, offer.price.figure) : null)))
            : h('div', { class: 'ob-soffers ob-cempty' }, h('i'), h('i')));
      }
      lastPreview = { offers: prices, site: Boolean(site) };
      return { body: [kind, name, line, offers], site };
    }
    // (preview words end)

    /**
     * The look B frame: header (brand and progress), the left pane with every reading word, the phone strip, and the
     * right pane with the live preview. Returns the left pane's inner host. spec.preview says what the preview shows.
     */
    function obFrame(step, content, spec = {}) {
      closeSheet();
      state.generation++;
      const segment = SEGMENT_OF[step];
      const at = segment ? PROGRESS.findIndex(([id]) => id === segment) : -1;
      const newSegment = segment !== lastSegment;
      lastSegment = segment || null;
      const progress = at < 0 ? null : h('nav', { class: 'ob-progress', 'aria-label': 'Progress', 'data-count': `${at + 1}/${PROGRESS.length}` },
        h('ol', {}, PROGRESS.map(([id, words], index) => h('li', {
          class: index === at ? (newSegment ? 'now ob-seg-new' : 'now') : index < at ? 'done' : null, 'aria-current': index === at ? 'step' : null,
          'aria-label': index === at ? null : `${words}, ${index < at ? 'done' : 'not yet'}`,
        }, h('span', { class: 'ob-seg', 'aria-hidden': 'true' }, h('i')), index === at ? h('span', { class: 'ob-seg-name' }, words) : null))));
      const top = h('header', { class: 'ob-top' }, h('div', { class: 'ob-brand' }, brandMark(), h('span', {}, 'Chausar')), progress);
      const ask = h('div', { class: 'ob-ask-in' });
      const items = content.flat().filter(item => item != null && item !== false);
      let rise = 0;
      for (const item of items) {
        if (typeof item === 'object' && item.classList && rise < 6) item.classList.add(`ob-in-${++rise}`);
        ask.append(item);
      }
      let preview = spec.preview === undefined ? null : spec.preview;
      // The phone strip: the small shapes, then the kind and the name once the plan has them, and the lock mark once kept.
      const stripRects = sixRects();
      const stripWords = h('span', { class: 'ob-st-words' });
      const paintStrip = () => fill(stripWords, preview?.kind ? h('span', { class: 'ob-st-kind' }, preview.kind) : null, preview?.name ? h('span', { class: 'ob-st-name' }, preview.name) : null);
      paintStrip();
      const stripLock = h('span', { class: 'ob-st-lock', hidden: spec.locked ? null : true }, lockMark());
      const strip = h('div', { class: 'ob-strip', 'aria-hidden': 'true' }, h('span', { class: 'ob-mt' }, svg('svg', { viewBox: '34 4 212 168', preserveAspectRatio: 'xMidYMid meet' }, stripRects)), stripWords, stripLock);
      const cardRects = sixRects();
      const lockWords = spec.lockWords !== false && !hosted;
      const badgeShown = Boolean(spec.locked && lockWords);
      const badge = h('span', { class: badgeShown && !lastLocked ? 'ob-badge ob-badge-new' : 'ob-badge', hidden: badgeShown ? null : true }, lockMark(), PREVIEW_WORDS.locked);
      lastLocked = Boolean(spec.locked);
      const noteBadge = spec.noteBadge ? h('span', { class: 'ob-note-shape' }) : null;
            const body = h('div', { class: 'ob-cbody' });
      const cardNode = h('article', { class: 'ob-card' },
        h('div', { class: 'ob-tile' }, svg('svg', { class: 'ob-ill', viewBox: '0 0 280 176', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, cardRects), badge, noteBadge),
        body);
      const stage = h('div', { class: `ob-stage${spec.siteFront ? ' ob-site-front' : ''}` }, cardNode);
      const paintPreview = () => {
        const parts = previewParts(preview, Boolean(spec.outline && spec.site));
        fill(body, ...parts.body);
        for (const old of Array.from(stage.children)) if (old !== cardNode) old.remove();
        if (parts.site) stage.append(parts.site);
        stage.classList.toggle('with-site', Boolean(parts.site));
        paintStrip();
      };
      paintPreview();
      const deco = svg('svg', { class: 'ob-deco', viewBox: '0 0 600 700', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
        svg('path', { class: 'ob-d1', d: 'M0 470a230 230 0 0 1 230 230H0Z' }), svg('circle', { class: 'ob-d2', cx: 560, cy: 60, r: 150 }), svg('circle', { class: 'ob-d2', cx: 560, cy: 60, r: 96 }),
        svg('g', { class: 'ob-d3' }, [470, 500, 530].flatMap(cx => [560, 590, 620].map(cy => svg('circle', { cx, cy, r: 5 })))));
      const field = h('aside', { class: 'ob-field', 'aria-hidden': 'true' }, deco, stage);
      const root = h('div', { class: `ob-root${firstFrame ? ' ob-first' : ''}${spec.fresh ? ' ob-fresh' : ''}`, 'data-step': step },
        top, h('main', { class: 'ob-wrap' }, h('section', { class: 'ob-ask' }, strip, ask), field));
      firstFrame = false;
      document.getElementById('app').replaceChildren(root);
      const groups = [cardRects, stripRects];
      paintShapes(groups, spec.shapes || 'idle');
      card = {
        setShapes: key => paintShapes(groups, key),
        setLocked: on => {
          const show = on && lockWords;
          if (show && badge.hidden && !lastLocked) badge.classList.add('ob-badge-new');
          badge.hidden = !show; stripLock.hidden = !on; lastLocked = Boolean(on);
        },
        /** The line follows what the owner types; an empty box shows the placeholder again. */
        setLine: words => { preview = { ...(preview || {}), line: plain(words).trim() || null }; paintPreview(); },
        /** New prices for the offer rows, as the engine's receipts come back: { [offerId]: price }. */
        setPrices: priced => {
          if (!preview?.offers) return;
          preview = { ...preview, offers: preview.offers.map(offer => (priced[offer.id] ? { ...offer, price: priced[offer.id] } : offer)) };
          paintPreview();
        },
        setPreview: next => { preview = next; paintPreview(); },
        get preview() { return preview; },
      };
      const title = typeof ask.querySelector === 'function' ? ask.querySelector('h1') : null;
      if (title && spec.focus !== false) { try { title.focus(); } catch { /* focus is a convenience */ } }
      return ask;
    }
    const obTitle = words => h('h1', { class: 'ob-title', tabindex: '-1' }, words);
    const obLead = words => h('p', { class: 'ob-lead' }, words);
    const obEyebrow = words => h('p', { class: 'ob-eyebrow' }, words);
    const obBtn = (words, onclick, attrs = {}) => h('button', { class: 'ob-btn', type: 'button', onclick, ...attrs }, words);
    const obGhost = (words, onclick, attrs = {}) => h('button', { class: 'ob-ghost', type: 'button', onclick, ...attrs }, words);
    const obLink = (words, onclick, attrs = {}) => h('button', { class: 'ob-link', type: 'button', onclick, ...attrs }, words);
    const obActions = (...children) => h('div', { class: 'ob-actions' }, ...children);
    const obFold = (summary, ...children) => h('details', { class: 'ob-more' }, h('summary', {}, summary), h('div', { class: 'ob-more-in' }, ...children));
    function obBack(onclick) {
      return h('button', { class: 'ob-back', type: 'button', onclick }, svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { d: 'M10 3 5 8l5 5' })), 'Back');
    }
    function obAlert(message) { return message ? h('p', { class: 'ob-alert', role: 'alert' }, plain(message)) : null; }
    /** A field nudges sideways once when what was typed can't be used. */
    function nudge(node) {
      if (!node?.classList) return;
      node.classList.remove('ob-nudge');
      if (!calm()) globalThis.requestAnimationFrame(() => node.classList.add('ob-nudge'));
    }
    /** A passphrase field with Show beside it. The field never sits in browser storage and is cleared after each send. */
    function passphraseField(labelText, control, withShow = true) {
      if (!withShow) return field(labelText, control);
      const show = h('button', { class: 'ob-eye', type: 'button', 'aria-pressed': 'false' }, 'Show');
      show.addEventListener('click', () => {
        const visible = control.getAttribute('type') === 'text';
        control.setAttribute('type', visible ? 'password' : 'text');
        show.setAttribute('aria-pressed', visible ? 'false' : 'true');
      });
      const node = field(labelText, control);
      node.classList.add('ob-pass');
      node.append(show);
      return node;
    }

    function onboarding() {
      if (!state.onboarding) {
        state.onboarding = {
          mode: hosted ? 'template' : 'ai', idea: '', countryCode: null, countries: null, ai: null, decision: null, plan: null, typed: {}, sent: {},
          preview: null, pricing: 'monthly', price: '', tax: null, rate: null, extra: {}, workingName: '', vaultOpen: false,
        };
      }
      return state.onboarding;
    }
    /** Puts the cursor in the field on a computer with a mouse; a phone keeps its keyboard closed until the owner taps. */
    function focusOnDesk(control) {
      try {
        if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: fine)').matches) control.focus();
      } catch { /* focus is a convenience */ }
    }
    function browserRegion() {
      try {
        if (typeof navigator === 'undefined') return null;
        const region = plain(navigator.language).split('-')[1];
        return region ? region.toUpperCase() : null;
      } catch { return null; }
    }

    // ---------------------------------------------------------------------------------------------
    // Step one: connect an AI. The key stays in the engine's memory; nothing is kept in this window.
    // ---------------------------------------------------------------------------------------------
    /** Where the owner is: an AI connected for plans goes on to the open box or the held plan; otherwise Connect. */
    async function startFlow(known = undefined) {
      const ob = onboarding();
      ob.decision = null; ob.plan = null; ob.typed = {}; ob.sent = {};
      if (hosted) { ob.mode = 'template'; await showOpenBox(); return; }
      let status = known;
      if (status === undefined) {
        try { status = await request('venture.ai.status'); }
        catch (error) { await showConnect(null, error); return; }
      }
      ob.ai = status;
      if (!readyForPlans(status)) { await showConnect(); return; }
      ob.mode = 'ai';
      let held = null;
      try { held = await request('venture.compose.get'); } catch { held = null; }
      if (held?.decision) {
        ob.decision = held.decision;
        ob.idea = held.decision.text;
        ob.countryCode = held.decision.country?.code || ob.countryCode;
      }
      if (held?.plan) { ob.plan = held.plan; showComposedPlan(); return; }
      if (held?.decision?.kind === 'not-a-service') { showNotAService(); return; }
      await showOpenBox();
    }
    /** The open box needs both tiers: the engine reads the sentence on the quick tier and writes the plan on the main one. */
    function readyForPlans(status) { return servedByModel(status, 'main') && servedByModel(status, 'fast'); }
    /** The engine's reason for the first tier that can't serve yet. */
    function notReadyReason(status) { return (servedByModel(status, 'main') ? status?.tiers?.fast : status?.tiers?.main)?.reason || null; }
    /** The first call of the recommended pair connected and the second did not: quick work only. */
    function halfConnected(status) {
      return servedByModel(status, 'fast') && !servedByModel(status, 'main') && status?.tiers?.fast?.presetId === 'anthropic-haiku-5-5';
    }
    function afterConnected(status) {
      const ob = onboarding();
      ob.ai = status;
      ob.mode = 'ai';
      void showOpenBox();
    }

    async function showConnect(message = null, failure = null) {
      const ob = onboarding();
      let view = null;
      let error = failure;
      if (!error) {
        try { view = await request('venture.ai.options'); }
        catch (caught) { error = caught; }
      }
      // With an AI already connected for plans, the skip link can't promise "without AI": the AI stays connected and is
      // kept with the business, so it says what it really gives, a built-in plan, and Back keeps the connection in use.
      const usable = current => readyForPlans(current);
      // A returning owner lands here too after every restart (the engine starts locked), so the first screen also opens
      // an existing business, as the open box does.
      const skipLink = current => h('p', { class: 'ob-skip' }, obLink(usable(current) ? 'Use a built-in plan' : 'Continue without AI', () => { ob.mode = 'template'; void showOpenBox(); }),
        hosted || ob.vaultOpen || usable(current) ? null : obLink('Open my business', () => openExisting()));
      const skip = skipLink(ob.ai);
      if (!view) {
        obFrame('ai', [obTitle('Connect an AI first.'), h('div', { class: 'ob-errors' }, ...errorNodes(error, () => showConnect(message))), skip], { shapes: 'ai', preview: {} });
        return;
      }
      ob.ai = view.status;
      const presets = Object.fromEntries((view.presets || []).map(preset => [preset.id, preset]));
      const half = halfConnected(view.status);
      const rows = view.options.map(option => aiRow(option, presets, half));
      const keepCurrent = usable(view.status) ? obBack(() => afterConnected(view.status)) : null;
      obFrame('ai', [
        keepCurrent,
        obTitle(keepCurrent ? 'Change your AI.' : 'Connect an AI first.'),
        obAlert(message),
        h('div', { class: 'ob-ai-rows' }, rows),
        view.unchecked ? h('p', { class: 'ob-quiet-line' }, AI_UNCHECKED_LINE) : null,
        skipLink(view.status),
      ], { shapes: 'ai', preview: {} });
      if (half) { const keyRow = rows.find(node => node.getAttribute('data-option') === 'api-key'); if (keyRow) keyRow.open = true; }
    }
    /** What a preset can do now, in the chip's words and the engine's note: "Can connect · Not yet checked with a live key." */
    function presetState(preset) {
      const chipWords = AI_STATUS_CHIPS[preset.availability] || preset.availability;
      const verified = verificationOf(preset);
      return verified ? `${chipWords} · ${verified}` : chipWords;
    }
    function aiRow(option, presets, half) {
      const body = h('div', { class: 'ob-ai-body' });
      const row = h('details', { class: 'ob-ai-row', 'data-option': option.id },
        h('summary', {}, h('span', { class: 'ob-ai-label' }, option.label), h('span', { class: `ob-chip ob-chip-${option.status}` }, AI_STATUS_CHIPS[option.status] || option.status)),
        body);
      const parts = [note(option.line), note(option.why)];
      if (option.id !== 'chatgpt-sign-in') parts.push(note(MEMORY_LINE, 'launch-note ob-memory'));
      if (option.id === 'api-key') {
        const panel = h('div', { class: 'ob-provider' });
        const haiku = presets['anthropic-haiku-5-5'], sonnet = presets['anthropic-sonnet-5-5'], luna = presets['openai-gpt-6-luna'];
        const paint = provider => {
          row.setAttribute('data-provider', provider);
          fill(panel, provider === 'openai' ? (luna ? lunaPanel(luna) : null) : (haiku && sonnet ? pairPanel(haiku, sonnet, half) : null));
        };
        const choose = choiceRow([['anthropic', 'Anthropic'], ['openai', 'OpenAI']], 'anthropic', paint);
        row.chooseProvider = provider => { const target = Array.from(choose.children || []).find(child => child.textContent === (provider === 'openai' ? 'OpenAI' : 'Anthropic')); if (target) target.click(); };
        parts.push(choose, panel);
        paint('anthropic');
      } else if (option.id === 'claude-code' || option.id === 'codex') {
        const preset = presets[option.presetIds[0]];
        if (preset) parts.push(cliPanel(preset, option));
      } else {
        parts.push(h('p', { class: 'ob-row-actions' }, obLink('Use an OpenAI key instead', () => {
          const keyRow = Array.from(document.querySelectorAll('details')).find(node => node.getAttribute('data-option') === 'api-key');
          if (!keyRow) return;
          keyRow.open = true;
          row.open = false;
          keyRow.chooseProvider?.('openai');
        })));
      }
      fill(body, ...parts);
      return row;
    }
    /** The recommended pair: one Anthropic key, Haiku for quick work, then Sonnet for plans. */
    function pairPanel(haiku, sonnet, startHalf) {
      const host = h('div', { class: 'ob-pair', 'data-preset': 'recommended' });
      const paint = (halfState, failure = null) => {
        const key = secretInput('Your Anthropic key');
        const consent = consentBlock(haiku.consentText);
        const status = statusLine();
        const words = halfState ? 'Connect Sonnet 5.5 for plans' : 'Connect';
        const connect = obBtn(words, () => act(connect, status, async () => {
          let result = null;
          try {
            if (!key.value) { nudge(key); throw new Error('Paste your Anthropic key first.'); }
            if (!halfState) await request('venture.ai.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: key.value, tiers: ['fast'] });
            try { result = await request('venture.ai.connect', { presetId: sonnet.id, consentDigest: sonnet.consentDigest, apiKey: key.value, tiers: ['main'] }); }
            catch (error) { result = { failed: error }; }
          } finally { key.value = ''; }
          if (result?.failed) { paint(true, result.failed); return; }
          if (!servedByModel(result, 'main')) { paint(true, new Error(result?.tiers?.main?.reason || 'Sonnet 5.5 is not ready for plans yet.')); return; }
          afterConnected(result);
        }), { disabled: true });
        consent.agree.addEventListener('change', () => { connect.disabled = !consent.agree.checked; });
        fill(host,
          halfState ? h('p', { class: 'ob-half' }, AI_HALF_CONNECTED_WORDS) : h('p', { class: 'launch-strong' }, PAIR_LINE),
          failure ? h('div', { class: 'ob-errors' }, ...errorNodes(failure)) : null,
          note(presetState(haiku), 'launch-note launch-unverified'),
          field('Your Anthropic key', key, KEY_LINE), haiku.keyHint ? note(haiku.keyHint) : null,
          consent.node, sonnet.consentText !== haiku.consentText ? h('p', { class: 'launch-consent-text' }, sonnet.consentText) : null,
          obActions(connect), status);
      };
      paint(startHalf);
      return host;
    }
    function lunaPanel(preset) {
      const key = secretInput('Your OpenAI key');
      const model = textInput(preset.model || '', { maxlength: 64 });
      const consent = consentBlock(preset.consentText);
      const status = statusLine();
      const verified = verificationOf(preset);
      const connect = obBtn('Connect', () => act(connect, status, async () => {
        const payload = { presetId: preset.id, consentDigest: preset.consentDigest };
        let result;
        try {
          if (!key.value) { nudge(key); throw new Error('Paste your OpenAI key first.'); }
          payload.apiKey = key.value;
          if (model.value.trim()) payload.model = model.value.trim();
          result = await request('venture.ai.connect', payload);
        } finally { key.value = ''; delete payload.apiKey; }
        if (!readyForPlans(result)) throw new Error(notReadyReason(result) || 'GPT-6 Luna is not ready for plans yet.');
        afterConnected(result);
      }), { disabled: true });
      consent.agree.addEventListener('change', () => { connect.disabled = !consent.agree.checked; });
      return h('div', { class: 'ob-luna', 'data-preset': preset.id },
        h('p', { class: 'launch-strong' }, 'GPT-6 Luna.'),
        note(presetState(preset), 'launch-note launch-unverified'),
        note(reasonWithout(preset.availabilityReason, verified)),
        field('Your OpenAI key', key, KEY_LINE), preset.keyHint ? note(preset.keyHint) : null,
        field('Model id, as your account shows it', model),
        consent.node, obActions(connect), status);
    }
    /** Claude Code and Codex: the owner's own sign-in on this computer. Chausar never reads their token files. */
    function cliPanel(preset, option) {
      const consent = consentBlock(preset.consentText);
      const status = statusLine();
      const verified = verificationOf(preset);
      const claude = preset.id === 'claude-code-cli';
      let connect = null;
      if (option.canConnect || !claude) {
        connect = obBtn(claude ? 'Check and connect' : 'Connect', () => act(connect, status, async () => {
          const result = await request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
          if (!readyForPlans(result)) throw new Error(notReadyReason(result) || `${presetName(preset.id)} is not ready for plans yet.`);
          afterConnected(result);
        }), { disabled: true });
        consent.agree.addEventListener('change', () => { connect.disabled = !consent.agree.checked || !option.canConnect; });
      }
      return h('div', { class: 'ob-cli', 'data-preset': preset.id },
        note(presetState(preset), 'launch-note launch-unverified'),
        note(reasonWithout(preset.availabilityReason, verified)),
        consent.node, connect ? obActions(connect) : null, status);
    }

    // ---------------------------------------------------------------------------------------------
    // Step two: one open box. Any sentence: an idea, a skill or a problem.
    // ---------------------------------------------------------------------------------------------
    async function showOpenBox(message = null) {
      const ob = onboarding();
      const box = h('textarea', { rows: 2, maxlength: 2000, value: ob.idea, placeholder: "I'm good at fixing bikes", 'aria-label': 'What you want to do' });
      const status = statusLine();
      const ideaBox = h('div', { class: 'ob-idea' }, box);
      const go = h('button', { class: 'ob-go', type: 'button', 'aria-label': 'Make my plan' }, arrowMark());
      ideaBox.append(go);
      const countryLine = h('p', { class: 'ob-country' });
      go.addEventListener('click', () => act(go, status, async () => {
        const value = box.value.replace(/\r\n/g, '\n').trim();
        if (!value) { nudge(ideaBox); throw new Error('Write one sentence about what you want to do.'); }
        if (value.length < OPEN_BOX_TEXT.min) { nudge(ideaBox); throw new Error(TOO_SHORT_WORDS); }
        if (value.length > OPEN_BOX_TEXT.max) { nudge(ideaBox); throw new Error(TOO_LONG_WORDS); }
        ob.idea = value;
        if (ob.mode === 'ai') { await makePlan(value); return; }
        if (ob.preview?.idea !== value || ob.preview?.country?.code !== ob.countryCode) { ob.tax = null; ob.rate = null; ob.extra = {}; }
        ob.preview = await request('venture.preview', previewPayload(value));
        showTemplatePlan();
      }));
      box.addEventListener('input', () => { ob.idea = box.value; card?.setLine(box.value.trim()); });
      box.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault?.(); go.click(); } });
      const examples = obFold('Examples', h('div', { class: 'ob-chips' }, EXAMPLES.map(([words, sentence]) => h('button', {
        class: 'ob-example', type: 'button', onclick: () => { box.value = sentence; ob.idea = sentence; card?.setLine(sentence); focusOnDesk(box); },
      }, words))));
      const changeAi = hosted ? null : obLink(ob.mode === 'ai' || servedByModel(ob.ai, 'main') ? 'Change AI' : 'Connect an AI', () => showConnect());
      const returning = hosted
        ? h('p', { class: 'ob-returning' }, obLink('Your businesses', () => renderSetup()))
        : ob.vaultOpen
          ? h('p', { class: 'ob-returning' }, obLink('Open the back office', () => { state.page = 'conversation'; renderShell(); }))
          : h('p', { class: 'ob-returning' }, 'Already have a business? ', obLink('Open it', () => openExisting()));
      obFrame('idea', [
        obTitle('What do you want to do?'), obLead('An idea, a skill or a problem.'), obAlert(message),
        ideaBox, countryLine, status, examples, changeAi ? h('p', { class: 'ob-change-ai' }, changeAi) : null, returning,
      ], { shapes: 'idle', preview: { line: ob.idea.trim() || null }, focus: false });
      focusOnDesk(box);
      if (!ob.countries) {
        try { ob.countries = await request('venture.countries'); }
        catch (error) { countryLine.replaceChildren(...errorNodes(error, showOpenBox)); }
      }
      if (!ob.countryCode) {
        const region = browserRegion();
        ob.countryCode = (ob.countries || []).some(country => country.code === region) ? region : 'XX';
      }
      if (ob.countries) paintCountry(countryLine);
    }
    function paintCountry(host) {
      const ob = onboarding();
      const country = ob.countries.find(item => item.code === ob.countryCode) || ob.countries.find(item => item.code === 'XX') || ob.countries[0];
      if (!country) return;
      ob.countryCode = country.code;
      host.replaceChildren(h('span', {}, `Based in ${country.name}`), ' · ', obLink('Change', () => {
        const choose = picker(ob.countries.map(item => [item.code, item.name]), ob.countryCode);
        choose.addEventListener('change', () => { ob.countryCode = choose.value; paintCountry(host); });
        host.replaceChildren(field('Country', choose));
      }));
    }
    /** What venture.preview needs: the idea, the country, and how the owner charges once they chose other than per month. */
    function previewPayload(idea) {
      const ob = onboarding();
      const payload = { idea, countryCode: ob.countryCode || 'XX' };
      if (ob.pricing && ob.pricing !== 'monthly') payload.pricingModel = ob.pricing;
      return payload;
    }
    /** The sentence as the owner wrote it, cut to eight words for the Working screen. The engine has the whole of it. */
    function shortQuote(text) {
      const words = plain(text).trim().split(/\s+/).filter(Boolean);
      return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : words.join(' ');
    }

    // ---------------------------------------------------------------------------------------------
    // Working, then the plan: decide picks the views, fill writes the blocks, this code draws them.
    // ---------------------------------------------------------------------------------------------
    async function makePlan(text) {
      const ob = onboarding();
      const countryCode = ob.countryCode || 'XX';
      const held = ob.decision;
      if (sameSentence(held, text, countryCode)) { await fillPlan(); return; }
      // A new sentence: the held decision and plan were for other words, so nothing of them may be shown or filled again.
      ob.decision = null; ob.plan = null; ob.typed = {}; ob.sent = {};
      showWorking(text, null);
      let decision;
      try { decision = await request('venture.compose.decide', { text, countryCode }); }
      catch (error) {
        if (OPEN_BOX_ERRORS.includes(error?.code)) { await showOpenBox(error.message); return; }
        composeError(error, () => makePlan(text));
        return;
      }
      ob.decision = decision;
      if (decision.kind === 'not-a-service') { showNotAService(); return; }
      await fillPlan();
    }
    /** Whether the held decision is for this sentence and country, so a fill may reuse it. */
    function sameSentence(decision, text, countryCode) {
      return Boolean(decision && decision.kind !== 'not-a-service' && decision.text === text && decision.country?.code === countryCode);
    }
    /** The engine no longer holds the plan (idle for an hour, or restarted): back to Connect, keeping an open vault. */
    function planGone() {
      const ob = onboarding();
      ob.decision = null; ob.plan = null; ob.typed = {}; ob.sent = {};
      void showConnect(CLEARED_LINE);
    }
    /** One owner edit before the vault. A plan the engine lost sends the owner back to Connect instead of failing in place. */
    async function draftUpdate(patch) {
      const ob = onboarding();
      try { ob.plan = await request('venture.compose.update', { composeId: ob.plan.composeId, patch }); }
      catch (error) { if (error?.code === 'COMPOSE_NOT_FOUND') planGone(); throw error; }
      return ob.plan;
    }
    async function fillPlan() {
      const ob = onboarding();
      const decision = ob.decision;
      showWorking(decision.text, decision.views);
      let plan;
      try { plan = await request('venture.compose.fill', { composeId: decision.composeId }); }
      catch (error) { composeError(error, fillPlan); return; }
      ob.plan = plan;
      showComposedPlan({ fresh: true });
    }
    function composeError(error, retry) {
      if (error?.code === 'COMPOSE_REFUSED') { showRefused(); return; }
      if (error?.code === 'COMPOSE_NOT_A_SERVICE') { showNotAService(); return; }
      if (error?.code === 'COMPOSE_NOT_FOUND' || error?.code === 'NO_MODEL_CONNECTED') { planGone(); return; }
      showModelError(error, retry);
    }
    /** The preview while the AI works: the sentence as typed, then the engine's reading of it and its kind once decide answers. */
    function workingPreview(text) {
      const decision = onboarding().decision;
      return { kind: decision?.family ? SERVICE_TYPE_LABELS[decision.family.value] || null : null, line: decision?.reading?.value || plain(text).trim() || null };
    }
    /** Still outlines in the shapes of the decided views, each under its fixed heading. Nothing spins or loops. */
    function showWorking(text, views) {
      const ob = onboarding();
      const words = views
        ? `Writing your plan ${tierWords(ob.ai, 'main')}. This can take a minute.`
        : `Reading what you wrote ${tierWords(ob.ai, 'fast')}.`;
      obFrame('working', [
        h('p', { class: 'ob-quote' }, shortQuote(text)),
        h('p', { class: 'ob-working', role: 'status', 'aria-live': 'polite' }, words),
        views ? h('div', { class: 'ob-outlines' }, views.map(outlineView)) : null,
      ], { shapes: 'idle', outline: true, site: views?.includes('pages') ? 3 : 0, preview: workingPreview(text) });
    }
    function outlineView(id) {
      const spec = VIEWS[id];
      if (!spec) return null;
      const line = width => h('i', { class: `ob-sk w${width}` });
      const shapes = {
        cards: () => Array.from({ length: spec.rows }, () => h('div', { class: 'ob-sk-card' }, line(2), line(3))),
        flow: () => Array.from({ length: spec.rows }, () => h('div', { class: 'ob-sk-step' }, h('span', { class: 'ob-sk-node' }), line(2))),
        statement: () => Array.from({ length: spec.rows }, (_, index) => line(index ? 3 : 1)),
        site: () => [h('div', { class: 'ob-sk-site' }, Array.from({ length: spec.rows }, () => h('i')))],
        chips: () => [h('div', { class: 'ob-sk-chips' }, Array.from({ length: spec.rows }, () => h('i')))],
        asks: () => Array.from({ length: spec.rows }, () => h('div', { class: 'ob-sk-ask' }, line(3), h('span', { class: 'ob-sk-pill' }))),
        lines: () => Array.from({ length: spec.rows }, (_, index) => line(index % 2 ? 2 : 3)),
      };
      return h('section', { class: `ob-outline ob-outline-${spec.shape}`, 'data-view': id, 'aria-hidden': 'true' },
        h('h2', { class: 'ob-view-head' }, spec.heading), h('div', { class: 'ob-outline-body' }, (shapes[spec.shape] || shapes.lines)()));
    }

    /** One drawing function per view id, from text nodes only. place is lead (at rest), fold (its own fold) or more. */
    function viewNode(selection, plan, place) {
      const spec = VIEWS[selection?.id];
      if (!spec) return null;
      const leadIds = Array.isArray(selection.lead) ? selection.lead : [];
      const ordered = (items, idOf) => {
        const first = leadIds.map(id => items.find(item => idOf(item) === id)).filter(Boolean);
        return place === 'lead' ? first : [...first, ...items.filter(item => !leadIds.includes(idOf(item)))];
      };
      let body;
      switch (selection.id) {
        case 'offers-first':
          body = h('ul', { class: 'ob-offers' }, ordered(plan.offers, offer => offer.id).map(offer => h('li', { class: 'ob-offer', 'data-offer': offer.id },
            h('span', { class: 'ob-offer-name' }, offer.name.value), place === 'lead' ? null : note(offer.description.value))));
          break;
        case 'steps-first':
          body = h('ol', { class: 'ob-flow' }, ordered(plan.steps, step => step.id).map(step => h('li', { class: `ob-step ob-by-${step.doneBy}`, 'data-step-id': step.id },
            h('span', { class: 'ob-node', 'aria-hidden': 'true' }), h('span', { class: 'ob-step-title' }, step.title.value),
            h('span', { class: 'ob-who' }, WHO_CHIP[step.doneBy] || step.doneBy), place === 'lead' ? null : note(step.note, 'launch-note ob-step-note'))));
          break;
        case 'audience-first':
          body = h('div', { class: 'ob-audience' }, h('p', { class: 'ob-audience-who' }, selection.who?.value || ''), h('p', { class: 'ob-audience-pain' }, selection.pain?.value || ''));
          break;
        case 'pages':
          body = h('ol', { class: 'ob-pages' }, ordered(plan.pages, item => item.id).map(item => h('li', {}, h('span', { class: 'launch-strong' }, item.title.value), ' ', h('span', { class: 'launch-note' }, item.purpose.value))));
          break;
        case 'tools':
          body = h('ul', { class: 'ob-tools' }, ordered(plan.tools, item => item.block).map(item => h('li', {}, h('span', { class: 'launch-strong' }, item.card?.name || item.block), ' ', h('span', { class: 'launch-note' }, item.reason.value))));
          break;
        case 'questions':
          body = h('div', { class: 'ob-questions' }, ordered(plan.questions, item => item.id).map(questionControl));
          break;
        case 'notes':
          body = h('ul', { class: 'ob-notes' }, ordered(plan.notes, item => item.block).map(item => h('li', {}, item.text)));
          break;
        default: return null;
      }
      return h('section', { class: `ob-view ob-view-${place}`, 'data-view': selection.id }, place === 'fold' ? null : h('h2', { class: 'ob-view-head' }, spec.heading), body);
    }
    /** A question the AI asked: the answer goes to the engine as given; the plan stays the engine's. */
    function questionControl(question) {
      const ob = onboarding();
      const status = statusLine();
      const send = answer => act(null, status, async () => {
        await draftUpdate({ answers: [{ questionId: question.id, answer }] });
      });
      if (question.kind === 'choice') {
        const current = question.answer?.choiceId || '';
        return h('div', { class: 'launch-question', 'data-question': question.id }, note(question.text, 'launch-strong'),
          choiceRow(question.choices.map(choice => [choice.id, choice.label]), current, value => send({ choiceId: value })), status);
      }
      const answer = textInput(question.answer?.text || '', { maxlength: 300 });
      answer.addEventListener('change', () => { const typed = answer.value.trim(); void send(typed ? { text: typed } : { skipped: true }); });
      return h('div', { class: 'launch-question', 'data-question': question.id }, field(question.text, answer), status);
    }
    /** "What was sent": every call to the AI before the vault, read from the engine when the fold opens. */
    function sentFold() {
      const body = h('div', { class: 'ob-sent' });
      const node = obFold('What was sent', body);
      let loaded = false;
      node.addEventListener('toggle', () => {
        if (!node.open || loaded) return;
        loaded = true;
        void act(null, body, async () => {
          const calls = await request('venture.ai.calls', { limit: 20 });
          fill(body, calls.length ? rows(...calls.map(callRow)) : note('Nothing was sent yet.'));
        }).then(() => { if (!body.children?.length) loaded = false; });
      });
      return node;
    }
    function callRow(call) {
      const by = call.replay ? 'a synthetic recording' : presetName(call.presetId, call.model);
      return row({
        mark: call.status === 'completed' ? 'cha' : call.status === 'failed' ? 'unsure' : 'off', title: PURPOSE_WORDS[call.purpose] || call.purpose,
        note: `${by}, ${(call.status === 'failed' && FAILED_CALL_WORDS[call.error?.code]) || CALL_WORDS[call.status] || call.status}`,
        extra: h('div', {}, call.error?.message ? h('p', { class: 'launch-row-more' }, call.error.message) : null,
          fold('Exact text sent', false, h('pre', { class: 'launch-pre' }, call.payloadText || ''))),
      });
    }

    function showComposedPlan({ fresh = false } = {}) {
      const ob = onboarding();
      const plan = ob.plan;
      for (const tool of plan.tools || []) if (tool.card?.name) toolNames[tool.block] = tool.card.name;
      const [lead, ...support] = plan.views;
      const picked = id => plan.views.some(view => view.id === id);
      const leadSteps = lead.id === 'steps-first' ? lead.lead : [];
      const otherSteps = plan.steps.filter(step => !leadSteps.includes(step.id));
      const tax = plan.backOffice;
      const taxLine = tax.taxRegistered.value ? `Tax: registered for ${tax.taxLabel}.` : `Tax: not registered for ${taxInSentence(tax.taxLabel)}.`;
      const more = obFold('More of your plan',
        h('p', { class: 'ob-reading' }, plan.reading.value),
        note(`Chausar read this as: ${plan.kindLabel}. Closest kind of business: ${plan.familyLabel}.`),
        note(plan.oneLiner.value), note(`For ${plan.customer.value}`),
        ...support.slice(1).map(view => viewNode(view, plan, 'more')),
        lead.id === 'offers-first'
          ? section('About the offers', ...plan.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`)))
          : viewNode({ id: 'offers-first', lead: plan.offers.map(offer => offer.id) }, plan, 'more'),
        otherSteps.length ? section(lead.id === 'steps-first' ? 'Other steps' : VIEWS['steps-first'].heading, stepRows(otherSteps), ...otherSteps.map(step => note(`${step.title.value}: ${step.note}`))) : null,
        section('You approve', ...plan.approvals.map(item => note(item.value, 'launch-note launch-approval'))),
        section('Back office', note(`Invoices and books in ${tax.currency}. ${railWords(tax.paymentRail)}`), note(taxLine), note(TEN_YEARS_LINE)),
        sentFold(),
        h('p', { class: 'ob-row-actions' }, obLink('Change what I wrote', () => showOpenBox())));
      obFrame('plan', [
        obEyebrow(`Drafted ${planByWords(plan, ob.ai)}.`),
        obTitle(plan.name.value),
        viewNode(lead, plan, 'lead'),
        support[0] ? (() => { const node = obFold(VIEWS[support[0].id]?.heading || support[0].id, viewNode(support[0], plan, 'fold')); node.setAttribute('data-view', support[0].id); return node; })() : null,
        more,
        obActions(obBtn('Set your prices', () => showPrices())),
      ], { shapes: plan.family?.value || 'other', fresh, noteBadge: picked('notes'), preview: planPreview(plan) });
    }

    /** Prices: the owner types them; the engine formats them. No tax and no total until the plan is kept. */
    function showPrices() {
      const ob = onboarding();
      const plan = ob.plan;
      const currency = plan.country.currency;
      const rowsHost = h('div', { class: 'ob-price-rows' });
      const editing = new Set();
      const sendPrice = async (offerId, typed) => {
        const value = typed.trim();
        const offer = ob.plan.offers.find(item => item.id === offerId);
        if (ob.sent[offerId] === value || (!value && !offer?.pricing?.unitPriceMinor)) return;
        await draftUpdate({ offers: [{ id: offerId, unitPrice: value || null }] });
        ob.sent[offerId] = value;
      };
      const paintRow = offer => {
        const status = statusLine();
        const node = h('div', { class: 'ob-price-row', 'data-offer': offer.id });
        let amountNode;
        if (offer.priceDisplay && !editing.has(offer.id)) {
          amountNode = h('button', { class: 'ob-fig', type: 'button', 'aria-label': `Change the price of ${offer.name.value}`, onclick: () => { editing.add(offer.id); swapRow(node, offer.id); } }, offer.priceDisplay);
        } else {
          const amount = textInput(ob.typed[offer.id] ?? '', { inputmode: 'decimal', 'aria-label': `Price of ${offer.name.value}, in ${currency}` });
          amount.addEventListener('input', () => { ob.typed[offer.id] = amount.value; });
          amount.addEventListener('change', () => act(null, status, async () => {
            await sendPrice(offer.id, amount.value);
            editing.delete(offer.id);
            swapRow(node, offer.id);
          }));
          amountNode = field(currency, amount);
          amountNode.classList.add('ob-amount');
        }
        const allowed = offer.allowedPricing || [offer.pricing.model];
        let pricingNode;
        if (allowed.length > 1) {
          pricingNode = picker(allowed.map(model => [model, PRICING_WORDS[model]]), offer.pricing.model);
          pricingNode.setAttribute('aria-label', `How ${offer.name.value} is charged`);
          pricingNode.addEventListener('change', () => act(null, status, async () => {
            await draftUpdate({ offers: [{ id: offer.id, pricingModel: pricingNode.value }] });
            card?.setPreview(planPreview(ob.plan));
          }));
        } else pricingNode = h('span', { class: 'ob-per' }, PRICING_WORDS[offer.pricing.model] || offer.pricing.model);
        fill(node, h('span', { class: 'ob-offer-name' }, offer.name.value), amountNode, pricingNode, status);
        return node;
      };
      const currentOffer = id => ob.plan.offers.find(item => item.id === id);
      const repaintRows = () => fill(rowsHost, ...ob.plan.offers.map(paintRow));
      /** Draws one row again in place, so focus in the other rows stays where the owner put it. */
      const swapRow = (node, id) => {
        if (typeof node.replaceWith === 'function' && node.isConnected !== false) node.replaceWith(paintRow(currentOffer(id))); else repaintRows();
        card?.setPreview(planPreview(ob.plan));
      };
      repaintRows();
      const taxHost = h('div');
      const paintTax = () => fill(taxHost, taxFold());
      const taxFold = () => {
        const backOffice = ob.plan.backOffice;
        const status = statusLine();
        const registered = backOffice.taxRegistered.value;
        const rate = textInput(ob.rate ?? (registered ? '' : ob.plan.taxRateQuestion?.prefill || ''), { inputmode: 'decimal', 'aria-label': `${backOffice.taxLabel} rate, in percent` });
        const rateField = h('div', { hidden: ob.tax !== true && !registered ? true : null }, field(ob.plan.taxRateQuestion?.text || `What ${backOffice.taxLabel} rate do you charge, in percent?`, rate));
        const send = patch => act(null, status, async () => {
          await draftUpdate(patch);
          const open = node.open;
          paintTax();
          const again = taxHost.children?.[0];
          if (again && open) again.open = true;
        });
        rate.addEventListener('input', () => { ob.rate = rate.value; });
        rate.addEventListener('change', () => { if (rate.value.trim()) void send({ taxRegistered: true, taxRate: rate.value.trim() }); });
        const choose = choiceRow([['no', 'No'], ['yes', 'Yes']], ob.tax === true || registered ? 'yes' : ob.tax === false ? 'no' : '', value => {
          ob.tax = value === 'yes';
          rateField.hidden = !ob.tax;
          if (!ob.tax) { void send({ taxRegistered: false }); return; }
          if (rate.value.trim()) void send({ taxRegistered: true, taxRate: rate.value.trim() });
        });
        const node = obFold(registered ? 'Tax: registered' : 'Tax: not registered',
          note(ob.plan.taxQuestion?.text || `Do you charge ${backOffice.taxLabel}?`), choose, rateField, note(ob.plan.country.tax.registrationNote), status);
        node.classList.add('ob-tax');
        return node;
      };
      paintTax();
      const status = statusLine();
      const keep = obBtn('Keep this plan', () => act(keep, status, async () => {
        // The engine must still hold this plan before a vault is made for it.
        const held = await request('venture.compose.get');
        if (!held?.plan || held.plan.composeId !== ob.plan.composeId) { planGone(); return; }
        ob.plan = held.plan;
        for (const offer of ob.plan.offers) {
          const typed = ob.typed[offer.id];
          if (typeof typed === 'string' && typed.trim() !== (ob.sent[offer.id] ?? '')) await sendPrice(offer.id, typed);
        }
        if (ob.tax === true && !ob.plan.backOffice.taxRegistered.value) {
          const typedRate = plain(ob.rate).trim();
          if (!typedRate) throw new Error(`Enter your ${ob.plan.backOffice.taxLabel} rate, in percent, or choose No.`);
          await draftUpdate({ taxRegistered: true, taxRate: typedRate });
        }
        if (ob.vaultOpen) await runComposedSetup(); else await keepSilently();
      }));
      obFrame('prices', [
        obBack(() => showComposedPlan()), obTitle('Set your prices.'), obLead("Before tax. Chausar's calculator does the totals later."),
        rowsHost, taxHost, obActions(keep), status,
      ], { shapes: plan.family?.value || 'other', preview: planPreview(plan) });
    }

    /** After the vault exists: venture.create adopts the plan the engine holds. The renderer sends its id and digest, never the plan. */
    async function runComposedSetup() {
      const ob = onboarding();
      const plan = ob.plan;
      const priced = plan.offers.filter(offer => offer.pricing.unitPriceMinor);
      const statusNode = h('p', { class: 'ob-working', role: 'status' }, priced.length ? 'Saving your plan and pricing it with receipts.' : 'Saving your plan.');
      const host = h('div', { class: 'ob-setup' });
      obFrame('setup', [obTitle('Setting up your plan'), experimental() ? warn(EXPERIMENTAL) : null, statusNode, host], { shapes: 'lockShut', locked: true, preview: planPreview(plan) });
      ob.quoted ??= [];
      try {
        // Once create has committed, the engine has wiped the draft, so a retry only prices what is left.
        if (!ob.created) {
          const payload = { idea: plan.text, countryCode: plan.country.code };
          const name = plain(ob.workingName || plan.name.value).trim();
          if (name.length >= 2 && name.length <= 80) payload.workingName = name;
          payload.composeId = plan.composeId;
          payload.composedDigest = plan.digest;
          try { state.venture = await request('venture.create', payload); }
          catch (error) {
            if (error?.code !== 'VENTURE_EXISTS') {
              // A create that timed out may still have committed: the vault then holds the business, and that counts.
              const existing = await settle(request('venture.get'));
              if (!existing.value) {
                if (error?.code === 'COMPOSE_NOT_FOUND') { planGone(); return; }
                throw error;
              }
              state.venture = existing.value;
            }
          }
          ob.created = true;
        }
        for (const offer of priced) {
          if (ob.quoted.includes(offer.id)) continue;
          const receipt = await request('venture.price.quote', { offerId: offer.id });
          ob.quoted.push(offer.id);
          const price = receiptPrice(receipt);
          if (price) card?.setPrices({ [offer.id]: price });
        }
      } catch (error) {
        const retry = () => runComposedSetup();
        statusNode.hidden = true;
        fill(host, ...errorNodes(error, retry), obActions(obBtn('Try again', retry), ob.created ? null : obLink('Back to the plan', () => showComposedPlan())));
        return;
      }
      state.onboarding = null;
      await showOwnedPlan();
    }

    function showNotAService() {
      const ob = onboarding();
      obFrame('not-a-service', [
        obTitle("Chausar can't plan this one."),
        obLead(ob.decision?.refusal || NOT_A_SERVICE_WORDS),
        obActions(obBtn('Change what I wrote', () => showOpenBox()), obLink('Use a built-in plan', () => useBuiltIn())),
      ], { shapes: 'idle', preview: { line: plain(ob.idea).trim() || null } });
    }
    function showRefused() {
      const ob = onboarding();
      const status = statusLine();
      // Try again fills the held decision only when it is for the sentence on screen; otherwise it reads the sentence again.
      const again = obBtn('Try again', () => act(again, status, async () => {
        if (sameSentence(ob.decision, ob.idea, ob.countryCode || 'XX')) await fillPlan(); else await makePlan(ob.idea);
      }));
      obFrame('refused', [
        obTitle("There's no plan to show."), obLead(COMPOSE_REFUSED_WORDS),
        obActions(again, obLink('Change what I wrote', () => showOpenBox()), obLink('Use a built-in plan', () => useBuiltIn())), status,
        sentFold(),
      ], { shapes: 'idle', preview: { line: plain(ob.idea).trim() || null } });
    }
    function showModelError(error, retry) {
      const status = statusLine();
      const again = obBtn('Try again', () => act(again, status, retry));
      obFrame('error', [
        obTitle("The AI didn't answer."),
        h('p', { class: 'ob-alert', role: 'alert' }, plain(error?.message || error)),
        obActions(again, obLink('Change what I wrote', () => showOpenBox()), obLink('Change AI', () => showConnect())), status,
      ], { shapes: 'idle', preview: { line: plain(onboarding().idea).trim() || null } });
    }
    /** The built-in plan, from the sentence the owner wrote. It says plainly that it was not fitted to it. */
    async function useBuiltIn() {
      const ob = onboarding();
      ob.mode = 'template';
      try {
        ob.preview = await request('venture.preview', previewPayload(ob.idea));
        ob.tax = null; ob.rate = null; ob.extra = {};
        showTemplatePlan();
      } catch (error) { await showOpenBox(error?.message || String(error)); }
    }

    // ---------------------------------------------------------------------------------------------
    // The built-in plan (no AI, or the owner chose it), in look B: the plan, then the price
    // ---------------------------------------------------------------------------------------------
    function showTemplatePlan() {
      const ob = onboarding();
      const preview = ob.preview;
      const country = preview.country;
      obFrame('plan', [
        obEyebrow(BUILT_IN_LINE),
        obTitle(preview.serviceLabel),
        h('section', { class: 'ob-view ob-view-lead', 'data-view': 'offers-first' }, h('h2', { class: 'ob-view-head' }, VIEWS['offers-first'].heading),
          h('ul', { class: 'ob-offers' }, preview.offers.map(offer => h('li', { class: 'ob-offer', 'data-offer': offer.id }, h('span', { class: 'ob-offer-name' }, offer.name.value))))),
        fold('Steps', false, stepRows(preview.deliverySteps)),
        fold('You approve', false, approvalLines(preview.approvals, 'launch-note launch-approval')),
        obFold('More of your plan',
          h('p', {}, preview.oneLiner.value, ' ', tag(preview.oneLiner)),
          h('p', { class: 'launch-note' }, `For ${preview.customer.value}`, ' ', tag(preview.customer)),
          ...preview.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`)),
          note(`Invoices and books in ${country.currency}. ${railWords(preview.backOffice.paymentRail)}`)),
        obActions(obBtn('Set your price', () => showTemplatePrices()), obLink('Change what I wrote', () => showOpenBox())),
      ], { shapes: preview.serviceType?.value || 'other', preview: templatePreview(preview, ob.price) });
    }
    function showTemplatePrices() {
      const ob = onboarding();
      const preview = ob.preview;
      const country = preview.country;
      const tax = country.tax;
      const taxQuestion = (preview.questions || []).find(question => question.id === 'q_tax');
      const rateQuestion = (preview.questions || []).find(question => question.id === 'q_tax_rate');
      if (ob.rate == null) ob.rate = rateQuestion?.prefill ?? '';
      const status = statusLine();
      const amount = textInput(ob.price, { inputmode: 'decimal', 'aria-label': `Your price, in ${country.currency}` });
      amount.addEventListener('input', () => { ob.price = amount.value; card?.setPreview(templatePreview(preview, amount.value)); });
      const pricing = choiceRow(PRICING, ob.pricing, value => {
        ob.pricing = value;
        ob.price = amount.value;
        // The offer's name and words follow how it is charged, so the plan is asked for again.
        void act(null, status, async () => {
          const again = await request('venture.preview', { ...previewPayload(preview.idea || ob.idea), pricingModel: value });
          ob.preview = { ...again, idea: again.idea || preview.idea || ob.idea };
          showTemplatePrices();
        });
      });
      const charges = tax.mode === 'gst' || tax.mode === 'vat';
      const notRegistered = charges ? `not registered for ${tax.label}` : tax.mode === 'sales-tax' ? "you don't charge sales tax" : "you don't charge tax";
      const registered = charges ? `registered for ${tax.label}` : tax.mode === 'sales-tax' ? 'you charge sales tax' : 'you charge tax';
      const taxChip = h('span', { class: 'launch-chip' });
      const rate = textInput(ob.rate || '', { inputmode: 'decimal', 'aria-label': `${tax.label} rate, in percent` });
      rate.addEventListener('input', () => { ob.rate = rate.value; });
      const rateField = h('div', { hidden: ob.tax !== true }, field(rateQuestion?.text || `What ${tax.label} rate do you charge, in percent?`, rate));
      const paintTax = () => {
        taxChip.textContent = ob.tax === null ? `Assumption: ${notRegistered}` : `Told by you: ${ob.tax ? registered : notRegistered}`;
        rateField.hidden = ob.tax !== true;
      };
      const taxBody = h('div', { class: 'launch-tax', hidden: true }, note(taxQuestion?.text || `Do you charge ${tax.label}?`),
        choiceRow([['no', 'No'], ['yes', 'Yes']], ob.tax === true ? 'yes' : ob.tax === false ? 'no' : '', value => { ob.tax = value === 'yes'; paintTax(); }),
        rateField, note(tax.registrationNote));
      paintTax();
      const extraBody = h('div', { class: 'launch-extra', hidden: true }, (preview.questions || []).filter(question => question.id === 'q_1' || question.id === 'q_2').map(question => {
        if (question.kind === 'choice') {
          return h('div', { class: 'launch-question' }, note(question.text, 'launch-strong'),
            choiceRow(question.choices.map(choice => [choice.label, choice.label]), ob.extra[question.id] || '', value => { ob.extra[question.id] = value; }));
        }
        const answer = textInput(ob.extra[question.id] || '', { maxlength: 300 });
        answer.addEventListener('input', () => { ob.extra[question.id] = answer.value; });
        return field(question.text, answer);
      }));
      const keep = obBtn('Keep this plan', () => act(keep, status, async () => {
        ob.price = amount.value.trim();
        if (ob.tax === true && !plain(ob.rate).trim()) throw new Error(`Enter your ${tax.label} rate, in percent, or choose No.`);
        if (ob.vaultOpen) await runSetup({ host: null, skipCreate: false }); else await keepSilently();
      }));
      obFrame('prices', [
        obBack(() => showTemplatePlan()), obTitle('Set your price.'), obLead("Before tax. Chausar's calculator does the totals later."),
        h('div', { class: 'launch-price-set' }, pricing, h('div', { class: 'launch-amount' }, field('Your price', amount), h('span', { class: 'launch-currency' }, country.currency))),
        h('p', { class: 'launch-tax-line' }, taxChip, ' ', toggle('Change', taxBody)), taxBody,
        h('div', {}, toggle('Tell us more (optional)', extraBody), extraBody),
        obActions(keep), status,
      ], { shapes: preview.serviceType?.value || 'other', preview: templatePreview(preview, ob.price) });
    }

    /** The in-vault plan from built-in templates, when a business has no plan yet: price and tax inline, as before. */
    function draftPlanBody(preview, { inVault, onKeep, onRepaint }) {
      const ob = onboarding();
      const country = preview.country;
      const tax = country.tax;
      const taxQuestion = (preview.questions || []).find(question => question.id === 'q_tax');
      const rateQuestion = (preview.questions || []).find(question => question.id === 'q_tax_rate');
      if (ob.rate == null) ob.rate = rateQuestion?.prefill ?? '';
      const status = statusLine();

      const amount = textInput(ob.price, { inputmode: 'decimal', 'aria-label': `Your price, in ${country.currency}` });
      amount.addEventListener('input', () => { ob.price = amount.value; });
      const priceBlock = h('div', { class: 'launch-price-set' },
        h('p', { class: 'launch-strong' }, 'Set your price'),
        choiceRow(PRICING, ob.pricing, value => {
          ob.pricing = value;
          ob.price = amount.value;
          // The offer's name and words follow how it is charged, so the plan is asked for again.
          void act(null, status, async () => {
            const again = await request('venture.preview', { ...previewPayload(preview.idea || ob.idea), pricingModel: value });
            ob.preview = { ...again, idea: again.idea || preview.idea || ob.idea };
            onRepaint();
          });
        }),
        h('div', { class: 'launch-amount' }, field('Your price', amount), h('span', { class: 'launch-currency' }, country.currency)),
        note('Chausar works out tax and totals, with receipts, when you keep this plan.'));

      const charges = tax.mode === 'gst' || tax.mode === 'vat';
      const notRegistered = charges ? `not registered for ${tax.label}` : tax.mode === 'sales-tax' ? "you don't charge sales tax" : "you don't charge tax";
      const registered = charges ? `registered for ${tax.label}` : tax.mode === 'sales-tax' ? 'you charge sales tax' : 'you charge tax';
      const taxChip = h('span', { class: 'launch-chip' });
      const rate = textInput(ob.rate || '', { inputmode: 'decimal', 'aria-label': `${tax.label} rate, in percent` });
      rate.addEventListener('input', () => { ob.rate = rate.value; });
      const rateField = h('div', { hidden: ob.tax !== true }, field(rateQuestion?.text || `What ${tax.label} rate do you charge, in percent?`, rate));
      const paintTax = () => {
        taxChip.textContent = ob.tax === null ? `Assumption: ${notRegistered}` : `Told by you: ${ob.tax ? registered : notRegistered}`;
        rateField.hidden = ob.tax !== true;
      };
      const taxBody = h('div', { class: 'launch-tax', hidden: true }, note(taxQuestion?.text || `Do you charge ${tax.label}?`),
        choiceRow([['no', 'No'], ['yes', 'Yes']], ob.tax === true ? 'yes' : ob.tax === false ? 'no' : '', value => { ob.tax = value === 'yes'; paintTax(); }),
        rateField, note(tax.registrationNote));
      paintTax();

      const extraBody = h('div', { class: 'launch-extra', hidden: true }, (preview.questions || []).filter(question => question.id === 'q_1' || question.id === 'q_2').map(question => {
        if (question.kind === 'choice') {
          return h('div', { class: 'launch-question' }, note(question.text, 'launch-strong'),
            choiceRow(question.choices.map(choice => [choice.label, choice.label]), ob.extra[question.id] || '', value => { ob.extra[question.id] = value; }));
        }
        const answer = textInput(ob.extra[question.id] || '', { maxlength: 300 });
        answer.addEventListener('input', () => { ob.extra[question.id] = answer.value; });
        return field(question.text, answer);
      }));

      const keep = filled('Keep this plan', () => act(keep, status, async () => {
        ob.price = amount.value.trim();
        if (ob.tax === true && !plain(ob.rate).trim()) throw new Error(`Enter your ${tax.label} rate, in percent, or choose No.`);
        await onKeep();
      }));
      return h('div', { class: 'launch-plan' },
        head(inVault ? 'Your plan from built-in templates, not kept yet' : 'Your plan from built-in templates, not saved yet', preview.serviceLabel),
        h('p', { class: 'launch-lead' }, preview.oneLiner.value, ' ', tag(preview.oneLiner)),
        section("Who it's for", h('p', {}, preview.customer.value, ' ', tag(preview.customer))),
        section('Offers', rows(...preview.offers.map(offer => row({
          mark: 'off', title: offer.name.value, label: LABEL_WORDS[offer.name.label] || 'assumption',
        }))), fold('About the offers', false, ...preview.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`))), priceBlock),
        fold('Steps', false, stepRows(preview.deliverySteps)),
        fold('You approve', false, approvalLines(preview.approvals, 'launch-note launch-approval')),
        fold('Back office', false, note(`Invoices and books in ${country.currency}. ${railWords(preview.backOffice.paymentRail)}`)),
        h('p', { class: 'launch-tax-line' }, taxChip, ' ', toggle('Change', taxBody)), taxBody,
        section(null, toggle('Tell us more (optional)', extraBody), extraBody),
        actions(keep),
        status);
    }
    /** A quiet link that shows or hides the part under it, and says which. */
    function toggle(words, part) {
      const control = link(words, () => { part.hidden = !part.hidden; control.setAttribute('aria-expanded', part.hidden ? 'false' : 'true'); }, { 'aria-expanded': 'false' });
      return control;
    }
    /** One line per approval, each with its own label. */
    function approvalLines(approvals, cls = 'launch-approval') { return (approvals || []).map(item => h('p', { class: cls }, item.value, ' ', tag(item))); }
    function stepRows(steps) {
      return rows(...steps.map(step => row({
        mark: step.doneBy === 'you' ? 'you' : 'cha', title: step.title.value, label: LABEL_WORDS[step.title.label] || 'assumption', note: DONE_BY[step.doneBy] || step.doneBy,
        side: step.capability === 'planned' ? chip('planned: agent') : null,
      })));
    }

    // ---------------------------------------------------------------------------------------------
    // Keeping the plan: on this computer the vault is made without a screen of its own; hosted keeps Keep it
    // ---------------------------------------------------------------------------------------------
    /** The name the vault is made with: the composed plan's name, else the built-in plan's kind of service. */
    function keptName() {
      const ob = onboarding();
      return plain(ob.mode === 'ai' && ob.plan ? ob.plan.name.value : ob.preview?.serviceLabel).trim() || 'My service business';
    }
    /** The preview of the plan being kept, named once the vault holds it. */
    function keptPreview() {
      const ob = onboarding();
      if (ob.mode === 'ai' && ob.plan) return planPreview(ob.plan);
      if (ob.preview) return templatePreview(ob.preview, ob.price, plain(state.workspace?.name).trim() || plain(ob.workingName).trim() || null);
      return card?.preview ?? null;
    }
    /** The vault exists: remember it, read the engine's status, and go on to set up the plan. */
    async function vaultMade(result, name) {
      const ob = onboarding();
      ob.workingName = name;
      ob.vaultOpen = true;
      try { state.status = await request('workspace.status'); } catch { /* the vault is open; the status can be read later */ }
      state.workspace = result?.workspace || state.status?.workspace || { name };
    }
    const afterKept = () => {
      const ob = onboarding();
      return ob.mode === 'ai' && ob.plan ? runComposedSetup() : runSetup({ host: null, skipCreate: false });
    };
    /**
     * Keep this plan, on this computer: Chausar makes the encrypted vault itself, named after the business, and the
     * computer's own protected storage keeps its key for the owner's login. No folder, no passphrase. Only when the
     * engine says this computer has no storage it can use does the owner choose a passphrase, with the engine's reason.
     */
    async function keepSilently() {
      if (hosted) { showHostedKeepSafe(); return; }
      const name = keptName();
      let result;
      try { result = await request('workspace.create', { name, pack: 'services', folder: null }); }
      catch (error) {
        if (error?.code === 'DEVICE_KEYS_UNAVAILABLE') { showChoosePassphrase(error.message); return; }
        throw error;
      }
      await vaultMade(result, name);
      await afterKept();
    }
    /** No protected storage on this computer: the engine's reason, then one passphrase, then the recovery code once. */
    function showChoosePassphrase(reason, options = {}) {
      const ob = onboarding();
      const composed = ob.mode === 'ai' && ob.plan;
      const onboardingPlan = !options.name;
      const carried = onboardingPlan ? keptPreview() : null;
      const name = options.name || keptName();
      const back = options.back || (() => (composed ? showPrices() : showTemplatePrices()));
      const after = options.after || afterKept;
      const passphrase = h('input', { type: 'password', value: '', minlength: 12, required: true, autocomplete: 'new-password' });
      const confirm = h('input', { type: 'password', value: '', minlength: 12, required: true, autocomplete: 'new-password' });
      const status = statusLine();
      const submit = h('button', { class: 'ob-btn', type: 'submit' }, 'Lock it in');
      const keepForm = h('form', {
        class: 'ob-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            if (passphrase.value.length < 12) { nudge(passphrase.parentElement); throw new Error('Use a passphrase of at least 12 characters.'); }
            if (passphrase.value !== confirm.value) { nudge(confirm.parentElement); throw new Error('The two passphrases do not match.'); }
            card?.setShapes('lockShut');
            let result;
            const payload = { name, pack: 'services', folder: null, passphrase: passphrase.value };
            if (options.demo) payload.demo = true;
            try { result = await request('workspace.create', payload); }
            catch (error) { card?.setShapes('lockOpen'); throw error; }
            finally { passphrase.value = ''; confirm.value = ''; delete payload.passphrase; }
            card?.setLocked(true);
            if (onboardingPlan) await vaultMade(result, name);
            else { state.status = await request('workspace.status'); state.workspace = result?.workspace || state.status?.workspace || { name }; }
            showRecoveryCode(result, () => { void after(); }, { preview: carried });
          });
        },
      }, passphraseField('Passphrase', passphrase), field('Type it again', confirm),
      h('p', { class: 'ob-hint' }, 'At least 12 characters. Nobody can reset it.'), obActions(submit), status);
      obFrame('keep', [obBack(back), obTitle('Choose a passphrase.'), obLead(plain(reason)), keepForm],
        { shapes: 'lockOpen', preview: carried });
    }

    /** Hosted: a working name only. The server makes and keeps the vault key; the recovery code shows once. */
    function showHostedKeepSafe() {
      const ob = onboarding();
      const name = textInput(ob.workingName || '', { maxlength: 80, autocomplete: 'organization', placeholder: 'My service business' });
      const status = statusLine();
      const submit = h('button', { class: 'ob-btn', type: 'submit' }, 'Keep it');
      const keepForm = h('form', {
        class: 'ob-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            const workingName = name.value.trim() || 'My service business';
            card?.setShapes('lockShut');
            let result;
            try { result = await request('workspace.create', { name: workingName, pack: 'services' }); }
            catch (error) { card?.setShapes('lockOpen'); throw error; }
            await vaultMade(result, workingName);
            showRecoveryCode(result, () => { void runSetup({ host: null, skipCreate: false }); });
          });
        },
      }, field('Working name', name), note(CUSTODY_LINE), warn(EXPERIMENTAL), obActions(submit), status, obFold('More options', note(TEN_YEARS_LINE)));
      // The preview takes the working name as the owner types it.
      const carried = ob.preview ? templatePreview(ob.preview, ob.price, plain(ob.workingName).trim() || null) : null;
      name.addEventListener('input', () => { if (ob.preview) card?.setPreview(templatePreview(ob.preview, ob.price, name.value.trim() || null)); });
      obFrame('keep', [obBack(() => showTemplatePlan()), obTitle('Keep it safe.'), keepForm], { shapes: 'lockOpen', preview: carried });
    }

    /** The recovery code, shown once: the engine's exact string in chunks of four for reading; Copy and Save give it whole. */
    function showRecoveryCode(result, next, { title = 'Save your recovery code.', lead = "If you forget your passphrase, this code is the only way back in. You'll see it once.", preview } = {}) {
      const code = plain(typeof result?.recoveryCode === 'string' ? result.recoveryCode : typeof result?.recoveryKit === 'string' ? result.recoveryKit : '');
      const folder = typeof result?.folder === 'string' && result.folder ? result.folder : '';
      const chunks = code.match(/.{1,4}/g) || [];
      const status = statusLine();
      const saved = h('input', { type: 'checkbox' });
      const go = obBtn('Continue', () => { void next(); }, { disabled: true });
      saved.addEventListener('change', () => { go.disabled = !saved.checked; });
      const fileText = `Chausar recovery code\n${state.workspace?.name ? `Workspace: ${state.workspace.name}\n` : ''}${folder ? `Workspace folder: ${folder}\n` : ''}\n${code}\n`;
      obFrame('code', [
        obTitle(title),
        obLead(lead),
        h('div', { class: 'ob-code', role: 'group', 'aria-label': 'Recovery code', 'data-code-length': String(code.length) },
          chunks.map((part, index) => h('span', { class: `ob-chunk ob-k-${Math.min(index + 1, 12)}` }, part))),
        h('div', { class: 'ob-row2' },
          obGhost('Copy', () => act(null, status, async () => { await copyText(code); status.replaceChildren(note('Recovery code copied.')); })),
          obGhost('Save as file', () => saveText('chausar-recovery-code.txt', fileText, 'text/plain'))),
        h('label', { class: 'ob-check' }, saved, h('span', {}, 'I saved it somewhere safe')),
        obActions(go), status,
        obFold('Where it lives', note(hosted ? CUSTODY_LINE : folder ? folderWords(folder) : TEN_YEARS_LINE)),
      ], { shapes: 'lockShut', locked: true, preview: preview === undefined ? keptPreview() : preview });
    }

    function answerFor(question) {
      const ob = onboarding();
      switch (question.id) {
        case 'q_pricing_model': {
          const choice = question.choices.find(item => item.id === ob.pricing) || question.choices[0];
          return { choiceId: choice.id };
        }
        case 'q_price': return ob.price ? { amount: ob.price } : { skipped: true };
        case 'q_tax': return { yes: ob.tax === true };
        case 'q_tax_rate': return { rate: plain(ob.rate).trim() };
        default: {
          const given = ob.extra[question.id];
          if (question.kind === 'choice') {
            const match = question.choices.find(item => item.label === given);
            if (match) return { choiceId: match.id };
          } else if (typeof given === 'string' && given.trim()) return { text: given.trim() };
          if (!question.required) return { skipped: true };
          throw new Error(`Answer this on your plan first: ${question.text}`);
        }
      }
    }

    /** After the vault exists, for a built-in plan: create the business, answer the template interview, draft and price it. */
    async function runSetup({ host, skipCreate, after = showOwnedPlan }) {
      const ob = onboarding();
      const progress = h('div', { class: 'launch-setup' }, h('p', { class: 'ob-working', role: 'status' }, 'Setting up your plan from built-in templates.'));
      if (host) host.replaceChildren(progress);
      else obFrame('setup', [obTitle('Setting up your plan'), experimental() ? warn(EXPERIMENTAL) : null, progress], { shapes: 'lockShut', locked: true, preview: card?.preview ?? (ob.preview ? templatePreview(ob.preview, ob.price, plain(state.workspace?.name).trim() || null) : null) });
      try {
        await busy(progress, 'Setting up your plan from built-in templates', async () => {
          if (!skipCreate) {
            const payload = { idea: ob.idea, countryCode: ob.countryCode || 'XX' };
            const workspaceName = plain(state.workspace?.name).trim();
            if (ob.workingName) payload.workingName = ob.workingName;
            else if (workspaceName.length >= 2 && workspaceName.length <= 80) payload.workingName = workspaceName;
            try { state.venture = await request('venture.create', payload); }
            catch (error) { if (error?.code !== 'VENTURE_EXISTS') throw error; }
          }
          let view = await request('venture.interview.next', { useTemplate: true });
          const answered = new Set();
          for (let guard = 0; guard < 12; guard++) {
            const question = (view?.interview?.questions || []).find(item => !answered.has(item.id));
            if (!question) break;
            answered.add(question.id);
            view = await request('venture.interview.answer', { questionId: question.id, answer: answerFor(question) });
          }
          await request('venture.blueprint.draft', { useTemplate: true });
          if (ob.price) {
            const receipt = await request('venture.price.quote', { offerId: 'offer_1' });
            const price = receiptPrice(receipt);
            if (price) card?.setPrices({ offer_1: price });
          }
        });
      } catch (error) {
        const retry = () => runSetup({ host, skipCreate, after });
        progress.replaceChildren(...errorNodes(error, retry), actions(filled('Try again', retry), host ? null : link('Back to the plan', () => showTemplatePlan())));
        return;
      }
      state.onboarding = null;
      await after();
    }

    /** Accept: the plan in the vault, with receipts, before acceptance. */
    async function showOwnedPlan() {
      const body = h('div', { class: 'launch-plan' });
      obFrame('open', [body], { shapes: shapeKey === 'lockOpen' ? 'lockShut' : shapeKey, locked: true, preview: card?.preview ?? null });
      try { await paintPlan(body, 'onboarding'); }
      catch (error) { body.replaceChildren(...errorNodes(error, showOwnedPlan)); }
    }
    function goHome() { closeSheet(); state.page = 'today'; renderShell(); }

    // ---------------------------------------------------------------------------------------------
    // Pairing and Welcome back, in look B
    // ---------------------------------------------------------------------------------------------
    /** Pair this browser with the local engine. pair(code) is app.js's own pairing; the code stays in memory. */
    function pairing(error = '', pair) {
      const code = h('input', { type: 'password', value: '', maxlength: 2048, autocomplete: 'off', spellcheck: 'false' });
      const status = statusLine();
      const submit = h('button', { class: 'ob-btn', type: 'submit' }, 'Pair');
      const pairForm = h('form', {
        class: 'ob-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            const value = code.value;
            code.value = '';
            if (!plain(value).trim()) { nudge(code.parentElement); throw new Error('Paste the pairing link first.'); }
            await pair(value);
          });
        },
      }, field('Pairing link or code', code), obActions(submit), status);
      obFrame('pair', [
        obTitle('Pair this browser.'), obLead('Paste the pairing link Chausar printed when it started on this computer.'),
        obAlert(error), pairForm, note('It stays in memory. After a refresh, pair again.'),
      ], { shapes: 'lockShut', focus: false });
      focusOnDesk(code);
    }
    // ---------------------------------------------------------------------------------------------
    // Welcome back: the businesses on this computer, opened without typing a folder. A passphrase only for a business
    // locked with one; a recovery code, a backup, or a move from another computer one link away.
    // ---------------------------------------------------------------------------------------------
    const OPENS_CHIPS = Object.freeze({ 'with-this-computer': 'Opens with this computer', 'needs-passphrase': 'Needs your passphrase', 'key-missing': "This computer's key is missing" });
    const BACKUP_KIND_WORDS = Object.freeze({ auto: 'Automatic', manual: 'You made it', safety: 'Before a change' });
    /** Copies of the contract's custody words and limits (platform/runtime/workspace-custody-contracts.ts). A test compares them. */
    const CUSTODY_COPY = Object.freeze({
      unavailable: Object.freeze({
        'not-configured': 'This app keeps businesses with a passphrase.',
        platform: "Chausar can't keep the key safe on this kind of computer, so it asks for a passphrase.",
        blocked: "Windows wouldn't let Chausar use its protected storage here, so Chausar asks for a passphrase.",
        'no-keyring': 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.',
        locked: 'Your keychain is locked or not open to Chausar, so Chausar asks for a passphrase.',
        failed: "This computer's protected storage didn't answer, so Chausar asks for a passphrase.",
      }),
      errors: Object.freeze({
        PASSPHRASE_REQUIRED: 'This business is locked with a passphrase. Type it to open.',
        DEVICE_KEY_FAILED: "This computer's key didn't open your business. Use your recovery code, or a backup with it.",
        PASSPHRASE_WRONG: "That passphrase doesn't match.",
        CUSTODY_UNCHANGED: "It's already set that way.",
        TRANSFER_CODE_WRONG: "That code doesn't open this file. Check it and try again.",
        TRANSFER_INVALID: "This isn't a Chausar move file.",
        TRANSFER_TOO_LARGE: 'This file is bigger than Chausar can take in one go.',
        TRANSFER_SAME_BUSINESS: 'This business is already on this computer. Open it from the list.',
        BACKUP_NOT_FOUND: 'That backup is not in the backups folder.',
        BACKUP_OTHER_BUSINESS: 'This backup belongs to another business.',
        SYNC_NEEDS_PASSPHRASE: 'Device sync needs a business locked with a passphrase.',
      }),
      maxTextChars: 1_900_000,
    });
    /** The engine's list of this computer's businesses. A failed read leaves the typed folder field as the way in. */
    async function listBusinesses() {
      try { return await request('workspace.list'); }
      catch (error) { return { businesses: [], complete: false, error }; }
    }
    /** The vault is open: read the engine's status and go on, as every way in does. */
    async function opened(result) {
      state.status = await request('workspace.status');
      state.workspace = result?.workspace || state.status?.workspace || null;
      applyWorkspaceStatus(state.status);
    }
    /** "19 Oct 2026, 14:05" on this computer's clock, for a backup. */
    function backupWhen(at) {
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) return plain(at);
      return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }
    /**
     * The first screen on this computer. A held draft or a connected draft AI resumes onboarding. Otherwise the list:
     * one business that opens with this computer, not closed by its owner, opens straight away; more go to Welcome back;
     * none starts onboarding. Hosted web keeps today's order: the open box first.
     */
    function firstRun(status) {
      const ob = onboarding();
      ob.vaultOpen = false;
      void (hosted ? startFlow() : bootFlow(status));
    }
    async function bootFlow(status) {
      let ai = null;
      try { ai = await request('venture.ai.status'); } catch { ai = null; }
      if (ai && (ai.connections || []).length) { await startFlow(ai); return; }
      const list = await listBusinesses();
      const businesses = list.businesses || [];
      if (businesses.length === 1 && businesses[0].opens === 'with-this-computer' && status?.closedByOwner !== true) {
        const only = businesses[0];
        try { await opened(await request('workspace.open', { folder: only.folder })); }
        catch (error) { paintWelcome('', list, { folder: only.folder, error }); }
        return;
      }
      if (businesses.length) { paintWelcome('', list); return; }
      await startFlow(ai || undefined);
    }
    /** Welcome back. app.js calls it after the owner closes a business; it reads the list unless it was given one. */
    function openExisting(error = '', list = null) {
      if (list?.businesses) { paintWelcome(error, list); return; }
      void listBusinesses().then(found => paintWelcome(error, found));
    }
    function paintWelcome(error, list, failed = null) {
      const businesses = [...(list?.businesses || [])].sort((a, b) => plain(b.openedAt).localeCompare(plain(a.openedAt)));
      const status = statusLine();
      const rowNode = (business, index) => {
        const node = h('div', { class: 'ob-biz', 'data-folder': business.folder });
        const rowStatus = statusLine();
        const words = h('div', { class: 'ob-biz-words' }, h('span', { class: 'ob-biz-name' }, business.name || business.folder),
          h('span', { class: `ob-chip ob-chip-${business.opens}` }, OPENS_CHIPS[business.opens] || business.opens));
        const paint = (asking = false) => {
          const kind = index === 0 ? obBtn : obGhost;
          let action = null, extra = null;
          if (business.opens === 'with-this-computer') {
            action = kind('Open', () => act(action, rowStatus, async () => { await opened(await request('workspace.open', { folder: business.folder })); }));
          } else if (business.opens === 'needs-passphrase' && !asking) {
            action = kind('Open', () => paint(true));
          } else if (business.opens === 'needs-passphrase') {
            const passphrase = h('input', { type: 'password', value: '', autocomplete: 'current-password', 'aria-label': `Passphrase for ${business.name || business.folder}` });
            const go = obBtn('Open', () => act(go, rowStatus, async () => {
              if (!passphrase.value) { nudge(passphrase.parentElement); throw new Error('Enter your passphrase.'); }
              let result;
              try { result = await request('workspace.open', { folder: business.folder, passphrase: passphrase.value }); }
              finally { passphrase.value = ''; }
              await opened(result);
            }));
            passphrase.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); go.click(); } });
            extra = h('div', { class: 'ob-biz-pass' }, passphraseField('Passphrase', passphrase), obActions(go));
            focusOnDesk(passphrase);
          } else {
            action = obGhost('Use my recovery code', () => showRecover(list, business.folder));
          }
          fill(node, words, action, extra, rowStatus);
        };
        paint(false);
        if (failed?.folder === business.folder) showError(rowStatus, failed.error);
        return node;
      };
      const sample = experimental() ? obLink('Create a vault with the sample business', () => act(null, status, async () => {
        let result;
        try { result = await request('workspace.create', { name: 'Sample business', demo: true, folder: null }); }
        catch (error) {
          if (error?.code === 'DEVICE_KEYS_UNAVAILABLE') {
            showChoosePassphrase(error.message, { name: 'Sample business', demo: true, back: () => paintWelcome('', list), after: () => applyWorkspaceStatus(state.status) });
            return;
          }
          throw error;
        }
        await opened(result);
      })) : null;
      const retry = obLink('Try the engine again', () => act(null, status, async () => { applyWorkspaceStatus(await request('workspace.status')); }));
      const byFolder = !list?.complete || !businesses.length ? obLink('Open by folder name', () => showOpenByFolder()) : null;
      obFrame('back', [
        obTitle('Welcome back.'),
        obLead(businesses.length ? 'Your businesses on this computer.' : 'Chausar found no business on this computer.'),
        obAlert(error || list?.error?.message || ''),
        businesses.length ? h('div', { class: 'ob-biz-rows' }, businesses.slice(0, 2).map(rowNode)) : null,
        businesses.length > 2 ? obFold('More businesses', h('div', { class: 'ob-biz-rows' }, businesses.slice(2).map((business, at) => rowNode(business, at + 2)))) : null,
        status,
        h('p', { class: 'ob-u-links' }, obLink('Start a new business', () => { void startFlow(); }), ' ', obLink('Move from another computer', () => showMoveHere(list))),
        obFold('More options', h('p', { class: 'ob-u-links' },
          obLink('Restore a backup', () => showRestoreBackup(list)), ' ', obLink('Use a recovery code', () => showRecover(list)),
          byFolder ? ' ' : null, byFolder, ' ', retry, sample ? ' ' : null, sample)),
      ], { shapes: 'lockShut' });
    }
    /** The old typed way in, for a business the list can't show (PostgreSQL storage) or an empty list. */
    function showOpenByFolder() {
      const folder = textInput('main', { maxlength: 64, spellcheck: 'false' });
      const passphrase = h('input', { type: 'password', value: '', autocomplete: 'current-password' });
      const status = statusLine();
      const submit = h('button', { class: 'ob-btn', type: 'submit' }, 'Open');
      const formNode = h('form', {
        class: 'ob-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            const payload = { folder: folder.value.trim() || 'main' };
            if (passphrase.value) payload.passphrase = passphrase.value;
            let result;
            try { result = await request('workspace.open', payload); }
            finally { passphrase.value = ''; }
            await opened(result);
          });
        },
      }, field('Vault folder', folder), passphraseField('Passphrase, if it has one', passphrase), obActions(submit), status);
      obFrame('back', [obBack(() => openExisting()), obTitle('Open by folder name.'), formNode], { shapes: 'lockShut' });
    }
    /** A new passphrase pair, shown only once the engine says this computer can't keep the key. */
    function newPassphrasePair() {
      const passphrase = h('input', { type: 'password', value: '', minlength: 12, autocomplete: 'new-password' });
      const confirm = h('input', { type: 'password', value: '', minlength: 12, autocomplete: 'new-password' });
      const node = h('div', { class: 'ob-pass-pair', hidden: true }, passphraseField('New passphrase', passphrase), field('Type it again', confirm),
        h('p', { class: 'ob-hint' }, 'At least 12 characters. Nobody can reset it.'));
      return {
        node, wanted: () => !node.hidden,
        show: reason => { node.hidden = false; return reason; },
        value: () => {
          if (passphrase.value.length < 12) { nudge(passphrase.parentElement); throw new Error('Use a passphrase of at least 12 characters.'); }
          if (passphrase.value !== confirm.value) { nudge(confirm.parentElement); throw new Error('The two passphrases do not match.'); }
          return passphrase.value;
        },
        clear: () => { passphrase.value = ''; confirm.value = ''; },
      };
    }
    /** Recover with the code: the business from the list, the code, and a new passphrase only when this computer can't keep the key. */
    function showRecover(list, chosen = null) {
      const businesses = list?.businesses || [];
      const folder = businesses.length ? picker(businesses.map(item => [item.folder, item.name || item.folder]), chosen || businesses[0].folder) : textInput(chosen || 'main', { maxlength: 64, spellcheck: 'false' });
      const code = h('input', { type: 'password', value: '', autocomplete: 'off', spellcheck: 'false' });
      const pair = newPassphrasePair();
      const reason = h('p', { class: 'ob-hint', hidden: true });
      const status = statusLine();
      const submit = h('button', { class: 'ob-btn', type: 'submit' }, 'Recover');
      const formNode = h('form', {
        class: 'ob-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            const payload = { folder: plain(folder.value).trim() || 'main', recoveryCode: code.value.trim() };
            if (!payload.recoveryCode) { nudge(code.parentElement); throw new Error('Type your recovery code first.'); }
            let result;
            try {
              if (pair.wanted()) payload.passphrase = pair.value();
              result = await request('workspace.recover', payload);
            } catch (error) {
              if (error?.code === 'DEVICE_KEYS_UNAVAILABLE' && !pair.wanted()) { reason.textContent = pair.show(error.message); reason.hidden = false; return; }
              throw error;
            } finally { code.value = ''; pair.clear(); delete payload.passphrase; }
            await opened(result);
          });
        },
      }, field(businesses.length ? 'Business' : 'Vault folder', folder), field('Recovery code', code), reason, pair.node, obActions(submit), status);
      obFrame('back', [obBack(() => openExisting('', list)), obTitle('Use your recovery code.'), obLead('It opens your business, and this computer keeps the key again.'), formNode], { shapes: 'lockShut' });
    }
    /** Restore a backup before opening: every backup on this computer, newest first, grouped by business. */
    async function showRestoreBackup(list) {
      const host = h('div', { class: 'ob-backups' }, outline(3));
      obFrame('back', [obBack(() => openExisting('', list)), obTitle('Restore a backup.'), obLead('Backups on this computer, newest first.'), host], { shapes: 'lockShut' });
      let found;
      try { found = await request('workspace.backups.list'); }
      catch (error) { fill(host, ...errorNodes(error, () => showRestoreBackup(list))); return; }
      const backups = found?.backups || [];
      if (!backups.length) { fill(host, note('There are no backups on this computer yet.')); return; }
      const groups = new Map();
      for (const backup of backups) { const key = backup.name || 'A business'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(backup); }
      const shown = [...groups.entries()].map(([name, items]) => obFold(name, h('div', { class: 'ob-backup-rows' }, items.map(backup => restoreRow(backup, list)))));
      if (shown[0]) shown[0].open = true;
      fill(host, ...shown);
    }
    function restoreRow(backup, list) {
      const node = h('div', { class: 'ob-backup', 'data-file': backup.file });
      const status = statusLine();
      const extra = h('div', { class: 'ob-backup-ask' });
      const pair = newPassphrasePair();
      let passphrase = null, code = null;
      const go = obGhost('Restore', () => act(go, status, async () => {
        const payload = { backupFile: backup.file, folder: null };
        try {
          if (passphrase) payload.passphrase = passphrase.value;
          if (code) { payload.recoveryCode = code.value.trim(); if (pair.wanted()) payload.passphrase = pair.value(); }
          const result = await request('workspace.restore', payload);
          await opened(result);
        } catch (error) {
          if (error?.code === 'PASSPHRASE_REQUIRED' && !passphrase) {
            passphrase = h('input', { type: 'password', value: '', autocomplete: 'current-password' });
            fill(extra, passphraseField('Passphrase', passphrase));
          } else if (error?.code === 'DEVICE_KEY_FAILED' && !code) {
            code = h('input', { type: 'password', value: '', autocomplete: 'off', spellcheck: 'false' });
            fill(extra, field('Recovery code', code), pair.node);
          } else if (error?.code === 'DEVICE_KEYS_UNAVAILABLE' && code && !pair.wanted()) pair.show(error.message);
          throw error;
        } finally {
          if (passphrase) passphrase.value = '';
          if (code) code.value = '';
          pair.clear();
          delete payload.passphrase; delete payload.recoveryCode;
        }
      }));
      fill(node, h('div', { class: 'ob-biz-words' }, h('span', { class: 'ob-biz-name' }, backupWhen(backup.at)), h('span', { class: 'ob-chip' }, BACKUP_KIND_WORDS[backup.kind] || backup.kind)), go, extra, status);
      return node;
    }
    /** Move a business here: the move file from the other computer and its one-time code. */
    function showMoveHere(list) {
      const file = h('input', { type: 'file', accept: '.backup,application/json', 'aria-label': 'The move file' });
      const code = h('input', { type: 'password', value: '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'The move code' });
      const pair = newPassphrasePair();
      const reason = h('p', { class: 'ob-hint', hidden: true });
      const status = statusLine();
      const go = obBtn('Move it here', () => act(go, status, async () => {
        const chosen = file.files?.[0];
        if (!chosen) { nudge(file.parentElement); throw new Error('Choose the move file first.'); }
        let fileText = await chosen.text();
        const payload = { fileText, transferCode: code.value.trim() };
        try {
          if (fileText.length > CUSTODY_COPY.maxTextChars) throw Object.assign(new Error(CUSTODY_COPY.errors.TRANSFER_TOO_LARGE), { code: 'TRANSFER_TOO_LARGE' });
          if (!payload.transferCode) { nudge(code.parentElement); throw new Error('Type the move code first.'); }
          if (pair.wanted()) payload.passphrase = pair.value();
          const result = await request('workspace.transfer.import', payload);
          await opened(result);
        } catch (error) {
          if (error?.code === 'DEVICE_KEYS_UNAVAILABLE' && !pair.wanted()) { reason.textContent = pair.show(error.message); reason.hidden = false; return; }
          throw error;
        } finally {
          code.value = ''; pair.clear(); fileText = '';
          delete payload.fileText; delete payload.transferCode; delete payload.passphrase;
        }
      }));
      obFrame('back', [
        obBack(() => openExisting('', list)), obTitle('Move a business here.'), obLead('Choose the file from your other computer and type its code.'),
        field('The move file', file), field('The move code', code), reason, pair.node, obActions(go), status,
      ], { shapes: 'lockShut' });
    }
    const applyWorkspaceStatus = status => (typeof kit.applyWorkspaceStatus === 'function' ? kit.applyWorkspaceStatus(status) : afterOpen());

    // ---------------------------------------------------------------------------------------------
    // The plan in the vault: onboarding step four and the "Your business" place
    // ---------------------------------------------------------------------------------------------
    async function paintPlan(host, mode) {
      const [view, blueprintView, models] = await Promise.all([request('venture.get'), request('venture.blueprint.get'), modelStatus()]);
      if (!view) { host.replaceChildren(noVenture()); return; }
      state.venture = view;
      if (!blueprintView) {
        const ob = onboarding();
        ob.vaultOpen = true;
        ob.idea = view.venture.idea;
        ob.countryCode = view.venture.country.code;
        ob.preview = await request('venture.preview', previewPayload(view.venture.idea));
        const after = mode === 'place' ? () => navigate('business') : showOwnedPlan;
        const repaint = () => host.replaceChildren(draftPlanBody(ob.preview, { inVault: true, onKeep: () => runSetup({ host, skipCreate: true, after }), onRepaint: repaint }));
        repaint();
        return;
      }
      await learnToolNames(blueprintView.blueprint?.tools);
      host.replaceChildren(planBody({ view, blueprintView, models, mode, host }));
      // Accept: the preview now shows the kept plan, with each offer's receipt total as the engine gave it.
      if (mode === 'onboarding' && card) { card.setPreview(blueprintPreview(view, blueprintView)); card.setShapes(blueprintView.blueprint.serviceType); }
    }
    /** The kept plan stores only tool ids. Names come from the composed plan in this session, else from the connector
        catalogue, so a reload never shows a raw id where the owner saw a name. A failed read leaves the ids. */
    async function learnToolNames(tools) {
      if (!(tools || []).some(item => !toolNames[item.block])) return;
      const { value } = await settle(request('venture.connectors.list', {}));
      for (const cardItem of Array.isArray(value) ? value : []) if (cardItem?.id && cardItem.name && !toolNames[cardItem.id]) toolNames[cardItem.id] = cardItem.name;
    }

    function planBody(ctx) {
      const { view, blueprintView, models, mode, host } = ctx;
      const plan = blueprintView.blueprint;
      const receipts = blueprintView.offerReceipts || {};
      const country = view.venture.country;
      const backOffice = plan.backOffice;
      const open = false; // the folds stay shut at rest, in onboarding and in the place alike
      const status = statusLine();
      const refresh = () => paintPlan(host, mode);

      const offerRows = plan.offers.map(offer => {
        const receipt = receipts[offer.id];
        const total = figureOf(receipt, 'total');
        let side;
        if (total) {
          side = h('span', { class: 'launch-price' }, h('button', { class: 'launch-fig-btn', type: 'button', onclick: () => sheet('Price receipt', priceReceiptBody(receipt)) }, total.display),
            h('span', { class: 'launch-unit' }, ` ${UNIT_WORDS[offer.pricing.quantityUnit] || ''}`));
        } else if (offer.pricing.unitPriceMinor) {
          const again = quiet('Work out the price', () => act(again, status, async () => { await request('venture.price.quote', { offerId: offer.id }); await refresh(); }));
          side = again;
        } else side = link('Set your price', () => openPriceSheet(ctx, offer));
        return row({ mark: offer.pricing.unitPriceMinor ? 'you' : 'off', title: offer.name.value, label: LABEL_WORDS[offer.name.label] || 'assumption', side });
      });
      const taxFigure = Object.values(receipts).map(receipt => figureOf(receipt, 'tax')).find(Boolean);
      const taxWords = backOffice.taxRegistered.value
        ? (taxFigure ? `Tax: ${taxFigure.label}.` : `Tax: ${backOffice.taxLabel}, registered.`)
        : `Tax: not registered for ${taxInSentence(backOffice.taxLabel)}.`;
      const needsTaxFields = backOffice.taxRegistered.value && backOffice.invoiceKind === 'tax-invoice';
      const missing = needsTaxFields && backOffice.taxInvoiceMissing.length
        ? h('p', { class: 'launch-note' }, `For a tax invoice, add: ${backOffice.taxInvoiceMissing.join(', ')}. `, link('Add them', () => openTaxSheet(ctx)))
        : null;
      const ready = needsTaxFields && !backOffice.taxInvoiceMissing.length
        ? h('p', { class: 'launch-note' }, `Ready for tax invoices. ${country.tax.idLabel} ${backOffice.taxId || ''}. `, link('Change', () => openTaxSheet(ctx)))
        : null;
      const active = (view.terms || []).filter(term => term.lifecycle === 'active').map(term => term.name);
      const proposed = (view.terms || []).filter(term => term.lifecycle === 'proposed').map(term => term.name);

      const accept = plan.status === 'draft' ? filled('Accept plan', () => act(accept, status, async () => {
        await quoteAgain();
        await request('venture.blueprint.accept', { digest: plan.digest });
        if (mode === 'onboarding') await showBuildStep(); else await navigate('build');
      })) : null;
      const rewrite = quiet('Rewrite with AI', () => act(rewrite, status, async () => {
        const current = await request('venture.models.status');
        if (!servedByModel(current, 'main')) { void openAiSheet(refresh); return; }
        await busy(host, `Writing your plan ${writtenBy(current, current.tiers.main.presetId, current.tiers.main.model)}`, async () => {
          await request('venture.blueprint.draft', {});
          await quoteAgain();
        });
        await refresh();
      }));

      // A plan the AI composed from blocks keeps its website pages, tools and notes; each sits in its own fold.
      const composedParts = [
        plan.pages?.length ? fold('Your website', open, ...plan.pages.map(item => note(`${item.title.value}: ${item.purpose.value}`))) : null,
        plan.tools?.length ? fold('Tools to connect', open, ...plan.tools.map(item => note(`${toolNames[item.block] || item.block}: ${item.reason.value}`))) : null,
        plan.notes?.length ? fold('Check before you start', open, ...plan.notes.map(item => note(item.text))) : null,
      ];
      if (mode === 'onboarding') {
        // Onboarding shows the name, the offers with their receipts and Accept at rest; the rest is one fold away. The
        // version number and the Offers heading wait for the place: with three priced offers they would take Accept over
        // 45 words. Who wrote the plan still shows at rest when it was not the connected AI.
        const by = plan.source !== 'model' ? 'From built-in templates' : replaying(models) ? 'From a synthetic recording' : null;
        return h('div', { class: 'launch-plan-body' },
          head(by, plan.name.value),
          section(null, rows(...offerRows)),
          actions(accept, quiet('Change plan', () => openChangeSheet(ctx))),
          status,
          fold('More of your plan', open,
            h('p', {}, plan.oneLiner.value, ' ', tag(plan.oneLiner)),
            h('p', { class: 'launch-note' }, h('span', { class: 'launch-label' }, 'for'), ' ', plan.customer.value, ' ', tag(plan.customer)),
            ...plan.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`)),
            plan.source === 'model' ? recordingNote(models) : null,
            missing,
            fold('Steps', open, stepRows(plan.deliverySteps), ...plan.deliverySteps.map(step => note(`${step.title.value}: ${step.note}`))),
            fold('You approve', open, approvalLines(plan.approvals, 'launch-note launch-approval')),
            fold('Back office', open, note(`Invoices and books in ${backOffice.currency}. ${taxWords} ${railWords(backOffice.paymentRail)}`), tag(backOffice.taxRegistered), ready),
            ...composedParts,
            actions(rewrite, link('Go to your business', goHome))));
      }
      // At rest: the name, the one line, the offers with their prices, and the folds. The longer words open in place.
      const source = plan.source === 'model' ? '' : ', from built-in templates';
      return h('div', { class: 'launch-plan-body' },
        head(`Version ${plan.version}, ${plan.status === 'accepted' ? 'accepted' : 'not accepted yet'}${source}`, plan.name.value),
        h('p', { class: 'launch-lead' }, plan.oneLiner.value, ' ', tag(plan.oneLiner)),
        plan.source === 'model' ? recordingNote(models) : null,
        section('Offers', rows(...offerRows)),
        missing,
        fold('More about the plan', open,
          h('p', { class: 'launch-note' }, h('span', { class: 'launch-label' }, 'for'), ' ', plan.customer.value, ' ', tag(plan.customer)),
          ...plan.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`)),
          mode === 'place' ? note(`What your business knows. Active: ${active.join(', ') || 'none yet'}. Proposed: ${proposed.join(', ') || 'none'}.`) : null,
          ...(mode === 'place' ? (view.terms || []).map(term => note(`${term.name}: ${term.meaning}`)) : [])),
        fold('Steps', open, stepRows(plan.deliverySteps), ...plan.deliverySteps.map(step => note(`${step.title.value}: ${step.note}`))),
        fold('You approve', open, approvalLines(plan.approvals, 'launch-note launch-approval')),
        fold('Back office', open, note(`Invoices and books in ${backOffice.currency}. ${taxWords} ${railWords(backOffice.paymentRail)}`), tag(backOffice.taxRegistered), ready),
        ...composedParts,
        actions(accept, quiet('Change plan', () => openChangeSheet(ctx)), rewrite),
        status);
    }

    /** Prices every priced offer that has no current receipt for the latest plan version. */
    async function quoteAgain() {
      const fresh = await request('venture.blueprint.get');
      for (const offer of fresh?.blueprint?.offers || []) {
        if (offer.pricing.unitPriceMinor && !fresh.offerReceipts?.[offer.id]) await request('venture.price.quote', { offerId: offer.id });
      }
    }

    function openPriceSheet(ctx, offer) {
      const currency = ctx.blueprintView.blueprint.backOffice.currency;
      let pricing = offer.pricing.model;
      const amount = textInput('', { inputmode: 'decimal', 'aria-label': `Price, in ${currency}` });
      const status = statusLine();
      const save = filled('Save price', () => act(save, status, async () => {
        const typed = amount.value.trim();
        if (!typed) throw new Error('Type a price first.');
        await request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: typed, pricingModel: pricing }] } });
        await quoteAgain();
        closeSheet();
        await paintPlan(ctx.host, ctx.mode);
      }));
      sheet(`Set your price for ${offer.name.value}`, h('div', {},
        choiceRow(PRICING, pricing, value => { pricing = value; }),
        h('div', { class: 'launch-amount' }, field('Your price', amount), h('span', { class: 'launch-currency' }, currency)),
        note('Chausar works out tax and totals with a receipt.'), actions(save), status));
    }

    function openChangeSheet(ctx) {
      const plan = ctx.blueprintView.blueprint;
      const backOffice = plan.backOffice;
      const name = textInput(plan.name.value, { maxlength: 60 });
      const oneLiner = textInput(plan.oneLiner.value, { maxlength: 160 });
      const customer = h('textarea', { rows: 2, maxlength: 200, value: plan.customer.value });
      const offerControls = plan.offers.map(offer => ({
        offer,
        name: textInput(offer.name.value, { maxlength: 60 }),
        description: h('textarea', { rows: 2, maxlength: 200, value: offer.description.value }),
        price: textInput('', { inputmode: 'decimal', placeholder: 'Leave empty to keep the price' }),
        pricing: picker(PRICING, offer.pricing.model),
      }));
      let registered = backOffice.taxRegistered.value;
      const rate = textInput('', { inputmode: 'decimal', placeholder: 'Leave empty to keep the rate' });
      const rateField = h('div', { hidden: !registered }, field(`${backOffice.taxLabel} rate, in percent`, rate));
      const status = statusLine();
      const save = filled('Save changes', () => act(save, status, async () => {
        const patch = {};
        const changed = (control, before) => { const value = control.value.trim(); return value && value !== before ? value : null; };
        if (changed(name, plan.name.value)) patch.name = name.value.trim();
        if (changed(oneLiner, plan.oneLiner.value)) patch.oneLiner = oneLiner.value.trim();
        if (changed(customer, plan.customer.value)) patch.customer = customer.value.trim();
        const offers = [];
        for (const control of offerControls) {
          const item = { id: control.offer.id };
          if (changed(control.name, control.offer.name.value)) item.name = control.name.value.trim();
          if (changed(control.description, control.offer.description.value)) item.description = control.description.value.trim();
          if (control.price.value.trim()) item.unitPrice = control.price.value.trim();
          if (control.pricing.value !== control.offer.pricing.model) item.pricingModel = control.pricing.value;
          if (Object.keys(item).length > 1) offers.push(item);
        }
        if (offers.length) patch.offers = offers;
        if (registered !== backOffice.taxRegistered.value) patch.taxRegistered = registered;
        if (registered && rate.value.trim()) patch.taxRate = rate.value.trim();
        if (!Object.keys(patch).length) throw new Error('Nothing changed yet.');
        await request('venture.blueprint.update', { patch });
        await quoteAgain();
        closeSheet();
        await paintPlan(ctx.host, ctx.mode);
      }));
      sheet('Change plan', h('div', {},
        field('Name', name), field('One line', oneLiner), field("Who it's for", customer),
        ...offerControls.map(control => h('div', { class: 'launch-sheet-group' }, note(control.offer.name.value, 'launch-strong'),
          field('Offer name', control.name), field('What it includes', control.description), field('How you charge', control.pricing), field('New price', control.price))),
        note(`Do you charge ${taxInSentence(backOffice.taxLabel)}?`, 'launch-strong'),
        choiceRow([['no', 'No'], ['yes', 'Yes']], registered ? 'yes' : 'no', value => { registered = value === 'yes'; rateField.hidden = !registered; }),
        rateField, actions(save), status));
    }

    function openTaxSheet(ctx) {
      const backOffice = ctx.blueprintView.blueprint.backOffice;
      const country = ctx.view.venture.country;
      const india = country.code === 'IN';
      const taxId = textInput(backOffice.taxId || '', { maxlength: 30 });
      const statePick = india ? picker([['', 'From your GSTIN'], ...stateOptions()], backOffice.taxState || '') : null;
      const sac = india ? textInput(backOffice.sacCode || '', { maxlength: 6, inputmode: 'numeric' }) : null;
      const lut = india ? h('input', { type: 'checkbox', checked: backOffice.lutConfirmed }) : null;
      const status = statusLine();
      const save = filled('Save', () => act(save, status, async () => {
        const patch = {};
        const typedId = taxId.value.trim();
        if (typedId && typedId !== (backOffice.taxId || '')) patch.taxId = typedId;
        if (india) {
          if (statePick.value && statePick.value !== (backOffice.taxState || '')) patch.taxState = statePick.value;
          if (sac.value.trim() && sac.value.trim() !== (backOffice.sacCode || '')) patch.sacCode = sac.value.trim();
          if (lut.checked !== backOffice.lutConfirmed) patch.lutConfirmed = lut.checked;
        }
        if (!Object.keys(patch).length) throw new Error('Nothing changed yet.');
        await request('venture.blueprint.update', { patch });
        await quoteAgain();
        closeSheet();
        await paintPlan(ctx.host, ctx.mode);
      }));
      sheet('Tax invoice details', h('div', {},
        field(`Your ${country.tax.idLabel}`, taxId),
        india ? field('Your state', statePick) : null,
        india ? field('Your SAC code', sac, 'Six digits starting 99.') : null,
        india ? h('label', { class: 'launch-check' }, lut, h('span', {}, 'I have an LUT for exports')) : null,
        backOffice.taxInvoiceMissing.length ? note(`Still needed: ${backOffice.taxInvoiceMissing.join(', ')}.`) : null,
        actions(save), status));
    }

    function priceReceiptBody(receipt) {
      return h('div', { class: 'launch-receipt' },
        receipt.stale ? warn('Stale: the price or tax changed after this receipt. Work it out again.') : null,
        rows(...receipt.figures.map(item => h('div', { class: `launch-receipt-row${item.key === 'total' ? ' total' : ''}` }, h('span', {}, item.label), h('span', { class: 'launch-fig' }, item.display)))),
        h('p', { class: 'launch-explain' }, receipt.explanation),
        h('div', { class: 'launch-small' },
          h('p', {}, 'How it was worked out'),
          h('ol', {}, receipt.steps.map(step => h('li', {}, `${step.rule}: ${step.inputs.join(', ')} gives ${step.resultMinor}`))),
          h('p', {}, `Amounts in the steps are in the smallest unit of ${receipt.currency}.`),
          h('p', { class: 'launch-mono' }, `Receipt ${receipt.id}`)));
    }
    async function openBooksReceipt(figure) {
      const body = h('div', { class: 'launch-receipt' }, outline(4));
      sheet(figure.label, body);
      try {
        const receipt = await request('receipts.get', { id: figure.receiptId });
        fill(body,
          receipt?.stale || figure.stale ? warn('Stale: the books changed after this receipt.') : null,
          rows(...(receipt?.figures || []).map(item => h('div', { class: 'launch-receipt-row' }, h('span', {}, item.label), h('span', { class: 'launch-fig' }, item.display)))),
          receipt?.explanation ? h('p', { class: 'launch-explain' }, receipt.explanation) : null,
          h('div', { class: 'launch-small' },
            receipt?.period ? h('p', {}, `Period: ${dayText(receipt.period.from)} to ${dayText(receipt.period.to)}`) : null,
            receipt?.coverage ? h('p', {}, `Rows counted: ${receipt.coverage.countedRows}. Rows left out: ${receipt.coverage.excludedRows}.`) : null,
            h('p', { class: 'launch-mono' }, `Receipt ${figure.receiptId}`)));
      } catch (error) { body.replaceChildren(...errorNodes(error, () => openBooksReceipt(figure))); }
    }

    // ---------------------------------------------------------------------------------------------
    // Build: the brief, the builders, and following the code on GitHub
    // ---------------------------------------------------------------------------------------------
    async function showBuildStep() {
      const content = h('div', { class: 'launch-build' }, note('Writing your build brief.'));
      obFrame('build', [content, actions(link('Go to your business', goHome))], { shapes: shapeKey, locked: true, siteFront: true, preview: card?.preview ?? null });
      try {
        const models = await modelStatus();
        const words = servedByModel(models) ? `Writing your build brief ${writtenBy(models, models.tiers.main.presetId, models.tiers.main.model)}` : 'Writing your build brief from built-in templates';
        await busy(content, words, () => request('venture.build.brief', {}));
        const status = await request('venture.build.status');
        content.replaceChildren(...buildBody({ status, models, mode: 'onboarding', refresh: showBuildStepAgain }));
      } catch (error) {
        content.replaceChildren(...errorNodes(error, showBuildStep), actions(quiet('Try again', showBuildStep)));
      }
    }
    async function showBuildStepAgain() {
      const content = h('div', { class: 'launch-build' });
      obFrame('build', [content, actions(link('Go to your business', goHome))], { shapes: shapeKey, locked: true, siteFront: true, preview: card?.preview ?? null });
      try {
        const [status, models] = await Promise.all([request('venture.build.status'), modelStatus()]);
        content.replaceChildren(...buildBody({ status, models, mode: 'onboarding', refresh: showBuildStepAgain }));
      } catch (error) { content.replaceChildren(...errorNodes(error, showBuildStepAgain)); }
    }

    /** The opening words of the brief: its first section, cut short. "Read it" shows every line. */
    function openingLines(markdown) {
      const lines = plain(markdown).split('\n').map(item => item.trim()).filter(Boolean);
      const start = lines.findIndex(item => /^##\s*1\./.test(item));
      const paragraph = start >= 0 ? (lines[start + 1] || '') : (lines[1] || lines[0] || '');
      return paragraph.length > 80 ? `${paragraph.slice(0, 80).replace(/\s+\S*$/, '')}…` : paragraph;
    }
    function briefState(brief) {
      if (brief.lint?.ok) return `${Number(brief.chars).toLocaleString('en-US')} of 9,000 characters, checks passed.`;
      const finding = brief.lint?.findings?.[0];
      return `Not ready to hand over: ${finding?.message || 'the brief check failed.'}`;
    }
    /** The whole brief, with its size, Copy, Save and Write it again. */
    function openBriefSheet(brief, writeAgain) {
      const status = statusLine();
      const again = quiet('Write it again', () => act(again, status, async () => { closeSheet(); await writeAgain(); }));
      sheet('Your build brief', h('div', {}, note(briefState(brief)), h('pre', { class: 'launch-pre' }, brief.markdown),
        actions(quiet('Copy brief', () => act(null, status, async () => { await copyText(brief.markdown); status.replaceChildren(note('Brief copied.')); })),
          quiet('Save brief', () => saveText('brief.md', brief.markdown, 'text/markdown')), again), status));
    }

    const dropTab = tab => { if (tab) { try { tab.close(); } catch { /* already closed */ } } };
    /** Opens a builder only from the owner's click; marks it opened only after the browser took the link or the copy worked.
        Lovable and Replit open a link. In a browser the tab is opened here, inside the click and before the request,
        because a browser blocks a tab opened after a wait without saying so. Bolt and v0 get the brief copied. */
    async function handOff(builder, notesHost) {
      const tab = LINK_BUILDERS.includes(builder) ? reserveTab() : null;
      let plan;
      try { plan = await request('venture.build.handoff', { builder }); }
      catch (error) { dropTab(tab); throw error; }
      notesHost.replaceChildren(...(plan.notes || []).map(item => note(item)));
      if (plan.status === 'planned') { dropTab(tab); return; }
      if (plan.mode === 'link') await openExternal(plan.url, tab);
      else {
        dropTab(tab);
        const text = plan.clipboardText || '';
        try { await copyText(text); }
        catch (error) {
          notesHost.append(...errorNodes(error), actions(quiet('Save brief', () => saveText('brief.md', text, 'text/markdown'))));
          return;
        }
      }
      await request('venture.build.handoffOpened', { handoffId: plan.handoffId });
      notesHost.append(note(plan.mode === 'link' ? `${BUILDER_NAMES[builder] || builder} opened in your browser.` : `Brief copied. Paste it into ${BUILDER_NAMES[builder] || builder}.`, 'launch-note launch-done'));
    }

    /** GitHub's own words when its answers come from a recording rather than the real repo. */
    const githubRecording = status => (status.follow?.lastStatus?.cannotSay || []).filter(item => /synthetic recording/i.test(item));

    function buildBody(ctx) {
      const { status, models, mode, refresh } = ctx;
      const brief = status.brief;
      const onboardingMode = mode === 'onboarding';
      // In onboarding the header already says Build, so the page names the move instead.
      const out = [head(null, onboardingMode ? 'Hand your brief to a builder' : 'Build')];
      const briefStatus = statusLine();
      const writeBrief = async () => {
        await busy(briefStatus, 'Writing your build brief', () => request('venture.build.brief', {}));
        await refresh();
      };
      // When the brief and GitHub both answer from recordings, one line says so for the page instead of two.
      const modelRecorded = Boolean(brief) && brief.wordsBy === 'model' && replaying(models);
      const together = modelRecorded && githubRecording(status).length > 0;
      if (together) out.push(note(BOTH_RECORDED_LINE, 'launch-note launch-recording'));
      if (!brief) {
        const write = filled('Write the build brief', () => act(write, briefStatus, writeBrief));
        out.push(section(null, note('No build brief yet. Chausar writes it from your accepted plan.'), actions(write), briefStatus));
      } else {
        const notesHost = h('div', { class: 'launch-handoff-notes' });
        const handoffStatus = statusLine();
        const open = (builder, button) => act(button, handoffStatus, () => handOff(builder, notesHost));
        const lovable = filled('Open in Lovable', () => open('lovable', lovable));
        const replit = quiet('Open in Replit', () => open('replit', replit));
        const ok = brief.lint?.ok === true;
        const again = ok ? null : link('Write it again', () => act(again, briefStatus, writeBrief));
        if (!ok) { lovable.disabled = true; replit.disabled = true; }
        const source = brief.wordsBy === 'model' ? (together ? null : recordingNote(models)) : note(TEMPLATE_LINE);
        const briefParts = [h('p', { class: 'launch-brief' }, openingLines(brief.markdown)),
          h('p', { class: 'launch-note' }, ok ? 'Checks passed.' : briefState(brief), ' ', link('Read it', () => openBriefSheet(brief, writeBrief)), again ? ' ' : null, again)];
        out.push(
          // Onboarding folds a brief that passed its checks; one that did not shows why at rest.
          onboardingMode && ok ? section(null, fold('Your brief, checks passed', false, ...briefParts), source, briefStatus) : section('Your brief', ...briefParts, source, briefStatus),
          section(null,
            actions(lovable, replit), note(REPLIT_LINE), notesHost, handoffStatus,
            status.handoffs?.length ? fold('Opened before', false, h('div', { class: 'launch-rows launch-handoffs' }, ...status.handoffs.slice(0, 4).map(handoff => row({
              mark: handoff.openedAt ? 'you' : 'off', title: BUILDER_NAMES[handoff.builder] || handoff.builder,
              note: handoff.openedAt ? `opened ${timeText(handoff.openedAt)}` : 'prepared, not opened',
            })))) : null));
      }
      const follow = status.follow ? followStatus(status, refresh, together) : followForm(status, refresh);
      if (onboardingMode) out.push(section(null, fold('GitHub', false, follow)));
      else out.push(status.follow ? section('GitHub', follow) : section('Follow the build on GitHub', follow));
      return out;
    }

    function followForm(status, refresh) {
      const repo = textInput(status.follow ? `${status.follow.repo.owner}/${status.follow.repo.name}` : '', { maxlength: 160, placeholder: 'owner/repo' });
      const key = secretInput('Read-only key');
      const result = statusLine();
      const follow = quiet('Follow', () => act(follow, result, async () => {
        const payload = { repo: repo.value.trim() };
        try {
          if (key.value) payload.token = key.value;
          await request('venture.build.link', payload);
        } finally { key.value = ''; delete payload.token; }
        await busy(result, 'Reading GitHub', () => request('venture.build.sync'));
        await refresh();
      }));
      return h('div', { class: 'launch-follow' },
        field('Your app repo on GitHub', repo),
        field('Read-only key, for a private repo', key, KEY_LINE),
        h('p', { class: 'launch-note' }, link('Create a read-only key', () => act(null, result, () => openExternal(status.tokenLink))), ' Choose Only select repositories, then pick this one repo.'),
        actions(follow), result);
    }

    /** What GitHub showed: the state word at rest; the last change, checks and limits in one fold. */
    function followStatus(status, refresh, recordedAbove = false) {
      const follow = status.follow;
      const current = follow.lastStatus;
      const result = statusLine();
      const check = quiet('Check GitHub now', () => act(check, result, async () => {
        await busy(result, 'Reading GitHub', () => request('venture.build.sync'));
        await refresh();
      }));
      const formHost = h('div');
      const repoName = `${follow.repo.owner}/${follow.repo.name}`;
      const changeRepo = link('Change repo', () => { formHost.replaceChildren(followForm(status, refresh)); });
      if (!current) return h('div', {}, note(`Following ${repoName}. Not read yet.`), actions(check, changeRepo), result, formHost);
      const synthetic = githubRecording(status);
      const limits = (current.cannotSay || []).filter(item => !/synthetic recording/i.test(item));
      const marker = current.briefMarker === 'older' && current.briefMarkerVersion ? `Brief marker from version ${current.briefMarkerVersion}` : MARKER_WORDS[current.briefMarker] || '';
      const address = current.deployment ? h('p', {}, 'Address a host recorded: ', h('span', { class: 'launch-mono' }, current.deployment.url), ' ',
        link('Copy', () => act(null, result, async () => { await copyText(current.deployment.url); result.replaceChildren(note('Address copied.')); }))) : null;
      const recorded = synthetic.map(item => note(item, 'launch-note launch-recording'));
      return h('div', { class: 'launch-follow' },
        h('p', { class: 'launch-strong' }, `${BUILD_WORDS[current.word] || current.word}${current.syncConflictBranch ? ` on ${current.syncConflictBranch}` : ''}`, ' ', h('span', { class: 'launch-mono launch-unit' }, repoName)),
        WORKFLOW_WORDS[current.uiWorkflow] ? warn(WORKFLOW_WORDS[current.uiWorkflow]) : null,
        ...(recordedAbove ? [] : recorded),
        fold('Details', false,
          current.lastCommit ? note(`Last change: ${current.lastCommit.message}. By ${BY_WORDS[current.lastCommit.by] || current.lastCommit.by}, ${timeText(current.lastCommit.at)}.`) : note('No changes read yet.'),
          note(`${marker}. ${UI_RUN_WORDS[current.checks] || ''}.`),
          address,
          ...(recordedAbove ? recorded : []),
          limits.length ? h('p', { class: 'launch-strong' }, "What Chausar can't see") : null,
          ...limits.map(item => note(item)),
          actions(changeRepo)),
        actions(check), result, formHost);
    }

    // ---------------------------------------------------------------------------------------------
    // Add your AI: one sheet, cheapest first, consent shown word for word before any connection
    // ---------------------------------------------------------------------------------------------
    async function openAiSheet(onDone) {
      let connected = false;
      const body = h('div', { class: 'launch-ai' }, outline(6));
      sheet('Which AI should do the work?', body, () => (connected && onDone ? onDone() : undefined));
      let presets, status;
      try { [presets, status] = await Promise.all([request('venture.models.presets'), modelStatus()]); }
      catch (error) { body.replaceChildren(...errorNodes(error, () => openAiSheet(onDone))); return; }
      const byId = Object.fromEntries(presets.map(preset => [preset.id, preset]));
      const done = () => { connected = true; };
      const ordered = [...presets].sort((a, b) => rank(a.id) - rank(b.id));
      fill(body,
        note('Optional. Built-in templates work without any AI, and every line they write says so.'),
        recordingNote(status),
        byId['anthropic-haiku-5-5'] && byId['anthropic-sonnet-5-5'] ? recommendedRow(byId['anthropic-haiku-5-5'], byId['anthropic-sonnet-5-5'], done) : null,
        section('Every choice', h('div', { class: 'launch-rows' }, ordered.map(preset => presetRow(preset, done)))));
    }
    function rank(id) { const at = PRESET_ORDER.indexOf(id); return at < 0 ? PRESET_ORDER.length : at; }
    function consentBlock(text) {
      const agree = h('input', { type: 'checkbox' });
      return { agree, node: h('div', { class: 'launch-consent' }, h('p', { class: 'launch-consent-text' }, text), h('label', { class: 'launch-check' }, agree, h('span', {}, 'I agree'))) };
    }
    function recommendedRow(haiku, sonnet, done) {
      const key = secretInput('Your Anthropic key');
      const consent = consentBlock(haiku.consentText);
      const status = statusLine();
      const connect = filled('Connect', () => act(connect, status, async () => {
        try {
          if (!key.value) throw new Error('Paste your Anthropic key first.');
          await request('venture.models.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: key.value, tiers: ['fast'] });
          await request('venture.models.connect', { presetId: sonnet.id, consentDigest: sonnet.consentDigest, apiKey: key.value, tiers: ['main'] });
        } finally { key.value = ''; }
        done();
        status.replaceChildren(note(`Connected: ${haiku.label} for quick work, ${sonnet.label} for plans and drafts.`, 'launch-note launch-done'));
      }), { disabled: true });
      consent.agree.addEventListener('change', () => { connect.disabled = !consent.agree.checked; });
      return section('Recommended', h('div', { class: 'launch-recommended', 'data-preset': 'recommended' },
        h('p', { class: 'launch-strong' }, RECOMMENDED),
        verificationOf(haiku) ? note(verificationOf(haiku), 'launch-note launch-unverified') : null,
        field('Your Anthropic key', key, KEY_LINE), haiku.keyHint ? note(haiku.keyHint) : null, consent.node,
        sonnet.consentText !== haiku.consentText ? h('p', { class: 'launch-consent-text' }, sonnet.consentText) : null,
        actions(connect), status));
    }
    /** What the engine says about a preset nobody has tried on a live account yet; null for the built-in templates. */
    const verificationOf = preset => (preset?.verification === 'not-live-verified' && typeof preset.verificationNote === 'string' && preset.verificationNote ? preset.verificationNote : null);
    /** The availability reason without the verification note, when the engine already put it there, so it shows once. */
    function reasonWithout(reason, verified) {
      const text = plain(reason);
      return verified && text.includes(verified) ? text.replace(verified, '').replace(/\s+/g, ' ').trim() : text;
    }
    function presetRow(preset, done) {
      const status = statusLine();
      // "ready" is never shown bare for a preset Chausar has not tried on a live account: its note sits right beside it.
      const verified = verificationOf(preset);
      const reason = reasonWithout(preset.availabilityReason, verified);
      const beside = verified && preset.availability === 'ready' && !/not yet (tried|checked)/i.test(reason) ? verified : null;
      const summary = h('summary', {}, h('span', { class: 'launch-row-title' }, preset.label), ' ',
        h('span', { class: 'launch-label' }, AVAILABILITY_WORDS[preset.availability] || preset.availability),
        beside ? h('span', { class: 'launch-row-note launch-unverified' }, beside) : null, ' ',
        h('span', { class: 'launch-row-note' }, beside ? reason : plain(preset.availabilityReason)));
      if (preset.id === 'built-in-templates') {
        const keep = quiet('Keep using templates', () => act(keep, status, async () => {
          await request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
          done();
          status.replaceChildren(note('Using built-in templates. Nothing is sent to any AI service.', 'launch-note launch-done'));
        }));
        return h('details', { class: 'launch-preset', 'data-preset': preset.id }, summary, h('div', { class: 'launch-more-body' }, note(preset.consentText), actions(keep), status));
      }
      const key = preset.needsKey ? secretInput(`${preset.label} key`) : null;
      const model = preset.modelEditable ? textInput(preset.model || '', { maxlength: 64 }) : null;
      const consent = consentBlock(preset.consentText);
      const connect = quiet(preset.id === 'claude-code-cli' ? 'Check and connect' : 'Connect', () => act(connect, status, async () => {
        const payload = { presetId: preset.id, consentDigest: preset.consentDigest };
        try {
          if (key) { if (!key.value) throw new Error('Paste your key first.'); payload.apiKey = key.value; }
          if (model && model.value.trim()) payload.model = model.value.trim();
          await request('venture.models.connect', payload);
        } finally { if (key) key.value = ''; delete payload.apiKey; }
        done();
        status.replaceChildren(note(`Connected: ${preset.label}.`, 'launch-note launch-done'));
      }), { disabled: true });
      consent.agree.addEventListener('change', () => { connect.disabled = !consent.agree.checked || preset.availability === 'unavailable'; });
      // Until Chausar accepts Anthropic's terms for running Claude Code, the row says why and offers no connect.
      const termsPending = preset.id === 'claude-code-cli' && preset.availabilityReason === CLAUDE_TERMS_REASON;
      return h('details', { class: 'launch-preset', 'data-preset': preset.id }, summary, h('div', { class: 'launch-more-body' },
        preset.runsOn === 'this-computer' ? note('Uses your own sign-in on this computer.') : null,
        key ? field(`Your ${preset.label} key`, key, KEY_LINE) : null,
        key && preset.keyHint ? note(preset.keyHint) : null,
        model ? field('Model id, as your account shows it', model) : null,
        consent.node, termsPending ? null : actions(connect), status));
    }

    // ---------------------------------------------------------------------------------------------
    // The seven places
    // ---------------------------------------------------------------------------------------------
    function noVenture() {
      return page(head(null, 'Start with your idea'), note('This workspace has no business yet.'),
        actions(filled('Describe your idea', () => { onboarding().vaultOpen = true; void startFlow(); })));
    }
    async function ventureOrNull() {
      const view = await request('venture.get');
      if (view) state.venture = view;
      return view;
    }
    async function lastEvents(count) {
      const probe = await request('venture.events', { limit: 1 });
      const lastSeq = Number(probe?.lastSeq) || 0;
      if (!lastSeq) return [];
      const recent = await request('venture.events', { afterSeq: Math.max(0, lastSeq - count), limit: count });
      return recent?.events || [];
    }
    function goToItem(item) { if (item.id === 'ai') void openAiSheet(reread); else void navigate(item.place); }

    async function renderToday() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const [runs, invoices, books, events, improve, nudgeLine] = await Promise.all([
        settle(request('venture.delivery.list')), settle(request('venture.invoice.list')), settle(request('venture.books.summary', { period: 'this-month' })), settle(lastEvents(6)),
        settle(request('venture.improve.status')), recoveryNudge().catch(() => null)]);
      rememberDay(books.value);
      // Like items share one row, so four waiting drafts read as one line with how many there are.
      // A practice draft stops being news once the business approves each draft: it can't be accepted any more.
      const stage = view.venture.launchStage;
      const kinds = [
        ['waiting', 'A draft to approve', 'drafts to approve', 'agents'],
        ['asking', 'A question to answer', 'questions to answer', 'agents'],
        ['practice', 'A practice draft to review', 'practice drafts to review', 'agents'],
        ['ready', 'A draft to review', 'drafts to review', 'agents'],
        ['adopt', 'A playbook change to review', 'playbook changes to review', 'agents'],
        ['invoice', 'A draft invoice to issue', 'draft invoices to issue', 'clients'],
      ];
      const counts = { waiting: 0, asking: 0, practice: 0, ready: 0, adopt: improve.value?.candidate ? 1 : 0, invoice: 0 };
      for (const run of runs.value || []) {
        if (!awaitingOwner(run, stage)) continue;
        if (run.status === 'waiting-for-you') counts.waiting++;
        else if (run.status === 'needs-answer') counts.asking++;
        else if (run.status === 'ready-for-review') counts[practiceDraft(run, stage) ? 'practice' : 'ready']++;
      }
      for (const invoice of invoices.value || []) if (invoice.status === 'draft') counts.invoice++;
      // The row's words are the button, so nothing at rest says "Review" four times.
      const waiting = kinds.filter(([kind]) => counts[kind] > 0).map(([kind, one, many, place]) => row({
        mark: 'wait', title: link(counts[kind] === 1 ? one : `${counts[kind]} ${many}`, () => navigate(place)),
      }));
      const shown = waiting.slice(0, 4);
      if (view.next) shown.push(row({ mark: 'now', title: link(view.next.label, () => goToItem({ id: view.next.item, place: view.next.place })) }));
      // The figures are money already, so the heading names only the period: "This month".
      const period = books.value ? periodWords(books.value) : null;
      const moneyTitle = period ? `${period.charAt(0).toUpperCase()}${period.slice(1)}` : 'Money';
      return page(head(dayLine(books.value?.today || engineDate()), 'Today'), nudgeLine,
        section('Awaiting you', shown.length ? rows(...shown) : note('Nothing awaits you.')),
        section(moneyTitle, books.value ? moneyFigures(books.value) : note(plain(books.error?.message))),
        fold(h('span', { class: 'launch-count' }, `Checklist, ${view.done} of ${view.total}`, ' ',
          h('span', { class: 'launch-strip', role: 'img', 'aria-label': `${view.done} of ${view.total} steps done` }, view.checklist.map(item => square(item.done ? 'you' : 'off')))), false,
        rows(...view.checklist.map(item => row({ mark: item.done ? 'you' : 'off', title: item.label, note: item.done ? 'done' : 'not yet', side: item.done ? null : link('Open', () => goToItem(item)) })))),
        events.value?.length ? fold('Earlier', false, h('ol', { class: 'launch-timeline' }, events.value.map(event => h('li', {}, square('cha'), h('span', { class: 'launch-time' }, timeText(event.at)), h('span', {}, EVENT_WORDS[event.name] || event.name))))) : null);
    }
    function moneyFigures(summary) {
      return h('div', { class: 'launch-figures' }, summary.figures.map(item => h('div', { class: 'launch-figure' },
        h('span', { class: 'launch-figure-label' }, item.label),
        h('button', { class: 'launch-fig-btn', type: 'button', onclick: () => openBooksReceipt(item) }, item.display),
        item.stale ? chip('stale') : null)));
    }

    async function renderBusiness() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const host = page();
      await paintPlan(host, 'place');
      return host;
    }

    async function renderBuild() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const host = page();
      const paint = async () => {
        const [status, models] = await Promise.all([request('venture.build.status'), modelStatus()]);
        host.replaceChildren(...buildBody({ status, models, mode: 'place', refresh: paint }));
      };
      await paint();
      return host;
    }

    async function renderClients() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const [clients, orders, invoices, blueprint, uploads] = await Promise.all([
        request('venture.client.list'), request('venture.order.list'), settle(request('venture.invoice.list')), settle(request('venture.blueprint.get')),
        settle(request('venture.files.list', {}))]);
      const listed = orders.slice(0, 12);
      const receipts = await Promise.all(listed.map(order => settle(request('venture.receipt.get', { id: order.priceReceiptId }))));
      const names = Object.fromEntries(clients.map(client => [client.id, client.name]));
      const offers = blueprint.value?.blueprint?.status === 'accepted' ? blueprint.value.blueprint.offers : [];
      const offerName = id => offers.find(offer => offer.id === id)?.name.value || id;
      const ctx = { view, clients, offers };
      const orderNodes = listed.map((order, index) => orderRow(order, {
        client: names[order.clientId] || 'A client', offer: offerName(order.offerId), receipt: receipts[index].value,
        invoice: (invoices.value || []).find(invoice => invoice.orderId === order.id && invoice.status !== 'void') || null,
        files: uploads.value ? uploads.value.filter(upload => upload.scope?.kind === 'order' && upload.scope.orderId === order.id) : null, filesError: uploads.error,
      }));
      return page(head(null, 'Clients'),
        section('Clients', clients.length ? rows(...clients.map(client => row({ mark: 'you', title: client.name, note: [client.email, client.countryCode].filter(Boolean).join(' · ') || null }))) : note('No clients yet.'),
          actions(quiet('Add client', () => openClientSheet(ctx)))),
        section('Orders', orderNodes.length ? h('div', { class: 'launch-rows' }, orderNodes) : note(offers.length ? 'No orders yet.' : 'Accept your plan first, then add orders.'),
          clients.length && offers.length ? actions(quiet('New order', () => openOrderSheet(ctx))) : null));
    }
    function orderRow(order, { client, offer, receipt, invoice, files, filesError }) {
      const total = figureOf(receipt, 'total');
      const body = h('div', { class: 'launch-more-body' });
      const status = statusLine();
      const filesHost = filesPart(order, files, filesError);
      const paintActions = () => {
        const draft = quiet('Draft a reply', () => act(draft, status, async () => { await openRunSheet(await request('venture.delivery.run', { orderId: order.id }), client); }));
        const deliver = order.status === 'delivered' || order.status === 'cancelled' ? null : quiet('Mark delivered', () => {
          const date = h('input', { type: 'date', value: engineDate() });
          const confirm = quiet('Mark delivered', () => act(confirm, status, async () => { await request('venture.order.deliver', { orderId: order.id, deliveredOn: date.value }); await reread(); }));
          body.replaceChildren(field('Delivered on', date), actions(confirm, link('Cancel', paintActions)), status);
        });
        const invoiceButton = invoice
          ? quiet(invoice.number ? `Open invoice ${invoice.number}` : 'Open draft invoice', () => act(invoiceButton, status, async () => openInvoiceSheet(await request('venture.invoice.get', { invoiceId: invoice.id }))))
          : quiet('Prepare invoice', () => act(invoiceButton, status, async () => openInvoiceSheet(await request('venture.invoice.prepare', { orderId: order.id }))));
        fill(body, note(order.request, 'launch-note launch-request'), filesHost, actions(draft, deliver, invoiceButton), status);
      };
      paintActions();
      return h('details', { class: 'launch-order', 'data-order': order.id }, h('summary', {}, square(order.status === 'delivered' ? 'you' : 'wait'),
        h('span', { class: 'launch-row-title' }, `${client} · ${offer}`), ' ', h('span', { class: 'launch-row-note' }, ORDER_WORDS[order.status] || order.status), ' ',
        total ? h('span', { class: 'launch-fig' }, total.display) : null), body);
    }
    /** The client's files on an order: one line each, and Add a file, which opens the computer's own file chooser.
        The file goes to the engine as base64 in one request; the engine checks its format against its content. */
    function filesPart(order, files, filesError) {
      const host = h('div', { class: 'launch-files' });
      if (!files) { fill(host, ...errorNodes(filesError || new Error("Chausar couldn't read this order's files."))); return host; }
      const list = [...files];
      const status = statusLine();
      // PDF text is read by the Python helper, which never runs on the shared hosted server.
      const chooser = hosted
        ? h('input', { type: 'file', accept: '.csv,.xlsx', hidden: true, 'aria-label': 'Choose a CSV or XLSX file' })
        : h('input', { type: 'file', accept: '.csv,.xlsx,.pdf', hidden: true, 'aria-label': 'Choose a CSV, XLSX or PDF file' });
      const paint = () => {
        const full = list.length >= MAX_FILES;
        fill(host,
          list.length ? rows(...list.map(file => row({ mark: 'you', title: file.name, note: FORMAT_WORDS[file.format] || file.format }))) : note('No files yet.'),
          full ? note('Ten files, the most an order holds.') : h('p', { class: 'launch-note' }, FILES_LINE, ' ', link('Add a file', () => chooser.click())),
          chooser, status);
      };
      chooser.addEventListener('change', () => act(null, status, async () => {
        const chosen = chooser.files?.[0];
        chooser.value = '';
        if (!chosen) return;
        if (chosen.size > MAX_FILE_BYTES) throw new Error(hosted ? 'Add a file smaller than 190 KB. The hosted app takes smaller files than the desktop app.' : 'Add a file smaller than one and a half megabytes.');
        list.push(await request('venture.files.add', { orderId: order.id, name: chosen.name, contentBase64: await base64Of(chosen) }));
        paint();
      }));
      paint();
      return host;
    }
    /** A picked file's bytes as base64, in slices so a large file does not overflow the call stack. */
    async function base64Of(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
      return btoa(binary);
    }

    async function openClientSheet(ctx) {
      const country = ctx.view.venture.country;
      const india = country.code === 'IN';
      const name = textInput('', { maxlength: 120 });
      const email = h('input', { type: 'email', value: '', maxlength: 200, autocomplete: 'off' });
      const countryPick = picker([['', 'Not set'], [country.code, country.name]], country.code);
      const taxId = textInput('', { maxlength: 30 });
      const statePick = india ? picker([['', 'Not set'], ...stateOptions()], '') : null;
      const status = statusLine();
      const save = filled('Add client', () => act(save, status, async () => {
        const payload = { name: name.value.trim() };
        if (email.value.trim()) payload.email = email.value.trim();
        if (countryPick.value) payload.countryCode = countryPick.value;
        if (taxId.value.trim()) payload.taxId = taxId.value.trim();
        if (statePick && statePick.value) payload.stateCode = statePick.value;
        await request('venture.client.add', payload);
        await reread();
      }));
      sheet('Add client', h('div', {}, field('Name', name), field('Email', email), field('Country', countryPick),
        field(india ? 'GSTIN, if they have one' : 'Tax number, if they have one', taxId), statePick ? field('State, for place of supply', statePick) : null,
        note('Client details stay in your vault.'), actions(save), status));
      try {
        const countries = await request('venture.countries');
        const chosen = countryPick.value;
        countryPick.replaceChildren(...[['', 'Not set'], ...countries.map(item => [item.code, item.name])].map(([value, words]) => h('option', { value }, words)));
        countryPick.value = chosen;
      } catch { /* the business's own country stays on the list */ }
    }
    function openOrderSheet(ctx) {
      const clientPick = picker(ctx.clients.map(client => [client.id, client.name]), ctx.clients[0]?.id);
      const offerPick = picker(ctx.offers.map(offer => [offer.id, offer.name.value]), ctx.offers[0]?.id);
      const quantity = textInput('1', { inputmode: 'numeric', maxlength: 5 });
      const asked = h('textarea', { rows: 4, maxlength: 4000, value: '' });
      const status = statusLine();
      const save = filled('Add order', () => act(save, status, async () => {
        const payload = { clientId: clientPick.value, offerId: offerPick.value, request: asked.value.trim() };
        if (quantity.value.trim()) payload.quantity = quantity.value.trim();
        await request('venture.order.create', payload);
        await reread();
      }));
      sheet('New order', h('div', {}, field('Client', clientPick), field('Offer', offerPick), field('Quantity', quantity), field('What the client asked for', asked),
        note('This stays in your vault. It goes to an AI only after you approve the exact text.'), actions(save), status));
    }

    function openInvoiceSheet(view) {
      const body = h('div', { class: 'launch-invoice' });
      let dialog = null;
      const paint = current => {
        const invoice = current.invoice;
        if (dialog) for (const title of dialog.querySelectorAll('.launch-sheet-title')) title.textContent = invoice.number ? `Invoice ${invoice.number}` : 'Draft invoice';
        const total = figureOf(current, 'total');
        const status = statusLine();
        const parts = [h('pre', { class: 'launch-pre' }, current.documentText), ...(current.notes || []).filter(item => item !== EXPERIMENTAL).map(item => note(item))];
        if (experimental()) parts.push(warn(EXPERIMENTAL));
        if (invoice.status === 'draft') {
          const agree = h('input', { type: 'checkbox' });
          const issue = filled('Issue invoice', () => act(issue, status, async () => {
            paint(await request('venture.invoice.issue', { invoiceId: invoice.id, digest: invoice.digest }));
          }), { disabled: true });
          agree.addEventListener('change', () => { issue.disabled = !agree.checked; });
          parts.push(h('label', { class: 'launch-check' }, agree, h('span', {}, `I checked this invoice. Its total is ${total?.display || 'shown above'}.`)), actions(issue));
        } else if (invoice.status === 'issued' || invoice.status === 'part-paid') {
          const amount = textInput('', { inputmode: 'decimal', 'aria-label': `Amount received, in ${invoice.currency}` });
          const received = h('input', { type: 'date', value: engineDate() });
          const method = picker(PAYMENT_METHODS, 'bank-transfer');
          const record = quiet('Record payment', () => act(record, status, async () => {
            paint(await request('venture.payment.record', { invoiceId: invoice.id, amount: amount.value.trim(), receivedOn: received.value, method: method.value }));
          }));
          parts.push(section('Record a payment', h('div', { class: 'launch-amount' }, field('Amount received', amount), h('span', { class: 'launch-currency' }, invoice.currency)),
            field('Received on', received), field('How it was paid', method), actions(record)));
        }
        parts.push(actions(
          quiet('Copy invoice', () => act(null, status, async () => { await copyText(current.documentText); status.replaceChildren(note('Invoice copied.')); })),
          quiet('Save invoice', () => saveText(`${invoice.number || 'draft-invoice'}.txt`, current.documentText, 'text/plain'))), status);
        body.replaceChildren(...parts);
      };
      paint(view);
      dialog = sheet(view.invoice.number ? `Invoice ${view.invoice.number}` : 'Draft invoice', body, () => (onLaunchPage() ? navigate(state.page) : undefined));
    }

    async function renderAgents() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const [launchStatus, scenarios, runs, capabilities, models, playbook, orders, clients, improve] = await Promise.all([
        settle(request('venture.launch.status')), settle(request('venture.simulation.scenarios')), settle(request('venture.delivery.list')),
        settle(request('venture.capabilities')), modelStatus(), settle(request('venture.delivery.playbook')),
        settle(request('venture.order.list')), settle(request('venture.client.list')), settle(request('venture.improve.status'))]);
      const titles = Object.fromEntries((scenarios.value || []).map(scenario => [scenario.id, scenario.title]));
      const templateEntries = launchStatus.value?.rehearsal?.length
        ? launchStatus.value.rehearsal
        : (scenarios.value || []).filter(scenario => scenario.source === 'template').map(scenario => ({ scenarioId: scenario.id, runId: null, passed: null, judged: false }));
      // Practice cases made from a rejected or edited draft rehearse with the rest.
      const caseEntries = (scenarios.value || []).filter(scenario => scenario.source === 'signal' && !templateEntries.some(entry => entry.scenarioId === scenario.id))
        .map(scenario => ({ scenarioId: scenario.id, runId: null, passed: null, judged: false, fromReview: true }));
      const rehearsal = [...templateEntries, ...caseEntries];
      const stored = await Promise.all(rehearsal.map(entry => (entry.runId ? settle(request('venture.simulation.get', { runId: entry.runId })) : Promise.resolve({ value: null }))));
      const rowHosts = {};
      const outcomes = {};
      const rehearsalSummary = h('span', {});
      const paintSummary = () => { rehearsalSummary.textContent = rehearsalWords(rehearsal.map(entry => outcomes[entry.scenarioId])); };
      const paintRow = (host, entry, run, known) => { outcomes[entry.scenarioId] = paintRehearsal(host, entry.scenarioId, titles[entry.scenarioId] || entry.scenarioId, run, known); paintSummary(); };
      const rehearsalRows = rehearsal.map((entry, index) => {
        const host = h('div', { class: 'launch-rehearsal', 'data-scenario': entry.scenarioId });
        rowHosts[entry.scenarioId] = host;
        paintRow(host, entry, stored[index].value, entry);
        return host;
      });
      const rehearsalFold = fold(rehearsalSummary, false, h('div', { class: 'launch-rows' }, rehearsalRows));
      const ladderHost = h('div', { class: 'launch-ladder' });
      const paintLadder = status => fill(ladderHost, ...ladderNodes(status));
      if (launchStatus.value) paintLadder(launchStatus.value); else ladderHost.replaceChildren(...errorNodes(launchStatus.error));
      const rehearseStatus = statusLine();
      const rehearse = filled('Rehearse', () => act(rehearse, rehearseStatus, async () => {
        rehearsalFold.open = true;
        for (const entry of rehearsal) {
          const host = rowHosts[entry.scenarioId];
          const title = titles[entry.scenarioId] || entry.scenarioId;
          try {
            const run = await busy(host, `Rehearsing with a practice client: ${title}`, () => request('venture.simulation.run', { scenarioIds: [entry.scenarioId] }), 2);
            paintRow(host, entry, run, null);
          } catch (error) {
            if (error?.code === 'REQUEST_TIMEOUT') { outcomes[entry.scenarioId] = await recoverRehearsal(host, entry.scenarioId, title); paintSummary(); }
            else host.replaceChildren(row({ mark: 'unsure', title, extra: h('div', {}, ...errorNodes(error)) }));
          }
        }
        const fresh = await settle(request('venture.launch.status'));
        if (fresh.value) paintLadder(fresh.value);
      }));
      const clientOf = Object.fromEntries((orders.value || []).map(order => [order.id, (clients.value || []).find(client => client.id === order.clientId)?.name || 'A client']));
      const mainTier = models?.tiers?.main, fastTier = models?.tiers?.fast;
      const served = servedByModel(models, 'main') || servedByModel(models, 'fast');
      const aiWords = served ? `AI: ${presetName(mainTier?.presetId, mainTier?.model)}.` : 'No AI connected. Built-in templates write outlines.';
      const capabilityNodes = capabilities.value
        ? [rows(...capabilities.value.map(item => row({ mark: item.state === 'available' ? 'cha' : 'off', title: item.label, note: CAPABILITY_WORDS[item.state] || item.state, extra: h('p', { class: 'launch-row-more' }, item.reason) })))]
        : errorNodes(capabilities.error);
      const stage = view.venture.launchStage;
      // The client's name is the button: one word fewer per row than a Review button beside it.
      const draftRow = run => {
        const client = clientOf[run.orderId] || 'A client';
        return row({
          mark: run.status === 'waiting-for-you' || run.status === 'needs-answer' || run.status === 'ready-for-review' ? 'wait' : 'you',
          title: link(client, () => openRunSheet(run, client, models)),
          note: `${RUN_WORDS[run.status] || run.status}${practiceDraft(run, stage) ? ', practice' : ''}${run.servedBy === 'template' ? ', outline' : ''}`,
        });
      };
      const drafts = runs.value || [];
      const improveHost = h('div', { class: 'launch-improve' });
      paintImprove(improveHost, improve.value || null, improve.error);
      return page(head(`Stage: ${STAGE_WORDS[stage] || stage}`, 'Agents'),
        h('p', {}, aiWords, ' ', link(served ? 'Change' : 'Add your AI', () => openAiSheet(reread))), recordingNote(models),
        section(null, rehearsalFold, actions(rehearse), rehearseStatus),
        section(null, ladderHost),
        section(null, improveHost),
        section('Draft replies', drafts.length ? rows(...drafts.slice(0, 3).map(draftRow)) : note(runs.error ? plain(runs.error.message) : 'No draft replies yet. Draft one from an order on Clients.'),
          drafts.length > 3 ? fold(`${drafts.length - 3} older`, false, rows(...drafts.slice(3, 12).map(draftRow))) : null),
        fold('How agents work', false,
          served ? note(`${presetName(mainTier?.presetId, mainTier?.model)} writes plans and drafts; ${presetName(fastTier?.presetId, fastTier?.model)} does quick work.`) : null,
          playbook.value ? note(`Playbook version ${playbook.value.version}.`) : null,
          ...(playbook.value ? [rows(...playbook.value.steps.map(step => row({ mark: step.doneBy === 'you' ? 'you' : 'cha', title: step.title, note: DONE_BY[step.doneBy] || step.doneBy })))] : errorNodes(playbook.error)),
          section('What agents can do today', ...capabilityNodes)));
    }
    /** One line for the folded rehearsal rows, counted from what each row shows. */
    function rehearsalWords(results) {
      const passed = results.filter(item => item === 'passed').length;
      const judged = results.filter(item => item === 'passed' || item === 'failed').length;
      if (judged) return `Rehearsal: ${passed} of ${results.length} passed`;
      if (results.some(item => item === 'outline')) return 'Rehearsal: template outlines, not judged';
      return 'Rehearsal: not rehearsed yet';
    }
    /** Draws one rehearsal row and says what it shows: passed, failed, outline or none. */
    function paintRehearsal(host, scenarioId, title, run, entry) {
      if (!run) {
        const unjudged = entry?.runId && entry.judged === false;
        const words = !entry?.runId ? (entry?.fromReview ? 'practice case from your review' : 'not rehearsed yet') : unjudged ? 'template outline, not judged' : entry.passed ? 'passed' : 'failed';
        host.replaceChildren(row({ mark: entry?.passed && !unjudged ? 'cha' : 'off', title, note: words }));
        return !entry?.runId ? 'none' : unjudged ? 'outline' : entry.passed ? 'passed' : 'failed';
      }
      const episodes = (run.episodes || []).filter(episode => episode.scenarioId === scenarioId);
      const passed = episodes.length ? episodes.every(episode => episode.passed) : run.passed;
      const failure = episodes.find(episode => !episode.passed)?.firstFailure;
      // A template outline was never judged, so it gets no pass or fail word and no cost: nothing was sent.
      const outlineOnly = run.modelMode === 'template';
      host.replaceChildren(row({
        mark: outlineOnly ? 'off' : passed ? 'cha' : 'unsure', title,
        note: outlineOnly ? null : passed ? 'passed' : `failed: ${failure || 'a check failed'}`,
        side: outlineOnly ? null : h('span', { class: 'launch-fig' }, run.costDisplay),
        extra: outlineOnly ? h('p', { class: 'launch-row-more' }, 'Template outline, not judged') : null,
      }));
      return outlineOnly ? 'outline' : passed ? 'passed' : 'failed';
    }
    async function recoverRehearsal(host, scenarioId, title) {
      try {
        const status = await request('venture.launch.status');
        const entry = (status.rehearsal || []).find(item => item.scenarioId === scenarioId);
        if (!entry?.runId) { host.replaceChildren(row({ mark: 'wait', title, extra: h('div', {}, ...errorNodes({ code: 'REQUEST_TIMEOUT' }, () => recoverRehearsal(host, scenarioId, title))) })); return 'none'; }
        return paintRehearsal(host, scenarioId, title, await request('venture.simulation.get', { runId: entry.runId }), entry);
      } catch (error) { host.replaceChildren(row({ mark: 'unsure', title, extra: h('div', {}, ...errorNodes(error)) })); return 'none'; }
    }
    /** The next move at rest, the whole ladder in a fold. The stage itself is already in the page's eyebrow. */
    function ladderNodes(status) {
      const at = STAGE_ORDER.indexOf(status.stage);
      const next = STAGE_ORDER[at + 1];
      const result = statusLine();
      const infoOf = stage => (status.stages || []).find(item => item.stage === stage) || { allowed: false, reason: '', status: 'available' };
      const nextInfo = next ? infoOf(next) : null;
      let nextNode = null;
      if (next && nextInfo.status !== 'planned') {
        if (nextInfo.allowed) {
          const move = quiet(`Move to ${STAGE_WORDS[next].toLowerCase()}`, () => act(move, result, async () => { await request('venture.launch.advance', { to: next }); await reread(); }));
          nextNode = actions(move);
        } else nextNode = rows(row({ mark: 'off', title: STAGE_WORDS[next], note: nextInfo.reason }));
      }
      return [nextNode, fold('Launch stages', false, rows(...STAGE_ORDER.map((stage, index) => {
        const info = infoOf(stage);
        let words = null;
        if (stage === status.stage) words = 'current';
        else if (info.status === 'planned') words = 'planned';
        else if (index < at) words = 'done';
        else if (stage === next) words = 'next';
        return row({ mark: stage === status.stage ? 'now' : index < at ? 'you' : 'off', title: STAGE_WORDS[stage], note: words });
      }))), result];
    }

    /** The improvement loop in one fold: readiness at rest; inside, the last run, a kept change in plain words, Run and Adopt.
        It never runs on its own. after carries what the owner just did, so the fold stays open with the result in it. */
    function paintImprove(host, status, error, after = null) {
      if (!status) { fill(host, ...errorNodes(error)); return; }
      const result = statusLine();
      const { readiness, latest, candidate } = status;
      const repaint = async message => {
        const fresh = await settle(request('venture.improve.status'));
        paintImprove(host, fresh.value || status, fresh.error, { message });
      };
      const runLoop = () => act(run, result, async () => {
        await busy(host, 'Rehearsing the version in use and one change', () => request('venture.improve.run', {}), 3);
        await repaint(null);
      });
      // With a change waiting, Adopt is the one button and running again is a quiet link.
      const run = candidate ? link('Run the loop again', runLoop) : quiet('Run the improvement loop', runLoop);
      const adopt = candidate ? quiet('Adopt this version', () => act(adopt, result, async () => {
        const playbook = await request('venture.improve.adopt', { runId: candidate.runId, digest: candidate.digest });
        await repaint(`Now using version ${playbook.version}.`);
      })) : null;
      const words = candidate ? 'Improvement: a change to adopt' : readiness.due ? 'Improvement: ready to run' : 'Improvement: not due yet';
      fill(host, fold(words, Boolean(after),
        note(readiness.reason),
        note(`${readiness.judged} ${readiness.judged === 1 ? 'draft' : 'drafts'} reviewed, ${readiness.rejectedOrEdited} rejected or edited.`),
        latest ? improvementRow(latest) : null,
        candidate ? h('div', { class: 'launch-change' }, note('The change', 'launch-strong'), ...candidate.changes.map(item => h('p', { class: 'launch-quote' }, item)), actions(adopt), note(ADOPT_LINE)) : null,
        after?.message ? note(after.message, 'launch-note launch-done') : null,
        candidate ? h('p', { class: 'launch-note' }, run) : actions(run), candidate ? null : note(IMPROVE_LINE), result));
    }
    /** The last run: what it kept and why, with one mark per practice case: won, tied, lost. */
    function improvementRow(run) {
      const gate = [...(run.rounds || [])].reverse().find(round => round.gate)?.gate || null;
      const reason = run.status === 'incomplete' ? run.incompleteReason : gate?.reason;
      const picture = gate ? h('span', { class: 'launch-strip launch-gate', role: 'img', 'aria-label': `Won ${gate.wins}, tied ${gate.ties}, lost ${gate.losses} of the practice cases.` },
        ...Array.from({ length: gate.wins }, () => square('cha')), ...Array.from({ length: gate.ties }, () => square('off')), ...Array.from({ length: gate.losses }, () => square('unsure'))) : null;
      const caption = gate ? h('span', { class: 'launch-row-note' }, `${gate.wins} won, ${gate.ties} tied, ${gate.losses} lost`) : null;
      return rows(row({
        mark: run.status === 'kept-candidate' ? 'cha' : 'off', title: IMPROVE_WORDS[run.status] || run.status,
        side: h('span', { class: 'launch-fig' }, run.costDisplay),
        extra: h('div', {}, reason ? h('p', { class: 'launch-row-more' }, reason) : null, picture ? h('p', { class: 'launch-gate-line' }, picture, caption) : null),
      }));
    }

    /** The draft reply sheet. In a demo with recordings it says, above the payload and the draft, that a synthetic recording answers. */
    async function openRunSheet(run, client, knownModels = null) {
      // A run with the agent's tools names files by short names (f1, f2); the order's files give them back their own names.
      const [models, files] = await Promise.all([knownModels || modelStatus(), run.harness ? settle(request('venture.files.list', { orderId: run.orderId })) : null]);
      const replay = replaying(models);
      const body = h('div', { class: 'launch-run' });
      const stage = state.venture?.venture?.launchStage;
      const receipts = new Map();
      const workReceipt = id => {
        if (!receipts.has(id)) receipts.set(id, request('venture.work.get', { id }).catch(error => { receipts.delete(id); throw error; }));
        return receipts.get(id);
      };
      const ctx = { files: files?.value || [], workReceipt };
      const paint = current => {
        const status = statusLine();
        const parts = [];
        const practice = practiceDraft(current, stage);
        const harness = current.harness || null;
        if (practice) parts.push(warn(PRACTICE_LINE));
        if (harness) parts.push(progressLine(harness));
        if (harness?.stopReason && harness.phase === 'write') parts.push(note(harness.stopReason));
        // What the agent did sits open above the text to approve, and folded after the report once it is written.
        const done = harness ? turnsDone(current, ctx) : [];
        const working = current.status === 'waiting-for-you' || current.status === 'needs-answer';
        const doneFold = done.length ? fold('What the agent did', working, ...done) : null;
        if (working) parts.push(doneFold);
        if (current.status === 'waiting-for-you' && current.preview && current.canApprove === false) {
          parts.push(recordingNote(models), note("Chausar can't send this one now: its approval ran out or the launch stage changed. Draft it again from the order."), status);
        } else if (current.status === 'waiting-for-you' && current.preview) {
          const model = presetName(current.preview.presetId, current.preview.model);
          const by = writtenBy(models, current.preview.presetId, current.preview.model);
          const acting = harness?.phase === 'act';
          const words = !harness ? `Writing a draft reply ${by}` : acting ? `Running turn ${(harness.used?.turns || 0) + 1} ${by}` : `Writing the report ${by}`;
          const agree = h('input', { type: 'checkbox' });
          const approve = filled('Approve and send', () => act(approve, status, async () => {
            let next;
            try {
              next = await busy(body, words, () => request('venture.delivery.approve', { runId: current.id, digest: current.preview.digest }));
            } catch (error) {
              if (error?.code !== 'REQUEST_TIMEOUT') throw error;
              const list = await request('venture.delivery.list');
              next = (list || []).find(item => item.id === current.id);
              // Still waiting on the same call means the turn has not run; a new call means it ran and the next one waits.
              if (!next || (next.status === 'waiting-for-you' && next.callId === current.callId)) throw error;
            }
            paint(next);
          }), { disabled: true });
          agree.addEventListener('change', () => { approve.disabled = !agree.checked; });
          parts.push(recordingNote(models),
            note(replay ? `This is exactly what Chausar would send to ${model}. In this demo a synthetic recording answers instead.` : `This is exactly what will be sent to ${model}`, 'launch-strong'),
            h('pre', { class: 'launch-pre' }, current.preview.payloadText),
            note(`Most it can cost: ${current.preview.estimatedMaxCostDisplay}. This approval runs out at ${timeText(current.preview.expiresAt)}.`),
            acting ? note(TOOLS_LINE) : null,
            h('label', { class: 'launch-check' }, agree, h('span', {}, replay ? 'Approve this exact text once.' : 'Send this exact text once.')), actions(approve), status);
        } else if (current.status === 'needs-answer' && harness) {
          parts.push(...questionNodes(current, harness, status, next => paint(next), body));
        } else {
          const text = current.editedText || current.renderedText || '';
          if (current.servedBy === 'template' && !text.startsWith(OUTLINE_LINE)) parts.push(note(OUTLINE_LINE, 'launch-strong'));
          if (current.servedBy === 'model') parts.push(recordingNote(models));
          const attachedIds = (current.deliverable?.attachments || []).filter(item => item.kind === 'reconciliation').map(item => item.receiptId);
          // Code prints the reconciliation after the agent's words. The sheet shows it once, drawn from its receipt below;
          // Copy and Save still take the whole report.
          const cut = attachedIds.length && !current.editedText ? text.lastIndexOf(RECONCILIATION_HEAD) : -1;
          if (text) parts.push(h('pre', { class: 'launch-pre' }, cut > 0 ? text.slice(0, cut) : text));
          for (const id of attachedIds) parts.push(reconciliationPart(id, ctx));
          if (!working) parts.push(doneFold);
          if (current.checks?.length) parts.push(fold('Checks', false, rows(...current.checks.map(check => row({ mark: check.passed ? 'cha' : 'unsure', title: CHECK_WORDS[check.check] || check.check, note: check.passed ? 'passed' : check.detail })))));
          if (current.status === 'ready-for-review') parts.push(...reviewControls(current, status, paint, stage));
          else if (current.verdict) parts.push(note(`You ${current.verdict.choice} this draft${current.verdict.reason ? `: ${(REASON_WORDS.find(([id]) => id === current.verdict.reason) || [])[1] || current.verdict.reason}` : ''}.`));
          else if (current.status === 'failed') parts.push(note('This draft failed. Draft it again from the order.'));
          if (current.status === 'rejected' || current.status === 'edited') parts.push(practiseControl(current, status));
          if (!practice && (current.status === 'accepted' || current.status === 'edited') && text) {
            parts.push(actions(quiet('Copy', () => act(null, status, async () => { await copyText(text); status.replaceChildren(note('Copied.')); })),
              quiet('Save', () => saveText('draft-reply.txt', text, 'text/plain'))));
          }
          parts.push(status);
        }
        fill(body, ...parts);
      };
      paint(run);
      sheet(`Draft reply for ${client}`, body, () => (onLaunchPage() ? navigate(state.page) : undefined));
    }
    /** Which turn the run is on, in words, with one mark per turn the agent may take: done, this one, the rest. */
    function progressLine(harness) {
      const max = harness.limits?.maxTurns || 0;
      const used = harness.used?.turns || 0;
      const current = harness.phase === 'act' ? used + 1 : null;
      const calls = harness.used?.toolCalls || 0;
      const words = harness.phase === 'act' ? `Turn ${used + 1} of ${max}`
        : harness.phase === 'needs-answer' ? `Turn ${used} of ${max}`
          : harness.phase === 'write' ? 'Last step: the report'
            : `Done in ${used} ${used === 1 ? 'turn' : 'turns'} with ${calls} tool ${calls === 1 ? 'call' : 'calls'}.`;
      return h('p', { class: 'launch-progress' }, h('span', {}, words),
        h('span', { class: 'launch-strip', 'aria-hidden': 'true' }, Array.from({ length: max }, (_, index) => square(index < used ? 'cha' : index + 1 === current ? 'now' : 'off'))));
    }
    /** A short name the agent used (f1, f1.s2, t1), as the owner knows it: the file's own name, or a table the agent made. */
    function shortName(alias, run, files) {
      const text = plain(alias);
      const file = /^f(\d{1,3})(?:\.s\d{1,2})?$/.exec(text);
      if (file) {
        const id = (run.harness?.uploadIds || [])[parseInt(file[1], 10) - 1];
        const found = files.find(item => item.id === id);
        if (found) return found.name;
      }
      if (/^t\d{1,3}$/.test(text)) return 'a table it made';
      return text || 'a file';
    }
    /** One tool call in plain words: what it did and to which file, why it failed when it did, and its receipt. */
    function toolRow(call, run, ctx) {
      const words = TOOL_WORDS[call.tool];
      const field = TOOL_TARGET[call.tool];
      const target = field && call.input && typeof call.input === 'object' ? call.input[field] : null;
      const title = words ? words(shortName(target, run, ctx.files)) : `Asked for ${plain(call.tool)}, a tool it may not use`;
      const mark = call.outcome === 'succeeded' ? 'cha' : call.outcome === 'cancelled' ? 'off' : 'unsure';
      const why = call.outcome === 'succeeded' ? null : (call.envelope?.ok === false && call.envelope.error?.message) || OUTCOME_WORDS[call.outcome] || call.outcome;
      const receiptHost = h('div');
      const side = (call.receiptIds || []).map(id => {
        const open = link('Receipt', () => act(open, receiptHost, async () => { fill(receiptHost, workReceiptBody(await ctx.workReceipt(id))); open.remove(); }));
        return open;
      });
      return row({ mark, title, note: why, side: side.length ? side : null, extra: receiptHost });
    }
    /** The agent's turns so far: its own note for each turn, what each tool did, and each question with its answer. */
    function turnsDone(run, ctx) {
      const harness = run.harness;
      return (harness.turns || []).filter(turn => turn.step === 'act').map(turn => h('div', { class: 'launch-turn' },
        h('p', { class: 'launch-turn-head' }, h('span', { class: 'launch-mono' }, `Turn ${turn.turn}`), h('span', {}, turn.note)),
        rows(...(harness.toolCalls || []).filter(call => call.turn === turn.turn).map(call => toolRow(call, run, ctx))),
        ...(harness.handoffs || []).filter(item => item.turn === turn.turn && item.answer !== null).map(item => h('div', { class: 'launch-asked' },
          h('p', { class: 'launch-quote' }, item.question), note(`${item.to === 'client' ? "The client's answer" : 'You answered'}: ${item.answer}`)))));
    }
    /** The agent's open question and a box for the answer. The answer goes to the engine as typed; the next turn waits for approval. */
    function questionNodes(run, harness, status, paint, host) {
      const open = [...(harness.handoffs || [])].reverse().find(item => item.answer === null);
      const toClient = open?.to === 'client';
      const answer = h('textarea', { rows: 3, maxlength: 2000, value: '' });
      const send = filled('Send answer', () => act(send, status, async () => {
        const typed = answer.value.trim();
        if (!typed) throw new Error('Write your answer first.');
        paint(await busy(host, 'Preparing the next turn', () => request('venture.delivery.answer', { runId: run.id, answer: typed })));
      }));
      return [note(toClient ? 'The agent asks the client' : 'The agent asks you', 'launch-strong'),
        h('p', { class: 'launch-quote' }, open?.question || ''),
        toClient ? note('Ask the client, then write what they said.') : null,
        field(toClient ? "The client's answer" : 'Your answer', answer), actions(send), note(ANSWER_LINE), status];
    }
    /** The reconciliation a report carries, from its work receipt: balances or not, a picture of the matches, the gaps, and the receipt. */
    function reconciliationPart(receiptId, ctx) {
      const host = h('div', { class: 'launch-reconciliation' }, outline(3));
      const load = () => ctx.workReceipt(receiptId).then(receipt => fill(host, ...reconciliationNodes(receipt)), error => host.replaceChildren(...errorNodes(error, load)));
      void load();
      return host;
    }
    function reconciliationNodes(receipt) {
      const rec = receipt?.reconciliation;
      if (!rec) return [note('This work receipt holds no reconciliation.')];
      const [matched, noBill, notPaid] = ['matched-count', 'unmatched-bank-count', 'unmatched-bills-count'].map(key => figureOf(receipt, key));
      const [mark, words] = !rec.statementClosing ? ['off', 'The statement has no balance column, so the closing balance was not checked.']
        : rec.balanced ? ['cha', 'The statement balances.'] : ['unsure', 'The statement does not balance.'];
      const counts = [matched, noBill, notPaid].filter(Boolean);
      const gap = line => h('p', { class: 'launch-row-more launch-line' }, h('span', {}, [dayText(line.date), line.text].filter(Boolean).join(' ')), h('span', { class: 'launch-fig' }, line.display));
      // A gap of none is quiet: the amber mark is only for payments or bills that need a look.
      const countRow = (figure, rowMark, lines) => figure ? row({ mark: figure.minor === '0' ? 'off' : rowMark, title: figure.label, side: h('span', { class: 'launch-fig' }, figure.display), extra: lines.length ? h('div', {}, lines.map(gap)) : null }) : null;
      const pairs = rec.matched.map(item => ({ date: null, text: `${item.bankText}, bill ${item.billText}`, display: item.display }));
      return [
        h('h3', { class: 'launch-section-title' }, 'Reconciliation'),
        note("Worked out by Chausar's calculator from the files and attached to the report."),
        h('p', { class: 'launch-state' }, square(mark), h('span', {}, words)),
        // One mark per payment or bill: green matched, amber a payment with no bill, open a bill not paid. Counts only, no amounts.
        h('span', { class: 'launch-strip launch-match', role: 'img', 'aria-label': counts.map(item => `${item.label}: ${item.display}.`).join(' ') },
          ...rec.matched.map(() => square('cha')), ...rec.unmatchedBank.map(() => square('unsure')), ...rec.unmatchedBills.map(() => square('off'))),
        rows(countRow(matched, 'cha', pairs), countRow(noBill, 'unsure', rec.unmatchedBank), countRow(notPaid, 'off', rec.unmatchedBills)),
        fold('Work receipt', false, workReceiptBody(receipt)),
      ];
    }
    /** A work receipt: every money figure the calculator worked out, how, from which files, and its id. Its explanation
        only lists the same figures, so the rows stand for it. */
    function workReceiptBody(receipt) {
      const inputsOf = step => (step.inputs.length > 12 ? `${step.inputs.slice(0, 12).join(', ')} and ${step.inputs.length - 12} more` : step.inputs.join(', '));
      return h('div', { class: 'launch-receipt' },
        rows(...(receipt.figures || []).filter(item => item.unit !== 'count').map(item => h('div', { class: 'launch-receipt-row' }, h('span', {}, item.label), h('span', { class: 'launch-fig' }, item.display)))),
        h('div', { class: 'launch-small' },
          h('p', {}, 'How it was worked out'),
          h('ol', {}, (receipt.steps || []).map(step => h('li', {}, `${step.rule}: ${inputsOf(step) || 'nothing'} gives ${step.result}`))),
          h('p', {}, `Read from ${(receipt.inputs?.tables || []).map(table => table.name).join(', ') || 'the files'}. Amounts in the steps are in the smallest unit of ${receipt.currency}.`),
          h('p', { class: 'launch-mono' }, `Receipt ${receipt.id}`)));
    }

    /** The signal a review left behind: the engine's own field when it sends one, else the newest signal-recorded event for this draft. */
    async function signalFor(run) {
      if (typeof run.signalId === 'string' && run.signalId) return run.signalId;
      const probe = await request('venture.events', { limit: 1 });
      let before = Number(probe?.lastSeq) || 0;
      // Up to five pages of the newest events, owner reviews first; a check that failed when the draft was made is the fallback.
      let fallback = null;
      for (let count = 0; count < 5 && before > 0; count++) {
        const from = Math.max(0, before - 100);
        const batch = (await request('venture.events', { afterSeq: from, limit: 100 }))?.events || [];
        for (const event of [...batch].reverse()) {
          if (event.name !== 'signal-recorded' || event.data?.runId !== run.id || typeof event.data?.signalId !== 'string') continue;
          if (event.data.source === 'owner-rejected' || event.data.source === 'owner-edited') return event.data.signalId;
          fallback = fallback || event.data.signalId;
        }
        before = from;
      }
      if (fallback) return fallback;
      throw new Error("Chausar couldn't find your review of this draft in the recent history, so it can't make a practice case from it.");
    }
    /** "Practise this": turns a rejected or edited draft into a rehearsal case. The engine leaves the client's words out of it. */
    function practiseControl(run, status) {
      const practise = quiet('Practise this', () => act(practise, status, async () => {
        const scenario = await request('venture.simulation.fromSignal', { signalId: await signalFor(run) });
        practise.remove();
        status.replaceChildren(note(`Added to rehearsal on Agents: ${plain(scenario?.title) || 'a practice case'}.`, 'launch-note launch-done'));
      }));
      return actions(practise);
    }
    function reviewControls(run, status, paint, stage) {
      const editHost = h('div');
      const review = (payload, button) => act(button, status, async () => { paint(await request('venture.delivery.review', { runId: run.id, ...payload })); });
      // The engine refuses Accept on a practice draft and after any failed check, so the sheet only offers it when it can work.
      const failedCheck = (run.checks || []).some(check => !check.passed);
      const practice = practiceDraft(run, stage);
      const accept = acceptRefused(run, stage) ? null : filled('Accept', () => review({ verdict: 'accepted' }, accept));
      const edit = quiet('Edit', () => {
        const text = h('textarea', { rows: 10, maxlength: 20000, value: run.renderedText || '' });
        const save = quiet('Save edit', () => review({ verdict: 'edited', editedText: text.value }, save));
        editHost.replaceChildren(field('Your edit', text), actions(save));
      });
      const reasons = picker(REASON_WORDS, 'other');
      const reject = quiet('Reject', () => review({ verdict: 'rejected', reason: reasons.value }, reject));
      // The engine's own reason when it gives one; a practice draft already says so at the top of the sheet.
      const blocked = practice ? null : typeof run.acceptBlocked === 'string' && run.acceptBlocked ? run.acceptBlocked
        : failedCheck ? "A check failed, so this draft can't be accepted as it is. Edit it or reject it." : null;
      return [blocked ? note(blocked) : null,
        actions(accept, edit), editHost, h('div', { class: 'launch-reject' }, field('Why reject it', reasons), actions(reject))];
    }

    /** The books period payload for a choice: an engine period key, or the owner's own from and to. */
    function periodPayload(choice) {
      if (choice?.key === 'custom') return { from: choice.from, to: choice.to };
      return { period: choice?.key || 'this-month' };
    }
    /** "1 Oct to 31 Oct 2026": the year once when both days share it. */
    function rangeText(from, to) {
      if (String(from).slice(0, 4) !== String(to).slice(0, 4)) return `${dayText(from)} to ${dayText(to)}`;
      return `${dayText(from).replace(/\s\d{4}$/, '')} to ${dayText(to)}`;
    }
    /** The engine's period label for a summary, lower case, for a heading like "Money, this month". */
    function periodWords(summary) {
      if (summary?.periodKey === 'custom') return rangeText(summary.period.from, summary.period.to);
      const chosen = (summary?.periods || []).find(item => item.key === summary.periodKey);
      return chosen ? chosen.label.toLowerCase() : null;
    }

    async function renderMoney() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const choice = state.moneyPeriod || { key: 'this-month' };
      const summary = await request('venture.books.summary', periodPayload(choice));
      rememberDay(summary);
      const status = statusLine();
      // The engine names the periods and works out their dates on the owner's calendar; "Choose dates" sends the owner's own.
      const periods = Array.isArray(summary.periods) ? summary.periods : [];
      let periodNode = null;
      if (periods.length) {
        const current = summary.periodKey === 'custom' ? 'custom' : summary.periodKey || choice.key;
        const pick = picker([...periods.map(item => [item.key, item.label]), ['custom', 'Choose dates']], current);
        pick.setAttribute('aria-label', 'Period');
        const datesHost = h('div', { class: 'launch-dates', hidden: current !== 'custom' });
        const from = h('input', { type: 'date', value: summary.period.from });
        const to = h('input', { type: 'date', value: summary.period.to });
        const show = quiet('Show', () => act(show, status, async () => {
          const next = { key: 'custom', from: from.value, to: to.value };
          await request('venture.books.summary', periodPayload(next));
          state.moneyPeriod = next;
          await navigate('money');
        }));
        datesHost.append(field('From', from), field('To', to), actions(show));
        pick.addEventListener('change', () => {
          if (pick.value === 'custom') { datesHost.hidden = false; return; }
          state.moneyPeriod = { key: pick.value };
          void navigate('money');
        });
        periodNode = h('div', { class: 'launch-period' }, pick, datesHost);
      }
      const notes = (summary.notes || []).filter(item => item !== EXPERIMENTAL);
      return page(head(rangeText(summary.period.from, summary.period.to), 'Money'),
        periodNode, status,
        moneyFigures(summary),
        notes.length ? fold('About these figures', false, ...notes.map(item => note(item))) : null,
        experimental() ? warn(EXPERIMENTAL) : null,
        section('Open invoices', summary.openInvoices.length ? rows(...summary.openInvoices.map(item => row({
          mark: 'wait', title: `${item.number} · ${item.clientName}`, note: `due ${dayText(item.dueDate)}`,
          side: h('button', {
            class: 'launch-fig-btn', type: 'button',
            onclick: async () => { try { openInvoiceSheet(await request('venture.invoice.get', { invoiceId: item.invoiceId })); } catch (error) { sheet('Invoice', h('div', {}, ...errorNodes(error))); } },
          }, item.balanceDisplay),
        }))) : note('No open invoices.')),
        hosted ? null : actions(link('Back office books', () => navigate('brief'))));
    }

    async function renderConnections() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const cards = await request('venture.connectors.list', {});
      const starters = cards.filter(card => card.starter);
      const groups = [];
      for (const card of cards) {
        if (card.starter) continue;
        let group = groups.find(item => item.category === card.category);
        if (!group) { group = { category: card.category, label: card.categoryLabel, cards: [] }; groups.push(group); }
        group.cards.push(card);
      }
      // The starters at rest, every other tool one fold away, grouped as before.
      return page(head(null, 'Connections'),
        section('Start with these', h('div', { class: 'launch-rows' }, starters.map(connectorCard))),
        fold(`All ${cards.length} tools`, false, ...groups.map(group => fold(`${group.label} · ${group.cards.length}`, false, h('div', { class: 'launch-rows' }, group.cards.map(connectorCard))))));
    }
    /** "planned: handoff", "planned: read" read as one chip, "planned: handoff, read". */
    function chipWords(chips) {
      const planned = chips.filter(item => /^planned: /.test(item)).map(item => item.slice('planned: '.length));
      const rest = chips.filter(item => !/^planned: /.test(item));
      return planned.length ? [...rest, `planned: ${planned.join(', ')}`] : rest;
    }
    function connectorCard(card) {
      const status = statusLine();
      const handoff = card.modes.some(mode => mode.mode === 'handoff' && mode.status === 'available');
      let open = null;
      if (handoff && (card.id === 'lovable' || card.id === 'replit')) open = quiet('Open', () => navigate('build'));
      else if (handoff && (card.id === 'bolt' || card.id === 'v0')) open = quiet('Open', () => act(open, status, () => handOff(card.id, status)));
      const visit = card.vendorUrl ? link('Visit site', () => act(null, status, () => openExternal(card.vendorUrl))) : null;
      return h('div', { class: 'launch-card', 'data-connector': card.id },
        h('details', {}, h('summary', {}, card.name), h('div', { class: 'launch-more-body' }, note(card.note), card.regionNote ? note(card.regionNote) : null,
          ...card.modes.map(mode => note(`${mode.status === 'planned' ? 'Planned: ' : ''}${mode.mode}. ${mode.what}`)), visit ? actions(visit) : null)),
        h('span', { class: 'launch-chips' }, chipWords(card.chips).map(chip)),
        h('span', { class: 'launch-card-actions' }, open), status);
    }

    // ---------------------------------------------------------------------------------------------
    // Keeping the business safe (Trust & access, and the workspace menu): the passphrase switch, the recovery code,
    // the automatic backups and moving to another computer. Every state shown is the engine's; no code is kept here.
    // ---------------------------------------------------------------------------------------------
    const SWITCH_WORDS = Object.freeze({ off: "It opens when you're signed in to this computer.", on: 'It asks for your passphrase each time it opens.' });
    const RECOVERY_NUDGE = ", so you can get back in if this computer's key is lost.";
    const MOVE_WARNINGS = Object.freeze([
      'Anyone with this file and this code can open your business. Keep them apart, and delete the file once you\'ve moved.',
      'The business stays on this computer too. Changes on one computer don\'t reach the other.',
    ]);
    /** The threat words of KEYCHAIN-SPEC section 11, for the current mode. The platform lines come from the engine. */
    const THREAT_WORDS = Object.freeze({
      'this-computer': Object.freeze([
        'Your business is encrypted on disk.',
        "Someone who copies your files, or takes the disk out, can't read them without your computer login.",
        "Other people with their own login on this computer can't open it.",
        'Anyone signed in as you, or a program running as you, can open it. Turn on the passphrase if others use your login.',
        'If your computer login has no password, this protects very little.',
      ]),
      passphrase: Object.freeze([
        "It asks for your passphrase each time it opens. While it's open, anyone at this screen can use it.",
        'If you forget the passphrase and have no recovery code, nobody can get your business back, not even Chausar.',
        'Turning it on protects from now on. Copies someone already took stay as they were.',
      ]),
      both: Object.freeze([
        'Backups are encrypted and open the same way your business does now.',
        "They're kept on this computer, so they don't help if it breaks or is lost.",
        "Anyone with a move file and its code can open your business. Keep them apart, and delete the file once you've moved.",
      ]),
    });
    const LOSS_TAIL = ' Your recovery code still opens your business and its backups.';
    /** Back to Trust & access once a code was shown on its own screen. */
    function backToTrust() { closeSheet(); state.page = 'trust'; renderShell(); }
    /** A passphrase field for a sheet: Show beside it, never kept, cleared after each send. */
    function sheetPassphrase(labelText, autocomplete = 'current-password') {
      const control = h('input', { type: 'password', value: '', autocomplete, spellcheck: 'false' });
      return { control, node: passphraseField(labelText, control) };
    }
    /** The panel at the top of Trust & access. It never throws: a failed read shows the engine's words in place. */
    async function custodyPanel() {
      const host = h('section', { class: 'launch-custody', 'data-part': 'custody' });
      await paintCustody(host);
      return host;
    }
    /** The same panel in a sheet, from the workspace menu or Today's line. */
    async function openCustodySheet() {
      const host = h('div', { class: 'launch-custody', 'data-part': 'custody' }, outline(4));
      sheet('Backups and lock', host);
      await paintCustody(host);
    }
    async function paintCustody(host) {
      const [read, listed] = await Promise.all([settle(request('workspace.custody.get')), settle(request('workspace.backups.list'))]);
      const refresh = () => paintCustody(host);
      if (read.error || !read.value?.business) {
        fill(host, head(null, 'Keeping your business safe'), ...(read.error ? errorNodes(read.error, refresh) : [note('Open a business to see how it is kept.')]));
        return;
      }
      const { computer, business } = read.value;
      const mode = business.unlock;
      const on = mode === 'passphrase';
      const stuck = on && !computer.available;
      const status = statusLine();
      // The switch: on means a passphrase opens the business; off means this computer's login does.
      const toggleSwitch = h('button', {
        class: 'launch-switch', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: stuck ? true : null,
        onclick: () => (on ? openPassphraseOff(refresh) : openPassphraseOn(refresh)),
      }, h('span', { class: 'launch-switch-track', 'aria-hidden': 'true' }, h('i')), h('span', {}, 'Lock with a passphrase'));
      const switchWords = stuck ? (CUSTODY_COPY.unavailable[computer.reason] || computer.where) : on ? SWITCH_WORDS.on : SWITCH_WORDS.off;
      // The recovery code.
      const made = business.recovery === 'made';
      const recoveryWords = made ? 'Recovery code: made' : business.recovery === 'not-made' ? 'Recovery code: not made yet' : 'Recovery code: not known';
      const makeCode = (made ? quiet : filled)(made ? 'Make a new one' : 'Make a recovery code', () => openRecoverySheet(mode, made));
      // Backups.
      const backups = listed.value?.backups || [];
      const backupHead = business.backups.auto ? 'Backups: automatic, kept on this computer.' : 'Backups: kept on this computer when you make one.';
      const last = business.backups.lastError
        ? h('p', { class: 'launch-error', role: 'alert' }, plain(business.backups.lastError))
        : note(business.backups.newestAt ? `Last backup: ${backupWhen(business.backups.newestAt)}` : 'No backup yet.');
      const backupNow = quiet('Back up now', () => act(backupNow, status, async () => { await request('workspace.backups.create', {}); await refresh(); }));
      const backupRows = backups.map(backup => row({
        mark: backup.opensNow ? 'you' : 'off', title: backupWhen(backup.at),
        note: `${BACKUP_KIND_WORDS[backup.kind] || backup.kind}. ${backup.opensNow ? 'Opens the way your business opens now.' : 'Opens with an older passphrase or code.'}`,
        side: link('Restore', () => openRestoreSheet(backup, refresh)),
      }));
      const threats = [
        ...(on ? THREAT_WORDS.passphrase : THREAT_WORDS['this-computer'].map((line, index) => (index === 0 && computer.available ? `${line} ${computer.where}` : line))),
        on || !computer.loss ? null : `${computer.loss}${LOSS_TAIL}`,
        ...THREAT_WORDS.both,
      ].filter(Boolean);
      fill(host,
        head('Encrypted on this computer.', 'Keeping your business safe'),
        computer.available ? note(computer.where) : null,
        section(null, h('div', { class: 'launch-switch-row' }, toggleSwitch, note(switchWords, 'launch-note launch-switch-words'))),
        section(null, row({ mark: made ? 'you' : 'wait', title: recoveryWords, side: makeCode })),
        section(null, row({ mark: business.backups.lastError ? 'unsure' : 'cha', title: backupHead, extra: last, side: backupNow }),
          backupRows.length ? fold(`All backups, ${backups.length}${listed.value?.more ? ' newest' : ''}`, false, rows(...backupRows), note('Copies outside the backups folder, like a saved move file, are not changed when you change the lock.')) : null),
        section(null, quiet('Move to another computer', () => openMoveSheet(mode))),
        business.storage === 'experimental-file' ? warn(EXPERIMENTAL) : null,
        note(TEN_YEARS_LINE),
        fold('What this protects', false, ...threats.map(line => note(line))),
        status);
    }
    function openPassphraseOn(refresh) {
      const first = sheetPassphrase('Passphrase', 'new-password'), again = sheetPassphrase('Type it again', 'new-password');
      const status = statusLine();
      const go = filled('Lock with this passphrase', () => act(go, status, async () => {
        if (first.control.value.length < 12) { nudge(first.node); throw new Error('Use a passphrase of at least 12 characters.'); }
        if (first.control.value !== again.control.value) { nudge(again.node); throw new Error('The two passphrases do not match.'); }
        let result;
        try { result = await request('workspace.custody.passphraseOn', { passphrase: first.control.value }); }
        finally { first.control.value = ''; again.control.value = ''; }
        try { state.status = await request('workspace.status'); } catch { /* the status can be read later */ }
        if (typeof result?.recoveryCode === 'string' && result.recoveryCode) {
          showRecoveryCode({ recoveryCode: result.recoveryCode, folder: result.custody?.business?.folder || '' }, backToTrust,
            { title: 'Save your recovery code.', lead: 'A passphrase can be forgotten. This code still opens your business. You\'ll see it once.', preview: null });
          return;
        }
        closeSheet(); await refresh();
      }));
      sheet('Lock with a passphrase', h('div', {}, first.node, again.node, h('p', { class: 'ob-hint launch-note' }, 'At least 12 characters. Nobody can reset it.'), actions(go), status));
    }
    function openPassphraseOff(refresh) {
      const current = sheetPassphrase('Passphrase');
      const status = statusLine();
      const go = filled('Stop asking', () => act(go, status, async () => {
        if (!current.control.value) { nudge(current.node); throw new Error('Enter your passphrase.'); }
        try { await request('workspace.custody.passphraseOff', { passphrase: current.control.value }); }
        finally { current.control.value = ''; }
        try { state.status = await request('workspace.status'); } catch { /* the status can be read later */ }
        closeSheet(); await refresh();
      }));
      sheet('Stop asking for a passphrase', h('div', {}, note('Type your passphrase to stop asking for it.'), current.node, actions(go), status));
    }
    function openRecoverySheet(mode, made) {
      const ask = mode === 'passphrase' ? sheetPassphrase('Your passphrase') : null;
      const status = statusLine();
      const go = filled(made ? 'Make a new code' : 'Make the code', () => act(go, status, async () => {
        const payload = {};
        if (ask) { if (!ask.control.value) { nudge(ask.node); throw new Error('Enter your passphrase.'); } payload.passphrase = ask.control.value; }
        let result;
        try { result = await request('workspace.custody.recoveryCode', payload); }
        finally { if (ask) ask.control.value = ''; delete payload.passphrase; }
        showRecoveryCode({ recoveryCode: result.recoveryCode, folder: result.custody?.business?.folder || '' }, backToTrust,
          { title: 'Save your recovery code.', lead: "It opens your business if this computer's key is lost. You'll see it once.", preview: null });
      }));
      sheet(made ? 'Make a new recovery code' : 'Make a recovery code', h('div', {},
        made ? warn('Your old code stops working.') : note('It opens your business and its backups if this computer\'s key is lost.'),
        ask ? ask.node : null, actions(go), status));
    }
    function openRestoreSheet(backup, refresh) {
      const status = statusLine();
      const go = filled('Restore this copy', () => act(go, status, async () => {
        const result = await request('workspace.backups.restore', { file: backup.file, confirmed: true });
        if (result?.workspace) state.workspace = result.workspace;
        closeSheet();
        if (document.getElementById('page-content')) await navigate(state.page); else await refresh();
      }));
      sheet('Restore this backup', h('div', {}, note(backupWhen(backup.at), 'launch-strong'),
        note('Your business goes back to how it was then. Chausar saves a copy of how it is now first.'), actions(go), status));
    }
    function openMoveSheet(mode) {
      const ask = mode === 'passphrase' ? sheetPassphrase('Your passphrase') : null;
      const status = statusLine();
      const body = h('div', {});
      const go = filled('Make the file', () => act(go, status, async () => {
        const payload = {};
        if (ask) { if (!ask.control.value) { nudge(ask.node); throw new Error('Enter your passphrase.'); } payload.passphrase = ask.control.value; }
        let made;
        try { made = await request('workspace.transfer.export', payload); }
        finally { if (ask) ask.control.value = ''; delete payload.passphrase; }
        const code = plain(made.transferCode);
        const chunks = code.match(/.{1,4}/g) || [];
        const copied = statusLine();
        fill(body,
          note('Your move code. You see it once; Chausar keeps no copy.'),
          h('div', { class: 'ob-code launch-move-code', role: 'group', 'aria-label': 'Move code', 'data-code-length': String(code.length) }, chunks.map(part => h('span', { class: 'ob-chunk' }, part))),
          actions(quiet('Copy', () => act(null, copied, async () => { await copyText(code); copied.replaceChildren(note('Move code copied.')); })),
            filled('Save the file', () => saveText(plain(made.fileName), made.text, 'application/json'))),
          copied, ...MOVE_WARNINGS.map(line => warn(line)));
      }));
      fill(body, note('Chausar makes one file and one code. On the other computer, choose Move from another computer, then give it both.'), ask ? ask.node : null, actions(go), status);
      sheet('Move to another computer', body);
    }
    /** Today: one quiet line while the business has no recovery code. Hosted keeps its own custody. */
    async function recoveryNudge() {
      if (hosted) return null;
      const read = await settle(request('workspace.custody.get'));
      if (read.value?.business?.recovery !== 'not-made') return null;
      return h('p', { class: 'launch-note launch-nudge' }, link('Make a recovery code', () => void navigate('trust')), RECOVERY_NUDGE);
    }

    // ---------------------------------------------------------------------------------------------
    // Entry points app.js calls
    // ---------------------------------------------------------------------------------------------
    /** The vault is open: resume onboarding when there is no business yet, else open Today. */
    async function afterOpen() {
      let view;
      try { view = await request('venture.get'); }
      catch { state.page = 'today'; renderShell(); return; }
      if (!view) { onboarding().vaultOpen = true; await startFlow(); return; }
      state.venture = view;
      state.page = 'today';
      renderShell();
    }

    const views = Object.freeze({
      today: renderToday, business: renderBusiness, build: renderBuild, clients: renderClients,
      agents: renderAgents, money: renderMoney, connections: renderConnections,
    });
    /** The renderer's copies of the onboarding contract, for the test that compares them. */
    const copies = Object.freeze({ CLAUDE_TERMS_REASON, OPEN_BOX_TEXT, VIEWS, KIND_LABELS, AI_OPTION_IDS, AI_STATUS_CHIPS, AI_UNCHECKED_LINE, AI_HALF_CONNECTED_WORDS, NOT_A_SERVICE_WORDS, COMPOSE_REFUSED_WORDS, PREVIEW_WORDS, SERVICE_TYPE_LABELS, CUSTODY_COPY, THREAT_WORDS });
    return Object.freeze({ pages, views, firstRun, afterOpen, pairing, openExisting, showRecoveryCode, custodyPanel, openCustodySheet, copies });
  },
});
