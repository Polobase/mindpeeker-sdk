/**
 * Tiny WebGL2 kit: context creation, shader compile/link with readable
 * errors, and a dynamic VBO helper using buffer orphaning (re-`bufferData`
 * each upload so the driver never stalls on a buffer still in flight —
 * the standard streaming-VBO idiom).
 */

/** Acquire a WebGL2 context or throw with a user-actionable message. */
export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (!gl) throw new Error('WebGL2 is unavailable in this browser')
  return gl
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('failed to allocate shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error'
    gl.deleteShader(shader)
    throw new Error(`shader compile failed: ${log}\n${source}`)
  }
  return shader
}

/** Compile + link a program from GLSL ES 3.00 vertex/fragment sources. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('failed to allocate program')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error'
    gl.deleteProgram(program)
    throw new Error(`program link failed: ${log}`)
  }
  return program
}

/**
 * Dynamic vertex buffer bound to one vec2 attribute. `upload` orphans the
 * store (fresh `bufferData` with `STREAM_DRAW`) and remembers the vertex
 * count for `draw`.
 */
export class DynamicBuffer {
  readonly #gl: WebGL2RenderingContext
  readonly #buffer: WebGLBuffer
  readonly #location: number
  #vertexCount = 0

  constructor(gl: WebGL2RenderingContext, program: WebGLProgram, attribute: string) {
    this.#gl = gl
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('failed to allocate buffer')
    this.#buffer = buffer
    this.#location = gl.getAttribLocation(program, attribute)
  }

  /** Replace the buffer contents with interleaved (x, y) pairs. */
  upload(vertices: Float32Array): void {
    const gl = this.#gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW)
    this.#vertexCount = vertices.length / 2
  }

  /** Bind the attribute and draw the whole buffer with the given mode. */
  draw(mode: number): void {
    if (this.#vertexCount === 0) return
    const gl = this.#gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer)
    gl.enableVertexAttribArray(this.#location)
    gl.vertexAttribPointer(this.#location, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(mode, 0, this.#vertexCount)
  }
}

/**
 * Vertex shader for full-viewport texture panels: positions come from
 * `gl_VertexID` (a WebGL2 feature), so no vertex buffer exists at all —
 * draw with `TRIANGLE_STRIP`, count 4.
 */
export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`

/**
 * Clip-space vec2 vertex shader for line/strip geometry, with a rotation
 * (dial phase animation) and per-axis scale (aspect correction) uniform.
 */
export const CLIP_VS = `#version 300 es
in vec2 a_pos;
uniform float u_rotate;
uniform vec2 u_scale;
void main() {
  float c = cos(u_rotate), s = sin(u_rotate);
  gl_Position = vec4(mat2(c, s, -s, c) * a_pos * u_scale, 0.0, 1.0);
}
`
