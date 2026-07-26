/**
 * Shared structural contracts, re-exported from `@mindpeeker/negentropy` so
 * consumers of this package need only one import. The shapes are structural:
 * any `@mindpeeker/entropy` provider satisfies `TrialSource` without either
 * package importing the other. Bits are MSB-first SDK-wide.
 */
export type {
  StatResult,
  Trial,
  TrialSeries,
  TrialSource,
  TrialStreamOptions,
} from '@mindpeeker/negentropy'

/**
 * Operator intention of a PEAR-style run: aim the trial mean up (`high`),
 * down (`low`), or leave the device alone (`baseline`). The tripolar design
 * (Jahn et al. 1997, "Correlations of Random Binary Sequences with
 * Pre-Stated Operator Intention") makes the primary statistic a *difference*
 * — high minus low — so common-mode drift of the device cancels.
 */
export type Intention = 'high' | 'low' | 'baseline'

/**
 * Epoch class in a presentiment (time-reversed) experiment: `target` epochs
 * precede the stimulus of interest (e.g. an arousing or "hit" event),
 * `control` epochs precede a neutral one. The presentiment hypothesis is that
 * pre-stimulus randomness deviates more before `target` than `control`
 * stimuli (Radin 1997; Mossbridge, Tressoldi & Utts 2012 meta-analysis).
 */
export type Stimulus = 'target' | 'control'
