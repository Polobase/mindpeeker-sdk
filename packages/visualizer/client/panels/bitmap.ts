/**
 * Noise-bitmap panel: a scrolling raster of raw bytes. The texture is a ring
 * of rows — each incoming chunk fills whole 256-byte rows via
 * `texSubImage2D` at a wrapping row pointer, and the fragment shader adds
 * the row offset to the v coordinate (mod 1). One quad, one small upload per
 * row, never a full-texture re-upload.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import { createGL, createProgram, FULLSCREEN_VS } from '../gl.js'
import { drawCaption, setupOverlay } from '../overlay.js'
import type { Panel, PanelShell } from './panel.js'

const TEX_W = 256
const TEX_H = 256

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_rowOffset;
in vec2 v_uv;
out vec4 color;
void main() {
  float v = texture(u_tex, vec2(v_uv.x, fract(v_uv.y + u_rowOffset))).r;
  color = vec4(v * 0.78, v * 0.98, v * 0.86, 1.0);
}
`

/** Create the panel; throws if WebGL2 is unavailable (caller shows shell.fail). */
export function bitmapPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, FULLSCREEN_VS, FS)
  const rowOffsetLoc = gl.getUniformLocation(program, 'u_rowOffset')
  const overlay = setupOverlay(shell.overlayCanvas)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEX_W, TEX_H, 0, gl.RED, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  let pending = new Uint8Array(0)
  let rowPtr = 0
  let totalBytes = 0
  let dirty = true

  return {
    root: shell.root,
    setStatus: shell.setStatus,
    setStatic() {},
    frame(f: DecodedFrame) {
      if (f.kind !== 'bytes') return
      totalBytes += f.bytes.length
      const merged = new Uint8Array(pending.length + f.bytes.length)
      merged.set(pending)
      merged.set(f.bytes, pending.length)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      let off = 0
      while (merged.length - off >= TEX_W) {
        const row = merged.subarray(off, off + TEX_W)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, rowPtr, TEX_W, 1, gl.RED, gl.UNSIGNED_BYTE, row)
        rowPtr = (rowPtr + 1) % TEX_H
        off += TEX_W
      }
      pending = merged.slice(off)
      dirty = true
    },
    render() {
      if (!dirty) return
      dirty = false
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.useProgram(program)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1f(rowOffsetLoc, rowPtr / TEX_H)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      overlay.clear()
      drawCaption(overlay, `${(totalBytes / 1024).toFixed(1)} KiB · ${TEX_W}B/row`)
    },
  }
}
