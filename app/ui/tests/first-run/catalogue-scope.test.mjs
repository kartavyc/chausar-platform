import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUiSource, resolveTypeScriptPath } from '../../../../scripts/check-ui-source.mjs';

const checkout = fileURLToPath(new URL('../../../../', import.meta.url));
const compilerPath = resolveTypeScriptPath({ root: checkout });
const shared = { en: { 'BTN.continue': 'Continue' }, hi: { 'BTN.continue': 'आगे बढ़ें' } };
const local = {
  en: { 'FR.again': 'Read again', 'FR-08.changePack': 'Change pack', 'FR-08.reconcile': 'Read back' },
  hi: { 'FR.again': 'फिर पढ़ें', 'FR-08.changePack': 'पैक बदलें', 'FR-08.reconcile': 'वापस पढ़ें' },
};
const screen = `import { FirstRunText } from './text';
import { Meanings } from './Meanings';
import { Button } from '../../parts/Button';
import { useT } from '../../app/text';
function Retry() { const t = useT(); return <Button>{t('FR.again')}</Button>; }
function Body() { return <><Retry /><Meanings /></>; }
export function FirstRunScreen({ language }) {
  return <FirstRunText language={language}><Body /></FirstRunText>;
}`;
const provider = `import { IntlProvider } from 'react-intl';
import { TextProvider } from '../../app/text';
import sharedEn from '../../text/en.json';
import sharedHi from '../../text/hi.json';
import en from './text/en.json';
import hi from './text/hi.json';
const SHARED = { en: sharedEn, hi: sharedHi };
const LOCAL = { en, hi };
function firstRunMessages(language) { return { ...SHARED[language], ...LOCAL[language] }; }
export function FirstRunText({ language, children }) {
  return <TextProvider language={language}>
    <IntlProvider locale={language} messages={firstRunMessages(language)}>{children}</IntlProvider>
  </TextProvider>;
}`;
const meanings = `import { Button } from '../../parts/Button';
import { useT } from '../../app/text';
export function Meanings() { const t = useT(); return <>
  <Button>{t('FR-08.changePack')}</Button>
  <Button>{t('FR-08.reconcile')}</Button>
  <Button>{t('BTN.continue')}</Button>
</>; }`;

async function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'chausar-catalogue-scope-'));
  const files = {
    'app/ui/src/text/en.json': JSON.stringify(shared.en),
    'app/ui/src/text/hi.json': JSON.stringify(shared.hi),
    'app/ui/src/text/banned.txt': 'leverage\n',
    'app/ui/src/app/text.tsx': 'export function TextProvider({ children }) { return <>{children}</>; } export function useT() { return key => key; }',
    'app/ui/src/parts/Button.tsx': 'export function Button({ children }) { return <button>{children}</button>; }',
    'app/ui/src/screens/first-run/FirstRun.tsx': screen,
    'app/ui/src/screens/first-run/Meanings.tsx': meanings,
    'app/ui/src/screens/first-run/text.tsx': provider,
    'app/ui/src/screens/first-run/text/en.json': JSON.stringify(local.en),
    'app/ui/src/screens/first-run/text/hi.json': JSON.stringify(local.hi),
    ...overrides,
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      if (content === null) continue;
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return await checkUiSource({ root, compilerPath });
  } finally {
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1).startsWith('chausar-catalogue-scope-'));
    rmSync(target, { recursive: true, force: true });
  }
}
const missing = (report, id) => report.findings.filter(item => item.rule === 'button-message-missing' && item.message === `Button message ${id} does not exist.`);
const localFile = language => `app/ui/src/screens/first-run/text/${language}.json`;
const reportedLocalFile = language => `screens/first-run/text/${language}.json`;

test('the actual provider subtree resolves all three owned labels and shared fallback in English and Hindi', async () => {
  const report = await fixture();
  assert.equal(report.status, 'static-checks-passed');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.inspected.staticButtonMessageIds, ['BTN.continue', 'FR-08.changePack', 'FR-08.reconcile', 'FR.again']);
});

test('an intentionally absent local label fails in both effective catalogues', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': meanings.replace('FR-08.reconcile', 'FR-08.absent') });
  assert.equal(report.status, 'static-checks-failed');
  assert.deepEqual(missing(report, 'FR-08.absent').map(item => item.file).sort(), ['en', 'hi'].map(reportedLocalFile));
});

test('a label missing in one local locale still fails with local parity and the correct locale path', async () => {
  for (const language of ['en', 'hi']) {
    const messages = { ...local[language] };
    delete messages['FR.again'];
    const report = await fixture({ [localFile(language)]: JSON.stringify(messages) });
    assert.deepEqual(missing(report, 'FR.again').map(item => item.file), [reportedLocalFile(language)]);
    assert.ok(report.findings.some(item => item.rule === 'catalogue-parity' && item.file === reportedLocalFile(language) && item.message === 'Missing message FR.again.'));
  }
});

