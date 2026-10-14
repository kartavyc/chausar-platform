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
  const wide = view === 'guided' && page !== null && page.getBoundingClientRect().width > columnPx + 1;
  const limitName = view === 'guided' ? (wide ? 'wide' : 'guided') : view;
  const atRest = words(atRestText);
  if (atRest > rules.words.limits[limitName]) add('words', page ?? document.body, `${atRest} words at rest; the ${limitName} limit is ${rules.words.limits[limitName]}.`);
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

  /* ---------------------------------------------------------------- state */
  const mainText = page ? visibleText(page) : visibleText(document.body);
  return {
    findings, warnings,
    notBuilt: notBuiltTexts.some(text => mainText.includes(text)),
    sheetOpen: sheet !== null, sheetExpected: !!sheetExpected,
    words: { atRest, limit: limitName, sheet: sheetWords },
    theme, title: (document.querySelector('[data-region="page"] h1, main h1, h1')?.textContent ?? '').trim().slice(0, 60),
  };
}
