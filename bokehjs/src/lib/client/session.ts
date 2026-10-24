import {DocumentEventBatch, ModelChangedEvent} from "document"
import type {Patch, Document, DocumentEvent, DocumentChangedEvent, SyncFlush} from "document"
import {Message} from "protocol/message"
import {Model} from "model"
import type {CallbackPolicy} from "model"
import type {ClientConnection} from "./connection"
import {logger} from "core/logging"
import {dict} from "core/util/object"
import {SyncPolicyQueue} from "core/util/sync_policy"
import type {SyncPolicy} from "core/util/sync_policy"

export type OkMsg = Message<void>
export type ErrorMsg = Message<{text: string, traceback: string | null}>
export type PatchMsg = Message<Patch>

export class ClientSession {
  protected readonly _sync_queue: SyncPolicyQueue<ModelChangedEvent>

  protected _document_listener = (event: DocumentEvent) => {
    this._document_changed(event)
  }

  protected _sync_flush_listener = ({model, attr}: SyncFlush) => {
    this._sync_queue.flush(this._sync_key(model, attr))
  }

  constructor(protected readonly _connection: ClientConnection, readonly document: Document) {
    this._sync_queue = new SyncPolicyQueue((event) => {
      if (event.model instanceof Model && event.model.document == this.document) {
        this._send_patch([event])
      }
    })
    this.document.on_change(this._document_listener, true)
    this.document.sync_flush.connect(this._sync_flush_listener)
  }

  // XXX: this is only needed in tests
  get id(): string {
    return this._connection.id
  }

  handle(message: Message<unknown>): void {
    const msgtype = message.msgtype()

    switch (msgtype) {
      case "PATCH-DOC": {
        this._handle_patch(message as PatchMsg)
        break
      }
      case "OK": {
        this._handle_ok(message as OkMsg)
        break
      }
      case "ERROR": {
        this._handle_error(message as ErrorMsg)
        break
      }
      default:
        logger.debug(`Doing nothing with message '${msgtype}'`)
    }
  }

  // TODO: notify_connection_retry ?
  // data: time (ms) to next retry, connection attempt number

  close(): void {
    const events = this._sync_queue.drain().filter((event) => {
      return event.model instanceof Model && event.model.document == this.document
    })
    this._send_patch(events)
    this._connection.close()
  }

  /*protected*/ _connection_closed(): void {
    this.document.remove_on_change(this._document_listener)
    this.document.sync_flush.disconnect(this._sync_flush_listener)
    this._sync_queue.cancel()
  }

  // Waits for the server to process all preceding messages. This is useful in
  // tests that need to observe the result of an asynchronously sent patch.
  async force_roundtrip(): Promise<void> {
    const message = Message.create("SYNC", {})
    await this._connection.send_with_reply(message)
  }

  protected _document_changed(event: DocumentEvent): void {
    const events: DocumentChangedEvent[] = event instanceof DocumentEventBatch ? event.events : [event]
    const batch_sync = event.sync

    const immediate: DocumentChangedEvent[] = []
    for (const event of events) {
      if (event instanceof ModelChangedEvent && event.model instanceof Model && event.attr == "subscribed_changes") {
        this._sync_queue.flush(`${event.model.id}\x00`)
      }

      if (!batch_sync || !event.sync) {
        this._cancel_superseded_sync(event)
        continue
      }

      const policies = this._callback_policies(event)
      if (policies == null) {
        this._cancel_superseded_sync(event)
        immediate.push(event)
      } else {
        const model_event = event as ModelChangedEvent
        for (const policy of policies) {
          const tagged = new ModelChangedEvent(
            model_event.document, model_event.model, model_event.attr, model_event.value, policy,
          )
          tagged.sync = model_event.sync
          if (policy[0] == "immediate") {
            immediate.push(tagged)
          } else {
            const delivered = this._sync_queue.submit(
              this._sync_key(model_event.model as Model, model_event.attr, policy), policy as SyncPolicy, tagged,
              this.document.is_sync_deferred(model_event.model as Model, model_event.attr),
            )
            if (delivered != null) {
              immediate.push(delivered)
            }
          }
        }
      }
    }

    this._send_patch(immediate)
  }

  protected _callback_policies(event: DocumentChangedEvent): CallbackPolicy[] | null {
    if (!(event instanceof ModelChangedEvent) || !(event.model instanceof Model)) {
      return null
    }
    return dict(event.model.subscribed_changes).get(event.attr) ?? null
  }

  protected _sync_key(model: Model, attr: string, policy?: CallbackPolicy): string {
    const suffix = policy == null ? "" : `${policy[0]}\x00${policy[1] ?? ""}`
    return `${model.id}\x00${attr}\x00${suffix}`
  }

  protected _cancel_sync(model: Model, attr: string): void {
    this._sync_queue.cancel(this._sync_key(model, attr))
  }

  protected _cancel_superseded_sync(event: DocumentChangedEvent): void {
    if (!(event instanceof ModelChangedEvent) || !(event.model instanceof Model)) {
      return
    }
    this._cancel_sync(event.model, event.attr)
  }

  protected _send_patch(events: DocumentChangedEvent[]): void {
    if (events.length == 0) {
      return
    }

    const patch = this.document.create_json_patch(events)

    const message = Message.create("PATCH-DOC", patch)
    this._connection.send(message)
  }

  protected _handle_patch(message: PatchMsg): void {
    this.document.apply_json_patch(message.content, message.buffers)
  }

  protected _handle_ok(message: OkMsg): void {
    logger.trace(`Unhandled OK reply to ${message.reqid()}`)
  }

  protected _handle_error(message: ErrorMsg): void {
    logger.error(`Unhandled ERROR reply to ${message.reqid()}: ${message.content.text}`)
  }
}
