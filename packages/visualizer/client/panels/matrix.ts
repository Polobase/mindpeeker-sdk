/**
 * Matrix heatmap panel. Values are normalized in JS ({@link matrixScale}: the
 * producer's `range` when the directory carries one, otherwise min–max for
 * heatmaps and a zero-based $[\min(0,\min), \max(0,\max)]$ span for bars),
 * uploaded as an `R32F` texture (NEAREST — float filtering needs an
 * extension, and crisp cells are the point), and colored in the fragment
 * shader through a 256×1 viridis LUT texture. A $1 \times N$ matrix switches
 * to bar mode: the same texture drives per-column bars that grow from the
 * normalized zero baseline, no extra geometry.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import { createGL, createProgram, FULLSCREEN_VS } from '../gl.js'
import { matrixScale, normalizeMatrix, viridisLut } from '../math.js'
import { drawCaption, formatTick, setupOverlay } from '../overlay.js'
import { badgeDetail, type Panel, type PanelShell } from './panel.js'

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_data;
uniform sampler2D u_lut;
uniform int u_barMode;
uniform float u_baseline;
in vec2 v_uv;
out vec4 color;
void main() {
  if (u_barMode == 1) {
    float v = texture(u_data, vec2(v_uv.x, 0.5)).r;
    float lo = min(u_baseline, v);
    float hi = max(u_baseline, v);
    color = (hi > lo && v_uv.y >= lo && v_uv.y <= hi)
      ? texture(u_lut, vec2(v, 0.5))
      : vec4(0.05, 0.06, 0.08, 1.0);
  } else {
    float v = texture(u_data, vec2(v_uv.x, 1.0 - v_uv.y)).r;
    color = texture(u_lut, vec2(v, 0.5));
  }
}
`

type MatrixFrame = Extract<DecodedFrame, { kind: 'matrix' }>

/** Create the matrix panel; throws if WebGL2 is unavailable (caller shows shell.fail). */
export function matrixPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, FULLSCREEN_VS, FS)
  const dataLoc = gl.getUniformLocation(program, 'u_data')
  const lutLoc = gl.getUniformLocation(program, 'u_lut')
  const barModeLoc = gl.getUniformLocation(program, 'u_barMode')
  const baselineLoc = gl.getUniformLocation(program, 'u_baseline')
  const overlay = setupOverlay(shell.overlayCanvas)

  const lutTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, lutTexture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, viridisLut(256))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)

  const dataTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, dataTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  let dirty = false
  let barMode = false
  let baseline = 0
  let stats = ''
  let range: readonly [number, number] | undefined
  let last: MatrixFrame | undefined

  /** Normalize and upload `f` under the current range. */
  const upload = (f: MatrixFrame): void => {
    const scale = matrixScale(f.data, f.rows, range)
    gl.bindTexture(gl.TEXTURE_2D, dataTexture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      f.cols,
      f.rows,
      0,
      gl.RED,
      gl.FLOAT,
      normalizeMatrix(f.data, scale),
    )
    barMode = scale.bars
    baseline = scale.baseline
    const span = `${formatTick(scale.lo)}…${formatTick(scale.hi)}`
    stats = `${f.rows}×${f.cols} · ${scale.fixed ? 'range' : 'scale'} ${span}`
    dirty = true
  }

  const clear = (): void => {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clearColor(0.05, 0.06, 0.08, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    overlay.clear()
  }

  return {
    root: shell.root,
    wrap: shell.wrap,
    setInfo(info) {
      shell.setStatus(info.status, badgeDetail(info))
      const next = info.range
      const changed = next?.[0] !== range?.[0] || next?.[1] !== range?.[1]
      range = next
      if (changed && last) upload(last)
    },
    resize() {
      shell.resizeGl()
      overlay.resize()
      dirty = last !== undefined
    },
    reset() {
      last = undefined
      dirty = false
      clear()
    },
    dispose: shell.release,
    setStatic() {},
    frame(f: DecodedFrame) {
      if (f.kind !== 'matrix') return
      last = f
      upload(f)
    },
    render() {
      if (!dirty) return
      dirty = false
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, dataTexture)
      gl.uniform1i(dataLoc, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, lutTexture)
      gl.uniform1i(lutLoc, 1)
      gl.uniform1i(barModeLoc, barMode ? 1 : 0)
      gl.uniform1f(baselineLoc, baseline)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      overlay.clear()
      drawCaption(overlay, stats)
    },
  }
}
