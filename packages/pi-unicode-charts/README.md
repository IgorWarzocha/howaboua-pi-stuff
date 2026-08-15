# @howaboua/pi-unicode-charts

Terminal-native Unicode charts for Pi. The extension transforms explicit
`chart` Markdown fences into width-aware bars, lines, scatter plots, sparklines,
and heatmaps. It uses no image, browser, Python, or raster dependencies.

## Install

```bash
pi install npm:@howaboua/pi-unicode-charts
```

The extension adds a small chart-format hint to the model prompt and renders
completed chart fences in user and assistant Markdown. It leaves ordinary code
blocks and invalid charts unchanged.

## Format

Use one data point per line. The value may be separated with whitespace,
commas, tabs, or pipes.

```chart
type: bar
title: Requests by endpoint
data:
GET /users 120
POST /users 80
GET /health 42
```

```chart
type: line
title: Latency
data:
Mon 42
Tue 51
Wed 47
Thu 63
Fri 58
```

```chart
type: sparkline
data:
12 18 15 23 31 28 36 42 38 45
```

Heatmaps use one row label followed by numeric cells:

```chart
type: heatmap
title: Activity
data:
Mon 1 2 4 3 1
Tue 2 4 4 2 1
Wed 1 3 2 1 0
```

Supported types are `bar`, `line`, `scatter`, `sparkline`, and `heatmap`.
`histogram` is accepted as an alias for `bar`.
