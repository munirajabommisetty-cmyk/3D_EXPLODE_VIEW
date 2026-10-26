/**
 * Performance Telemetry & Latency Benchmarking Service
 * Task 6.2: Measures rendering framerates, vision processing inference/smoothing times,
 * and application-level pipeline latency using bounded circular memory buffers.
 */

export const PIPELINE_LATENCY_DESCRIPTION =
  'Application-level vision-to-scene latency measuring duration from MediaPipe frame timestamp to 3D scene transform & raycast application. Excludes physical CMOS camera exposure, USB bus transport, browser video decoding, and GPU display scanout.';

/**
 * High-performance bounded rolling statistical accumulator.
 * Uses a fixed-size Float64Array circular buffer to prevent heap allocations
 * and unbounded memory growth during high-frequency 60 FPS animation loops.
 */
export class RollingWindowStats {
  private buffer: Float64Array;
  private capacity: number;
  private count: number = 0;
  private head: number = 0;

  constructor(capacity = 120) {
    this.capacity = Math.max(10, Math.floor(capacity));
    this.buffer = new Float64Array(this.capacity);
  }

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  get sampleCount(): number {
    return this.count;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  computeStats(): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
  } {
    if (this.count === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, p95: 0 };
    }

    const samples: number[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      samples[i] = this.buffer[i];
    }
    samples.sort((a, b) => a - b);

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i];
    }

    const avg = Number((sum / samples.length).toFixed(2));
    const min = Number(samples[0].toFixed(2));
    const max = Number(samples[samples.length - 1].toFixed(2));

    // Nearest rank method for 95th percentile
    const p95Index = Math.min(
      samples.length - 1,
      Math.max(0, Math.ceil(0.95 * samples.length) - 1)
    );
    const p95 = Number(samples[p95Index].toFixed(2));

    return { count: this.count, avg, min, max, p95 };
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.buffer.fill(0);
  }
}

export interface RenderStats {
  fps: number;
  frameTimeMs: number;
  avgFrameTimeMs: number;
  minFrameTimeMs: number;
  maxFrameTimeMs: number;
  p95FrameTimeMs: number;
  sampleCount: number;
  totalFrameCount: number;
}

export interface VisionStats {
  trackingFps: number;
  inferenceDurationMs: number;
  avgInferenceDurationMs: number;
  p95InferenceDurationMs: number;
  smoothingDurationMs: number;
  avgSmoothingDurationMs: number;
  totalVisionDurationMs: number;
  avgVisionDurationMs: number;
  minVisionDurationMs: number;
  maxVisionDurationMs: number;
  p95VisionDurationMs: number;
  sampleCount: number;
  totalFrameCount: number;
}

export interface LatencyStats {
  lastLatencyMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  sampleCount: number;
  description: string;
}

export interface TelemetrySnapshot {
  timestamp: number;
  render: RenderStats;
  vision: VisionStats;
  latency: LatencyStats;
}

/**
 * Render telemetry accumulator measuring frame-time deltas and WebGL FPS.
 */
export class RenderTelemetryCollector {
  private frameTimeStats: RollingWindowStats;
  private lastTimestamp: number | null = null;
  private lastFrameTimeMs: number = 0;
  private currentFps: number = 0;
  private totalFrames: number = 0;

  // Windowed FPS calculation accumulators (e.g. 500-1000ms window)
  private fpsWindowFrames: number = 0;
  private fpsWindowStart: number | null = null;

  constructor(bufferCapacity = 120) {
    this.frameTimeStats = new RollingWindowStats(bufferCapacity);
  }

  recordFrame(nowTimestamp: number): void {
    if (!Number.isFinite(nowTimestamp) || nowTimestamp <= 0) return;

    this.totalFrames++;

    if (this.lastTimestamp !== null) {
      const delta = nowTimestamp - this.lastTimestamp;
      if (delta > 0) {
        this.lastFrameTimeMs = Number(delta.toFixed(2));
        this.frameTimeStats.push(this.lastFrameTimeMs);

        // Update rolling window FPS
        this.fpsWindowFrames++;
        if (this.fpsWindowStart === null) {
          this.fpsWindowStart = this.lastTimestamp;
        }
        const windowElapsed = nowTimestamp - this.fpsWindowStart;
        if (windowElapsed >= 500) {
          this.currentFps = Math.round((this.fpsWindowFrames * 1000) / windowElapsed);
          this.fpsWindowFrames = 0;
          this.fpsWindowStart = nowTimestamp;
        }
      }
    } else {
      this.fpsWindowStart = nowTimestamp;
    }

    this.lastTimestamp = nowTimestamp;
  }

