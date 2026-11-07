import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  HandLandmarkResult,
  HandLandmarkerStatus,
  Handedness,
  NormalizedLandmark,
} from '../../types/landmarks';
import { MultiHandOneEuroFilter, type OneEuroFilterConfig } from './smoothing';
import { defaultTelemetry, gestureDiagnostics } from '../../utils/telemetry';

export interface UseHandLandmarkerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isCameraActive: boolean;
  maxHands?: number;
  minConfidence?: number;
  enableSmoothing?: boolean;
  smoothingConfig?: Partial<OneEuroFilterConfig>;
}

export interface UseHandLandmarkerReturn {
  status: HandLandmarkerStatus;
  hands: HandLandmarkResult[];
  trackingFps: number;
  errorMessage: string | null;
  resetTracker: () => void;
}

// Local path to wasm and model assets, with CDN fallback
const LOCAL_WASM_PATH = '/wasm';
const CDN_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const LOCAL_MODEL_PATH = '/models/hand_landmarker.task';
const CDN_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * While no hand is in view, MediaPipe runs its (heavier) palm detector on every frame. Measured on
 * the dev machine: ~24 ms per call with the GPU delegate, i.e. most of a 33 ms camera frame on the
 * main thread. Searching for a hand ~15 times a second halves that cost; as soon as a hand is found,
 * every camera frame is processed again (tracking latency unchanged).
 */
export const IDLE_DETECT_INTERVAL_MS = 66;

/** True when a frame should be skipped because no hand is tracked and the last search was recent. */
export function shouldSkipIdleFrame(trackedHands: number, now: number, lastDetectAt: number): boolean {
  return trackedHands === 0 && lastDetectAt > 0 && now - lastDetectAt < IDLE_DETECT_INTERVAL_MS;
}

