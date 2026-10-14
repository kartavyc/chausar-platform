/**
 * An outside address (SH-10): through the host's link dialog, which shows the full address and
 * opens the browser only after the person agrees. Without that dialog, the address is text only.
 */
import { Button } from '../../../parts/Button';

export function OutsideLink({ url, label, openLink }: { url: string; label: string; openLink?: ((url: string) => void) | undefined }) {
  if (openLink === undefined) return <span>{label}</span>;
  return <Button variant="link" onClick={() => openLink(url)}>{label}</Button>;
}
