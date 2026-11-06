import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';

/**
 * D12 task 10: a business this version couldn't bring up to date stays as it was, and the desktop can go back to the release
 * it kept. The button shows only when main has checked that release again; pressing it asks in main's own dialog, naming
 * both versions, and only that yes moves anything.
 */
export function GoBackOffer() {
  const t = useT();
  const client = useEngine();
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void client.goBackOffer?.().then((offer) => { if (live) setVersion(offer?.version ?? null); }, () => { /* no offer */ });
    return () => { live = false; };
  }, [client]);
  if (!version) return null;
  return (
    <Button disabled={busy} aria-busy={busy || undefined} onClick={() => { setBusy(true); void client.goBack?.().finally(() => setBusy(false)); }}>
      {t('onboarding.welcome.goBack', { version })}
    </Button>
  );
}
