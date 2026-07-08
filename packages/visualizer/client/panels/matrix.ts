/**
 * Matrix heatmap panel. Values are min–max normalized in JS, uploaded as an
 * `R32F` texture (NEAREST — float filtering needs an extension, and crisp
 * cells are the point), and colored in the fragment shader through a
 * 256×1 viridis LUT texture. A $1 \times N$ matrix switches to bar mode:
 * the same texture drives a per-column bar height cutoff, no extra geometry.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import { createGL, createProgram, FULLSCREEN_VS } from '../gl.js'
import { viridisLut } from '../math.js'
import { drawCaption, formatTick, setupOverlay } from '../overlay.js'
import type { Panel, PanelShell } from './panel.js'

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_data;
uniform sampler2D u_lut;
uniform int u_barMode;
in vec2 v_uv;
out vec4 color;
void main() {
  if (u_barMode == 1) {
    float v = texture(u_data, vec2(v_uv.x, 0.5)).r;
    color = v_uv.y <= v ? texture(u_lut, vec2(v, 0.5)) : vec4(0.05, 0.06, 0.08, 1.0);
  } else {
    float v = texture(u_data, vec2(v_uv.x, 1.0 - v_uv.y)).r;
    color = texture(u_lut, vec2(v, 0.5));
  }
}
`

export function matrixPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, FULLSCREEN_VS, FS)
  const dataLoc = gl.getUniformLocation(program, 'u_data')
  const lutLoc = gl.getUniformLocation(program, 'u_lut')
  const barModeLoc = gl.getUniformLocation(program, 'u_barMode')
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
  let stats = ''

  return {
    root: shell.root,
    setStatus: shell.setStatus,
    setStatic() {},
    frame(f: DecodedFrame) {
      if (f.kind !== 'matrix') return
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      for (const v of f.data) {
        if (!Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
      }
      const span = max > min ? max - min : 1
      const normalized = new Float32Array(f.data.length)
      for (let i = 0; i < f.data.length; i++) {
        const v = f.data[i] as number
        normalized[i] = Number.isFinite(v) ? (v - min) / span : 0
      }
      gl.bindTexture(gl.TEXTURE_2D, dataTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, f.cols, f.rows, 0, gl.RED, gl.FLOAT, normalized)
      barMode = f.rows === 1
      stats = `${f.rows}×${f.cols} · ${formatTick(min)}…${formatTick(max)}`
      dirty = true
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
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      overlay.clear()
      drawCaption(overlay, stats)
    },
  }
}
