import type {SliderSpec} from "./abstract_slider"
import {BaseNumericalSlider, BaseNumericalSliderView} from "./base_numerical_slider"
import type * as p from "core/properties"

export abstract class NumericalSliderView extends BaseNumericalSliderView {
  declare model: NumericalSlider

  protected _calc_to(): SliderSpec<number> {
    const {start, end, value, step} = this.model
    return {
      range: {
        min: start,
        max: end,
      },
      start: [value],
      step,
    }
  }

  protected _calc_from([value]: number[]): number {
    if (Number.isInteger(this.model.start) && Number.isInteger(this.model.end) && Number.isInteger(this.model.step)) {
      return Math.round(value)
    } else {
      return value
    }
  }
}

export namespace NumericalSlider {
  export type Attrs = p.AttrsOf<Props>

  export type Props = BaseNumericalSlider.Props & {
    value: p.Property<number>
  }
}

export interface NumericalSlider extends NumericalSlider.Attrs {}

export abstract class NumericalSlider extends BaseNumericalSlider {
  declare properties: NumericalSlider.Props
  declare __view_type__: NumericalSliderView

  declare value: number

  protected _clamp(value: number): number {
    const [lo, hi] = this._bounds()
    return Math.min(Math.max(value, lo), hi)
  }

  protected _enforce_bounds(): void {
    const {value} = this.properties
    if (!value.is_unset) {
      const current = this.value
      const clamped = this._clamp(current)
      if (clamped != current) {
        this.setv({value: clamped})
      }
    }
  }
}
