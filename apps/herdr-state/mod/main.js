import { View, div, svg } from 'gpui-kit';
import { h_flex, Button } from 'gpui-base';
import { theme, machines, exec, notify, layout, props, openOverlay } from 'herdr';

export default class State extends View {
  init() { this.busy = null; }

  act(action, cx) {
    if (this.busy) return;
    const targets = machines();
    this.busy = action;
    cx.notify();
    cx.spawn(async cx => {
      let reports;
      try {
        // A single coordinator inventories the fleet before allocating sessions.
        // Per-machine parallel restores cannot exclude duplicates or order parents.
        const response = await exec('herdr-state', [action, JSON.stringify(targets.map(m => m.name))]);
        let result;
        try { result = JSON.parse(response.stdout); }
        catch { throw new Error(response.stderr || 'State helper returned no result'); }
        if (!Array.isArray(result.reports)) throw new Error(result.error || 'Update State on this computer to use fleet recovery');
        reports = result.reports.map(report => {
          const summary = report.error || (action === 'save'
            ? `${report.sessions} sessions, ${report.terminals} terminals saved`
            : `${report.launched} launches requested, ${report.shells} shells restored, ${report.skipped} already present${report.parked ? `, ${report.parked} previous shells parked` : ''}`);
          return { text: `${report.core}${report.terminal ? '/' + report.terminal : ''}: ${summary}${report.warnings?.length ? '\n' + report.warnings.join('\n') : ''}`,
            warning: Boolean(report.error || report.warnings?.length) };
        });
      } catch (error) { reports = [{ text: error.message, warning: true }]; }
      notify({ title: action === 'save' ? 'State save' : 'State restore',
        body: reports.map(r => typeof r === 'string' ? r : r.text).join('\n\n'),
        level: reports.some(r => typeof r === 'string' || r.warning) ? 'warning' : 'info', timeout: 15000 });
      this.busy = null;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const find = node => node?.id === 'sidebar' ? node : node?.children?.map(find).find(Boolean);
    const narrow = !props()?.expanded && (find(layout())?.size?.px ?? 268) < 160;
    if (narrow) return h_flex().size_full().items_center().justify_center().bg(t.chrome)
      .child(Button.new('state-rail').size(28).rounded(5).text_color(t.muted).tooltip('Save or restore State')
        .accessibility_label('Save or restore State')
        .on_click(() => openOverlay({ mod: 'state', props: { expanded: true }, kind: 'popup', width: 224, height: 42, at: 'pointer' }))
        .child(svg('mods/state/state.svg').size(15)));
    const button = (action, label, icon) => Button.new(`state-${action}`).size(28).rounded(5)
      .accessibility_label(`${label} workspace state`).tooltip(`${label} workspace state`).disabled(Boolean(this.busy))
      .text_color(this.busy ? t.dim : t.muted)
      .when(!this.busy, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_click((_event, cx) => this.act(action, cx))
      .child(this.busy === action ? svg('mods/state/spinner.svg').size(15).spin(900) : svg(`mods/state/${icon}.svg`).size(15));
    return h_flex().size_full().items_center().px(8).gap(3).bg(t.chrome)
      .border_t(1).border_color(t.border).text_size(12)
      .child(div().flex_1().text_color(t.dim).child('State'))
      .child(button('save', 'Save', 'state')).child(button('restore', 'Restore', 'restore'));
  }
}
