Use when the adapter appears present but nearby devices do not appear.

1. Check service, block state, USB visibility, and current-boot logs:

```bash
systemctl status bluetooth --no-pager --full
rfkill list bluetooth
lsusb | grep -i bluetooth
journalctl -u bluetooth -b --no-pager -n 80
journalctl -k -b --no-pager | grep -i 'Bluetooth\|btusb\|hci'
```

2. Try the scoped Omarchy Bluetooth restart route when the installed command surface provides one.
3. If the controller remains wedged, stop Bluetooth, reload only the locally relevant USB Bluetooth driver modules, then restart the service. Discover loaded modules and controller messages first. Do not unload unrelated networking or input drivers.
4. Confirm an active service, an unblocked adapter, and successful controller initialization in the kernel log.

Repeated failure points to the specific adapter, kernel, firmware, resume timing, or power-management state. Report that evidence rather than assuming a controller model.
