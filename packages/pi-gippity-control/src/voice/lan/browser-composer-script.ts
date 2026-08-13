export const LAN_VOICE_BROWSER_COMPOSER_SCRIPT = String.raw`
function createComposer({ draft, send, status, client }) {
  let sendBusy = false;

  const setStatus = (message = '') => { status.textContent = message; };
  const updateControls = () => {
    draft.disabled = sendBusy || client.draft.revision < 0;
    send.disabled = sendBusy || client.draft.revision < 0 || !draft.value.trim();
  };
  const sendDraft = async () => {
    if (sendBusy || !draft.value.trim()) return;
    sendBusy = true;
    send.textContent = 'Sending…';
    updateControls();
    setStatus('Sending…');
    try {
      await client.send(draft.value);
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
    if (typeof command.text !== 'string' || typeof command.revision !== 'number') return;
    const start = draft.selectionStart;
    const end = draft.selectionEnd;
    draft.value = command.text;
    if (document.activeElement === draft) draft.setSelectionRange(Math.min(start, draft.value.length), Math.min(end, draft.value.length));
    updateControls();
  };

  client.on('draft', applyDraft);
  client.on('sent', () => setStatus('Sent'));
  client.on('dictation.complete', () => setStatus('Transcript ready'));
  client.on('error', (error) => { if (error.source === 'draft') setStatus(error.message); });
  draft.addEventListener('input', () => { setStatus(); client.setDraft(draft.value); updateControls(); });
  draft.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendDraft(); }
  });
  send.addEventListener('click', () => void sendDraft());
  updateControls();

  return {
    setStatus,
    snapshot: () => ({ text:draft.value, revision:client.draft.revision, selectionStart:draft.selectionStart, selectionEnd:draft.selectionEnd }),
  };
}
`;
