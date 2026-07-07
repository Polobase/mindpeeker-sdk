// Node-only adapters — import from '@mindpeeker/entropy/node'.
// The root '@mindpeeker/entropy' entry stays browser-safe.

export type { FfmpegFrameOptions } from './ffmpeg-frames.js'
export { ffmpegFrameSource } from './ffmpeg-frames.js'
export type { FfmpegSampleOptions } from './ffmpeg-samples.js'
export { ffmpegSampleSource } from './ffmpeg-samples.js'
export type { HwRngOptions } from './hwrng.js'
export { hwRng } from './hwrng.js'
export type { NodeSerialOptions, NodeSerialStream } from './serial-source.js'
export { nodeSerialSource } from './serial-source.js'
