import {expect} from "#framework/assertions"
import * as sinon from "sinon"

import {CustomJS} from "@bokehjs/models/callbacks/customjs"
import {Model} from "@bokehjs/model"
import type {CallbackPolicy} from "@bokehjs/model"
import type * as p from "@bokehjs/core/properties"
import {delay} from "@bokehjs/core/util/defer"
import {Document} from "@bokehjs/document"

namespace Some0Model {
  export type Attrs = p.AttrsOf<Props>
  export type Props = Model.Props & {
    foo: p.Property<boolean>
    bar: p.Property<string>
    baz: p.Property<number>
  }
}
interface Some0Model extends Some0Model.Attrs {}
class Some0Model extends Model {
  declare properties: Some0Model.Props
  constructor(attrs?: Partial<Some0Model.Attrs>) {
    super(attrs)
  }
  static {
    this.define<Some0Model.Props>(({Bool, Float, Str}) => ({
      foo: [ Bool, false ],
      bar: [ Str ],
      baz: [ Float, 1 ],
    }))
  }
}

namespace Some1Model {
  export type Attrs = p.AttrsOf<Props>
  export type Props = Model.Props & {
    p0: p.Property<boolean>
    p1: p.Property<string>
    p2: p.Property<number>
    p3: p.Property<Model[] | null>
  }
}
interface Some1Model extends Some1Model.Attrs {}
class Some1Model extends Model {
  declare properties: Some1Model.Props
  constructor(attrs?: Partial<Some1Model.Attrs>) {
    super(attrs)
  }
  static {
    this.define<Some1Model.Props>(({Bool, Float, Str, List, Ref, Nullable}) => ({
      p0: [ Bool, false ],
      p1: [ Str, "foo" ],
      p2: [ Float, 1 ],
      p3: [ Nullable(List(Ref(Model))), null ],
    }))
  }
}

describe("Model objects", () => {

  describe("default creation", () => {
    const m = Some0Model.create()

    it("should have null name", () => {
      expect(m.name).to.be.null
    })

    it("should have empty tags", () => {
      expect(m.tags).to.be.equal([])
    })

    it("should have empty js_property_callbacks", () => {
      expect(m.js_property_callbacks).to.be.equal({})
    })
  })

  describe("js callbacks", () => {

    it("should execute on property changes", () => {
      // unfortunately spy does not seem to have per-instance
      // resolution. This is the best test I could make work.

      const cb1 = CustomJS.create({code: ""})
      const cb2 = CustomJS.create({code: ""})
      const cb3 = CustomJS.create({code: ""})

      const spy = sinon.spy(cb3, "execute")

      const m = Some0Model.create({
        js_property_callbacks: {
          "change:foo": [cb1, cb2],
          "change:bar": [cb3],
        },
      })

      // check the correct number of calls for m.foo change
      expect(spy.called).to.be.false
      m.foo = true
      expect(spy.callCount).to.be.equal(0)

      // check the correct number of calls for m.bar change
      spy.resetHistory()
      expect(spy.called).to.be.false
      m.bar = "test"
      expect(spy.callCount).to.be.equal(1)

      // check the correct number of calls for m.baz change
      spy.resetHistory()
      expect(spy.called).to.be.false
      m.baz = 10
      expect(spy.callCount).to.be.equal(0)
    })

    it("should throttle with leading and trailing callbacks", async () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [["throttle", 40] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })

      m.baz = 2
      m.baz = 3
      m.baz = 4

      expect(values).to.be.equal([2])
      await delay(70)
      expect(values).to.be.equal([2, 4])
    })

    it("should debounce callbacks until changes settle", async () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [["debounce", 40] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })

      m.baz = 2
      await delay(15)
      m.baz = 3

      expect(values).to.be.equal([])
      await delay(70)
      expect(values).to.be.equal([3])
    })

    it("should defer committed callbacks during an interaction", () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [["committed", null] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })
      const document = new Document({roots: [m]})

      m.baz = 2
      document.begin_sync_deferral(m, "baz")
      m.baz = 3
      m.baz = 4

      expect(values).to.be.equal([2])
      document.request_sync_flush(m, "baz")
      expect(values).to.be.equal([2, 4])
    })

    it("should apply different policies to callbacks on the same property", () => {
      const immediate = CustomJS.create({code: ""})
      const committed = CustomJS.create({code: ""})
      const values: string[] = []
      sinon.stub(immediate, "execute").callsFake(async (model) => {
        values.push(`immediate:${(model as Some0Model).baz}`)
      })
      sinon.stub(committed, "execute").callsFake(async (model) => {
        values.push(`committed:${(model as Some0Model).baz}`)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[committed.id, [["committed", null] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [immediate, committed]},
      })
      const document = new Document({roots: [m]})

      document.begin_sync_deferral(m, "baz")
      m.baz = 2
      m.baz = 3

      expect(values).to.be.equal(["immediate:2", "immediate:3"])
      document.request_sync_flush(m, "baz")
      expect(values).to.be.equal(["immediate:2", "immediate:3", "committed:3"])
    })

    it("should apply different policies to the same callback", () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [
          ["immediate", null] as CallbackPolicy,
          ["committed", null] as CallbackPolicy,
        ]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })
      const document = new Document({roots: [m]})

      document.begin_sync_deferral(m, "baz")
      m.baz = 2
      m.baz = 3

      expect(values).to.be.equal([2, 3])
      document.request_sync_flush(m, "baz")
      expect(values).to.be.equal([2, 3, 3])
    })

    it("should flush a pending callback when its policy is removed", () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [["debounce", 1000] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })

      m.baz = 2
      expect(values).to.be.equal([])
      m.js_property_callback_policies = new Map()
      expect(values).to.be.equal([2])
    })

    it("should debounce server-originated changes as well", async () => {
      const callback = CustomJS.create({code: ""})
      const values: number[] = []
      sinon.stub(callback, "execute").callsFake(async (model) => {
        values.push((model as Some0Model).baz)
      })
      const js_property_callback_policies = new Map([
        ["change:baz", new Map([[callback.id, [["debounce", 40] as CallbackPolicy]]])],
      ])
      const m = Some0Model.create({
        js_property_callback_policies,
        js_property_callbacks: {"change:baz": [callback]},
      })

      m.baz = 2
      m.setv({baz: 8}, {sync: false})

      expect(values).to.be.equal([])
      await delay(70)
      expect(values).to.be.equal([8])
    })
  })

  it("should support select() and select_one() methods", () => {
    const some0_0 = Some0Model.create({name: "some0"})
    const some0_1 = Some0Model.create({name: "some1"})
    const some1_0 = Some1Model.create({p3: [some0_0]})
    const some1_1 = Some1Model.create({p3: [some1_0, some0_1]})

    expect(some1_1.select({type: "Some0Model"})).to.be.equal([some0_0, some0_1])
    expect(() => some1_1.select_one({type: "Some0Model"})).to.throw(Error, "found multiple objects matching the given selector")
  })
})
