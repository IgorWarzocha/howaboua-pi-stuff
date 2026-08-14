export const LAN_VOICE_BROWSER_AUDIO_SCRIPT = String.raw`
function createAudioController({ button, muteButton, audioState, audioDetail, modeButtons, composer, client }) {
  let selectedMode = 'conversation';

  const setStatus = (title, message = '') => { audioState.textContent = title; audioDetail.textContent = message; };
  const render = (audio) => {
    const active = audio.active;
    const busy = audio.busy;
    const mode = active || busy ? audio.mode : selectedMode;
    button.disabled = false;
    button.dataset.mode = mode;
    button.setAttribute('aria-busy', String(busy));
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? (mode === 'dictation' ? 'Finish dictation' : 'Stop voice') : (mode === 'dictation' ? 'Start dictation' : 'Start voice'));
    muteButton.hidden = mode !== 'conversation' || !active;
    muteButton.disabled = busy || !active || mode !== 'conversation';
    muteButton.setAttribute('aria-pressed', String(audio.muted));
    muteButton.setAttribute('aria-label', audio.muted ? 'Unmute microphone' : 'Mute microphone');
    muteButton.lastElementChild.textContent = audio.muted ? 'Unmute mic' : 'Mute mic';
    modeButtons.forEach((item) => {
      item.disabled = busy || active;
      item.setAttribute('aria-pressed', String(item.dataset.mode === selectedMode));
    });
    const labels = {
      idle: mode === 'dictation' ? 'Tap to start dictation' : 'Tap to start voice',
      opening:'Opening microphone…', connecting:'Connecting…', summarizing:'Summarizing conversation…',
      listening:'Listening', recording:'Recording', muted:'Microphone muted', transcribing:'Transcribing…',
      replaced:'Moved to another device', error:'Could not start',
    };
    setStatus(labels[audio.state] || audio.state, audio.detail || (audio.state === 'recording' ? 'Tap to finish' : audio.state === 'listening' ? 'Tap to stop' : ''));
  };

  client.on('audio', render);
  button.addEventListener('click', () => {
    const audio = client.audio.state;
    if (audio.active || audio.busy) client.audio.stop(composer.snapshot());
    else void client.audio.start(selectedMode);
  });
  muteButton.addEventListener('click', () => client.audio.setMuted(!client.audio.state.muted));
  modeButtons.forEach((item) => item.addEventListener('click', () => {
    if (client.audio.state.active || client.audio.state.busy) return;
    selectedMode = item.dataset.mode;
    render({ ...client.audio.state, mode:selectedMode });
  }));
  render(client.audio.state);

  return {};
}
`;
