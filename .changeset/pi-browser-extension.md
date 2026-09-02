---
"@howaboua/pi-browser": patch
---

Publish a persistent typed CDP browser extension for normal Pi, Code Mode, and Notebook Mode, with `/browser` settings and SSH routing through an automatically deployed bundled worker.

Remote routing preserves split UTF-8, cancels daemon work on disconnect, and secures fallback worker sockets.

New tabs enforce HTTP and HTTPS navigation, and failed navigation cannot leave an unhandled load waiter.
