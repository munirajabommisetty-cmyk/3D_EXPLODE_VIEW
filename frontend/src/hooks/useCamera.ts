import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'not_found'
  | 'unavailable'
  | 'unsupported'
  | 'error';

export interface UseCameraReturn {
  stream: MediaStream | null;
  status: CameraStatus;
  errorMessage: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    facingMode: 'user',
  },
  audio: false, // Explicitly false: do not request microphone permission
};

/**
 * Stops all tracks in an active MediaStream.
 */
export function stopMediaStreamTracks(mediaStream: MediaStream | null): void {
  if (!mediaStream) return;
  mediaStream.getTracks().forEach((track) => {
    track.stop();
  });
}

/**
 * Maps DOM MediaDevices / getUserMedia errors to typed camera statuses and helpful messages.
 */
export function parseCameraError(err: unknown): { status: CameraStatus; errorMessage: string } {
  const domError = err as { name?: string; message?: string };
  const errorName = domError?.name || '';

  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return {
      status: 'denied',
      errorMessage: 'Webcam access was denied. Please allow camera permissions in your browser to enable hand tracking.',
    };
  } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return {
      status: 'not_found',
      errorMessage: 'No webcam detected on your system. Please connect a camera and try again.',
    };
  } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return {
      status: 'unavailable',
      errorMessage: 'Camera is currently in use by another application or unavailable.',
    };
  } else if (errorName === 'OverconstrainedError') {
    return {
      status: 'error',
      errorMessage: 'Camera does not support the requested video resolution.',
    };
  } else {
    return {
      status: 'error',
      errorMessage: domError?.message || 'Failed to start camera due to an unexpected error.',
    };
  }
}

/**
 * Reusable, typed React hook managing webcam media stream, permissions, and lifecycle.
 * Requests strictly video (never audio) and stops all tracks on unmount.
 */
export function useCamera(): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Helper to stop all tracks in an active stream
  const stopTracks = useCallback((mediaStream: MediaStream | null) => {
    stopMediaStreamTracks(mediaStream);
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      stopTracks(streamRef.current);
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (isMountedRef.current) {
      setStream(null);
      setStatus('idle');
      setErrorMessage(null);
    }
  }, [stopTracks]);

  const startCamera = useCallback(async () => {
    // Prevent duplicate stream requests while already active or awaiting user permission
    if (status === 'requesting' || (status === 'active' && streamRef.current)) {
      return;
    }

    // Check browser MediaDevices API support
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setStatus('unsupported');
      setErrorMessage('Camera access is not supported by your browser or environment.');
      return;
    }

    setStatus('requesting');
    setErrorMessage(null);

    // Stop any existing stream before starting a new one
    if (streamRef.current) {
      stopTracks(streamRef.current);
      streamRef.current = null;
    }

    const constraints = DEFAULT_CAMERA_CONSTRAINTS;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // If component unmounted while user was interacting with browser prompt, cancel immediately
      if (!isMountedRef.current) {
        stopTracks(mediaStream);
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setStatus('active');
      setErrorMessage(null);

      // Attach stream to videoRef element if mounted
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(() => {
          // Autoplay policy might require muted video; ensure muted is set
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {
              // Ignore abort errors from rapid re-renders
            });
          }
        });
      }

      // Handle external device disconnect during session (e.g., USB camera unplugged)
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (isMountedRef.current) {
            stopCamera();
            setStatus('unavailable');
            setErrorMessage('Camera device disconnected or stream ended by OS.');
          }
        };
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const { status: errStatus, errorMessage: errMsg } = parseCameraError(err);
      setStatus(errStatus);
      setErrorMessage(errMsg);
    }
  }, [status, stopCamera, stopTracks]);

  // Cleanup on unmount: stop all active tracks immediately
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (streamRef.current) {
        stopTracks(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [stopTracks]);

  return {
    stream,
    status,
    errorMessage,
    startCamera,
    stopCamera,
    videoRef,
  };
}
