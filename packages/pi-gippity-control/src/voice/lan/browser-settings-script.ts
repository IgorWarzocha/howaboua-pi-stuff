export const LAN_VOICE_BROWSER_SETTINGS_SCRIPT = String.raw`
(() => {
  const panel = document.querySelector('#voice-settings');
  const form = document.querySelector('#settings-form');
  const fields = document.querySelector('#settings-fields');
  const status = document.querySelector('#settings-status');
  const reload = document.querySelector('#reload-settings');
  const switches = ['autoResumeRealtime', 'refreshRealtimeAfterCompaction', 'delegationAcknowledgements', 'forwardReasoningSummaries'];
  let loaded = false;
  let busy = false;
  const request = async (options) => {
    const response = await fetch('/api/settings', options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load settings');
    return result;
  };
  const fillSelect = (name, choices, current) => {
    const select = form.elements.namedItem(name);
    select.replaceChildren(...choices.map((choice) => {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }));
    select.value = current;
  };
  const display = (data) => {
    fillSelect('v3Voice', data.voices.map((voice) => ({ value:voice, label:voice })), data.config.v3Voice);
    fillSelect('v3AlternateVoice', data.voices.map((voice) => ({ value:voice, label:voice })), data.config.v3AlternateVoice);
    const modelValue = (model) => JSON.stringify(model);
    const models = data.contextModels.slice();
    const current = data.config.contextModel;
    if (current && !models.some((model) => modelValue(model) === modelValue(current))) models.push(current);
    fillSelect('contextModel', [{value:'null', label:'Off'}, ...models.map((model) => ({
      value:modelValue(model), label:model.provider + '/' + model.modelId,
    }))], modelValue(current));
    fillSelect('contextReasoning', data.contextReasoningLevels.map((level) => ({value:level, label:level})), data.config.contextReasoning);
    for (const key of switches) form.elements.namedItem(key).checked = data.config[key];
    document.querySelector('#settings-scope').textContent = 'Save location: ' + data.scope;
    loaded = true;
  };
  const setBusy = (value) => {
    busy = value;
    fields.disabled = value || !loaded;
    reload.disabled = value;
    form.setAttribute('aria-busy', String(value));
  };
  const load = async () => {
    if (busy) return;
    setBusy(true);
    status.textContent = 'Loading settings…';
    try {
      display(await request());
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message + '. Tap Reload settings to retry.';
    } finally { setBusy(false); }
  };
  panel.addEventListener('toggle', () => { if (panel.open && !loaded) void load(); });
  reload.addEventListener('click', () => { void load(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !loaded) return;
    const patch = {
      v3Voice:form.elements.namedItem('v3Voice').value,
      v3AlternateVoice:form.elements.namedItem('v3AlternateVoice').value,
      contextModel:JSON.parse(form.elements.namedItem('contextModel').value),
      contextReasoning:form.elements.namedItem('contextReasoning').value,
    };
    for (const key of switches) patch[key] = form.elements.namedItem(key).checked;
    setBusy(true);
    status.textContent = 'Saving settings…';
    try {
      display(await request({method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(patch)}));
      status.textContent = 'Saved for the next call. The current call was not restarted.';
    } catch (error) { status.textContent = error.message + '. Your edits are still here; retry Save settings.'; }
    finally { setBusy(false); }
  });
})();
`;
