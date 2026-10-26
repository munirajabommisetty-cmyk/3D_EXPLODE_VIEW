/**
 * One Euro Filter (1€ Filter) for MediaPipe 21 Hand Landmarks
 *
 * Adaptive speed-based low-pass filter designed by Casiez, Roussel, & Vogel (CHI 2012).
 * Balances jitter reduction at low speeds against responsiveness (low lag) at high speeds.
 * Pure TypeScript implementation independent of React and browser UI.
 */

import type { HandLandmarkResult, NormalizedLandmark } from '../../types/landmarks';

/** Configurable parameters for the One Euro Filter */
export interface OneEuroFilterConfig {
  /**
   * Minimum cutoff frequency in Hertz (f_c_min).
   * Lower values decrease jitter when the hand is stationary or moving slowly.
   * Default: 1.0 Hz
   */
  minCutoff: number;
  /**
   * Speed coefficient (beta).
   * Determines how aggressively the cutoff frequency increases with hand velocity.
   * Higher values reduce lag during fast movements.
   * Default: 1.0 (tuned for normalized [0, 1] screen coordinates)
   */
  beta: number;
  /**
   * Cutoff frequency for the derivative (velocity) low-pass filter (f_c_d).
   * Default: 1.0 Hz
   */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO_CONFIG: OneEuroFilterConfig = {
  minCutoff: 1.0,
  beta: 1.0,
  dCutoff: 1.0,
};

/** Compute exponential smoothing factor alpha from cutoff frequency and delta time */
function computeAlpha(rateHz: number, dtSeconds: number): number {
  const tau = 1.0 / (2.0 * Math.PI * rateHz);
  return 1.0 / (1.0 + tau / dtSeconds);
}

/**
 * 1D One Euro Filter for a single scalar value over variable time intervals.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xPrev: number | null = null;
  private dxPrev: number = 0;
  private tPrev: number | null = null;

  constructor(config: Partial<OneEuroFilterConfig> = {}) {
    const merged = { ...DEFAULT_ONE_EURO_CONFIG, ...config };
    this.minCutoff = Math.max(0.01, merged.minCutoff);
    this.beta = Math.max(0.0, merged.beta);
    this.dCutoff = Math.max(0.01, merged.dCutoff);
  }

  /** Update filter configuration parameters */
  public setConfig(config: Partial<OneEuroFilterConfig>): void {
    if (config.minCutoff !== undefined) this.minCutoff = Math.max(0.01, config.minCutoff);
    if (config.beta !== undefined) this.beta = Math.max(0.0, config.beta);
    if (config.dCutoff !== undefined) this.dCutoff = Math.max(0.01, config.dCutoff);
  }

  /** Get current configuration */
  public getConfig(): OneEuroFilterConfig {
    return {
      minCutoff: this.minCutoff,
      beta: this.beta,
      dCutoff: this.dCutoff,
    };
  }

  /** Check if filter has previous sample history */
  public hasHistory(): boolean {
    return this.xPrev !== null;
  }

  /** Reset filter state cleanly on tracking loss or session start */
  public reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /**
   * Filter a single scalar sample.
   *
   * @param x Raw sample value
   * @param timestampMs Timestamp in milliseconds (from performance.now() or event.timestamp)
   * @returns Smoothed sample value
   */
  public filter(x: number, timestampMs: number): number {
    // Safety check: handle non-finite or NaN inputs without crashing or corrupting history
    if (!Number.isFinite(x) || !Number.isFinite(timestampMs)) {
      return this.xPrev !== null ? this.xPrev : 0;
    }

    // First sample initialization: no previous state, return value directly without artificial jump
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = timestampMs;
      return x;
    }

    // Compute elapsed time in seconds
    const dt = (timestampMs - this.tPrev) / 1000.0;

    // Safety: ignore non-increasing or negative timestamps (e.g. out-of-order frames)
    if (dt <= 0.0) {
      return this.xPrev;
    }

    // Cap excessive dt (e.g. pause/tab-switch > 1.0s) by resetting to prevent gigantic derivative spikes
    if (dt > 1.0) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = timestampMs;
      return x;
    }

    // 1. Estimate raw derivative (velocity)
    const dx = (x - this.xPrev) / dt;

    // 2. Filter derivative with fixed dCutoff
    const alphaD = computeAlpha(this.dCutoff, dt);
    const dxHat = alphaD * dx + (1.0 - alphaD) * this.dxPrev;

    // 3. Dynamic cutoff frequency based on filtered velocity magnitude
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);

    // 4. Filter value with adaptive cutoff
    const alpha = computeAlpha(cutoff, dt);
    const xHat = alpha * x + (1.0 - alpha) * this.xPrev;

    // Commit state
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = timestampMs;

    return xHat;
  }
}

