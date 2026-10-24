export type SyncPolicy = ["throttle", number] | ["debounce", number] | ["committed", null]

type Pending<T> = {
  value: T | undefined
  timeout: ReturnType<typeof setTimeout> | null
}

/**
 * Applies a synchronization policy to values identified by a stable key.
 *
 * The queue is deliberately independent of model signals and transport. This
 * allows JavaScript callbacks and server synchronization to observe the same
 * delivery semantics without delaying browser-side model state or rendering.
 */
export class SyncPolicyQueue<T> {
  protected readonly _pending = new Map<string, Pending<T>>()
  constructor(protected readonly _deliver: (value: T) => void) {}

  submit(key: string, policy: SyncPolicy, value: T, deferred: boolean): T | null {
    if (policy[0] == "throttle") {
      const pending = this._pending.get(key)
      if (pending == null) {
        const state: Pending<T> = {value: undefined, timeout: null}
        const tick = () => {
          if (state.value == undefined) {
            this._pending.delete(key)
          } else {
            const value = state.value
            state.value = undefined
            state.timeout = setTimeout(tick, policy[1])
            this._deliver(value)
          }
        }
        state.timeout = setTimeout(tick, policy[1])
        this._pending.set(key, state)
        return value
      }
      pending.value = value
    } else if (policy[0] == "debounce") {
      this.cancel(key)
      const state: Pending<T> = {value, timeout: null}
      state.timeout = setTimeout(() => {
        this._pending.delete(key)
        if (state.value != undefined) {
          this._deliver(state.value)
        }
      }, policy[1])
      this._pending.set(key, state)
    } else if (!deferred) {
      this.cancel(key)
      return value
    } else {
      this.cancel(key)
      this._pending.set(key, {value, timeout: null})
    }
    return null
  }

  flush(prefix: string = ""): void {
    for (const [key, pending] of this._pending) {
      if (key.startsWith(prefix)) {
        this._clear_timeout(pending)
        this._pending.delete(key)
        if (pending.value != undefined) {
          this._deliver(pending.value)
        }
      }
    }
  }

  cancel(prefix: string = ""): void {
    for (const [key, pending] of this._pending) {
      if (key.startsWith(prefix)) {
        this._clear_timeout(pending)
        this._pending.delete(key)
      }
    }
  }

  drain(): T[] {
    const values: T[] = []
    for (const pending of this._pending.values()) {
      this._clear_timeout(pending)
      if (pending.value != undefined) {
        values.push(pending.value)
      }
    }
    this._pending.clear()
    return values
  }

  protected _clear_timeout(pending: Pending<T>): void {
    if (pending.timeout != null) {
      clearTimeout(pending.timeout)
    }
  }
}
