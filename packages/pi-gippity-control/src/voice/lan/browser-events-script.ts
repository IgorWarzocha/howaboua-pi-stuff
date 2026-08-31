export const LAN_VOICE_BROWSER_EVENTS_SCRIPT = String.raw`
function connectBrowserEvents({ client, connection, activity, activityState, activityText }) {
  client.on('connection', (event) => {
    connection.classList.toggle('online', event.state === 'connected');
    connection.lastElementChild.textContent = event.state === 'connected' ? 'Connected' : 'Reconnecting';
  });
  client.on('activity', (command) => {
        if (command.state === 'working') {
          activity.hidden = false;
          activityState.textContent = 'Working…';
          activityText.textContent = '';
        } else if (command.state === 'waiting') {
          activity.hidden = false;
          activityState.textContent = 'Waiting for you';
          activityText.textContent = typeof command.text === 'string' ? command.text : '';
        } else if (command.state === 'settled' && typeof command.text === 'string' && command.text) {
          activity.hidden = false;
          activityState.textContent = '';
          activityText.textContent = command.text;
        } else {
          activity.hidden = true;
          activityState.textContent = '';
          activityText.textContent = '';
        }
  });
}
`;
