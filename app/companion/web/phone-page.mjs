// PH-04 "The phone page" — EXPERIMENTAL, off unless the host switches it on.
// Renders the shared display model (app/companion/shared/phone-page.ts) only:
// headlines, row titles, a count and the laptop's last-seen time. No summary,
// figure or receipt reaches this page. Approve appears only on rows the display
// model marks 'approve' (online, fresh list, engine hint 'simple-reversible').

/**
 * @param {{ document: Document, view: any, words: Record<string, string>, busy: boolean,
 *   formatTime: (iso: string) => string, formatCount: (count: number) => string,
 *   actions: { refresh: () => unknown, approve: (approvalId: string) => unknown, confirm: () => unknown, notNow: () => unknown },
 *   run: (action: () => unknown) => void }} input
 */
export function renderPhonePage({ document, view, words, busy, formatTime, formatCount, actions, run }) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (text, action, options = {}) => {
    const node = element('button', options.className, text); node.type = 'button'; node.disabled = !!options.disabled;
    if (options.id) node.id = options.id;
    if (options.label) node.setAttribute('aria-label', options.label);
    node.addEventListener('click', () => run(action)); return node;
  };
  const root = element('div', 'phone-page');
  root.dataset.experimental = 'true';
  const title = element('h1', '', words.title); title.id = 'screen-title'; title.tabIndex = -1;
  const badge = element('p', 'note warning phone-experimental', words.experimental); badge.id = 'phone-page-experimental';
  const heading = element('div', 'screen-heading'); heading.append(title);
  root.append(heading, badge);
  if (view.readOnly) root.append(element('p', 'note phone-readonly', words.savedReadOnly));
  const controls = element('div', 'actions');
  controls.append(button(words.refresh, actions.refresh, { disabled: busy, id: 'phone-page-refresh' }));
  root.append(controls);

  // Awaiting your review: count + rows. A row may take two lines (CSS clamp).
  const review = element('section', 'card phone-review'); review.setAttribute('aria-labelledby', 'phone-review-title');
  const reviewHead = element('div', 'row');
  const reviewTitle = element('h2', '', words.awaiting); reviewTitle.id = 'phone-review-title';
  reviewHead.append(reviewTitle);
  if (view.review.status === 'loaded') { const count = element('span', 'pill phone-count', formatCount(view.review.count)); count.id = 'phone-review-count'; reviewHead.append(count); }
  review.append(reviewHead);
  if (view.review.status === 'unavailable') review.append(element('p', 'subtle', words.reviewUnavailable));
  else if (view.review.status === 'not-loaded') review.append(element('p', 'subtle', words.reviewNotLoaded));
  else if (!view.review.rows.length) review.append(element('p', 'subtle', words.nothingAwaiting));
  else {
    const list = element('ul', 'phone-rows');
    for (const row of view.review.rows) {
      const item = element('li', 'phone-row'); item.dataset.approvalId = row.approvalId;
      item.append(element('span', 'phone-row-title', row.title));
      const confirming = view.confirm && view.confirm.approvalId === row.approvalId;
      if (row.action === 'approve' && !confirming) item.append(button(words.approve, () => actions.approve(row.approvalId), { className: 'primary', disabled: busy, label: `${words.approve}: ${row.title}` }));
      else if (row.action !== 'approve') item.append(element('span', 'pill phone-in-app', words.inTheApp));
      list.append(item);
      if (confirming) {
        const confirm = element('div', 'confirm phone-confirm'); confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', words.confirmQuestion);
        confirm.append(element('h3', '', words.confirmQuestion), element('p', 'phone-row-title', view.confirm.title), element('p', 'small muted', words.confirmHelp));
        const buttons = element('div', 'actions');
        buttons.append(button(words.confirmApprove, actions.confirm, { className: 'primary', disabled: busy || view.confirm.expired, id: 'phone-confirm-approve' }),
          button(words.notNow, actions.notNow, { disabled: busy, id: 'phone-confirm-not-now' }));
        confirm.append(buttons); list.append(confirm);
      }
    }
    review.append(list);
  }
  root.append(review);

  // The week ahead: at most three headlines, already digit-checked by the model.
  const week = element('section', 'card phone-week'); week.append(element('h2', '', words.weekAhead));
  if (view.weekAhead.length) { const list = element('ol', 'phone-headlines'); view.weekAhead.forEach(text => list.append(element('li', '', text))); week.append(list); }
  else week.append(element('p', 'subtle', words.weekAheadEmpty));
  root.append(week);

  const seen = element('p', 'small muted phone-last-seen'); seen.id = 'phone-last-seen';
  seen.textContent = `${words.laptopSeen}: ${view.lastSeen.known ? formatTime(view.lastSeen.at) : words.notKnown}`;
  root.append(seen, element('p', 'screen-footer', words.rule));
  return root;
}
