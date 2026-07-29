export const LAN_VOICE_BROWSER_COMPOSER_SCRIPT = String.raw`
function createComposer({ draft, send, status, clientId, post }) {
  let sendBusy = false;
  let timer;
  let revision = -1;
  let dirty = false;
  let syncing = false;
  let syncPromise;

  const setStatus = (message = '') => { status.textContent = message; };
  const updateControls = () => {
    draft.disabled = sendBusy || revision < 0;
    send.disabled = sendBusy || revision < 0 || !draft.value.trim();
  };
  const scheduleSync = () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 180);
  };
  const flush = async () => {
    if (syncing) return syncPromise;
    if (!dirty || revision < 0) return true;
    syncing = true;
    syncPromise = (async () => {
      while (dirty) {
        dirty = false;
        const text = draft.value;
        try {
          const result = await post('/api/draft', { text, revision });
          if (typeof result.revision === 'number') revision = Math.max(revision, result.revision);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
      return true;
    })();
    try { return await syncPromise; }
    finally { syncing = false; syncPromise = undefined; }
  };
  const sendDraft = async () => {
    if (sendBusy || !draft.value.trim()) return;
    sendBusy = true;
    send.textContent = 'Sending…';
    updateControls();
    setStatus('Sending…');
    try {
      clearTimeout(timer);
      if (!await flush()) throw new Error('Draft could not sync. Try sending again.');
      const text = draft.value;
      await post('/api/send', { text, revision });
      draft.value = '';
      setStatus('Sent');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      sendBusy = false;
      send.textContent = 'Send';
      updateControls();
    }
  };
  const applyDraft = (command) => {
    if (typeof command.text !== 'string' || typeof command.revision !== 'number' || command.revision < revision) return;
    const preserveLocal = command.sourceClientId === clientId && command.reason === 'update' && (dirty || syncing) && draft.value !== command.text;
    revision = command.revision;
    if (preserveLocal) { updateControls(); return; }
    if (command.sourceClientId !== clientId) {
      clearTimeout(timer);
      dirty = false;
    }
    const start = draft.selectionStart;
    const end = draft.selectionEnd;
    draft.value = command.text;
    if (document.activeElement === draft) draft.setSelectionRange(Math.min(start, draft.value.length), Math.min(end, draft.value.length));
    updateControls();
  };

  draft.addEventListener('input', () => { setStatus(); scheduleSync(); updateControls(); });
  draft.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendDraft(); }
  });
  send.addEventListener('click', () => void sendDraft());
  updateControls();

  return {
    applyDraft,
    markSent: () => setStatus('Sent'),
    setStatus,
    snapshot: () => ({ text:draft.value, revision, selectionStart:draft.selectionStart, selectionEnd:draft.selectionEnd }),
    pagehide: () => {
      clearTimeout(timer);
      navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.value, revision })], {type:'application/json'}));
    },
  };
}
`;
