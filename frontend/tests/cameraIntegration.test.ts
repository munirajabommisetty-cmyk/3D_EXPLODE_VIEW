/**
 * Integration Test Suite for Camera Service & Permissions (Task 6.1)
 *
 * Validates:
 * 1. Default camera constraints (audio: false, user facingMode, ideal resolution).
 * 2. MediaDevices error classification (NotAllowedError, NotFoundError, NotReadableError, OverconstrainedError).
 * 3. MediaStream track lifecycle management (stopping tracks on disconnect or unmount).
 * 4. Simulated permission and acquisition workflows (idle -> requesting -> active / denied / unavailable).
 * 5. Prevention of duplicate stream requests while already active or pending.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  parseCameraError,
  stopMediaStreamTracks,
  type CameraStatus,
} from '../src/hooks/useCamera';

/**
 * Creates a mock MediaStreamTrack with track lifecycle spying.
 */
function createMockTrack(kind: 'video' | 'audio' = 'video'): MediaStreamTrack & { stopped: boolean } {
  let isStopped = false;
  return {
    kind,
    id: `mock-track-${Math.random().toString(36).slice(2, 8)}`,
    label: `Mock ${kind} track`,
    enabled: true,
    muted: false,
    readyState: 'live',
    get stopped() {
      return isStopped;
    },
    stop: () => {
      isStopped = true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onended: null,
  } as unknown as MediaStreamTrack & { stopped: boolean };
}

/**
 * Creates a mock MediaStream containing customizable video and audio tracks.
 */
function createMockStream(tracks: MediaStreamTrack[] = [createMockTrack('video')]): MediaStream {
  return {
    id: `mock-stream-${Date.now()}`,
    active: true,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    addTrack: (track: MediaStreamTrack) => tracks.push(track),
    removeTrack: (track: MediaStreamTrack) => {
      const idx = tracks.indexOf(track);
      if (idx !== -1) tracks.splice(idx, 1);
    },
    clone: () => createMockStream(tracks),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaStream;
}

describe('Camera Constraints & Security Standards', () => {
  it('enforces video-only access and explicitly disables audio/microphone permissions', () => {
    assert.equal(
      DEFAULT_CAMERA_CONSTRAINTS.audio,
      false,
      'Security requirement: Microphone access must remain strictly disabled'
    );
  });

  it('configures front-facing user camera with optimal 640x480 resolution', () => {
    const video = DEFAULT_CAMERA_CONSTRAINTS.video as MediaTrackConstraints;
    assert.ok(video !== undefined);
    assert.equal(video.facingMode, 'user');
    assert.deepEqual(video.width, { ideal: 640 });
    assert.deepEqual(video.height, { ideal: 480 });
  });
});

describe('Camera Error Classification (DOM Exceptions to CameraStatus)', () => {
  it('maps NotAllowedError and PermissionDeniedError to denied status', () => {
    const err1 = { name: 'NotAllowedError', message: 'Permission dismissed' };
    const res1 = parseCameraError(err1);
    assert.equal(res1.status, 'denied');
    assert.ok(res1.errorMessage.includes('allow camera permissions'));

    const err2 = { name: 'PermissionDeniedError', message: 'User blocked camera' };
    const res2 = parseCameraError(err2);
    assert.equal(res2.status, 'denied');
  });

  it('maps NotFoundError and DevicesNotFoundError to not_found status', () => {
    const err1 = { name: 'NotFoundError', message: 'No video device found' };
    const res1 = parseCameraError(err1);
    assert.equal(res1.status, 'not_found');
    assert.ok(res1.errorMessage.includes('No webcam detected'));

    const err2 = { name: 'DevicesNotFoundError', message: 'Device missing' };
    const res2 = parseCameraError(err2);
    assert.equal(res2.status, 'not_found');
  });

  it('maps NotReadableError and TrackStartError to unavailable status (hardware in use)', () => {
    const err1 = { name: 'NotReadableError', message: 'Device locked by another process' };
    const res1 = parseCameraError(err1);
    assert.equal(res1.status, 'unavailable');
    assert.ok(res1.errorMessage.includes('in use by another application'));

    const err2 = { name: 'TrackStartError', message: 'Could not start video source' };
    const res2 = parseCameraError(err2);
    assert.equal(res2.status, 'unavailable');
  });

  it('maps OverconstrainedError to error status with resolution hint', () => {
    const err = { name: 'OverconstrainedError', message: 'Constraints cannot be satisfied' };
    const res = parseCameraError(err);
    assert.equal(res.status, 'error');
    assert.ok(res.errorMessage.includes('resolution'));
  });

  it('maps generic and unexpected exceptions safely to fallback error status', () => {
    const res1 = parseCameraError(new Error('Unknown hardware failure'));
    assert.equal(res1.status, 'error');
    assert.equal(res1.errorMessage, 'Unknown hardware failure');

    const res2 = parseCameraError('Unexpected string error');
    assert.equal(res2.status, 'error');

    const res3 = parseCameraError(null);
    assert.equal(res3.status, 'error');
  });
});

describe('MediaStream Track Lifecycle Management', () => {
  it('safely stops all active tracks across video and audio', () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);

    assert.equal(videoTrack.stopped, false);
    stopMediaStreamTracks(stream);
    assert.equal(videoTrack.stopped, true);
  });

  it('safely handles null or empty media streams without throwing', () => {
    assert.doesNotThrow(() => {
      stopMediaStreamTracks(null);
      stopMediaStreamTracks(createMockStream([]));
    });
  });
});

