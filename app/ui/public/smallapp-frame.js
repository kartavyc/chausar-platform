/*
 * The small-app frame renderer (TL-02). Chausar's own fixed script, the only code that runs in the
 * locked frame (an iframe with sandbox="allow-scripts" and no allow-same-origin, on a unique opaque
 * origin). A small app carries no code: the host posts a declarative view and this draws it with
 * text nodes only (never markup), then posts back exactly four kinds of message on the frame's
 * channel: ready, size, receipt (a figure was pressed), book (open the follow-up book) and press
 * (an action card's form, one plain value per field). The host checks every message again.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var channel = root.getAttribute('data-channel') || '';
  var main = document.getElementById('app');
  if (!/^[a-f0-9]{32}$/.test(channel) || !main || window.parent === window) return;
  var statuses = {};

  function send(message) { message.channel = channel; window.parent.postMessage(message, '*'); }
  function text(value, max) { return typeof value === 'string' && value.length <= (max || 4000) ? value : ''; }
  function el(tag, content, style) {
    var node = document.createElement(tag);
    if (content) node.textContent = content;
    if (style) for (var key in style) if (Object.prototype.hasOwnProperty.call(style, key)) node.style.setProperty(key, style[key]);
    return node;
  }
  var S = {
    card: { display: 'flex', 'flex-direction': 'column', gap: 'var(--sp1, 4px)', 'padding-bottom': 'var(--sp3, 12px)', 'border-bottom': '1px solid var(--line, #E9ECEE)' },
    title: { margin: '0', 'font-size': 'var(--fs-note, 14px)', 'font-weight': '500', color: 'var(--fg2, #3B4247)' },
    note: { margin: '0', 'font-size': 'var(--fs-note2, 13px)', color: 'var(--mute, #646B71)' },
    figure: { 'font-family': 'var(--font-mono, monospace)', 'font-size': 'var(--fs-read, 16px)', color: 'var(--fg, #0B0D0E)', background: 'none', border: '0', padding: '0', cursor: 'pointer', 'text-align': 'left', 'text-decoration': 'underline dotted' },
    row: { display: 'grid', 'grid-template-columns': 'minmax(6em, 1fr) 2fr auto', gap: 'var(--sp2, 8px)', 'align-items': 'center' },
    track: { height: '8px', background: 'var(--line, #E9ECEE)', 'border-radius': '0 4px 4px 0' },
    button: { 'align-self': 'flex-start', 'font-size': 'var(--fs-note, 14px)', padding: '4px 12px', border: '1px solid var(--line2, #D5DADE)', background: 'var(--bg, #F7F8F8)', color: 'var(--fg, #0B0D0E)', cursor: 'pointer', 'min-height': '24px' },
    field: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'font-size': 'var(--fs-note2, 13px)', color: 'var(--fg2, #3B4247)' },
    input: { 'font-size': 'var(--fs-note, 14px)', padding: '4px', border: '1px solid var(--line2, #D5DADE)', background: 'var(--bg, #F7F8F8)', color: 'var(--fg, #0B0D0E)' },
  };

  function figureButton(item) {
    var b = el('button', text(item.display, 200), S.figure);
    b.type = 'button';
    b.setAttribute('aria-label', text(item.label, 200) + ' ' + text(item.display, 200));
    b.addEventListener('click', function () { send({ type: 'receipt', receiptId: text(item.receiptId, 200) }); });
    return b;
  }
  function value(v) {
    var box = el('div', '', { display: 'flex', 'flex-direction': 'column', gap: '2px' });
    if (!v || typeof v !== 'object') return box;
    if (v.kind === 'missing') {
      box.appendChild(el('p', text(v.words, 500), S.note));
      if (typeof v.receiptId === 'string') {
        var open = el('button', text(v.open, 200), S.button); open.type = 'button';
        open.addEventListener('click', function () { send({ type: 'receipt', receiptId: v.receiptId }); });
        box.appendChild(open);
      }
      return box;
    }
    var items = Array.isArray(v.items) ? v.items.slice(0, 20) : [];
    for (var i = 0; i < items.length; i++) {
      if (items.length > 1) box.appendChild(el('span', text(items[i].label, 200), S.note));
      box.appendChild(figureButton(items[i]));
    }
    if (v.note) box.appendChild(el('p', text(v.note, 500), S.note));
    return box;
  }
  function chart(card, node) {
    var list = el('div', '', { display: 'flex', 'flex-direction': 'column', gap: 'var(--sp2, 8px)' });
    list.setAttribute('role', 'list');
    var bars = Array.isArray(card.bars) ? card.bars.slice(0, 20) : [];
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i], row = el('div', '', S.row);
      row.setAttribute('role', 'listitem');
      row.appendChild(el('span', text(bar.label, 200), S.note));
      var track = el('div', '', { position: 'relative', height: '8px' });
      var share = typeof bar.share === 'number' && bar.share >= 0 && bar.share <= 1000 ? bar.share : 0;
      var fill = el('div', '', S.track);
      fill.style.setProperty('width', (share / 10) + '%');
      fill.style.setProperty('background', 'var(--fg2, #3B4247)');
      fill.setAttribute('aria-hidden', 'true');
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(value(bar.value));
      list.appendChild(row);
    }
    node.appendChild(list);
    if (card.caption) node.appendChild(el('p', text(card.caption, 300), S.note));
  }
  function action(card, node) {
    node.appendChild(el('p', text(card.note, 500), S.note));
    if (card.press !== true) return;
    var form = el('form', '', { display: 'flex', 'flex-direction': 'column', gap: 'var(--sp2, 8px)' });
    form.setAttribute('novalidate', '');
    var fields = Array.isArray(card.fields) ? card.fields.slice(0, 64) : [];
    var inputs = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], label = el('label', '', S.field), input;
      label.appendChild(el('span', text(f.label, 200)));
      if (f.kind === 'choice') {
        input = el('select', '', S.input);
        input.appendChild(el('option', text(card.pick, 100)));
        input.options[0].value = '';
        var options = Array.isArray(f.options) ? f.options.slice(0, 64) : [];
        for (var j = 0; j < options.length; j++) { var o = el('option', text(options[j], 200)); o.value = text(options[j], 200); input.appendChild(o); }
      } else if (f.kind === 'yesno') {
        input = el('input'); input.type = 'checkbox';
        label.appendChild(el('span', text(card.yes, 100), S.note));
      } else {
        input = el('input', '', S.input);
        input.type = f.kind === 'date' ? 'date' : 'text';
        if (f.kind === 'rupees') input.inputMode = 'decimal';
        if (f.kind === 'whole') input.inputMode = 'numeric';
        if (typeof f.maxLength === 'number') input.maxLength = f.maxLength;
        input.autocomplete = 'off';
      }
      input.name = text(f.name, 64);
      label.appendChild(input);
      if (f.hint) label.appendChild(el('span', text(f.hint, 200), S.note));
      inputs.push({ field: f, input: input });
      form.appendChild(label);
    }
    var submit = el('button', text(card.button, 200), S.button); submit.type = 'submit';
    form.appendChild(submit);
    var status = el('p', '', S.note); status.setAttribute('role', 'status');
    statuses[card.id] = status;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var typed = {};
      for (var k = 0; k < inputs.length; k++) {
        var x = inputs[k];
        if (x.field.kind === 'yesno') typed[x.field.name] = x.input.checked === true;
        else if (x.input.value !== '') typed[x.field.name] = String(x.input.value).slice(0, 4000);
      }
      send({ type: 'press', cardId: text(card.id, 200), fields: typed });
    });
    node.appendChild(form);
    node.appendChild(status);
  }
  function records(card, node) {
    if (card.empty) node.appendChild(el('p', text(card.empty, 300), S.note));
    var list = el('ul', '', { margin: '0', 'padding-left': '16px', 'font-size': 'var(--fs-note, 14px)', color: 'var(--fg2, #3B4247)' });
    var lines = Array.isArray(card.lines) ? card.lines.slice(0, 2000) : [];
    for (var i = 0; i < lines.length; i++) list.appendChild(el('li', text(lines[i], 400)));
    node.appendChild(list);
    var open = el('button', text(card.open, 200), S.button); open.type = 'button';
    open.addEventListener('click', function () { send({ type: 'book', cardId: text(card.id, 200) }); });
    node.appendChild(open);
  }
  function render(view) {
    statuses = {};
    while (main.firstChild) main.removeChild(main.firstChild);
    main.style.setProperty('display', 'flex');
    main.style.setProperty('flex-direction', 'column');
    main.style.setProperty('gap', 'var(--sp3, 12px)');
    main.style.setProperty('padding', 'var(--sp2, 8px)');
    if (!view || typeof view !== 'object') return;
    if (view.empty) main.appendChild(el('p', text(view.empty, 300), S.note));
    var cards = Array.isArray(view.cards) ? view.cards.slice(0, 20) : [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card || typeof card !== 'object') continue;
      var node = el('section', '', S.card);
      node.setAttribute('aria-label', text(card.label, 200));
      node.appendChild(el('h3', text(card.label, 200), S.title));
      if (card.kind === 'metric') node.appendChild(value(card.value));
      else if (card.kind === 'chart') chart(card, node);
      else if (card.kind === 'action') action(card, node);
      else if (card.kind === 'records') records(card, node);
      main.appendChild(node);
    }
    size();
  }
  var lastHeight = -1;
  function size() {
    var height = Math.min(20000, Math.ceil(document.documentElement.scrollHeight || 0));
    if (height !== lastHeight) { lastHeight = height; send({ type: 'size', height: height }); }
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== channel) return;
    if (data.type === 'render') render(data.view);
    else if (data.type === 'pressed' && typeof data.cardId === 'string' && statuses[data.cardId]) { statuses[data.cardId].textContent = text(data.words, 500); size(); }
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(size).observe(document.body);
  send({ type: 'ready' });
}());
