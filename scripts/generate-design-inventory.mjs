import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Integrated checks can read the immutable consumer-local inputs without copying them.
// Provenance in JSON deliberately stays inputs/<original-name>, with original hashes.
const inputRoot = process.env.UI_DESIGN_INPUTS ? resolve(process.env.UI_DESIGN_INPUTS) : resolve(root, 'inputs');
const inputNames = ['2026-10-01-chausar-app-frontend.md', 'build.md', 'enterprise.md', 'screens.md'];
const screenCode = /\b(?:SH|FR|TD|AS|WK|BK|RP|TL|TR|PH)-\d{2}\b/g;
const unique = values => [...new Set(values)];
const references = text => unique(text.match(screenCode) ?? []);
const quoted = text => unique([...text.matchAll(/`([^`]+)`/g)].map(match => match[1]));
const cells = line => line.split('|').slice(1, -1).map(cell => cell.trim());

function loadSources() {
  return Object.fromEntries(inputNames.map(name => {
    const bytes = readFileSync(resolve(inputRoot, name));
    const text = bytes.toString('utf8');
    const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return [name, { text, lines, identity: { file: `inputs/${name}`, bytes: bytes.length, lines: lines.length, sha256: createHash('sha256').update(bytes).digest('hex') } }];
  }));
}

function section(source, heading, followingLevel) {
  const start = source.lines.findIndex(line => line.startsWith(heading));
  if (start < 0) throw new Error(`Missing source section ${heading}`);
  let end = source.lines.findIndex((line, index) => index > start && line.startsWith(followingLevel));
  if (end < 0) end = source.lines.length;
  return { lineStart: start + 1, lineEnd: end, text: source.lines.slice(start, end).join('\n') };
}

export function parseSchedule(sourceText) {
  const afterDayTen = /^After day 10\b/.test(sourceText);
  const starts = afterDayTen ? [] : [...sourceText.matchAll(/\b\d+\b/g)].map(match => Number(match[0]));
  for (const match of sourceText.matchAll(/\b(\d+)\s+(?:to|onward, until day)\s+(\d+)\b/g)) {
    for (let day = Number(match[1]); day <= Number(match[2]); day++) starts.push(day);
  }
  return {
    sourceText,
    mentionedBuildDays: unique(starts).sort((a, b) => a - b),
    afterDayTen,
    experimental: /\bexperimental\b/i.test(sourceText),
    scheduleStatus: 'source-plan-only',
  };
}

function parseScreens(source) {
  const starts = source.lines.flatMap((line, index) => /^### [A-Z]{2}-\d{2} /.test(line) ? [index] : []);
  const screens = starts.map((start, index) => {
    const next = starts[index + 1] ?? source.lines.length;
    const entryLines = source.lines.slice(start, next);
    const endOffset = entryLines.findIndex((line, offset) => offset > 0 && /^## /.test(line));
    if (endOffset >= 0) entryLines.length = endOffset;
    const heading = /^### ([A-Z]{2}-\d{2}) (.+)$/.exec(entryLines[0]);
    if (!heading) throw new Error(`Invalid screen heading at ${start + 1}`);
    const [, code, title] = heading;
    const scheduleText = entryLines.find(line => /^(Day \d|After day 10)/.test(line));
    if (!scheduleText) throw new Error(`Missing source schedule for ${code}`);
    const details = Object.fromEntries(entryLines.flatMap(line => {
      const match = /^- \*\*([^*]+)\*\*\s*(.*)$/.exec(line);
      return match ? [[match[1].replace(/[.:]$/, ''), match[2]]] : [];
    }));
    const engineSourceText = details.Engine ?? null;
    const explicitReuse = /(?:same screen as|See)\s+((?:SH|FR|TD|AS|WK|BK|RP|TL|TR|PH)-\d{2})/i.exec(scheduleText);
    const inheritedEngine = engineSourceText ? /\bas ((?:SH|FR|TD|AS|WK|BK|RP|TL|TR|PH)-\d{2})\b/i.exec(engineSourceText) : null;
    const engineInheritedFrom = unique([explicitReuse?.[1], inheritedEngine?.[1]].filter(Boolean));
    const imageRefs = entryLines.flatMap(line => [...line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]));
    const picture = /Picture: (S\d{2})/.exec(scheduleText)?.[1] ?? null;
    return {
      code, title, area: code.slice(0, 2),
      purpose: details.For ?? null,
      purposeInheritedFrom: !details.For && explicitReuse ? explicitReuse[1] : null,
      schedule: parseSchedule(scheduleText),
      source: { document: 'screens.md', lineStart: start + 1, lineEnd: start + entryLines.length },
      scope: { edition: code.startsWith('PH-') ? 'phone' : 'desktop', status: 'planned-reference', implementationStatus: 'not-asserted' },
      details,
      engineSourceText,
      engineContractStatus: 'proposed-screen-requirement',
      engineMethodRefs: quoted(engineSourceText ?? '').map(name => ({ name, status: 'proposed', declaredIn: 'screens.md' })),
      engineInheritedFrom,
      relatedScreenCodes: references(entryLines.join('\n')).filter(ref => ref !== code),
      picture, imageRefs,
    };
  });
  const byCode = new Map(screens.map(screen => [screen.code, screen]));
  function effectiveMethods(screen, seen = new Set()) {
    if (seen.has(screen.code)) throw new Error(`Circular screen reuse: ${screen.code}`);
    const following = new Set([...seen, screen.code]);
    const inherited = screen.engineInheritedFrom.flatMap(code => {
      const other = byCode.get(code);
      if (!other) throw new Error(`Unknown screen reuse ${code}`);
      return effectiveMethods(other, following);
    });
    return unique([...screen.engineMethodRefs.map(ref => ref.name), ...inherited]);
  }
  for (const screen of screens) {
    screen.effectiveEngineMethodRefs = effectiveMethods(screen);
    screen.engineMappingStatus = screen.engineSourceText ? 'specified' : screen.engineInheritedFrom.length ? 'inherited' : 'not-specified';
    screen.effectivePurpose = screen.purpose ?? (screen.purposeInheritedFrom ? byCode.get(screen.purposeInheritedFrom)?.purpose ?? null : null);
  }
  return screens;
}

function parseProposedMethods(source) {
  const messageSection = section(source, '## 10. The messages', '## ');
  const methods = [];
  for (let index = messageSection.lineStart; index < messageSection.lineEnd; index++) {
    const line = source.lines[index];
    if (!line.startsWith('| `')) continue;
    const [methodText, description, dayText] = cells(line);
    for (const name of quoted(methodText)) {
      if (!name.includes('.') && name !== 'capabilities') continue;
      methods.push({ name, description, dayText, status: 'proposed', contractStatus: 'requires-engine-owner-agreement', source: { document: 'build.md', line: index + 1 } });
    }
  }
  if (new Set(methods.map(method => method.name)).size !== methods.length) throw new Error('Duplicate proposed method declaration');
  return methods;
}

