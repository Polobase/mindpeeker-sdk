/**
 * Rolling line-chart panel with envelope bands — the cumulative deviation
 * $D(t)=\sum(Z^2-1)$ with its pointwise $\chi^2$ envelope and a time-uniform
 * (anytime-valid) boundary is the canonical tenant. Keeps the most recent
 * points and autoscales y over values ∪ finite band bounds. The first band is
 * a translucent triangle strip under the line; every further band is drawn as
 * boundary lines (only its finite sides, so a one-sided boundary is one
 * line). Axis labels, the caption (latest point plus the channel's note) and
 * the band legend (`ChannelInfo.bandLabels`) live on the 2D overlay.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import type { SeriesPoint } from '../../src/types.js'
import { CLIP_VS, createGL, createProgram, DynamicBuffer } from '../gl.js'
import {
  autoRange,
  bandStrip,
  boundSegments,
  linearScale,
  niceTicks,
  pointBands,
  seriesPath,
} from '../math.js'
import {
  drawCaption,
  drawLegend,
  drawYTicks,
  formatTick,
  type LegendEntry,
  setupOverlay,
} from '../overlay.js'
import type { Panel, PanelShell } from './panel.js'

const MAX_POINTS = 4096

const FLAT_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }
`

/** RGBA of the shaded primary band. */
const BAND_FILL = [0.35, 0.55, 0.85, 0.22] as const
/** Legend swatch of the primary band (its fill, opaque enough to read). */
const BAND_LEGEND = 'rgba(89, 140, 217, 0.8)'
/** RGBA of the boundary lines of bands 1…7 (cycled). */
const BOUND_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0.95, 0.65, 0.3, 0.95],
  [0.85, 0.45, 0.75, 0.95],
  [0.95, 0.9, 0.4, 0.95],
]

function css([r, g, b, a]: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}

function boundColor(index: number): readonly [number, number, number, number] {
  return BOUND_COLORS[(index - 1) % BOUND_COLORS.length] as readonly [
    number,
    number,
    number,
    number,
  ]
}

/** Create the series panel; throws if WebGL2 is unavailable (caller shows shell.fail). */
export function seriesPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, CLIP_VS, FLAT_FS)
  const colorLoc = gl.getUniformLocation(program, 'u_color')
  const rotateLoc = gl.getUniformLocation(program, 'u_rotate')
  const scaleLoc = gl.getUniformLocation(program, 'u_scale')
  const lineBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const bandBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const boundBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const overlay = setupOverlay(shell.overlayCanvas)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const points: SeriesPoint[] = []
  let bandLabels: readonly string[] = []
  let note: string | undefined
  let dirty = false

  const clear = (): void => {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clearColor(0.05, 0.06, 0.08, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    overlay.clear()
  }

  const legend = (bandCount: number): LegendEntry[] => {
    const entries: LegendEntry[] = []
    for (let i = 0; i < bandCount; i++) {
      const label = bandLabels[i]
      if (!label) continue
      entries.push({ label, color: i === 0 ? BAND_LEGEND : css(boundColor(i)) })
    }
    return entries
  }

  return {
    root: shell.root,
    wrap: shell.wrap,
    setInfo(info) {
      // the note goes into the caption; the badge shows status (and an error reason)
      shell.setStatus(info.status, info.status === 'error' ? info.error : undefined)
      bandLabels = info.bandLabels ?? []
      note = info.note
      dirty = true
    },
    resize() {
      shell.resizeGl()
      overlay.resize()
      dirty = true
    },
    reset() {
      // a reconnect replays the server's ring; keeping old points would
      // duplicate them and draw a retrace backwards through the chart
      points.length = 0
      dirty = false
      clear()
    },
    dispose: shell.release,
    setStatic() {},
    frame(f: DecodedFrame) {
      if (f.kind !== 'series') return
      for (const point of f.points) points.push(point)
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS)
      dirty = true
    },
    render() {
      if (!dirty) return
      dirty = false
      if (points.length < 2) {
        clear()
        if (note) drawCaption(overlay, note)
        return
      }
      const first = points[0] as SeriesPoint
      const last = points[points.length - 1] as SeriesPoint
      const yBounds: number[] = []
      let bandCount = 0
      for (const p of points) {
        yBounds.push(p.value)
        const bands = pointBands(p)
        bandCount = Math.max(bandCount, bands.length)
        for (const band of bands) yBounds.push(band.lo, band.hi)
      }
      const [yMin, yMax] = autoRange(yBounds)
      const xScale = linearScale(first.t, last.t, -1, 1)
      const yScale = linearScale(yMin, yMax, -0.92, 0.92)

      clear()
      gl.useProgram(program)
      gl.uniform1f(rotateLoc, 0)
      gl.uniform2f(scaleLoc, 1, 1)

      bandBuffer.upload(bandStrip(points, xScale, yScale))
      gl.uniform4f(colorLoc, ...BAND_FILL)
      bandBuffer.draw(gl.TRIANGLE_STRIP)

      for (let i = 1; i < bandCount; i++) {
        gl.uniform4f(colorLoc, ...boundColor(i))
        for (const side of ['lo', 'hi'] as const) {
          boundBuffer.upload(boundSegments(points, i, side, xScale, yScale))
          boundBuffer.draw(gl.LINES)
        }
      }

      lineBuffer.upload(seriesPath(points, xScale, yScale))
      gl.uniform4f(colorLoc, 0.55, 0.95, 0.75, 1)
      lineBuffer.draw(gl.LINE_STRIP)

      // same mapping as the GL clip range [-0.92, 0.92], in current CSS pixels
      const yPixel = linearScale(yMin, yMax, overlay.height * 0.96, overlay.height * 0.04)
      drawYTicks(overlay, niceTicks(yMin, yMax, 4), yPixel)
      drawCaption(overlay, `t=${formatTick(last.t)} v=${formatTick(last.value)}`)
      if (note) drawCaption(overlay, note, 1)
      drawLegend(overlay, legend(bandCount))
    },
  }
}
