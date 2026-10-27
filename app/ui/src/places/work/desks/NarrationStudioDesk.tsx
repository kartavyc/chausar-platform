/**
 * The Narration and audiobooks desk on Work (Ink v2 wave 5, packages 5Q). Package 5-0 left it a stub that says it is
 * not built yet; the package replaces this file with the desk (it may import parts of its own from other files).
 */

import { useT } from '../../../text';

export function NarrationStudioDesk() {
  const t = useT();
  return <p>{t('kit-desk.notBuilt')}</p>;
}
