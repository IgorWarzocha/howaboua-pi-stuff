## Freeze or poor responsiveness

Start with current pressure, failed user services, current-boot errors, and blocked or zombie processes:

```bash
uptime
free -h
systemctl --user --failed --no-pager
journalctl --user -b -p err..alert --no-pager
journalctl -k -b --no-pager
ps -eo pid,ppid,state,comm,wchan:30 --sort=state | awk '$3 ~ /D|Z/ {print}'
```

For one stalled application, inspect its process tree, user bus and portals, repeated service timeouts, GPU or kernel resets, OOM evidence, and zombie parents. Do not broaden into unrelated system diagnosis without evidence.

## Heat or unexpected performance

Quattro remembers separate AC and battery power profiles. Establish the current power source, available profiles, remembered state, frequency policy, temperature, and load before changing a profile:

```bash
omarchy powerprofiles list --active-state
powerprofilesctl get
powerprofilesctl query-battery-aware
find ~/.local/state/omarchy/powerprofiles -maxdepth 1 -type f -print -exec cat {} \;
grep . /sys/devices/system/cpu/cpufreq/policy*/energy_performance_preference 2>/dev/null
sensors
```

Use `omarchy powerprofiles set <ac|battery> <profile>` only when the intended source-specific profile is known. Confirm the remembered file and effective profile afterward:

```bash
omarchy powerprofiles set <ac|battery> <profile>
cat ~/.local/state/omarchy/powerprofiles/<ac|battery>
powerprofilesctl get
```

Do not add an unconditional `powerprofilesctl set ...` autostart command. It overrides later choices. If the effective profile drifts from remembered state, inspect `omarchy powerprofiles init` and current service logs before editing config.