function parseEnterprise(source) {
  const surfaces = [];
  let group = '';
  source.lines.forEach((line, index) => {
    if (line.startsWith('### ')) group = line.slice(4);
    if (!/^\| A\d+\./.test(line)) return;
    const [declaredId, title, edition, location, builtFrom] = cells(line);
    const match = /^(A\d+)\.(\d+)(?: to (A\d+)\.(\d+))?$/.exec(declaredId);
    if (!match || (match[3] && match[3] !== match[1])) throw new Error(`Unsupported surface range ${declaredId}`);
    const first = Number(match[2]);
    const last = match[4] ? Number(match[4]) : first;
    for (let number = first; number <= last; number++) {
      const id = `${match[1]}.${number}`;
      const internal = edition === 'Chausar only';
      const customerWindow = id === 'A12.1' || id === 'A12.2';
      surfaces.push({
        id, declaredId, title, edition, group, location, builtFrom,
        relatedScreenCodes: references(builtFrom),
        scope: { status: 'planned-reference', implementationStatus: 'not-asserted', audience: internal ? 'internal-only' : 'customer-install' },
        referenceCoverage: internal || customerWindow ? 'rules-only' : 'placement-and-parts',
        drawingStatus: internal || customerWindow ? 'not-drawn' : 'not-asserted-for-individual-surface',
        source: { document: 'enterprise.md', line: index + 1 },
      });
    }
  });
  return surfaces;
}

function parseCa(source, build) {
  const afterDayLine = build.lines.findIndex(line => line.startsWith('After day 10:'));
  if (afterDayLine < 0) throw new Error('Missing CA/enterprise scheduling evidence');
  return source.lines.flatMap((line, index) => {
    if (!/^\| CA-\d{2} \|/.test(line)) return [];
    const [code, title, shows] = cells(line);
    return [{
      code, title, purpose: null, purposeStatus: 'not-separately-specified', shows,
      scope: { edition: 'ca-console', status: 'planned-reference', implementationStatus: 'not-asserted', dataBoundary: 'status-only-across-clients; books-in-each-client-vault' },
      schedule: { ...parseSchedule(build.lines[afterDayLine]), source: { document: 'build.md', line: afterDayLine + 1 } },
      engineContractStatus: 'not-specified', engineMethodRefs: [],
      source: { document: 'enterprise.md', line: index + 1 },
    }];
  });
}

