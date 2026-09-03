Use when the adapter appears present but nearby devices do not appear.

1. Check service, block, USB, and current-boot logs:

```bash
systemctl status bluetooth --no-pager --full
rfkill list bluetooth
lsusb | grep -i bluetooth
journalctl -u bluetooth -b --no-pager -n 80
journalctl -k -b --no-pager | grep -i 'Bluetooth\|btusb\|hci0'
```

Use the kernel log to identify the controller, driver, firmware, and exact initialization failure. Do not assume every adapter is `hci0` or Intel.

2. Try the scoped helper:

```bash
omarchy restart bluetooth
```

3. If a USB controller remains wedged, identify its loaded Bluetooth modules with `lsmod` and the kernel log. Stop Bluetooth, unload only the applicable vendor modules and `btusb`, reload `btusb`, then start the service:

```bash
sudo systemctl stop bluetooth
lsmod | rg '^(btusb|btintel|btbcm|btrtl|btmtk)\b'
# Construct and run a scoped `sudo modprobe -r ...` from this evidence.
sudo modprobe btusb
sudo systemctl start bluetooth
```

4. Confirm an active service, an unblocked adapter, and successful firmware initialization in the kernel log.

If unloading a module fails because it is in use, inspect its dependents rather than forcing removal. Repeated failure can indicate a kernel or firmware regression, hardware fault, or boot or resume timing problem.
