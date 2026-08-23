Use while connected remotely when the physical display is blank or locked.

Never kill the active lock process. A compositor may retain a stale session lock and refuse to reveal the desktop. Never store, request, or handle the user's password.

1. Wake the display and inspect lock state:

```bash
hyprctl dispatch dpms on
pgrep -a 'hyprlock|swaylock|waylock|gtklock' || true
loginctl list-sessions --no-legend
hyprctl monitors
```

2. If the lock process died while the compositor still reports a session lock, use the installed compositor's documented lock-recovery route to restore the lock surface.
3. Have the user enter the password locally.
4. Confirm the lock process exited and the display resumed.
