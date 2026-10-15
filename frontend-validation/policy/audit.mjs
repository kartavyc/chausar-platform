// The in-page audit. `auditInPage` is serialized into the page by Playwright, so it must not
// close over anything: every helper lives inside it. It reads computed styles and boxes only.
export function auditInPage(input) {
  const { policy, view, language, theme, sheetExpected, notBuiltTexts } = input;
  const rules = policy.rules;
  const findings = [];
  const warnings = [];
  const root = document.documentElement;
  const tokenColour = name => getComputedStyle(root).getPropertyValue(`--${name}`).trim();

  /* ---------------------------------------------------------------- helpers */
  const describe = el => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth++) {
      const tag = node.tagName.toLowerCase();
      const region = node.getAttribute && node.getAttribute('data-region');
      const classes = typeof node.className === 'string' ? node.className.split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
      parts.unshift(`${tag}${region ? `[data-region=${region}]` : ''}${classes}`);
      if (region) break;
      node = node.parentElement;
    }
    const text = (el.textContent || el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${parts.join(' > ')}${text ? ` "${text}"` : ''}`;
  };
  const styleCache = new Map();
  const style = el => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  const renderedCache = new Map();
  /** Laid out, visible, not visually hidden, not fully clipped by an overflow-hidden ancestor. */
  const rendered = el => {
    if (renderedCache.has(el)) return renderedCache.get(el);
    let result = true;
    if (!el.isConnected || el.getClientRects().length === 0) result = false;
    // The content of a closed <details> keeps its boxes in Chromium (content-visibility: hidden) but is not shown.
    else if ((el.checkVisibility && !el.checkVisibility()) || el.closest('details:not([open]) > :not(summary)')) result = false;
    else {
      const s = style(el);
      const rect = el.getBoundingClientRect();
      if (s.visibility !== 'visible' || Number(s.opacity) === 0) result = false;
      else if (rect.width <= 1 && rect.height <= 1) result = false;
      else if (s.clipPath && s.clipPath.startsWith('inset(50%')) result = false;
      else {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const as = style(a);
          if (Number(as.opacity) === 0) { result = false; break; }
          if (as.clipPath && as.clipPath.startsWith('inset(50%')) { result = false; break; }
          if (as.overflowX !== 'visible' || as.overflowY !== 'visible') {
            const ar = a.getBoundingClientRect();
            if (rect.right <= ar.left || rect.left >= ar.right || rect.bottom <= ar.top || rect.top >= ar.bottom) {
              // Outside a scroll container is still reachable by scrolling; outside a clip is gone.
              if (['hidden', 'clip'].includes(as.overflowX) || ['hidden', 'clip'].includes(as.overflowY)) { result = false; break; }
            }
          }
        }
      }
    }
    renderedCache.set(el, result);
    return result;
  };
  const parseColour = value => {
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(String(value).trim());
    if (!match) return null;
    let alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const backgroundBehind = el => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const colour = parseColour(style(node).backgroundColor);
      if (colour && colour[3] > 0) { layers.push(colour); if (colour[3] >= 1) break; }
    }
    let result = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
    return result;
  };
  const luminance = ([r, g, b]) => {
    const channel = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const hex = colour => `#${colour.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const sameColour = (colour, token) => { const t = parseColour(token) ?? (/^#[0-9a-f]{6}$/i.test(token) ? [parseInt(token.slice(1, 3), 16), parseInt(token.slice(3, 5), 16), parseInt(token.slice(5, 7), 16), 1] : null); return t !== null && colour && Math.abs(colour[0] - t[0]) + Math.abs(colour[1] - t[1]) + Math.abs(colour[2] - t[2]) < 3; };
  const disabled = el => !!el.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]');
  const add = (rule, el, detail) => findings.push({ rule, element: el ? describe(el) : null, detail });

  /* ---------------------------------------------------------------- visible text */
  const textParents = new Set();
  const textOf = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(parent.tagName)) continue;
    if (!rendered(parent)) continue;
    textParents.add(parent);
    textOf.set(parent, `${textOf.get(parent) ?? ''}${text}`);
  }
  const visibleText = container => {
    if (!container) return '';
    let out = '';
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = w.nextNode(); node; node = w.nextNode()) {
      const parent = node.parentElement;
      if (parent && textParents.has(parent)) out += ` ${node.nodeValue}`;
    }
    return out.replace(/\s+/g, ' ').trim();
  };
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  const words = text => [...segmenter.segment(text)].filter(part => part.isWordLike).length;

  /* ---------------------------------------------------------------- reading size */
  const sizes = rules.textSize;
  const rootSize = parseFloat(style(root).fontSize);
  if (Math.abs(rootSize - sizes.readingPx[view]) > sizes.tolerancePx) add('reading-size', root, `The page reads at ${rootSize}px; ${view} reads at ${sizes.readingPx[view]}px.`);

  /* ---------------------------------------------------------------- text size and contrast */
  const allowed = sizes.allowedPx[view];
  const contrast = rules.contrast;
  for (const el of textParents) {
    const s = style(el);
    const size = parseFloat(s.fontSize);
    if (size + sizes.tolerancePx < sizes.minimumPx[view]) add('text-size-minimum', el, `${size}px is below ${sizes.minimumPx[view]}px.`);
    else if (!allowed.some(value => Math.abs(value - size) <= sizes.tolerancePx)) add('text-size-token', el, `${size}px is not a ${view} type token (${allowed.join(', ')}).`);
    if (disabled(el)) continue;
    const svgText = el instanceof SVGElement;
    const colour = parseColour(svgText ? s.fill : s.color);
    if (!colour || colour[3] === 0) continue;
    const background = backgroundBehind(svgText ? (el.ownerSVGElement ?? el) : el);
    const foreground = colour[3] < 1 ? over(colour, background) : colour;
    const weight = Number(s.fontWeight) || 400;
    const large = size >= contrast.largeTextPx || (size >= contrast.largeBoldTextPx && weight >= contrast.boldWeight);
    const minimum = large ? contrast.largeTextMinimum : contrast.textMinimum;
    const value = ratio(foreground, background);
    if (value + 0.005 < minimum) add('contrast-text', el, `${value.toFixed(2)}:1 for ${hex(foreground)} on ${hex(background)} (needs ${minimum}:1${large ? ', large text' : ''}).`);
  }

  /* ---------------------------------------------------------------- non-text marks */
  const hairlines = [tokenColour('line'), tokenColour('line2')];
  const markMinimum = contrast.nonTextMinimum;
  // Hairlines (line, line2) are decoration in charts; a mark a person must see (a square, a step dot) gets no such exemption.
  const checkMark = (el, colour, behind, what, hairlineExempt = true) => {
    // The ring around a line's last point is drawn in the background colour on purpose (data-halo).
    if (el.closest?.('[data-halo]')) return;
    if (!colour || colour[3] === 0 || (hairlineExempt && hairlines.some(token => sameColour(colour, token)))) return;
    const shown = colour[3] < 1 ? over(colour, behind) : colour;
    const value = ratio(shown, behind);
    if (value + 0.005 < markMinimum) add('contrast-mark', el, `${what} ${value.toFixed(2)}:1 for ${hex(shown)} on ${hex(behind)} (needs ${markMinimum}:1).`);
  };
  for (const el of document.querySelectorAll('svg rect, svg path, svg circle, svg line, svg polyline, svg polygon, svg ellipse')) {
    if (!rendered(el) || disabled(el)) continue;
    const s = style(el);
    if (Number(s.fillOpacity) === 0 && Number(s.strokeOpacity) === 0) continue;
    const behind = backgroundBehind(el.ownerSVGElement ?? el);
    // A <line> has no interior: its default black fill is never painted.
    if (el.tagName.toLowerCase() !== 'line' && s.fill !== 'none' && Number(s.fillOpacity) > 0) checkMark(el, parseColour(s.fill), behind, 'fill');
    if (s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0 && Number(s.strokeOpacity) > 0) checkMark(el, parseColour(s.stroke), behind, 'stroke');
  }
  for (const el of document.querySelectorAll('span[aria-hidden="true"]:empty, i[aria-hidden="true"]:empty')) {
    if (!rendered(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 16 || rect.height > 16) continue;
    const s = style(el);
    const behind = backgroundBehind(el.parentElement ?? el);
    const fill = parseColour(s.backgroundColor);
    const border = parseFloat(s.borderTopWidth) > 0 ? parseColour(s.borderTopColor) : null;
    if (fill && fill[3] > 0 && !sameColour(fill, hex(behind))) checkMark(el, fill, behind, 'mark', false);
    else if (border) checkMark(el, border, behind, 'mark outline', false);
  }

  /* ---------------------------------------------------------------- control size */
  const control = rules.controlSize;
  const targets = [...document.querySelectorAll(control.selector)].filter(el => rendered(el) && !disabled(el) && !el.closest('[inert]'));
  const boxes = targets.map(el => ({ el, rect: el.getBoundingClientRect() }));
  const small = boxes.filter(({ rect }) => rect.width + 0.5 < control.minimumPx.width || rect.height + 0.5 < control.minimumPx.height);
  const smallSet = new Set(small.map(item => item.el));
  const centre = rect => [rect.left + rect.width / 2, rect.top + rect.height / 2];
  const radius = control.minimumPx.width / 2;
  for (const { el, rect } of small) {
    const s = style(el);
    // Inline exception: a link or control set inside a sentence of other text.
    if (s.display === 'inline' || s.display === 'contents') {
      const block = el.parentElement;
      const own = (el.textContent || '').trim().length;
      if (block && (block.textContent || '').trim().length > own + 1) continue;
    }
    // Spacing exception: a 24 px circle on the centre touches no other target or circle.
    const [cx, cy] = centre(rect);
    const crowded = boxes.some(other => {
      if (other.el === el || other.el.contains(el) || el.contains(other.el)) return false;
      if (smallSet.has(other.el)) { const [ox, oy] = centre(other.rect); return Math.hypot(cx - ox, cy - oy) < radius * 2; }
      const nx = Math.max(other.rect.left, Math.min(cx, other.rect.right)), ny = Math.max(other.rect.top, Math.min(cy, other.rect.bottom));
      return Math.hypot(cx - nx, cy - ny) < radius;
    });
    if (crowded) add('control-size', el, `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px, under ${control.minimumPx.width}x${control.minimumPx.height}px and not spaced.`);
  }
  const target = control.designTargetPx[view];
  if (target > control.minimumPx.width) {
    for (const { el, rect } of boxes) if ((rect.width + 0.5 < target || rect.height + 0.5 < target) && style(el).display !== 'inline') warnings.push({ rule: 'control-design-target', element: describe(el), detail: `${rect.width.toFixed(0)}x${rect.height.toFixed(0)}px, under the ${view} design target ${target}px.` });
  }

  /* ---------------------------------------------------------------- figures contained */
  const tolerance = rules.figures.tolerancePx;
  for (const el of document.querySelectorAll(rules.figures.selector)) {
    if (!rendered(el)) continue;
    const s = style(el);
    const rect = el.getBoundingClientRect();
    if ((['hidden', 'clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + tolerance) || s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + tolerance) {
      add('figure-clipped', el, `The figure needs ${el.scrollWidth}px and its box shows ${el.clientWidth}px.`); continue;
    }
    let parent = el.parentElement;
    while (parent && style(parent).display === 'contents') parent = parent.parentElement;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      if (rect.right > pr.right + tolerance || rect.left < pr.left - tolerance) { add('figure-overflow', el, `The figure spans ${rect.left.toFixed(0)}-${rect.right.toFixed(0)}px outside its box ${pr.left.toFixed(0)}-${pr.right.toFixed(0)}px.`); continue; }
    }
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = style(a);
      // A figure scrolled out of view inside its own scrolling box is not cut: the box scrolls to it.
      if (['auto', 'scroll'].includes(as.overflowY) || ['auto', 'scroll'].includes(as.overflowX)) break;
      if (!['hidden', 'clip'].includes(as.overflowX) && !['hidden', 'clip'].includes(as.overflowY)) continue;
      const ar = a.getBoundingClientRect();
      if (rect.right > ar.right + tolerance || rect.left < ar.left - tolerance || rect.bottom > ar.bottom + tolerance || rect.top < ar.top - tolerance) { add('figure-clipped', el, `A clipping box cuts the figure (${describe(a)}).`); break; }
    }
  }

  /* ---------------------------------------------------------------- words */
  const page = document.querySelector('[data-region="page"]');
  const status = document.querySelector('[data-region="status"]');
  const sheet = document.querySelector('[data-region="sheet"]');
  const atRestText = page ? `${visibleText(page)} ${visibleText(status)}` : visibleText(document.body);
  const columnPx = parseFloat(style(root).getPropertyValue('--col'));
  // A wide page (tables, the enterprise home) is what the frame says it is; a page that only
  // fills a narrow window is not a wide page. Without the frame's mark, the column's width decides.
  const frameEl = document.querySelector('[data-frame-wide]');
  const wide = view === 'guided' && page !== null && (frameEl !== null ? frameEl.getAttribute('data-frame-wide') === 'true' : page.getBoundingClientRect().width > columnPx + 1);
  const limitName = view === 'guided' ? (wide ? 'wide' : 'guided') : view;
  const atRest = words(atRestText);
  // Under 1024 an open sheet fills the window: the page under it is not on screen, so it is not at rest.
  const sheetCoversPage = sheet !== null && page !== null && rendered(sheet) && (() => { const sr = sheet.getBoundingClientRect(), pr = page.getBoundingClientRect(); return sr.left <= pr.left + 1 && sr.right >= pr.right - 1 && sr.top <= pr.top + 1 && sr.bottom >= pr.bottom - 1; })();
  if (atRest > rules.words.limits[limitName] && !sheetCoversPage) add('words', page ?? document.body, `${atRest} words at rest; the ${limitName} limit is ${rules.words.limits[limitName]}.`);
  const sheetWords = sheet ? words(visibleText(sheet)) : 0;
  if (sheet && sheetWords > rules.words.limits.sheet) add('words-sheet', sheet, `${sheetWords} words in the open sheet; the limit is ${rules.words.limits.sheet}.`);

  /* ---------------------------------------------------------------- button labels and punctuation */
  for (const el of document.querySelectorAll(rules.buttonLabels.selector)) {
    if (!rendered(el)) continue;
    const label = visibleText(el);
    if ([...label].length > rules.buttonLabels.maximumCharacters) add('button-label', el, `${[...label].length} characters: "${label}".`);
  }
  for (const [el, text] of textOf) {
    for (const mark of rules.punctuation.forbidden) if (text.includes(mark)) add('punctuation', el, `Contains ${mark === '—' ? 'an em dash' : `"${mark}"`}: "${text.trim().slice(0, 60)}".`);
  }

  /* ---------------------------------------------------------------- remote images */
  const remote = value => /(?:^|[\s,("'])(?:https?:)?\/\/(?!127\.0\.0\.1|localhost)/i.test(String(value));
  for (const el of document.querySelectorAll('img, source, image, video, use, input[type=image]')) {
    for (const name of ['src', 'srcset', 'href', 'xlink:href', 'poster']) { const value = el.getAttribute(name); if (value && remote(value)) add('remote-image', el, `${name}=${value.slice(0, 80)}`); }
  }
  for (const el of document.querySelectorAll('body *')) {
    const s = style(el);
    for (const property of ['backgroundImage', 'maskImage', 'listStyleImage', 'borderImageSource']) { const value = s[property]; if (value && value !== 'none' && /url\(/.test(value) && remote(value)) add('remote-image', el, `${property} ${value.slice(0, 80)}`); }
    /* ------------------------------------------------------------ motion */
    if (s.animationName && s.animationName !== 'none') {
      const counts = s.animationIterationCount.split(',').map(value => value.trim());
      if (counts.some(value => value === 'infinite' || Number(value) > 1)) add('animation-repeats', el, `animation ${s.animationName} repeats ${s.animationIterationCount}.`);
    }
    if (input.reducedMotion) {
      const longest = list => Math.max(0, ...list.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)));
      if (s.transitionProperty !== 'none' && longest(s.transitionDuration) + longest(s.transitionDelay) > 0) add('reduced-motion', el, `transition ${s.transitionProperty} ${s.transitionDuration} under reduced motion.`);
      if (s.animationName !== 'none' && longest(s.animationDuration) > 0) add('reduced-motion', el, `animation ${s.animationName} ${s.animationDuration} under reduced motion.`);
    }
  }
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && (timing.iterations === Infinity || timing.iterations > 1)) add('animation-repeats', animation.effect?.target ?? null, `A running animation repeats ${timing.iterations} times.`);
  }

  /* ---------------------------------------------------------------- layout at this window width */
  const layout = policy.rules.layout;
  if (layout) {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const tol = layout.tolerancePx;
    const scrollsX = s => ['auto', 'scroll'].includes(s.overflowX);
    const clipsX = s => ['hidden', 'clip'].includes(s.overflowX);
    const sheetEl = document.querySelector('[data-region="sheet"]');
    const pageEl = document.querySelector('[data-region="page"]');
    const railEl = document.querySelector('nav[data-region="rail"]');
    // The window, and the page's own column, never scroll sideways.
    const scroller = document.scrollingElement ?? document.documentElement;
    if (scroller.scrollWidth > vw + tol) add('page-scroll-x', null, `The window scrolls sideways: ${scroller.scrollWidth}px of content in ${vw}px.`);
    for (const region of [pageEl, sheetEl]) {
      if (region && rendered(region) && scrollsX(style(region)) && region.scrollWidth > region.clientWidth + tol) add('page-scroll-x', region, `The ${region.getAttribute('data-region')} scrolls sideways: ${region.scrollWidth}px of content in ${region.clientWidth}px.`);
    }
    // Nothing reaches past the window unless a box of its own (inside the page or the sheet) scrolls or clips it.
    const flagged = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (!rendered(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right <= vw + tol && rect.left >= -tol) continue;
      const s = style(el);
      // An off-screen technique (moved wholly out of the window on purpose) is not an overflow.
      if ((s.position === 'absolute' || s.position === 'fixed') && (rect.right <= 0 || rect.left >= vw)) continue;
      let excused = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = style(a);
        if (a === pageEl || a === sheetEl) break;
        if (scrollsX(as) || clipsX(as)) { const ar = a.getBoundingClientRect(); if (ar.right <= vw + tol && ar.left >= -tol) { excused = true; break; } }
      }
      if (excused) continue;
      if (el.parentElement && flagged.has(el.parentElement)) { flagged.add(el); continue; }
      flagged.add(el);
      add('overflow-viewport', el, `Spans ${rect.left.toFixed(0)}-${rect.right.toFixed(0)}px in a ${vw}px window.`);
    }
    // The rail: a column at the left from 1024, a bar across the top under it.
    if (railEl && rendered(railEl)) {
      const r = railEl.getBoundingClientRect();
      if (vw < layout.mediumFromPx) {
        if (r.width < vw - tol || r.left > tol || r.top > vh / 2 || r.height > layout.topBarMaxPx) add('rail-layout', railEl, `Under ${layout.mediumFromPx} the rail is a bar across the top; it is ${r.width.toFixed(0)}x${r.height.toFixed(0)}px at ${r.left.toFixed(0)},${r.top.toFixed(0)}.`);
      } else {
        const expected = vw >= layout.asDrawnFromPx ? layout.railPx.asDrawn : layout.railPx.medium;
        if (Math.abs(r.width - expected) > tol || r.left > tol || r.height < r.width) add('rail-layout', railEl, `At ${vw} the rail is a column ${expected}px wide at the left; it is ${r.width.toFixed(0)}x${r.height.toFixed(0)}px at ${r.left.toFixed(0)},${r.top.toFixed(0)}.`);
      }
    }
    // The sheet: beside the page as drawn, over the list in the medium window, the whole window when narrow.
    if (sheetEl && rendered(sheetEl) && pageEl && railEl) {
      const sr = sheetEl.getBoundingClientRect(), pr = pageEl.getBoundingClientRect();
      if (vw < layout.mediumFromPx) {
        if (sr.left > tol || sr.top > tol || sr.width < vw - tol || sr.height < vh - tol) add('sheet-layout', sheetEl, `Under ${layout.mediumFromPx} the sheet fills the window; it is ${sr.width.toFixed(0)}x${sr.height.toFixed(0)}px at ${sr.left.toFixed(0)},${sr.top.toFixed(0)}.`);
      } else if (vw < layout.asDrawnFromPx) {
        if (sr.right < vw - tol || sr.left >= pr.right - tol) add('sheet-layout', sheetEl, `From ${layout.mediumFromPx} to ${layout.asDrawnFromPx - 1} the sheet covers the list; it spans ${sr.left.toFixed(0)}-${sr.right.toFixed(0)}px and the page ${pr.left.toFixed(0)}-${pr.right.toFixed(0)}px.`);
      } else if (sr.left < pr.right - tol || Math.abs(sr.width - layout.sheetPx) > tol) add('sheet-layout', sheetEl, `From ${layout.asDrawnFromPx} the sheet sits beside the page, ${layout.sheetPx}px wide; it spans ${sr.left.toFixed(0)}-${sr.right.toFixed(0)}px and the page ends at ${pr.right.toFixed(0)}px.`);
    }
    // Under 1024 charts stack: no two side by side.
    if (vw < layout.mediumFromPx && pageEl) {
      const charts = [...pageEl.querySelectorAll('[data-stat], svg[role="img"]')]
        .filter(el => rendered(el) && !(el.tagName.toLowerCase() === 'svg' && el.closest('[data-stat]')) && !el.closest('table'))
        .map(el => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.width >= 80);
      for (let i = 0; i < charts.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = charts[i].rect, b = charts[j].rect;
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapY > Math.min(a.height, b.height) / 2 && (a.left >= b.right - tol || b.left >= a.right - tol)) { add('charts-stack', charts[i].el, `Beside another chart at ${vw}px (${b.left.toFixed(0)}-${b.right.toFixed(0)} and ${a.left.toFixed(0)}-${a.right.toFixed(0)}px).`); break; }
        }
      }
    }
    // A table wider than the page scrolls inside its own box.
    for (const table of document.querySelectorAll('[data-region="page"] table, [data-region="sheet"] table')) {
      if (!rendered(table)) continue;
      const region = table.closest('[data-region]');
      let box = null;
      for (let a = table.parentElement; a && a !== region; a = a.parentElement) if (scrollsX(style(a))) { box = a; break; }
      if (box) continue;
      const tr = table.getBoundingClientRect(), rr = region.getBoundingClientRect();
      const inner = rr.left + region.clientLeft + region.clientWidth - parseFloat(style(region).paddingRight || '0');
      if (tr.right > inner + tol || table.scrollWidth > table.clientWidth + tol) add('table-scroll', table, `The table needs ${tr.width.toFixed(0)}px, past the ${region.getAttribute('data-region')}'s edge at ${inner.toFixed(0)}px, and has no scrolling box of its own.`);
    }
  }

  /* ---------------------------------------------------------------- state */
  const mainText = page ? visibleText(page) : visibleText(document.body);
  return {
    findings, warnings,
    notBuilt: notBuiltTexts.some(text => mainText.includes(text)),
    sheetOpen: sheet !== null, sheetExpected: !!sheetExpected,
    words: { atRest, limit: limitName, sheet: sheetWords },
    atRestText,
    theme, title: (document.querySelector('[data-region="page"] h1, main h1, h1')?.textContent ?? '').trim().slice(0, 60),
  };
}
