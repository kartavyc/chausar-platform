import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { SERVICE_TYPES, type BlueprintLite, type BlueprintPatchLite, type BlueprintViewLite } from '../../engine/types';
import { LabelTag, PendingPlanRows, messageOf, quoteAgain, totalOf, usePlan } from './shared';
import s from './Business.module.css';

/**
 * Plan and playbook (venture.blueprint.get): the plan's name and one line, who it is for, the offers with prices only
 * as the calculator's receipts, the playbook's steps with who does each (a flagship playbook's own steps, the ones that
 * run, when its plan has them), what the owner approves, and the back office.
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
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} action={<a className={s.link} href="#/onboarding">{t('business.start')}</a>} />;
  }
  const view = plan.data;
  const bp = view.blueprint;
  // The playbook's own label when the idea picked a flagship playbook; else the service type's label.
  const kind = view.playbook?.label ?? (SERVICE_TYPES.includes(bp.serviceType) ? t(`business.kind.${bp.serviceType}`) : bp.serviceType);
  const version = t(bp.status === 'accepted' ? 'business.versionAccepted' : 'business.versionDraft', { version: bp.version });

  return (
    <>
      <PendingPlanRows onDecided={plan.reload} />
      <section className={s.section}>
        <p className={s.meta}>{kind} · {version}{bp.source === 'template' ? ` · ${t('business.fromTemplates')}` : ''}</p>
        <h2 id="business-plan-name" tabIndex={-1} className={s.name}>{bp.name.value}<LabelTag line={bp.name} /></h2>
        <p className={s.lead}>{bp.oneLiner.value}<LabelTag line={bp.oneLiner} /></p>
        <p className={s.line}>{t('business.for', { customer: bp.customer.value })}<LabelTag line={bp.customer} /></p>
        {changing ? (
          <ChangeForm plan={bp} onDone={() => { setChanging(false); plan.reload(); }} onCancel={() => setChanging(false)} />
        ) : (
          <div className={s.buttons}><Button onClick={() => setChanging(true)}>{t('business.change')}</Button></div>
        )}
      </section>
      <Offers view={view} />
      <section className={s.section} aria-label={t('business.steps')}>
        <h2 className={s.heading}>{t('business.steps')}</h2>
        {bp.flagshipSteps ? (
          // A flagship playbook's plan lists the steps that run on every order, in its own words, and who does each.
          <ol className={s.steps}>
            {bp.flagshipSteps.map((step) => (
              <li key={step.id} className={s.step}>
                {step.title.value}
                <span className={s.stepWho}>{t(`business.who.${step.doneBy}`, { who: step.who })}</span>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <ol className={s.steps}>
              {bp.deliverySteps.map((step) => (
                <li key={step.id} className={s.step}>
                  {step.title.value}<LabelTag line={step.title} />
                  <span className={s.stepWho}>{t(`business.doneBy.${step.doneBy}`)} · {t(`business.capability.${step.capability}`)}</span>
                </li>
              ))}
            </ol>
            <details className={s.fold}>
              <summary>{t('business.stepsMore')}</summary>
              {bp.deliverySteps.map((step) => <p key={step.id} className={s.line}>{step.title.value}: {step.note}</p>)}
            </details>
          </>
        )}
      </section>
      <section className={s.section} aria-label={t('business.approvals')}>
        <h2 className={s.heading}>{t('business.approvals')}</h2>
        <ul className={s.plain}>
          {bp.approvals.map((line, i) => <li key={i}>{line.value}</li>)}
        </ul>
      </section>
      <section className={s.section} aria-label={t('business.backOffice')}>
        <h2 className={s.heading}>{t('business.backOffice')}</h2>
        <p className={s.line}>
          {t(bp.backOffice.taxRegistered.value ? 'business.taxRegistered' : 'business.taxNotRegistered', { tax: bp.backOffice.taxLabel, currency: bp.backOffice.currency })}
          <LabelTag line={bp.backOffice.taxRegistered} />
        </p>
        {bp.backOffice.taxRegistered.value && bp.backOffice.taxInvoiceMissing.length > 0 && (
          <p className={s.note}>{t('business.taxMissing', { list: bp.backOffice.taxInvoiceMissing.join(', ') })}</p>
        )}
      </section>
    </>
  );
}

/** Each offer with its price only as the receipt's total, or why there is none and where to set it. */
function Offers({ view }: { view: BlueprintViewLite }) {
  const t = useT();
  return (
    <section className={s.section} aria-label={t('business.offers')}>
      <h2 className={s.heading}>{t('business.offers')}</h2>
      <ul className={s.list}>
        {view.blueprint.offers.map((offer) => {
          const receipt = view.offerReceipts[offer.id] ?? null;
          const total = totalOf(receipt);
          const price = receipt && total ? (
            <span className={s.price}>
              <span className="mono">{total}</span>
              <span className={s.unit}>{t(`business.unit.${offer.pricing.quantityUnit}`)}</span>
              <Receipt id={receipt.id} />
            </span>
          ) : (
            <span className={s.price}>
              <span className={s.quiet}>{offer.pricing.unitPriceMinor === null ? t('business.priceNotSet') : t('business.notPriced')}</span>
              <a className={s.link} href="#/business/prices">{offer.pricing.unitPriceMinor === null ? t('business.setPrice') : t('business.workOut')}</a>
            </span>
          );
          return (
            <Row
              key={offer.id}
              id={`offer-${offer.id}`}
              title={<><span data-offer-name="">{offer.name.value}</span><LabelTag line={offer.name} /></>}
              line={offer.description.value}
              actions={price}
            />
          );
        })}
      </ul>
    </section>
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