export function buildInventory() {
  const sources = loadSources();
  const main = sources[inputNames[0]];
  const build = sources['build.md'];
  const enterprise = sources['enterprise.md'];
  const screens = parseScreens(sources['screens.md']);
  const enterpriseSurfaces = parseEnterprise(enterprise);
  const caScreens = parseCa(enterprise, build);
  const navSection = section(main, '## 5. The seven places', '## ');
  const navigation = main.lines.flatMap((line, index) => {
    if (index < navSection.lineStart || index >= navSection.lineEnd || !/^\| \*\*/.test(line)) return [];
    const [placeText, purpose, subPlaceText] = cells(line);
    return [{ place: placeText.replaceAll('**', ''), purpose, subPlaces: subPlaceText.split(', ').map(item => item.trim()), source: { document: inputNames[0], line: index + 1 } }];
  });
  const areaCounts = Object.fromEntries(unique(screens.map(screen => screen.area)).map(area => [area, screens.filter(screen => screen.area === area).length]));
  const enterpriseEditionCounts = Object.fromEntries(unique(enterpriseSurfaces.map(surface => surface.edition)).map(edition => [edition, enterpriseSurfaces.filter(surface => surface.edition === edition).length]));
  const contractDeclarationLine = build.lines.findIndex(line => line.startsWith('Nothing here is built.'));
  if (contractDeclarationLine < 0) throw new Error('Missing proposed-contract declaration');
  return {
    inventoryVersion: 1,
    authority: 'user-supplied-design-documents',
    status: 'planned-reference-inventory',
    implementationStatus: 'no-working-screen-or-live-method-claim',
    sources: inputNames.map(name => sources[name].identity),
    contractBoundary: {
      source: { document: 'build.md', line: contractDeclarationLine + 1 },
      sourceText: build.lines[contractDeclarationLine],
      engineMethodsStatus: 'proposed-screen-requirements; signatures-require-engine-owner-agreement',
      existingEngineAvailability: 'not-evaluated-by-this-inventory',
      unknownAvailability: 'must-not-be-rendered-as-live',
    },
    counts: { screenEntries: screens.length, areaCounts, desktopEntries: screens.filter(screen => screen.scope.edition === 'desktop').length, phoneEntries: screens.filter(screen => screen.scope.edition === 'phone').length, enterpriseSurfaces: enterpriseSurfaces.length, enterpriseEditionCounts, caScreens: caScreens.length },
    desktopNavigation: navigation,
    screens,
    proposedEngineMethods: parseProposedMethods(build),
    enterpriseSurfaces,
    caScreens,
    preservedRules: {
      commonStates: { document: inputNames[0], ...section(main, '## 10. States every screen', '## ') },
      phone: { document: inputNames[0], ...section(main, '## 12. The phone', '## ') },
      enterpriseNavigation: { document: 'enterprise.md', ...section(enterprise, '## 3. Sub-places', '## ') },
      enterpriseParts: { document: 'enterprise.md', ...section(enterprise, '## 4. New parts', '## ') },
      enterpriseRules: { document: 'enterprise.md', ...section(enterprise, '## 6. The rules', '## ') },
      customerWindow: { document: 'enterprise.md', coverage: 'rules-only', drawingStatus: 'not-drawn', ...section(enterprise, '## 7. The customer window', '## ') },
      internalConsoles: { document: 'enterprise.md', coverage: 'rules-only', drawingStatus: 'not-drawn', ...section(enterprise, '## 8. Chausar', '## ') },
      caBoundary: { document: 'enterprise.md', ...section(enterprise, '## 9. The CA console', '## ') },
      openChoices: { document: inputNames[0], ...section(main, '## 15. What is still open', '## ') },
    },
  };
}

export const serializeInventory = inventory => `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = resolve(root, 'app/ui/design-screen-inventory.json');
  const inventory = buildInventory();
  const serialized = serializeInventory(inventory);
  if (process.argv.includes('--check')) {
    if (readFileSync(destination, 'utf8') !== serialized) throw new Error('Design inventory is stale. Regenerate from the authoritative inputs.');
    process.stdout.write('Design inventory matches all four source documents.\n');
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, serialized, 'utf8');
    process.stdout.write(`Wrote source-backed design inventory: ${inventory.counts.screenEntries} screen entries, ${inventory.counts.enterpriseSurfaces} enterprise surfaces, ${inventory.counts.caScreens} CA entries.\n`);
  }
}
