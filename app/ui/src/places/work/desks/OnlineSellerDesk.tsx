/** Seller desk, Chausar original code. Research ideas: sealeap and listing-doctor (MIT), no copied code. */
import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../../text';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { Tile, TileHead } from '../../../parts/Tile';
import { Field } from '../../../parts/Field';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { Sheet } from '../../../parts/Sheet';
import type { SellerMode } from '../../../../../../platform/runtime/venture/playbooks/online-seller/source';
import type { SellerSkuBody } from '../../../../../../platform/runtime/venture/playbooks/online-seller/records';
import s from './OnlineSellerDesk.module.css';
type Report = SellerSkuBody & { id: string };
type Row = { id: string; orderId: string; mode: SellerMode; sourceName: string; figures: SellerSkuBody['figures'] };
type Result = { coverage?: { present: number; of: number }; score?: number | null; questions?: { field: string }[]; findings?: { code: string }[]; india?: { findings: { code: string }[] } | null; reconciles?: boolean | null; breakEven?: { bps: string; basis: string } | null; triage?: { phrase: string; action: string }[]; rows?: { orderId: string; holdReasons: string[]; differences: { kind: string; source: string }[] }[] };
const modes: SellerMode[] = ['listing', 'economics', 'ads', 'settlement'];
const templates: Record<SellerMode, string> = {
  listing: 'marketplace,title,bullets,description,packaged,sellingMinor,mrpMinor,countryOfOrigin,sellerDetails\n',
  economics: 'field,type,value,source,observedAt,missingReason\n',
  ads: 'spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n',
  settlement: 'orderId,expectedMinor,paidMinor,source,observedAt,feeSlabMinor,feeSlabMinorSource,weightChangeMinor,weightChangeMinorSource,returnDeductionMinor,returnDeductionMinorSource,holdReasons\n',
};
const namedErrors = new Set(['SELLER_INPUT_INVALID', 'UNIT_ECONOMICS_HOLD', 'RULE_UNCONFIRMED', 'UPLOAD_LIMIT', 'ORDER_NOT_FOUND']);
/** Reads bytes only; all parsing, money, ratios and refusal decisions belong to the engine. */
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(new Error('FILE_UNREADABLE')); reader.readAsDataURL(file); });
}
/** Export-first seller audits. The sole primary checks a file and makes no marketplace change. */
export function OnlineSellerDesk() {
  const t = useT(), engine = useEngine(), titleId = useId(), orderId = useId(), modeId = useId();
  const plan = useResource('venture.blueprint.get', {});
  const orders = useResource('venture.order.list', {}), reports = useResource('venture.desk.list', { playbook: 'online-seller', kind: 'sku' });
  const [order, setOrder] = useState(''), [mode, setMode] = useState<SellerMode>('listing'), [file, setFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [economics, setEconomics] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [report, setReport] = useState<Report | null>(null), [receipt, setReceipt] = useState(false);
  const openOrders = (orders.data ?? []).filter(item => item.status === 'open'), selectedOrder = order || openOrders[0]?.id || '';
  const rows = (reports.data?.rows ?? []) as Row[];
  const ownOffer = plan.data?.playbook?.id === 'online-seller' ? plan.data.blueprint.offers.find(offer => offer.playbookOffer === 'own-shop-back-office') : undefined;
  async function startOwnShop() {
    if (!ownOffer || ownOffer.pricing.unitPriceMinor === null || busy) return;
    setBusy(true); setProblem(null);
    try { const created = await engine.request('venture.order.create', { offerId: ownOffer.id, request: t('pb-online-seller.ownRequest') }); setOrder(created.id); orders.reload(); }
    catch (error) { setProblem(errorOf(error)); } finally { setBusy(false); }
  }
  const errorOf = (error: unknown) => t(`pb-online-seller.error.${error instanceof EngineError && namedErrors.has(error.code) ? error.code : 'generic'}`);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!file || !selectedOrder || busy) return;
    setBusy(true); setProblem(null);
    try {
      if (file.size + (mode === 'ads' ? economics?.size ?? 0 : 0) + (mode === 'listing' ? photos.reduce((sum, photo) => sum + photo.size, 0) : 0) > 1000000) throw new EngineError('UPLOAD_LIMIT', '');
      const view = await engine.request('venture.desk.act', { playbook: 'online-seller', kind: 'sku', id: selectedOrder, action: 'inspect', payload: { orderId: selectedOrder, mode, name: file.name, contentBase64: await readFile(file), ...(mode === 'ads' && economics ? { economics: { name: economics.name, contentBase64: await readFile(economics) } } : {}), ...(mode === 'listing' && photos.length ? { images: await Promise.all(photos.map(async photo => ({ name: photo.name, contentBase64: await readFile(photo) }))) } : {}) } });
      setReport(view.result as Report); setReceipt(false); reports.reload();
    } catch (error) { setProblem(errorOf(error)); } finally { setBusy(false); }
  }
  async function open(id: string) {
    try { const view = await engine.request('venture.desk.get', { playbook: 'online-seller', kind: 'sku', id }); setReport(view.item as Report); setReceipt(false); }
    catch (error) { setProblem(errorOf(error)); }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templates[mode]], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `seller-${mode}-blank.csv`; link.click(); URL.revokeObjectURL(url);
  }
  const details = report?.result as Result | undefined;
  const label = (key: string) => {
    const total = /^differenceMinor(\d+)$/.exec(key), split = /^differencePart(\d+)_(\d+)Minor$/.exec(key);
    if (total || split) {
      const row = details?.rows?.[Number((total ?? split)![1]) - 1];
      const kind = split ? row?.differences[Number(split[2]) - 1]?.kind : undefined;
      return t('pb-online-seller.orderFigure', { order: row?.orderId ?? '', label: t(kind ? 'pb-online-seller.difference.' + kind : 'pb-online-seller.label.difference') });
    }
    return t('pb-online-seller.label.' + key);
  };
  return <>
    <Tile as="section" labelledBy={titleId}>
      <TileHead id={titleId} title={t('pb-online-seller.title')} />
      <div className={s.body}>
        <p className={s.line}>{t('pb-online-seller.line')}</p>
        <p className={s.line}>{t('pb-online-seller.manual')}</p>
        {ownOffer && <Button variant="quiet" disabled={busy} locked={ownOffer.pricing.unitPriceMinor === null} lockedReason={t('pb-online-seller.ownPrice')} onClick={() => void startOwnShop()}>{t('pb-online-seller.ownStart')}</Button>}
        <form className={s.form} onSubmit={event => void submit(event)} aria-label={t('pb-online-seller.title')}>
          <label htmlFor={orderId}>{t('pb-online-seller.order')}</label>
          <select id={orderId} className={s.select} value={selectedOrder} onChange={event => setOrder(event.currentTarget.value)}>
            {!openOrders.length && <option value="">{t('pb-online-seller.pickOrder')}</option>}
            {openOrders.map(item => <option key={item.id} value={item.id}>{item.request}</option>)}
          </select>
          <label htmlFor={modeId}>{t('pb-online-seller.mode')}</label>
          <select id={modeId} className={s.select} value={mode} onChange={event => setMode(event.currentTarget.value as SellerMode)}>{modes.map(value => <option key={value} value={value}>{t(`pb-online-seller.mode.${value}`)}</option>)}</select>
          <Field type="file" accept=".csv,text/csv" label={t('pb-online-seller.file')} hint={t('pb-online-seller.fileHelp')} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} />
          {mode === 'ads' && <Field type="file" accept=".csv,text/csv" label={t('pb-online-seller.economicsFile')} onChange={event => setEconomics(event.currentTarget.files?.[0] ?? null)} />}
          {mode === 'listing' && <Field type="file" accept="image/png,image/jpeg,image/webp" multiple label={t('pb-online-seller.photos')} hint={t('pb-online-seller.photosHelp')} onChange={event => setPhotos(Array.from(event.currentTarget.files ?? []))} />}
          <div className={s.actions}>
            <Button variant="quiet" onClick={downloadTemplate}>{t('pb-online-seller.template')}</Button>
            <Button type="submit" variant="primary" disabled={busy} locked={!file || !selectedOrder} lockedReason={t('pb-online-seller.locked')}>{t(busy ? 'pb-online-seller.wait' : 'pb-online-seller.check')}</Button>
          </div>
        </form>
        {(problem || reports.error) && <p role="alert" className={s.line}>{problem ?? errorOf(reports.error)}</p>}
        {!rows.length && <p className={s.line}>{t('pb-online-seller.none')}</p>}
        {rows.length > 0 && <ul className={s.list} aria-label={t('pb-online-seller.saved')}>{rows.map(row => <li key={row.id} className={s.row}><span data-content="">{row.sourceName}</span><span>{t(`pb-online-seller.mode.${row.mode}`)}</span><Button variant="quiet" onClick={() => void open(row.id)}>{t('pb-online-seller.open')}</Button></li>)}</ul>}
      </div>
    </Tile>
    {report && <Tile as="section" label={t('pb-online-seller.report')}>
      <div className={s.body}>
        <h3 className={s.heading}>{t(`pb-online-seller.mode.${report.mode}`)}</h3>
        <p className={s.line} data-content="">{report.sourceName}</p>
        {details?.coverage && <p className={s.line}>{t('pb-online-seller.coverage', { present: details.coverage.present, of: details.coverage.of })}</p>}
        {report.mode === 'listing' && <><p className={s.line}>{t('pb-online-seller.rubric')}</p>{details?.score === null && <p className={s.line}>{t('pb-online-seller.noScore')}</p>}
          <ul className={s.list} aria-label={t('pb-online-seller.missing')}>{(details?.questions ?? []).map(q => <li key={q.field}>{t(`pb-online-seller.question.${q.field}`)}</li>)}</ul>
          <ul className={s.list} aria-label={t('pb-online-seller.findings')}>{[...(details?.findings ?? []), ...(details?.india?.findings ?? [])].map((f, index) => <li key={`${f.code}-${index}`}>{t(`pb-online-seller.finding.${f.code}`)}</li>)}</ul>
          <ul className={s.list} aria-label={t('pb-online-seller.triage')}>{(details?.triage ?? []).map((item, i) => <li key={i}><span data-content="">{item.phrase}</span>: {t(`pb-online-seller.triage.${item.action}`)}</li>)}</ul>
          <p className={s.line}>{t('pb-online-seller.manualImage')}</p></>}
        {report.mode === 'settlement' && <><p className={s.line}>{t('pb-online-seller.estimateClaim')}</p>{(details?.rows ?? []).map(row => <div key={row.orderId}><h4 data-content="">{row.orderId}</h4><ul className={s.list} aria-label={t('pb-online-seller.holds')}>{row.holdReasons.map((reason,i) => <li key={i} data-content="">{reason === 'Unexplained settlement balance' ? t('pb-online-seller.unexplained') : reason}</li>)}</ul><ul className={s.list} aria-label={t('pb-online-seller.differences')}>{row.differences.map((difference,i) => <li key={i}>{t(`pb-online-seller.difference.${difference.kind}`)}: <span data-content="">{difference.source}</span></li>)}</ul></div>)}</>}
        {report.mode === 'economics' && <p className={s.line}>{t('pb-online-seller.notBuying')}</p>}
        {report.mode === 'ads' && <>{details?.reconciles === false && <p role="status" className={s.line}>{t('pb-online-seller.mismatch')}</p>}{!details?.breakEven && <p className={s.line}>{t('pb-online-seller.noBreakEven')}</p>}{details?.breakEven && <p className={s.line}>{t(`pb-online-seller.basis.${details.breakEven.basis}`)}</p>}</>}
        <dl className={s.figures}>{report.figures.map(f => <div key={f.key}><dt data-content={f.key.startsWith('difference') ? '' : undefined}>{label(f.key)}</dt><dd><Figure value={f.display} receiptId={f.receiptId} onReceipt={() => setReceipt(true)} /></dd></div>)}</dl>
        <Button variant="quiet" onClick={() => setReport(null)}>{t('pb-online-seller.close')}</Button>
      </div>
    </Tile>}
    {receipt && report && <Sheet receipt label={t('pb-online-seller.receipt')} title={t('pb-online-seller.receipt')} line={t('pb-online-seller.receiptLine')} onClose={() => setReceipt(false)}>
      <div className={s.body}><h3 className={s.heading}>{t('pb-online-seller.source')}</h3>{(report.receipt.inputs as { tables?: { name: string }[] }).tables?.map((source,i) => <p key={i} data-content="">{source.name}</p>)}<dl className={s.figures}>{report.figures.map(f => <div key={f.key}><dt>{label(f.key)}</dt><dd className="mono">{f.display}</dd></div>)}</dl></div>
    </Sheet>}
  </>;
}
OnlineSellerDesk.ready = true;