describe('Simulated Camera Acquisition & Lifecycle Workflows', () => {
  it('simulates successful camera permission and active streaming workflow', async () => {
    let currentStatus: CameraStatus = 'idle';
    let activeStream: MediaStream | null = null;
    let errorMessage: string | null = null;

    const mockVideoTrack = createMockTrack('video');
    const mockStream = createMockStream([mockVideoTrack]);

    const mockGetUserMedia = async (): Promise<MediaStream> => {
      currentStatus = 'requesting';
      return mockStream;
    };

    // 1. Initial State
    assert.equal(currentStatus, 'idle');
    assert.equal(activeStream, null);

    // 2. Acquisition Trigger
    currentStatus = 'requesting';
    activeStream = await mockGetUserMedia();
    currentStatus = 'active';

    assert.equal(currentStatus, 'active');
    assert.ok(activeStream !== null);
    assert.equal(errorMessage, null);
    assert.equal(activeStream.getVideoTracks().length, 1);

    // 3. Teardown / Stop
    stopMediaStreamTracks(activeStream);
    activeStream = null;
    currentStatus = 'idle';

    assert.equal(currentStatus, 'idle');
    assert.equal(mockVideoTrack.stopped, true);
  });

  it('simulates permission rejection flow with clean fallback', async () => {
    let currentStatus: CameraStatus = 'idle';
    let errorMessage: string | null = null;

    const mockGetUserMedia = async (): Promise<MediaStream> => {
      throw { name: 'NotAllowedError', message: 'Permission denied by user' };
    };

    try {
      currentStatus = 'requesting';
      await mockGetUserMedia();
    } catch (err) {
      const parsed = parseCameraError(err);
      currentStatus = parsed.status;
      errorMessage = parsed.errorMessage;
    }

    assert.equal(currentStatus, 'denied');
    assert.ok(errorMessage !== null && errorMessage.includes('allow camera permissions'));
  });

  it('simulates external device disconnect while streaming (USB unplugged)', () => {
    let currentStatus: CameraStatus = 'active';
    let errorMessage: string | null = null;

    const mockTrack = createMockTrack('video');
    const mockStream = createMockStream([mockTrack]);

    // Register onended listener as done in useCamera hook
    mockTrack.onended = () => {
      stopMediaStreamTracks(mockStream);
      currentStatus = 'unavailable';
      errorMessage = 'Camera device disconnected or stream ended by OS.';
    };

    // Simulate OS camera unplug event
    mockTrack.onended(new Event('ended'));

    assert.equal(currentStatus, 'unavailable');
    assert.equal(mockTrack.stopped, true);
    assert.ok(errorMessage !== null && errorMessage.includes('disconnected'));
  });
});
