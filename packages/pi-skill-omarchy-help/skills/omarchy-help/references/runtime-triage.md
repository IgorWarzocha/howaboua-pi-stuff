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

## Heat or power

Check the current power profile, CPU policy, temperature, and recent thermal messages before changing anything:

```bash
powerprofilesctl get
powerprofilesctl query-battery-aware
cat /sys/devices/system/cpu/cpufreq/policy0/energy_performance_preference
sensors
journalctl -k -b --no-pager | rg -i 'thermal|throttl|overheat'
```

Use an installed Omarchy power-management route when it owns the requested change. Do not add an unconditional power-profile command to autostart. It would override later user choices.
