Use while connected remotely when the physical display is blank or the Quattro lock surface is active.

Quattro's lock is an Omarchy Shell service. Do not infer lock state from a `hyprlock` process. Never kill Quickshell while it owns a session lock, and never collect or inject the user's password remotely.

1. Find the active local Wayland session. Do not assume a session ID:

```bash
graphical_session=$(
  for id in $(loginctl list-sessions --no-legend | awk -v uid="$(id -u)" '$2 == uid { print $1 }'); do
    if [[ $(loginctl show-session "$id" -p Type --value) == wayland ]] &&
       [[ $(loginctl show-session "$id" -p Active --value) == yes ]]; then
      printf '%s\n' "$id"
      break
    fi
  done
)

if [[ -n $graphical_session ]]; then
  loginctl show-session "$graphical_session" \
    -p Name -p Type -p Class -p Active -p State -p LockedHint -p Remote --no-pager
else
  printf '%s\n' 'No active local Wayland session found' >&2
fi
```

Stop if no active local Wayland session is present.

2. Cross the graphical-session environment boundary. Confirm that UWSM's user-manager environment names the same session, then import only the display and compositor variables into the current remote shell:

```bash
manager_session=$(systemctl --user show-environment | sed -n 's/^XDG_SESSION_ID=//p')
printf 'graphical=%s manager=%s\n' "$graphical_session" "$manager_session"

while IFS='=' read -r key value; do
  case "$key" in
    XDG_RUNTIME_DIR|WAYLAND_DISPLAY|DISPLAY|HYPRLAND_INSTANCE_SIGNATURE)
      export "$key=$value"
      ;;
  esac
done < <(systemctl --user show-environment)

hyprctl monitors -j | jq '.[] | {name, disabled, dpmsStatus, solitaryBlockedBy}'
```

Do not import the environment when its `XDG_SESSION_ID` does not match the selected active Wayland session. Re-establish the current graphical environment first.

3. Inspect the Quattro shell and lock service:

```bash
omarchy shell shell ping
omarchy shell lock status | jq .
```

The shell's `locked`, `sessionLocked`, and `secure` values are authoritative for the Quattro lock. `loginctl`'s `LockedHint` is supporting evidence and may remain `no`.

4. Wake the physical display without unlocking it:

```bash
omarchy system wake
hyprctl monitors -j | jq '.[] | {name, disabled, dpmsStatus, solitaryBlockedBy}'
omarchy shell lock status | jq .
```

If the lock remains active, have the user authenticate at the physical lock surface. Omarchy exposes no remote unlock IPC.

If the shell is absent or unresponsive, inspect the Quickshell process and current user journal before restarting it. A failed lock client can leave the compositor holding a session lock. Use `omarchy restart shell` only after confirming the shell itself needs recovery, then query `lock status` again.
