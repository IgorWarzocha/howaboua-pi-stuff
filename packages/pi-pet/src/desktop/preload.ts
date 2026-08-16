import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
  DESKTOP_CURSOR_CHANNEL,
  type DesktopCursorPosition,
  type PiPetDesktopBridge,
  parseDesktopCursorPosition,
} from "./bridge.ts";

const bridge: PiPetDesktopBridge = Object.freeze({
  onCursorPosition(listener: (position: DesktopCursorPosition | null) => void) {
    const receive = (_event: IpcRendererEvent, value: unknown): void => {
      listener(parseDesktopCursorPosition(value));
    };
    ipcRenderer.on(DESKTOP_CURSOR_CHANNEL, receive);
    return () => ipcRenderer.removeListener(DESKTOP_CURSOR_CHANNEL, receive);
  },
});

contextBridge.exposeInMainWorld("piPetDesktop", bridge);
