import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ClawaState } from "../src/protocol/index.ts";

const PROTOCOL = "@howaboua/pi-gippity-control/remote-app/v1";
const AVAILABLE_CHANNEL = `${PROTOCOL}/available`;
const REQUEST_CHANNEL = `${PROTOCOL}/request`;

interface RemoteAppBroker {
  protocol: typeof PROTOCOL;
  isActive(): boolean;
  register(provider: RemoteAppProvider): (() => void) | undefined;
}

interface RemoteAppProvider {
  id: "pi-pet";
  root: string;
  snapshot(): ClawaState;
  subscribe(listener: (update: { state: ClawaState }) => void): () => void;
}

export interface RemoteAppRegistration {
  readonly available: boolean;
  dispose(): void;
}

function isBroker(value: unknown): value is RemoteAppBroker {
  if (!value || typeof value !== "object") return false;
  const broker = value as Partial<RemoteAppBroker>;
  return broker.protocol === PROTOCOL && typeof broker.isActive === "function" && typeof broker.register === "function";
}

export function registerRemoteApp(
  pi: Pick<ExtensionAPI, "events" | "on">,
  provider: RemoteAppProvider,
): RemoteAppRegistration {
  let broker: RemoteAppBroker | undefined;
  let unregisterProvider: (() => void) | undefined;
  let disposed = false;
  const unregisterAvailable = pi.events.on(AVAILABLE_CHANNEL, (value) => {
    if (disposed || !isBroker(value) || value === broker) return;
    unregisterProvider?.();
    broker = value;
    unregisterProvider = value.register(provider);
  });
  const registration: RemoteAppRegistration = {
    get available() {
      return !disposed && Boolean(unregisterProvider && broker?.isActive());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unregisterAvailable();
      unregisterProvider?.();
      unregisterProvider = undefined;
      broker = undefined;
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  pi.events.emit(REQUEST_CHANNEL, { protocol: PROTOCOL });
  return registration;
}
