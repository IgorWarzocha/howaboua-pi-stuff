# Browser

This is the final legacy command-backed browser example. For the maintained browser in ordinary Pi, Code Mode and Notebook Mode, install:

```bash
pi install npm:@howaboua/pi-browser
```

The extension adds typed Pi schemas, persistent CDP sessions, configurable hosts and automatic remote-worker deployment. Do not load this custom tool alongside it.

Use for rendered evidence or interaction in an existing CDP-enabled browser. Start with `tabs`, open one returned `ref_id`, then use the numbered element references from the page result.

Use `find` before `click` or `type` when the target is not already visible. Keep a browser result's `ref_id` and element IDs together. Read truncated results through the returned continuation rather than reopening the same page blindly.

Do not close a shared browser. Do not enable SSH routing, start a browser, alter CDP configuration, or configure remote paths unless the user asked for that setup. Ask before consequential external actions such as sending, posting, purchasing, uploading, deleting, or changing account settings.

The tool returns bounded page content, element references, and screenshot paths. Use raw CDP operations only when the bounded operations cannot express the needed inspection.
