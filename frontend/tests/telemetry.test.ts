import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RollingWindowStats,
  RenderTelemetryCollector,
  VisionTelemetryCollector,
  LatencyTelemetryCollector,
  PerformanceTelemetry,
  PIPELINE_LATENCY_DESCRIPTION,
} from '../src/utils/telemetry';

describe('RollingWindowStats (Bounded Statistical Accumulator)', () => {
  it('returns zeroed stats when empty', () => {
    const stats = new RollingWindowStats(50);
    const result = stats.computeStats();

    assert.equal(result.count, 0);
    assert.equal(result.avg, 0);
    assert.equal(result.min, 0);
    assert.equal(result.max, 0);
    assert.equal(result.p95, 0);
  });

  it('correctly calculates min, max, avg, and P95 on deterministic data', () => {
    const stats = new RollingWindowStats(100);

    // Push 100 sequential values: 1, 2, ..., 100
    for (let i = 1; i <= 100; i++) {
      stats.push(i);
    }

    const result = stats.computeStats();
    assert.equal(result.count, 100);
    assert.equal(result.min, 1);
    assert.equal(result.max, 100);
    assert.equal(result.avg, 50.5); // (100 * 101) / (2 * 100)
    assert.equal(result.p95, 95); // 95th percentile
  });

  it('enforces bounded capacity and overwrites oldest samples in ring buffer', () => {
    const capacity = 10;
    const stats = new RollingWindowStats(capacity);

    // Push 10 values: 10, 20, ..., 100
    for (let i = 1; i <= 10; i++) {
      stats.push(i * 10);
    }
    assert.equal(stats.sampleCount, 10);
    assert.equal(stats.computeStats().min, 10);
    assert.equal(stats.computeStats().max, 100);

    // Push 5 more values: 200, 210, 220, 230, 240
    // Buffer should stay at capacity 10, overwriting 10, 20, 30, 40, 50
    for (let i = 1; i <= 5; i++) {
      stats.push(200 + (i - 1) * 10);
    }
    assert.equal(stats.sampleCount, 10);
    const updated = stats.computeStats();
    assert.equal(updated.count, 10);
    // Remaining samples: 60, 70, 80, 90, 100, 200, 210, 220, 230, 240
    assert.equal(updated.min, 60);
    assert.equal(updated.max, 240);
  });

  it('safely rejects NaN, Infinity, negative, and non-numeric values', () => {
    const stats = new RollingWindowStats(20);
    stats.push(NaN);
    stats.push(Infinity);
    stats.push(-Infinity);
    stats.push(-15);
    stats.push(Number.NaN);

    assert.equal(stats.sampleCount, 0);
    assert.equal(stats.computeStats().count, 0);

    // Valid push works afterwards
    stats.push(16.67);
    assert.equal(stats.sampleCount, 1);
    assert.equal(stats.computeStats().avg, 16.67);
  });

  it('resets buffer and state cleanly', () => {
    const stats = new RollingWindowStats(20);
    stats.push(10);
    stats.push(20);
    assert.equal(stats.sampleCount, 2);

    stats.reset();
    assert.equal(stats.sampleCount, 0);
    const res = stats.computeStats();
    assert.equal(res.count, 0);
    assert.equal(res.avg, 0);
  });
});