/**
 * 3D Point filter applying independent OneEuroFilter instances to x, y, and z coordinates.
 */
export class Point3DOneEuroFilter {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;
  private filterZ: OneEuroFilter;

  constructor(config: Partial<OneEuroFilterConfig> = {}) {
    this.filterX = new OneEuroFilter(config);
    this.filterY = new OneEuroFilter(config);
    this.filterZ = new OneEuroFilter(config);
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
  }

  public setConfig(config: Partial<OneEuroFilterConfig>): void {
    this.filterX.setConfig(config);
    this.filterY.setConfig(config);
    this.filterZ.setConfig(config);
  }

  public filter(point: NormalizedLandmark, timestampMs: number): NormalizedLandmark {
    return {
      x: this.filterX.filter(point.x, timestampMs),
      y: this.filterY.filter(point.y, timestampMs),
      z: this.filterZ.filter(point.z ?? 0, timestampMs),
    };
  }
}

/**
 * Hand Landmark Filter for all 21 3D points of a single hand.
 * Maintains independent filters for all 21 joints.
 */
export class HandLandmarkOneEuroFilter {
  private filters: Point3DOneEuroFilter[];

  constructor(config: Partial<OneEuroFilterConfig> = {}) {
    this.filters = Array.from({ length: 21 }, () => new Point3DOneEuroFilter(config));
  }

  public reset(): void {
    for (let i = 0; i < 21; i++) {
      this.filters[i].reset();
    }
  }

  public setConfig(config: Partial<OneEuroFilterConfig>): void {
    for (let i = 0; i < 21; i++) {
      this.filters[i].setConfig(config);
    }
  }

  /**
   * Filter an array of 21 landmarks.
   * Returns a new array of fresh objects; does NOT mutate input landmarks.
   */
  public filter(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): NormalizedLandmark[] {
    if (!landmarks || landmarks.length < 21) {
      this.reset();
      return landmarks ? landmarks.map((p) => ({ ...p })) : [];
    }

    const smoothed: NormalizedLandmark[] = new Array(21);
    for (let i = 0; i < 21; i++) {
      smoothed[i] = this.filters[i].filter(landmarks[i], timestampMs);
    }

    return smoothed;
  }
}

/**
 * Multi-Hand Manager keeping separate isolated filter states for Left and Right hands.
 * Prevents filter state crossover when hands enter, swap, or leave camera view.
 */
export class MultiHandOneEuroFilter {
  private leftHandFilter: HandLandmarkOneEuroFilter;
  private rightHandFilter: HandLandmarkOneEuroFilter;

  constructor(config: Partial<OneEuroFilterConfig> = {}) {
    this.leftHandFilter = new HandLandmarkOneEuroFilter(config);
    this.rightHandFilter = new HandLandmarkOneEuroFilter(config);
  }

  public reset(): void {
    this.leftHandFilter.reset();
    this.rightHandFilter.reset();
  }

  public setConfig(config: Partial<OneEuroFilterConfig>): void {
    this.leftHandFilter.setConfig(config);
    this.rightHandFilter.setConfig(config);
  }

  /**
   * Filter detected hands array.
   * Automatically resets filters for any hand not present in the current frame.
   * Returns a new HandLandmarkResult array with smoothed landmarks, preserving rawLandmarks.
   */
  public filterHands(
    detectedHands: HandLandmarkResult[],
    timestampMs: number
  ): HandLandmarkResult[] {
    if (!detectedHands || detectedHands.length === 0) {
      this.reset();
      return [];
    }

    let leftPresent = false;
    let rightPresent = false;

    const smoothedResults: HandLandmarkResult[] = detectedHands.map((hand) => {
      const isLeft = hand.handedness === 'Left';
      if (isLeft) leftPresent = true;
      else rightPresent = true;

      const filter = isLeft ? this.leftHandFilter : this.rightHandFilter;
      const smoothedLandmarks = filter.filter(hand.landmarks, timestampMs);

      return {
        landmarks: smoothedLandmarks,
        rawLandmarks: hand.landmarks.map((p) => ({ ...p })), // Preserved clone of raw input
        handedness: hand.handedness,
        score: hand.score,
      };
    });

    // Reset filter for any hand that disappeared this frame
    if (!leftPresent) this.leftHandFilter.reset();
    if (!rightPresent) this.rightHandFilter.reset();

    return smoothedResults;
  }
}
