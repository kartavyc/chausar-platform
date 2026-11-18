import { useT } from '../text';
import { NO_TOOL_ON_CARD } from '../../../../platform/runtime/venture/customers/find-words';
import s from './ApprovalRow.module.css';

/** Where a lead tool is connected: the MCP servers form on Connections (the Find customers sheet sends the owner there too). */
export const LEAD_TOOL_HREF = '#/connections/ai';

/**
 * The way to connect a lead tool, beside a card whose own words say none is connected ("No lead tool is connected; you
 * can add one in Connections.", the engine's sentence on a public map search). Code decides it from that exact
 * sentence, so words that name a place always carry the way there. Any other card shows nothing.
 */
export function LeadToolLink({ line }: { line: string | undefined }) {
  const t = useT();
  if (!line || !line.includes(NO_TOOL_ON_CARD)) return null;
  return <p className={s.note}><a href={LEAD_TOOL_HREF} data-connect-lead-tool="">{t('clients.find.connect')}</a></p>;
}