  getSnapshot(): RenderStats {
    const stats = this.frameTimeStats.computeStats();

    // Fallback FPS to instantaneous calculation if window has not ticked yet
    const fps =
      this.currentFps > 0
        ? this.currentFps
        : stats.avg > 0
        ? Math.round(1000 / stats.avg)
        : 0;

    return {
      fps,
      frameTimeMs: this.lastFrameTimeMs,
      avgFrameTimeMs: stats.avg,
      minFrameTimeMs: stats.min,
      maxFrameTimeMs: stats.max,
      p95FrameTimeMs: stats.p95,
      sampleCount: stats.count,
      totalFrameCount: this.totalFrames,
    };
  }

  reset(): void {
    this.frameTimeStats.reset();
    this.lastTimestamp = null;
    this.lastFrameTimeMs = 0;
    this.currentFps = 0;
    this.totalFrames = 0;
    this.fpsWindowFrames = 0;
    this.fpsWindowStart = null;
  }
}

/**
 * Vision telemetry accumulator measuring inference, smoothing, and tracking FPS.
 */
export class VisionTelemetryCollector {
  private inferenceStats: RollingWindowStats;
  private smoothingStats: RollingWindowStats;
  private totalVisionStats: RollingWindowStats;

  private lastInferenceMs: number = 0;
  private lastSmoothingMs: number = 0;
  private lastTotalVisionMs: number = 0;

  private currentTrackingFps: number = 0;
  private totalFrames: number = 0;
  private fpsWindowFrames: number = 0;
  private fpsWindowStart: number | null = null;

  constructor(bufferCapacity = 120) {
    this.inferenceStats = new RollingWindowStats(bufferCapacity);
    this.smoothingStats = new RollingWindowStats(bufferCapacity);
    this.totalVisionStats = new RollingWindowStats(bufferCapacity);
  }

  recordVisionFrame(metrics: {
    inferenceDurationMs: number;
    smoothingDurationMs?: number;
    totalDurationMs?: number;
    timestamp?: number;
  }): void {
    const { inferenceDurationMs, smoothingDurationMs = 0, totalDurationMs, timestamp } = metrics;

    if (!Number.isFinite(inferenceDurationMs) || inferenceDurationMs < 0) return;

    this.totalFrames++;
    this.lastInferenceMs = Number(inferenceDurationMs.toFixed(2));
    this.inferenceStats.push(this.lastInferenceMs);

    if (Number.isFinite(smoothingDurationMs) && smoothingDurationMs >= 0) {
      this.lastSmoothingMs = Number(smoothingDurationMs.toFixed(2));
      this.smoothingStats.push(this.lastSmoothingMs);
    }

    const total =
      totalDurationMs !== undefined && Number.isFinite(totalDurationMs) && totalDurationMs >= 0
        ? totalDurationMs
        : inferenceDurationMs + (smoothingDurationMs || 0);

    this.lastTotalVisionMs = Number(total.toFixed(2));
    this.totalVisionStats.push(this.lastTotalVisionMs);

    // Update tracking FPS window if timestamp provided
    if (timestamp !== undefined && Number.isFinite(timestamp) && timestamp > 0) {
      if (this.fpsWindowStart === null) {
        this.fpsWindowStart = timestamp;
      } else {
        this.fpsWindowFrames++;
        const windowElapsed = timestamp - this.fpsWindowStart;
        if (windowElapsed >= 500) {
          this.currentTrackingFps = Math.round((this.fpsWindowFrames * 1000) / windowElapsed);
          this.fpsWindowFrames = 0;
          this.fpsWindowStart = timestamp;
        }
      }
    }
  }

  getSnapshot(): VisionStats {
    const infStats = this.inferenceStats.computeStats();
    const smoothStats = this.smoothingStats.computeStats();
    const totStats = this.totalVisionStats.computeStats();

    // Fallback tracking FPS from total duration if window has not ticked
    const trackingFps =
      this.currentTrackingFps > 0
        ? this.currentTrackingFps
        : totStats.avg > 0
        ? Math.round(1000 / totStats.avg)
        : 0;

    return {
      trackingFps,
      inferenceDurationMs: this.lastInferenceMs,
      avgInferenceDurationMs: infStats.avg,
      p95InferenceDurationMs: infStats.p95,
      smoothingDurationMs: this.lastSmoothingMs,
      avgSmoothingDurationMs: smoothStats.avg,
      totalVisionDurationMs: this.lastTotalVisionMs,
      avgVisionDurationMs: totStats.avg,
      minVisionDurationMs: totStats.min,
      maxVisionDurationMs: totStats.max,
      p95VisionDurationMs: totStats.p95,
      sampleCount: totStats.count,
      totalFrameCount: this.totalFrames,
    };
  }

  reset(): void {
    this.inferenceStats.reset();
    this.smoothingStats.reset();
    this.totalVisionStats.reset();
    this.lastInferenceMs = 0;
    this.lastSmoothingMs = 0;
    this.lastTotalVisionMs = 0;
    this.currentTrackingFps = 0;
    this.totalFrames = 0;
    this.fpsWindowFrames = 0;
    this.fpsWindowStart = null;
  }
}

