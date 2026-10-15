'use strict';
/* Chausar launch screens: one question first, a plan at once, then seven places.
   A classic deferred script that runs before app.js. It defines one frozen global and does no work until
   app.js calls create(kit): no document, storage, timer or network access when it loads.
   Engine values always become text nodes. The screen never does money arithmetic: every amount it shows is
   an engine display string, and every amount the owner types goes to the engine exactly as typed. */
globalThis.ChausarLaunch = Object.freeze({
  version: 1,
  create(kit) {
    const { h, request, navigate, renderShell, renderSetup, showRecoveryKit, openExternal, reserveTab, saveText, state } = kit;

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
    const PASSPHRASE_LINE = 'Chausar locks your business with this passphrase. Nobody can reset it, so keep the recovery code you see next.';
    const TEN_YEARS_LINE = 'Chausar keeps your records for ten years, as tax rules expect.';
    const RECOMMENDED = 'Claude Haiku 5.5 for quick work and Sonnet 5.5 for plans: one Anthropic key';

    const LABEL_WORDS = { 'told-by-you': 'told by you', assumption: 'assumption', computed: 'computed' };
    const DONE_BY = { you: 'You', agent: 'An agent', 'agent-then-you': 'Agent drafts, you check' };
    const PRICING = [['monthly', 'Per month'], ['project', 'Per project'], ['hourly', 'Per hour']];
    const UNIT_WORDS = { month: 'per month', project: 'per project', hour: 'per hour' };
    const RAIL_NAMES = { razorpay: 'Razorpay', cashfree: 'Cashfree', paypal: 'PayPal', stripe: 'Stripe', 'lemon-squeezy': 'Lemon Squeezy', paddle: 'Paddle' };
    // Chausar does not take payments: the site carries pay links and the owner records each payment.
    // Tax names read lower case inside a sentence unless they are letters like GST or VAT.
    const taxInSentence = label => /^[A-Z]{2,}/.test(label || '') ? label : String(label || '').toLowerCase();
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
    const RUN_WORDS = { 'waiting-for-you': 'waiting for you', 'ready-for-review': 'ready to review', accepted: 'accepted', edited: 'edited', rejected: 'rejected', failed: 'failed' };
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
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
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

    function closeSheet() { const current = openSheet; openSheet = null; if (current) current.close(); }
    /** One sheet at a time, on the right. Esc or Close shuts it. */
    function sheet(title, body, onClose) {
      closeSheet();
      const dialog = h('dialog', { class: 'launch-sheet', 'aria-label': title });
      dialog.append(h('div', { class: 'launch-sheet-head' }, h('h2', { class: 'launch-sheet-title' }, title), link('Close', () => dialog.close())), h('div', { class: 'launch-sheet-body' }, body));
      dialog.addEventListener('close', () => { if (openSheet === dialog) openSheet = null; dialog.remove(); if (onClose) onClose(); });
      document.body.append(dialog);
      openSheet = dialog;
      dialog.showModal();
      return dialog;
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
    /** Today's date as the engine counts it (UTC), offered in a date field the owner can change, so a new payment falls inside the engine's default Money period. */
    function engineDate() { return new Date().toISOString().slice(0, 10); }
    async function copyText(value) {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') throw new Error('This window cannot copy. Use Save instead.');
      try { await navigator.clipboard.writeText(value); }
      catch { throw new Error('This window could not copy. Use Save instead.'); }
    }
    function folderFor(name) {
      const slug = plain(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '');
      return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(slug) ? slug : 'main';
    }
    function folderWords(folder) { return `Chausar keeps this business in the workspace folder ${folder}. To open it again you need this folder name and your passphrase.`; }
    async function modelStatus() { try { return await request('venture.models.status'); } catch { return null; } }
    function servedByModel(status, tier = 'main') { const current = status?.tiers?.[tier]; return Boolean(current && current.presetId !== 'built-in-templates' && current.usable); }
    const replaying = models => models?.replay?.active === true;
    function recordingNote(models) { return replaying(models) ? note(RECORDING_LINE, 'launch-note launch-recording') : null; }
    /** Who writes, in words: the connected model, or in a demo the synthetic recording that answers in its place. */
    function writtenBy(models, presetId, model) { return replaying(models) ? 'from a synthetic recording' : `with ${presetName(presetId, model)}`; }

    // ---------------------------------------------------------------------------------------------
    // Onboarding: Idea, Plan, Keep it safe, then the plan in the vault and Build. No rail.
    // ---------------------------------------------------------------------------------------------
    function onboarding() {
      if (!state.onboarding) state.onboarding = { idea: '', countryCode: null, countries: null, preview: null, pricing: 'monthly', price: '', tax: null, rate: null, extra: {}, workingName: '', vaultOpen: false };
      return state.onboarding;
    }
    function frame(step, ...content) {
      closeSheet();
      state.generation++;
      const flow = h('main', { class: 'launch-flow', id: 'launch-flow' }, step ? stepsLine(step) : null, ...content);
      const root = h('div', { class: 'launch-root' }, h('header', { class: 'launch-top' }, h('span', { class: 'launch-wordmark' }, 'chausar')), flow);
      document.getElementById('app').replaceChildren(root);
      return flow;
    }
    function stepsLine(current) {
      const steps = [['idea', 'Idea'], ['plan', 'Plan'], ['keep', 'Keep it safe'], ['accept', 'Accept'], ['build', 'Build']];
      const at = steps.findIndex(([id]) => id === current);
      return h('ol', { class: 'launch-steps', 'aria-label': 'Steps' }, steps.map(([id, words], index) => h('li', {
        class: index === at ? 'now' : index < at ? 'done' : '', 'aria-current': index === at ? 'step' : null,
      }, square(index === at ? 'now' : index < at ? 'you' : 'off'), words)));
    }
    function browserRegion() {
      try {
        if (typeof navigator === 'undefined') return null;
        const region = plain(navigator.language).split('-')[1];
        return region ? region.toUpperCase() : null;
      } catch { return null; }
    }

    /** Step one: the idea. The only requests are the boot status and the country list. */
    function firstRun() {
      onboarding().vaultOpen = false;
      void showIdea().catch(error => frame(null, page(...errorNodes(error, firstRun))));
    }

    async function showIdea() {
      const ob = onboarding();
      const idea = h('textarea', { rows: 3, maxlength: 2000, value: ob.idea, placeholder: 'One sentence is enough' });
      const countryLine = h('div', { class: 'launch-country' });
      const status = statusLine();
      const show = filled('Show my plan', () => act(show, status, async () => {
        const value = idea.value.trim();
        if (!value) throw new Error('Write one sentence about the business you want to start.');
        ob.idea = value;
        if (ob.preview?.idea !== value || ob.preview?.country?.code !== ob.countryCode) { ob.tax = null; ob.rate = null; ob.extra = {}; }
        ob.preview = await request('venture.preview', { idea: value, countryCode: ob.countryCode || 'XX' });
        showPlan();
      }));
      idea.addEventListener('input', () => { ob.idea = idea.value; });
      const other = ob.vaultOpen
        ? link('Open the back office', () => { state.page = 'conversation'; renderShell(); })
        : link('I already have a business in Chausar', () => renderSetup());
      frame('idea', head(null, 'What service business do you want to start?'), field('Your idea', idea),
        note('For example: monthly bookkeeping for cafes in Pune', 'launch-example'), countryLine, actions(show, other), status,
        note('Nothing is saved until you keep it.'));
      if (!ob.countries) {
        try { ob.countries = await request('venture.countries'); }
        catch (error) { countryLine.replaceChildren(...errorNodes(error, showIdea)); }
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
      const words = country.code === 'XX' ? `${country.name}.` : `${country.name}, prices in ${country.currency}.`;
      host.replaceChildren(h('span', { class: 'launch-note' }, words), ' ', link('Change', () => {
        const choose = picker(ob.countries.map(item => [item.code, item.name]), ob.countryCode);
        choose.addEventListener('change', () => { ob.countryCode = choose.value; paintCountry(host); });
        host.replaceChildren(field('Country', choose));
      }));
    }

    /** Step two: the plan from built-in templates, before any vault. Price and tax are set here, inline. */
    function showPlan() {
      const ob = onboarding();
      frame('plan', draftPlanBody(ob.preview, { inVault: ob.vaultOpen, onKeep: () => (ob.vaultOpen ? runSetup({ host: null, skipCreate: false }) : showKeepSafe()) }));
    }

    function draftPlanBody(preview, { inVault, onKeep }) {
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
        choiceRow(PRICING, ob.pricing, value => { ob.pricing = value; }),
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
        head(inVault ? 'Your plan, not kept yet' : 'Your plan, not saved yet', preview.serviceLabel),
        h('p', { class: 'launch-lead' }, preview.oneLiner.value, ' ', tag(preview.oneLiner)),
        section("Who it's for", h('p', {}, preview.customer.value, ' ', tag(preview.customer))),
        section('Offers', rows(...preview.offers.map(offer => row({
          mark: 'off', title: offer.name.value, label: LABEL_WORDS[offer.name.label] || 'assumption',
          extra: h('p', { class: 'launch-row-more' }, offer.description.value),
        }))), priceBlock),
        section('Steps', stepRows(preview.deliverySteps)),
        section('You approve', approvalLines(preview.approvals)),
        section('Back office', h('p', {}, `Invoices and books in ${country.currency}. ${railWords(preview.backOffice.paymentRail)}`),
          h('p', {}, taxChip, ' ', link('Change', () => { taxBody.hidden = !taxBody.hidden; })), taxBody),
        section(null, link('Tell us more (optional)', () => { extraBody.hidden = !extraBody.hidden; }), extraBody),
        actions(keep, quiet('Start over', () => { ob.preview = null; ob.tax = null; ob.rate = null; ob.price = ''; ob.extra = {}; void showIdea(); })),
        status);
    }
    /** One line per approval, each with its own label. */
    function approvalLines(approvals, cls = 'launch-approval') { return (approvals || []).map(item => h('p', { class: cls }, item.value, ' ', tag(item))); }
    function stepRows(steps) {
      return rows(...steps.map(step => row({
        mark: step.doneBy === 'you' ? 'you' : 'cha', title: step.title.value, label: LABEL_WORDS[step.title.label] || 'assumption', note: DONE_BY[step.doneBy] || step.doneBy,
        side: step.capability === 'planned' ? chip('planned: agent') : null,
      })));
    }

    /** Step three: keep it safe. The passphrase is asked only now, in a password field inside its form. */
    function showKeepSafe() {
      const ob = onboarding();
      const name = textInput(ob.workingName || 'My service business', { maxlength: 80, autocomplete: 'organization', required: true });
      const passphrase = h('input', { type: 'password', value: '', minlength: 12, required: true, autocomplete: 'new-password' });
      const confirm = h('input', { type: 'password', value: '', minlength: 12, required: true, autocomplete: 'new-password' });
      const status = statusLine();
      const submit = h('button', { class: 'launch-btn', type: 'submit' }, 'Keep it');
      /** The engine has no list of workspaces, so the owner must know this folder name to open or recover the business later. */
      const workingNameNow = () => name.value.trim() || 'My service business';
      const folderLine = note('');
      const paintFolder = () => folderLine.replaceChildren(folderWords(folderFor(workingNameNow())));
      name.addEventListener('input', paintFolder);
      paintFolder();
      const keepForm = h('form', {
        class: 'launch-form',
        onsubmit: event => {
          event.preventDefault();
          return act(submit, status, async () => {
            const workingName = workingNameNow();
            const folder = folderFor(workingName);
            if (passphrase.value.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
            if (passphrase.value !== confirm.value) throw new Error('The two passphrases do not match.');
            let result;
            try { result = await request('workspace.create', { name: workingName, passphrase: passphrase.value, pack: 'services', folder }); }
            finally { passphrase.value = ''; confirm.value = ''; }
            ob.workingName = workingName;
            ob.vaultOpen = true;
            try { state.status = await request('workspace.status'); } catch { /* the vault is open; the status can be read later */ }
            state.workspace = result?.workspace || state.status?.workspace || { name: workingName };
            const recovery = result?.recoveryKit || result?.recoveryCode;
            const next = () => { void runSetup({ host: null, skipCreate: false }); };
            if (recovery) showRecoveryKit(recovery, { ...result, folder }, next); else next();
          });
        },
      }, field('Working name', name), folderLine, field('Passphrase', passphrase), field('Confirm passphrase', confirm),
      note(PASSPHRASE_LINE), note(TEN_YEARS_LINE), experimental() ? warn(EXPERIMENTAL) : null,
      actions(submit, link('Back to the plan', () => showPlan())), status);
      frame('keep', head(null, 'Keep your plan safe'), keepForm);
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

    /** After the vault exists: create the business, answer the template interview, draft and price the plan. */
    async function runSetup({ host, skipCreate, after = showOwnedPlan }) {
      const ob = onboarding();
      const progress = h('div', { class: 'launch-setup' }, note('Setting up your plan from built-in templates.'));
      if (host) host.replaceChildren(progress);
      else frame('accept', head(null, 'Setting up your plan'), progress);
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
          if (ob.price) await request('venture.price.quote', { offerId: 'offer_1' });
        });
      } catch (error) {
        const retry = () => runSetup({ host, skipCreate, after });
        progress.replaceChildren(...errorNodes(error, retry), actions(filled('Try again', retry), host ? null : link('Back to the plan', () => showPlan())));
        return;
      }
      state.onboarding = null;
      await after();
    }

    /** Step four: the plan in the vault, with receipts, before acceptance. */
    async function showOwnedPlan() {
      const flow = frame('accept');
      const body = h('div', { class: 'launch-plan' });
      flow.append(body, actions(link('Go to your business', goHome)));
      try { await paintPlan(body, 'onboarding'); }
      catch (error) { body.replaceChildren(...errorNodes(error, showOwnedPlan)); }
    }
    function goHome() { closeSheet(); state.page = 'today'; renderShell(); }

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
        ob.preview = await request('venture.preview', { idea: view.venture.idea, countryCode: view.venture.country.code });
        const after = mode === 'place' ? () => navigate('business') : showOwnedPlan;
        host.replaceChildren(draftPlanBody(ob.preview, { inVault: true, onKeep: () => runSetup({ host, skipCreate: true, after }) }));
        return;
      }
      host.replaceChildren(planBody({ view, blueprintView, models, mode, host }));
    }

    function planBody(ctx) {
      const { view, blueprintView, models, mode, host } = ctx;
      const plan = blueprintView.blueprint;
      const receipts = blueprintView.offerReceipts || {};
      const country = view.venture.country;
      const backOffice = plan.backOffice;
      const open = mode === 'onboarding';
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

      return h('div', { class: 'launch-plan-body' },
        head(`Plan, version ${plan.version}, ${plan.status === 'accepted' ? 'accepted' : 'not accepted yet'}`, plan.name.value),
        h('p', { class: 'launch-lead' }, plan.oneLiner.value, ' ', tag(plan.oneLiner)),
        h('p', {}, h('span', { class: 'launch-label' }, 'For'), ' ', plan.customer.value, ' ', tag(plan.customer)),
        plan.source === 'model' ? recordingNote(models) : null,
        section('Offers', rows(...offerRows), fold('About the offers', open, ...plan.offers.map(offer => note(`${offer.name.value}: ${offer.description.value}`)))),
        section('Steps', stepRows(plan.deliverySteps), fold('How each step works', open, ...plan.deliverySteps.map(step => note(`${step.title.value}: ${step.note}`)))),
        missing,
        fold('You approve', open, approvalLines(plan.approvals, 'launch-note launch-approval')),
        fold('Back office', open, note(`Invoices and books in ${backOffice.currency}. ${taxWords} ${railWords(backOffice.paymentRail)}`), tag(backOffice.taxRegistered), ready),
        mode === 'place' ? fold('What your business knows', false, note(`Active: ${active.join(', ') || 'none yet'}. Proposed: ${proposed.join(', ') || 'none'}.`),
          ...(view.terms || []).map(term => note(`${term.name}: ${term.meaning}`))) : null,
        actions(accept, quiet('Change plan', () => openChangeSheet(ctx)), rewrite, plan.status === 'accepted' && mode === 'place' ? link('Go to Build', () => navigate('build')) : null),
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
      const flow = frame('build');
      const content = h('div', { class: 'launch-build' }, note('Writing your build brief.'));
      flow.append(content, actions(link('Go to your business', goHome)));
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
      const flow = frame('build');
      const content = h('div', { class: 'launch-build' });
      flow.append(content, actions(link('Go to your business', goHome)));
      try {
        const [status, models] = await Promise.all([request('venture.build.status'), modelStatus()]);
        content.replaceChildren(...buildBody({ status, models, mode: 'onboarding', refresh: showBuildStepAgain }));
      } catch (error) { content.replaceChildren(...errorNodes(error, showBuildStepAgain)); }
    }

    /** The opening words of the brief: its first section, cut short. "See all" shows every line. */
    function openingLines(markdown) {
      const lines = plain(markdown).split('\n').map(item => item.trim()).filter(Boolean);
      const start = lines.findIndex(item => /^##\s*1\./.test(item));
      const paragraph = start >= 0 ? (lines[start + 1] || '') : (lines[1] || lines[0] || '');
      return paragraph.length > 120 ? `${paragraph.slice(0, 120).replace(/\s+\S*$/, '')}…` : paragraph;
    }
    function briefState(brief) {
      if (brief.lint?.ok) return `${Number(brief.chars).toLocaleString('en-US')} of 9,000 characters, checks passed.`;
      const finding = brief.lint?.findings?.[0];
      return `Not ready to hand over: ${finding?.message || 'the brief check failed.'}`;
    }
    function openBriefSheet(brief) {
      sheet('Your build brief', h('div', {}, h('pre', { class: 'launch-pre' }, brief.markdown),
        actions(quiet('Save brief', () => saveText('brief.md', brief.markdown, 'text/markdown')))));
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

    function buildBody(ctx) {
      const { status, models, mode, refresh } = ctx;
      const brief = status.brief;
      const out = [head(mode === 'onboarding' ? 'Build' : null, mode === 'onboarding' ? 'Hand your brief to a builder' : 'Build')];
      const briefStatus = statusLine();
      if (!brief) {
        const write = filled('Write the build brief', () => act(write, briefStatus, async () => {
          await busy(briefStatus, 'Writing your build brief', () => request('venture.build.brief', {}));
          await refresh();
        }));
        out.push(section(null, note('No build brief yet. Chausar writes it from your accepted plan.'), actions(write), briefStatus));
      } else {
        const notesHost = h('div', { class: 'launch-handoff-notes' });
        const handoffStatus = statusLine();
        const open = (builder, button) => act(button, handoffStatus, () => handOff(builder, notesHost));
        const lovable = filled('Open in Lovable', () => open('lovable', lovable));
        const replit = quiet('Open in Replit', () => open('replit', replit));
        const copy = quiet('Copy brief', () => act(copy, handoffStatus, async () => { await copyText(brief.markdown); handoffStatus.replaceChildren(note('Brief copied.')); }));
        const again = link('Write it again', () => act(again, briefStatus, async () => {
          await busy(briefStatus, 'Writing your build brief', () => request('venture.build.brief', {}));
          await refresh();
        }));
        if (!brief.lint?.ok) { lovable.disabled = true; replit.disabled = true; }
        out.push(
          section('Your brief', h('p', { class: 'launch-brief' }, openingLines(brief.markdown)),
            h('p', { class: 'launch-note' }, briefState(brief), ' ', link('See all', () => openBriefSheet(brief)), ' ', again),
            brief.wordsBy === 'model' ? recordingNote(models) : null, briefStatus),
          section('Builders',
            actions(lovable, replit, copy, quiet('Save brief', () => saveText('brief.md', brief.markdown, 'text/markdown'))),
            note('Replit receives your brief as soon as its page opens.'), notesHost, handoffStatus,
            status.handoffs?.length ? rows(...status.handoffs.slice(0, 4).map(handoff => row({
              mark: handoff.openedAt ? 'you' : 'off', title: BUILDER_NAMES[handoff.builder] || handoff.builder,
              note: handoff.openedAt ? `opened ${timeText(handoff.openedAt)}` : 'prepared, not opened',
            }))) : null));
      }
      out.push(status.follow ? section('GitHub', followStatus(status, refresh)) : section('Follow the build on GitHub', followForm(status, refresh)));
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

    function followStatus(status, refresh) {
      const follow = status.follow;
      const current = follow.lastStatus;
      const result = statusLine();
      const check = quiet('Check GitHub now', () => act(check, result, async () => {
        await busy(result, 'Reading GitHub', () => request('venture.build.sync'));
        await refresh();
      }));
      const formHost = h('div');
      const repoName = `${follow.repo.owner}/${follow.repo.name}`;
      if (!current) return h('div', {}, note(`Following ${repoName}. Not read yet.`), actions(check), result);
      const synthetic = (current.cannotSay || []).filter(item => /synthetic recording/i.test(item));
      const limits = (current.cannotSay || []).filter(item => !/synthetic recording/i.test(item));
      const marker = current.briefMarker === 'older' && current.briefMarkerVersion ? `Brief marker from version ${current.briefMarkerVersion}` : MARKER_WORDS[current.briefMarker] || '';
      const address = current.deployment ? h('p', {}, 'Address a host recorded: ', h('span', { class: 'launch-mono' }, current.deployment.url), ' ',
        link('Copy', () => act(null, result, async () => { await copyText(current.deployment.url); result.replaceChildren(note('Address copied.')); }))) : null;
      return h('div', { class: 'launch-follow' },
        h('p', { class: 'launch-strong' }, `${BUILD_WORDS[current.word] || current.word}${current.syncConflictBranch ? ` on ${current.syncConflictBranch}` : ''}`, ' ', h('span', { class: 'launch-mono launch-unit' }, repoName)),
        current.lastCommit ? note(`Last change: ${current.lastCommit.message}. By ${BY_WORDS[current.lastCommit.by] || current.lastCommit.by}, ${timeText(current.lastCommit.at)}.`) : note('No changes read yet.'),
        note(`${marker}. ${UI_RUN_WORDS[current.checks] || ''}.`),
        WORKFLOW_WORDS[current.uiWorkflow] ? warn(WORKFLOW_WORDS[current.uiWorkflow]) : null,
        address,
        ...synthetic.map(item => note(item, 'launch-note launch-recording')),
        limits.length ? fold("What Chausar can't see", false, ...limits.map(item => note(item))) : null,
        actions(check, link('Change repo', () => { formHost.replaceChildren(followForm(status, refresh)); })), result, formHost);
    }

    // ---------------------------------------------------------------------------------------------
    // Add your AI: one sheet, cheapest first, consent shown word for word before any connection
    // ---------------------------------------------------------------------------------------------
    async function openAiSheet(onDone) {
      let connected = false;
      const body = h('div', { class: 'launch-ai' }, outline(6));
      sheet('Which AI should do the work?', body, () => { if (connected && onDone) void onDone(); });
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
        field('Your Anthropic key', key, KEY_LINE), haiku.keyHint ? note(haiku.keyHint) : null, consent.node,
        sonnet.consentText !== haiku.consentText ? h('p', { class: 'launch-consent-text' }, sonnet.consentText) : null,
        actions(connect), status));
    }
    function presetRow(preset, done) {
      const status = statusLine();
      const summary = h('summary', {}, h('span', { class: 'launch-row-title' }, preset.label), ' ', h('span', { class: 'launch-label' }, AVAILABILITY_WORDS[preset.availability] || preset.availability), ' ', h('span', { class: 'launch-row-note' }, preset.availabilityReason));
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
      return h('details', { class: 'launch-preset', 'data-preset': preset.id }, summary, h('div', { class: 'launch-more-body' },
        preset.runsOn === 'this-computer' ? note('Uses your own sign-in on this computer.') : null,
        key ? field(`Your ${preset.label} key`, key, KEY_LINE) : null,
        key && preset.keyHint ? note(preset.keyHint) : null,
        model ? field('Model id, as your account shows it', model) : null,
        consent.node, actions(connect), status));
    }

    // ---------------------------------------------------------------------------------------------
    // The seven places
    // ---------------------------------------------------------------------------------------------
    function noVenture() {
      return page(head(null, 'Start with your idea'), note('This workspace has no business yet.'),
        actions(filled('Describe your idea', () => { onboarding().vaultOpen = true; void showIdea(); })));
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
      const [runs, invoices, books, events] = await Promise.all([
        settle(request('venture.delivery.list')), settle(request('venture.invoice.list')), settle(request('venture.books.summary', {})), settle(lastEvents(6))]);
      const waiting = [];
      for (const run of runs.value || []) {
        if (run.status === 'waiting-for-you') waiting.push(row({ mark: 'wait', title: 'A draft reply waits for your approval', side: quiet('Review', () => navigate('agents')) }));
        else if (run.status === 'ready-for-review') waiting.push(row({ mark: 'wait', title: run.practice ? 'A practice draft is ready to review' : 'A draft reply is ready to review', side: quiet('Review', () => navigate('agents')) }));
      }
      for (const invoice of invoices.value || []) if (invoice.status === 'draft') waiting.push(row({ mark: 'wait', title: 'A draft invoice is ready to issue', side: quiet('Review', () => navigate('clients')) }));
      const shown = waiting.slice(0, 4);
      if (view.next) shown.push(row({ mark: 'now', title: view.next.label, note: 'next step', side: quiet('Open', () => goToItem({ id: view.next.item, place: view.next.place })) }));
      const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      return page(head(today, 'Today'),
        section('Awaiting you', shown.length ? rows(...shown) : note('Nothing awaits you.')),
        section('Launch checklist',
          h('p', { class: 'launch-count' }, h('span', { class: 'launch-fig' }, `${view.done} of ${view.total}`), ' ',
            h('span', { class: 'launch-strip', role: 'img', 'aria-label': `${view.done} of ${view.total} steps done` }, view.checklist.map(item => square(item.done ? 'you' : 'off')))),
          fold('See every step', false, rows(...view.checklist.map(item => row({ mark: item.done ? 'you' : 'off', title: item.label, note: item.done ? 'done' : 'not yet', side: item.done ? null : link('Open', () => goToItem(item)) }))))),
        section('Money', books.value ? moneyFigures(books.value) : note(plain(books.error?.message))),
        events.value?.length ? section('Earlier', h('ol', { class: 'launch-timeline' }, events.value.map(event => h('li', {}, square('cha'), h('span', { class: 'launch-time' }, timeText(event.at)), h('span', {}, EVENT_WORDS[event.name] || event.name))))) : null);
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
      const [clients, orders, invoices, blueprint] = await Promise.all([
        request('venture.client.list'), request('venture.order.list'), settle(request('venture.invoice.list')), settle(request('venture.blueprint.get'))]);
      const listed = orders.slice(0, 12);
      const receipts = await Promise.all(listed.map(order => settle(request('venture.receipt.get', { id: order.priceReceiptId }))));
      const names = Object.fromEntries(clients.map(client => [client.id, client.name]));
      const offers = blueprint.value?.blueprint?.status === 'accepted' ? blueprint.value.blueprint.offers : [];
      const offerName = id => offers.find(offer => offer.id === id)?.name.value || id;
      const ctx = { view, clients, offers };
      const orderNodes = listed.map((order, index) => orderRow(order, {
        client: names[order.clientId] || 'A client', offer: offerName(order.offerId), receipt: receipts[index].value,
        invoice: (invoices.value || []).find(invoice => invoice.orderId === order.id && invoice.status !== 'void') || null,
      }));
      return page(head(null, 'Clients'),
        section('Clients', clients.length ? rows(...clients.map(client => row({ mark: 'you', title: client.name, note: [client.email, client.countryCode].filter(Boolean).join(' · ') || null }))) : note('No clients yet.'),
          actions(quiet('Add client', () => openClientSheet(ctx)))),
        section('Orders', orderNodes.length ? h('div', { class: 'launch-rows' }, orderNodes) : note(offers.length ? 'No orders yet.' : 'Accept your plan first, then add orders.'),
          clients.length && offers.length ? actions(quiet('New order', () => openOrderSheet(ctx))) : null));
    }
    function orderRow(order, { client, offer, receipt, invoice }) {
      const total = figureOf(receipt, 'total');
      const body = h('div', { class: 'launch-more-body' });
      const status = statusLine();
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
        body.replaceChildren(note(order.request, 'launch-note launch-request'), actions(draft, deliver, invoiceButton), status);
      };
      paintActions();
      return h('details', { class: 'launch-order', 'data-order': order.id }, h('summary', {}, square(order.status === 'delivered' ? 'you' : 'wait'),
        h('span', { class: 'launch-row-title' }, `${client} · ${offer}`), ' ', h('span', { class: 'launch-row-note' }, ORDER_WORDS[order.status] || order.status), ' ',
        total ? h('span', { class: 'launch-fig' }, total.display) : null), body);
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
      dialog = sheet(view.invoice.number ? `Invoice ${view.invoice.number}` : 'Draft invoice', body, () => { if (onLaunchPage()) void navigate(state.page); });
    }

    async function renderAgents() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const [launchStatus, scenarios, runs, capabilities, models, playbook, orders, clients] = await Promise.all([
        settle(request('venture.launch.status')), settle(request('venture.simulation.scenarios')), settle(request('venture.delivery.list')),
        settle(request('venture.capabilities')), modelStatus(), settle(request('venture.delivery.playbook')),
        settle(request('venture.order.list')), settle(request('venture.client.list'))]);
      const titles = Object.fromEntries((scenarios.value || []).map(scenario => [scenario.id, scenario.title]));
      const rehearsal = launchStatus.value?.rehearsal?.length
        ? launchStatus.value.rehearsal
        : (scenarios.value || []).filter(scenario => scenario.source === 'template').map(scenario => ({ scenarioId: scenario.id, runId: null, passed: null, judged: false }));
      const stored = await Promise.all(rehearsal.map(entry => (entry.runId ? settle(request('venture.simulation.get', { runId: entry.runId })) : Promise.resolve({ value: null }))));
      const rowHosts = {};
      const rehearsalRows = rehearsal.map((entry, index) => {
        const host = h('div', { class: 'launch-rehearsal', 'data-scenario': entry.scenarioId });
        rowHosts[entry.scenarioId] = host;
        paintRehearsal(host, entry.scenarioId, titles[entry.scenarioId] || entry.scenarioId, stored[index].value, entry);
        return host;
      });
      const ladderHost = h('div', { class: 'launch-ladder' });
      const paintLadder = status => ladderHost.replaceChildren(...ladderNodes(status));
      if (launchStatus.value) paintLadder(launchStatus.value); else ladderHost.replaceChildren(...errorNodes(launchStatus.error));
      const rehearseStatus = statusLine();
      const rehearse = filled('Rehearse', () => act(rehearse, rehearseStatus, async () => {
        for (const entry of rehearsal) {
          const host = rowHosts[entry.scenarioId];
          const title = titles[entry.scenarioId] || entry.scenarioId;
          try {
            const run = await busy(host, `Rehearsing with a practice client: ${title}`, () => request('venture.simulation.run', { scenarioIds: [entry.scenarioId] }), 2);
            paintRehearsal(host, entry.scenarioId, title, run, null);
          } catch (error) {
            if (error?.code === 'REQUEST_TIMEOUT') await recoverRehearsal(host, entry.scenarioId, title);
            else host.replaceChildren(row({ mark: 'unsure', title, extra: h('div', {}, ...errorNodes(error)) }));
          }
        }
        const fresh = await settle(request('venture.launch.status'));
        if (fresh.value) paintLadder(fresh.value);
      }));
      const clientOf = Object.fromEntries((orders.value || []).map(order => [order.id, (clients.value || []).find(client => client.id === order.clientId)?.name || 'A client']));
      const mainTier = models?.tiers?.main, fastTier = models?.tiers?.fast;
      const aiWords = servedByModel(models, 'main') || servedByModel(models, 'fast')
        ? `AI: ${presetName(mainTier?.presetId, mainTier?.model)} for drafts, ${presetName(fastTier?.presetId, fastTier?.model)} for quick work.`
        : 'No AI connected. Built-in templates write outlines.';
      const capabilityNodes = capabilities.value
        ? [rows(...capabilities.value.map(item => row({ mark: item.state === 'available' ? 'cha' : 'off', title: item.label, note: CAPABILITY_WORDS[item.state] || item.state, extra: h('p', { class: 'launch-row-more' }, item.reason) })))]
        : errorNodes(capabilities.error);
      return page(head(`Stage: ${STAGE_WORDS[view.venture.launchStage] || view.venture.launchStage}`, 'Agents'),
        h('p', {}, aiWords, ' ', link(servedByModel(models) ? 'Change' : 'Add your AI', () => openAiSheet(reread))), recordingNote(models),
        section('Rehearsal', h('div', { class: 'launch-rows' }, rehearsalRows), actions(rehearse), rehearseStatus),
        section('Launch', ladderHost),
        section('Draft replies', (runs.value || []).length ? rows(...runs.value.slice(0, 5).map(run => row({
          mark: run.status === 'waiting-for-you' || run.status === 'ready-for-review' ? 'wait' : 'you', title: clientOf[run.orderId] || 'A client',
          note: `${RUN_WORDS[run.status] || run.status}${run.practice ? ', practice' : ''}${run.servedBy === 'template' ? ', outline' : ''}`,
          side: quiet('Review', () => openRunSheet(run, clientOf[run.orderId] || 'A client', models)),
        }))) : note(runs.error ? plain(runs.error.message) : 'No draft replies yet. Draft one from an order on Clients.')),
        fold('How an agent works', false, ...(playbook.value ? [rows(...playbook.value.steps.map(step => row({ mark: step.doneBy === 'you' ? 'you' : 'cha', title: step.title, note: DONE_BY[step.doneBy] || step.doneBy })))] : errorNodes(playbook.error))),
        fold('What agents can do today', false, ...capabilityNodes));
    }
    function paintRehearsal(host, scenarioId, title, run, entry) {
      if (!run) {
        host.replaceChildren(row({ mark: entry?.passed ? 'cha' : 'off', title, note: entry?.runId ? (entry.passed ? 'passed' : 'failed') : 'not rehearsed yet' }));
        return;
      }
      const episodes = (run.episodes || []).filter(episode => episode.scenarioId === scenarioId);
      const passed = episodes.length ? episodes.every(episode => episode.passed) : run.passed;
      const failure = episodes.find(episode => !episode.passed)?.firstFailure;
      host.replaceChildren(row({
        mark: passed ? 'cha' : 'unsure', title, note: passed ? 'passed' : `failed: ${failure || 'a check failed'}`,
        side: h('span', { class: 'launch-fig' }, run.costDisplay),
        extra: run.modelMode === 'template' ? h('p', { class: 'launch-row-more' }, 'Template outline, not judged') : null,
      }));
    }
    async function recoverRehearsal(host, scenarioId, title) {
      try {
        const status = await request('venture.launch.status');
        const entry = (status.rehearsal || []).find(item => item.scenarioId === scenarioId);
        if (!entry?.runId) { host.replaceChildren(row({ mark: 'wait', title, extra: h('div', {}, ...errorNodes({ code: 'REQUEST_TIMEOUT' }, () => recoverRehearsal(host, scenarioId, title))) })); return; }
        paintRehearsal(host, scenarioId, title, await request('venture.simulation.get', { runId: entry.runId }), entry);
      } catch (error) { host.replaceChildren(row({ mark: 'unsure', title, extra: h('div', {}, ...errorNodes(error)) })); }
    }
    function ladderNodes(status) {
      const at = STAGE_ORDER.indexOf(status.stage);
      const next = STAGE_ORDER[at + 1];
      const result = statusLine();
      return [rows(...STAGE_ORDER.map((stage, index) => {
        const info = (status.stages || []).find(item => item.stage === stage) || { allowed: false, reason: '', status: 'available' };
        let side = null, words = null;
        if (stage === status.stage) words = 'current';
        else if (info.status === 'planned') words = 'planned';
        else if (index < at) words = 'done';
        if (stage === next && info.status !== 'planned') {
          if (info.allowed) {
            const move = quiet(`Move to ${STAGE_WORDS[stage].toLowerCase()}`, () => act(move, result, async () => { await request('venture.launch.advance', { to: stage }); await reread(); }));
            side = move;
          } else words = info.reason;
        }
        return row({ mark: stage === status.stage ? 'now' : index < at ? 'you' : 'off', title: STAGE_WORDS[stage], note: words, side });
      })), result];
    }

    /** The draft reply sheet. In a demo with recordings it says, above the payload and the draft, that a synthetic recording answers. */
    async function openRunSheet(run, client, knownModels = null) {
      const models = knownModels || await modelStatus();
      const replay = replaying(models);
      const body = h('div', { class: 'launch-run' });
      const paint = current => {
        const status = statusLine();
        const parts = [];
        if (current.practice) parts.push(warn(PRACTICE_LINE));
        if (current.status === 'waiting-for-you' && current.preview) {
          const model = presetName(current.preview.presetId, current.preview.model);
          const agree = h('input', { type: 'checkbox' });
          const approve = filled('Approve and send', () => act(approve, status, async () => {
            let next;
            try {
              next = await busy(body, `Writing a draft reply ${writtenBy(models, current.preview.presetId, current.preview.model)}`, () => request('venture.delivery.approve', { runId: current.id, digest: current.preview.digest }));
            } catch (error) {
              if (error?.code !== 'REQUEST_TIMEOUT') throw error;
              const list = await request('venture.delivery.list');
              next = (list || []).find(item => item.id === current.id);
              if (!next || next.status === 'waiting-for-you') throw error;
            }
            paint(next);
          }), { disabled: true });
          agree.addEventListener('change', () => { approve.disabled = !agree.checked; });
          parts.push(recordingNote(models),
            note(replay ? `This is exactly what Chausar would send to ${model}. In this demo a synthetic recording answers instead.` : `This is exactly what will be sent to ${model}`, 'launch-strong'),
            h('pre', { class: 'launch-pre' }, current.preview.payloadText),
            note(`Most it can cost: ${current.preview.estimatedMaxCostDisplay}. This approval runs out at ${timeText(current.preview.expiresAt)}.`),
            h('label', { class: 'launch-check' }, agree, h('span', {}, replay ? 'Approve this exact text once.' : 'Send this exact text once.')), actions(approve), status);
        } else {
          const text = current.editedText || current.renderedText || '';
          if (current.servedBy === 'template' && !text.startsWith(OUTLINE_LINE)) parts.push(note(OUTLINE_LINE, 'launch-strong'));
          if (current.servedBy === 'model') parts.push(recordingNote(models));
          if (text) parts.push(h('pre', { class: 'launch-pre' }, text));
          if (current.checks?.length) parts.push(fold('Checks', false, rows(...current.checks.map(check => row({ mark: check.passed ? 'cha' : 'unsure', title: CHECK_WORDS[check.check] || check.check, note: check.passed ? 'passed' : check.detail })))));
          if (current.status === 'ready-for-review') parts.push(...reviewControls(current, status, paint));
          else if (current.verdict) parts.push(note(`You ${current.verdict.choice} this draft${current.verdict.reason ? `: ${(REASON_WORDS.find(([id]) => id === current.verdict.reason) || [])[1] || current.verdict.reason}` : ''}.`));
          else if (current.status === 'failed') parts.push(note('This draft failed. Draft it again from the order.'));
          if (!current.practice && (current.status === 'accepted' || current.status === 'edited') && text) {
            parts.push(actions(quiet('Copy', () => act(null, status, async () => { await copyText(text); status.replaceChildren(note('Copied.')); })),
              quiet('Save', () => saveText('draft-reply.txt', text, 'text/plain'))));
          }
          parts.push(status);
        }
        fill(body, ...parts);
      };
      paint(run);
      sheet(`Draft reply for ${client}`, body, () => { if (onLaunchPage()) void navigate(state.page); });
    }
    function reviewControls(run, status, paint) {
      const editHost = h('div');
      const review = (payload, button) => act(button, status, async () => { paint(await request('venture.delivery.review', { runId: run.id, ...payload })); });
      // The engine refuses Accept on a practice draft and after any failed check, so the sheet only offers it when it can work.
      const failedCheck = (run.checks || []).some(check => !check.passed);
      const accept = run.practice || failedCheck ? null : filled('Accept', () => review({ verdict: 'accepted' }, accept));
      const edit = quiet('Edit', () => {
        const text = h('textarea', { rows: 10, maxlength: 20000, value: run.renderedText || '' });
        const save = quiet('Save edit', () => review({ verdict: 'edited', editedText: text.value }, save));
        editHost.replaceChildren(field('Your edit', text), actions(save));
      });
      const reasons = picker(REASON_WORDS, 'other');
      const reject = quiet('Reject', () => review({ verdict: 'rejected', reason: reasons.value }, reject));
      return [failedCheck && !run.practice ? note("A check failed, so this draft can't be accepted as it is. Edit it or reject it.") : null,
        actions(accept, edit), editHost, h('div', { class: 'launch-reject' }, field('Why reject it', reasons), actions(reject))];
    }

    async function renderMoney() {
      const view = await ventureOrNull();
      if (!view) return noVenture();
      const summary = await request('venture.books.summary', {});
      return page(head(`${dayText(summary.period.from)} to ${dayText(summary.period.to)}`, 'Money'),
        moneyFigures(summary),
        summary.notes?.[0] ? note(summary.notes[0]) : null,
        experimental() ? warn(EXPERIMENTAL) : null,
        section('Open invoices', summary.openInvoices.length ? rows(...summary.openInvoices.map(item => row({
          mark: 'wait', title: `${item.number} · ${item.clientName}`, note: `due ${dayText(item.dueDate)}`,
          side: h('button', {
            class: 'launch-fig-btn', type: 'button',
            onclick: async () => { try { openInvoiceSheet(await request('venture.invoice.get', { invoiceId: item.invoiceId })); } catch (error) { sheet('Invoice', h('div', {}, ...errorNodes(error))); } },
          }, item.balanceDisplay),
        }))) : note('No open invoices.')),
        actions(link('See the books in the back office', () => navigate('brief'))));
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
      return page(head(`${cards.length} tools, each with what Chausar does today`, 'Connections'),
        section('Start with these', h('div', { class: 'launch-rows' }, starters.map(connectorCard))),
        section('Every group', ...groups.map(group => fold(`${group.label} · ${group.cards.length}`, false, h('div', { class: 'launch-rows' }, group.cards.map(connectorCard))))));
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
          ...card.modes.map(mode => note(`${mode.status === 'planned' ? 'Planned: ' : ''}${mode.mode}. ${mode.what}`)))),
        h('span', { class: 'launch-chips' }, card.chips.map(chip)),
        h('span', { class: 'launch-card-actions' }, open, visit), status);
    }

    // ---------------------------------------------------------------------------------------------
    // Entry points app.js calls
    // ---------------------------------------------------------------------------------------------
    /** The vault is open: resume onboarding when there is no business yet, else open Today. */
    async function afterOpen() {
      let view;
      try { view = await request('venture.get'); }
      catch { state.page = 'today'; renderShell(); return; }
      if (!view) { onboarding().vaultOpen = true; await showIdea(); return; }
      state.venture = view;
      state.page = 'today';
      renderShell();
    }

    const views = Object.freeze({
      today: renderToday, business: renderBusiness, build: renderBuild, clients: renderClients,
      agents: renderAgents, money: renderMoney, connections: renderConnections,
    });
    return Object.freeze({ pages, views, firstRun, afterOpen });
  },
});
