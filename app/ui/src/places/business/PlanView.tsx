import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { ProgressBar } from '../../parts/ProgressBar';
import { Tile } from '../../parts/Tile';
import { SERVICE_TYPES, type BlueprintLite, type BlueprintPatchLite, type BlueprintViewLite } from '../../engine/types';
import { LabelTag, PendingPlanRows, TileSection, messageOf, quoteAgain, totalOf, usePlan } from './shared';
import { RulesSection } from './RulesSection';
import s from './Business.module.css';

/**
 * Plan and playbook (venture.blueprint.get) in the D look: the plan's name and one line with who it is for, how far
 * setup has come (venture.get's own done and total, catalogue U6 and U18), the offers as cards priced only by the
 * calculator's receipts, the playbook's steps with who does each (a flagship playbook's own steps, the ones that run,
 * when its plan has them), what the owner approves, the back office and the platform rules.
 * Simple first (founder, 23 Oct): the back office says the invoice currency at rest; a business registered for tax
 * keeps its registration and the fields a tax invoice still needs one fold away, and a business that is not
 * registered never sees a tax field at all.
 * The playbook shows by its human label ("YouTube channel") when the engine's pick carries one, else the service type.
 * Change plan writes a new draft version (venture.blueprint.update); accepting it is a row on Today, shown here too.
 */