/**
 * Latency telemetry accumulator measuring vision-frame-to-scene-update elapsed time.
 */
export class LatencyTelemetryCollector {
  private latencyStats: RollingWindowStats;
  private lastLatencyMs: number = 0;

  constructor(bufferCapacity = 120) {
    this.latencyStats = new RollingWindowStats(bufferCapacity);
  }

  recordLatency(visionTimestamp: number, sceneAppliedTimestamp: number): void {
    if (
      !Number.isFinite(visionTimestamp) ||
      !Number.isFinite(sceneAppliedTimestamp) ||
      sceneAppliedTimestamp < visionTimestamp
    ) {
      return;
    }

    const delta = sceneAppliedTimestamp - visionTimestamp;
    if (delta >= 0 && Number.isFinite(delta)) {
      this.lastLatencyMs = Number(delta.toFixed(2));
      this.latencyStats.push(this.lastLatencyMs);
    }
  }

  getSnapshot(): LatencyStats {
    const stats = this.latencyStats.computeStats();
    return {
      lastLatencyMs: this.lastLatencyMs,
      avgLatencyMs: stats.avg,
      minLatencyMs: stats.min,
      maxLatencyMs: stats.max,
      p95LatencyMs: stats.p95,
      sampleCount: stats.count,
      description: PIPELINE_LATENCY_DESCRIPTION,
    };
  }

  reset(): void {
    this.latencyStats.reset();
    this.lastLatencyMs = 0;
  }
}

/**
 * Unified Performance Telemetry Manager orchestrating render, vision, and latency stats.
 */
export class PerformanceTelemetry {
  public readonly render: RenderTelemetryCollector;
  public readonly vision: VisionTelemetryCollector;
  public readonly latency: LatencyTelemetryCollector;

  constructor(bufferCapacity = 120) {
    this.render = new RenderTelemetryCollector(bufferCapacity);
    this.vision = new VisionTelemetryCollector(bufferCapacity);
    this.latency = new LatencyTelemetryCollector(bufferCapacity);
  }

  getCombinedSnapshot(now = performance.now()): TelemetrySnapshot {
    return {
      timestamp: now,
      render: this.render.getSnapshot(),
      vision: this.vision.getSnapshot(),
      latency: this.latency.getSnapshot(),
    };
  }

  reset(): void {
    this.render.reset();
    this.vision.reset();
    this.latency.reset();
  }
}

/**
 * Shared singleton telemetry manager for default runtime usage.
 */
export const defaultTelemetry = new PerformanceTelemetry(120);

/**
 * Diagnostic metrics snapshot contract for development overlay and debugging.
 */
export interface GestureDiagnosticData {
  handsDetected: number;
  trackingStatus: string;
  rawGesture: string;
  stableGesture: string;
  confidence: number;
  pinchDistanceNorm: number;
  isPinchActive: boolean;
  zoomDelta: number;
  cameraDistance: number;
  rejectionReason: string;
  timestamp: number;
}

/**
 * Lightweight observable store for real-time gesture telemetry diagnostics.
 * Throttles subscriber updates to 10 Hz (100ms) to eliminate animation loop overhead.
 */
export class GestureDiagnosticsStore {
  private data: GestureDiagnosticData = {
    handsDetected: 0,
    trackingStatus: 'idle',
    rawGesture: 'NONE',
    stableGesture: 'NONE',
    confidence: 0,
    pinchDistanceNorm: 0,
    isPinchActive: false,
    zoomDelta: 0,
    cameraDistance: 8.25,
    rejectionReason: 'No hands detected',
    timestamp: 0,
  };
  private listeners: Set<(data: GestureDiagnosticData) => void> = new Set();
  private lastBroadcast: number = 0;

  public update(partial: Partial<GestureDiagnosticData>): void {
    Object.assign(this.data, partial);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Throttle subscriber dispatch to 10 Hz to eliminate re-render overhead
    if (now - this.lastBroadcast >= 100) {
      this.lastBroadcast = now;
      this.data.timestamp = now;
      for (const listener of this.listeners) {
        listener({ ...this.data });
      }
    }
  }

  public getSnapshot(): GestureDiagnosticData {
    return { ...this.data };
  }

  public subscribe(listener: (data: GestureDiagnosticData) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.data });
    return () => this.listeners.delete(listener);
  }

  public reset(): void {
    this.data = {
      handsDetected: 0,
      trackingStatus: 'idle',
      rawGesture: 'NONE',
      stableGesture: 'NONE',
      confidence: 0,
      pinchDistanceNorm: 0,
      isPinchActive: false,
      zoomDelta: 0,
      cameraDistance: 8.25,
      rejectionReason: 'Reset',
      timestamp: 0,
    };
    for (const listener of this.listeners) {
      listener({ ...this.data });
    }
  }
}

export const gestureDiagnostics = new GestureDiagnosticsStore();
