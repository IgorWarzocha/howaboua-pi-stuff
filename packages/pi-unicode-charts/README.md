# @howaboua/pi-unicode-charts

Terminal-native Unicode charts for Pi Markdown. No browser, image, Python, or
raster dependencies.

## Install

```bash
pi install npm:@howaboua/pi-unicode-charts
```

## Use

```chart
type: bar
title: Monthly net change
data:
Jan -8
Feb 5
Mar 12
Apr -3
```

Supported types are `bar`, `line`, `scatter`, `sparkline`, and `heatmap`.
Bar, line, and scatter rows use `Label value`; sparklines accept a row of
numbers; heatmap rows use `Label value value …`. Values may be separated by
whitespace, commas, tabs, or pipes. `histogram` aliases `bar`.

The extension gives the model a short format hint and renders completed
`chart` fences up to 80 columns wide. Charts are display-only: ordinary,
invalid, and unfinished fences remain unchanged, and original messages stay in
the session and model context.