export function PlanView() {
  const t = useT();
  const plan = usePlan();
  const [changing, setChanging] = useState(false);

  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <p className={s.note}>{t('business.loading')}</p>;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} actions={[{ label: t('business.start'), href: '#/onboarding' }]} />;
  }
  const view = plan.data;
  const bp = view.blueprint;
  // The playbook's own label when the idea picked a flagship playbook; else the service type's label.
  const kind = view.playbook?.label ?? (SERVICE_TYPES.includes(bp.serviceType) ? t(`business.kind.${bp.serviceType}`) : bp.serviceType);
  const version = t(bp.status === 'accepted' ? 'business.versionAccepted' : 'business.versionDraft', { version: bp.version });

  return (
    <div className={s.page}>
      <PendingPlanRows onDecided={plan.reload} />
      <div className={s.split} data-ratio="8-4">
        <Tile as="section" labelledBy="business-plan-name">
          <div className={s.body}>
            <p className={s.kind}>{kind} · {version}{bp.source === 'template' ? ` · ${t('business.fromTemplates')}` : ''}</p>
            <h2 id="business-plan-name" tabIndex={-1} className={s.name}>{bp.name.value}<LabelTag line={bp.name} /></h2>
            <p className={s.lead}>{bp.oneLiner.value}<LabelTag line={bp.oneLiner} /></p>
            <p className={s.line}>{t('business.for', { customer: bp.customer.value })}<LabelTag line={bp.customer} /></p>
            {changing ? (
              <ChangeForm plan={bp} onDone={() => { setChanging(false); plan.reload(); }} onCancel={() => setChanging(false)} />
            ) : (
              <div className={s.buttons}><Button size="sm" onClick={() => setChanging(true)}>{t('business.change')}</Button></div>
            )}
          </div>
        </Tile>
        <Setup />
      </div>
      <Offers view={view} />
      <div className={s.split}>
        <TileSection title={t('business.steps')}>
          {bp.flagshipSteps ? (
            // A flagship playbook's plan lists the steps that run on every order, in its own words, and who does each.
            <ol className={s.flow}>
              {bp.flagshipSteps.map((step) => (
                <li key={step.id} className={s.flowStep}>
                  {step.title.value}
                  <span className={s.stepWho}>{t(`business.who.${step.doneBy}`, { who: step.who })}</span>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <ol className={s.flow}>
                {bp.deliverySteps.map((step) => (
                  <li key={step.id} className={s.flowStep}>
                    {step.title.value}<LabelTag line={step.title} />
                    <span className={s.stepWho}>{t(`business.doneBy.${step.doneBy}`)} · {t(`business.capability.${step.capability}`)}</span>
                  </li>
                ))}
              </ol>
              <details className={s.fold}>
                <summary>{t('business.stepsMore')}</summary>
                <div className={s.foldBody}>
                  {bp.deliverySteps.map((step) => <p key={step.id} className={s.line}>{step.title.value}: {step.note}</p>)}
                </div>
              </details>
            </>
          )}
        </TileSection>
        <div className={s.column}>
          <TileSection title={t('business.approvals')}>
            <ul className={s.checks}>
              {bp.approvals.map((line, i) => (
                <li key={i}><span className={s.tick} aria-hidden="true"><Icon name="check" size={14} /></span><span>{line.value}</span></li>
              ))}
            </ul>
          </TileSection>
          <BackOffice plan={bp} />
        </div>
      </div>
      <RulesSection />
    </div>
  );
}

/** How far setup has come, from the engine's own count (venture.get done and total); what is left waits on Today. */
function Setup() {
  const t = useT();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const data = venture.data;
  if (!data || data.total <= 0) return null;
  const done = data.done >= data.total;
  return (
    <TileSection title={t('business.setup.title')} more={done ? undefined : { href: '#/today?show=setup', label: t('business.setup.left') }}>
      <ProgressBar progress={{ done: data.done, total: data.total }} tone="working" />
      <p className={s.note}>{t(done ? 'business.setup.done' : 'business.setup.line')}</p>
    </TileSection>
  );
}

/**
 * The back office. At rest only the invoice currency; a business registered for tax keeps its registration and what
 * a tax invoice still needs one fold away. A business not registered for tax sees no tax line at all.
 */
function BackOffice({ plan }: { plan: BlueprintLite }) {
  const t = useT();
  const office = plan.backOffice;
  return (
    <TileSection title={t('business.backOffice')}>
      <p className={s.line}>{t('business.invoicesIn', { currency: office.currency })}</p>
      {office.taxRegistered.value && (
        <details className={s.fold}>
          <summary>{t('business.taxDetails')}</summary>
          <div className={s.foldBody}>
            <p className={s.line} data-tax-line="">{t('business.taxRegisteredLine', { tax: office.taxLabel })}<LabelTag line={office.taxRegistered} /></p>
            {office.taxInvoiceMissing.length > 0 && (
              <p className={s.note} data-tax-line="">{t('business.taxMissing', { list: office.taxInvoiceMissing.join(', ') })}</p>
            )}
          </div>
        </details>
      )}
    </TileSection>
  );
}

/** Each offer as a card with its price only as the receipt's total, or why there is none and where to set it. */
function Offers({ view }: { view: BlueprintViewLite }) {
  const t = useT();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className={s.groupHead}>
        <h2 id={headingId} className={s.groupTitle}>{t('business.offers')}</h2>
      </div>
      <ul className={s.cards}>
        {view.blueprint.offers.map((offer) => <OfferCard key={offer.id} view={view} offerId={offer.id} />)}
      </ul>
    </section>
  );
}

function OfferCard({ view, offerId }: { view: BlueprintViewLite; offerId: string }) {
  const t = useT();
  const titleId = useId();
  const offer = view.blueprint.offers.find((o) => o.id === offerId)!;
  const receipt = view.offerReceipts[offer.id] ?? null;
  const total = totalOf(receipt);
  const notSet = offer.pricing.unitPriceMinor === null;
  return (
    <Tile as="li" card labelledBy={titleId} className={s.offer}>
      <h3 id={titleId} className={s.offerTitle}><span data-offer-name="">{offer.name.value}</span><LabelTag line={offer.name} /></h3>
      <p className={s.line}>{offer.description.value}</p>
      <div className={s.price}>
        {receipt && total ? (
          <>
            <Figure value={total} receiptId={receipt.id} size="tile" />
            <span className={s.unit}>{t(`business.unit.${offer.pricing.quantityUnit}`)}</span>
          </>
        ) : (
          <>
            <span className={s.quiet}>{notSet ? t('business.priceNotSet') : t('business.notPriced')}</span>
            <a className={s.link} href="#/business/prices">{notSet ? t('business.setPrice') : t('business.workOut')}</a>
          </>
        )}
      </div>
    </Tile>
  );
}

/** Name, one line and who it's for. Only what changed is sent; the engine writes a new draft version. */
function ChangeForm({ plan, onDone, onCancel }: { plan: BlueprintLite; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const client = useEngine();
  const [name, setName] = useState(plan.name.value);
  const [oneLiner, setOneLiner] = useState(plan.oneLiner.value);
  const [customer, setCustomer] = useState(plan.customer.value);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch: BlueprintPatchLite = {};
    if (name.trim() && name.trim() !== plan.name.value) patch.name = name.trim();
    if (oneLiner.trim() && oneLiner.trim() !== plan.oneLiner.value) patch.oneLiner = oneLiner.trim();
    if (customer.trim() && customer.trim() !== plan.customer.value) patch.customer = customer.trim();
    if (Object.keys(patch).length === 0) { setProblem(t('business.nothingChanged')); return; }
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.blueprint.update', { patch });
      await quoteAgain(client);
      onDone();
    } catch (error) {
      setProblem(t('business.saveFailed', { message: messageOf(error) }));
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void save(event)}>
      <Field label={t('business.fieldName')} value={name} maxLength={60} onChange={(event) => setName(event.currentTarget.value)} />
      <Field label={t('business.fieldOneLiner')} value={oneLiner} maxLength={160} onChange={(event) => setOneLiner(event.currentTarget.value)} />
      <Field multiline label={t('business.fieldCustomer')} value={customer} maxLength={200} rows={2} onChange={(event) => setCustomer(event.currentTarget.value)} />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        <Button onClick={onCancel}>{t('business.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy}>{t('business.save')}</Button>
      </div>
    </form>
  );
}
