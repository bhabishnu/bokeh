import {HasProps} from "./core/has_props"
import type {HasPropsClass} from "./core/has_props"
import type {Class} from "./core/class"
import type {Dict} from "./core/types"
import type {ModelEvent, ModelEventType, BokehEventMap} from "./core/bokeh_events"
import type * as p from "./core/properties"
import {isString, isPlainObject} from "./core/util/types"
import {dict} from "./core/util/object"
import type {Comparator} from "core/util/eq"
import {equals} from "core/util/eq"
import {logger} from "./core/logging"
import type {CallbackLike0} from "./core/util/callbacks"
import {execute} from "./core/util/callbacks"
import {SyncPolicyQueue} from "./core/util/sync_policy"
import type {SyncPolicy} from "./core/util/sync_policy"
import {KeyVal, Mapping, Str, Float, List, Func, Enum, Null, Or, Tuple} from "core/kinds"

export type ModelSelector<T extends HasProps> = HasPropsClass<T> | string | {type: string}

export type ChangeCallback = CallbackLike0<Model>

export type EventCallback<T extends ModelEvent = ModelEvent> = CallbackLike0<T>

const JSCallbacks = Mapping(Str, List(Func<[], void>()))
type JSCallbacks = typeof JSCallbacks["__type__"]

export const CallbackPolicy = Or(
  Tuple(Enum("immediate", "committed"), Null),
  Tuple(Enum("throttle", "debounce"), Float),
)
export type CallbackPolicy = typeof CallbackPolicy["__type__"]

const SubscribedChanges = KeyVal(Str, List(CallbackPolicy))
type SubscribedChanges = typeof SubscribedChanges["__type__"]

const JSCallbackPolicies = KeyVal(Str, KeyVal(Str, List(CallbackPolicy)))
type JSCallbackPolicies = typeof JSCallbackPolicies["__type__"]

export namespace Model {
  export type Attrs = p.AttrsOf<Props>

  export type Props = HasProps.Props & {
    tags: p.Property<unknown[]>
    name: p.Property<string | null>
    js_property_callbacks: p.Property<Dict<ChangeCallback[]>>
    js_property_callback_policies: p.Property<JSCallbackPolicies>
    js_event_callbacks: p.Property<Dict<EventCallback[]>>
    subscribed_changes: p.Property<SubscribedChanges>
    subscribed_events: p.Property<Set<string>>
    syncable: p.Property<boolean>
  } & Internal

  export type Internal = {
    _js_callbacks: p.Property<JSCallbacks>
  }
}

export interface Model extends Model.Attrs {}

export abstract class Model extends HasProps {
  declare properties: Model.Props

  protected readonly _js_callback_queue = new SyncPolicyQueue<ChangeCallback>((callback) => {
    void execute(callback, this)
  })

  protected readonly _sync_flush_listener = ({model, attr}: {model: Model, attr: string}) => {
    if (model == this) {
      this._js_callback_queue.flush(`change:${attr}\x00`)
    }
  }

  override get is_syncable(): boolean {
    return this.syncable
  }

  override [equals](that: this, cmp: Comparator): boolean {
    return (cmp.structural ? true : cmp.eq(this.id, that.id)) && super[equals](that, cmp)
  }

  static {
    this.define<Model.Props>(({Any, Unknown, Bool, Str, List, Set, Dict, Nullable}) => ({
      tags:                  [ List(Unknown), [] ],
      name:                  [ Nullable(Str), null ],
      js_property_callbacks: [ Dict(List(Any /*TODO*/)), {} ],
      js_property_callback_policies: [ JSCallbackPolicies, {} ],
      js_event_callbacks:    [ Dict(List(Any /*TODO*/)), {} ],
      subscribed_changes:    [ SubscribedChanges, {} ],
      subscribed_events:     [ Set(Str), new globalThis.Set() ],
      syncable:              [ Bool, true ],
    }))

    this.internal<Model.Internal>({
      _js_callbacks: [ JSCallbacks, new Map(), {readonly: true} ],
    })
  }

  override connect_signals(): void {
    super.connect_signals()

    this._update_property_callbacks()
    this.connect(this.properties.js_property_callbacks.change, () => this._update_property_callbacks())
    this.connect(this.properties.js_property_callback_policies.change, () => this._js_callback_queue.flush())
    this.connect(this.properties.js_event_callbacks.change, () => this._update_event_callbacks())
    this.connect(this.properties.subscribed_events.change, () => this._update_event_callbacks())
  }

  /*protected*/ _process_event(event: ModelEvent): void {
    for (const callback of dict(this.js_event_callbacks).get(event.event_name) ?? []) {
      void execute(callback, event)
    }

    if (this.document != null && this.subscribed_events.has(event.event_name)) {
      this.document.event_manager.send_event(event)
    }
  }