describe('RenderTelemetryCollector (WebGL & Frame-Time Telemetry)', () => {
  it('correctly calculates 60 FPS and 16.67ms frame times from synthetic ticks', () => {
    const collector = new RenderTelemetryCollector(60);

    // Simulate 61 frames at 16.667ms delta (60 FPS) spanning 1000ms
    let timestamp = 1000;
    const delta = 16.667;

    for (let i = 0; i <= 60; i++) {
      collector.recordFrame(timestamp);
      timestamp += delta;
    }

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.totalFrameCount, 61);
    assert.equal(snapshot.sampleCount, 60);
    // At ~16.67ms delta, FPS is ~60
    assert.ok(snapshot.fps >= 59 && snapshot.fps <= 61, `Expected ~60 FPS, got ${snapshot.fps}`);
    assert.ok(
      snapshot.avgFrameTimeMs >= 16.6 && snapshot.avgFrameTimeMs <= 16.7,
      `Expected ~16.67ms, got ${snapshot.avgFrameTimeMs}`
    );
    assert.ok(snapshot.minFrameTimeMs > 0);
    assert.ok(snapshot.maxFrameTimeMs > 0);
    assert.ok(snapshot.p95FrameTimeMs > 0);
  });

  it('safely handles duplicate timestamps and non-monotonic clocks', () => {
    const collector = new RenderTelemetryCollector(30);

    collector.recordFrame(1000);
    // Duplicate timestamp (delta 0)
    collector.recordFrame(1000);
    // Non-monotonic timestamp (delta < 0)
    collector.recordFrame(950);
    // Invalid timestamp
    collector.recordFrame(-10);
    collector.recordFrame(NaN);

    const snapshot = collector.getSnapshot();
    // Only valid advancing deltas are accumulated into frameTime stats
    assert.equal(snapshot.sampleCount, 0);

    // Now advance normally
    collector.recordFrame(1033.33);
    const updated = collector.getSnapshot();
    assert.equal(updated.sampleCount, 1);
    assert.ok(updated.avgFrameTimeMs > 0);
  });

  it('resets render telemetry completely', () => {
    const collector = new RenderTelemetryCollector(30);
    collector.recordFrame(1000);
    collector.recordFrame(1016.67);
    collector.recordFrame(1033.33);

    assert.ok(collector.getSnapshot().totalFrameCount > 0);

    collector.reset();
    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.totalFrameCount, 0);
    assert.equal(snapshot.sampleCount, 0);
    assert.equal(snapshot.fps, 0);
    assert.equal(snapshot.frameTimeMs, 0);
    assert.equal(snapshot.avgFrameTimeMs, 0);
  });
});

describe('VisionTelemetryCollector (Inference, Smoothing & Tracking FPS)', () => {
  it('measures landmark inference, smoothing, and total vision processing duration', () => {
    const collector = new VisionTelemetryCollector(60);

    // Simulate 31 vision frames at 33.33ms intervals (~30 FPS)
    // Inference: 12ms, Smoothing: 1.5ms, Total: 13.5ms
    let timestamp = 1000;
    for (let i = 0; i <= 30; i++) {
      collector.recordVisionFrame({
        inferenceDurationMs: 12.0,
        smoothingDurationMs: 1.5,
        totalDurationMs: 13.5,
        timestamp,
      });
      timestamp += 33.333;
    }

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.totalFrameCount, 31);
    assert.equal(snapshot.sampleCount, 31);
    assert.equal(snapshot.avgInferenceDurationMs, 12.0);
    assert.equal(snapshot.avgSmoothingDurationMs, 1.5);
    assert.equal(snapshot.avgVisionDurationMs, 13.5);
    assert.equal(snapshot.p95VisionDurationMs, 13.5);
    assert.ok(
      snapshot.trackingFps >= 29 && snapshot.trackingFps <= 31,
      `Expected ~30 FPS tracking, got ${snapshot.trackingFps}`
    );
  });

  it('safely handles missing optional metrics and computes total fallback', () => {
    const collector = new VisionTelemetryCollector(30);

    collector.recordVisionFrame({
      inferenceDurationMs: 15.2,
      // smoothingDurationMs omitted
      // totalDurationMs omitted
    });

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.sampleCount, 1);
    assert.equal(snapshot.inferenceDurationMs, 15.2);
    assert.equal(snapshot.smoothingDurationMs, 0);
    assert.equal(snapshot.totalVisionDurationMs, 15.2);
  });

  it('safely rejects invalid or negative vision metrics', () => {
    const collector = new VisionTelemetryCollector(30);

    collector.recordVisionFrame({
      inferenceDurationMs: -5,
      smoothingDurationMs: -2,
    });
    collector.recordVisionFrame({
      inferenceDurationMs: NaN,
    });

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.totalFrameCount, 0);
    assert.equal(snapshot.sampleCount, 0);
  });

  it('resets vision telemetry cleanly', () => {
    const collector = new VisionTelemetryCollector(30);
    collector.recordVisionFrame({ inferenceDurationMs: 10, timestamp: 1000 });
    collector.recordVisionFrame({ inferenceDurationMs: 10, timestamp: 1033 });

    collector.reset();
    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.totalFrameCount, 0);
    assert.equal(snapshot.sampleCount, 0);
    assert.equal(snapshot.avgInferenceDurationMs, 0);
    assert.equal(snapshot.trackingFps, 0);
  });
});

