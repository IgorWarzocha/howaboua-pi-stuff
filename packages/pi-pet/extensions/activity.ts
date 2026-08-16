import type { AgentActivity } from "../src/protocol/index.ts";

export interface ActivityUpdate {
  activity: AgentActivity;
  note: string;
}

export class ActivityCoordinator {
  readonly #tools = new Map<string, string>();
  #current: ActivityUpdate = { activity: "idle", note: "Session idle" };

  current(): ActivityUpdate {
    return this.#current;
  }

  reset(): ActivityUpdate {
    this.#tools.clear();
    return this.#set("idle", "Session idle");
  }

  agentStarted(): ActivityUpdate {
    return this.#set("working", "Thinking");
  }

  turnStarted(): ActivityUpdate {
    return this.#set("working", "Thinking");
  }

  toolStarted(id: string, name: string): ActivityUpdate {
    this.#tools.set(id, name);
    return this.#activeToolState();
  }

  toolEnded(id: string, name: string, failed: boolean): ActivityUpdate {
    this.#tools.delete(id);
    if (failed) return this.#set("failed", `${name} failed`);
    return this.#tools.size > 0 ? this.#activeToolState() : this.#set("working", "Thinking");
  }

  settled(): ActivityUpdate {
    this.#tools.clear();
    return this.#set("settled", "Ready for review");
  }

  #activeToolState(): ActivityUpdate {
    const waiting = [...this.#tools.values()].some((name) => name === "ask");
    if (waiting) return this.#set("waiting", "Waiting for your answer");
    return this.#set("working", `Using ${this.#tools.values().next().value || "tools"}`);
  }

  #set(activity: AgentActivity, note: string): ActivityUpdate {
    this.#current = { activity, note };
    return this.#current;
  }
}

export class LatestActivityPublisher {
  readonly #send: (update: ActivityUpdate) => Promise<void>;
  readonly #onError: (error: unknown) => void;
  #pending: ActivityUpdate | undefined;
  #last: ActivityUpdate | undefined;
  #generation = 0;
  #draining = false;

  constructor(send: (update: ActivityUpdate) => Promise<void>, onError: (error: unknown) => void) {
    this.#send = send;
    this.#onError = onError;
  }

  publish(update: ActivityUpdate): void {
    if (this.#same(update, this.#pending)) return;
    if (!this.#draining && this.#same(update, this.#last)) return;
    this.#pending = update;
    if (!this.#draining) void this.#drain(this.#generation);
  }

  reset(): void {
    this.#generation += 1;
    this.#pending = undefined;
    this.#last = undefined;
  }

  async #drain(expectedGeneration: number): Promise<void> {
    this.#draining = true;
    while (expectedGeneration === this.#generation && this.#pending) {
      const update = this.#pending;
      this.#pending = undefined;
      try {
        await this.#send(update);
        if (expectedGeneration === this.#generation) this.#last = update;
      } catch (error) {
        if (expectedGeneration === this.#generation) this.#onError(error);
      }
    }
    this.#draining = false;
    if (this.#pending) void this.#drain(this.#generation);
  }

  #same(left: ActivityUpdate, right: ActivityUpdate | undefined): boolean {
    return left.activity === right?.activity && left.note === right.note;
  }
}
