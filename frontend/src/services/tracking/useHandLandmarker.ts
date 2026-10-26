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

  // Initialize MediaPipe HandLandmarker
  const initLandmarker = useCallback(async () => {
    if (landmarkerRef.current || isInitializingRef.current) return;

    isInitializingRef.current = true;
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

      landmarkerRef.current = landmarker;
      setStatus('ready');
    } catch (err: unknown) {
      console.error('Failed to initialize HandLandmarker:', err);
      const msg = err instanceof Error ? err.message : 'Failed to initialize hand tracker';
      setErrorMessage(msg);
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
    setHands([]);
    setTrackingFps(0);
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
      setHands([]);
      setTrackingFps(0);
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
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          const timestamp = performance.now();

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
              setStatus('detecting');

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
              setHands([]);
              setStatus('ready');
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
  }, [enableSmoothing, isCameraActive, multiHandFilter, status, videoRef]);

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