test('a local-only literal label outside the provider layer fails against shared catalogues', async () => {
  const report = await fixture({ 'app/ui/src/screens/Outside.tsx': "export function Outside() { return <Button>{t('FR.again')}</Button>; }" });
  assert.deepEqual(missing(report, 'FR.again').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('the same first-run source file does not grant the layer to an unreachable component', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/FirstRun.tsx': screen + "\nexport function Unrelated() { return <Button>{t('FR.again')}</Button>; }" });
  assert.deepEqual(missing(report, 'FR.again').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('removing the entry provider boundary makes all local labels fail despite their files and folder', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/FirstRun.tsx': screen.replace('<FirstRunText language={language}><Body /></FirstRunText>', '<Body />') });
  for (const id of Object.keys(local.en)) assert.deepEqual(missing(report, id).map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a same-named provider from another module cannot grant the first-run catalogue layer', async () => {
  const report = await fixture({
    'app/ui/src/screens/first-run/FirstRun.tsx': screen.replace("from './text'", "from './otherText'"),
    'app/ui/src/screens/first-run/otherText.tsx': 'export function FirstRunText({ children }) { return <>{children}</>; }',
  });
  for (const id of Object.keys(local.en)) assert.equal(missing(report, id).length, 2);
});

test('removing the actual layered IntlProvider makes local labels fail', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/text.tsx': provider.replace('<IntlProvider locale={language} messages={firstRunMessages(language)}>{children}</IntlProvider>', '{children}') });
  for (const id of Object.keys(local.en)) assert.equal(missing(report, id).length, 2);
});

test('moving children outside the layered IntlProvider does not grant its catalogue', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/text.tsx': provider.replace('messages={firstRunMessages(language)}>{children}</IntlProvider>', 'messages={firstRunMessages(language)}></IntlProvider>{children}') });
  for (const id of Object.keys(local.en)) assert.equal(missing(report, id).length, 2);
});

test('an unsupported non-JSX provider body fails closed without crashing the checker', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/text.tsx': provider.replace(/return <TextProvider[\s\S]*?<\/TextProvider>;/, 'return children;') });
  for (const id of Object.keys(local.en)) assert.equal(missing(report, id).length, 2);
});

test('inline t() in the provider parent still uses that parent component shared catalogue', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/FirstRun.tsx': screen.replace('export function FirstRunScreen({ language }) {', 'export function FirstRunScreen({ language }) { const t = useT();').replace('<Body /></FirstRunText>', "<Body /><Button>{t('FR.again')}</Button></FirstRunText>") });
  assert.deepEqual(missing(report, 'FR.again').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('message components in provider children render with the local catalogue', async () => {
  const report = await fixture({ 'app/ui/src/screens/first-run/FirstRun.tsx': screen.replace('<Body /></FirstRunText>', '<Body /><Button><FormattedMessage id="FR.again" /></Button></FirstRunText>') });
  assert.deepEqual(report.findings, []);
});

test('unavailable local catalogue files do not fall back to an indiscriminate global union', async () => {
  const report = await fixture({ [localFile('en')]: null, [localFile('hi')]: null });
  for (const id of Object.keys(local.en)) assert.deepEqual(missing(report, id).map(item => item.file).sort(), ['en', 'hi'].map(reportedLocalFile));
});

test('a direct shared caller of Meanings must also resolve its labels in the shared catalogue', async () => {
  const report = await fixture({ 'app/ui/src/screens/Outside.tsx': "import { Meanings } from './first-run/Meanings'; export function Outside() { return <Meanings />; }" });
  for (const id of ['FR-08.changePack', 'FR-08.reconcile']) assert.deepEqual(missing(report, id).map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
  assert.equal(missing(report, 'FR.again').length, 0);
});

test('a shared TextProvider inside the first-run subtree resets rendered message-component scope', async () => {
  const innerProvider = meanings.replace("import { useT }", "import { TextProvider, useT }").replace('return <>', 'return <TextProvider language="en">').replace('</>; }', '</TextProvider>; }').replace("{t('FR-08.changePack')}", '<FormattedMessage id="FR-08.changePack" />').replace("{t('FR-08.reconcile')}", '<FormattedMessage id="FR-08.reconcile" />');
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': innerProvider });
  for (const id of ['FR-08.changePack', 'FR-08.reconcile']) assert.equal(missing(report, id).length, 2);
});

test('a shared provider within a Button label also resets its child message-component scope', async () => {
  const nestedProvider = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<TextProvider language="en"><FormattedMessage id="FR-08.changePack" /></TextProvider>');
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': nestedProvider });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
  assert.equal(missing(report, 'FR-08.reconcile').length, 0);
});

test('an unproven wrapper within a Button label cannot grant its child the local catalogue', async () => {
  const wrapped = meanings.replace("{t('FR-08.changePack')}", '<UnknownWrapper><FormattedMessage id="FR-08.changePack" /></UnknownWrapper>');
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a locally declared wrapper that forwards children through a shared provider also fails closed', async () => {
  const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<Wrapped><FormattedMessage id="FR-08.changePack" /></Wrapped>') + '\nfunction Wrapped({ children }) { return <TextProvider language="en">{children}</TextProvider>; }';
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('every wrapper branch is checked, including a compound child expression below a shared provider', async () => {
  const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<Wrapped flag={false}><FormattedMessage id="FR-08.changePack" /></Wrapped>') + '\nfunction Wrapped({ children, flag }) { return flag ? <section>{children}</section> : <TextProvider language="en">{children ?? null}</TextProvider>; }';
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a wrapper child alias is unproven and cannot borrow the local layer', async () => {
  const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<Wrapped><FormattedMessage id="FR-08.changePack" /></Wrapped>') + '\nfunction Wrapped({ children }) { const forwarded = children; return <TextProvider language="en">{forwarded}</TextProvider>; }';
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a provider receiving a JSX child attribute is also an unsafe wrapper slot path', async () => {
  const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<Wrapped><FormattedMessage id="FR-08.changePack" /></Wrapped>') + '\nfunction Wrapped({ children }) { return <><section>{children}</section><TextProvider language="en" children={children} /></>; }';
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a wrapper that passes its child through a function call cannot prove the local layer', async () => {
  const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", '<Wrapped><FormattedMessage id="FR-08.changePack" /></Wrapped>') + '\nfunction route(value) { return <TextProvider language="en">{value}</TextProvider>; }\nfunction Wrapped({ children }) { return <section>{route(children)}</section>; }';
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('a lowercase-root JSX member provider is a component, not a proven DOM wrapper', async () => {
  for (const body of [
    '<scope.Provider language="en"><FormattedMessage id="FR-08.changePack" /></scope.Provider>',
    '<Wrapped><FormattedMessage id="FR-08.changePack" /></Wrapped>',
  ]) {
    const wrapped = meanings.replace("import { useT }", "import { TextProvider, useT }").replace("{t('FR-08.changePack')}", body) + '\nconst scope = { Provider: TextProvider };\nfunction Wrapped({ children }) { return <scope.Provider language="en">{children}</scope.Provider>; }';
    const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
    assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
  }
});

test('direct raw IntlProvider wrapping a button message falls back to shared scope', async () => {
  const wrapped = meanings.replace("import { useT }", "import { IntlProvider } from 'react-intl';\nimport { useT }").replace("{t('FR-08.changePack')}", '<IntlProvider locale="en" messages={{}}><FormattedMessage id="FR-08.changePack" /></IntlProvider>');
  const report = await fixture({ 'app/ui/src/screens/first-run/Meanings.tsx': wrapped });
  assert.deepEqual(missing(report, 'FR-08.changePack').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('true shared missing labels still emit both original shared errors', async () => {
  const report = await fixture({ 'app/ui/src/screens/Outside.tsx': "export function Outside() { return <Button>{t('BTN.absent')}</Button>; }" });
  assert.deepEqual(missing(report, 'BTN.absent').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('explicit reading-budget message IDs remain shared by default', async () => {
  const report = await fixture({ 'app/ui/tests/reading-budget-cases.json': JSON.stringify([{ id: 'reading', view: 'guided', language: 'en', text: 'Read again', primaryButtons: 1, buttonMessageIds: ['FR.again'] }]) });
  assert.deepEqual(missing(report, 'FR.again').map(item => item.file).sort(), ['text/en.json', 'text/hi.json']);
});

test('local catalogue punctuation, banned terms and the 22-code-point button rule stay strict', async () => {
  const report = await fixture({
    [localFile('en')]: JSON.stringify({ ...local.en, 'FR.again': 'a'.repeat(23), note: 'Please leverage this!' }),
    [localFile('hi')]: JSON.stringify({ ...local.hi, 'FR.again': 'क'.repeat(23), note: 'जाँच' }),
  });
  for (const rule of ['catalogue-punctuation', 'banned-copy', 'button-label-length']) assert.ok(report.findings.some(item => item.rule === rule && item.file.startsWith('screens/first-run/text/')), rule);
  assert.equal(report.findings.filter(item => item.rule === 'button-label-length').length, 2);
});
