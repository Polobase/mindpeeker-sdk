/**
 * Rolling line-chart panel with envelope-band shading — the cumulative
 * deviation $D(t)=\sum(Z^2-1)$ plus its $\chi^2$ significance envelope is
 * the canonical tenant. Keeps the most recent points, autoscales y over
 * values ∪ band bounds, draws band (translucent triangle strip) below the
 * line (line strip); axis labels live on the 2D overlay.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import type { SeriesPoint } from '../../src/types.js'
import { CLIP_VS, createGL, createProgram, DynamicBuffer } from '../gl.js'
import { autoRange, bandStrip, linearScale, niceTicks, seriesPath } from '../math.js'
import { drawCaption, drawYTicks, formatTick, setupOverlay } from '../overlay.js'
import type { Panel, PanelShell } from './panel.js'

const MAX_POINTS = 4096

const FLAT_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }
`

export function seriesPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, CLIP_VS, FLAT_FS)
  const colorLoc = gl.getUniformLocation(program, 'u_color')
  const rotateLoc = gl.getUniformLocation(program, 'u_rotate')
  const scaleLoc = gl.getUniformLocation(program, 'u_scale')
  const lineBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const bandBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const overlay = setupOverlay(shell.overlayCanvas)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const points: SeriesPoint[] = []
  let dirty = false

  return {
    root: shell.root,
    setStatus: shell.setStatus,
    setStatic() {},
    frame(f: DecodedFrame) {
      if (f.kind !== 'series') return
      points.push(...f.points)
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS)
      dirty = true
    },
    render() {
      if (!dirty || points.length < 2) return
      dirty = false
      const first = points[0] as SeriesPoint
      const last = points[points.length - 1] as SeriesPoint
      const yBounds: number[] = []
      for (const p of points) {
        yBounds.push(p.value)
        if (p.band) yBounds.push(p.band[0], p.band[1])
      }
      const [yMin, yMax] = autoRange(yBounds)
      const xScale = linearScale(first.t, last.t, -1, 1)
      const yScale = linearScale(yMin, yMax, -0.92, 0.92)

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.clearColor(0.05, 0.06, 0.08, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform1f(rotateLoc, 0)
      gl.uniform2f(scaleLoc, 1, 1)

      bandBuffer.upload(bandStrip(points, xScale, yScale))
      gl.uniform4f(colorLoc, 0.35, 0.55, 0.85, 0.22)
      bandBuffer.draw(gl.TRIANGLE_STRIP)

      lineBuffer.upload(seriesPath(points, xScale, yScale))
      gl.uniform4f(colorLoc, 0.55, 0.95, 0.75, 1)
      lineBuffer.draw(gl.LINE_STRIP)

      overlay.clear()
      const yPixel = linearScale(yMin, yMax, overlay.height * 0.96, overlay.height * 0.04)
      drawYTicks(overlay, niceTicks(yMin, yMax, 4), yPixel)
      drawCaption(overlay, `t=${formatTick(last.t)} v=${formatTick(last.value)}`)
    },
  }
}
