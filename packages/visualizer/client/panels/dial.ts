/**
 * Radial dial panel: renders rate-card geometry (rings + radial sector
 * lines, Malcolm Rae base-44 convention) published on a static channel.
 * The grid is tessellated once into GL line lists; a slow sweep line and a
 * gentle pointer pulse are the phase animation, driven by a rotation
 * uniform — the geometry buffers never change after upload.
 */
import type { RateCardGeometry } from '../../src/types.js'
import { CLIP_VS, createGL, createProgram, DynamicBuffer } from '../gl.js'
import { tessellateDial } from '../math.js'
import { drawCaption, setupOverlay } from '../overlay.js'
import type { Panel, PanelShell } from './panel.js'

const SWEEP_PERIOD_MS = 12_000

const FLAT_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = u_color; }
`

function isRateCard(data: unknown): data is RateCardGeometry {
  if (typeof data !== 'object' || data === null) return false
  const g = data as Partial<RateCardGeometry>
  return g.type === 'rate-card' && typeof g.sectors === 'number' && Array.isArray(g.rings)
}

export function dialPanel(shell: PanelShell): Panel {
  const gl = createGL(shell.glCanvas)
  const program = createProgram(gl, CLIP_VS, FLAT_FS)
  const colorLoc = gl.getUniformLocation(program, 'u_color')
  const rotateLoc = gl.getUniformLocation(program, 'u_rotate')
  const scaleLoc = gl.getUniformLocation(program, 'u_scale')
  const gridBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const pointerBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const sweepBuffer = new DynamicBuffer(gl, program, 'a_pos')
  const overlay = setupOverlay(shell.overlayCanvas)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  // aspect correction: keep the dial circular in a rectangular canvas
  const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight)
  const scale: [number, number] = aspect >= 1 ? [0.92 / aspect, 0.92] : [0.92, 0.92 * aspect]

  let geometry: RateCardGeometry | undefined
  let label = ''

  return {
    root: shell.root,
    setStatus: shell.setStatus,
    frame() {},
    setStatic(data: unknown) {
      if (!isRateCard(data)) {
        shell.setStatus('error')
        return
      }
      geometry = data
      label = `${data.label ?? 'rate card'} · ${data.sectors} sectors`
      const dial = tessellateDial(data, 128)
      gridBuffer.upload(dial.grid)
      pointerBuffer.upload(dial.pointer)
      sweepBuffer.upload(new Float32Array([0, 0, 0, 1]))
      overlay.clear()
      drawCaption(overlay, label)
    },
    render(timeMs: number) {
      if (!geometry) return
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.clearColor(0.05, 0.06, 0.08, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform2f(scaleLoc, scale[0], scale[1])

      gl.uniform1f(rotateLoc, 0)
      gl.uniform4f(colorLoc, 0.45, 0.52, 0.6, 0.8)
      gridBuffer.draw(gl.LINES)

      const pulse = 0.75 + 0.25 * Math.sin((timeMs / 1000) * 2 * Math.PI * 0.5)
      gl.uniform4f(colorLoc, 0.95, 0.75, 0.35, pulse)
      pointerBuffer.draw(gl.LINES)

      const phase = -((timeMs % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * 2 * Math.PI
      gl.uniform1f(rotateLoc, phase)
      gl.uniform4f(colorLoc, 0.55, 0.95, 0.75, 0.35)
      sweepBuffer.draw(gl.LINES)
    },
  }
}