export function useHandLandmarker({
  videoRef,
  isCameraActive,
  maxHands = 2,
  minConfidence = 0.5,
  enableSmoothing = true,
  smoothingConfig,
}: UseHandLandmarkerOptions): UseHandLandmarkerReturn {
  const [status, setStatus] = useState<HandLandmarkerStatus>('idle');
  const [hands, setHands] = useState<HandLandmarkResult[]>([]);
  const [trackingFps, setTrackingFps] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One Euro Filter manager for multi-hand temporal smoothing
  const multiHandFilter = useMemo(() => {
    return new MultiHandOneEuroFilter(smoothingConfig);
  }, [smoothingConfig]);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const fpsFrameCountRef = useRef<number>(0);
  const fpsLastTimestampRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(false);
  // Performance pass: hands currently tracked, when detection last ran, and the last status sent
  const trackedCountRef = useRef<number>(0);
  const lastDetectAtRef = useRef<number>(0);
  const statusRef = useRef<HandLandmarkerStatus>('idle');
  const setStatusOnce = useCallback((next: HandLandmarkerStatus) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  }, []);

  // Initialize MediaPipe HandLandmarker
  const initLandmarker = useCallback(async () => {
    if (landmarkerRef.current || isInitializingRef.current) return;

    isInitializingRef.current = true;
    statusRef.current = 'initializing';
    setStatus('initializing');
    setErrorMessage(null);

    try {
      // Step 1: Resolve WASM files (try local first, fallback to CDN)
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
      } catch (localWasmErr) {
        console.warn('Local WASM resolver failed, falling back to CDN:', localWasmErr);
        vision = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
      }

      // Step 2: Create HandLandmarker (try local model first, fallback to CDN model)
      let landmarker: HandLandmarker;
      try {
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: LOCAL_MODEL_PATH,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: maxHands,
          minHandDetectionConfidence: minConfidence,
          minHandPresenceConfidence: minConfidence,
          minTrackingConfidence: minConfidence,
        });
      } catch (localModelErr) {
        console.warn('Local model load failed, falling back to CDN model:', localModelErr);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: CDN_MODEL_PATH,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: maxHands,
          minHandDetectionConfidence: minConfidence,
          minHandPresenceConfidence: minConfidence,
          minTrackingConfidence: minConfidence,
        });
      }

      // Warm-up: the first detection compiles the GPU shaders (measured ~4.5 s on the dev machine).
      // Do it now, behind the "initializing" state, instead of freezing the first live frame.
      await new Promise((resolve) => setTimeout(resolve, 30)); // let the loading state paint first
      try {
        const warm = document.createElement('canvas');
        warm.width = 640;
        warm.height = 480;
        landmarker.detectForVideo(warm, performance.now());
      } catch (warmErr) {
        console.warn('Hand tracker warm-up skipped:', warmErr);
      }

      landmarkerRef.current = landmarker;
      statusRef.current = 'ready';
      setStatus('ready');
    } catch (err: unknown) {
      console.error('Failed to initialize HandLandmarker:', err);
      const msg = err instanceof Error ? err.message : 'Failed to initialize hand tracker';
      setErrorMessage(msg);
      statusRef.current = 'error';
      setStatus('error');
    } finally {
      isInitializingRef.current = false;
    }
  }, [maxHands, minConfidence]);

  // Reset tracker
  const resetTracker = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close();
      } catch (e) {
        console.warn('Error closing landmarker:', e);
      }
      landmarkerRef.current = null;
    }
    multiHandFilter.reset();
    defaultTelemetry.vision.reset();
    trackedCountRef.current = 0;
    lastDetectAtRef.current = 0;
    setHands([]);
    setTrackingFps(0);
    statusRef.current = 'idle';
    setStatus('idle');
    setErrorMessage(null);
  }, [multiHandFilter]);

  // Initialize landmarker when camera becomes active
  useEffect(() => {
    if (isCameraActive && !landmarkerRef.current && !isInitializingRef.current) {
      void initLandmarker();
    } else if (!isCameraActive && landmarkerRef.current) {
      // Clear detections when camera is turned off
      multiHandFilter.reset();
      defaultTelemetry.vision.reset();
      trackedCountRef.current = 0;
      lastDetectAtRef.current = 0;
      setHands([]);
      setTrackingFps(0);
      statusRef.current = 'idle';
      setStatus('idle');
    }
  }, [isCameraActive, initLandmarker, multiHandFilter]);

  // Detection loop running on requestAnimationFrame
  useEffect(() => {
    if (!isCameraActive || !landmarkerRef.current || status === 'error') {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    let isSubscribed = true;

    const detectLoop = () => {
      if (!isSubscribed) return;

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (video && landmarker && video.readyState >= 2 && !video.paused) {
        const now = performance.now();
        if (
          video.currentTime !== lastVideoTimeRef.current &&
          !shouldSkipIdleFrame(trackedCountRef.current, now, lastDetectAtRef.current)
        ) {
          lastVideoTimeRef.current = video.currentTime;
          const timestamp = now;
          lastDetectAtRef.current = timestamp;

          try {
            const t0 = performance.now();
            const results = landmarker.detectForVideo(video, timestamp);
            const inferenceDurationMs = performance.now() - t0;

            // Compute FPS
            fpsFrameCountRef.current += 1;
            if (fpsLastTimestampRef.current === 0) {
              fpsLastTimestampRef.current = timestamp;
            }
            const elapsed = timestamp - fpsLastTimestampRef.current;
            if (elapsed >= 500) {
              const currentFps = Math.round((fpsFrameCountRef.current * 1000) / elapsed);
              setTrackingFps(currentFps);
              fpsFrameCountRef.current = 0;
              fpsLastTimestampRef.current = timestamp;
            }

            // Map results to typed structures
            if (results.landmarks && results.landmarks.length > 0) {
              trackedCountRef.current = results.landmarks.length;
              setStatusOnce('detecting');

              const rawDetectedHands: HandLandmarkResult[] = results.landmarks.map(
                (rawLandmarks, idx) => {
                  const rawHandedness = results.handedness?.[idx]?.[0];
                  // MediaPipe provides 'Left' or 'Right'
                  const handedness: Handedness =
                    rawHandedness?.categoryName === 'Left' ? 'Left' : 'Right';
                  const score = rawHandedness?.score ?? 0.9;

                  const landmarks: NormalizedLandmark[] = rawLandmarks.map((lm) => ({
                    x: lm.x,
                    y: lm.y,
                    z: lm.z ?? 0,
                  }));

                  return {
                    landmarks,
                    rawLandmarks: landmarks.map((p) => ({ ...p })),
                    handedness,
                    score,
                    timestamp,
                  };
                }
              );

              // Apply One Euro Filter temporal smoothing
              const tSmooth0 = performance.now();
              const detectedHands = enableSmoothing
                ? multiHandFilter.filterHands(rawDetectedHands, timestamp)
                : rawDetectedHands;
              const smoothingDurationMs = performance.now() - tSmooth0;
              const totalDurationMs = performance.now() - t0;

              for (let i = 0; i < detectedHands.length; i++) {
                detectedHands[i].timestamp = timestamp;
              }

              defaultTelemetry.vision.recordVisionFrame({
                inferenceDurationMs,
                smoothingDurationMs,
                totalDurationMs,
                timestamp,
              });

              setHands(detectedHands);
              gestureDiagnostics.update({
                handsDetected: detectedHands.length,
                trackingStatus: 'detecting',
              });
            } else {
              const totalDurationMs = performance.now() - t0;
              defaultTelemetry.vision.recordVisionFrame({
                inferenceDurationMs,
                smoothingDurationMs: 0,
                totalDurationMs,
                timestamp,
              });

              multiHandFilter.reset();
              // Only tell React when hands disappear: a new empty array every frame re-rendered
              // everything that depends on the hands about 30 times a second with nothing in view
              if (trackedCountRef.current !== 0) {
                trackedCountRef.current = 0;
                setHands([]);
              }
              setStatusOnce('ready');
              gestureDiagnostics.update({
                handsDetected: 0,
                trackingStatus: 'ready',
                rejectionReason: 'No hands in frame',
              });
            }
          } catch (detectionErr: unknown) {
            console.warn('MediaPipe detectForVideo skipped frame:', detectionErr);
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(detectLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(detectLoop);

    return () => {
      isSubscribed = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [enableSmoothing, isCameraActive, multiHandFilter, status, videoRef, setStatusOnce]);

  // Complete cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          // ignore cleanup errors on unmount
        }
      }
    };
  }, []);

  return {
    status,
    hands,
    trackingFps,
    errorMessage,
    resetTracker,
  };
}
