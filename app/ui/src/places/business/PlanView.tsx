import {playbookLabel} from '../../text/playbook-label';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { Tile } from '../../parts/Tile';
import { SERVICE_TYPES, type BlueprintLite, type BlueprintPatchLite, type BlueprintViewLite } from '../../engine/types';
import { LabelTag, PendingPlanRows, TileSection, messageOf, quoteAgain, takePlanFocus, totalOf, usePlan } from './shared';
import { RulesSection } from './RulesSection';
import { Recipes } from './Recipes';
import s from './Business.module.css';
import fields from '../../parts/Field.module.css';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import { LoadingPlace } from '../../parts/Skeleton';
import { shownStepNote } from '../../../../../platform/runtime/venture/views/plan-sections';
import { usePlanWords } from '../today/plan-words';

/** A job or duty as a sentence, as the plan sheet writes a team line (views/plan-sections.ts). */
const asSentence = (text: string) => { const words = text.trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };

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
  // Read on another settings page brought the owner here (shared.tsx readPlan): the plan's name takes focus once shown.
  const shown = plan.data !== undefined && plan.data !== null;
  useEffect(() => { if (shown && takePlanFocus()) document.getElementById('business-plan-name')?.focus(); }, [shown]);

  if (plan.error) return <p className={s.problem} role="alert">{t('business.failed', { message: plan.error.message })}</p>;
  if (plan.data === undefined) return <LoadingPlace shape="settings" />;
  if (plan.data === null) {
    return <EmptyState title={t('business.noPlan')} line={t('business.noPlanLine')} actions={[{ label: t('business.week.onToday'), href: '#/today' }]} />;
  }
  const view = plan.data;
  const bp = view.blueprint;
  // The playbook's own label when the idea picked a flagship playbook; else the service type's label.
  // The plain service type's label ("Service business") names no kind of work: over a business with its own name it
  // reads as that business's name (seen on Windows, 15 Nov 2026), so it is not said; the version stands alone.
  const kind = playbookLabel(t,view.playbook) ?? (bp.serviceType === 'other' ? null : SERVICE_TYPES.includes(bp.serviceType) ? t(`business.kind.${bp.serviceType}`) : bp.serviceType);
  const version = t(bp.status === 'accepted' ? 'business.versionAccepted' : 'business.versionDraft', { version: bp.version });
  // Words Chausar assumed are the owner's once the plan is accepted: "assumption" is said only on a plan still to accept.
  const accepted = bp.status === 'accepted';
  // The plan the owner kept (the engine's `kept`, the same parts the plan sheet on Today lays out): who pays leads in
  // place of the template's "who it is for", and the way and the hired team have their own sections.
  const way = view.kept?.way ?? null;
  const team = view.kept?.team ?? [];

  return (
    <div className={s.page}>
      <PendingPlanRows onDecided={plan.reload} />
      <div className={s.split} data-ratio="8-4">
        <Tile as="section" labelledBy="business-plan-name">
          <div className={s.body}>
            <p className={s.kind}>{kind ? `${kind} · ` : ''}{version}{bp.source === 'template' ? ` · ${t('business.fromTemplates')}` : ''}</p>
            <h2 id="business-plan-name" tabIndex={-1} className={s.name}>{bp.name.value}<LabelTag line={bp.name} accepted={accepted} /></h2>
            <p className={s.lead}>{bp.oneLiner.value}<LabelTag line={bp.oneLiner} accepted={accepted} /></p>
            {way
              ? <p className={s.line} data-content="">{t('business.kept.whoPays', { customer: way.customer })}</p>
              : <p className={s.line}>{t('business.for', { customer: bp.customer.value })}<LabelTag line={bp.customer} accepted={accepted} /></p>}
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
      {(way || team.length > 0) && (
        <div className={s.split}>
          {way && (
            <TileSection title={t('business.kept.earn')}>
              <ul className={s.list} data-content="">
                <li className={s.line}>{t('business.kept.reach', { text: way.reach })}</li>
                <li className={s.line}>{t('business.kept.teamDoes', { text: way.teamDoes })}</li>
                <li className={s.line}>{t('business.kept.youDo', { text: way.youDo })}</li>
              </ul>
            </TileSection>
          )}
          {team.length > 0 && (
            <TileSection title={t('business.kept.team')} more={{ href: '#/team', label: t('business.kept.openTeam') }}>
              <ul className={s.list}>
                {team.map((agent) => (
                  <li key={agent.name} className={s.line} data-content=""><strong>{agent.name}</strong>: {[agent.job, ...agent.duties].map(asSentence).join(' ')}</li>
                ))}
              </ul>
              <p className={s.note}>{t('business.kept.teamNever')}</p>
              <p className={s.note}>{t('business.kept.teamAsks')}</p>
            </TileSection>
          )}
        </div>
      )}
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
                    {step.title.value}<LabelTag line={step.title} accepted={accepted} />
                    <span className={s.stepWho}>{step.doneBy === 'you' && step.capability === 'planned' ? t('business.who.youPlanned') : `${t(`business.doneBy.${step.doneBy}`)} · ${t(`business.capability.${step.capability}`)}`}</span>
                  </li>
                ))}
              </ol>
              <Fold summary={t('business.stepsMore')} className={s.fold}>
                <div className={s.foldBody}>
                  {/* The stored note is part of the plan's structure; what is shown follows the plan sheet's rule (shownStepNote). */}
                  {bp.deliverySteps.map((step) => <p key={step.id} className={s.line}>{step.title.value}: {shownStepNote(step.note, bp.serviceType)}</p>)}
                </div>
              </Fold>
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
      <Recipes />
    </div>
  );
}

