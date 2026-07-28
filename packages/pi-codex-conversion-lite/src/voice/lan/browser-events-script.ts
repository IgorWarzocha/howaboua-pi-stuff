export const LAN_VOICE_BROWSER_EVENTS_SCRIPT = String.raw`
function connectBrowserEvents({ clientId, connection, activity, activityState, activityText, composer, audio, report, errorData }) {
  const events = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
  events.onopen = () => {
    connection.classList.add('online');
    connection.lastElementChild.textContent = 'Connected';
    report('sse.open');
  };
  events.onerror = () => {
    connection.classList.remove('online');
    connection.lastElementChild.textContent = 'Reconnecting';
    report('sse.error', { readyState:events.readyState });
  };
  events.onmessage = (event) => {
    try {
      const command = JSON.parse(event.data);
      report('sse.message', command);
      audio.handleServerCommand(command);
      if (command.type === 'draft') composer.applyDraft(command);
      if (command.type === 'sent') composer.markSent();
      if (command.type === 'activity') {
        if (command.state === 'working') {
          activity.hidden = false;
          activityState.textContent = 'Working…';
          activityText.textContent = '';
        } else if (command.state === 'settled' && typeof command.text === 'string' && command.text) {
          activity.hidden = false;
          activityState.textContent = '';
          activityText.textContent = command.text;
        } else {
          activity.hidden = true;
          activityState.textContent = '';
          activityText.textContent = '';
        }
      }
    } catch (error) {
      report('sse.message_error', errorData(error));
    }
  };
  return events;
}
`;
