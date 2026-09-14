import { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdate({ matchActive }: { matchActive: boolean }) {
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!ready || matchActive) return null;

  const refresh = async () => {
    setBusy(true);
    setFailed(false);
    try { await updateServiceWorker(true); }
    catch { setFailed(true); setBusy(false); }
  };

  return <aside className="update-notice" role="status" aria-label="Game update">
    <RotateCcw size={19}/>
    <span>{failed ? 'Update failed. Try again when connected.' : 'A game update is ready.'}</span>
    <button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Updating...' : 'Update & reload'}</button>
    <button className="icon-button" disabled={busy} aria-label="Dismiss update" onClick={() => setReady(false)}><X size={17}/></button>
  </aside>;
}