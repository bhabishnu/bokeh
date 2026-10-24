import type {SliderSpec} from "./abstract_slider"
import {BaseNumericalSlider, BaseNumericalSliderView} from "./base_numerical_slider"
import type * as p from "core/properties"

export abstract class NumericalRangeSliderView extends BaseNumericalSliderView {
  declare model: NumericalRangeSlider

  protected _calc_to(): SliderSpec<number> {
    const {start, end, value, step} = this.model

    return {
      range: {
        min: start,
        max: end,
      },
      start: value,
      step,
    }
  }

  protected _calc_from(values: number[]): number[] {
    return values
  }
}

export namespace NumericalRangeSlider {
  export type Attrs = p.AttrsOf<Props>

  export type Props = BaseNumericalSlider.Props & {
    value: p.Property<[number, number]>
  }
}

export interface NumericalRangeSlider extends NumericalRangeSlider.Attrs {}

export abstract class NumericalRangeSlider extends BaseNumericalSlider {
  declare properties: NumericalRangeSlider.Props
  declare declare__view_type__: NumericalRangeSliderView

  declare value: [number, number]

  protected _clamp(value: [number, number]): [number, number] {
    const [lo, hi] = this._bounds()
    const clamp = (v: number) => Math.min(Math.max(v, lo), hi)
    return [clamp(value[0]), clamp(value[1])]
  }

  protected _enforce_bounds(): void {
    const {value} = this.properties
    if (!value.is_unset) {
      const [v0, v1] = this.value
      const clamped = this._clamp([v0, v1])
      if (clamped[0] != v0 || clamped[1] != v1) {
        this.setv({value: clamped})
      }
    }
  }
}
