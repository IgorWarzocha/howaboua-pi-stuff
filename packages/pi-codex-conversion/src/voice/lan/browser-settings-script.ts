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
  const updateProvider = () => {
    const apiModel = form.elements.namedItem('model').value !== 'codex-live-1.1';
    for (const element of form.querySelectorAll('[data-codex-voice]')) element.hidden = apiModel;
    for (const element of form.querySelectorAll('[data-realtime-voice]')) element.hidden = !apiModel;
    document.querySelector('#setting-model-requirement').textContent = apiModel
      ? 'Uses the named Pi provider\'s API key and endpoint. API usage is billed separately; a ChatGPT login is not an API key.'
      : 'Uses your OpenAI Codex login in Pi.';
  };
  form.elements.namedItem('model').addEventListener('change', updateProvider);
  const display = (data) => {
    const modelLabel = (model) => model === 'realtime-2.1' ? 'GPT-Realtime-2.1 (API)'
      : model === 'realtime-2.1-mini' ? 'GPT-Realtime-2.1 Mini (API)' : 'Codex Live (OAuth)';
    fillSelect('model', data.voiceModels.map((model) => ({value:model, label:modelLabel(model)})), data.config.model);
    form.elements.namedItem('apiProvider').value = data.config.apiProvider;
    fillSelect('realtimeVoice', data.realtimeVoices.map((voice) => ({value:voice, label:voice})), data.config.realtimeVoice);
    fillSelect('realtimeAlternateVoice', data.realtimeVoices.map((voice) => ({value:voice, label:voice})), data.config.realtimeAlternateVoice);
    form.elements.namedItem('webSearch').checked = data.config.webSearch;
    updateProvider();
    document.querySelector('#setting-web-search-requirement').textContent = data.webSearchAvailable === false
      ? 'Web Run is not loaded. Load the Web Run extension in Pi and set up its account, or leave search off.'
      : 'Requires the Web Run extension and its account setup.';
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
    document.querySelector('#setting-task-delegation-model').textContent = data.config.taskDelegationModel;
    fillSelect('taskDelegationReasoning', data.contextReasoningLevels.map((level) => ({value:level, label:level})), data.config.taskDelegationReasoning);
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
      model:form.elements.namedItem('model').value,
      contextModel:JSON.parse(form.elements.namedItem('contextModel').value),
      contextReasoning:form.elements.namedItem('contextReasoning').value,
    };
    if (patch.model === 'codex-live-1.1') {
      patch.taskDelegationReasoning = form.elements.namedItem('taskDelegationReasoning').value;
      patch.v3Voice = form.elements.namedItem('v3Voice').value;
      patch.v3AlternateVoice = form.elements.namedItem('v3AlternateVoice').value;
    } else {
      patch.realtimeVoice = form.elements.namedItem('realtimeVoice').value;
      patch.realtimeAlternateVoice = form.elements.namedItem('realtimeAlternateVoice').value;
      patch.apiProvider = form.elements.namedItem('apiProvider').value;
      patch.webSearch = form.elements.namedItem('webSearch').checked;
    }
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
