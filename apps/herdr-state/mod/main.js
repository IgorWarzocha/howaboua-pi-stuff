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
      const reports = await Promise.all(targets.map(async machine => {
        const name = machine.name || 'This computer';
        try {
          const response = await exec('herdr-state', [action], { on: machine.name });
          let report;
          try { report = JSON.parse(response.stdout); }
          catch { throw new Error(response.stderr || 'State helper returned no result'); }
          if (response.code !== 0 || report.error) throw new Error(report.error || response.stderr || 'State helper failed');
          const summary = action === 'save'
            ? `${report.sessions} sessions, ${report.terminals} terminals saved`
            : `${report.launched} launches requested, ${report.shells} shells restored, ${report.skipped} already present${report.parked ? `, ${report.parked} previous shells parked` : ''}`;
          return { text: `${name}: ${summary}${report.warnings?.length ? '\n' + report.warnings.join('\n') : ''}`, warning: Boolean(report.warnings?.length) };
        } catch (error) { return { text: `${name}: ${error.message}`, warning: true }; }
      }));
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
