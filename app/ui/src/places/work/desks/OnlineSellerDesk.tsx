/**
 * The Online seller and seller services desk on Work (Ink v2 wave 5, packages 5F1, 5F2, 5F3). Package 5-0 left it a
 * stub that says it is not built yet; the package replaces this file with the desk (it may import parts of its own
 * from other files).
 */

import { useT } from '../../../text';

export function OnlineSellerDesk() {
  const t = useT();
  return <p>{t('kit-desk.notBuilt')}</p>;
}
