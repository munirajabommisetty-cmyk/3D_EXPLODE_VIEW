/**
 * Hand Landmark Types & Topologies for MediaPipe Hands
 * 21 3D Landmarks per detected hand
 */

export interface NormalizedLandmark {
  x: number; // Normalized [0, 1] relative to video width
  y: number; // Normalized [0, 1] relative to video height
  z: number; // Approximate depth relative to wrist (smaller is closer to camera)
}

export type Handedness = 'Left' | 'Right';

export interface HandLandmarkResult {
  landmarks: NormalizedLandmark[];
  rawLandmarks?: NormalizedLandmark[];
  handedness: Handedness;
  score: number;
  timestamp?: number;
}

export type HandLandmarkerStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'detecting'
  | 'error';

/**
 * Standard MediaPipe Hand 21-point topology connections:
 * 0: Wrist
 * 1-4: Thumb (CMC, MCP, IP, TIP)
 * 5-8: Index finger (MCP, PIP, DIP, TIP)
 * 9-12: Middle finger (MCP, PIP, DIP, TIP)
 * 13-16: Ring finger (MCP, PIP, DIP, TIP)
 * 17-20: Pinky finger (MCP, PIP, DIP, TIP)
 */
export const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm Base connections
  [5, 9],
  [9, 13],
  [13, 17],
];

/** Landmark indices for tips and joints */
export const LANDMARK_INDEX = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;