describe('LatencyTelemetryCollector (Application-Level Pipeline Latency)', () => {
  it('correctly tracks vision-to-scene latency across multiple frames', () => {
    const collector = new LatencyTelemetryCollector(60);

    // Frame 1: vision at 1000ms, scene at 1024ms => 24ms
    collector.recordLatency(1000, 1024);
    // Frame 2: vision at 1033ms, scene at 1055ms => 22ms
    collector.recordLatency(1033, 1055);
    // Frame 3: vision at 1066ms, scene at 1096ms => 30ms
    collector.recordLatency(1066, 1096);

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.sampleCount, 3);
    assert.equal(snapshot.lastLatencyMs, 30);
    assert.equal(snapshot.minLatencyMs, 22);
    assert.equal(snapshot.maxLatencyMs, 30);
    assert.equal(snapshot.avgLatencyMs, 25.33); // (24 + 22 + 30) / 3 = 25.33
    assert.equal(snapshot.description, PIPELINE_LATENCY_DESCRIPTION);
  });

  it('safely ignores negative, out-of-order, or non-finite latency pairs', () => {
    const collector = new LatencyTelemetryCollector(20);

    // Applied timestamp before vision timestamp
    collector.recordLatency(2000, 1950);
    // Non-finite timestamps
    collector.recordLatency(NaN, 1000);
    collector.recordLatency(1000, Infinity);

    const snapshot = collector.getSnapshot();
    assert.equal(snapshot.sampleCount, 0);
    assert.equal(snapshot.lastLatencyMs, 0);
    assert.equal(snapshot.avgLatencyMs, 0);
  });

  it('resets latency stats cleanly', () => {
    const collector = new LatencyTelemetryCollector(20);
    collector.recordLatency(100, 125);
    assert.equal(collector.getSnapshot().sampleCount, 1);

    collector.reset();
    assert.equal(collector.getSnapshot().sampleCount, 0);
    assert.equal(collector.getSnapshot().lastLatencyMs, 0);
  });
});

describe('PerformanceTelemetry (Unified Orchestrator)', () => {
  it('keeps render, vision, and latency measurements completely independent', () => {
    const telemetry = new PerformanceTelemetry(60);

    // Record render frame
    telemetry.render.recordFrame(1000);
    telemetry.render.recordFrame(1016.67);

    // Record vision frame
    telemetry.vision.recordVisionFrame({
      inferenceDurationMs: 14.2,
      smoothingDurationMs: 0.8,
      timestamp: 1000,
    });

    // Record latency
    telemetry.latency.recordLatency(1000, 1025);

    const combined = telemetry.getCombinedSnapshot(1050);
    assert.equal(combined.timestamp, 1050);

    // Check independence
    assert.equal(combined.render.totalFrameCount, 2);
    assert.equal(combined.render.sampleCount, 1);

    assert.equal(combined.vision.totalFrameCount, 1);
    assert.equal(combined.vision.inferenceDurationMs, 14.2);

    assert.equal(combined.latency.sampleCount, 1);
    assert.equal(combined.latency.lastLatencyMs, 25);
  });

  it('resets all sub-collectors simultaneously when reset() is invoked', () => {
    const telemetry = new PerformanceTelemetry(30);

    telemetry.render.recordFrame(100);
    telemetry.render.recordFrame(116);
    telemetry.vision.recordVisionFrame({ inferenceDurationMs: 12 });
    telemetry.latency.recordLatency(100, 120);

    telemetry.reset();

    const snapshot = telemetry.getCombinedSnapshot();
    assert.equal(snapshot.render.totalFrameCount, 0);
    assert.equal(snapshot.vision.totalFrameCount, 0);
    assert.equal(snapshot.latency.sampleCount, 0);
  });
});