  trigger_event(event: ModelEvent): void {
    if (this.document != null) {
      event.origin = this
      this.document.event_manager.trigger(event)
    }
  }

  protected _update_event_callbacks(): void {
    if (this.document == null) {
      logger.warn("WARNING: Document not defined for updating event callbacks")
      return
    }
    this.document.event_manager.subscribed_models.add(this)
  }

  protected _update_property_callbacks(): void {
    this._js_callback_queue.cancel()
    const signal_for = (event: string) => {
      const [evt, attr=null] = event.split(":")
      return attr != null ? (this.properties as any)[attr][evt] : (this as any)[evt]
    }

    for (const [event, callbacks] of this._js_callbacks) {
      const signal = signal_for(event)
      for (const cb of callbacks) {
        this.disconnect(signal, cb)
      }
    }
    this._js_callbacks.clear()

    for (const [event, callbacks] of dict(this.js_property_callbacks)) {
      const wrappers = callbacks.length == 0 ? [] : [() => this._schedule_property_callbacks(event)]
      this._js_callbacks.set(event, wrappers)
      const signal = signal_for(event)
      for (const cb of wrappers) {
        this.connect(signal, cb)
      }
    }
  }

  protected _schedule_property_callbacks(event: string): void {
    const [evt, attr=null] = event.split(":")
    if (evt != "change" || attr == null) {
      for (const callback of dict(this.js_property_callbacks).get(event) ?? []) {
        void execute(callback, this)
      }
      return
    }

    const policies = dict(dict(this.js_property_callback_policies).get(event) ?? {})
    for (const callback of dict(this.js_property_callbacks).get(event) ?? []) {
      const id = callback instanceof HasProps ? callback.id : null
      const callback_policies = (id != null ? policies.get(id) : null) ?? [["immediate", null] as CallbackPolicy]
      for (const policy of callback_policies) {
        if (policy[0] == "immediate") {
          void execute(callback, this)
        } else {
          const key = `${event}\x00${id}\x00${policy[0]}\x00${policy[1] ?? ""}`
          const deferred = this.document?.is_sync_deferred(this, attr) ?? false
          const delivered = this._js_callback_queue.submit(key, policy as SyncPolicy, callback, deferred)
          if (delivered != null) {
            void execute(delivered, this)
          }
        }
      }
    }
  }

  has_callback_policy(attr: string, mode?: SyncPolicy[0]): boolean {
    const python = dict(this.subscribed_changes).get(attr) ?? []
    const js = [...dict(dict(this.js_property_callback_policies).get(`change:${attr}`) ?? {}).values()].flat()
    const policies = [...python, ...js]
    return mode == null ? policies.some(([kind]) => kind != "immediate") : policies.some(([kind]) => kind == mode)
  }

  protected override _doc_attached(): void {
    super._doc_attached()

    this.document!.sync_flush.connect(this._sync_flush_listener)

    if (this.js_event_callbacks.size != 0 || this.subscribed_events.size != 0) {
      this._update_event_callbacks()
    }
  }

  protected override _doc_detached(): void {
    super._doc_detached()
    this._js_callback_queue.cancel()
    this.document?.sync_flush.disconnect(this._sync_flush_listener)
    this.document?.event_manager.subscribed_models.delete(this)
  }

  select<T extends HasProps>(selector: ModelSelector<T>): T[] {
    if (isString(selector)) {
      return [...this.references()].filter((ref): ref is T => ref instanceof Model && ref.name === selector)
    } else if (isPlainObject(selector) && "type" in selector) {
      return [...this.references()].filter((ref): ref is T => ref.type == selector.type)
    } else if (selector.prototype instanceof HasProps) {
      return [...this.references()].filter((ref): ref is T => ref instanceof selector)
    } else {
      throw new Error(`invalid selector ${selector}`)
    }
  }

  select_one<T extends HasProps>(selector: ModelSelector<T>): T | null {
    const result = this.select(selector)
    switch (result.length) {
      case 0:
        return null
      case 1:
        return result[0]
      default:
        throw new Error(`found multiple objects matching the given selector ${selector}`)
    }
  }

  get_one<T extends HasProps>(selector: ModelSelector<T>): T {
    const result = this.select_one(selector)
    if (result != null) {
      return result
    } else {
      throw new Error(`could not find any objects matching the given selector ${selector}`)
    }
  }

  on_event<T extends ModelEventType>(event: T, callback: EventCallback<BokehEventMap[T]>): void
  on_event<T extends ModelEvent>(event: Class<T>, callback: EventCallback<T>): void

  on_event(event: ModelEventType | Class<ModelEvent>, callback: EventCallback): void {
    const name = isString(event) ? event : event.prototype.event_name
    const js_event_callbacks = dict(this.js_event_callbacks)
    const callbacks = js_event_callbacks.get(name) ?? []
    js_event_callbacks.set(name, [...callbacks, callback])
  }
}
