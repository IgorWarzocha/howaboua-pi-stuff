# @howaboua/pi-sandbox

## 0.1.4

- Fixed TypeScript calls rejecting action objects while equivalent JSON strings worked.
- Fixed concurrent first calls failing while the sandbox client was loading.

## 0.1.3

- - Accept action objects alongside JSON text in Code and Notebook.

## 0.1.2

- Made help discovery consistent in Code and Notebook.

## 0.1.1

- Added Pi Sandbox for persistent local Gondolin environments and app previews.
  - Named instances and reusable prepared templates retain guest files across disk checkpoints and reopen.
  - Managed services provide readiness checks, restart supervision and localhost HTTP and WebSocket previews.
  - Guest commands, file access and temporary SSH terminals work without forwarding host credentials.