/**
 * This week from the chief's standing plan (venture.chief.plan.get): the moves in order, a tick on each one done and
 * every state said aloud in the engine's words. The plan itself, with each state in words and its next best step, is
 * on Today.
 */
function Setup() {
  const t = useT();
  const planWords = usePlanWords();
  const plan = useResource('venture.chief.plan.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const moves = plan.data?.moves;
  if (!moves || moves.length === 0) return null;
  return (
    <TileSection title={t('business.week.title')} more={{ href: '#/today', label: t('business.week.onToday') }}>
      <ul className={s.list} data-week-moves="">
        {moves.map((move) => (
          <li key={move.id} className={cx(s.line, s.checkItem)} data-state={move.state}>
            {move.state === 'done' && <span data-done="" className={s.tick}><Icon name="check" size={14} /></span>}
            <span>{planWords(move.text)}</span>
            {/* The state is one of five the engine names by code, so the app says it from its own pack (Hindi too). */}
            <span className="sr-only">{t(`state.move.${move.state}`)}</span>
          </li>
        ))}
      </ul>
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
        <Fold summary={t('business.taxDetails')} className={s.fold}>
          <div className={s.foldBody}>
            <p className={s.line} data-tax-line="">{t('business.taxRegisteredLine', { tax: office.taxLabel })}<LabelTag line={office.taxRegistered} /></p>
            {office.taxInvoiceMissing.length > 0 && (
              <p className={s.note} data-tax-line="">{t('business.taxMissing', { list: office.taxInvoiceMissing.join(', ') })}</p>
            )}
          </div>
        </Fold>
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
      <h3 id={titleId} className={s.offerTitle}><span data-offer-name="">{offer.name.value}</span><LabelTag line={offer.name} accepted={view.blueprint.status === 'accepted'} /></h3>
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
  const business = useResource('venture.get', {});
  const countries = useResource('venture.countries', {});
  const initialCountry = plan.country?.code ?? business.data?.venture.country?.code ?? '';
  const [countryChoice, setCountryChoice] = useState<string | null>(null);
  const countryCode = countryChoice ?? initialCountry;
  const countryId = useId();
  const [name, setName] = useState(plan.name.value);
  const [oneLiner, setOneLiner] = useState(plan.oneLiner.value);
  const [customer, setCustomer] = useState(plan.customer.value);
  /** C4 task 1: offers the owner added that are marked to take out, and a new offer's name. */
  const [takeOut, setTakeOut] = useState<readonly string[]>([]);
  const [newOffer, setNewOffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch: BlueprintPatchLite = {};
    if (countryCode && countryCode !== initialCountry) patch.countryCode = countryCode;
    if (name.trim() && name.trim() !== plan.name.value) patch.name = name.trim();
    if (oneLiner.trim() && oneLiner.trim() !== plan.oneLiner.value) patch.oneLiner = oneLiner.trim();
    if (customer.trim() && customer.trim() !== plan.customer.value) patch.customer = customer.trim();
    // C4 task 1: a new offer has no price yet (Set your prices names it); its one line is its name until the owner writes one.
    const adding = newOffer.trim();
    if (adding.length >= 2) patch.addOffer = { name: adding, description: adding, pricingModel: 'project' };
    if (Object.keys(patch).length === 0 && takeOut.length === 0) { setProblem(t('business.nothingChanged')); return; }
    setBusy(true);
    setProblem(null);
    try {
      // The engine takes out one offer per change: each one first, then the rest of the change.
      for (const id of takeOut) await client.request('venture.blueprint.update', { patch: { removeOffer: { id } } });
      if (Object.keys(patch).length > 0) await client.request('venture.blueprint.update', { patch });
      await quoteAgain(client);
      onDone();
    } catch (error) {
      setProblem(t('business.saveFailed', { message: messageOf(error) }));
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void save(event)}>
      <Select label={t('business.country')} id={countryId} value={countryCode} onChange={event => setCountryChoice(event.currentTarget.value)} hint={countryCode !== initialCountry ? t('business.countryChange') : undefined}>
          {(countries.data ?? []).map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </Select>
      <Field label={t('business.fieldName')} value={name} maxLength={60} onChange={(event) => setName(event.currentTarget.value)} />
      <Field label={t('business.fieldOneLiner')} value={oneLiner} maxLength={160} onChange={(event) => setOneLiner(event.currentTarget.value)} />
      <Field multiline label={t('business.fieldCustomer')} value={customer} maxLength={200} rows={2} onChange={(event) => setCustomer(event.currentTarget.value)} />
      {/* C4 task 1: the offers; one the owner added can be taken out (the plan's own stay), and a new one added. */}
      <fieldset className={fields.field}>
        <legend className={fields.label}>{t('business.offers')}</legend>
        <ul className={s.checks}>
          {plan.offers.map((offer) => (
            <li key={offer.id}>
              {offer.addedByOwner ? (
                <label>
                  <input type="checkbox" checked={!takeOut.includes(offer.id)}
                    onChange={(event) => { const keep = event.currentTarget.checked; setTakeOut((was) => (keep ? was.filter((id) => id !== offer.id) : [...was, offer.id])); }} />
                  {' '}{offer.name.value}
                </label>
              ) : <span>{offer.name.value}</span>}
            </li>
          ))}
        </ul>
      </fieldset>
      <Field label={t('business.addOffer')} value={newOffer} maxLength={60} onChange={(event) => setNewOffer(event.currentTarget.value)} />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        <Button onClick={onCancel}>{t('business.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy}>{t('business.save')}</Button>
      </div>
    </form>
  );
}
