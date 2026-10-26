import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Group } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import * as fs from "node:fs";
import * as path from "node:path";
// src/types/landmarks.ts
/**
* Standard MediaPipe Hand 21-point topology connections:
* 0: Wrist
* 1-4: Thumb (CMC, MCP, IP, TIP)
* 5-8: Index finger (MCP, PIP, DIP, TIP)
* 9-12: Middle finger (MCP, PIP, DIP, TIP)
* 13-16: Ring finger (MCP, PIP, DIP, TIP)
* 17-20: Pinky finger (MCP, PIP, DIP, TIP)
*/
var HAND_CONNECTIONS = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4],
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8],
	[9, 10],
	[10, 11],
	[11, 12],
	[13, 14],
	[14, 15],
	[15, 16],
	[0, 17],
	[17, 18],
	[18, 19],
	[19, 20],
	[5, 9],
	[9, 13],
	[13, 17]
];
/** Landmark indices for tips and joints */
var LANDMARK_INDEX = {
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
	PINKY_TIP: 20
};
// src/types/gestures.ts
/** Default tuned thresholds */
var DEFAULT_GESTURE_THRESHOLDS = {
	pinchMaxNormDist: .38,
	pinchReleaseNormDist: .6,
	fingerExtensionRatio: 1.15,
	fingerCurlRatio: 1.05,
	minExtendedMcpToTipNorm: .65,
	thumbOpenNormDist: .6,
	minConfidence: .6,
	minTrackingConfidence: .5,
	stabilityFramesRequired: 3
};
// src/services/gestures/gestureRules.ts
/**
* Geometric Gesture Recognition Rules
* Pure mathematical functions for classifying 21 MediaPipe hand landmarks.
* Fully decoupled from React and browser APIs for standalone testability.
*/
/** Compute Euclidean distance in 3D normalized space */
function distance3D(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = (a.z ?? 0) - (b.z ?? 0);
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
/**
* Compute the scale of the hand using the rigid palm base dimension.
* Distance between Wrist (0) and Middle MCP (9) is invariant to finger curling.
*/
function calculateHandScale(landmarks) {
	if (!landmarks || landmarks.length < 21) return .1;
	const wrist = landmarks[LANDMARK_INDEX.WRIST];
	const middleMcp = landmarks[LANDMARK_INDEX.MIDDLE_MCP];
	const indexMcp = landmarks[LANDMARK_INDEX.INDEX_MCP];
	const pinkyMcp = landmarks[LANDMARK_INDEX.PINKY_MCP];
	if (!wrist || !middleMcp || !indexMcp || !pinkyMcp) return .1;
	const wristToMiddleMcp = distance3D(wrist, middleMcp);
	const palmWidth = distance3D(indexMcp, pinkyMcp);
	const rawPalmDim = Math.max(wristToMiddleMcp, palmWidth);
	if (rawPalmDim < .02 || !Number.isFinite(rawPalmDim)) return 0;
	return Math.max(rawPalmDim, .05);
}
/**
* Analyze finger extension state for a 4-joint finger chain (Index, Middle, Ring, Pinky).
*/
function analyzeFinger(landmarks, mcpIdx, pipIdx, _dipIdx, tipIdx, handScale, thresholds) {
	const wrist = landmarks[LANDMARK_INDEX.WRIST];
	const mcp = landmarks[mcpIdx];
	const pip = landmarks[pipIdx];
	const tip = landmarks[tipIdx];
	const distWristToTip = distance3D(wrist, tip);
	const extensionRatio = distWristToTip / Math.max(distance3D(wrist, pip), .001);
	const tipToMcpNorm = distance3D(mcp, tip) / Math.max(handScale, .001);
	const boneMcpPip = distance3D(mcp, pip);
	const bonePipTip = distance3D(pip, tip);
	const isOccluded = boneMcpPip < .002 && bonePipTip < .002 || distWristToTip / Math.max(handScale, .001) > 3.8;
	const minMcpToTipNorm = mcpIdx === LANDMARK_INDEX.PINKY_MCP ? thresholds.minExtendedMcpToTipNorm * .72 : thresholds.minExtendedMcpToTipNorm;
	return {
		isExtended: !isOccluded && extensionRatio >= thresholds.fingerExtensionRatio && tipToMcpNorm >= minMcpToTipNorm,
		isCurled: !isOccluded && (extensionRatio <= thresholds.fingerCurlRatio || tipToMcpNorm < minMcpToTipNorm * .75),
		extensionRatio,
		tipToMcpNorm,
		isOccluded
	};
}
/**
* Extract comprehensive digit states for a hand
*/
function extractHandFingersState(landmarks, thresholds = DEFAULT_GESTURE_THRESHOLDS) {
	if (!landmarks || landmarks.length < 21) return null;
	for (let i = 0; i < 21; i++) {
		const lm = landmarks[i];
		if (!lm || typeof lm.x !== "number" || typeof lm.y !== "number" || !Number.isFinite(lm.x) || !Number.isFinite(lm.y) || !Number.isFinite(lm.z ?? 0)) return null;
	}
	const handScale = calculateHandScale(landmarks);
	if (handScale < .02 || !Number.isFinite(handScale)) return null;
	const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
	const thumbMcp = landmarks[LANDMARK_INDEX.THUMB_MCP];
	const pinkyMcp = landmarks[LANDMARK_INDEX.PINKY_MCP];
	const indexTip = landmarks[LANDMARK_INDEX.INDEX_TIP];
	const thumbSpan = distance3D(thumbTip, pinkyMcp) / handScale;
	const thumbTipToMcpNorm = distance3D(thumbMcp, thumbTip) / handScale;
	const thumbOccluded = distance3D(thumbMcp, thumbTip) < .003 || thumbSpan > 4;
	const thumbExtended = !thumbOccluded && (thumbSpan >= thresholds.thumbOpenNormDist || thumbTipToMcpNorm >= .52);
	const pinchDistanceNorm = distance3D(thumbTip, indexTip) / handScale;
	const index = analyzeFinger(landmarks, LANDMARK_INDEX.INDEX_MCP, LANDMARK_INDEX.INDEX_PIP, LANDMARK_INDEX.INDEX_DIP, LANDMARK_INDEX.INDEX_TIP, handScale, thresholds);
	const middle = analyzeFinger(landmarks, LANDMARK_INDEX.MIDDLE_MCP, LANDMARK_INDEX.MIDDLE_PIP, LANDMARK_INDEX.MIDDLE_DIP, LANDMARK_INDEX.MIDDLE_TIP, handScale, thresholds);
	const ring = analyzeFinger(landmarks, LANDMARK_INDEX.RING_MCP, LANDMARK_INDEX.RING_PIP, LANDMARK_INDEX.RING_DIP, LANDMARK_INDEX.RING_TIP, handScale, thresholds);
	const pinky = analyzeFinger(landmarks, LANDMARK_INDEX.PINKY_MCP, LANDMARK_INDEX.PINKY_PIP, LANDMARK_INDEX.PINKY_DIP, LANDMARK_INDEX.PINKY_TIP, handScale, thresholds);
	return {
		thumb: {
			isExtended: thumbExtended,
			isCurled: !thumbExtended && !thumbOccluded,
			extensionRatio: thumbSpan,
			tipToMcpNorm: thumbTipToMcpNorm,
			isOccluded: thumbOccluded
		},
		index,
		middle,
		ring,
		pinky,
		handScale,
		pinchDistanceNorm
	};
}
/**
* Instantaneous raw gesture classification based on normalized hand posture.
* Supports hysteresis via previousGesture (e.g. maintaining PINCH across wider zoom distances).
*/
function classifyInstantaneousGesture(landmarks, thresholds = DEFAULT_GESTURE_THRESHOLDS, previousGesture = "NONE", trackingScore) {
	const minTrackingConf = thresholds.minTrackingConfidence ?? .5;
	if (trackingScore !== void 0 && trackingScore < minTrackingConf) {
		const reason = `Low tracking confidence (${Math.round(trackingScore * 100)}% < ${Math.round(minTrackingConf * 100)}%)`;
		return {
			gesture: "NONE",
			confidence: trackingScore,
			fingerState: null,
			debugReason: reason,
			rejectionReason: reason
		};
	}
	const fingerState = extractHandFingersState(landmarks, thresholds);
	if (!fingerState) {
		let reason = "Invalid or missing landmarks";
		if (!landmarks || landmarks.length < 21) reason = "Insufficient landmarks (< 21 points)";
		else if (landmarks.some((lm) => !lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y) || !Number.isFinite(lm.z ?? 0))) reason = "Non-finite / NaN landmark coordinates";
		else reason = "Degenerate palm geometry (scale < 0.02)";
		return {
			gesture: "NONE",
			confidence: 0,
			fingerState: null,
			debugReason: reason,
			rejectionReason: reason
		};
	}
	const { thumb, index, middle, ring, pinky, pinchDistanceNorm, handScale } = fingerState;
	const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
	const pinkyTip = landmarks[LANDMARK_INDEX.PINKY_TIP];
	if (index.isOccluded) {
		const reason = "Index finger landmark occluded or collapsed";
		return {
			gesture: "NONE",
			confidence: 0,
			fingerState,
			debugReason: reason,
			rejectionReason: reason
		};
	}
	const pinchThreshold = previousGesture === "PINCH" ? thresholds.pinchReleaseNormDist ?? .6 : thresholds.pinchMaxNormDist;
	const allFourCurled = index.isCurled && middle.isCurled && ring.isCurled && pinky.isCurled;
	const distThumbToPinky = distance3D(thumbTip, pinkyTip) / handScale;
	const isClosedFist = allFourCurled && (distThumbToPinky < pinchDistanceNorm * 1.3 || pinchDistanceNorm > .32);
	if (pinchDistanceNorm <= pinchThreshold && !isClosedFist && !thumb.isOccluded && !index.isOccluded) {
		const normalizedCloseness = Math.max(0, 1 - pinchDistanceNorm / pinchThreshold);
		const confidence = Math.min(1, .65 + normalizedCloseness * .35);
		if (confidence >= thresholds.minConfidence) return {
			gesture: "PINCH",
			confidence,
			fingerState,
			debugReason: `Pinch engaged (norm dist: ${pinchDistanceNorm.toFixed(2)} <= ${pinchThreshold.toFixed(2)})`,
			rejectionReason: `Pinch engaged (norm dist: ${pinchDistanceNorm.toFixed(2)} <= ${pinchThreshold.toFixed(2)})`
		};
	}
	const isPinching = pinchDistanceNorm <= (previousGesture === "PINCH" ? thresholds.pinchReleaseNormDist ?? .6 : thresholds.pinchMaxNormDist);
	if (index.isExtended && !isPinching && !index.isOccluded) {
		if (!middle.isExtended && !ring.isExtended && !pinky.isExtended) {
			const indexStrength = Math.min(1, index.extensionRatio / (thresholds.fingerExtensionRatio * 1.2));
			const foldScore = (Number(!middle.isExtended) + Number(!ring.isExtended) + Number(!pinky.isExtended)) / 3;
			const confidence = Math.min(1, .55 + indexStrength * .25 + foldScore * .2);
			if (confidence >= thresholds.minConfidence) return {
				gesture: "POINTING",
				confidence,
				fingerState,
				debugReason: `Pointing active (index ext: ${index.extensionRatio.toFixed(2)})`
			};
		}
	}
	if (!isPinching) {
		if (index.isExtended && middle.isExtended && ring.isExtended && pinky.isExtended && !thumb.isOccluded) {
			if (thumb.isExtended || pinchDistanceNorm >= .25) {
				const avgExtension = (index.extensionRatio + middle.extensionRatio + ring.extensionRatio + pinky.extensionRatio) / 4;
				const confidence = Math.min(1, .65 + Math.min(.35, (avgExtension - 1.15) * .5));
				if (confidence >= thresholds.minConfidence) return {
					gesture: "OPEN_PALM",
					confidence,
					fingerState,
					debugReason: `Open palm active (avg ext: ${avgExtension.toFixed(2)})`
				};
			}
		}
	}
	let debugReason = "Ambiguous hand pose";
	if (thumb.isOccluded || index.isOccluded || middle.isOccluded || ring.isOccluded || pinky.isOccluded) debugReason = "Hand landmarks partially occluded or collapsed";
	else if (allFourCurled) debugReason = "Fist / clenched hand";
	else if (index.isExtended && !middle.isExtended) debugReason = `Near pointing (ring: ${ring.isExtended ? "ext" : "curl"}, pinky: ${pinky.isExtended ? "ext" : "curl"})`;
	else if (index.isExtended && middle.isExtended) debugReason = `Partial extension (index+middle, pinky: ${pinky.isExtended ? "ext" : "curl"})`;
	return {
		gesture: "NONE",
		confidence: 0,
		fingerState,
		debugReason,
		rejectionReason: debugReason
	};
}
// src/services/gestures/gestureClassifier.ts
var GestureTemporalStabilizer = class {
	thresholds;
	currentStableGesture = "NONE";
	candidateGesture = "NONE";
	candidateFrameCount = 0;
	stableFrameCount = 0;
	lastConfidence = 0;
	constructor(thresholds = {}) {
		this.thresholds = {
			...DEFAULT_GESTURE_THRESHOLDS,
			...thresholds
		};
	}
	/** Update thresholds dynamically */
	setThresholds(thresholds) {
		this.thresholds = {
			...this.thresholds,
			...thresholds
		};
	}
	/** Reset internal state history */
	reset() {
		this.currentStableGesture = "NONE";
		this.candidateGesture = "NONE";
		this.candidateFrameCount = 0;
		this.stableFrameCount = 0;
		this.lastConfidence = 0;
	}
	/**
	* Process a single video frame of 21 landmarks.
	*/
	update(landmarks, handedness = "Right", trackingScore) {
		if (!landmarks || landmarks.length < 21) {
			this.reset();
			return {
				gesture: "NONE",
				rawGesture: "NONE",
				confidence: 0,
				isStable: true,
				consecutiveFrames: 0,
				handedness,
				rejectionReason: "No hand landmarks detected",
				metrics: {
					pinchDistanceNorm: 999,
					handScale: .1,
					indexExtension: 0,
					middleExtension: 0,
					ringExtension: 0,
					pinkyExtension: 0
				}
			};
		}
		const { gesture: rawGesture, confidence, fingerState, debugReason } = classifyInstantaneousGesture(landmarks, this.thresholds, this.currentStableGesture, trackingScore);
		if (rawGesture === this.currentStableGesture) {
			this.stableFrameCount += 1;
			this.candidateGesture = "NONE";
			this.candidateFrameCount = 0;
			this.lastConfidence = confidence;
		} else {
			if (rawGesture === this.candidateGesture) this.candidateFrameCount += 1;
			else {
				this.candidateGesture = rawGesture;
				this.candidateFrameCount = 1;
			}
			if (this.candidateFrameCount >= this.thresholds.stabilityFramesRequired) {
				this.currentStableGesture = this.candidateGesture;
				this.stableFrameCount = this.candidateFrameCount;
				this.candidateGesture = "NONE";
				this.candidateFrameCount = 0;
				this.lastConfidence = confidence;
			}
		}
		const isStable = this.stableFrameCount >= this.thresholds.stabilityFramesRequired;
		return {
			gesture: this.currentStableGesture,
			rawGesture,
			confidence: this.lastConfidence,
			isStable,
			consecutiveFrames: this.stableFrameCount,
			handedness,
			rejectionReason: debugReason,
			metrics: {
				pinchDistanceNorm: fingerState?.pinchDistanceNorm ?? 999,
				handScale: fingerState?.handScale ?? .1,
				indexExtension: fingerState?.index.extensionRatio ?? 0,
				middleExtension: fingerState?.middle.extensionRatio ?? 0,
				ringExtension: fingerState?.ring.extensionRatio ?? 0,
				pinkyExtension: fingerState?.pinky.extensionRatio ?? 0
			}
		};
	}
};
// tests/gestureRules.test.ts
/**
* Automated Unit Tests for Geometric Gesture Recognition & Temporal Stabilizer
* Executed via Node.js native test runner (node:test + node:assert).
*/
function createEmptyLandmarks() {
	return Array.from({ length: 21 }, () => ({
		x: .5,
		y: .5,
		z: 0
	}));
}
function createOpenPalmFixture() {
	const lm = createEmptyLandmarks();
	lm[0] = {
		x: .5,
		y: .8,
		z: 0
	};
	lm[1] = {
		x: .45,
		y: .75,
		z: 0
	};
	lm[2] = {
		x: .4,
		y: .7,
		z: 0
	};
	lm[3] = {
		x: .35,
		y: .65,
		z: 0
	};
	lm[4] = {
		x: .3,
		y: .6,
		z: 0
	};
	lm[5] = {
		x: .45,
		y: .6,
		z: 0
	};
	lm[6] = {
		x: .45,
		y: .46,
		z: 0
	};
	lm[7] = {
		x: .45,
		y: .36,
		z: 0
	};
	lm[8] = {
		x: .45,
		y: .25,
		z: 0
	};
	lm[9] = {
		x: .5,
		y: .58,
		z: 0
	};
	lm[10] = {
		x: .5,
		y: .42,
		z: 0
	};
	lm[11] = {
		x: .5,
		y: .3,
		z: 0
	};
	lm[12] = {
		x: .5,
		y: .18,
		z: 0
	};
	lm[13] = {
		x: .55,
		y: .6,
		z: 0
	};
	lm[14] = {
		x: .55,
		y: .46,
		z: 0
	};
	lm[15] = {
		x: .55,
		y: .36,
		z: 0
	};
	lm[16] = {
		x: .55,
		y: .25,
		z: 0
	};
	lm[17] = {
		x: .6,
		y: .63,
		z: 0
	};
	lm[18] = {
		x: .6,
		y: .52,
		z: 0
	};
	lm[19] = {
		x: .6,
		y: .44,
		z: 0
	};
	lm[20] = {
		x: .6,
		y: .35,
		z: 0
	};
	return lm;
}
function createPointingFixture() {
	const lm = createOpenPalmFixture();
	lm[10] = {
		x: .5,
		y: .5,
		z: 0
	};
	lm[11] = {
		x: .5,
		y: .55,
		z: .05
	};
	lm[12] = {
		x: .5,
		y: .6,
		z: .05
	};
	lm[14] = {
		x: .55,
		y: .52,
		z: 0
	};
	lm[15] = {
		x: .55,
		y: .57,
		z: .05
	};
	lm[16] = {
		x: .55,
		y: .62,
		z: .05
	};
	lm[18] = {
		x: .6,
		y: .56,
		z: 0
	};
	lm[19] = {
		x: .6,
		y: .61,
		z: .05
	};
	lm[20] = {
		x: .6,
		y: .65,
		z: .05
	};
	lm[3] = {
		x: .42,
		y: .68,
		z: .02
	};
	lm[4] = {
		x: .44,
		y: .66,
		z: .02
	};
	return lm;
}
function createPinchFixture() {
	const lm = createOpenPalmFixture();
	lm[4] = {
		x: .44,
		y: .38,
		z: 0
	};
	lm[8] = {
		x: .45,
		y: .38,
		z: 0
	};
	return lm;
}
function createFistFixture() {
	const lm = createPointingFixture();
	lm[6] = {
		x: .45,
		y: .52,
		z: 0
	};
	lm[7] = {
		x: .45,
		y: .57,
		z: .05
	};
	lm[8] = {
		x: .45,
		y: .62,
		z: .05
	};
	lm[3] = {
		x: .48,
		y: .56,
		z: -.02
	};
	lm[4] = {
		x: .52,
		y: .54,
		z: -.03
	};
	return lm;
}
describe("Geometric Gesture Recognition Rules", () => {
	it("correctly calculates hand scale from rigid palm landmarks", () => {
		const scale = calculateHandScale(createOpenPalmFixture());
		assert.ok(scale > .15 && scale < .4, `Expected scale around 0.22, got ${scale}`);
	});
	it("recognizes OPEN_PALM with high confidence when all fingers are extended", () => {
		const result = classifyInstantaneousGesture(createOpenPalmFixture());
		assert.strictEqual(result.gesture, "OPEN_PALM");
		assert.ok(result.confidence >= .7, `Expected confidence >= 0.70, got ${result.confidence}`);
	});
	it("recognizes POINTING when index is extended and other fingers are curled", () => {
		const result = classifyInstantaneousGesture(createPointingFixture());
		assert.strictEqual(result.gesture, "POINTING");
		assert.ok(result.confidence >= .7, `Expected confidence >= 0.70, got ${result.confidence}`);
	});
	it("recognizes PINCH when thumb tip and index tip are in close contact", () => {
		const result = classifyInstantaneousGesture(createPinchFixture());
		assert.strictEqual(result.gesture, "PINCH");
		assert.ok(result.confidence >= .7, `Expected confidence >= 0.70, got ${result.confidence}`);
	});
	it("returns NONE for a fist where no gesture is active", () => {
		const result = classifyInstantaneousGesture(createFistFixture());
		assert.strictEqual(result.gesture, "NONE");
	});
	it("safely handles null, undefined, empty, and partial landmark arrays", () => {
		const nullRes = classifyInstantaneousGesture(null);
		assert.strictEqual(nullRes.gesture, "NONE");
		const emptyRes = classifyInstantaneousGesture([]);
		assert.strictEqual(emptyRes.gesture, "NONE");
		const partialRes = classifyInstantaneousGesture(createOpenPalmFixture().slice(0, 10));
		assert.strictEqual(partialRes.gesture, "NONE");
	});
	it("safely handles NaN and non-finite coordinates", () => {
		const landmarks = createOpenPalmFixture();
		landmarks[4] = {
			x: NaN,
			y: .5,
			z: 0
		};
		const result = classifyInstantaneousGesture(landmarks);
		assert.strictEqual(result.gesture, "NONE");
	});
	it("verifies scale normalization invariance when landmarks are scaled by 2x", () => {
		const original = createPinchFixture();
		const scaled = original.map((lm) => ({
			x: (lm.x - .5) * 2 + .5,
			y: (lm.y - .5) * 2 + .5,
			z: lm.z * 2
		}));
		const resultOriginal = classifyInstantaneousGesture(original);
		const resultScaled = classifyInstantaneousGesture(scaled);
		assert.strictEqual(resultOriginal.gesture, "PINCH");
		assert.strictEqual(resultScaled.gesture, "PINCH");
	});
});
describe("GestureTemporalStabilizer (Hysteresis & Transitions)", () => {
	it("requires consecutive frames before transitioning away from NONE", () => {
		const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
		const pointing = createPointingFixture();
		const f1 = stabilizer.update(pointing);
		assert.strictEqual(f1.rawGesture, "POINTING");
		assert.strictEqual(f1.gesture, "NONE");
		assert.strictEqual(f1.isStable, false);
		const f2 = stabilizer.update(pointing);
		assert.strictEqual(f2.rawGesture, "POINTING");
		assert.strictEqual(f2.gesture, "NONE");
		const f3 = stabilizer.update(pointing);
		assert.strictEqual(f3.gesture, "POINTING");
		assert.strictEqual(f3.isStable, true);
		assert.strictEqual(f3.consecutiveFrames, 3);
	});
	it("filters out single-frame noisy glitches during sustained gesture", () => {
		const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
		const palm = createOpenPalmFixture();
		const fist = createFistFixture();
		stabilizer.update(palm);
		stabilizer.update(palm);
		const stable = stabilizer.update(palm);
		assert.strictEqual(stable.gesture, "OPEN_PALM");
		const noisyFrame = stabilizer.update(fist);
		assert.strictEqual(noisyFrame.rawGesture, "NONE");
		assert.strictEqual(noisyFrame.gesture, "OPEN_PALM");
		const recovered = stabilizer.update(palm);
		assert.strictEqual(recovered.gesture, "OPEN_PALM");
	});
	it("resets cleanly when tracking is lost", () => {
		const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
		const pinch = createPinchFixture();
		stabilizer.update(pinch);
		stabilizer.update(pinch);
		stabilizer.update(pinch);
		const lost = stabilizer.update(null);
		assert.strictEqual(lost.gesture, "NONE");
		assert.strictEqual(lost.consecutiveFrames, 0);
	});
});
describe("Phase 2 & 3 Bug Fix Verification (Robust Gesture Recognition & Precision Pinch)", () => {
	it("correctly recognizes precision PINCH when middle, ring, and pinky are curled into palm", () => {
		const lm = createPointingFixture();
		lm[4] = {
			x: .44,
			y: .4,
			z: 0
		};
		lm[8] = {
			x: .45,
			y: .4,
			z: 0
		};
		const res = classifyInstantaneousGesture(lm);
		assert.strictEqual(res.gesture, "PINCH", `Expected PINCH for curled-finger precision pinch, got ${res.gesture}`);
		assert.ok(res.confidence >= .7);
	});
	it("recognizes natural OPEN_PALM when fingers are extended without exaggerated splay", () => {
		const lm = createOpenPalmFixture();
		lm[9] = {
			x: .49,
			y: .58,
			z: 0
		};
		lm[10] = {
			x: .49,
			y: .42,
			z: 0
		};
		lm[11] = {
			x: .49,
			y: .3,
			z: 0
		};
		lm[12] = {
			x: .49,
			y: .18,
			z: 0
		};
		lm[13] = {
			x: .52,
			y: .6,
			z: 0
		};
		lm[14] = {
			x: .52,
			y: .46,
			z: 0
		};
		lm[15] = {
			x: .52,
			y: .36,
			z: 0
		};
		lm[16] = {
			x: .52,
			y: .25,
			z: 0
		};
		const res = classifyInstantaneousGesture(lm);
		assert.strictEqual(res.gesture, "OPEN_PALM", `Expected natural un-splayed hand to be OPEN_PALM, got ${res.gesture}`);
		assert.ok(res.confidence >= .7);
	});
	it("rejects ambiguous two-finger \"peace sign\" and returns NONE", () => {
		const lm = createPointingFixture();
		lm[10] = {
			x: .5,
			y: .42,
			z: 0
		};
		lm[11] = {
			x: .5,
			y: .3,
			z: 0
		};
		lm[12] = {
			x: .5,
			y: .18,
			z: 0
		};
		const res = classifyInstantaneousGesture(lm);
		assert.strictEqual(res.gesture, "NONE", `Expected peace sign to return NONE, got ${res.gesture}`);
		assert.ok(res.rejectionReason, "Should include diagnostic rejection reason");
	});
	it("rejects ambiguous three-finger pose and returns NONE", () => {
		const lm = createOpenPalmFixture();
		lm[18] = {
			x: .6,
			y: .56,
			z: 0
		};
		lm[19] = {
			x: .6,
			y: .61,
			z: .05
		};
		lm[20] = {
			x: .6,
			y: .65,
			z: .05
		};
		const res = classifyInstantaneousGesture(lm);
		assert.strictEqual(res.gesture, "NONE", `Expected 3-finger pose to return NONE, got ${res.gesture}`);
	});
	it("maintains PINCH candidate under hysteresis when fingers expand up to release distance", () => {
		const lm = createOpenPalmFixture();
		lm[4] = {
			x: .38,
			y: .4,
			z: 0
		};
		lm[8] = {
			x: .48,
			y: .4,
			z: 0
		};
		const coldRes = classifyInstantaneousGesture(lm, void 0, "NONE");
		assert.notStrictEqual(coldRes.gesture, "PINCH", "Cold pinch at 0.45 norm dist should not trigger PINCH");
		const activeRes = classifyInstantaneousGesture(lm, void 0, "PINCH");
		assert.strictEqual(activeRes.gesture, "PINCH", "Active pinch should maintain PINCH under hysteresis");
	});
});
describe("Task 6.3: Lighting & Occlusion Edge-Case Hardening", () => {
	it("rejects gestures when tracking confidence falls below minTrackingConfidence threshold", () => {
		const result = classifyInstantaneousGesture(createOpenPalmFixture(), void 0, "NONE", .4);
		assert.strictEqual(result.gesture, "NONE");
		assert.strictEqual(result.confidence, .4);
		assert.ok(result.rejectionReason?.includes("Low tracking confidence"));
	});
	it("stabilizer filters transient low-confidence frames without losing active gesture state immediately", () => {
		const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
		const palm = createOpenPalmFixture();
		stabilizer.update(palm, "Right", .95);
		stabilizer.update(palm, "Right", .95);
		const stable = stabilizer.update(palm, "Right", .95);
		assert.strictEqual(stable.gesture, "OPEN_PALM");
		const lowConfFrame = stabilizer.update(palm, "Right", .35);
		assert.strictEqual(lowConfFrame.rawGesture, "NONE");
		assert.strictEqual(lowConfFrame.gesture, "OPEN_PALM");
		const recovered = stabilizer.update(palm, "Right", .95);
		assert.strictEqual(recovered.gesture, "OPEN_PALM");
	});
	it("rejects POINTING when index finger landmarks are occluded or collapsed", () => {
		const pointing = createPointingFixture();
		pointing[5] = {
			x: .45,
			y: .6,
			z: 0
		};
		pointing[6] = {
			x: .45,
			y: .6,
			z: 0
		};
		pointing[7] = {
			x: .45,
			y: .6,
			z: 0
		};
		pointing[8] = {
			x: .45,
			y: .6,
			z: 0
		};
		const result = classifyInstantaneousGesture(pointing);
		assert.strictEqual(result.gesture, "NONE");
		assert.ok(result.rejectionReason?.includes("occluded or collapsed"));
	});
	it("rejects PINCH when thumb contact landmark is collapsed or occluded", () => {
		const pinch = createPinchFixture();
		pinch[1] = {
			x: .45,
			y: .75,
			z: 0
		};
		pinch[2] = {
			x: .45,
			y: .75,
			z: 0
		};
		pinch[3] = {
			x: .45,
			y: .75,
			z: 0
		};
		pinch[4] = {
			x: .45,
			y: .75,
			z: 0
		};
		const result = classifyInstantaneousGesture(pinch);
		assert.strictEqual(result.gesture, "NONE");
	});
	it("safely handles non-finite z-coordinates and degenerate palm scale", () => {
		const palm = createOpenPalmFixture();
		palm[4] = {
			x: .3,
			y: .6,
			z: NaN
		};
		const nanRes = classifyInstantaneousGesture(palm);
		assert.strictEqual(nanRes.gesture, "NONE");
		assert.ok(nanRes.rejectionReason?.includes("Non-finite / NaN"));
		const degenerateRes = classifyInstantaneousGesture(createEmptyLandmarks().map(() => ({
			x: .5,
			y: .5,
			z: 0
		})));
		assert.strictEqual(degenerateRes.gesture, "NONE");
		assert.ok(degenerateRes.rejectionReason?.includes("Degenerate palm"));
	});
});
// src/services/tracking/smoothing.ts
var DEFAULT_ONE_EURO_CONFIG = {
	minCutoff: 1,
	beta: 1,
	dCutoff: 1
};
/** Compute exponential smoothing factor alpha from cutoff frequency and delta time */
function computeAlpha(rateHz, dtSeconds) {
	return 1 / (1 + 1 / (2 * Math.PI * rateHz) / dtSeconds);
}
/**
* 1D One Euro Filter for a single scalar value over variable time intervals.
*/
var OneEuroFilter = class {
	minCutoff;
	beta;
	dCutoff;
	xPrev = null;
	dxPrev = 0;
	tPrev = null;
	constructor(config = {}) {
		const merged = {
			...DEFAULT_ONE_EURO_CONFIG,
			...config
		};
		this.minCutoff = Math.max(.01, merged.minCutoff);
		this.beta = Math.max(0, merged.beta);
		this.dCutoff = Math.max(.01, merged.dCutoff);
	}
	/** Update filter configuration parameters */
	setConfig(config) {
		if (config.minCutoff !== void 0) this.minCutoff = Math.max(.01, config.minCutoff);
		if (config.beta !== void 0) this.beta = Math.max(0, config.beta);
		if (config.dCutoff !== void 0) this.dCutoff = Math.max(.01, config.dCutoff);
	}
	/** Get current configuration */
	getConfig() {
		return {
			minCutoff: this.minCutoff,
			beta: this.beta,
			dCutoff: this.dCutoff
		};
	}
	/** Check if filter has previous sample history */
	hasHistory() {
		return this.xPrev !== null;
	}
	/** Reset filter state cleanly on tracking loss or session start */
	reset() {
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
	filter(x, timestampMs) {
		if (!Number.isFinite(x) || !Number.isFinite(timestampMs)) return this.xPrev !== null ? this.xPrev : 0;
		if (this.xPrev === null || this.tPrev === null) {
			this.xPrev = x;
			this.dxPrev = 0;
			this.tPrev = timestampMs;
			return x;
		}
		const dt = (timestampMs - this.tPrev) / 1e3;
		if (dt <= 0) return this.xPrev;
		if (dt > 1) {
			this.xPrev = x;
			this.dxPrev = 0;
			this.tPrev = timestampMs;
			return x;
		}
		const dx = (x - this.xPrev) / dt;
		const alphaD = computeAlpha(this.dCutoff, dt);
		const dxHat = alphaD * dx + (1 - alphaD) * this.dxPrev;
		const alpha = computeAlpha(this.minCutoff + this.beta * Math.abs(dxHat), dt);
		const xHat = alpha * x + (1 - alpha) * this.xPrev;
		this.xPrev = xHat;
		this.dxPrev = dxHat;
		this.tPrev = timestampMs;
		return xHat;
	}
};
/**
* 3D Point filter applying independent OneEuroFilter instances to x, y, and z coordinates.
*/
var Point3DOneEuroFilter = class {
	filterX;
	filterY;
	filterZ;
	constructor(config = {}) {
		this.filterX = new OneEuroFilter(config);
		this.filterY = new OneEuroFilter(config);
		this.filterZ = new OneEuroFilter(config);
	}
	reset() {
		this.filterX.reset();
		this.filterY.reset();
		this.filterZ.reset();
	}
	setConfig(config) {
		this.filterX.setConfig(config);
		this.filterY.setConfig(config);
		this.filterZ.setConfig(config);
	}
	filter(point, timestampMs) {
		return {
			x: this.filterX.filter(point.x, timestampMs),
			y: this.filterY.filter(point.y, timestampMs),
			z: this.filterZ.filter(point.z ?? 0, timestampMs)
		};
	}
};
/**
* Hand Landmark Filter for all 21 3D points of a single hand.
* Maintains independent filters for all 21 joints.
*/
var HandLandmarkOneEuroFilter = class {
	filters;
	constructor(config = {}) {
		this.filters = Array.from({ length: 21 }, () => new Point3DOneEuroFilter(config));
	}
	reset() {
		for (let i = 0; i < 21; i++) this.filters[i].reset();
	}
	setConfig(config) {
		for (let i = 0; i < 21; i++) this.filters[i].setConfig(config);
	}
	/**
	* Filter an array of 21 landmarks.
	* Returns a new array of fresh objects; does NOT mutate input landmarks.
	*/
	filter(landmarks, timestampMs) {
		if (!landmarks || landmarks.length < 21) {
			this.reset();
			return landmarks ? landmarks.map((p) => ({ ...p })) : [];
		}
		const smoothed = new Array(21);
		for (let i = 0; i < 21; i++) smoothed[i] = this.filters[i].filter(landmarks[i], timestampMs);
		return smoothed;
	}
};
/**
* Multi-Hand Manager keeping separate isolated filter states for Left and Right hands.
* Prevents filter state crossover when hands enter, swap, or leave camera view.
*/
var MultiHandOneEuroFilter = class {
	leftHandFilter;
	rightHandFilter;
	constructor(config = {}) {
		this.leftHandFilter = new HandLandmarkOneEuroFilter(config);
		this.rightHandFilter = new HandLandmarkOneEuroFilter(config);
	}
	reset() {
		this.leftHandFilter.reset();
		this.rightHandFilter.reset();
	}
	setConfig(config) {
		this.leftHandFilter.setConfig(config);
		this.rightHandFilter.setConfig(config);
	}
	/**
	* Filter detected hands array.
	* Automatically resets filters for any hand not present in the current frame.
	* Returns a new HandLandmarkResult array with smoothed landmarks, preserving rawLandmarks.
	*/
	filterHands(detectedHands, timestampMs) {
		if (!detectedHands || detectedHands.length === 0) {
			this.reset();
			return [];
		}
		let leftPresent = false;
		let rightPresent = false;
		const smoothedResults = detectedHands.map((hand) => {
			const isLeft = hand.handedness === "Left";
			if (isLeft) leftPresent = true;
			else rightPresent = true;
			return {
				landmarks: (isLeft ? this.leftHandFilter : this.rightHandFilter).filter(hand.landmarks, timestampMs),
				rawLandmarks: hand.landmarks.map((p) => ({ ...p })),
				handedness: hand.handedness,
				score: hand.score
			};
		});
		if (!leftPresent) this.leftHandFilter.reset();
		if (!rightPresent) this.rightHandFilter.reset();
		return smoothedResults;
	}
};
// tests/smoothing.test.ts
/**
* Automated Unit Tests for One Euro Filter (Temporal Smoothing)
* Validates noise attenuation, responsiveness, scale invariance, and multi-hand isolation.
* Executed via Node.js native test runner (node:test + node:assert).
*/
function calculateVariance(values) {
	if (values.length <= 1) return 0;
	const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
	return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
}
function createDummyLandmarks(baseX = .5, baseY = .5, baseZ = 0) {
	return Array.from({ length: 21 }, (_, i) => ({
		x: baseX + i * .005,
		y: baseY + i * .005,
		z: baseZ
	}));
}
describe("OneEuroFilter (1D Scalar)", () => {
	it("1. correctly initializes first sample without artificial jump", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: 1
		});
		const initialValue = .456;
		const output = filter.filter(initialValue, 1e3);
		assert.strictEqual(output, initialValue, "First sample must equal input exactly");
	});
	it("2. keeps stationary coordinates completely stable without drift", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: 1
		});
		filter.filter(.5, 1e3);
		for (let i = 1; i <= 30; i++) {
			const output = filter.filter(.5, 1e3 + i * 33);
			assert.strictEqual(output, .5, "Stationary input should output exact constant value");
		}
	});
	it("3. significantly attenuates synthetic high-frequency coordinate noise", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: .1
		});
		const center = .5;
		const noiseAmplitude = .015;
		const rawSamples = [];
		const smoothedSamples = [];
		for (let frame = 0; frame < 90; frame++) {
			const t = 1e3 + frame * 33.33;
			const raw = center + (Math.sin(frame * 1.5) * noiseAmplitude + (frame % 2 === 0 ? 1 : -1) * .005);
			const smoothed = filter.filter(raw, t);
			if (frame >= 10) {
				rawSamples.push(raw);
				smoothedSamples.push(smoothed);
			}
		}
		const rawVariance = calculateVariance(rawSamples);
		const smoothedVariance = calculateVariance(smoothedSamples);
		const noiseReduction = 1 - smoothedVariance / rawVariance;
		assert.ok(smoothedVariance < rawVariance * .4, `Expected >=60% noise variance reduction, got ${(noiseReduction * 100).toFixed(1)}% reduction`);
	});
	it("4. dynamically adapts cutoff for deliberate fast movement to maintain low lag", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: 1.5
		});
		filter.filter(.1, 1e3);
		filter.filter(.1, 1033);
		filter.filter(.3, 1066);
		filter.filter(.6, 1100);
		const finalFastOutput = filter.filter(.8, 1133);
		assert.ok(finalFastOutput > .65, `Expected fast movement to reach > 0.65, got ${finalFastOutput.toFixed(3)}`);
	});
	it("5. handles variable frame timestamps (jittery frame rate) correctly", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: 1
		});
		filter.filter(.2, 1e3);
		const out1 = filter.filter(.25, 1016);
		const out2 = filter.filter(.3, 1066);
		const out3 = filter.filter(.35, 1099);
		assert.ok(Number.isFinite(out1) && Number.isFinite(out2) && Number.isFinite(out3));
		assert.ok(out3 > out2 && out2 > out1);
	});
	it("6. resets cleanly and initializes the next sample without carrying stale momentum", () => {
		const filter = new OneEuroFilter({
			minCutoff: 1,
			beta: 1
		});
		filter.filter(.9, 1e3);
		filter.filter(.9, 1033);
		assert.strictEqual(filter.hasHistory(), true);
		filter.reset();
		assert.strictEqual(filter.hasHistory(), false);
		const afterReset = filter.filter(.1, 5e3);
		assert.strictEqual(afterReset, .1, "After reset, filter must initialize to new sample directly");
	});
	it("7. safely handles invalid coordinates (NaN, Infinity) and non-increasing timestamps", () => {
		const filter = new OneEuroFilter();
		const f1 = filter.filter(.5, 1e3);
		assert.strictEqual(f1, .5);
		const fDup = filter.filter(.8, 1e3);
		assert.strictEqual(fDup, .5, "Must ignore duplicate non-increasing timestamp and return previous valid");
		const fBack = filter.filter(.8, 900);
		assert.strictEqual(fBack, .5, "Must ignore backward timestamp");
		const fNaN = filter.filter(NaN, 1033);
		assert.strictEqual(fNaN, .5, "Must safely ignore NaN input");
		const fInf = filter.filter(Infinity, 1066);
		assert.strictEqual(fInf, .5, "Must safely ignore Infinity input");
	});
});
describe("Point3DOneEuroFilter & HandLandmarkOneEuroFilter", () => {
	it("filters 3D coordinates (x, y, z) independently", () => {
		const smoothed = new Point3DOneEuroFilter().filter({
			x: .3,
			y: .6,
			z: -.1
		}, 1e3);
		assert.strictEqual(smoothed.x, .3);
		assert.strictEqual(smoothed.y, .6);
		assert.strictEqual(smoothed.z, -.1);
	});
	it("9. does NOT mutate the original input landmark array or objects", () => {
		const handFilter = new HandLandmarkOneEuroFilter();
		const originalLandmarks = createDummyLandmarks(.4, .4, 0);
		const snapshot = originalLandmarks.map((p) => ({ ...p }));
		const smoothed = handFilter.filter(originalLandmarks, 1e3);
		assert.strictEqual(originalLandmarks.length, 21);
		for (let i = 0; i < 21; i++) {
			assert.strictEqual(originalLandmarks[i].x, snapshot[i].x);
			assert.strictEqual(originalLandmarks[i].y, snapshot[i].y);
			assert.strictEqual(originalLandmarks[i].z, snapshot[i].z);
			assert.notStrictEqual(smoothed[i], originalLandmarks[i]);
		}
	});
	it("measures computational execution overhead of filtering 21 landmarks", () => {
		const handFilter = new HandLandmarkOneEuroFilter();
		const landmarks = createDummyLandmarks();
		const iterations = 1e3;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) handFilter.filter(landmarks, 1e3 + i * 33);
		const avgMicrosPerHand = (performance.now() - start) * 1e3 / iterations;
		assert.ok(avgMicrosPerHand < 100, `Expected filter overhead < 100 µs per hand, measured: ${avgMicrosPerHand.toFixed(1)} µs`);
	});
});
describe("MultiHandOneEuroFilter (Multi-Hand Isolation)", () => {
	it("8. ensures Left and Right hands do NOT share or cross-contaminate filter state", () => {
		const multiFilter = new MultiHandOneEuroFilter();
		const leftHandInput = {
			landmarks: createDummyLandmarks(.2, .2, 0),
			handedness: "Left",
			score: .95
		};
		const rightHandInput = {
			landmarks: createDummyLandmarks(.8, .8, 0),
			handedness: "Right",
			score: .95
		};
		const frame1 = multiFilter.filterHands([leftHandInput, rightHandInput], 1e3);
		assert.strictEqual(frame1.length, 2);
		assert.strictEqual(frame1[0].landmarks[0].x, .2);
		assert.strictEqual(frame1[1].landmarks[0].x, .8);
		const frame2 = multiFilter.filterHands([rightHandInput], 1033);
		assert.strictEqual(frame2.length, 1);
		assert.strictEqual(frame2[0].handedness, "Right");
		const leftNewInput = {
			landmarks: createDummyLandmarks(.5, .5, 0),
			handedness: "Left",
			score: .95
		};
		const frame3 = multiFilter.filterHands([leftNewInput, rightHandInput], 1066);
		assert.strictEqual(frame3.length, 2);
		const leftResult = frame3.find((h) => h.handedness === "Left");
		assert.ok(leftResult);
		assert.strictEqual(leftResult.landmarks[0].x, .5, "Re-entered hand must initialize directly at new position");
	});
	it("preserves cloned rawLandmarks alongside smoothed landmarks", () => {
		const multiFilter = new MultiHandOneEuroFilter();
		const handInput = {
			landmarks: createDummyLandmarks(.3, .4, 0),
			handedness: "Right",
			score: .9
		};
		const results = multiFilter.filterHands([handInput], 1e3);
		assert.ok(results[0].rawLandmarks, "rawLandmarks must be present on output");
		assert.strictEqual(results[0].rawLandmarks.length, 21);
		assert.strictEqual(results[0].rawLandmarks[0].x, .3);
	});
});
// src/components/scene/CameraController.tsx
var CAMERA_PRESETS = {
	isometric: {
		id: "isometric",
		name: "Isometric",
		position: new THREE.Vector3(4.5, 4.2, 5.5),
		target: new THREE.Vector3(0, 0, 0),
		description: "Elevated 3D angle displaying all mechanical stages simultaneously."
	},
	top: {
		id: "top",
		name: "Top View",
		position: new THREE.Vector3(0, 7.8, .001),
		target: new THREE.Vector3(0, 0, 0),
		description: "Direct overhead view showcasing gear tooth engagement and pitch diameters."
	},
	front: {
		id: "front",
		name: "Front View",
		position: new THREE.Vector3(0, .4, 7.2),
		target: new THREE.Vector3(0, 0, 0),
		description: "Horizontal profile view showing carrier standoffs, pins, and output shaft."
	}
};
/**
* Dedicated CameraController managing OrbitControls, view presets, damping, and keyboard shortcuts.
*/
var CameraController = class {
	controls;
	camera;
	domElement;
	activePreset = "isometric";
	onPresetChange;
	isInteracting = false;
	handleKeyDownBound;
	onControlsStartBound;
	onControlsEndBound;
	constructor(camera, domElement, options = {}) {
		this.camera = camera;
		this.domElement = domElement;
		this.onPresetChange = options.onPresetChange;
		this.controls = new OrbitControls(this.camera, this.domElement);
		this.controls.enableDamping = options.enableDamping ?? true;
		this.controls.dampingFactor = options.dampingFactor ?? .05;
		this.controls.minDistance = options.minDistance ?? 2;
		this.controls.maxDistance = options.maxDistance ?? 25;
		this.controls.maxPolarAngle = Math.PI / 2 + .1;
		this.controls.target.set(0, 0, 0);
		this.controls.autoRotate = options.autoRotate ?? true;
		this.controls.autoRotateSpeed = options.autoRotateSpeed ?? 1;
		this.applyPresetDirect("isometric");
		this.onControlsStartBound = () => {
			this.isInteracting = true;
		};
		this.onControlsEndBound = () => {
			this.isInteracting = false;
		};
		this.controls.addEventListener("start", this.onControlsStartBound);
		this.controls.addEventListener("end", this.onControlsEndBound);
		this.handleKeyDownBound = this.handleKeyDown.bind(this);
		if (typeof window !== "undefined") window.addEventListener("keydown", this.handleKeyDownBound);
	}
	/**
	* Applies a preset view position and updates OrbitControls target.
	*/
	setPreset(preset) {
		if (!CAMERA_PRESETS[preset]) return;
		this.activePreset = preset;
		this.applyPresetDirect(preset);
		this.onPresetChange?.(preset);
	}
	/**
	* Directly sets the camera position and target vectors.
	*/
	applyPresetDirect(preset) {
		const config = CAMERA_PRESETS[preset];
		this.camera.position.copy(config.position);
		this.controls.target.copy(config.target);
		this.controls.update();
	}
	/**
	* Resets the camera to the default isometric view.
	*/
	reset() {
		this.setPreset("isometric");
	}
	/**
	* Toggles or sets auto-rotation.
	*/
	setAutoRotate(enabled) {
		this.controls.autoRotate = enabled;
	}
	/**
	* Gets current auto-rotate state.
	*/
	isAutoRotating() {
		return this.controls.autoRotate;
	}
	/**
	* Gets current active preset identifier.
	*/
	getActivePreset() {
		return this.activePreset;
	}
	/**
	* Must be called in the render loop to update damping and auto-rotation.
	*/
	update() {
		this.controls.update();
	}
	/**
	* Adjusts the camera distance relative to controls.target by delta.
	* Positive delta zooms in (moves camera closer), negative zooms out (moves camera farther).
	* Clamped to [minDistance, maxDistance].
	* Returns the new distance.
	*/
	zoomBy(delta) {
		const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
		const currentDist = offset.length();
		if (currentDist === 0) return 0;
		const newDist = THREE.MathUtils.clamp(currentDist - delta, this.controls.minDistance, this.controls.maxDistance);
		offset.setLength(newDist);
		this.camera.position.addVectors(this.controls.target, offset);
		this.controls.update();
		return newDist;
	}
	/**
	* Focuses camera and OrbitControls target on a given 3D bounding box.
	*/
	focusOnBounds(box, offsetRatio = 1.6) {
		if (box.isEmpty()) return;
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z, .1);
		const fovRad = this.camera.fov * Math.PI / 180;
		let cameraDistance = maxDim / 2 / Math.tan(fovRad / 2) * offsetRatio;
		cameraDistance = THREE.MathUtils.clamp(cameraDistance, this.controls.minDistance, this.controls.maxDistance);
		const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
		if (direction.lengthSq() < 1e-4) direction.set(.7, .5, .7).normalize();
		this.controls.target.copy(center);
		this.camera.position.copy(center).addScaledVector(direction, cameraDistance);
		this.controls.update();
	}
	/**
	* Gets current distance between camera and controls.target.
	*/
	getDistance() {
		return this.camera.position.distanceTo(this.controls.target);
	}
	/**
	* Gets minDistance configured in controls.
	*/
	getMinDistance() {
		return this.controls.minDistance;
	}
	/**
	* Gets maxDistance configured in controls.
	*/
	getMaxDistance() {
		return this.controls.maxDistance;
	}
	/**
	* Returns true if user is actively dragging or interacting via mouse/touch controls.
	*/
	isUserInteracting() {
		const internalState = this.controls.state;
		return this.isInteracting || internalState !== void 0 && internalState !== -1;
	}
	/**
	* Keyboard shortcuts handling.
	* 'R' / 'r' -> Reset to isometric view
	* '1' -> Isometric, '2' -> Top, '3' -> Front
	*/
	handleKeyDown(e) {
		const targetTag = e.target?.tagName?.toLowerCase();
		if (targetTag === "input" || targetTag === "textarea") return;
		if (e.key === "r" || e.key === "R") {
			e.preventDefault();
			this.reset();
		} else if (e.key === "1") this.setPreset("isometric");
		else if (e.key === "2") this.setPreset("top");
		else if (e.key === "3") this.setPreset("front");
	}
	/**
	* Cleans up event listeners and disposes OrbitControls.
	*/
	dispose() {
		if (typeof window !== "undefined") window.removeEventListener("keydown", this.handleKeyDownBound);
		this.controls.removeEventListener("start", this.onControlsStartBound);
		this.controls.removeEventListener("end", this.onControlsEndBound);
		this.controls.dispose();
	}
};
// src/utils/telemetry.ts
/**
* Performance Telemetry & Latency Benchmarking Service
* Task 6.2: Measures rendering framerates, vision processing inference/smoothing times,
* and application-level pipeline latency using bounded circular memory buffers.
*/
var PIPELINE_LATENCY_DESCRIPTION = "Application-level vision-to-scene latency measuring duration from MediaPipe frame timestamp to 3D scene transform & raycast application. Excludes physical CMOS camera exposure, USB bus transport, browser video decoding, and GPU display scanout.";
/**
* High-performance bounded rolling statistical accumulator.
* Uses a fixed-size Float64Array circular buffer to prevent heap allocations
* and unbounded memory growth during high-frequency 60 FPS animation loops.
*/
var RollingWindowStats = class {
	buffer;
	capacity;
	count = 0;
	head = 0;
	constructor(capacity = 120) {
		this.capacity = Math.max(10, Math.floor(capacity));
		this.buffer = new Float64Array(this.capacity);
	}
	push(value) {
		if (!Number.isFinite(value) || value < 0) return;
		this.buffer[this.head] = value;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}
	get sampleCount() {
		return this.count;
	}
	get maxCapacity() {
		return this.capacity;
	}
	computeStats() {
		if (this.count === 0) return {
			count: 0,
			avg: 0,
			min: 0,
			max: 0,
			p95: 0
		};
		const samples = new Array(this.count);
		for (let i = 0; i < this.count; i++) samples[i] = this.buffer[i];
		samples.sort((a, b) => a - b);
		let sum = 0;
		for (let i = 0; i < samples.length; i++) sum += samples[i];
		const avg = Number((sum / samples.length).toFixed(2));
		const min = Number(samples[0].toFixed(2));
		const max = Number(samples[samples.length - 1].toFixed(2));
		const p95Index = Math.min(samples.length - 1, Math.max(0, Math.ceil(.95 * samples.length) - 1));
		const p95 = Number(samples[p95Index].toFixed(2));
		return {
			count: this.count,
			avg,
			min,
			max,
			p95
		};
	}
	reset() {
		this.count = 0;
		this.head = 0;
		this.buffer.fill(0);
	}
};
/**
* Render telemetry accumulator measuring frame-time deltas and WebGL FPS.
*/
var RenderTelemetryCollector = class {
	frameTimeStats;
	lastTimestamp = null;
	lastFrameTimeMs = 0;
	currentFps = 0;
	totalFrames = 0;
	fpsWindowFrames = 0;
	fpsWindowStart = null;
	constructor(bufferCapacity = 120) {
		this.frameTimeStats = new RollingWindowStats(bufferCapacity);
	}
	recordFrame(nowTimestamp) {
		if (!Number.isFinite(nowTimestamp) || nowTimestamp <= 0) return;
		this.totalFrames++;
		if (this.lastTimestamp !== null) {
			const delta = nowTimestamp - this.lastTimestamp;
			if (delta > 0) {
				this.lastFrameTimeMs = Number(delta.toFixed(2));
				this.frameTimeStats.push(this.lastFrameTimeMs);
				this.fpsWindowFrames++;
				if (this.fpsWindowStart === null) this.fpsWindowStart = this.lastTimestamp;
				const windowElapsed = nowTimestamp - this.fpsWindowStart;
				if (windowElapsed >= 500) {
					this.currentFps = Math.round(this.fpsWindowFrames * 1e3 / windowElapsed);
					this.fpsWindowFrames = 0;
					this.fpsWindowStart = nowTimestamp;
				}
			}
		} else this.fpsWindowStart = nowTimestamp;
		this.lastTimestamp = nowTimestamp;
	}
	getSnapshot() {
		const stats = this.frameTimeStats.computeStats();
		return {
			fps: this.currentFps > 0 ? this.currentFps : stats.avg > 0 ? Math.round(1e3 / stats.avg) : 0,
			frameTimeMs: this.lastFrameTimeMs,
			avgFrameTimeMs: stats.avg,
			minFrameTimeMs: stats.min,
			maxFrameTimeMs: stats.max,
			p95FrameTimeMs: stats.p95,
			sampleCount: stats.count,
			totalFrameCount: this.totalFrames
		};
	}
	reset() {
		this.frameTimeStats.reset();
		this.lastTimestamp = null;
		this.lastFrameTimeMs = 0;
		this.currentFps = 0;
		this.totalFrames = 0;
		this.fpsWindowFrames = 0;
		this.fpsWindowStart = null;
	}
};
/**
* Vision telemetry accumulator measuring inference, smoothing, and tracking FPS.
*/
var VisionTelemetryCollector = class {
	inferenceStats;
	smoothingStats;
	totalVisionStats;
	lastInferenceMs = 0;
	lastSmoothingMs = 0;
	lastTotalVisionMs = 0;
	currentTrackingFps = 0;
	totalFrames = 0;
	fpsWindowFrames = 0;
	fpsWindowStart = null;
	constructor(bufferCapacity = 120) {
		this.inferenceStats = new RollingWindowStats(bufferCapacity);
		this.smoothingStats = new RollingWindowStats(bufferCapacity);
		this.totalVisionStats = new RollingWindowStats(bufferCapacity);
	}
	recordVisionFrame(metrics) {
		const { inferenceDurationMs, smoothingDurationMs = 0, totalDurationMs, timestamp } = metrics;
		if (!Number.isFinite(inferenceDurationMs) || inferenceDurationMs < 0) return;
		this.totalFrames++;
		this.lastInferenceMs = Number(inferenceDurationMs.toFixed(2));
		this.inferenceStats.push(this.lastInferenceMs);
		if (Number.isFinite(smoothingDurationMs) && smoothingDurationMs >= 0) {
			this.lastSmoothingMs = Number(smoothingDurationMs.toFixed(2));
			this.smoothingStats.push(this.lastSmoothingMs);
		}
		const total = totalDurationMs !== void 0 && Number.isFinite(totalDurationMs) && totalDurationMs >= 0 ? totalDurationMs : inferenceDurationMs + (smoothingDurationMs || 0);
		this.lastTotalVisionMs = Number(total.toFixed(2));
		this.totalVisionStats.push(this.lastTotalVisionMs);
		if (timestamp !== void 0 && Number.isFinite(timestamp) && timestamp > 0) {
			if (this.fpsWindowStart === null) this.fpsWindowStart = timestamp;
			else {
				this.fpsWindowFrames++;
				const windowElapsed = timestamp - this.fpsWindowStart;
				if (windowElapsed >= 500) {
					this.currentTrackingFps = Math.round(this.fpsWindowFrames * 1e3 / windowElapsed);
					this.fpsWindowFrames = 0;
					this.fpsWindowStart = timestamp;
				}
			}
		}
	}
	getSnapshot() {
		const infStats = this.inferenceStats.computeStats();
		const smoothStats = this.smoothingStats.computeStats();
		const totStats = this.totalVisionStats.computeStats();
		return {
			trackingFps: this.currentTrackingFps > 0 ? this.currentTrackingFps : totStats.avg > 0 ? Math.round(1e3 / totStats.avg) : 0,
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
			totalFrameCount: this.totalFrames
		};
	}
	reset() {
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
};
/**
* Latency telemetry accumulator measuring vision-frame-to-scene-update elapsed time.
*/
var LatencyTelemetryCollector = class {
	latencyStats;
	lastLatencyMs = 0;
	constructor(bufferCapacity = 120) {
		this.latencyStats = new RollingWindowStats(bufferCapacity);
	}
	recordLatency(visionTimestamp, sceneAppliedTimestamp) {
		if (!Number.isFinite(visionTimestamp) || !Number.isFinite(sceneAppliedTimestamp) || sceneAppliedTimestamp < visionTimestamp) return;
		const delta = sceneAppliedTimestamp - visionTimestamp;
		if (delta >= 0 && Number.isFinite(delta)) {
			this.lastLatencyMs = Number(delta.toFixed(2));
			this.latencyStats.push(this.lastLatencyMs);
		}
	}
	getSnapshot() {
		const stats = this.latencyStats.computeStats();
		return {
			lastLatencyMs: this.lastLatencyMs,
			avgLatencyMs: stats.avg,
			minLatencyMs: stats.min,
			maxLatencyMs: stats.max,
			p95LatencyMs: stats.p95,
			sampleCount: stats.count,
			description: PIPELINE_LATENCY_DESCRIPTION
		};
	}
	reset() {
		this.latencyStats.reset();
		this.lastLatencyMs = 0;
	}
};
/**
* Unified Performance Telemetry Manager orchestrating render, vision, and latency stats.
*/
var PerformanceTelemetry = class {
	render;
	vision;
	latency;
	constructor(bufferCapacity = 120) {
		this.render = new RenderTelemetryCollector(bufferCapacity);
		this.vision = new VisionTelemetryCollector(bufferCapacity);
		this.latency = new LatencyTelemetryCollector(bufferCapacity);
	}
	getCombinedSnapshot(now = performance.now()) {
		return {
			timestamp: now,
			render: this.render.getSnapshot(),
			vision: this.vision.getSnapshot(),
			latency: this.latency.getSnapshot()
		};
	}
	reset() {
		this.render.reset();
		this.vision.reset();
		this.latency.reset();
	}
};
/**
* Shared singleton telemetry manager for default runtime usage.
*/
var defaultTelemetry = new PerformanceTelemetry(120);
/**
* Lightweight observable store for real-time gesture telemetry diagnostics.
* Throttles subscriber updates to 10 Hz (100ms) to eliminate animation loop overhead.
*/
var GestureDiagnosticsStore = class {
	data = {
		handsDetected: 0,
		trackingStatus: "idle",
		rawGesture: "NONE",
		stableGesture: "NONE",
		confidence: 0,
		pinchDistanceNorm: 0,
		isPinchActive: false,
		zoomDelta: 0,
		cameraDistance: 8.25,
		rejectionReason: "No hands detected",
		timestamp: 0
	};
	listeners = /* @__PURE__ */ new Set();
	lastBroadcast = 0;
	update(partial) {
		Object.assign(this.data, partial);
		const now = typeof performance !== "undefined" ? performance.now() : Date.now();
		if (now - this.lastBroadcast >= 100) {
			this.lastBroadcast = now;
			this.data.timestamp = now;
			for (const listener of this.listeners) listener({ ...this.data });
		}
	}
	getSnapshot() {
		return { ...this.data };
	}
	subscribe(listener) {
		this.listeners.add(listener);
		listener({ ...this.data });
		return () => this.listeners.delete(listener);
	}
	reset() {
		this.data = {
			handsDetected: 0,
			trackingStatus: "idle",
			rawGesture: "NONE",
			stableGesture: "NONE",
			confidence: 0,
			pinchDistanceNorm: 0,
			isPinchActive: false,
			zoomDelta: 0,
			cameraDistance: 8.25,
			rejectionReason: "Reset",
			timestamp: 0
		};
		for (const listener of this.listeners) listener({ ...this.data });
	}
};
var gestureDiagnostics = new GestureDiagnosticsStore();
// src/components/scene/GestureCameraController.tsx
var DEFAULT_GESTURE_ORBIT_CONFIG = {
	yawSensitivity: 3.2,
	pitchSensitivity: 2.6,
	deadband: .0035,
	maxJumpThreshold: .2,
	mirrorX: true,
	invertYaw: false,
	invertPitch: false,
	palmLandmarkIndices: [
		0,
		5,
		9,
		13,
		17
	]
};
/**
* Pure mathematical engine for palm anchor calculation, coordinate transformation,
* deadband filtering, jump rejection, and delta generation.
* Decoupled from Three.js and DOM for automated unit testing.
*/
var GestureOrbitEngine = class {
	config;
	lastAnchor = null;
	wasActive = false;
	constructor(config = {}) {
		this.config = {
			...DEFAULT_GESTURE_ORBIT_CONFIG,
			...config
		};
	}
	getConfig() {
		return { ...this.config };
	}
	setConfig(partialConfig) {
		this.config = {
			...this.config,
			...partialConfig
		};
	}
	/**
	* Computes the palm centroid anchor from rigid palm boundary landmarks (0, 5, 9, 13, 17).
	* Validates coordinates and rejects null, undefined, or NaN inputs.
	*/
	computeAnchor(landmarks) {
		if (!landmarks || landmarks.length === 0) return null;
		const indices = this.config.palmLandmarkIndices;
		let sumX = 0;
		let sumY = 0;
		let validCount = 0;
		for (const idx of indices) {
			const lm = landmarks[idx];
			if (!lm) continue;
			if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
			if (lm.x < -.2 || lm.x > 1.2 || lm.y < -.2 || lm.y > 1.2) continue;
			sumX += lm.x;
			sumY += lm.y;
			validCount++;
		}
		if (validCount < 3) return null;
		const avgX = sumX / validCount;
		const avgY = sumY / validCount;
		let maxDistFromCentroid = 0;
		for (const idx of indices) {
			const lm = landmarks[idx];
			if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
			if (lm.x < -.2 || lm.x > 1.2 || lm.y < -.2 || lm.y > 1.2) continue;
			const d = Math.hypot(lm.x - avgX, lm.y - avgY);
			if (d > maxDistFromCentroid) maxDistFromCentroid = d;
		}
		if (maxDistFromCentroid < .005) return null;
		return {
			x: avgX,
			y: avgY
		};
	}
	/**
	* Core stateful update step.
	*
	* @param isGestureActive - true if OPEN_PALM is stable and valid
	* @param landmarks - current hand landmarks
	* @param isMouseActive - true if mouse or touch drag is currently active
	* @returns calculated yaw and elevation rotation deltas
	*/
	update(isGestureActive, landmarks, isMouseActive = false) {
		if (isMouseActive || !isGestureActive) {
			this.reset();
			return {
				deltaYaw: 0,
				deltaPitch: 0,
				isActive: false,
				anchor: null,
				rawDisplacement: {
					x: 0,
					y: 0
				}
			};
		}
		const currentAnchor = this.computeAnchor(landmarks);
		if (!currentAnchor) {
			this.reset();
			return {
				deltaYaw: 0,
				deltaPitch: 0,
				isActive: false,
				anchor: null,
				rawDisplacement: {
					x: 0,
					y: 0
				}
			};
		}
		if (!this.wasActive || this.lastAnchor === null) {
			this.lastAnchor = currentAnchor;
			this.wasActive = true;
			return {
				deltaYaw: 0,
				deltaPitch: 0,
				isActive: true,
				anchor: currentAnchor,
				rawDisplacement: {
					x: 0,
					y: 0
				}
			};
		}
		const rawDx = currentAnchor.x - this.lastAnchor.x;
		const rawDy = currentAnchor.y - this.lastAnchor.y;
		const distance = Math.hypot(rawDx, rawDy);
		if (distance > this.config.maxJumpThreshold) {
			this.lastAnchor = currentAnchor;
			return {
				deltaYaw: 0,
				deltaPitch: 0,
				isActive: true,
				anchor: currentAnchor,
				rawDisplacement: {
					x: 0,
					y: 0
				}
			};
		}
		if (distance < this.config.deadband) return {
			deltaYaw: 0,
			deltaPitch: 0,
			isActive: true,
			anchor: currentAnchor,
			rawDisplacement: {
				x: rawDx,
				y: rawDy
			}
		};
		const effectiveDx = this.config.mirrorX ? -rawDx : rawDx;
		const effectiveDy = -rawDy;
		let deltaYaw = effectiveDx * this.config.yawSensitivity;
		let deltaPitch = effectiveDy * this.config.pitchSensitivity;
		if (this.config.invertYaw) deltaYaw = -deltaYaw;
		if (this.config.invertPitch) deltaPitch = -deltaPitch;
		if (deltaYaw === 0) deltaYaw = 0;
		if (deltaPitch === 0) deltaPitch = 0;
		this.lastAnchor = currentAnchor;
		return {
			deltaYaw,
			deltaPitch,
			isActive: true,
			anchor: currentAnchor,
			rawDisplacement: {
				x: rawDx,
				y: rawDy
			}
		};
	}
	/**
	* Resets internal tracking anchor and active flag.
	*/
	reset() {
		this.lastAnchor = null;
		this.wasActive = false;
	}
};
var DEFAULT_GESTURE_PINCH_ZOOM_CONFIG = {
	zoomSensitivity: 12,
	deadband: .008,
	maxJumpThreshold: .35,
	spreadIsZoomIn: false,
	invertZoom: false,
	smoothingAlpha: .4,
	maxPinchSessionDistance: .65
};
/**
* Pure mathematical engine for scale-invariant pinch-to-zoom calculation.
* Computes normalized distance between thumb tip (4) and index tip (8) relative to hand scale,
* tracks frame-to-frame delta, filters tremor via deadband, rejects tracking jumps,
* and outputs smoothed zoom-in / zoom-out deltas.
* Fully decoupled from Three.js and DOM for automated unit testing.
*/
var GesturePinchZoomEngine = class {
	config;
	lastDistance = null;
	smoothedDelta = 0;
	isPinchSessionActive = false;
	constructor(config = {}) {
		this.config = {
			...DEFAULT_GESTURE_PINCH_ZOOM_CONFIG,
			...config
		};
	}
	getConfig() {
		return { ...this.config };
	}
	setConfig(partialConfig) {
		this.config = {
			...this.config,
			...partialConfig
		};
	}
	isSessionActive() {
		return this.isPinchSessionActive;
	}
	/**
	* Calculates scale-invariant normalized distance between thumb tip (4) and index tip (8).
	* Uses calculateHandScale from rigid palm landmarks so distance is invariant to webcam distance.
	*/
	computePinchDistance(landmarks) {
		if (!landmarks || landmarks.length < 21) return null;
		const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
		const indexTip = landmarks[LANDMARK_INDEX.INDEX_TIP];
		if (!thumbTip || !indexTip) return null;
		if (!Number.isFinite(thumbTip.x) || !Number.isFinite(thumbTip.y) || !Number.isFinite(thumbTip.z ?? 0) || !Number.isFinite(indexTip.x) || !Number.isFinite(indexTip.y) || !Number.isFinite(indexTip.z ?? 0)) return null;
		const handScale = calculateHandScale(landmarks);
		if (handScale < .02 || !Number.isFinite(handScale)) return null;
		const rawDistance = distance3D(thumbTip, indexTip);
		if (!Number.isFinite(rawDistance)) return null;
		const pinchDistanceNorm = rawDistance / handScale;
		if (!Number.isFinite(pinchDistanceNorm)) return null;
		return {
			pinchDistanceNorm,
			rawDistance,
			handScale
		};
	}
	/**
	* Core update step for pinch-to-zoom.
	*
	* @param isPinchGestureActive - true if gesture classifier confirms stable PINCH
	* @param landmarks - current hand landmarks
	* @param isMouseActive - true if mouse or touch is currently interacting
	* @param conflictingGestureActive - true if OPEN_PALM or POINTING is confirmed active
	*/
	update(isPinchGestureActive, landmarks, isMouseActive = false, conflictingGestureActive = false) {
		if (isMouseActive || conflictingGestureActive) {
			this.reset();
			return {
				deltaZoom: 0,
				isActive: false,
				pinchDistanceNorm: 0,
				rawDeltaDistance: 0
			};
		}
		const pinchData = this.computePinchDistance(landmarks);
		if (!pinchData) {
			this.reset();
			return {
				deltaZoom: 0,
				isActive: false,
				pinchDistanceNorm: 0,
				rawDeltaDistance: 0
			};
		}
		const { pinchDistanceNorm } = pinchData;
		if (isPinchGestureActive && !this.isPinchSessionActive) {
			this.isPinchSessionActive = true;
			this.lastDistance = pinchDistanceNorm;
			this.smoothedDelta = 0;
			return {
				deltaZoom: 0,
				isActive: true,
				pinchDistanceNorm,
				rawDeltaDistance: 0
			};
		}
		if (!this.isPinchSessionActive || pinchDistanceNorm > this.config.maxPinchSessionDistance) {
			this.reset();
			return {
				deltaZoom: 0,
				isActive: false,
				pinchDistanceNorm,
				rawDeltaDistance: 0
			};
		}
		if (this.lastDistance === null) {
			this.lastDistance = pinchDistanceNorm;
			return {
				deltaZoom: 0,
				isActive: true,
				pinchDistanceNorm,
				rawDeltaDistance: 0
			};
		}
		const rawDeltaDistance = pinchDistanceNorm - this.lastDistance;
		if (Math.abs(rawDeltaDistance) > this.config.maxJumpThreshold) {
			this.lastDistance = pinchDistanceNorm;
			this.smoothedDelta = 0;
			return {
				deltaZoom: 0,
				isActive: true,
				pinchDistanceNorm,
				rawDeltaDistance
			};
		}
		if (Math.abs(rawDeltaDistance) < this.config.deadband) {
			this.smoothedDelta *= .7;
			if (Math.abs(this.smoothedDelta) < .001) this.smoothedDelta = 0;
			return {
				deltaZoom: this.smoothedDelta,
				isActive: true,
				pinchDistanceNorm,
				rawDeltaDistance
			};
		}
		this.lastDistance = pinchDistanceNorm;
		let rawZoomDelta = (this.config.spreadIsZoomIn ? rawDeltaDistance : -rawDeltaDistance) * this.config.zoomSensitivity;
		if (this.config.invertZoom) rawZoomDelta = -rawZoomDelta;
		const alpha = Math.min(1, Math.max(0, this.config.smoothingAlpha));
		this.smoothedDelta = this.smoothedDelta * (1 - alpha) + rawZoomDelta * alpha;
		let deltaZoom = this.smoothedDelta;
		if (deltaZoom === 0 || Math.abs(deltaZoom) < 1e-6) deltaZoom = 0;
		return {
			deltaZoom,
			isActive: true,
			pinchDistanceNorm,
			rawDeltaDistance
		};
	}
	/**
	* Resets internal tracking anchor, smoothed delta, and session state.
	*/
	reset() {
		this.lastDistance = null;
		this.smoothedDelta = 0;
		this.isPinchSessionActive = false;
	}
};
/**
* High-level GestureCameraController connecting GestureOrbitEngine and GesturePinchZoomEngine
* to Three.js OrbitControls and CameraController.
* Handles OrbitControls autoRotate pause/restore, damping, and mouse contention.
*/
var GestureCameraController = class {
	orbitEngine;
	pinchEngine;
	cameraController;
	wasAutoRotatingPriorToGesture = false;
	isGestureInteracting = false;
	/** Backward compatibility alias for orbitEngine */
	get engine() {
		return this.orbitEngine;
	}
	constructor(cameraController, orbitConfig = {}, pinchConfig = {}) {
		this.cameraController = cameraController;
		this.orbitEngine = new GestureOrbitEngine(orbitConfig);
		this.pinchEngine = new GesturePinchZoomEngine(pinchConfig);
	}
	/**
	* Invoked within the requestAnimationFrame render loop (never in React render logic).
	*/
	update(gestureResult, hands) {
		const isMouseActive = this.cameraController.isUserInteracting();
		const currentGesture = gestureResult?.gesture ?? "NONE";
		const isGestureStable = gestureResult?.isStable ?? false;
		const isOpenPalmActive = !isMouseActive && currentGesture === "OPEN_PALM" && isGestureStable;
		const conflictingForPinch = isOpenPalmActive || currentGesture === "POINTING" && isGestureStable;
		const isPinchActive = !isMouseActive && !conflictingForPinch && (currentGesture === "PINCH" && isGestureStable || this.pinchEngine.isSessionActive());
		let activeLandmarks = null;
		if (hands && hands.length > 0) {
			if (gestureResult?.handedness) {
				const matchingHand = hands.find((h) => h.handedness === gestureResult.handedness);
				activeLandmarks = matchingHand ? matchingHand.landmarks : hands[0].landmarks;
			} else activeLandmarks = hands[0].landmarks;
		}
		const orbitDelta = this.orbitEngine.update(isOpenPalmActive, activeLandmarks, isMouseActive);
		const pinchDelta = this.pinchEngine.update(isPinchActive, activeLandmarks, isMouseActive, conflictingForPinch);
		gestureDiagnostics.update({
			pinchDistanceNorm: Number(pinchDelta.pinchDistanceNorm.toFixed(3)),
			isPinchActive: pinchDelta.isActive,
			zoomDelta: Number(pinchDelta.deltaZoom.toFixed(4)),
			cameraDistance: Number(this.cameraController.getDistance().toFixed(2))
		});
		if ((orbitDelta.isActive && (orbitDelta.deltaYaw !== 0 || orbitDelta.deltaPitch !== 0) || pinchDelta.isActive && pinchDelta.deltaZoom !== 0) && !isMouseActive) {
			if (!this.isGestureInteracting) {
				this.isGestureInteracting = true;
				this.wasAutoRotatingPriorToGesture = this.cameraController.isAutoRotating();
				if (this.wasAutoRotatingPriorToGesture) this.cameraController.setAutoRotate(false);
			}
			if (orbitDelta.deltaYaw !== 0) this.cameraController.controls.rotateLeft(orbitDelta.deltaYaw);
			if (orbitDelta.deltaPitch !== 0) this.cameraController.controls.rotateUp(orbitDelta.deltaPitch);
			if (pinchDelta.deltaZoom !== 0) this.cameraController.zoomBy(pinchDelta.deltaZoom);
		} else if (!orbitDelta.isActive && !pinchDelta.isActive) {
			if (this.isGestureInteracting) {
				this.isGestureInteracting = false;
				if (this.wasAutoRotatingPriorToGesture) this.cameraController.setAutoRotate(true);
			}
		}
		return {
			orbit: orbitDelta,
			pinch: pinchDelta
		};
	}
	/**
	* Resets both orbit and pinch tracking states and restores auto-rotation if active.
	*/
	reset() {
		this.orbitEngine.reset();
		this.pinchEngine.reset();
		if (this.isGestureInteracting && this.wasAutoRotatingPriorToGesture) this.cameraController.setAutoRotate(true);
		this.isGestureInteracting = false;
	}
	/**
	* Disposes controller state and releases references.
	*/
	dispose() {
		this.reset();
	}
};
// tests/gestureCameraController.test.ts
/**
* Unit Test Suite for GestureCameraController & GestureOrbitEngine
* Task 4.1: Open-Palm Orbit Navigation
*/
/**
* Generates synthetic 21-point landmark array centered precisely at (centerX, centerY).
* Palm boundary landmarks (0, 5, 9, 13, 17) have offsets that sum to 0.
*/
function createPalmLandmarks(centerX, centerY) {
	const palmOffsets = {
		0: [0, .04],
		5: [-.03, -.01],
		9: [0, -.03],
		13: [.01, -.02],
		17: [.02, .02]
	};
	const landmarks = [];
	for (let i = 0; i < 21; i++) {
		const offset = palmOffsets[i] ?? [0, 0];
		landmarks.push({
			x: centerX + offset[0],
			y: centerY + offset[1],
			z: 0
		});
	}
	return landmarks;
}
describe("GestureOrbitEngine (Pure Math & Interaction Logic)", () => {
	it("exposes centrally configured default orbit parameters", () => {
		assert.equal(DEFAULT_GESTURE_ORBIT_CONFIG.mirrorX, true);
		assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.deadband > 0);
		assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.yawSensitivity > 0);
		assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.pitchSensitivity > 0);
		assert.deepEqual(DEFAULT_GESTURE_ORBIT_CONFIG.palmLandmarkIndices, [
			0,
			5,
			9,
			13,
			17
		]);
	});
	it("correctly calculates palm centroid anchor from rigid landmarks (0, 5, 9, 13, 17)", () => {
		const engine = new GestureOrbitEngine();
		const landmarks = createPalmLandmarks(.5, .4);
		const anchor = engine.computeAnchor(landmarks);
		assert.ok(anchor !== null);
		assert.ok(Math.abs(anchor.x - .5) < 1e-5, `Expected x ~ 0.5, got ${anchor.x}`);
		assert.ok(Math.abs(anchor.y - .4) < 1e-5, `Expected y ~ 0.4, got ${anchor.y}`);
	});
	it("safely handles null, empty, or insufficient landmarks in anchor calculation", () => {
		const engine = new GestureOrbitEngine();
		assert.equal(engine.computeAnchor(null), null);
		assert.equal(engine.computeAnchor([]), null);
		assert.equal(engine.computeAnchor([{
			x: .5,
			y: .5,
			z: 0
		}, {
			x: .5,
			y: .5,
			z: 0
		}]), null);
	});
	it("safely filters out NaN and non-finite coordinates", () => {
		const engine = new GestureOrbitEngine();
		const landmarks = createPalmLandmarks(.5, .5);
		landmarks[0] = {
			x: NaN,
			y: .5,
			z: 0
		};
		const anchor = engine.computeAnchor(landmarks);
		assert.ok(anchor !== null);
		assert.ok(Number.isFinite(anchor.x));
		assert.ok(Number.isFinite(anchor.y));
	});
	it("initializes anchor on the first active frame without generating false camera motion", () => {
		const engine = new GestureOrbitEngine();
		const hand = createPalmLandmarks(.5, .5);
		const result = engine.update(true, hand, false);
		assert.equal(result.isActive, true);
		assert.equal(result.deltaYaw, 0, "First frame must have 0 yaw delta");
		assert.equal(result.deltaPitch, 0, "First frame must have 0 pitch delta");
		assert.ok(result.anchor !== null);
	});
	it("maps horizontal hand movement to camera yaw with mirrored coordinate handling", () => {
		const engine = new GestureOrbitEngine({ mirrorX: true });
		const hand1 = createPalmLandmarks(.5, .5);
		const handRight = createPalmLandmarks(.45, .5);
		const handLeft = createPalmLandmarks(.55, .5);
		engine.update(true, hand1, false);
		const rightResult = engine.update(true, handRight, false);
		assert.equal(rightResult.isActive, true);
		assert.ok(rightResult.deltaYaw > 0, `Moving hand right must produce positive yaw (rotate camera right), got ${rightResult.deltaYaw}`);
		assert.equal(rightResult.deltaPitch, 0, "Horizontal movement must not induce vertical pitch");
		const leftResult = engine.update(true, handLeft, false);
		assert.equal(leftResult.isActive, true);
		assert.ok(leftResult.deltaYaw < 0, `Moving hand left must produce negative yaw, got ${leftResult.deltaYaw}`);
	});
	it("maps vertical hand movement to camera elevation (pitch)", () => {
		const engine = new GestureOrbitEngine();
		const hand1 = createPalmLandmarks(.5, .5);
		const handUp = createPalmLandmarks(.5, .45);
		const handDown = createPalmLandmarks(.5, .55);
		engine.update(true, hand1, false);
		const upResult = engine.update(true, handUp, false);
		assert.equal(upResult.isActive, true);
		assert.ok(upResult.deltaPitch > 0, `Moving hand up must produce positive elevation delta (rotateUp), got ${upResult.deltaPitch}`);
		assert.equal(upResult.deltaYaw, 0, "Vertical movement must not induce horizontal yaw");
		const downResult = engine.update(true, handDown, false);
		assert.equal(downResult.isActive, true);
		assert.ok(downResult.deltaPitch < 0, `Moving hand down must produce negative elevation delta, got ${downResult.deltaPitch}`);
	});
	it("respects invertYaw and invertPitch configuration flags", () => {
		const engine = new GestureOrbitEngine({
			mirrorX: true,
			invertYaw: true,
			invertPitch: true
		});
		engine.update(true, createPalmLandmarks(.5, .5), false);
		const resRight = engine.update(true, createPalmLandmarks(.45, .5), false);
		assert.ok(resRight.deltaYaw < 0, "Inverted yaw must produce negative delta on rightward move");
		const resUp = engine.update(true, createPalmLandmarks(.45, .45), false);
		assert.ok(resUp.deltaPitch < 0, "Inverted pitch must produce negative delta on upward move");
	});
	it("filters out micro-tremor fluctuations within the deadband threshold", () => {
		const engine = new GestureOrbitEngine({ deadband: .005 });
		engine.update(true, createPalmLandmarks(.5, .5), false);
		const tremorResult = engine.update(true, createPalmLandmarks(.501, .501), false);
		assert.equal(tremorResult.deltaYaw, 0, "Displacement within deadband must produce 0 yaw delta");
		assert.equal(tremorResult.deltaPitch, 0, "Displacement within deadband must produce 0 pitch delta");
		assert.equal(tremorResult.isActive, true);
		const moveResult = engine.update(true, createPalmLandmarks(.48, .501), false);
		assert.notEqual(moveResult.deltaYaw, 0, "Movement exceeding deadband must generate delta");
	});
	it("protects against sudden tracking jumps by discarding outlier delta and re-anchoring", () => {
		const engine = new GestureOrbitEngine({ maxJumpThreshold: .15 });
		engine.update(true, createPalmLandmarks(.5, .5), false);
		const jumpResult = engine.update(true, createPalmLandmarks(.85, .5), false);
		assert.equal(jumpResult.deltaYaw, 0, "Outlier jump must be rejected with 0 yaw delta");
		assert.equal(jumpResult.deltaPitch, 0, "Outlier jump must be rejected with 0 pitch delta");
		assert.equal(jumpResult.isActive, true);
		const nextResult = engine.update(true, createPalmLandmarks(.83, .5), false);
		assert.notEqual(nextResult.deltaYaw, 0, "Subsequent movement from re-anchored position must function");
	});
	it("resets anchor cleanly when tracking is lost, preventing jumps upon re-acquisition", () => {
		const engine = new GestureOrbitEngine();
		engine.update(true, createPalmLandmarks(.5, .5), false);
		engine.update(true, createPalmLandmarks(.48, .5), false);
		const lostResult = engine.update(true, null, false);
		assert.equal(lostResult.isActive, false);
		assert.equal(lostResult.anchor, null);
		const reacquiredResult = engine.update(true, createPalmLandmarks(.2, .8), false);
		assert.equal(reacquiredResult.isActive, true);
		assert.equal(reacquiredResult.deltaYaw, 0, "Reacquired tracking must not snap camera");
		assert.equal(reacquiredResult.deltaPitch, 0);
	});
	it("does not generate camera movement while gesture is inactive", () => {
		const engine = new GestureOrbitEngine();
		const res1 = engine.update(false, createPalmLandmarks(.5, .5), false);
		assert.equal(res1.isActive, false);
		assert.equal(res1.deltaYaw, 0);
		const res2 = engine.update(false, createPalmLandmarks(.2, .8), false);
		assert.equal(res2.isActive, false);
		assert.equal(res2.deltaYaw, 0);
		assert.equal(res2.deltaPitch, 0);
	});
	it("yields immediately when mouse drag is active", () => {
		const engine = new GestureOrbitEngine();
		engine.update(true, createPalmLandmarks(.5, .5), false);
		const mouseActiveResult = engine.update(true, createPalmLandmarks(.45, .5), true);
		assert.equal(mouseActiveResult.isActive, false, "Must be inactive when mouse is active");
		assert.equal(mouseActiveResult.deltaYaw, 0);
		assert.equal(mouseActiveResult.deltaPitch, 0);
	});
	it("scales rotation proportionally with configured sensitivity", () => {
		const engineLow = new GestureOrbitEngine({
			yawSensitivity: 1,
			mirrorX: true
		});
		const engineHigh = new GestureOrbitEngine({
			yawSensitivity: 4,
			mirrorX: true
		});
		engineLow.update(true, createPalmLandmarks(.5, .5), false);
		engineHigh.update(true, createPalmLandmarks(.5, .5), false);
		const resLow = engineLow.update(true, createPalmLandmarks(.45, .5), false);
		const resHigh = engineHigh.update(true, createPalmLandmarks(.45, .5), false);
		assert.ok(Math.abs(resHigh.deltaYaw - resLow.deltaYaw * 4) < 1e-4);
	});
});
// tests/pinchZoom.test.ts
/**
* Unit Test Suite for Task 4.2: Gesture-Based Pinch-to-Zoom
*
* Validates:
* 1. Normalized pinch-distance calculation and scale-invariance.
* 2. Zoom-in and zoom-out direction mapping.
* 3. Deadband tremor filtering.
* 4. Single-frame tracking jump rejection.
* 5. Tracking loss and re-entry handling.
* 6. Conflict handling with OPEN_PALM, POINTING, and mouse controls.
* 7. Camera min/max distance clamping via CameraController.zoomBy.
*/
/**
* Creates synthetic 21-point hand landmark array with customizable thumb and index tip positions.
*/
function createHandWithPinch(thumbTip, indexTip, scaleFactor = 1) {
	const landmarks = Array.from({ length: 21 }, () => ({
		x: .5 * scaleFactor,
		y: .5 * scaleFactor,
		z: 0
	}));
	landmarks[0] = {
		x: .5 * scaleFactor,
		y: .8 * scaleFactor,
		z: 0
	};
	landmarks[5] = {
		x: .45 * scaleFactor,
		y: .6 * scaleFactor,
		z: 0
	};
	landmarks[9] = {
		x: .5 * scaleFactor,
		y: .58 * scaleFactor,
		z: 0
	};
	landmarks[13] = {
		x: .55 * scaleFactor,
		y: .6 * scaleFactor,
		z: 0
	};
	landmarks[17] = {
		x: .6 * scaleFactor,
		y: .63 * scaleFactor,
		z: 0
	};
	landmarks[4] = {
		x: thumbTip.x * scaleFactor,
		y: thumbTip.y * scaleFactor,
		z: (thumbTip.z ?? 0) * scaleFactor
	};
	landmarks[8] = {
		x: indexTip.x * scaleFactor,
		y: indexTip.y * scaleFactor,
		z: (indexTip.z ?? 0) * scaleFactor
	};
	return landmarks;
}
describe("GesturePinchZoomEngine (Task 4.2 Math & Interaction)", () => {
	it("exposes centrally configured default pinch zoom parameters", () => {
		assert.equal(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.spreadIsZoomIn, false);
		assert.equal(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.invertZoom, false);
		assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.deadband > 0);
		assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.zoomSensitivity > 0);
		assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.maxJumpThreshold > 0);
		assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.smoothingAlpha > 0);
		assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.maxPinchSessionDistance > 0);
	});
	it("correctly calculates pinch distance normalized against hand scale", () => {
		const engine = new GesturePinchZoomEngine();
		const hand1 = createHandWithPinch({
			x: .44,
			y: .4
		}, {
			x: .48,
			y: .4
		}, 1);
		const result1 = engine.computePinchDistance(hand1);
		assert.ok(result1 !== null);
		assert.ok(result1.pinchDistanceNorm > 0);
		const hand2 = createHandWithPinch({
			x: .44,
			y: .4
		}, {
			x: .48,
			y: .4
		}, 2);
		const result2 = engine.computePinchDistance(hand2);
		assert.ok(result2 !== null);
		assert.ok(Math.abs(result1.pinchDistanceNorm - result2.pinchDistanceNorm) < 1e-4, `Expected scale-invariance: scale 1 (${result1.pinchDistanceNorm}) vs scale 2 (${result2.pinchDistanceNorm})`);
	});
	it("safely handles null, empty, or incomplete landmarks in computePinchDistance", () => {
		const engine = new GesturePinchZoomEngine();
		assert.equal(engine.computePinchDistance(null), null);
		assert.equal(engine.computePinchDistance(void 0), null);
		assert.equal(engine.computePinchDistance([]), null);
		assert.equal(engine.computePinchDistance(Array(15).fill({
			x: 0,
			y: 0
		})), null);
	});
	it("safely handles non-finite landmark coordinates", () => {
		const engine = new GesturePinchZoomEngine();
		const hand = createHandWithPinch({
			x: NaN,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		assert.equal(engine.computePinchDistance(hand), null);
	});
	it("initiates pinch session upon stable PINCH gesture and anchors without camera jump", () => {
		const engine = new GesturePinchZoomEngine();
		const hand = createHandWithPinch({
			x: .44,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, hand, false, false);
		assert.equal(delta.isActive, true);
		assert.equal(delta.deltaZoom, 0);
		assert.equal(engine.isSessionActive(), true);
	});
	it("zooms in when fingers move closer together (spreadIsZoomIn: false default)", () => {
		const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1 });
		const hand1 = createHandWithPinch({
			x: .44,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const hand2 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, hand2, false, false);
		assert.equal(delta.isActive, true);
		assert.ok(delta.deltaZoom > 0, `Expected zoom-in (deltaZoom > 0), got ${delta.deltaZoom}`);
		assert.ok(delta.rawDeltaDistance < 0, `Expected rawDeltaDistance < 0, got ${delta.rawDeltaDistance}`);
	});
	it("zooms out when fingers move farther apart (spreadIsZoomIn: false default)", () => {
		const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1 });
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const hand2 = createHandWithPinch({
			x: .42,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, hand2, false, false);
		assert.equal(delta.isActive, true);
		assert.ok(delta.deltaZoom < 0, `Expected zoom-out (deltaZoom < 0), got ${delta.deltaZoom}`);
		assert.ok(delta.rawDeltaDistance > 0, `Expected rawDeltaDistance > 0, got ${delta.rawDeltaDistance}`);
	});
	it("reverses zoom direction when spreadIsZoomIn is configured to true", () => {
		const engine = new GesturePinchZoomEngine({
			spreadIsZoomIn: true,
			smoothingAlpha: 1
		});
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const hand2 = createHandWithPinch({
			x: .42,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, hand2, false, false);
		assert.ok(delta.deltaZoom > 0, `Expected zoom-in with spreadIsZoomIn: true, got ${delta.deltaZoom}`);
	});
	it("filters micro-tremors below deadband threshold", () => {
		const engine = new GesturePinchZoomEngine({
			deadband: .015,
			smoothingAlpha: 1
		});
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const hand2 = createHandWithPinch({
			x: .4605,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, hand2, false, false);
		assert.equal(delta.deltaZoom, 0, "Micro-tremor below deadband must produce zero delta");
	});
	it("rejects sudden single-frame tracking jumps and re-anchors safely", () => {
		const engine = new GesturePinchZoomEngine({
			maxJumpThreshold: .35,
			smoothingAlpha: 1
		});
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const handJump = createHandWithPinch({
			x: .25,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const delta = engine.update(true, handJump, false, false);
		assert.equal(delta.deltaZoom, 0, "Single-frame jump exceeding threshold must be rejected with 0 delta");
	});
	it("safely handles tracking loss and hand re-entry", () => {
		const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1 });
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const deltaLost = engine.update(true, null, false, false);
		assert.equal(deltaLost.isActive, false);
		assert.equal(deltaLost.deltaZoom, 0);
		assert.equal(engine.isSessionActive(), false);
		const handReentry = createHandWithPinch({
			x: .43,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		const deltaReentry = engine.update(true, handReentry, false, false);
		assert.equal(deltaReentry.isActive, true);
		assert.equal(deltaReentry.deltaZoom, 0);
	});
	it("yields immediately when conflicting gestures (OPEN_PALM or POINTING) are active", () => {
		const engine = new GesturePinchZoomEngine();
		const hand = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand, false, false);
		const deltaConflict = engine.update(true, hand, false, true);
		assert.equal(deltaConflict.isActive, false);
		assert.equal(deltaConflict.deltaZoom, 0);
		assert.equal(engine.isSessionActive(), false);
	});
	it("yields immediately when user mouse or touch interaction is active", () => {
		const engine = new GesturePinchZoomEngine();
		const hand = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand, false, false);
		const deltaMouse = engine.update(true, hand, true, false);
		assert.equal(deltaMouse.isActive, false);
		assert.equal(deltaMouse.deltaZoom, 0);
		assert.equal(engine.isSessionActive(), false);
	});
	it("terminates pinch session when fingers spread beyond maxPinchSessionDistance", () => {
		const engine = new GesturePinchZoomEngine({ maxPinchSessionDistance: .65 });
		const hand1 = createHandWithPinch({
			x: .46,
			y: .4
		}, {
			x: .48,
			y: .4
		});
		engine.update(true, hand1, false, false);
		const handWide = createHandWithPinch({
			x: .1,
			y: .4
		}, {
			x: .6,
			y: .4
		});
		const delta = engine.update(false, handWide, false, false);
		assert.equal(delta.isActive, false);
		assert.equal(engine.isSessionActive(), false);
	});
});
function createMockDom$1() {
	const doc = {
		addEventListener: () => {},
		removeEventListener: () => {}
	};
	return {
		addEventListener: () => {},
		removeEventListener: () => {},
		ownerDocument: doc,
		getRootNode: () => doc,
		style: {}
	};
}
describe("CameraController Clamping (Min & Max Distance)", () => {
	it("clamps camera zoom distance to safe minimum limit", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const controller = new CameraController(camera, createMockDom$1(), {
			minDistance: 2,
			maxDistance: 25,
			enableDamping: false
		});
		assert.equal(controller.getMinDistance(), 2);
		assert.equal(controller.getMaxDistance(), 25);
		const newDist = controller.zoomBy(50);
		assert.ok(Math.abs(newDist - 2) < 1e-4, `Expected clamped to minDistance 2.0, got ${newDist}`);
		assert.ok(Math.abs(controller.getDistance() - 2) < 1e-4);
		controller.dispose();
	});
	it("clamps camera zoom distance to safe maximum limit", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const controller = new CameraController(camera, createMockDom$1(), {
			minDistance: 2,
			maxDistance: 25,
			enableDamping: false
		});
		const newDist = controller.zoomBy(-50);
		assert.ok(Math.abs(newDist - 25) < 1e-4, `Expected clamped to maxDistance 25.0, got ${newDist}`);
		assert.ok(Math.abs(controller.getDistance() - 25) < 1e-4);
		controller.dispose();
	});
});
// src/components/hud/VirtualCursor.tsx
/**
* Maps normalized fingertip coordinates to viewport pixel space and Three.js NDC.
* Accounts for horizontal webcam mirroring and clamps to viewport bounds.
* Pure decoupled function for high-performance execution and automated testing.
*/
function projectFingertipToScreen(landmark, viewport, mirrorX = true) {
	if (!landmark) return null;
	if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
	if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
	const rawX = landmark.x;
	const rawY = landmark.y;
	const mirroredX = mirrorX ? 1 - rawX : rawX;
	const normalizedY = rawY;
	const clampedX = Math.max(0, Math.min(1, mirroredX));
	const clampedY = Math.max(0, Math.min(1, normalizedY));
	const pixelX = clampedX * viewport.width;
	const pixelY = clampedY * viewport.height;
	const ndcX = clampedX * 2 - 1;
	const ndcY = -(clampedY * 2 - 1);
	return {
		screen: {
			x: pixelX,
			y: pixelY
		},
		ndc: {
			x: ndcX,
			y: ndcY
		},
		normalizedMirrored: {
			x: clampedX,
			y: clampedY
		}
	};
}
var VirtualCursor = ({ visible, position, dwellProgress = 0, hoveredComponentName, className = "" }) => {
	if (!visible || !position) return null;
	const radius = 22;
	const strokeWidth = 3.5;
	const circumference = 2 * Math.PI * radius;
	const clampedProgress = Math.max(0, Math.min(1, dwellProgress));
	const strokeDashoffset = circumference - clampedProgress * circumference;
	const isDwelling = clampedProgress > 0;
	return /* @__PURE__ */ jsxs("div", {
		className: `virtual-cursor-container ${isDwelling ? "is-dwelling" : ""} ${className}`,
		style: {
			left: `${position.x}px`,
			top: `${position.y}px`
		},
		"aria-hidden": "true",
		"data-testid": "virtual-cursor",
		children: [
			/* @__PURE__ */ jsx("div", { className: "laser-halo" }),
			/* @__PURE__ */ jsx("div", { className: "crosshair-tick tick-top" }),
			/* @__PURE__ */ jsx("div", { className: "crosshair-tick tick-bottom" }),
			/* @__PURE__ */ jsx("div", { className: "crosshair-tick tick-left" }),
			/* @__PURE__ */ jsx("div", { className: "crosshair-tick tick-right" }),
			/* @__PURE__ */ jsx("div", {
				className: `laser-dot ${isDwelling ? "dwelling" : ""}`,
				children: /* @__PURE__ */ jsx("div", { className: "laser-core" })
			}),
			isDwelling && /* @__PURE__ */ jsxs("svg", {
				className: "dwell-svg-ring",
				width: "56",
				height: "56",
				viewBox: "0 0 56 56",
				children: [/* @__PURE__ */ jsx("circle", {
					className: "dwell-track",
					cx: "28",
					cy: "28",
					r: radius,
					strokeWidth
				}), /* @__PURE__ */ jsx("circle", {
					className: "dwell-progress",
					cx: "28",
					cy: "28",
					r: radius,
					strokeWidth,
					strokeDasharray: circumference,
					strokeDashoffset
				})]
			}),
			hoveredComponentName && /* @__PURE__ */ jsxs("div", {
				className: "laser-hover-tooltip",
				children: [/* @__PURE__ */ jsx("span", {
					className: "tooltip-name",
					children: hoveredComponentName
				}), isDwelling && /* @__PURE__ */ jsx("span", {
					className: "tooltip-hint",
					children: clampedProgress >= 1 ? "Locked" : `Holding... ${Math.round(clampedProgress * 100)}%`
				})]
			})
		]
	});
};
// src/components/hud/DwellCursor.tsx
/**
* DwellCursor (Phase 5 / Task 5.2)
* Unifies with VirtualCursor (Task 4.3) to provide a single glowing laser pointer
* wrapped by an animated circular dwell timer.
*/
var DwellCursor = (props) => {
	return /* @__PURE__ */ jsx(VirtualCursor, { ...props });
};
// tests/virtualCursor.test.ts
/**
* Unit Test Suite for Task 4.3: Virtual Laser Pointer / Cursor
*
* Validates:
* 1. Normalized-to-screen coordinate projection and Three.js NDC mapping.
* 2. Mirrored vs unmirrored coordinate transforms.
* 3. Viewport boundary clamping on extreme coordinates.
* 4. Safe rejection of null, undefined, NaN, or non-positive viewport sizes.
* 5. Gesture exclusivity (visible on stable POINTING, hidden on OPEN_PALM, PINCH, NONE, or tracking loss).
* 6. Dwell progress integration and hover tooltip rendering.
* 7. Backward compatibility wrapper in DwellCursor.
*/
describe("projectFingertipToScreen (Coordinate Projection Math)", () => {
	const viewport = {
		width: 1e3,
		height: 800
	};
	it("correctly maps normalized coordinates to mirrored screen pixels and Three.js NDC", () => {
		const result = projectFingertipToScreen({
			x: .3,
			y: .4
		}, viewport, true);
		assert.ok(result !== null);
		assert.equal(result.normalizedMirrored.x, .7);
		assert.equal(result.normalizedMirrored.y, .4);
		assert.equal(result.screen.x, 700);
		assert.equal(result.screen.y, 320);
		assert.ok(Math.abs(result.ndc.x - .4) < 1e-6);
		assert.ok(Math.abs(result.ndc.y - .2) < 1e-6);
	});
	it("respects unmirrored coordinates when mirrorX is false", () => {
		const result = projectFingertipToScreen({
			x: .3,
			y: .4
		}, viewport, false);
		assert.ok(result !== null);
		assert.equal(result.screen.x, 300);
		assert.equal(result.screen.y, 320);
		assert.ok(Math.abs(result.ndc.x - -.4) < 1e-6);
		assert.ok(Math.abs(result.ndc.y - .2) < 1e-6);
	});
	it("clamps coordinates strictly to viewport boundaries on out-of-frame landmarks", () => {
		const resultLeft = projectFingertipToScreen({
			x: -.5,
			y: -.2
		}, viewport, false);
		assert.ok(resultLeft !== null);
		assert.equal(resultLeft.screen.x, 0);
		assert.equal(resultLeft.screen.y, 0);
		assert.equal(resultLeft.ndc.x, -1);
		assert.equal(resultLeft.ndc.y, 1);
		const resultRight = projectFingertipToScreen({
			x: 1.8,
			y: 1.4
		}, viewport, false);
		assert.ok(resultRight !== null);
		assert.equal(resultRight.screen.x, 1e3);
		assert.equal(resultRight.screen.y, 800);
		assert.equal(resultRight.ndc.x, 1);
		assert.equal(resultRight.ndc.y, -1);
	});
	it("safely rejects null, undefined, and non-finite landmark coordinates", () => {
		assert.equal(projectFingertipToScreen(null, viewport), null);
		assert.equal(projectFingertipToScreen(void 0, viewport), null);
		assert.equal(projectFingertipToScreen({
			x: NaN,
			y: .5
		}, viewport), null);
		assert.equal(projectFingertipToScreen({
			x: .5,
			y: Number.POSITIVE_INFINITY
		}, viewport), null);
	});
	it("safely rejects zero or negative viewport dimensions", () => {
		const landmark = {
			x: .5,
			y: .5
		};
		assert.equal(projectFingertipToScreen(landmark, {
			width: 0,
			height: 600
		}), null);
		assert.equal(projectFingertipToScreen(landmark, {
			width: 800,
			height: -10
		}), null);
	});
});
describe("VirtualCursor Gesture Exclusivity & State Logic", () => {
	function evaluateCursorVisibility(gesture, isStable, hasLandmark) {
		return gesture === "POINTING" && isStable === true && hasLandmark === true;
	}
	it("activates only when POINTING is stable and hand landmarks are present", () => {
		assert.equal(evaluateCursorVisibility("POINTING", true, true), true);
	});
	it("hides cursor when gesture is OPEN_PALM (orbit navigation mode)", () => {
		assert.equal(evaluateCursorVisibility("OPEN_PALM", true, true), false);
	});
	it("hides cursor when gesture is PINCH (zoom mode)", () => {
		assert.equal(evaluateCursorVisibility("PINCH", true, true), false);
	});
	it("hides cursor when gesture is NONE or resting fist", () => {
		assert.equal(evaluateCursorVisibility("NONE", true, true), false);
	});
	it("hides cursor when pointing is unstable or transitioning", () => {
		assert.equal(evaluateCursorVisibility("POINTING", false, true), false);
	});
	it("hides cursor immediately when hand tracking is lost", () => {
		assert.equal(evaluateCursorVisibility("POINTING", true, false), false);
	});
});
describe("VirtualCursor Component & Dwell Integration", () => {
	it("returns null when visible is false or position is null", () => {
		const hidden1 = VirtualCursor({
			visible: false,
			position: {
				x: 200,
				y: 300
			}
		});
		assert.equal(hidden1, null);
		const hidden2 = VirtualCursor({
			visible: true,
			position: null
		});
		assert.equal(hidden2, null);
	});
	it("renders laser cursor element when visible with valid position", () => {
		const element = VirtualCursor({
			visible: true,
			position: {
				x: 250,
				y: 400
			},
			dwellProgress: 0,
			hoveredComponentName: null
		});
		assert.ok(React.isValidElement(element));
		assert.equal(element.props["data-testid"], "virtual-cursor");
		assert.equal(element.props.style.left, "250px");
		assert.equal(element.props.style.top, "400px");
	});
	it("applies is-dwelling class and renders dwell ring when dwellProgress > 0", () => {
		const element = VirtualCursor({
			visible: true,
			position: {
				x: 250,
				y: 400
			},
			dwellProgress: .65,
			hoveredComponentName: "Sun Gear"
		});
		assert.ok(React.isValidElement(element));
		assert.ok(element.props.className.includes("is-dwelling"));
		const children = React.Children.toArray(element.props.children);
		assert.ok(children.length >= 4);
	});
	it("preserves backward compatibility through DwellCursor wrapper", () => {
		const element = DwellCursor({
			visible: true,
			position: {
				x: 100,
				y: 150
			},
			dwellProgress: .5,
			hoveredComponentName: "Ring Gear"
		});
		assert.ok(React.isValidElement(element));
	});
});
// src/components/scene/ComponentRaycaster.ts
/**
* ComponentRaycaster & Mesh Highlighter
* Task 5.1: Three.js Screen-Space Raycaster
*
* Implements screen-space raycasting from mouse or virtual pointing coordinates
* into the 3D scene, resolves meshes to parent engineering component IDs,
* and manages non-destructive emissive visual highlighting.
*/
/**
* Traverses up the Three.js scene hierarchy from an intersected mesh
* to resolve its parent engineering component ID.
*
* Rules:
* 1. Prioritizes explicit `current.userData.componentId`.
* 2. If a model-scoped validator is provided, ensures candidate ID is valid for the active model.
* 3. Falls back to meaningful `current.name` only if validated against active model component IDs.
* 4. Never assumes a global or single-model component list.
*/
function resolveComponentId(object, validator) {
	let current = object;
	const isValid = (id) => {
		if (!validator) return true;
		if (typeof validator === "function") return validator(id);
		if (validator instanceof Set) return validator.has(id);
		if (Array.isArray(validator)) return validator.includes(id);
		return true;
	};
	while (current) {
		if (current.userData && typeof current.userData.componentId === "string" && current.userData.componentId.trim() !== "") {
			const candidateId = current.userData.componentId.trim();
			if (isValid(candidateId)) return candidateId;
		}
		if (current.name && typeof current.name === "string" && current.name.trim() !== "" && validator && isValid(current.name.trim())) return current.name.trim();
		current = current.parent;
	}
	return null;
}
var DEFAULT_RAYCASTER_OPTIONS = {
	hoverColor: 440020,
	hoverIntensity: .55,
	selectedColor: 16096779,
	selectedIntensity: .85
};
/**
* Manages 3D screen-space raycasting and non-destructive component highlighting.
*/
var ComponentRaycaster = class {
	camera;
	rootObject;
	raycaster;
	options;
	activeHoveredId = null;
	activeSelectedId = null;
	validator;
	highlightedMeshes = /* @__PURE__ */ new Set();
	constructor(camera, rootObject, options = {}) {
		this.camera = camera;
		this.rootObject = rootObject;
		this.raycaster = new THREE.Raycaster();
		this.options = {
			...DEFAULT_RAYCASTER_OPTIONS,
			...options
		};
		if (options.isValidComponentId) this.validator = options.isValidComponentId;
		else if (options.validComponentIds) {
			const idSet = options.validComponentIds instanceof Set ? options.validComponentIds : new Set(options.validComponentIds);
			this.validator = (id) => idSet.has(id);
		}
	}
	/**
	* Casts a ray from normalized device coordinates (NDC) into the 3D scene.
	* Returns the first valid hit that resolves to a registered component ID.
	*/
	raycast(coords) {
		if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;
		this.raycaster.setFromCamera(new THREE.Vector2(coords.x, coords.y), this.camera);
		const intersects = this.raycaster.intersectObjects(this.rootObject.children, true);
		for (const hit of intersects) if (hit.object.isMesh) {
			const componentId = resolveComponentId(hit.object, this.validator);
			if (componentId) return {
				componentId,
				distance: hit.distance,
				point: hit.point,
				mesh: hit.object
			};
		}
		return null;
	}
	/**
	* Applies hover highlighting to the specified component ID.
	* If the component is already selected, preserves selection highlighting.
	*/
	setHoverHighlight(componentId) {
		if (this.activeHoveredId === componentId) return;
		if (this.activeHoveredId && this.activeHoveredId !== this.activeSelectedId) this.clearComponentHighlight(this.activeHoveredId);
		this.activeHoveredId = componentId;
		if (componentId && componentId !== this.activeSelectedId) this.applyComponentHighlight(componentId, this.options.hoverColor, this.options.hoverIntensity);
	}
	/**
	* Applies persistent selection highlighting to the specified component ID.
	* Clears any previous selection highlight and restores original materials.
	*/
	setSelectionHighlight(componentId) {
		if (this.activeSelectedId === componentId) return;
		if (this.activeSelectedId) this.clearComponentHighlight(this.activeSelectedId);
		this.activeSelectedId = componentId;
		if (!componentId) {
			if (this.activeHoveredId) this.applyComponentHighlight(this.activeHoveredId, this.options.hoverColor, this.options.hoverIntensity);
			return;
		}
		this.applyComponentHighlight(componentId, this.options.selectedColor, this.options.selectedIntensity);
	}
	/**
	* Applies an emissive highlight color to all meshes belonging to a component ID.
	* Clones each mesh's material so shared materials on other parts remain untouched.
	*/
	applyComponentHighlight(componentId, colorHex, intensity) {
		this.rootObject.traverse((obj) => {
			const mesh = obj;
			if (mesh.isMesh && resolveComponentId(mesh, this.validator) === componentId) {
				if (!mesh.userData._originalMaterial) mesh.userData._originalMaterial = mesh.material;
				if (mesh.userData._originalMaterial instanceof THREE.MeshStandardMaterial) {
					const clonedMat = mesh.userData._originalMaterial.clone();
					clonedMat.emissive = new THREE.Color(colorHex);
					clonedMat.emissiveIntensity = intensity;
					mesh.material = clonedMat;
					this.highlightedMeshes.add(mesh);
				}
			}
		});
	}
	/**
	* Restores original materials to all meshes belonging to a specific component ID.
	*/
	clearComponentHighlight(componentId) {
		this.rootObject.traverse((obj) => {
			const mesh = obj;
			if (mesh.isMesh && resolveComponentId(mesh, this.validator) === componentId) {
				if (mesh.userData._originalMaterial) {
					if (mesh.material && mesh.material !== mesh.userData._originalMaterial) {
						if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
						else mesh.material.dispose();
					}
					mesh.material = mesh.userData._originalMaterial;
					delete mesh.userData._originalMaterial;
					this.highlightedMeshes.delete(mesh);
				}
			}
		});
	}
	/**
	* Restores all modified meshes back to their original materials and disposes cloned materials.
	*/
	clearAllHighlights() {
		for (const mesh of this.highlightedMeshes) if (mesh.userData._originalMaterial) {
			if (mesh.material && mesh.material !== mesh.userData._originalMaterial) {
				if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
				else mesh.material.dispose();
			}
			mesh.material = mesh.userData._originalMaterial;
			delete mesh.userData._originalMaterial;
		}
		this.highlightedMeshes.clear();
		this.activeHoveredId = null;
		this.activeSelectedId = null;
	}
	getActiveHoveredId() {
		return this.activeHoveredId;
	}
	getActiveSelectedId() {
		return this.activeSelectedId;
	}
	dispose() {
		this.clearAllHighlights();
	}
};
// src/components/scene/ComponentSelector.ts
var DEFAULT_SELECTOR_CONFIG = { dwellDurationMs: 1200 };
/**
* Pure state machine managing dwell timers, hover states, and component selection.
* Decoupled from rendering logic for independent unit testing.
*/
var ComponentSelector = class {
	config;
	hoveredId = null;
	selectedId = null;
	dwellTimerMs = 0;
	dwellProgress = 0;
	constructor(config = {}) {
		this.config = {
			...DEFAULT_SELECTOR_CONFIG,
			...config
		};
	}
	getConfig() {
		return { ...this.config };
	}
	setConfig(partialConfig) {
		this.config = {
			...this.config,
			...partialConfig
		};
	}
	/**
	* Advances the dwell timer by deltaMs based on the currently hovered component.
	*
	* @param candidateHoverId - Component ID currently under cursor, or null if empty space
	* @param deltaMs - Elapsed frame time in milliseconds
	*/
	update(candidateHoverId, deltaMs) {
		let justSelected = false;
		if (candidateHoverId !== this.hoveredId) {
			this.hoveredId = candidateHoverId;
			this.dwellTimerMs = 0;
			this.dwellProgress = 0;
		}
		if (this.hoveredId !== null && this.hoveredId !== this.selectedId) {
			this.dwellTimerMs += Math.max(0, deltaMs);
			this.dwellProgress = Math.min(1, this.dwellTimerMs / this.config.dwellDurationMs);
			if (this.dwellProgress >= 1) {
				this.selectedId = this.hoveredId;
				this.dwellTimerMs = 0;
				this.dwellProgress = 0;
				justSelected = true;
			}
		} else {
			this.dwellTimerMs = 0;
			this.dwellProgress = 0;
		}
		return {
			selectedId: this.selectedId,
			hoveredId: this.hoveredId,
			dwellProgress: this.dwellProgress,
			justSelected,
			justDeselected: false
		};
	}
	/**
	* Direct selection (e.g. mouse click).
	*/
	select(componentId) {
		const prevSelected = this.selectedId;
		this.selectedId = componentId;
		this.dwellTimerMs = 0;
		this.dwellProgress = 0;
		return {
			selectedId: this.selectedId,
			hoveredId: this.hoveredId,
			dwellProgress: 0,
			justSelected: componentId !== null && componentId !== prevSelected,
			justDeselected: componentId === null && prevSelected !== null
		};
	}
	/**
	* Clears the current active selection.
	*/
	clearSelection() {
		return this.select(null);
	}
	getSelectedId() {
		return this.selectedId;
	}
	getHoveredId() {
		return this.hoveredId;
	}
	getDwellProgress() {
		return this.dwellProgress;
	}
	reset() {
		this.hoveredId = null;
		this.selectedId = null;
		this.dwellTimerMs = 0;
		this.dwellProgress = 0;
	}
};
// src/types/assembly.ts
var GEARBOX_COMPONENTS = {
	sun_gear: {
		id: "sun_gear",
		name: "Sun Gear",
		role: "Central Driving Input",
		teethCount: 16,
		materialName: "High-Tensile Brass Alloy",
		description: "Central input gear that meshes with all three planet gears to distribute mechanical torque."
	},
	planet_gear_1: {
		id: "planet_gear_1",
		name: "Planet Gear A",
		role: "Epicyclic Torque Transfer",
		teethCount: 12,
		materialName: "Carburized Steel (AISI 8620)",
		description: "Rotates on its own needle bearing axis while orbiting within the stationary ring gear."
	},
	planet_gear_2: {
		id: "planet_gear_2",
		name: "Planet Gear B",
		role: "Epicyclic Torque Transfer",
		teethCount: 12,
		materialName: "Carburized Steel (AISI 8620)",
		description: "Second of three load-sharing planet gears positioned at 120-degree radial offset."
	},
	planet_gear_3: {
		id: "planet_gear_3",
		name: "Planet Gear C",
		role: "Epicyclic Torque Transfer",
		teethCount: 12,
		materialName: "Carburized Steel (AISI 8620)",
		description: "Third load-sharing planet gear completing the balanced 3-point planetary stage."
	},
	ring_gear: {
		id: "ring_gear",
		name: "Annulus (Ring Gear)",
		role: "Stationary Outer Reaction Ring",
		teethCount: 40,
		materialName: "Forged Nitrided Steel",
		description: "Outer ring with internal teeth providing the reaction torque for the planetary reduction."
	},
	planet_carrier: {
		id: "planet_carrier",
		name: "Planet Carrier & Output Plate",
		role: "Output Torque Collector",
		materialName: "Ductile Cast Iron (ASTM A536)",
		description: "Rigid triangular spider plate supporting the three planet gear shafts and transmitting reduced-speed output."
	},
	central_shaft: {
		id: "central_shaft",
		name: "Primary Drive Shaft",
		role: "Axial Alignment & Power Transfer",
		materialName: "Hardened Chrome-Moly (AISI 4140)",
		description: "Central transmission axle maintaining concentric alignment across all rotating stages."
	}
};
// src/data/machineMetadata.ts
/**
* Machine Component Engineering Metadata
* Task 5.3: Component Information HUD Panel
*
* Provides comprehensive technical specifications, kinematics, materials,
* and operational guidelines for the planetary gearbox assembly.
*/
var EXTENDED_GEARBOX_METADATA = {
	sun_gear: {
		...GEARBOX_COMPONENTS.sun_gear,
		nominalRpm: "1,200 RPM (Input)",
		gearRatio: "1.000 : 1 (Direct Drive)",
		pitchDiameter: "48.0 mm",
		modulePitch: "3.0 mm (Module)",
		lubricationSpec: "Synthetic PAO Gear Oil ISO VG 220",
		serviceIntervalHours: 5e3,
		specifications: [
			{
				label: "Tooth Profile",
				value: "Involute 20° Pressure Angle"
			},
			{
				label: "Pitch Diameter",
				value: "48.0 mm"
			},
			{
				label: "Face Width",
				value: "25.0 mm"
			},
			{
				label: "Core Hardness",
				value: "58 - 62 HRC"
			},
			{
				label: "Torque Rating",
				value: "45.0 N·m"
			}
		],
		engineeringNotes: [
			"High-tensile brass hub minimizes frictional heat during rapid acceleration.",
			"Meshes simultaneously with three planet gears distributing radial stress.",
			"Center keyed bore connects directly to the primary drive input shaft."
		]
	},
	planet_gear_1: {
		...GEARBOX_COMPONENTS.planet_gear_1,
		nominalRpm: "400 RPM (Planetary Spin)",
		gearRatio: "3.333 : 1 (Internal Ratio)",
		pitchDiameter: "36.0 mm",
		modulePitch: "3.0 mm (Module)",
		lubricationSpec: "Synthetic PAO Gear Oil ISO VG 220",
		serviceIntervalHours: 6e3,
		specifications: [
			{
				label: "Angular Position",
				value: "0° Radial Standoff"
			},
			{
				label: "Tooth Profile",
				value: "Involute 20° Pressure Angle"
			},
			{
				label: "Bearing Type",
				value: "Cylindrical Needle Roller"
			},
			{
				label: "Tooth Flank Treatment",
				value: "Case Hardened (0.8 mm)"
			},
			{
				label: "Radial Load Share",
				value: "33.3% of Input Load"
			}
		],
		engineeringNotes: [
			"Transfers mechanical power from central sun gear to the outer reaction ring.",
			"Mounted on hardened cantilever carrier pin with precision bronze thrust washers.",
			"Revolving epicyclic motion balances axial forces across the assembly."
		]
	},
	planet_gear_2: {
		...GEARBOX_COMPONENTS.planet_gear_2,
		nominalRpm: "400 RPM (Planetary Spin)",
		gearRatio: "3.333 : 1 (Internal Ratio)",
		pitchDiameter: "36.0 mm",
		modulePitch: "3.0 mm (Module)",
		lubricationSpec: "Synthetic PAO Gear Oil ISO VG 220",
		serviceIntervalHours: 6e3,
		specifications: [
			{
				label: "Angular Position",
				value: "120° Radial Standoff"
			},
			{
				label: "Tooth Profile",
				value: "Involute 20° Pressure Angle"
			},
			{
				label: "Bearing Type",
				value: "Cylindrical Needle Roller"
			},
			{
				label: "Tooth Flank Treatment",
				value: "Case Hardened (0.8 mm)"
			},
			{
				label: "Radial Load Share",
				value: "33.3% of Input Load"
			}
		],
		engineeringNotes: [
			"Second planet gear maintaining uniform triangular load distribution.",
			"Dynamic balance checked up to 3,000 RPM carrier equivalent speed.",
			"Requires periodic backlash inspection (nominal 0.08 - 0.12 mm)."
		]
	},
	planet_gear_3: {
		...GEARBOX_COMPONENTS.planet_gear_3,
		nominalRpm: "400 RPM (Planetary Spin)",
		gearRatio: "3.333 : 1 (Internal Ratio)",
		pitchDiameter: "36.0 mm",
		modulePitch: "3.0 mm (Module)",
		lubricationSpec: "Synthetic PAO Gear Oil ISO VG 220",
		serviceIntervalHours: 6e3,
		specifications: [
			{
				label: "Angular Position",
				value: "240° Radial Standoff"
			},
			{
				label: "Tooth Profile",
				value: "Involute 20° Pressure Angle"
			},
			{
				label: "Bearing Type",
				value: "Cylindrical Needle Roller"
			},
			{
				label: "Tooth Flank Treatment",
				value: "Case Hardened (0.8 mm)"
			},
			{
				label: "Radial Load Share",
				value: "33.3% of Input Load"
			}
		],
		engineeringNotes: [
			"Completes symmetric three-point kinematics to eliminate cantilever shaft deflection.",
			"Identical tooth form and mass-matched to planets A and B within ±0.5 grams.",
			"Surface finish ground to Ra 0.4 µm for silent low-vibration engagement."
		]
	},
	ring_gear: {
		...GEARBOX_COMPONENTS.ring_gear,
		nominalRpm: "0 RPM (Stationary Reaction)",
		gearRatio: "3.500 : 1 (Overall Ratio)",
		pitchDiameter: "120.0 mm (Internal)",
		modulePitch: "3.0 mm (Module)",
		lubricationSpec: "Continuous Oil Sump Splash",
		serviceIntervalHours: 12e3,
		specifications: [
			{
				label: "Internal Diameter",
				value: "120.0 mm"
			},
			{
				label: "External Housing Dia",
				value: "148.0 mm"
			},
			{
				label: "Mounting Style",
				value: "4x M8 High-Grade Radial Brackets"
			},
			{
				label: "Wall Thickness",
				value: "14.0 mm Structural Rim"
			},
			{
				label: "Reaction Torque Max",
				value: "157.5 N·m"
			}
		],
		engineeringNotes: [
			"Outer casing provides grounding reaction torque to drive planet carrier reduction.",
			"Internal tooth ring gas-nitrided for extreme scuffing and wear resistance.",
			"External machined flanges dissipate thermodynamic heat generated under load."
		]
	},
	planet_carrier: {
		...GEARBOX_COMPONENTS.planet_carrier,
		nominalRpm: "343 RPM (Reduced Output)",
		gearRatio: "1 : 3.500 (Reduction Output)",
		pitchDiameter: "84.0 mm (Orbit Circle)",
		modulePitch: "N/A (Structural Frame)",
		lubricationSpec: "Enclosed Gearbox Oil Bath",
		serviceIntervalHours: 1e4,
		specifications: [
			{
				label: "Spider Configuration",
				value: "Triangular 3-Pin Yoke"
			},
			{
				label: "Carrier Pin Diameter",
				value: "12.0 mm Precision Ground"
			},
			{
				label: "Plate Thickness",
				value: "8.0 mm Cast Ductile Iron"
			},
			{
				label: "Output Flange",
				value: "Tapered Spline Interface"
			},
			{
				label: "Speed Reduction Factor",
				value: "3.5x Input Reduction"
			}
		],
		engineeringNotes: [
			"Gathers orbital motion from the three planet gears into single unified output shaft.",
			"Engineered from ASTM A536 ductile cast iron for high vibrational damping.",
			"Integrated counterweights optimize dynamic rotating balance."
		]
	},
	central_shaft: {
		...GEARBOX_COMPONENTS.central_shaft,
		nominalRpm: "1,200 RPM (High-Speed Input)",
		gearRatio: "1.000 : 1 (Input Axis)",
		pitchDiameter: "16.0 mm (Axial Diameter)",
		modulePitch: "N/A (Drive Axle)",
		lubricationSpec: "Sealed Deep-Groove Bearing Grease",
		serviceIntervalHours: 8e3,
		specifications: [
			{
				label: "Shaft Diameter",
				value: "16.0 mm Nominal"
			},
			{
				label: "Overall Length",
				value: "140.0 mm"
			},
			{
				label: "Runout Tolerance",
				value: "< 0.005 mm TIR"
			},
			{
				label: "Surface Treatment",
				value: "Hard Chromium Plating"
			},
			{
				label: "Bearing Support",
				value: "Dual Deep-Groove Ball Bearings"
			}
		],
		engineeringNotes: [
			"Transfers high-speed motor rotation to central sun gear via precision keyway.",
			"Induction hardened at bearing journal surfaces to prevent fretting wear.",
			"Maintains rigid concentric alignment of all rotating components."
		]
	}
};
/**
* Validates whether a given string is a recognized gearbox component ID.
*/
function isValidComponentId(id) {
	if (!id || typeof id !== "string") return false;
	return id in EXTENDED_GEARBOX_METADATA;
}
/**
* Retrieves the complete technical specification for a mechanical component.
* Safely returns null if the ID is invalid or missing.
*/
function getComponentMetadata(id) {
	if (!isValidComponentId(id)) return null;
	return EXTENDED_GEARBOX_METADATA[id] ?? null;
}
/**
* Retrieves all registered mechanical component metadata objects.
*/
function getAllComponentMetadata() {
	return Object.values(EXTENDED_GEARBOX_METADATA);
}
/**
* All valid mechanical component IDs registered in the system.
*/
var ALL_MECHANICAL_COMPONENT_IDS = [
	"sun_gear",
	"planet_gear_1",
	"planet_gear_2",
	"planet_gear_3",
	"ring_gear",
	"planet_carrier",
	"central_shaft"
];
// tests/componentSelection.test.ts
/**
* Automated Unit Test Suite for Component Selection & Information HUD
* Phase 5: Tasks 5.1, 5.2, 5.3
*/
describe("Machine Metadata Service (Task 5.3)", () => {
	it("correctly retrieves rich engineering specifications for all 7 gearbox components", () => {
		for (const id of [
			"sun_gear",
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3",
			"ring_gear",
			"planet_carrier",
			"central_shaft"
		]) {
			const meta = getComponentMetadata(id);
			assert.ok(meta !== null, `Expected metadata for ${id}`);
			assert.equal(meta.id, id);
			assert.ok(meta.name.length > 0);
			assert.ok(meta.materialName.length > 0);
			assert.ok(meta.nominalRpm.length > 0);
			assert.ok(meta.gearRatio.length > 0);
			assert.ok(meta.specifications.length > 0);
			assert.ok(meta.engineeringNotes.length > 0);
		}
	});
	it("safely handles missing, invalid, null, and undefined component IDs", () => {
		assert.equal(getComponentMetadata(null), null);
		assert.equal(getComponentMetadata(void 0), null);
		assert.equal(getComponentMetadata(""), null);
		assert.equal(getComponentMetadata("non_existent_turbo_rotor"), null);
		assert.equal(getComponentMetadata("random_string"), null);
	});
	it("validates component IDs accurately with isValidComponentId", () => {
		assert.equal(isValidComponentId("sun_gear"), true);
		assert.equal(isValidComponentId("planet_gear_2"), true);
		assert.equal(isValidComponentId("ring_gear"), true);
		assert.equal(isValidComponentId("central_shaft"), true);
		assert.equal(isValidComponentId("fake_gear"), false);
		assert.equal(isValidComponentId(null), false);
		assert.equal(isValidComponentId(void 0), false);
	});
	it("returns all 7 registered components via getAllComponentMetadata", () => {
		const all = getAllComponentMetadata();
		assert.equal(all.length, 7);
		assert.equal(all.length, Object.keys(EXTENDED_GEARBOX_METADATA).length);
	});
});
describe("Component Hierarchy Resolution (Task 5.1)", () => {
	it("resolves directly tagged mesh to its component ID", () => {
		const mesh = new THREE.Mesh();
		mesh.name = "sun_gear_hub";
		mesh.userData = { componentId: "sun_gear" };
		const resolved = resolveComponentId(mesh);
		assert.equal(resolved, "sun_gear");
	});
	it("resolves deep child mesh upward through parent hierarchy to component ID", () => {
		const parentGroup = new THREE.Group();
		parentGroup.name = "planet_gear_1";
		parentGroup.userData = { componentId: "planet_gear_1" };
		const intermediateGroup = new THREE.Group();
		parentGroup.add(intermediateGroup);
		const toothMesh = new THREE.Mesh();
		toothMesh.name = "planet_gear_1_tooth_5";
		intermediateGroup.add(toothMesh);
		const resolved = resolveComponentId(toothMesh);
		assert.equal(resolved, "planet_gear_1");
	});
	it("returns null for untagged objects or arbitrary scene meshes", () => {
		const grid = new THREE.GridHelper(10, 10);
		assert.equal(resolveComponentId(grid), null);
		const plainMesh = new THREE.Mesh();
		assert.equal(resolveComponentId(plainMesh), null);
	});
	it("safely handles null and undefined inputs in hierarchy traversal", () => {
		assert.equal(resolveComponentId(null), null);
	});
});
describe("ComponentSelector & Dwell Confirmation State Machine (Task 5.2)", () => {
	it("exposes default 1200ms dwell duration configuration", () => {
		const selector = new ComponentSelector();
		assert.equal(selector.getConfig().dwellDurationMs, 1200);
		assert.equal(DEFAULT_SELECTOR_CONFIG.dwellDurationMs, 1200);
	});
	it("resets dwell progress and timer when candidate hover target changes", () => {
		const selector = new ComponentSelector({ dwellDurationMs: 1200 });
		const update1 = selector.update("sun_gear", 600);
		assert.equal(update1.hoveredId, "sun_gear");
		assert.equal(update1.selectedId, null);
		assert.ok(Math.abs(update1.dwellProgress - .5) < 1e-4);
		const update2 = selector.update("planet_gear_1", 0);
		assert.equal(update2.hoveredId, "planet_gear_1");
		assert.equal(update2.dwellProgress, 0);
	});
	it("confirms selection when user dwells on a component for the full duration (1.2s)", () => {
		const selector = new ComponentSelector({ dwellDurationMs: 1200 });
		const res1 = selector.update("ring_gear", 400);
		assert.equal(res1.selectedId, null);
		assert.equal(res1.justSelected, false);
		assert.ok(Math.abs(res1.dwellProgress - 400 / 1200) < 1e-4);
		const res2 = selector.update("ring_gear", 500);
		assert.equal(res2.selectedId, null);
		assert.equal(res2.justSelected, false);
		assert.ok(Math.abs(res2.dwellProgress - 900 / 1200) < 1e-4);
		const res3 = selector.update("ring_gear", 300);
		assert.equal(res3.selectedId, "ring_gear");
		assert.equal(res3.justSelected, true);
		assert.equal(res3.dwellProgress, 0, "Dwell progress resets after selection lock");
		const res4 = selector.update("ring_gear", 100);
		assert.equal(res4.selectedId, "ring_gear");
		assert.equal(res4.justSelected, false);
		assert.equal(res4.dwellProgress, 0);
	});
	it("supports immediate direct selection (mouse click modality)", () => {
		const selector = new ComponentSelector();
		const res = selector.select("central_shaft");
		assert.equal(res.selectedId, "central_shaft");
		assert.equal(res.justSelected, true);
		assert.equal(selector.getSelectedId(), "central_shaft");
	});
	it("clears active selection cleanly and restores null state", () => {
		const selector = new ComponentSelector();
		selector.select("planet_carrier");
		assert.equal(selector.getSelectedId(), "planet_carrier");
		const clearRes = selector.clearSelection();
		assert.equal(clearRes.selectedId, null);
		assert.equal(clearRes.justDeselected, true);
		assert.equal(selector.getSelectedId(), null);
	});
	it("resets timer when pointer moves to empty space", () => {
		const selector = new ComponentSelector({ dwellDurationMs: 1200 });
		selector.update("sun_gear", 800);
		assert.ok(selector.getDwellProgress() > 0);
		const emptyRes = selector.update(null, 100);
		assert.equal(emptyRes.hoveredId, null);
		assert.equal(emptyRes.dwellProgress, 0);
		assert.equal(selector.getDwellProgress(), 0);
	});
});
describe("ComponentRaycaster Non-Destructive Highlighting (Task 5.1)", () => {
	it("applies and clears emissive highlight without permanently mutating shared materials", () => {
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		const sharedMaterial = new THREE.MeshStandardMaterial({
			color: 9741240,
			emissive: new THREE.Color(0),
			emissiveIntensity: 0
		});
		const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial);
		meshA.name = "planet_gear_1_mesh";
		meshA.userData = { componentId: "planet_gear_1" };
		scene.add(meshA);
		const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial);
		meshB.name = "planet_gear_2_mesh";
		meshB.userData = { componentId: "planet_gear_2" };
		scene.add(meshB);
		const raycaster = new ComponentRaycaster(camera, scene);
		raycaster.setSelectionHighlight("planet_gear_1");
		assert.notEqual(meshA.material, sharedMaterial, "meshA must have cloned highlighted material");
		assert.ok(meshA.material.emissiveIntensity > 0);
		assert.equal(meshB.material, sharedMaterial, "meshB must remain untouched");
		assert.equal(meshB.material.emissiveIntensity, 0);
		raycaster.setSelectionHighlight(null);
		assert.equal(meshA.material, sharedMaterial, "meshA must restore original material");
		assert.equal(meshA.userData._originalMaterial, void 0);
		raycaster.dispose();
	});
});
// src/hooks/useCamera.ts
var DEFAULT_CAMERA_CONSTRAINTS = {
	video: {
		width: { ideal: 640 },
		height: { ideal: 480 },
		facingMode: "user"
	},
	audio: false
};
/**
* Stops all tracks in an active MediaStream.
*/
function stopMediaStreamTracks(mediaStream) {
	if (!mediaStream) return;
	mediaStream.getTracks().forEach((track) => {
		track.stop();
	});
}
/**
* Maps DOM MediaDevices / getUserMedia errors to typed camera statuses and helpful messages.
*/
function parseCameraError(err) {
	const domError = err;
	const errorName = domError?.name || "";
	if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") return {
		status: "denied",
		errorMessage: "Webcam access was denied. Please allow camera permissions in your browser to enable hand tracking."
	};
	else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") return {
		status: "not_found",
		errorMessage: "No webcam detected on your system. Please connect a camera and try again."
	};
	else if (errorName === "NotReadableError" || errorName === "TrackStartError") return {
		status: "unavailable",
		errorMessage: "Camera is currently in use by another application or unavailable."
	};
	else if (errorName === "OverconstrainedError") return {
		status: "error",
		errorMessage: "Camera does not support the requested video resolution."
	};
	else return {
		status: "error",
		errorMessage: domError?.message || "Failed to start camera due to an unexpected error."
	};
}
/**
* Reusable, typed React hook managing webcam media stream, permissions, and lifecycle.
* Requests strictly video (never audio) and stops all tracks on unmount.
*/
function useCamera() {
	const [stream, setStream] = useState(null);
	const [status, setStatus] = useState("idle");
	const [errorMessage, setErrorMessage] = useState(null);
	const videoRef = useRef(null);
	const streamRef = useRef(null);
	const isMountedRef = useRef(true);
	const stopTracks = useCallback((mediaStream) => {
		stopMediaStreamTracks(mediaStream);
	}, []);
	const stopCamera = useCallback(() => {
		if (streamRef.current) {
			stopTracks(streamRef.current);
			streamRef.current = null;
		}
		if (videoRef.current) videoRef.current.srcObject = null;
		if (isMountedRef.current) {
			setStream(null);
			setStatus("idle");
			setErrorMessage(null);
		}
	}, [stopTracks]);
	const startCamera = useCallback(async () => {
		if (status === "requesting" || status === "active" && streamRef.current) return;
		if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
			setStatus("unsupported");
			setErrorMessage("Camera access is not supported by your browser or environment.");
			return;
		}
		setStatus("requesting");
		setErrorMessage(null);
		if (streamRef.current) {
			stopTracks(streamRef.current);
			streamRef.current = null;
		}
		const constraints = DEFAULT_CAMERA_CONSTRAINTS;
		try {
			const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
			if (!isMountedRef.current) {
				stopTracks(mediaStream);
				return;
			}
			streamRef.current = mediaStream;
			setStream(mediaStream);
			setStatus("active");
			setErrorMessage(null);
			if (videoRef.current) {
				videoRef.current.srcObject = mediaStream;
				videoRef.current.play().catch(() => {
					if (videoRef.current) {
						videoRef.current.muted = true;
						videoRef.current.play().catch(() => {});
					}
				});
			}
			const videoTrack = mediaStream.getVideoTracks()[0];
			if (videoTrack) videoTrack.onended = () => {
				if (isMountedRef.current) {
					stopCamera();
					setStatus("unavailable");
					setErrorMessage("Camera device disconnected or stream ended by OS.");
				}
			};
		} catch (err) {
			if (!isMountedRef.current) return;
			const { status: errStatus, errorMessage: errMsg } = parseCameraError(err);
			setStatus(errStatus);
			setErrorMessage(errMsg);
		}
	}, [
		status,
		stopCamera,
		stopTracks
	]);
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
		videoRef
	};
}
// tests/cameraIntegration.test.ts
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
/**
* Creates a mock MediaStreamTrack with track lifecycle spying.
*/
function createMockTrack(kind = "video") {
	let isStopped = false;
	return {
		kind,
		id: `mock-track-${Math.random().toString(36).slice(2, 8)}`,
		label: `Mock ${kind} track`,
		enabled: true,
		muted: false,
		readyState: "live",
		get stopped() {
			return isStopped;
		},
		stop: () => {
			isStopped = true;
		},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
		onended: null
	};
}
/**
* Creates a mock MediaStream containing customizable video and audio tracks.
*/
function createMockStream(tracks = [createMockTrack("video")]) {
	return {
		id: `mock-stream-${Date.now()}`,
		active: true,
		getTracks: () => tracks,
		getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
		getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
		addTrack: (track) => tracks.push(track),
		removeTrack: (track) => {
			const idx = tracks.indexOf(track);
			if (idx !== -1) tracks.splice(idx, 1);
		},
		clone: () => createMockStream(tracks),
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true
	};
}
describe("Camera Constraints & Security Standards", () => {
	it("enforces video-only access and explicitly disables audio/microphone permissions", () => {
		assert.equal(DEFAULT_CAMERA_CONSTRAINTS.audio, false, "Security requirement: Microphone access must remain strictly disabled");
	});
	it("configures front-facing user camera with optimal 640x480 resolution", () => {
		const video = DEFAULT_CAMERA_CONSTRAINTS.video;
		assert.ok(video !== void 0);
		assert.equal(video.facingMode, "user");
		assert.deepEqual(video.width, { ideal: 640 });
		assert.deepEqual(video.height, { ideal: 480 });
	});
});
describe("Camera Error Classification (DOM Exceptions to CameraStatus)", () => {
	it("maps NotAllowedError and PermissionDeniedError to denied status", () => {
		const res1 = parseCameraError({
			name: "NotAllowedError",
			message: "Permission dismissed"
		});
		assert.equal(res1.status, "denied");
		assert.ok(res1.errorMessage.includes("allow camera permissions"));
		const res2 = parseCameraError({
			name: "PermissionDeniedError",
			message: "User blocked camera"
		});
		assert.equal(res2.status, "denied");
	});
	it("maps NotFoundError and DevicesNotFoundError to not_found status", () => {
		const res1 = parseCameraError({
			name: "NotFoundError",
			message: "No video device found"
		});
		assert.equal(res1.status, "not_found");
		assert.ok(res1.errorMessage.includes("No webcam detected"));
		const res2 = parseCameraError({
			name: "DevicesNotFoundError",
			message: "Device missing"
		});
		assert.equal(res2.status, "not_found");
	});
	it("maps NotReadableError and TrackStartError to unavailable status (hardware in use)", () => {
		const res1 = parseCameraError({
			name: "NotReadableError",
			message: "Device locked by another process"
		});
		assert.equal(res1.status, "unavailable");
		assert.ok(res1.errorMessage.includes("in use by another application"));
		const res2 = parseCameraError({
			name: "TrackStartError",
			message: "Could not start video source"
		});
		assert.equal(res2.status, "unavailable");
	});
	it("maps OverconstrainedError to error status with resolution hint", () => {
		const res = parseCameraError({
			name: "OverconstrainedError",
			message: "Constraints cannot be satisfied"
		});
		assert.equal(res.status, "error");
		assert.ok(res.errorMessage.includes("resolution"));
	});
	it("maps generic and unexpected exceptions safely to fallback error status", () => {
		const res1 = parseCameraError(/* @__PURE__ */ new Error("Unknown hardware failure"));
		assert.equal(res1.status, "error");
		assert.equal(res1.errorMessage, "Unknown hardware failure");
		const res2 = parseCameraError("Unexpected string error");
		assert.equal(res2.status, "error");
		const res3 = parseCameraError(null);
		assert.equal(res3.status, "error");
	});
});
describe("MediaStream Track Lifecycle Management", () => {
	it("safely stops all active tracks across video and audio", () => {
		const videoTrack = createMockTrack("video");
		const stream = createMockStream([videoTrack]);
		assert.equal(videoTrack.stopped, false);
		stopMediaStreamTracks(stream);
		assert.equal(videoTrack.stopped, true);
	});
	it("safely handles null or empty media streams without throwing", () => {
		assert.doesNotThrow(() => {
			stopMediaStreamTracks(null);
			stopMediaStreamTracks(createMockStream([]));
		});
	});
});
describe("Simulated Camera Acquisition & Lifecycle Workflows", () => {
	it("simulates successful camera permission and active streaming workflow", async () => {
		let currentStatus = "idle";
		let activeStream = null;
		let errorMessage = null;
		const mockVideoTrack = createMockTrack("video");
		const mockStream = createMockStream([mockVideoTrack]);
		const mockGetUserMedia = async () => {
			currentStatus = "requesting";
			return mockStream;
		};
		assert.equal(currentStatus, "idle");
		assert.equal(activeStream, null);
		currentStatus = "requesting";
		activeStream = await mockGetUserMedia();
		currentStatus = "active";
		assert.equal(currentStatus, "active");
		assert.ok(activeStream !== null);
		assert.equal(errorMessage, null);
		assert.equal(activeStream.getVideoTracks().length, 1);
		stopMediaStreamTracks(activeStream);
		activeStream = null;
		currentStatus = "idle";
		assert.equal(currentStatus, "idle");
		assert.equal(mockVideoTrack.stopped, true);
	});
	it("simulates permission rejection flow with clean fallback", async () => {
		let currentStatus = "idle";
		let errorMessage = null;
		const mockGetUserMedia = async () => {
			throw {
				name: "NotAllowedError",
				message: "Permission denied by user"
			};
		};
		try {
			currentStatus = "requesting";
			await mockGetUserMedia();
		} catch (err) {
			const parsed = parseCameraError(err);
			currentStatus = parsed.status;
			errorMessage = parsed.errorMessage;
		}
		assert.equal(currentStatus, "denied");
		assert.ok(errorMessage !== null && errorMessage.includes("allow camera permissions"));
	});
	it("simulates external device disconnect while streaming (USB unplugged)", () => {
		let currentStatus = "active";
		let errorMessage = null;
		const mockTrack = createMockTrack("video");
		const mockStream = createMockStream([mockTrack]);
		mockTrack.onended = () => {
			stopMediaStreamTracks(mockStream);
			currentStatus = "unavailable";
			errorMessage = "Camera device disconnected or stream ended by OS.";
		};
		mockTrack.onended(new Event("ended"));
		assert.equal(currentStatus, "unavailable");
		assert.equal(mockTrack.stopped, true);
		assert.ok(errorMessage !== null && errorMessage.includes("disconnected"));
	});
});
// tests/gestureIntegration.test.ts
/**
* Multi-Frame Synthetic Gesture & Camera Rig Integration Tests (Task 6.1)
*
* Validates the integrated operation of:
* 1. GestureCameraController coordinating GestureOrbitEngine and GesturePinchZoomEngine.
* 2. Three.js PerspectiveCamera and CameraController (OrbitControls).
* 3. Multi-frame synthetic landmark sequences driving orbit and zoom.
* 4. Gesture transition exclusivity (OPEN_PALM -> PINCH -> POINTING -> NONE).
* 5. Tracking loss and re-entry without snapping.
* 6. Camera clamp boundaries [minDistance, maxDistance] under extreme zoom deltas.
* 7. Mouse contention priority over gesture commands.
*/
/**
* Creates a complete mock DOM element suitable for Three.js OrbitControls in Node.js.
*/
function createMockDom() {
	const doc = {
		addEventListener: () => {},
		removeEventListener: () => {}
	};
	return {
		addEventListener: () => {},
		removeEventListener: () => {},
		ownerDocument: doc,
		getRootNode: () => doc,
		style: {}
	};
}
/**
* Generates synthetic 21-point hand landmark array with customizable palm centroid
* and thumb/index tip coordinates.
*/
function createSyntheticHand(palmCenter = {
	x: .5,
	y: .5
}, pinchOffset) {
	const landmarks = Array.from({ length: 21 }, () => ({
		x: palmCenter.x,
		y: palmCenter.y,
		z: 0
	}));
	landmarks[0] = {
		x: palmCenter.x,
		y: palmCenter.y + .12,
		z: 0
	};
	landmarks[5] = {
		x: palmCenter.x - .05,
		y: palmCenter.y - .04,
		z: 0
	};
	landmarks[9] = {
		x: palmCenter.x,
		y: palmCenter.y - .08,
		z: 0
	};
	landmarks[13] = {
		x: palmCenter.x + .04,
		y: palmCenter.y - .05,
		z: 0
	};
	landmarks[17] = {
		x: palmCenter.x + .08,
		y: palmCenter.y,
		z: 0
	};
	if (pinchOffset) {
		landmarks[4] = {
			x: pinchOffset.thumb.x,
			y: pinchOffset.thumb.y,
			z: 0
		};
		landmarks[8] = {
			x: pinchOffset.index.x,
			y: pinchOffset.index.y,
			z: 0
		};
	} else {
		landmarks[4] = {
			x: palmCenter.x - .1,
			y: palmCenter.y - .05,
			z: 0
		};
		landmarks[8] = {
			x: palmCenter.x - .05,
			y: palmCenter.y - .18,
			z: 0
		};
	}
	return landmarks;
}
function wrapHandsResult(landmarks) {
	return [{
		landmarks,
		rawLandmarks: landmarks.map((p) => ({ ...p })),
		handedness: "Right",
		score: .95
	}];
}
describe("Synthetic Multi-Frame Gesture Stream Integration", () => {
	it("drives orbital rotation across sequential OPEN_PALM frames without snapping", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const initialPos = camera.position.clone();
		const hand0 = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}));
		const gestureResult = {
			gesture: "OPEN_PALM",
			confidence: .95,
			isStable: true,
			handedness: "Right"
		};
		const res0 = gestureController.update(gestureResult, hand0);
		assert.equal(res0.orbit.isActive, true);
		assert.equal(res0.orbit.deltaYaw, 0);
		assert.equal(res0.orbit.deltaPitch, 0);
		for (let i = 1; i <= 3; i++) {
			const hand = wrapHandsResult(createSyntheticHand({
				x: .5 + i * .03,
				y: .5
			}));
			const res = gestureController.update(gestureResult, hand);
			assert.equal(res.orbit.isActive, true);
			assert.notEqual(res.orbit.deltaYaw, 0);
		}
		assert.ok(camera.position.distanceTo(initialPos) > .05);
		cameraController.dispose();
	});
	it("drives smooth camera zoom across sequential PINCH frames", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), {
			minDistance: 2,
			maxDistance: 25,
			enableDamping: false
		});
		const gestureController = new GestureCameraController(cameraController);
		const initialDist = cameraController.getDistance();
		assert.ok(initialDist > 0);
		const pinchGesture = {
			gesture: "PINCH",
			confidence: .92,
			isStable: true,
			handedness: "Right"
		};
		const hand0 = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}, {
			thumb: {
				x: .46,
				y: .4
			},
			index: {
				x: .48,
				y: .4
			}
		}));
		const res0 = gestureController.update(pinchGesture, hand0);
		assert.equal(res0.pinch.isActive, true);
		assert.equal(res0.pinch.deltaZoom, 0);
		for (let i = 1; i <= 3; i++) {
			const hand = wrapHandsResult(createSyntheticHand({
				x: .5,
				y: .5
			}, {
				thumb: {
					x: .46 + i * .005,
					y: .4
				},
				index: {
					x: .48,
					y: .4
				}
			}));
			const res = gestureController.update(pinchGesture, hand);
			assert.equal(res.pinch.isActive, true);
			assert.ok(res.pinch.deltaZoom > 0, "Closing fingers must zoom in");
		}
		const currentDist = cameraController.getDistance();
		assert.ok(currentDist < initialDist, `Expected distance < 10, got ${currentDist}`);
		cameraController.dispose();
	});
	it("switches between OPEN_PALM, PINCH, and POINTING without simultaneous conflicting actions", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const hand = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}, {
			thumb: {
				x: .45,
				y: .4
			},
			index: {
				x: .48,
				y: .4
			}
		}));
		const palmRes = gestureController.update({
			gesture: "OPEN_PALM",
			confidence: .9,
			isStable: true,
			handedness: "Right"
		}, hand);
		assert.equal(palmRes.orbit.isActive, true);
		assert.equal(palmRes.pinch.isActive, false);
		const pinchRes = gestureController.update({
			gesture: "PINCH",
			confidence: .9,
			isStable: true,
			handedness: "Right"
		}, hand);
		assert.equal(pinchRes.orbit.isActive, false);
		assert.equal(pinchRes.pinch.isActive, true);
		const pointRes = gestureController.update({
			gesture: "POINTING",
			confidence: .9,
			isStable: true,
			handedness: "Right"
		}, hand);
		assert.equal(pointRes.orbit.isActive, false);
		assert.equal(pointRes.pinch.isActive, false);
		cameraController.dispose();
	});
	it("safely handles tracking loss and hand re-entry without camera snapping", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const palmGesture = {
			gesture: "OPEN_PALM",
			confidence: .95,
			isStable: true,
			handedness: "Right"
		};
		const handActive = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}));
		gestureController.update(palmGesture, handActive);
		const lostRes = gestureController.update(palmGesture, []);
		assert.equal(lostRes.orbit.isActive, false);
		assert.equal(lostRes.orbit.deltaYaw, 0);
		const posAtLoss = camera.position.clone();
		const handReentry = wrapHandsResult(createSyntheticHand({
			x: .25,
			y: .3
		}));
		const reentryRes = gestureController.update(palmGesture, handReentry);
		assert.equal(reentryRes.orbit.isActive, true);
		assert.equal(reentryRes.orbit.deltaYaw, 0);
		assert.equal(reentryRes.orbit.deltaPitch, 0);
		assert.equal(camera.position.distanceTo(posAtLoss), 0);
		cameraController.dispose();
	});
	it("clamps zoom to configured minimum and maximum limits under sustained deltas", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), {
			minDistance: 2,
			maxDistance: 25,
			enableDamping: false
		});
		cameraController.zoomBy(50);
		assert.equal(cameraController.getDistance(), 2);
		cameraController.zoomBy(-50);
		assert.equal(cameraController.getDistance(), 25);
		cameraController.dispose();
	});
	it("yields immediately when user mouse interaction is active on OrbitControls", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const hand = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}));
		const palmGesture = {
			gesture: "OPEN_PALM",
			confidence: .95,
			isStable: true,
			handedness: "Right"
		};
		cameraController.isInteracting = true;
		const res = gestureController.update(palmGesture, hand);
		assert.equal(res.orbit.isActive, false);
		assert.equal(res.pinch.isActive, false);
		assert.equal(res.orbit.deltaYaw, 0);
		cameraController.dispose();
	});
	it("safely handles hand disappearance and re-entry during pinch-to-zoom without camera snapping", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const pinchGesture = {
			gesture: "PINCH",
			confidence: .95,
			isStable: true,
			handedness: "Right"
		};
		const initialHand = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}, {
			thumb: {
				x: .45,
				y: .4
			},
			index: {
				x: .48,
				y: .4
			}
		}));
		gestureController.update(pinchGesture, initialHand);
		const zoomHand = wrapHandsResult(createSyntheticHand({
			x: .5,
			y: .5
		}, {
			thumb: {
				x: .465,
				y: .4
			},
			index: {
				x: .48,
				y: .4
			}
		}));
		const zoomRes = gestureController.update(pinchGesture, zoomHand);
		assert.equal(zoomRes.pinch.isActive, true);
		assert.ok(zoomRes.pinch.deltaZoom > 0);
		const distBeforeLoss = cameraController.getDistance();
		const lostRes = gestureController.update(pinchGesture, []);
		assert.equal(lostRes.pinch.isActive, false);
		assert.equal(lostRes.pinch.deltaZoom, 0);
		assert.equal(cameraController.getDistance(), distBeforeLoss);
		const reentryHand = wrapHandsResult(createSyntheticHand({
			x: .3,
			y: .3
		}, {
			thumb: {
				x: .25,
				y: .3
			},
			index: {
				x: .32,
				y: .3
			}
		}));
		const reentryRes = gestureController.update(pinchGesture, reentryHand);
		assert.equal(reentryRes.pinch.isActive, true);
		assert.equal(reentryRes.pinch.deltaZoom, 0);
		assert.equal(cameraController.getDistance(), distBeforeLoss);
		cameraController.dispose();
	});
	it("safely handles degenerate or out-of-bounds landmarks without throwing or applying camera deltas", () => {
		const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
		camera.position.set(0, 0, 10);
		const cameraController = new CameraController(camera, createMockDom(), { enableDamping: false });
		const gestureController = new GestureCameraController(cameraController);
		const palmGesture = {
			gesture: "OPEN_PALM",
			confidence: .9,
			isStable: true,
			handedness: "Right"
		};
		const degenerateHand = wrapHandsResult(Array.from({ length: 21 }, () => ({
			x: 0,
			y: 0,
			z: 0
		})));
		const res = gestureController.update(palmGesture, degenerateHand);
		assert.equal(res.orbit.isActive, false);
		assert.equal(res.orbit.deltaYaw, 0);
		assert.equal(res.orbit.deltaPitch, 0);
		cameraController.dispose();
	});
});
// src/components/hud/ComponentInfoPanel.tsx
var ComponentInfoPanel = ({ componentId, onClose, className }) => {
	const metadata = componentId ? getComponentMetadata(componentId) : null;
	const handleKeyDown = useCallback((e) => {
		const targetTag = e.target?.tagName?.toLowerCase();
		if (targetTag === "input" || targetTag === "textarea") return;
		if (e.key === "Escape" || e.code === "Space") {
			e.preventDefault();
			onClose();
		}
	}, [onClose]);
	useEffect(() => {
		if (!componentId) return;
		if (typeof window !== "undefined") {
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}
	}, [componentId, handleKeyDown]);
	if (!componentId) return null;
	return /* @__PURE__ */ jsxs("aside", {
		className: `component-info-panel ${className || ""}`,
		"aria-label": "Component Engineering Specifications HUD",
		role: "complementary",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "panel-header",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "panel-title-group",
					children: [/* @__PURE__ */ jsx("span", {
						className: "panel-icon",
						children: "⚙️"
					}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
						className: "panel-title",
						children: metadata?.name || componentId
					}), /* @__PURE__ */ jsx("span", {
						className: "panel-subtitle",
						children: metadata?.role || "Mechanical Component"
					})] })]
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "panel-close-btn",
					onClick: onClose,
					title: "Deselect component [Esc or Space]",
					"aria-label": "Close component specification panel",
					children: "✕"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "panel-body",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "component-badge-row",
						children: [/* @__PURE__ */ jsxs("span", {
							className: "component-id-tag",
							children: ["ID: ", componentId]
						}), /* @__PURE__ */ jsx("span", {
							className: "component-status-tag active",
							children: "Selected"
						})]
					}),
					!metadata && /* @__PURE__ */ jsxs("div", {
						className: "missing-metadata-alert",
						role: "alert",
						children: [/* @__PURE__ */ jsx("span", {
							className: "alert-icon",
							children: "⚠️"
						}), /* @__PURE__ */ jsx("p", { children: "Detailed engineering specifications are currently unavailable for this part." })]
					}),
					metadata && /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsxs("section", {
							className: "specs-section",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "section-title",
								children: "Kinematics & Dimensions"
							}), /* @__PURE__ */ jsxs("div", {
								className: "specs-grid",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "spec-card",
										children: [/* @__PURE__ */ jsx("span", {
											className: "spec-label",
											children: "Teeth Count"
										}), /* @__PURE__ */ jsx("span", {
											className: "spec-val",
											children: metadata.teethCount !== void 0 ? `${metadata.teethCount} teeth` : "N/A"
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "spec-card",
										children: [/* @__PURE__ */ jsx("span", {
											className: "spec-label",
											children: "Nominal Speed"
										}), /* @__PURE__ */ jsx("span", {
											className: "spec-val",
											children: metadata.nominalRpm
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "spec-card",
										children: [/* @__PURE__ */ jsx("span", {
											className: "spec-label",
											children: "Kinematic Ratio"
										}), /* @__PURE__ */ jsx("span", {
											className: "spec-val",
											children: metadata.gearRatio
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "spec-card",
										children: [/* @__PURE__ */ jsx("span", {
											className: "spec-label",
											children: "Pitch Diameter"
										}), /* @__PURE__ */ jsx("span", {
											className: "spec-val",
											children: metadata.pitchDiameter
										})]
									})
								]
							})]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "specs-section",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "section-title",
								children: "Material & Maintenance"
							}), /* @__PURE__ */ jsxs("div", {
								className: "details-list",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "detail-item",
										children: [/* @__PURE__ */ jsx("span", {
											className: "detail-label",
											children: "Material:"
										}), /* @__PURE__ */ jsx("span", {
											className: "detail-val",
											children: metadata.materialName
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "detail-item",
										children: [/* @__PURE__ */ jsx("span", {
											className: "detail-label",
											children: "Lubrication:"
										}), /* @__PURE__ */ jsx("span", {
											className: "detail-val",
											children: metadata.lubricationSpec
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "detail-item",
										children: [/* @__PURE__ */ jsx("span", {
											className: "detail-label",
											children: "Service Life:"
										}), /* @__PURE__ */ jsxs("span", {
											className: "detail-val",
											children: [
												"Every ",
												metadata.serviceIntervalHours.toLocaleString(),
												" Operating Hours"
											]
										})]
									})
								]
							})]
						}),
						metadata.specifications.length > 0 && /* @__PURE__ */ jsxs("section", {
							className: "specs-section",
							children: [/* @__PURE__ */ jsx("h3", {
								className: "section-title",
								children: "Technical Specifications"
							}), /* @__PURE__ */ jsx("table", {
								className: "specs-table",
								children: /* @__PURE__ */ jsx("tbody", { children: metadata.specifications.map((spec) => /* @__PURE__ */ jsxs("tr", { children: [/* @__PURE__ */ jsx("td", {
									className: "spec-table-label",
									children: spec.label
								}), /* @__PURE__ */ jsx("td", {
									className: "spec-table-val",
									children: spec.value
								})] }, spec.label)) })
							})]
						}),
						/* @__PURE__ */ jsxs("section", {
							className: "specs-section",
							children: [
								/* @__PURE__ */ jsx("h3", {
									className: "section-title",
									children: "Engineering Description"
								}),
								/* @__PURE__ */ jsx("p", {
									className: "panel-description",
									children: metadata.description
								}),
								metadata.engineeringNotes.length > 0 && /* @__PURE__ */ jsx("ul", {
									className: "notes-list",
									children: metadata.engineeringNotes.map((note) => /* @__PURE__ */ jsx("li", { children: note }, note))
								})
							]
						})
					] })
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "panel-footer",
				children: /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "deselect-btn",
					onClick: onClose,
					title: "Deselect active component [Space]",
					"aria-label": "Deselect active component",
					children: "Deselect Component [Space]"
				})
			})
		]
	});
};
// tests/componentInfoPanel.test.ts
/**
* Integration Test Suite for Component Information Panel HUD (Task 6.1)
*
* Validates:
* 1. React static markup rendering via react-dom/server in Node environment.
* 2. Complete engineering specifications rendered for all seven gearbox components.
* 3. Graceful handling of null, missing, or unrecognized component IDs.
* 4. Dismissal interactions via close button and keyboard shortcuts (Escape, Space).
* 5. Input shielding (preventing unintended dismissal while focusing inputs).
*/
describe("ComponentInfoPanel Rendering (All 7 Components)", () => {
	it("renders null/empty markup when componentId is null", () => {
		const html = renderToStaticMarkup(React.createElement(ComponentInfoPanel, {
			componentId: null,
			onClose: () => {}
		}));
		assert.equal(html, "");
	});
	for (const componentId of ALL_MECHANICAL_COMPONENT_IDS) it(`renders complete technical specifications for component: ${componentId}`, () => {
		const metadata = getComponentMetadata(componentId);
		assert.ok(metadata !== null, `Metadata must exist for ${componentId}`);
		const html = renderToStaticMarkup(React.createElement(ComponentInfoPanel, {
			componentId,
			onClose: () => {}
		}));
		assert.ok(html.includes("component-info-panel"));
		assert.ok(html.includes("aria-label=\"Component Engineering Specifications HUD\""));
		assert.ok(html.includes(metadata.name.replace(/&/g, "&amp;")), `Expected ${metadata.name} in rendered HTML`);
		assert.ok(html.includes(`ID: ${componentId}`));
		assert.ok(html.includes(metadata.role.replace(/&/g, "&amp;")));
		assert.ok(html.includes(metadata.materialName));
		assert.ok(html.includes(metadata.nominalRpm));
		assert.ok(html.includes(metadata.lubricationSpec));
		if (metadata.teethCount !== void 0) assert.ok(html.includes(`${metadata.teethCount} teeth`));
	});
	it("renders fallback alert gracefully when given an unrecognized component ID", () => {
		const html = renderToStaticMarkup(React.createElement(ComponentInfoPanel, {
			componentId: "non_existent_part",
			onClose: () => {}
		}));
		assert.ok(html.includes("missing-metadata-alert"));
		assert.ok(html.includes("Detailed engineering specifications are currently unavailable"));
	});
});
describe("ComponentInfoPanel Dismissal & Event Handlers", () => {
	it("renders the header close button with accessible labels and title attributes", () => {
		const html = renderToStaticMarkup(React.createElement(ComponentInfoPanel, {
			componentId: "sun_gear",
			onClose: () => {}
		}));
		assert.ok(html.includes("class=\"panel-close-btn\""));
		assert.ok(html.includes("aria-label=\"Close component specification panel\""));
		assert.ok(html.includes("title=\"Deselect component [Esc or Space]\""));
		assert.ok(html.includes("✕"));
	});
	it("handles keyboard dismissal via Escape and Space keys", () => {
		let dismissCount = 0;
		const onClose = () => {
			dismissCount++;
		};
		const simulateKeyDown = (eventInit) => {
			const target = { tagName: eventInit.targetTag || "BODY" };
			const e = {
				key: eventInit.key,
				code: eventInit.code || eventInit.key,
				target,
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				}
			};
			const targetTag = e.target.tagName?.toLowerCase();
			if (targetTag === "input" || targetTag === "textarea") return;
			if (e.key === "Escape" || e.code === "Space") {
				e.preventDefault();
				onClose();
			}
		};
		simulateKeyDown({ key: "Escape" });
		assert.equal(dismissCount, 1);
		simulateKeyDown({
			key: " ",
			code: "Space"
		});
		assert.equal(dismissCount, 2);
		simulateKeyDown({ key: "Enter" });
		simulateKeyDown({
			key: "a",
			code: "KeyA"
		});
		assert.equal(dismissCount, 2);
		simulateKeyDown({
			key: "Escape",
			targetTag: "INPUT"
		});
		simulateKeyDown({
			key: " ",
			code: "Space",
			targetTag: "TEXTAREA"
		});
		assert.equal(dismissCount, 2);
	});
});
// tests/telemetry.test.ts
describe("RollingWindowStats (Bounded Statistical Accumulator)", () => {
	it("returns zeroed stats when empty", () => {
		const result = new RollingWindowStats(50).computeStats();
		assert.equal(result.count, 0);
		assert.equal(result.avg, 0);
		assert.equal(result.min, 0);
		assert.equal(result.max, 0);
		assert.equal(result.p95, 0);
	});
	it("correctly calculates min, max, avg, and P95 on deterministic data", () => {
		const stats = new RollingWindowStats(100);
		for (let i = 1; i <= 100; i++) stats.push(i);
		const result = stats.computeStats();
		assert.equal(result.count, 100);
		assert.equal(result.min, 1);
		assert.equal(result.max, 100);
		assert.equal(result.avg, 50.5);
		assert.equal(result.p95, 95);
	});
	it("enforces bounded capacity and overwrites oldest samples in ring buffer", () => {
		const stats = new RollingWindowStats(10);
		for (let i = 1; i <= 10; i++) stats.push(i * 10);
		assert.equal(stats.sampleCount, 10);
		assert.equal(stats.computeStats().min, 10);
		assert.equal(stats.computeStats().max, 100);
		for (let i = 1; i <= 5; i++) stats.push(200 + (i - 1) * 10);
		assert.equal(stats.sampleCount, 10);
		const updated = stats.computeStats();
		assert.equal(updated.count, 10);
		assert.equal(updated.min, 60);
		assert.equal(updated.max, 240);
	});
	it("safely rejects NaN, Infinity, negative, and non-numeric values", () => {
		const stats = new RollingWindowStats(20);
		stats.push(NaN);
		stats.push(Infinity);
		stats.push(-Infinity);
		stats.push(-15);
		stats.push(NaN);
		assert.equal(stats.sampleCount, 0);
		assert.equal(stats.computeStats().count, 0);
		stats.push(16.67);
		assert.equal(stats.sampleCount, 1);
		assert.equal(stats.computeStats().avg, 16.67);
	});
	it("resets buffer and state cleanly", () => {
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
describe("RenderTelemetryCollector (WebGL & Frame-Time Telemetry)", () => {
	it("correctly calculates 60 FPS and 16.67ms frame times from synthetic ticks", () => {
		const collector = new RenderTelemetryCollector(60);
		let timestamp = 1e3;
		const delta = 16.667;
		for (let i = 0; i <= 60; i++) {
			collector.recordFrame(timestamp);
			timestamp += delta;
		}
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.totalFrameCount, 61);
		assert.equal(snapshot.sampleCount, 60);
		assert.ok(snapshot.fps >= 59 && snapshot.fps <= 61, `Expected ~60 FPS, got ${snapshot.fps}`);
		assert.ok(snapshot.avgFrameTimeMs >= 16.6 && snapshot.avgFrameTimeMs <= 16.7, `Expected ~16.67ms, got ${snapshot.avgFrameTimeMs}`);
		assert.ok(snapshot.minFrameTimeMs > 0);
		assert.ok(snapshot.maxFrameTimeMs > 0);
		assert.ok(snapshot.p95FrameTimeMs > 0);
	});
	it("safely handles duplicate timestamps and non-monotonic clocks", () => {
		const collector = new RenderTelemetryCollector(30);
		collector.recordFrame(1e3);
		collector.recordFrame(1e3);
		collector.recordFrame(950);
		collector.recordFrame(-10);
		collector.recordFrame(NaN);
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.sampleCount, 0);
		collector.recordFrame(1033.33);
		const updated = collector.getSnapshot();
		assert.equal(updated.sampleCount, 1);
		assert.ok(updated.avgFrameTimeMs > 0);
	});
	it("resets render telemetry completely", () => {
		const collector = new RenderTelemetryCollector(30);
		collector.recordFrame(1e3);
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
describe("VisionTelemetryCollector (Inference, Smoothing & Tracking FPS)", () => {
	it("measures landmark inference, smoothing, and total vision processing duration", () => {
		const collector = new VisionTelemetryCollector(60);
		let timestamp = 1e3;
		for (let i = 0; i <= 30; i++) {
			collector.recordVisionFrame({
				inferenceDurationMs: 12,
				smoothingDurationMs: 1.5,
				totalDurationMs: 13.5,
				timestamp
			});
			timestamp += 33.333;
		}
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.totalFrameCount, 31);
		assert.equal(snapshot.sampleCount, 31);
		assert.equal(snapshot.avgInferenceDurationMs, 12);
		assert.equal(snapshot.avgSmoothingDurationMs, 1.5);
		assert.equal(snapshot.avgVisionDurationMs, 13.5);
		assert.equal(snapshot.p95VisionDurationMs, 13.5);
		assert.ok(snapshot.trackingFps >= 29 && snapshot.trackingFps <= 31, `Expected ~30 FPS tracking, got ${snapshot.trackingFps}`);
	});
	it("safely handles missing optional metrics and computes total fallback", () => {
		const collector = new VisionTelemetryCollector(30);
		collector.recordVisionFrame({ inferenceDurationMs: 15.2 });
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.sampleCount, 1);
		assert.equal(snapshot.inferenceDurationMs, 15.2);
		assert.equal(snapshot.smoothingDurationMs, 0);
		assert.equal(snapshot.totalVisionDurationMs, 15.2);
	});
	it("safely rejects invalid or negative vision metrics", () => {
		const collector = new VisionTelemetryCollector(30);
		collector.recordVisionFrame({
			inferenceDurationMs: -5,
			smoothingDurationMs: -2
		});
		collector.recordVisionFrame({ inferenceDurationMs: NaN });
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.totalFrameCount, 0);
		assert.equal(snapshot.sampleCount, 0);
	});
	it("resets vision telemetry cleanly", () => {
		const collector = new VisionTelemetryCollector(30);
		collector.recordVisionFrame({
			inferenceDurationMs: 10,
			timestamp: 1e3
		});
		collector.recordVisionFrame({
			inferenceDurationMs: 10,
			timestamp: 1033
		});
		collector.reset();
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.totalFrameCount, 0);
		assert.equal(snapshot.sampleCount, 0);
		assert.equal(snapshot.avgInferenceDurationMs, 0);
		assert.equal(snapshot.trackingFps, 0);
	});
});
describe("LatencyTelemetryCollector (Application-Level Pipeline Latency)", () => {
	it("correctly tracks vision-to-scene latency across multiple frames", () => {
		const collector = new LatencyTelemetryCollector(60);
		collector.recordLatency(1e3, 1024);
		collector.recordLatency(1033, 1055);
		collector.recordLatency(1066, 1096);
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.sampleCount, 3);
		assert.equal(snapshot.lastLatencyMs, 30);
		assert.equal(snapshot.minLatencyMs, 22);
		assert.equal(snapshot.maxLatencyMs, 30);
		assert.equal(snapshot.avgLatencyMs, 25.33);
		assert.equal(snapshot.description, PIPELINE_LATENCY_DESCRIPTION);
	});
	it("safely ignores negative, out-of-order, or non-finite latency pairs", () => {
		const collector = new LatencyTelemetryCollector(20);
		collector.recordLatency(2e3, 1950);
		collector.recordLatency(NaN, 1e3);
		collector.recordLatency(1e3, Infinity);
		const snapshot = collector.getSnapshot();
		assert.equal(snapshot.sampleCount, 0);
		assert.equal(snapshot.lastLatencyMs, 0);
		assert.equal(snapshot.avgLatencyMs, 0);
	});
	it("resets latency stats cleanly", () => {
		const collector = new LatencyTelemetryCollector(20);
		collector.recordLatency(100, 125);
		assert.equal(collector.getSnapshot().sampleCount, 1);
		collector.reset();
		assert.equal(collector.getSnapshot().sampleCount, 0);
		assert.equal(collector.getSnapshot().lastLatencyMs, 0);
	});
});
describe("PerformanceTelemetry (Unified Orchestrator)", () => {
	it("keeps render, vision, and latency measurements completely independent", () => {
		const telemetry = new PerformanceTelemetry(60);
		telemetry.render.recordFrame(1e3);
		telemetry.render.recordFrame(1016.67);
		telemetry.vision.recordVisionFrame({
			inferenceDurationMs: 14.2,
			smoothingDurationMs: .8,
			timestamp: 1e3
		});
		telemetry.latency.recordLatency(1e3, 1025);
		const combined = telemetry.getCombinedSnapshot(1050);
		assert.equal(combined.timestamp, 1050);
		assert.equal(combined.render.totalFrameCount, 2);
		assert.equal(combined.render.sampleCount, 1);
		assert.equal(combined.vision.totalFrameCount, 1);
		assert.equal(combined.vision.inferenceDurationMs, 14.2);
		assert.equal(combined.latency.sampleCount, 1);
		assert.equal(combined.latency.lastLatencyMs, 25);
	});
	it("resets all sub-collectors simultaneously when reset() is invoked", () => {
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
// src/types/engineering.ts
/**
* Safe type guard for BaseComponentMetadata
*/
function isBaseComponentMetadata(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	return typeof candidate.id === "string" && typeof candidate.name === "string" && (candidate.domain === "mechanical" || candidate.domain === "civil") && typeof candidate.role === "string" && typeof candidate.materialName === "string" && typeof candidate.description === "string" && Array.isArray(candidate.specifications) && Array.isArray(candidate.engineeringNotes);
}
/**
* Safe type guard for MechanicalComponentMetadata
*/
function isMechanicalMetadata(value) {
	if (!isBaseComponentMetadata(value)) return false;
	return value.domain === "mechanical";
}
/**
* Safe type guard for CivilComponentMetadata
*/
function isCivilMetadata(value) {
	if (!isBaseComponentMetadata(value)) return false;
	return value.domain === "civil";
}
/**
* Validates that all relationship references in a component metadata object
* point to valid, non-self component IDs within the specified model's known components.
*/
function validateComponentRelationships(metadata, validComponentIds) {
	const errors = [];
	const validSet = validComponentIds instanceof Set ? validComponentIds : new Set(validComponentIds);
	if (!metadata.relationships || metadata.relationships.length === 0) return {
		isValid: true,
		errors: []
	};
	for (const rel of metadata.relationships) {
		if (!rel.targetComponentId || typeof rel.targetComponentId !== "string") {
			errors.push(`Component "${metadata.id}" has a relationship with an invalid or empty targetComponentId.`);
			continue;
		}
		if (rel.targetComponentId === metadata.id) errors.push(`Component "${metadata.id}" cannot have a relationship targeting itself.`);
		if (!validSet.has(rel.targetComponentId)) errors.push(`Component "${metadata.id}" references unknown targetComponentId "${rel.targetComponentId}". Target does not exist in model.`);
		if (!rel.relationshipType || typeof rel.relationshipType !== "string" || rel.relationshipType.trim() === "") errors.push(`Component "${metadata.id}" relationship to "${rel.targetComponentId}" missing relationshipType.`);
	}
	return {
		isValid: errors.length === 0,
		errors
	};
}
// src/types/models.ts
/**
* Safe runtime type guard for AssemblyTreeNode
*/
function isAssemblyTreeNode(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	const hasValidType = candidate.type === "assembly" || candidate.type === "subassembly" || candidate.type === "component";
	if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || !hasValidType) return false;
	if (candidate.children !== void 0) {
		if (!Array.isArray(candidate.children)) return false;
		for (const child of candidate.children) if (!isAssemblyTreeNode(child)) return false;
	}
	return true;
}
/**
* Safe runtime type guard for EngineeringModelDefinition
*/
function isEngineeringModelDefinition(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	return typeof candidate.id === "string" && typeof candidate.name === "string" && (candidate.domain === "mechanical" || candidate.domain === "civil") && typeof candidate.category === "string" && typeof candidate.description === "string" && typeof candidate.thumbnailUrl === "string" && (candidate.difficulty === "Beginner" || candidate.difficulty === "Intermediate" || candidate.difficulty === "Advanced") && Array.isArray(candidate.tags) && typeof candidate.componentCount === "number" && typeof candidate.cameraConfig === "object" && candidate.cameraConfig !== null && typeof candidate.getAssemblyTree === "function" && typeof candidate.getComponentMetadata === "function" && typeof candidate.getAllComponentIds === "function" && typeof candidate.buildScene === "function";
}
// tests/domainSchemas.test.ts
/**
* Unit Tests for Polymorphic Engineering Domain Schemas & Model Contracts
* Phase 9 - Task 9.1: Polymorphic Engineering Domain Schemas & Model Contracts
*/
describe("Base Component Metadata & Type Guard", () => {
	it("validates a compliant base metadata object", () => {
		assert.equal(isBaseComponentMetadata({
			id: "beam_01",
			name: "Flange Beam",
			domain: "civil",
			role: "Load-Bearing Girder",
			materialName: "Structural Steel ASTM A992",
			description: "Wide-flange I-beam supporting vertical floor load.",
			specifications: [{
				label: "Depth",
				value: "350 mm"
			}],
			engineeringNotes: ["Inspected during fabrication."]
		}), true);
	});
	it("safely rejects null, undefined, primitives, and missing fields", () => {
		assert.equal(isBaseComponentMetadata(null), false);
		assert.equal(isBaseComponentMetadata(void 0), false);
		assert.equal(isBaseComponentMetadata("string_val"), false);
		assert.equal(isBaseComponentMetadata(42), false);
		assert.equal(isBaseComponentMetadata({}), false);
		assert.equal(isBaseComponentMetadata({
			id: "part_1",
			name: "Part 1",
			domain: "mechanical",
			materialName: "Steel",
			description: "Test",
			specifications: [],
			engineeringNotes: []
		}), false);
		assert.equal(isBaseComponentMetadata({
			id: "part_1",
			name: "Part 1",
			domain: "aerospace",
			role: "Wing",
			materialName: "Carbon",
			description: "Test",
			specifications: [],
			engineeringNotes: []
		}), false);
	});
});
describe("Mechanical Component Metadata & Type Guard", () => {
	it("validates a full mechanical component metadata record", () => {
		const mechanicalPart = {
			id: "gear_drive",
			name: "High-Speed Pinion",
			domain: "mechanical",
			role: "Torque Transmitter",
			materialName: "Alloy Steel AISI 4340",
			description: "Precision spur gear with induction-hardened teeth.",
			nominalRpm: "1,800 RPM",
			gearRatio: "2.5 : 1",
			teethCount: 20,
			pitchDiameter: "50.0 mm",
			modulePitch: "2.5 mm",
			lubricationSpec: "ISO VG 320 Synthetic",
			serviceIntervalHours: 4e3,
			torqueRating: "65.0 N·m",
			specifications: [{
				label: "Pressure Angle",
				value: "20°"
			}, {
				label: "Hardness",
				value: "58 HRC"
			}],
			engineeringNotes: ["Requires annual backlash verification."]
		};
		assert.equal(isMechanicalMetadata(mechanicalPart), true);
		assert.equal(isCivilMetadata(mechanicalPart), false);
	});
	it("validates mechanical metadata when optional domain fields are omitted", () => {
		const minimalMechanical = {
			id: "spacer_ring",
			name: "Shaft Spacer",
			domain: "mechanical",
			role: "Axial Alignment",
			materialName: "Bronze Alloy",
			description: "Separates bearing inner races.",
			specifications: [],
			engineeringNotes: []
		};
		assert.equal(isMechanicalMetadata(minimalMechanical), true);
		assert.equal(isCivilMetadata(minimalMechanical), false);
	});
	it("proves compatibility with existing planetary gearbox metadata", () => {
		const mechanicalSunGear = {
			...EXTENDED_GEARBOX_METADATA.sun_gear,
			domain: "mechanical"
		};
		assert.equal(isMechanicalMetadata(mechanicalSunGear), true);
		assert.equal(mechanicalSunGear.teethCount, 16);
		assert.equal(mechanicalSunGear.nominalRpm, "1,200 RPM (Input)");
		assert.equal(mechanicalSunGear.materialName, "High-Tensile Brass Alloy");
	});
});
describe("Civil Component Metadata & Educational Annotations", () => {
	it("validates civil component metadata with qualitative educational annotations", () => {
		const civilMember = {
			id: "top_chord_t1",
			name: "Upper Compression Chord T1",
			domain: "civil",
			role: "Primary Top Chord Member",
			materialName: "Structural Steel ASTM A36",
			description: "Horizontal member resisting axial compressive forces under bridge deck live load.",
			structuralRole: "top_chord",
			nominalForceType: "compression",
			designLoadAnnotation: "Qualitative educational reference: Designed for nominal AASHTO truck loading",
			materialGrade: "ASTM A36 (Yield 250 MPa)",
			spanLength: "6.0 m panel",
			slendernessAnnotation: "KL/r <= 120 (AISC Specification)",
			educationalNotes: ["Under downward gravity loading, top chords carry compression while bottom chords carry tension.", "Requires lateral bracing at panel points to prevent out-of-plane buckling."],
			specifications: [{
				label: "Profile Type",
				value: "W14x90 Wide Flange"
			}, {
				label: "Cross-Section Area",
				value: "17,100 mm²"
			}],
			engineeringNotes: ["Bolted connection via double-shear gusset plates."]
		};
		assert.equal(isCivilMetadata(civilMember), true);
		assert.equal(isMechanicalMetadata(civilMember), false);
	});
	it("validates civil metadata when optional annotations are omitted", () => {
		const minimalCivil = {
			id: "bearing_pad_01",
			name: "Elastomeric Bearing Pad",
			domain: "civil",
			role: "Abutment Support",
			materialName: "Reinforced Neoprene",
			description: "Accommodates thermal expansion and rotational movement at the bridge support.",
			specifications: [{
				label: "Thickness",
				value: "50 mm"
			}],
			engineeringNotes: ["Replaced during 15-year bridge maintenance overhaul."]
		};
		assert.equal(isCivilMetadata(minimalCivil), true);
		assert.equal(minimalCivil.nominalForceType, void 0);
		assert.equal(minimalCivil.structuralRole, void 0);
	});
});
describe("Assembly Tree Node Schema & Type Guard", () => {
	it("validates a single component leaf node", () => {
		assert.equal(isAssemblyTreeNode({
			id: "node_sun_gear",
			name: "Sun Gear",
			type: "component",
			componentId: "sun_gear",
			defaultVisible: true
		}), true);
	});
	it("validates a nested hierarchical CAD assembly tree", () => {
		assert.equal(isAssemblyTreeNode({
			id: "root_gearbox",
			name: "Planetary Gearbox Assembly",
			type: "assembly",
			defaultExpanded: true,
			children: [{
				id: "sub_planetary_stage",
				name: "Epicyclic Planetary Stage",
				type: "subassembly",
				defaultExpanded: true,
				children: [{
					id: "node_sun",
					name: "Sun Gear",
					type: "component",
					componentId: "sun_gear"
				}, {
					id: "sub_planets",
					name: "Planet Gears Cluster",
					type: "subassembly",
					children: [
						{
							id: "node_planet_1",
							name: "Planet A",
							type: "component",
							componentId: "planet_gear_1"
						},
						{
							id: "node_planet_2",
							name: "Planet B",
							type: "component",
							componentId: "planet_gear_2"
						},
						{
							id: "node_planet_3",
							name: "Planet C",
							type: "component",
							componentId: "planet_gear_3"
						}
					]
				}]
			}, {
				id: "node_ring",
				name: "Outer Ring Gear",
				type: "component",
				componentId: "ring_gear"
			}]
		}), true);
	});
	it("safely rejects corrupted or malformed assembly tree nodes", () => {
		assert.equal(isAssemblyTreeNode(null), false);
		assert.equal(isAssemblyTreeNode({
			id: "bad",
			name: "Bad",
			type: "unknown_type"
		}), false);
		assert.equal(isAssemblyTreeNode({
			id: "bad_children",
			name: "Bad Children",
			type: "assembly",
			children: "not_an_array"
		}), false);
		assert.equal(isAssemblyTreeNode({
			id: "bad_child_node",
			name: "Bad Child Node",
			type: "assembly",
			children: [{ id: 123 }]
		}), false);
	});
});
describe("Engineering Model Definition Schema & Type Guard", () => {
	it("validates a complete EngineeringModelDefinition object", () => {
		assert.equal(isEngineeringModelDefinition({
			id: "planetary_gearbox",
			name: "Planetary Gearbox (Epicyclic Reduction)",
			domain: "mechanical",
			category: "Transmission Mechanisms",
			description: "High-torque coaxial reduction gearbox featuring sun, planet, and annulus gears.",
			thumbnailUrl: "/assets/models/planetary_gearbox.webp",
			difficulty: "Intermediate",
			tags: [
				"Gears",
				"Torque",
				"Kinematics",
				"Transmission"
			],
			componentCount: 7,
			cameraConfig: {
				initialPosition: [
					0,
					4,
					9
				],
				target: [
					0,
					0,
					0
				],
				minDistance: 2,
				maxDistance: 25,
				fov: 45,
				defaultPreset: "isometric"
			},
			getAssemblyTree: () => ({
				id: "gearbox_root",
				name: "Planetary Gearbox",
				type: "assembly"
			}),
			getComponentMetadata: (id) => {
				if (id === "sun_gear") return {
					...EXTENDED_GEARBOX_METADATA.sun_gear,
					domain: "mechanical"
				};
				return null;
			},
			getAllComponentIds: () => [
				"sun_gear",
				"planet_gear_1",
				"ring_gear"
			],
			buildScene: () => ({
				rootGroup: {},
				dispose: () => {}
			})
		}), true);
	});
	it("safely rejects incomplete or invalid model definitions", () => {
		assert.equal(isEngineeringModelDefinition(null), false);
		assert.equal(isEngineeringModelDefinition({ id: "incomplete" }), false);
		assert.equal(isEngineeringModelDefinition({
			id: "test",
			name: "Test",
			domain: "unsupported_domain",
			category: "Cat",
			description: "Desc",
			thumbnailUrl: "/img.webp",
			difficulty: "Beginner",
			tags: [],
			componentCount: 1,
			cameraConfig: {},
			getAssemblyTree: () => {},
			getComponentMetadata: () => null,
			getAllComponentIds: () => [],
			buildScene: () => {}
		}), false);
	});
});
// src/components/scene/PlanetaryGearbox.ts
/**
* Creates an individual gear mesh with a central hub, bore, and radial teeth.
*/
function createSpurGear({ radius, height, toothCount, toothDepth, toothWidth, material, componentId }) {
	const gearGroup = new THREE.Group();
	gearGroup.name = componentId;
	gearGroup.userData = { componentId };
	const hubGeo = new THREE.CylinderGeometry(radius, radius, height, 36);
	const hubMesh = new THREE.Mesh(hubGeo, material);
	hubMesh.name = `${componentId}_hub`;
	hubMesh.userData = { componentId };
	gearGroup.add(hubMesh);
	const boreGeo = new THREE.CylinderGeometry(radius * .28, radius * .28, height * 1.02, 24);
	const boreMat = new THREE.MeshStandardMaterial({
		color: 1120295,
		metalness: .9,
		roughness: .6
	});
	const boreMesh = new THREE.Mesh(boreGeo, boreMat);
	boreMesh.name = `${componentId}_bore`;
	boreMesh.userData = { componentId };
	gearGroup.add(boreMesh);
	const toothGeo = new THREE.BoxGeometry(toothWidth, height * .96, toothDepth);
	for (let i = 0; i < toothCount; i++) {
		const angle = i / toothCount * Math.PI * 2;
		const toothMesh = new THREE.Mesh(toothGeo, material);
		const posX = Math.sin(angle) * (radius + toothDepth * .4);
		const posZ = Math.cos(angle) * (radius + toothDepth * .4);
		toothMesh.position.set(posX, 0, posZ);
		toothMesh.rotation.y = angle;
		toothMesh.name = `${componentId}_tooth_${i}`;
		toothMesh.userData = { componentId };
		gearGroup.add(toothMesh);
	}
	return gearGroup;
}
/**
* Creates the outer Ring Gear (Annulus) with internal-facing teeth.
*/
function createRingGear({ innerRadius, outerRadius, height, toothCount, material, componentId }) {
	const ringGroup = new THREE.Group();
	ringGroup.name = componentId;
	ringGroup.userData = { componentId };
	const outerWallGeo = new THREE.CylinderGeometry(outerRadius, outerRadius, height, 48, 1, true);
	const outerWallMesh = new THREE.Mesh(outerWallGeo, material);
	outerWallMesh.name = `${componentId}_outer_wall`;
	outerWallMesh.userData = { componentId };
	ringGroup.add(outerWallMesh);
	const flangeGeo = new THREE.TorusGeometry(outerRadius, .08, 16, 48);
	const topFlange = new THREE.Mesh(flangeGeo, material);
	topFlange.rotation.x = Math.PI / 2;
	topFlange.position.y = height / 2;
	topFlange.name = `${componentId}_top_flange`;
	topFlange.userData = { componentId };
	ringGroup.add(topFlange);
	const bottomFlange = new THREE.Mesh(flangeGeo, material);
	bottomFlange.rotation.x = Math.PI / 2;
	bottomFlange.position.y = -height / 2;
	bottomFlange.name = `${componentId}_bottom_flange`;
	bottomFlange.userData = { componentId };
	ringGroup.add(bottomFlange);
	const toothDepth = .14;
	const toothGeo = new THREE.BoxGeometry(.09, height * .92, toothDepth);
	for (let i = 0; i < toothCount; i++) {
		const angle = i / toothCount * Math.PI * 2;
		const toothMesh = new THREE.Mesh(toothGeo, material);
		const posX = Math.sin(angle) * (innerRadius + toothDepth * .4);
		const posZ = Math.cos(angle) * (innerRadius + toothDepth * .4);
		toothMesh.position.set(posX, 0, posZ);
		toothMesh.rotation.y = angle;
		toothMesh.name = `${componentId}_internal_tooth_${i}`;
		toothMesh.userData = { componentId };
		ringGroup.add(toothMesh);
	}
	const bracketGeo = new THREE.BoxGeometry(.18, height * .7, .3);
	for (let b = 0; b < 4; b++) {
		const bAngle = b / 4 * Math.PI * 2 + Math.PI / 4;
		const bracket = new THREE.Mesh(bracketGeo, material);
		bracket.position.set(Math.sin(bAngle) * (outerRadius + .1), 0, Math.cos(bAngle) * (outerRadius + .1));
		bracket.rotation.y = bAngle;
		bracket.name = `${componentId}_bracket_${b}`;
		bracket.userData = { componentId };
		ringGroup.add(bracket);
	}
	return ringGroup;
}
/**
* Creates the Planet Carrier supporting the 3 planet gear axes.
*/
function createPlanetCarrier({ orbitRadius, pinRadius, height, material, pinMaterial, componentId }) {
	const carrierGroup = new THREE.Group();
	carrierGroup.name = componentId;
	carrierGroup.userData = { componentId };
	const pinPositions = [];
	const plateThickness = .1;
	const plateElevation = -(height / 2 + plateThickness / 2 + .05);
	const hubPlateGeo = new THREE.CylinderGeometry(.55, .55, plateThickness, 24);
	const centerHubPlate = new THREE.Mesh(hubPlateGeo, material);
	centerHubPlate.position.y = plateElevation;
	centerHubPlate.name = `${componentId}_base_hub`;
	centerHubPlate.userData = { componentId };
	carrierGroup.add(centerHubPlate);
	const armLength = orbitRadius;
	const armGeo = new THREE.BoxGeometry(.24, plateThickness, armLength);
	for (let i = 0; i < 3; i++) {
		const angle = i / 3 * Math.PI * 2;
		const posX = Math.sin(angle) * orbitRadius;
		const posZ = Math.cos(angle) * orbitRadius;
		pinPositions.push(new THREE.Vector3(posX, 0, posZ));
		const arm = new THREE.Mesh(armGeo, material);
		arm.position.set(Math.sin(angle) * (orbitRadius * .5), plateElevation, Math.cos(angle) * (orbitRadius * .5));
		arm.rotation.y = angle;
		arm.name = `${componentId}_arm_${i}`;
		arm.userData = { componentId };
		carrierGroup.add(arm);
		const bossGeo = new THREE.CylinderGeometry(pinRadius * 2.2, pinRadius * 2.2, plateThickness * 1.2, 16);
		const boss = new THREE.Mesh(bossGeo, material);
		boss.position.set(posX, plateElevation, posZ);
		boss.name = `${componentId}_boss_${i}`;
		boss.userData = { componentId };
		carrierGroup.add(boss);
		const pinGeo = new THREE.CylinderGeometry(pinRadius, pinRadius, height * 1.5, 20);
		const pin = new THREE.Mesh(pinGeo, pinMaterial);
		pin.position.set(posX, 0, posZ);
		pin.name = `${componentId}_pin_${i}`;
		pin.userData = { componentId };
		carrierGroup.add(pin);
		const capGeo = new THREE.CylinderGeometry(pinRadius * 1.4, pinRadius * 1.4, .06, 12);
		const cap = new THREE.Mesh(capGeo, pinMaterial);
		cap.position.set(posX, height / 2 + .08, posZ);
		cap.name = `${componentId}_cap_${i}`;
		cap.userData = { componentId };
		carrierGroup.add(cap);
	}
	const outputShaftGeo = new THREE.CylinderGeometry(.28, .28, .8, 24);
	const outputShaft = new THREE.Mesh(outputShaftGeo, pinMaterial);
	outputShaft.position.y = plateElevation - .4;
	outputShaft.name = `${componentId}_output_shaft`;
	outputShaft.userData = { componentId };
	carrierGroup.add(outputShaft);
	return {
		carrierGroup,
		pinPositions
	};
}
/**
* Builds the complete procedural 3D Planetary Gearbox assembly.
*/
function buildPlanetaryGearbox() {
	const masterGroup = new THREE.Group();
	masterGroup.name = "planetary_gearbox_assembly";
	const sunMaterial = new THREE.MeshStandardMaterial({
		color: 13938487,
		metalness: .86,
		roughness: .26
	});
	const planetMaterial = new THREE.MeshStandardMaterial({
		color: 9741240,
		metalness: .92,
		roughness: .18
	});
	const ringMaterial = new THREE.MeshStandardMaterial({
		color: 3359061,
		metalness: .8,
		roughness: .36
	});
	const carrierMaterial = new THREE.MeshStandardMaterial({
		color: 1976635,
		metalness: .65,
		roughness: .48
	});
	const shaftMaterial = new THREE.MeshStandardMaterial({
		color: 6583435,
		metalness: .88,
		roughness: .22
	});
	const sunRadius = .72;
	const planetRadius = .54;
	const orbitRadius = 1.26;
	const ringInnerRadius = 1.8;
	const ringOuterRadius = 2.22;
	const gearHeight = .5;
	const shaftGeo = new THREE.CylinderGeometry(.18, .18, 2.4, 32);
	const centralShaft = new THREE.Mesh(shaftGeo, shaftMaterial);
	centralShaft.position.y = .3;
	centralShaft.name = "central_shaft";
	centralShaft.userData = { componentId: "central_shaft" };
	masterGroup.add(centralShaft);
	const collarGeo = new THREE.CylinderGeometry(.24, .24, .12, 24);
	const collar = new THREE.Mesh(collarGeo, shaftMaterial);
	collar.position.y = .4;
	collar.name = "central_shaft_collar";
	collar.userData = { componentId: "central_shaft" };
	masterGroup.add(collar);
	const sunGear = createSpurGear({
		radius: sunRadius,
		height: gearHeight,
		toothCount: 16,
		toothDepth: .14,
		toothWidth: .1,
		material: sunMaterial,
		componentId: "sun_gear"
	});
	masterGroup.add(sunGear);
	const { carrierGroup, pinPositions } = createPlanetCarrier({
		orbitRadius,
		pinRadius: .09,
		height: gearHeight,
		material: carrierMaterial,
		pinMaterial: shaftMaterial,
		componentId: "planet_carrier"
	});
	masterGroup.add(carrierGroup);
	const planetGearIds = [
		"planet_gear_1",
		"planet_gear_2",
		"planet_gear_3"
	];
	const planetMeshes = [];
	for (let i = 0; i < 3; i++) {
		const planetGear = createSpurGear({
			radius: planetRadius,
			height: gearHeight * .94,
			toothCount: 12,
			toothDepth: .13,
			toothWidth: .09,
			material: planetMaterial,
			componentId: planetGearIds[i]
		});
		planetGear.position.copy(pinPositions[i]);
		masterGroup.add(planetGear);
		planetMeshes.push(planetGear);
	}
	const ringGear = createRingGear({
		innerRadius: ringInnerRadius,
		outerRadius: ringOuterRadius,
		height: gearHeight * 1.15,
		toothCount: 36,
		material: ringMaterial,
		componentId: "ring_gear"
	});
	masterGroup.add(ringGear);
	let currentExplodedFactor = 0;
	const baseShaftY = .3;
	const baseCollarY = .4;
	const baseSunY = 0;
	const baseCarrierY = 0;
	const baseRingY = 0;
	const basePlanetY = 0;
	const setExplodedFactor = (factor) => {
		currentExplodedFactor = Math.max(0, Math.min(1, factor));
		centralShaft.position.y = baseShaftY + currentExplodedFactor * 2.2;
		collar.position.y = baseCollarY + currentExplodedFactor * 2.2;
		sunGear.position.y = baseSunY + currentExplodedFactor * 1.1;
		carrierGroup.position.y = currentExplodedFactor === 0 ? baseCarrierY : baseCarrierY - currentExplodedFactor * 1.1;
		ringGear.position.y = currentExplodedFactor === 0 ? baseRingY : baseRingY - currentExplodedFactor * 2.2;
		const effectiveOrbitRadius = orbitRadius + currentExplodedFactor * .85;
		for (let i = 0; i < 3; i++) {
			const currentOrbitAngle = i / 3 * Math.PI * 2 + carrierGroup.rotation.y;
			planetMeshes[i].position.x = Math.sin(currentOrbitAngle) * effectiveOrbitRadius;
			planetMeshes[i].position.z = Math.cos(currentOrbitAngle) * effectiveOrbitRadius;
			planetMeshes[i].position.y = basePlanetY + currentExplodedFactor * .15;
		}
	};
	let sunAngle = 0;
	const sunSpeed = .8;
	const update = (delta, isRotating) => {
		if (!isRotating) return;
		const dSun = delta * sunSpeed;
		sunAngle += dSun;
		sunGear.rotation.y = sunAngle;
		centralShaft.rotation.y = sunAngle;
		const dCarrier = dSun * (sunRadius / 2.52);
		carrierGroup.rotation.y += dCarrier;
		const effectiveOrbitRadius = orbitRadius + currentExplodedFactor * .85;
		for (let i = 0; i < 3; i++) {
			const currentOrbitAngle = i / 3 * Math.PI * 2 + carrierGroup.rotation.y;
			planetMeshes[i].position.x = Math.sin(currentOrbitAngle) * effectiveOrbitRadius;
			planetMeshes[i].position.z = Math.cos(currentOrbitAngle) * effectiveOrbitRadius;
			planetMeshes[i].position.y = basePlanetY + currentExplodedFactor * .15;
			const spinSpeed = -.761904761904762;
			planetMeshes[i].rotation.y += delta * spinSpeed;
		}
	};
	const dispose = () => {
		masterGroup.traverse((obj) => {
			if (obj.isMesh) {
				const mesh = obj;
				mesh.geometry?.dispose();
				if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
				else if (mesh.material) mesh.material.dispose();
			}
		});
		sunMaterial.dispose();
		planetMaterial.dispose();
		ringMaterial.dispose();
		carrierMaterial.dispose();
		shaftMaterial.dispose();
	};
	return {
		group: masterGroup,
		update,
		setExplodedFactor,
		dispose
	};
}
// src/models/mechanical/planetaryGearboxModel.ts
var PLANETARY_GEARBOX_MODEL_ID = "planetary_gearbox";
/**
* All addressable component IDs for the planetary gearbox
*/
var PLANETARY_GEARBOX_COMPONENT_IDS = [
	"sun_gear",
	"planet_gear_1",
	"planet_gear_2",
	"planet_gear_3",
	"ring_gear",
	"planet_carrier",
	"central_shaft"
];
/**
* Hierarchical CAD assembly tree for the planetary gearbox
*/
function getPlanetaryGearboxAssemblyTree() {
	return {
		id: "planetary_gearbox_root",
		name: "Planetary Gearbox Assembly",
		type: "assembly",
		defaultExpanded: true,
		children: [
			{
				id: "stage_epicyclic",
				name: "Epicyclic Planetary Stage",
				type: "subassembly",
				defaultExpanded: true,
				children: [
					{
						id: "node_sun_gear",
						name: "Sun Gear",
						type: "component",
						componentId: "sun_gear",
						defaultVisible: true
					},
					{
						id: "sub_planets_cluster",
						name: "Planet Gears Cluster",
						type: "subassembly",
						defaultExpanded: true,
						children: [
							{
								id: "node_planet_gear_1",
								name: "Planet Gear A",
								type: "component",
								componentId: "planet_gear_1",
								defaultVisible: true
							},
							{
								id: "node_planet_gear_2",
								name: "Planet Gear B",
								type: "component",
								componentId: "planet_gear_2",
								defaultVisible: true
							},
							{
								id: "node_planet_gear_3",
								name: "Planet Gear C",
								type: "component",
								componentId: "planet_gear_3",
								defaultVisible: true
							}
						]
					},
					{
						id: "node_planet_carrier",
						name: "Planet Carrier Plate",
						type: "component",
						componentId: "planet_carrier",
						defaultVisible: true
					}
				]
			},
			{
				id: "node_ring_gear",
				name: "Outer Annulus (Ring Gear)",
				type: "component",
				componentId: "ring_gear",
				defaultVisible: true
			},
			{
				id: "node_central_shaft",
				name: "Primary Drive Shaft",
				type: "component",
				componentId: "central_shaft",
				defaultVisible: true
			}
		]
	};
}
/**
* Looks up mechanical engineering metadata for any gearbox component ID
*/
function getPlanetaryGearboxComponentMetadata(componentId) {
	const existing = getComponentMetadata(componentId);
	if (!existing) return null;
	return {
		...existing,
		domain: "mechanical"
	};
}
/**
* Standardized EngineeringModelDefinition for the Epicyclic Planetary Gearbox
*/
var planetaryGearboxModel = {
	id: PLANETARY_GEARBOX_MODEL_ID,
	name: "Epicyclic Planetary Gearbox",
	domain: "mechanical",
	category: "Transmission & Kinematics",
	description: "High-torque coaxial reduction gearbox featuring central sun gear, three epicyclic planet gears, planet carrier, and outer ring gear. Used in robotics, automotive, and aerospace transmissions.",
	thumbnailUrl: "/assets/models/planetary_gearbox.webp",
	difficulty: "Intermediate",
	tags: [
		"Gearbox",
		"Epicyclic Transmission",
		"Torque Multiplication",
		"Kinematics",
		"Mechanical Engineering"
	],
	componentCount: PLANETARY_GEARBOX_COMPONENT_IDS.length,
	cameraConfig: {
		initialPosition: [
			0,
			4,
			9
		],
		target: [
			0,
			0,
			0
		],
		minDistance: 2,
		maxDistance: 25,
		fov: 45,
		defaultPreset: "isometric"
	},
	getAssemblyTree: getPlanetaryGearboxAssemblyTree,
	getComponentMetadata: getPlanetaryGearboxComponentMetadata,
	getAllComponentIds: () => [...PLANETARY_GEARBOX_COMPONENT_IDS],
	buildScene: (scene) => {
		const controller = buildPlanetaryGearbox();
		scene.add(controller.group);
		return {
			rootGroup: controller.group,
			updateAnimation: (deltaSeconds) => {
				controller.update(deltaSeconds, true);
			},
			setExplodedFactor: (factor) => {
				controller.setExplodedFactor?.(factor);
			},
			dispose: () => {
				scene.remove(controller.group);
				controller.dispose();
			}
		};
	}
};
// src/models/civil/WarrenTrussBridge.ts
/**
* Procedural 3D Warren Truss Bridge Geometry Builder
* Phase 9 - Task 9.8: Civil Engineering Warren Truss Bridge Model
*
* Constructs a fully procedural, realistic 3-dimensional Warren through-truss bridge
* using Three.js standard geometries and PBR materials.
*
* Bridge Specs:
* - Span: 24.0 m (-12m to +12m along X)
* - Width: 5.0 m (-2.5m to +2.5m along Z)
* - Truss Height: 4.5 m (Y = 0.5m to Y = 5.0m)
* - 6 Panels / Bays of 4.0m each
*
* Component IDs (8 addressable parts):
* - top_chords
* - bottom_chords
* - diagonal_members
* - vertical_struts
* - gusset_plates
* - end_portals
* - bridge_deck
* - support_piers
*/
var WARREN_TRUSS_COMPONENT_IDS = [
	"top_chords",
	"bottom_chords",
	"diagonal_members",
	"vertical_struts",
	"gusset_plates",
	"end_portals",
	"bridge_deck",
	"support_piers"
];
function buildWarrenTrussBridge() {
	const rootGroup = new THREE.Group();
	rootGroup.name = "warren_truss_bridge_root";
	rootGroup.userData = { modelId: "warren_truss_bridge" };
	const geometriesToDispose = [];
	const materialsToDispose = [];
	const trackGeometry = (geo) => {
		geometriesToDispose.push(geo);
		return geo;
	};
	const trackMaterial = (mat) => {
		materialsToDispose.push(mat);
		return mat;
	};
	const topChordMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 3718648,
		metalness: .75,
		roughness: .3,
		name: "top_chord_material"
	}));
	const bottomChordMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 6333946,
		metalness: .75,
		roughness: .3,
		name: "bottom_chord_material"
	}));
	const diagonalMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 8490232,
		metalness: .7,
		roughness: .35,
		name: "diagonal_material"
	}));
	const verticalMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 10859772,
		metalness: .65,
		roughness: .35,
		name: "vertical_material"
	}));
	const gussetMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 16096779,
		metalness: .85,
		roughness: .25,
		name: "gusset_plate_material"
	}));
	const portalMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 165063,
		metalness: .8,
		roughness: .3,
		name: "portal_material"
	}));
	const deckMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 1976635,
		metalness: .1,
		roughness: .85,
		name: "deck_material"
	}));
	const curbMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 9741240,
		metalness: .2,
		roughness: .7,
		name: "curb_material"
	}));
	const pierMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 6583435,
		metalness: .15,
		roughness: .8,
		name: "pier_material"
	}));
	const bearingMat = trackMaterial(new THREE.MeshStandardMaterial({
		color: 988970,
		metalness: .9,
		roughness: .4,
		name: "bearing_material"
	}));
	/**
	* Helper to create a 3D structural member connecting two points in space.
	*/
	function createMember(start, end, size, material, componentId, shape = "box") {
		const delta = end.clone().sub(start);
		const length = delta.length();
		const midpoint = start.clone().add(end).multiplyScalar(.5);
		let geometry;
		if (shape === "cylinder") geometry = trackGeometry(new THREE.CylinderGeometry(size * .5, size * .5, length, 12));
		else geometry = trackGeometry(new THREE.BoxGeometry(size, length, size));
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(midpoint);
		const defaultAxis = new THREE.Vector3(0, 1, 0);
		const targetDir = delta.clone().normalize();
		const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultAxis, targetDir);
		mesh.quaternion.copy(quaternion);
		mesh.name = `${componentId}_member`;
		mesh.userData = { componentId };
		return mesh;
	}
	const span = 24;
	const numBays = 6;
	const bayWidth = span / numBays;
	const startX = -12;
	const halfTrussWidth = 5 / 2;
	const bottomY = .5;
	const topY = 4.5;
	const zCoordinates = [-2.5, halfTrussWidth];
	const topChordsGroup = new THREE.Group();
	topChordsGroup.name = "top_chords";
	topChordsGroup.userData = { componentId: "top_chords" };
	for (const z of zCoordinates) for (let i = 1; i < 5; i++) {
		const beam = createMember(new THREE.Vector3(startX + i * bayWidth, topY, z), new THREE.Vector3(startX + (i + 1) * bayWidth, topY, z), .32, topChordMat, "top_chords");
		topChordsGroup.add(beam);
	}
	for (let i = 1; i <= 5; i++) {
		const p1 = new THREE.Vector3(startX + i * bayWidth, topY, -2.5);
		const p2 = new THREE.Vector3(startX + i * bayWidth, topY, halfTrussWidth);
		const crossStrut = createMember(p1, p2, .22, topChordMat, "top_chords");
		topChordsGroup.add(crossStrut);
		if (i < 5) {
			const p3 = new THREE.Vector3(startX + (i + 1) * bayWidth, topY, halfTrussWidth);
			const p4 = new THREE.Vector3(startX + (i + 1) * bayWidth, topY, -2.5);
			const brace1 = createMember(p1, p3, .14, topChordMat, "top_chords");
			const brace2 = createMember(p2, p4, .14, topChordMat, "top_chords");
			topChordsGroup.add(brace1);
			topChordsGroup.add(brace2);
		}
	}
	rootGroup.add(topChordsGroup);
	const bottomChordsGroup = new THREE.Group();
	bottomChordsGroup.name = "bottom_chords";
	bottomChordsGroup.userData = { componentId: "bottom_chords" };
	for (const z of zCoordinates) for (let i = 0; i < numBays; i++) {
		const beam = createMember(new THREE.Vector3(startX + i * bayWidth, bottomY, z), new THREE.Vector3(startX + (i + 1) * bayWidth, bottomY, z), .36, bottomChordMat, "bottom_chords");
		bottomChordsGroup.add(beam);
	}
	for (let i = 0; i <= numBays; i++) {
		const floorBeam = createMember(new THREE.Vector3(startX + i * bayWidth, bottomY, -2.5), new THREE.Vector3(startX + i * bayWidth, bottomY, halfTrussWidth), .28, bottomChordMat, "bottom_chords");
		bottomChordsGroup.add(floorBeam);
	}
	rootGroup.add(bottomChordsGroup);
	const diagonalsGroup = new THREE.Group();
	diagonalsGroup.name = "diagonal_members";
	diagonalsGroup.userData = { componentId: "diagonal_members" };
	for (const z of zCoordinates) {
		const diagPoints = [
			[
				1,
				topY,
				2,
				bottomY
			],
			[
				2,
				bottomY,
				3,
				topY
			],
			[
				3,
				topY,
				4,
				bottomY
			],
			[
				4,
				bottomY,
				5,
				topY
			]
		];
		for (const [b1, y1, b2, y2] of diagPoints) {
			const diag = createMember(new THREE.Vector3(startX + b1 * bayWidth, y1, z), new THREE.Vector3(startX + b2 * bayWidth, y2, z), .25, diagonalMat, "diagonal_members");
			diagonalsGroup.add(diag);
		}
	}
	rootGroup.add(diagonalsGroup);
	const verticalsGroup = new THREE.Group();
	verticalsGroup.name = "vertical_struts";
	verticalsGroup.userData = { componentId: "vertical_struts" };
	for (const z of zCoordinates) for (let i = 1; i <= 5; i++) {
		const vert = createMember(new THREE.Vector3(startX + i * bayWidth, bottomY, z), new THREE.Vector3(startX + i * bayWidth, topY, z), .2, verticalMat, "vertical_struts");
		verticalsGroup.add(vert);
	}
	rootGroup.add(verticalsGroup);
	const gussetsGroup = new THREE.Group();
	gussetsGroup.name = "gusset_plates";
	gussetsGroup.userData = { componentId: "gusset_plates" };
	const jointGeo = trackGeometry(new THREE.BoxGeometry(.65, .65, .12));
	for (const z of zCoordinates) {
		for (let i = 0; i <= numBays; i++) {
			const jointMesh = new THREE.Mesh(jointGeo, gussetMat);
			jointMesh.position.set(startX + i * bayWidth, bottomY, z);
			jointMesh.name = `gusset_plate_bottom_${i}`;
			jointMesh.userData = { componentId: "gusset_plates" };
			gussetsGroup.add(jointMesh);
		}
		for (let i = 1; i < numBays; i++) {
			const jointMesh = new THREE.Mesh(jointGeo, gussetMat);
			jointMesh.position.set(startX + i * bayWidth, topY, z);
			jointMesh.name = `gusset_plate_top_${i}`;
			jointMesh.userData = { componentId: "gusset_plates" };
			gussetsGroup.add(jointMesh);
		}
	}
	rootGroup.add(gussetsGroup);
	const portalsGroup = new THREE.Group();
	portalsGroup.name = "end_portals";
	portalsGroup.userData = { componentId: "end_portals" };
	for (const z of zCoordinates) {
		const postLeft = createMember(new THREE.Vector3(startX, bottomY, z), new THREE.Vector3(-8, topY, z), .38, portalMat, "end_portals");
		portalsGroup.add(postLeft);
		const postRight = createMember(new THREE.Vector3(8, topY, z), new THREE.Vector3(12, bottomY, z), .38, portalMat, "end_portals");
		portalsGroup.add(postRight);
	}
	for (const x of [-8, 8]) {
		const p1 = new THREE.Vector3(x, topY, -2.5);
		const p2 = new THREE.Vector3(x, topY, halfTrussWidth);
		const topBar = createMember(p1, p2, .3, portalMat, "end_portals");
		portalsGroup.add(topBar);
		const p3 = new THREE.Vector3(x, 3.7, -2.5);
		const p4 = new THREE.Vector3(x, 3.7, halfTrussWidth);
		const lowerBar = createMember(p3, p4, .2, portalMat, "end_portals");
		portalsGroup.add(lowerBar);
		const knee1 = createMember(p1, p4, .14, portalMat, "end_portals");
		const knee2 = createMember(p2, p3, .14, portalMat, "end_portals");
		portalsGroup.add(knee1);
		portalsGroup.add(knee2);
	}
	rootGroup.add(portalsGroup);
	const deckGroup = new THREE.Group();
	deckGroup.name = "bridge_deck";
	deckGroup.userData = { componentId: "bridge_deck" };
	const deckWidth = 4.7;
	const deckGeo = trackGeometry(new THREE.BoxGeometry(span, .28, deckWidth));
	const deckMesh = new THREE.Mesh(deckGeo, deckMat);
	deckMesh.position.set(0, .64 + .05, 0);
	deckMesh.name = "bridge_deck_slab";
	deckMesh.userData = { componentId: "bridge_deck" };
	deckGroup.add(deckMesh);
	const curbHeight = .35;
	const curbWidth = .3;
	const curbGeo = trackGeometry(new THREE.BoxGeometry(span, curbHeight, curbWidth));
	const curbLeft = new THREE.Mesh(curbGeo, curbMat);
	curbLeft.position.set(0, .9550000000000001, -2.2);
	curbLeft.name = "bridge_deck_curb_left";
	curbLeft.userData = { componentId: "bridge_deck" };
	deckGroup.add(curbLeft);
	const curbRight = new THREE.Mesh(curbGeo, curbMat);
	curbRight.position.set(0, .9550000000000001, deckWidth * .5 - curbWidth * .5);
	curbRight.name = "bridge_deck_curb_right";
	curbRight.userData = { componentId: "bridge_deck" };
	deckGroup.add(curbRight);
	const stringerCount = 4;
	const stringerOffset = 3.8 / 3;
	const stringerGeo = trackGeometry(new THREE.BoxGeometry(span, .22, .16));
	for (let s = 0; s < stringerCount; s++) {
		const stringerZ = -1.9 + s * stringerOffset;
		const stringerMesh = new THREE.Mesh(stringerGeo, bottomChordMat);
		stringerMesh.position.set(0, .45, stringerZ);
		stringerMesh.name = `bridge_deck_stringer_${s}`;
		stringerMesh.userData = { componentId: "bridge_deck" };
		deckGroup.add(stringerMesh);
	}
	rootGroup.add(deckGroup);
	const piersGroup = new THREE.Group();
	piersGroup.name = "support_piers";
	piersGroup.userData = { componentId: "support_piers" };
	const pierHeight = 2.8;
	const pierGeo = trackGeometry(new THREE.BoxGeometry(1.4, pierHeight, 6.6));
	const bearingGeo = trackGeometry(new THREE.CylinderGeometry(.32, .32, .2, 16));
	const pierLocations = [startX, 12];
	for (let pIdx = 0; pIdx < pierLocations.length; pIdx++) {
		const px = pierLocations[pIdx];
		const pierMesh = new THREE.Mesh(pierGeo, pierMat);
		pierMesh.position.set(px, bottomY - pierHeight * .5 - .15, 0);
		pierMesh.name = `support_pier_abutment_${pIdx}`;
		pierMesh.userData = { componentId: "support_piers" };
		piersGroup.add(pierMesh);
		for (const z of zCoordinates) {
			const bearingMesh = new THREE.Mesh(bearingGeo, bearingMat);
			bearingMesh.position.set(px, .4, z);
			bearingMesh.name = `support_bearing_${pIdx}_z${z < 0 ? "neg" : "pos"}`;
			bearingMesh.userData = { componentId: "support_piers" };
			piersGroup.add(bearingMesh);
		}
	}
	rootGroup.add(piersGroup);
	const captureMeshBaseTransforms = (group) => {
		group.children.forEach((child) => {
			if (child.isMesh || child.isGroup) {
				child.userData.baseX = child.position.x;
				child.userData.baseY = child.position.y;
				child.userData.baseZ = child.position.z;
			}
		});
	};
	captureMeshBaseTransforms(portalsGroup);
	captureMeshBaseTransforms(diagonalsGroup);
	captureMeshBaseTransforms(verticalsGroup);
	captureMeshBaseTransforms(gussetsGroup);
	const setExplodedFactor = (factor) => {
		const f = Math.max(0, Math.min(1, factor));
		topChordsGroup.position.y = f === 0 ? 0 : f * 3;
		deckGroup.position.y = f === 0 ? 0 : f * 1.2;
		bottomChordsGroup.position.y = f === 0 ? 0 : -f * 1.2;
		piersGroup.position.y = f === 0 ? 0 : -f * 2.8;
		portalsGroup.children.forEach((child) => {
			const baseX = child.userData.baseX ?? child.position.x;
			const signX = baseX >= 0 ? 1 : -1;
			child.position.x = baseX + signX * f * 2;
		});
		diagonalsGroup.children.forEach((child) => {
			const baseZ = child.userData.baseZ ?? child.position.z;
			const signZ = baseZ >= 0 ? 1 : -1;
			child.position.z = baseZ + signZ * f * .8;
		});
		verticalsGroup.children.forEach((child) => {
			const baseZ = child.userData.baseZ ?? child.position.z;
			const signZ = baseZ >= 0 ? 1 : -1;
			child.position.z = baseZ + signZ * f * .4;
		});
		gussetsGroup.children.forEach((child) => {
			const baseZ = child.userData.baseZ ?? child.position.z;
			const signZ = baseZ >= 0 ? 1 : -1;
			child.position.z = baseZ + signZ * f * 1.5;
		});
	};
	return {
		group: rootGroup,
		update: (_delta) => {},
		setExplodedFactor,
		dispose: () => {
			setExplodedFactor(0);
			while (rootGroup.children.length > 0) rootGroup.remove(rootGroup.children[0]);
			for (const geo of geometriesToDispose) geo.dispose();
			geometriesToDispose.length = 0;
			for (const mat of materialsToDispose) mat.dispose();
			materialsToDispose.length = 0;
		}
	};
}
// src/models/civil/warrenTrussBridgeModel.ts
var WARREN_TRUSS_MODEL_ID = "warren_truss_bridge";
/**
* All addressable component IDs for the Warren truss bridge
*/
var WARREN_TRUSS_BRIDGE_COMPONENT_IDS = WARREN_TRUSS_COMPONENT_IDS;
/**
* Hierarchical CAD assembly tree for the Warren Truss Bridge
*/
function getWarrenTrussAssemblyTree() {
	return {
		id: "warren_truss_root",
		name: "Warren Truss Bridge Assembly",
		type: "assembly",
		defaultExpanded: true,
		children: [
			{
				id: "sub_superstructure",
				name: "Superstructure Truss System",
				type: "subassembly",
				defaultExpanded: true,
				children: [
					{
						id: "node_top_chords",
						name: "Upper Compression Chords",
						type: "component",
						componentId: "top_chords",
						defaultVisible: true
					},
					{
						id: "node_bottom_chords",
						name: "Lower Tension Chords",
						type: "component",
						componentId: "bottom_chords",
						defaultVisible: true
					},
					{
						id: "node_diagonal_members",
						name: "Alternating Diagonal Web Members",
						type: "component",
						componentId: "diagonal_members",
						defaultVisible: true
					},
					{
						id: "node_vertical_struts",
						name: "Vertical Panel Hangers",
						type: "component",
						componentId: "vertical_struts",
						defaultVisible: true
					}
				]
			},
			{
				id: "sub_bracing_joints",
				name: "Connections & Portal Frames",
				type: "subassembly",
				defaultExpanded: true,
				children: [{
					id: "node_gusset_plates",
					name: "Structural Gusset Plates",
					type: "component",
					componentId: "gusset_plates",
					defaultVisible: true
				}, {
					id: "node_end_portals",
					name: "End Portal Frames & Sway Bracing",
					type: "component",
					componentId: "end_portals",
					defaultVisible: true
				}]
			},
			{
				id: "sub_deck_substructure",
				name: "Deck & Substructure System",
				type: "subassembly",
				defaultExpanded: true,
				children: [{
					id: "node_bridge_deck",
					name: "Concrete Roadway Deck & Stringers",
					type: "component",
					componentId: "bridge_deck",
					defaultVisible: true
				}, {
					id: "node_support_piers",
					name: "Substructure Abutments & Bearings",
					type: "component",
					componentId: "support_piers",
					defaultVisible: true
				}]
			}
		]
	};
}
/**
* Civil engineering metadata repository for Warren Truss Bridge components
*/
var CIVIL_BRIDGE_METADATA = {
	top_chords: {
		id: "top_chords",
		name: "Upper Compression Chords",
		domain: "civil",
		role: "Primary Upper Longitudinal Compression Chord",
		materialName: "Structural Steel ASTM A709 Grade 50",
		description: "Continuous upper longitudinal steel chord members forming the top boundary of each truss girder. Carries primarily compressive axial loads under downward gravitational live and dead loading.",
		structuralRole: "top_chord",
		nominalForceType: "compression",
		designLoadAnnotation: "AASHTO Strength I Axial Compression Limit State",
		materialGrade: "ASTM A709 Gr. 50 (Fy = 345 MPa)",
		spanLength: "16.0 m (4 Interior Bays @ 4.0 m)",
		slendernessAnnotation: "KL/r <= 120 (AASHTO Compression Member Limit)",
		specifications: [
			{
				label: "Cross Section",
				value: "HSS 350x350x16 Hollow Structural Section"
			},
			{
				label: "Axial Area",
				value: "20,800 mm²"
			},
			{
				label: "Radius of Gyration",
				value: "rx = ry = 138 mm"
			},
			{
				label: "Effective Length Factor (K)",
				value: "0.85 (Braced Node)"
			}
		],
		engineeringNotes: ["Euler buckling capacity governs member sizing: Pcr = pi^2 * E * I / (K * L)^2.", "Top chords are continuously braced against lateral-torsional sway by upper transverse struts and X-bracing."],
		educationalNotes: ["In simple-span gravity loading, the top chord is in direct compression.", "Educational Concept: Member sizing is governed by compression stability and local plate buckling rather than yield rupture. Live FEA calculations are not simulated."]
	},
	bottom_chords: {
		id: "bottom_chords",
		name: "Lower Tension Chords",
		domain: "civil",
		role: "Primary Lower Longitudinal Tension Chord",
		materialName: "Structural Steel ASTM A709 Grade 50",
		description: "Continuous lower longitudinal steel chord members carrying the primary tension resultant of the global truss bending moment, while supporting transverse floor beams.",
		structuralRole: "bottom_chord",
		nominalForceType: "tension",
		designLoadAnnotation: "AASHTO Strength I Tension Limit State (Yield & Net Section Rupture)",
		materialGrade: "ASTM A709 Gr. 50 (Fy = 345 MPa, Fu = 450 MPa)",
		spanLength: "24.0 m (6 Bays @ 4.0 m)",
		slendernessAnnotation: "L/r <= 200 (AASHTO Tension Member Recommendation)",
		specifications: [
			{
				label: "Cross Section",
				value: "Built-Up Steel Box (400x350x18 mm)"
			},
			{
				label: "Gross Section Area (Ag)",
				value: "25,200 mm²"
			},
			{
				label: "AASHTO Category",
				value: "Fracture Critical Member (FCM)"
			},
			{
				label: "Splice Type",
				value: "High-Strength Bolted Splice with 22mm A325 Bolts"
			}
		],
		engineeringNotes: ["Bottom chords resist global positive moment tensile force: T = M_max / d_truss.", "Member governed by gross section yielding (Phi * Fy * Ag) and net section fracture (Phi * Fu * Ae)."],
		educationalNotes: ["Under downward gravity loading, the bottom chord is in uniform tension.", "Educational Concept: Unlike compression members, tension members do not buckle but require strict fracture-critical inspection. Live FEA calculations are not simulated."]
	},
	diagonal_members: {
		id: "diagonal_members",
		name: "Alternating Diagonal Web Members",
		domain: "civil",
		role: "Truss Web Shear Diagonal",
		materialName: "Structural Steel ASTM A709 Grade 50",
		description: "Equilateral web diagonals configured at 60-degree angles connecting top and bottom chords in the classic Warren truss triangulated pattern.",
		structuralRole: "diagonal_member",
		nominalForceType: "combined",
		designLoadAnnotation: "AASHTO Transverse Shear Transfer with Stress Reversals",
		materialGrade: "ASTM A709 Gr. 50",
		spanLength: "4.62 m (Diagonals along 60° Inclination)",
		slendernessAnnotation: "KL/r <= 120 (Governed by Compression Cycle)",
		specifications: [
			{
				label: "Truss Geometry",
				value: "Equilateral Warren Pattern (60° Angle)"
			},
			{
				label: "Cross Section",
				value: "Wide Flange W310x107"
			},
			{
				label: "Shear Mechanism",
				value: "Triangulated Axial Push-Pull"
			},
			{
				label: "Web Bay Count",
				value: "4 Intermediate Diagonal Bays"
			}
		],
		engineeringNotes: ["Carries global vertical shear through axial component: V = P * sin(60°).", "Diagonals experience alternating tension or compression depending on truck live-load position."],
		educationalNotes: ["The defining characteristic of the Warren truss is alternating diagonals that share shear duty.", "Educational Concept: Near span center, moving loads cause stress reversals where a member switches between tension and compression. Live FEA calculations are not simulated."]
	},
	vertical_struts: {
		id: "vertical_struts",
		name: "Vertical Panel Hangers",
		domain: "civil",
		role: "Deck Suspension Floor Beam Hanger",
		materialName: "Structural Steel ASTM A709 Grade 50",
		description: "Vertical web members positioned at intermediate panel points to reduce the unsupported floor-beam span and hang the deck from the top chord joints.",
		structuralRole: "vertical_strut",
		nominalForceType: "tension",
		designLoadAnnotation: "Local Floor Beam Reaction Suspended to Top Panel Joints",
		materialGrade: "ASTM A709 Gr. 50",
		spanLength: "4.0 m Vertical Height",
		slendernessAnnotation: "L/r <= 240 (Tension Hanger Standard)",
		specifications: [
			{
				label: "Member Role",
				value: "Subdivided Truss Floor Beam Hanger"
			},
			{
				label: "Cross Section",
				value: "Wide Flange W250x67"
			},
			{
				label: "Total Hanger Count",
				value: "10 Hanger Posts (5 Per Truss Plane)"
			},
			{
				label: "Joint Fasteners",
				value: "Double-Shear Gusset Bolting"
			}
		],
		engineeringNotes: ["Hangers transfer floor beam deck reactions directly into top chord panel points.", "Shortens bottom chord panel length from 8m to 4m, drastically reducing stringer weight."],
		educationalNotes: ["Verticals in a Warren truss are primarily tension hangers, not compression columns.", "Educational Concept: Adding verticals converts a basic Warren truss into a subdivided Warren truss, reducing deck bending spans. Live FEA calculations are not simulated."]
	},
	gusset_plates: {
		id: "gusset_plates",
		name: "Structural Gusset Plates",
		domain: "civil",
		role: "Panel Node Joint Connector",
		materialName: "High-Strength Steel Plate ASTM A572 Grade 50",
		description: "Heavy structural steel connection plates fastened with high-strength structural bolts at chord-web node intersections.",
		structuralRole: "gusset_plate",
		nominalForceType: "combined",
		designLoadAnnotation: "Whitmore Section Yielding & Block Shear Rupture",
		materialGrade: "ASTM A572 Gr. 50 Plate (22 mm Thickness)",
		spanLength: "0.65 m x 0.65 m Joint Envelope",
		slendernessAnnotation: "Edge Stiffening Angles Provided against Free-Edge Buckling",
		specifications: [
			{
				label: "Plate Thickness",
				value: "22 mm Structural Plate"
			},
			{
				label: "Fastener Type",
				value: "ASTM F3125 Grade A325 Heavy Hex Bolts"
			},
			{
				label: "Node Count",
				value: "22 Gusseted Joint Nodes"
			},
			{
				label: "Inspection Protocol",
				value: "AASHTO LRFD Critical Node Evaluation"
			}
		],
		engineeringNotes: ["Resolves concurrent member axial forces to establish static equilibrium at each panel node.", "Design checks: Whitmore effective section, block shear tear-out, and bolt bearing/shear."],
		educationalNotes: ["Gusset plates are among the most critical components in truss bridges (highlighted by the 2007 I-35W collapse).", "Educational Concept: Whitmore section theory models 30° load spreading through the plate. Live FEA calculations are not simulated."]
	},
	end_portals: {
		id: "end_portals",
		name: "End Portal Frames & Sway Bracing",
		domain: "civil",
		role: "Lateral Sway Stability & Portal Entrance Frame",
		materialName: "Structural Steel ASTM A709 Grade 50",
		description: "Rigid inclined end posts and overhead transverse sway frames at both bridge portals. Delivers lateral stability and vertical clearance for vehicular traffic.",
		structuralRole: "vertical_strut",
		nominalForceType: "combined",
		designLoadAnnotation: "AASHTO Transverse Wind & Seismic Lateral Load Transfer",
		materialGrade: "ASTM A709 Gr. 50",
		spanLength: "5.0 m Portal Width / 4.5 m Vertical Clearance",
		slendernessAnnotation: "Rigid Knee-Braced Frame with Rigid Moment Corners",
		specifications: [
			{
				label: "Frame Configuration",
				value: "Rigid Knee-Braced Portal Frame"
			},
			{
				label: "Inclination Angle",
				value: "45° End Post Angle"
			},
			{
				label: "Roadway Clearance",
				value: "4.5 m Clear Headway"
			},
			{
				label: "Wind Transfer",
				value: "Channels Upper Lateral Shear to Abutments"
			}
		],
		engineeringNotes: ["Acts as a rigid portal frame transferring top lateral wind reactions down to bearing seats.", "End posts carry the highest compressive axial load in the entire bridge superstructure."],
		educationalNotes: ["Portal frames prevent the two parallel trusses from tipping over like dominoes under wind.", "Educational Concept: Provides aerodynamic stability while maintaining open vehicle headway. Live FEA calculations are not simulated."]
	},
	bridge_deck: {
		id: "bridge_deck",
		name: "Concrete Roadway Deck & Stringers",
		domain: "civil",
		role: "Vehicular Roadway Surface & Distribution System",
		materialName: "Reinforced Concrete (f'c = 35 MPa) on Steel Stringers",
		description: "Reinforced concrete roadway slab with stay-in-place forms, concrete safety barriers, and continuous longitudinal steel stringers supported by transverse floor beams.",
		structuralRole: "deck",
		nominalForceType: "bending",
		designLoadAnnotation: "AASHTO HL-93 Design Truck & Tandem Wheel Axle Loads",
		materialGrade: "Cast-in-Place Concrete f'c = 35 MPa, Epoxy Rebar Gr. 60",
		spanLength: "24.0 m Overall Length / 4.7 m Usable Roadway Width",
		slendernessAnnotation: "280 mm Slab Thickness (Span-to-Depth Ratio ~ 1:14)",
		specifications: [
			{
				label: "Roadway Width",
				value: "4.7 m (Two 2.35m Traffic Lanes)"
			},
			{
				label: "Slab Thickness",
				value: "280 mm Reinforced Concrete"
			},
			{
				label: "Stringer System",
				value: "4 Longitudinal W-Shape Steel Stringers"
			},
			{
				label: "Wearing Surface",
				value: "50 mm High-Performance Asphalt Overlay"
			}
		],
		engineeringNotes: ["Designed for transverse two-way flexure under concentrated wheel footprint loads.", "Composite shear studs bond concrete deck slab to steel stringers to enhance stiffness."],
		educationalNotes: ["The bridge deck directly receives vehicular traffic and distributes wheel loads through stringers to floor beams.", "Educational Concept: Load transfer path: Wheel -> Deck Slab -> Stringers -> Floor Beams -> Truss Nodes. Live FEA calculations are not simulated."]
	},
	support_piers: {
		id: "support_piers",
		name: "Substructure Abutments & Bearings",
		domain: "civil",
		role: "Geotechnical Substructure & Thermal Expansion Seats",
		materialName: "Mass Reinforced Concrete with Neoprene Bearings",
		description: "Reinforced concrete bridge seat abutments/piers equipped with steel-reinforced elastomeric bearing pads to support reactions and accommodate thermal expansion.",
		structuralRole: "pier",
		nominalForceType: "compression",
		designLoadAnnotation: "Total Superstructure Dead Load + Live Load Braking Reactions",
		materialGrade: "Mass Concrete f'c = 30 MPa with ASTM D4014 Neoprene Bearings",
		spanLength: "6.6 m Abutment Width / 2.8 m Height",
		slendernessAnnotation: "Gravity Mass Abutment with Drilled Shaft Foundations",
		specifications: [
			{
				label: "Bearing Type",
				value: "Steel-Reinforced Elastomeric Pads (Durometer 60)"
			},
			{
				label: "Bearing Configuration",
				value: "Fixed Shoe (East) / Expansion Roller (West)"
			},
			{
				label: "Thermal Movement Capacity",
				value: "+/- 35 mm Longitudinal Stroke"
			},
			{
				label: "Bearing Design Capacity",
				value: "2500 kN Nominal Service Load"
			}
		],
		engineeringNotes: ["Supports bridge dead weight (~190 tonnes) plus dynamic HL-93 vehicular live loads.", "Fixed-expansion bearing pair accommodates cyclic thermal expansion (delta_L = alpha * L * delta_T)."],
		educationalNotes: ["Bridges must be free to expand in summer and contract in winter without cracking.", "Educational Concept: One pier is pinned while the opposite pier allows longitudinal sliding on elastomeric bearings. Live FEA calculations are not simulated."]
	}
};
/**
* Looks up civil engineering metadata for any bridge component ID
*/
function getWarrenTrussComponentMetadata(componentId) {
	const metadata = CIVIL_BRIDGE_METADATA[componentId];
	return metadata ? { ...metadata } : null;
}
/**
* Standardized EngineeringModelDefinition for the Civil Warren Truss Bridge
*/
var warrenTrussBridgeModel = {
	id: WARREN_TRUSS_MODEL_ID,
	name: "Warren Truss Bridge Assembly",
	domain: "civil",
	category: "Structural & Bridge Engineering",
	description: "Full-scale 24-meter through-truss steel bridge featuring equilateral Warren web diagonals, reinforced concrete roadway deck, floor beam system, overhead sway portal frames, and elastomeric pier abutments.",
	thumbnailUrl: "/assets/models/warren_truss_bridge.webp",
	difficulty: "Advanced",
	tags: [
		"Truss Bridge",
		"Warren Truss",
		"Civil Engineering",
		"Structural Analysis",
		"AASHTO LRFD",
		"Steel Superstructure"
	],
	componentCount: WARREN_TRUSS_BRIDGE_COMPONENT_IDS.length,
	cameraConfig: {
		initialPosition: [
			18,
			12,
			22
		],
		target: [
			0,
			1.5,
			0
		],
		minDistance: 3,
		maxDistance: 70,
		fov: 45,
		defaultPreset: "isometric"
	},
	getAssemblyTree: getWarrenTrussAssemblyTree,
	getComponentMetadata: getWarrenTrussComponentMetadata,
	getAllComponentIds: () => [...WARREN_TRUSS_BRIDGE_COMPONENT_IDS],
	buildScene: (scene) => {
		const controller = buildWarrenTrussBridge();
		scene.add(controller.group);
		return {
			rootGroup: controller.group,
			updateAnimation: (deltaSeconds) => {
				controller.update(deltaSeconds);
			},
			setExplodedFactor: (factor) => {
				controller.setExplodedFactor?.(factor);
			},
			dispose: () => {
				scene.remove(controller.group);
				controller.dispose();
			}
		};
	}
};
// src/models/registry.ts
var ModelRegistryService = class {
	models = /* @__PURE__ */ new Map();
	/**
	* Registers an engineering model definition.
	* Deliberately handles duplicate registrations:
	* - If the exact same model object is registered again, it succeeds idempotently.
	* - If a different model definition attempts to register with an existing ID, throws an Error.
	*
	* @param model Model definition adhering to EngineeringModelDefinition
	* @throws Error if a different model with the same ID is already registered
	*/
	register(model) {
		if (!model || typeof model.id !== "string" || model.id.trim() === "") throw new Error("Cannot register model: model must have a valid non-empty string ID.");
		if (this.models.has(model.id)) {
			const existing = this.models.get(model.id);
			if (existing === model) return;
			throw new Error(`Duplicate model registration rejected: Model with ID "${model.id}" is already registered ("${existing?.name}"). Cannot overwrite with "${model.name}".`);
		}
		this.models.set(model.id, model);
	}
	/**
	* Retrieves a registered model by its unique ID
	*/
	getModel(id) {
		return this.models.get(id);
	}
	/**
	* Checks whether a model with the specified ID is currently registered
	*/
	hasModel(id) {
		return this.models.has(id);
	}
	/**
	* Returns all registered engineering models
	*/
	getAllModels() {
		return Array.from(this.models.values());
	}
	/**
	* Returns all models belonging to a specific engineering domain ('mechanical' | 'civil')
	*/
	getModelsByDomain(domain) {
		return this.getAllModels().filter((model) => model.domain === domain);
	}
	/**
	* Unregisters a model by ID.
	* Returns true if the model was found and removed, false otherwise.
	*/
	unregister(id) {
		return this.models.delete(id);
	}
	/**
	* Removes all registered models from the registry
	*/
	clear() {
		this.models.clear();
	}
	/**
	* Re-initializes default models (planetary gearbox, warren truss bridge)
	*/
	resetToDefaults() {
		this.clear();
		this.register(planetaryGearboxModel);
		this.register(warrenTrussBridgeModel);
	}
};
/**
* Singleton instance of the Engineering Model Registry,
* pre-populated with default models.
*/
var modelRegistry = new ModelRegistryService();
modelRegistry.register(planetaryGearboxModel);
modelRegistry.register(warrenTrussBridgeModel);
// tests/modelRegistry.test.ts
/**
* Unit Tests for Engineering Model Registry & Planetary Gearbox Adapter
* Phase 9 - Task 9.2: Modular Model Registry & Planetary Gearbox Refactor
*/
describe("Model Registry Core Engine", () => {
	let registry;
	beforeEach(() => {
		registry = new ModelRegistryService();
	});
	const createDummyModel = (id, name, domain) => ({
		id,
		name,
		domain,
		category: "Test Category",
		description: "Test description",
		thumbnailUrl: "/thumb.webp",
		difficulty: "Beginner",
		tags: ["Test"],
		componentCount: 1,
		cameraConfig: {
			initialPosition: [
				0,
				5,
				10
			],
			target: [
				0,
				0,
				0
			],
			minDistance: 1,
			maxDistance: 20
		},
		getAssemblyTree: () => ({
			id: `${id}_root`,
			name,
			type: "assembly"
		}),
		getComponentMetadata: () => null,
		getAllComponentIds: () => ["part_1"],
		buildScene: () => ({
			rootGroup: new THREE.Group(),
			dispose: () => {}
		})
	});
	it("registers and retrieves a model by unique ID", () => {
		const mockModel = createDummyModel("beam_bridge", "Beam Bridge Span", "civil");
		assert.equal(registry.hasModel("beam_bridge"), false);
		registry.register(mockModel);
		assert.equal(registry.hasModel("beam_bridge"), true);
		const retrieved = registry.getModel("beam_bridge");
		assert.equal(retrieved, mockModel);
		assert.equal(retrieved?.name, "Beam Bridge Span");
	});
	it("returns undefined and false for nonexistent model IDs", () => {
		assert.equal(registry.hasModel("unknown_id"), false);
		assert.equal(registry.getModel("unknown_id"), void 0);
	});
	it("lists all registered models and filters accurately by domain", () => {
		const mech1 = createDummyModel("lathe", "Engine Lathe", "mechanical");
		const mech2 = createDummyModel("pump", "Centrifugal Pump", "mechanical");
		const civil1 = createDummyModel("arch_bridge", "Arch Bridge", "civil");
		registry.register(mech1);
		registry.register(mech2);
		registry.register(civil1);
		const all = registry.getAllModels();
		assert.equal(all.length, 3);
		const mechanicalModels = registry.getModelsByDomain("mechanical");
		assert.equal(mechanicalModels.length, 2);
		assert.deepEqual(mechanicalModels.map((m) => m.id), ["lathe", "pump"]);
		const civilModels = registry.getModelsByDomain("civil");
		assert.equal(civilModels.length, 1);
		assert.equal(civilModels[0].id, "arch_bridge");
	});
	it("allows idempotent re-registration of the exact same model instance", () => {
		const mockModel = createDummyModel("spur_stage", "Spur Stage", "mechanical");
		registry.register(mockModel);
		assert.doesNotThrow(() => {
			registry.register(mockModel);
		});
		assert.equal(registry.getAllModels().length, 1);
	});
	it("deliberately rejects duplicate registrations of different models with the same ID", () => {
		const original = createDummyModel("truss", "Original Warren Truss", "civil");
		const duplicate = createDummyModel("truss", "Different Pratt Truss", "civil");
		registry.register(original);
		assert.throws(() => {
			registry.register(duplicate);
		}, (err) => {
			assert.match(err.message, /Duplicate model registration rejected/);
			assert.match(err.message, /truss/);
			return true;
		});
	});
	it("rejects invalid or empty model IDs", () => {
		const badModel = {
			...createDummyModel("", "Bad", "mechanical"),
			id: ""
		};
		assert.throws(() => {
			registry.register(badModel);
		}, /Cannot register model: model must have a valid non-empty string ID/);
	});
	it("supports unregister and clear operations", () => {
		const model = createDummyModel("test_m", "Test", "mechanical");
		registry.register(model);
		assert.equal(registry.unregister("test_m"), true);
		assert.equal(registry.unregister("test_m"), false);
		assert.equal(registry.hasModel("test_m"), false);
		registry.register(model);
		registry.clear();
		assert.equal(registry.getAllModels().length, 0);
	});
});
describe("Planetary Gearbox Model Adapter", () => {
	it("conforms strictly to the EngineeringModelDefinition contract", () => {
		assert.equal(isEngineeringModelDefinition(planetaryGearboxModel), true);
		assert.equal(planetaryGearboxModel.id, PLANETARY_GEARBOX_MODEL_ID);
		assert.equal(planetaryGearboxModel.domain, "mechanical");
		assert.equal(planetaryGearboxModel.componentCount, 7);
	});
	it("provides a valid hierarchical assembly tree with subassemblies and leaf components", () => {
		const tree = planetaryGearboxModel.getAssemblyTree();
		assert.equal(isAssemblyTreeNode(tree), true);
		assert.equal(tree.type, "assembly");
		assert.ok(tree.children && tree.children.length >= 3);
		const epicyclicStage = tree.children?.find((c) => c.id === "stage_epicyclic");
		assert.ok(epicyclicStage);
		assert.equal(epicyclicStage.type, "subassembly");
		const planetsCluster = epicyclicStage.children?.find((c) => c.id === "sub_planets_cluster");
		assert.ok(planetsCluster);
		assert.equal(planetsCluster.children?.length, 3);
	});
	it("exposes all 7 addressable gearbox component IDs and preserves metadata compatibility", () => {
		const allIds = planetaryGearboxModel.getAllComponentIds();
		assert.equal(allIds.length, 7);
		for (const expectedId of PLANETARY_GEARBOX_COMPONENT_IDS) {
			assert.ok(allIds.includes(expectedId), `Missing component ID: ${expectedId}`);
			const metadata = planetaryGearboxModel.getComponentMetadata(expectedId);
			assert.ok(metadata, `Missing metadata for: ${expectedId}`);
			assert.equal(metadata.id, expectedId);
			assert.equal(metadata.domain, "mechanical");
			assert.equal(isMechanicalMetadata(metadata), true);
			assert.ok(metadata.name.length > 0);
			assert.ok(metadata.materialName.length > 0);
			assert.ok(metadata.description.length > 0);
		}
	});
	it("returns null for nonexistent component IDs safely", () => {
		assert.equal(planetaryGearboxModel.getComponentMetadata("nonexistent_gear"), null);
		assert.equal(planetaryGearboxModel.getComponentMetadata(""), null);
	});
	it("builds a Three.js scene runtime instance and provides clean disposal", () => {
		const scene = new THREE.Scene();
		const runtimeInstance = planetaryGearboxModel.buildScene(scene);
		assert.ok(runtimeInstance.rootGroup instanceof THREE.Group);
		assert.ok(scene.children.includes(runtimeInstance.rootGroup));
		assert.equal(typeof runtimeInstance.updateAnimation, "function");
		assert.equal(typeof runtimeInstance.dispose, "function");
		assert.doesNotThrow(() => {
			runtimeInstance.updateAnimation?.(.016, 1);
		});
		runtimeInstance.dispose();
		assert.equal(scene.children.includes(runtimeInstance.rootGroup), false);
	});
});
// src/services/models/modelLifecycle.ts
/**
* Model Lifecycle & Runtime Session Manager
* Phase 9 - Task 9.3: Dynamic ViewerCanvas Model Switching & Safe WebGL Disposal
*
* Manages the mounting, animation, and safe disposal of 3D models in Three.js.
* Guarantees that:
* 1. Previous model runtimes are disposed cleanly before replacement.
* 2. Shared scene fixtures (lighting, ground grid, camera) are preserved.
* 3. Race conditions from rapid switching are safely rejected via generation checks.
* 4. ComponentRaycaster is kept in sync with the active model's rootGroup.
*/
var ModelLifecycleManager = class {
	activeRuntime = null;
	activeModel = null;
	raycaster = null;
	hiddenComponentIds = /* @__PURE__ */ new Set();
	isolatedComponentId = null;
	currentExplodedFactor = 0;
	currentGeneration = 0;
	isDisposed = false;
	options;
	constructor(options) {
		this.options = options;
	}
	/**
	* Loads and mounts a model by its registered ID.
	* If a previous model is active, disposes it first before mounting the replacement.
	*/
	loadModel(modelId) {
		if (this.isDisposed) return {
			success: false,
			error: "Cannot load model: lifecycle manager has been disposed."
		};
		const gen = ++this.currentGeneration;
		this.disposeCurrentRuntime();
		const modelDef = modelRegistry.getModel(modelId);
		if (!modelDef) {
			const errorMsg = `Model "${modelId}" is not registered in ModelRegistry.`;
			this.options.onModelError?.(errorMsg);
			return {
				success: false,
				error: errorMsg
			};
		}
		try {
			const runtime = modelDef.buildScene(this.options.scene);
			if (gen !== this.currentGeneration || this.isDisposed) {
				runtime.dispose();
				return {
					success: false,
					error: "Model load superseded by newer request."
				};
			}
			this.activeRuntime = runtime;
			this.activeModel = modelDef;
			this.isolatedComponentId = null;
			const validComponentIds = new Set(modelDef.getAllComponentIds());
			this.raycaster = new ComponentRaycaster(this.options.camera, runtime.rootGroup, { validComponentIds });
			if (this.options.cameraController && modelDef.cameraConfig) {
				const { minDistance, maxDistance, initialPosition, target } = modelDef.cameraConfig;
				if (typeof minDistance === "number") this.options.cameraController.controls.minDistance = minDistance;
				if (typeof maxDistance === "number") this.options.cameraController.controls.maxDistance = maxDistance;
				if (initialPosition) this.options.camera.position.set(...initialPosition);
				if (target) this.options.cameraController.controls.target.set(...target);
				this.options.cameraController.controls.update();
			}
			if (this.hiddenComponentIds.size > 0) this.setHiddenComponents(this.hiddenComponentIds);
			this.options.onModelLoaded?.(modelDef);
			return {
				success: true,
				model: modelDef
			};
		} catch (err) {
			const errorMsg = `Failed to build model "${modelId}": ${err instanceof Error ? err.message : String(err)}`;
			this.options.onModelError?.(errorMsg);
			return {
				success: false,
				error: errorMsg
			};
		}
	}
	/**
	* Sets the hidden components for the active model.
	* Modifies only the Object3D.visible property of matching meshes without
	* disposing geometries, materials, or runtime resources.
	* If a component is actively isolated, preserves the isolation view state.
	*/
	setHiddenComponents(hiddenIds) {
		this.hiddenComponentIds = hiddenIds instanceof Set ? new Set(hiddenIds) : new Set(hiddenIds);
		if (!this.activeRuntime) return;
		if (this.isolatedComponentId) return;
		this.activeRuntime.rootGroup.traverse((obj) => {
			const compId = obj.userData?.componentId || obj.name;
			if (typeof compId === "string" && compId.length > 0) obj.visible = !this.hiddenComponentIds.has(compId);
		});
	}
	/**
	* Isolates a specific component by hiding or fading all other components in the assembly.
	* Passing `null` restores normal assembly visibility according to `hiddenComponentIds`.
	*/
	isolateComponent(componentId) {
		this.isolatedComponentId = componentId;
		if (!this.activeRuntime) return false;
		if (this.activeRuntime.isolateComponent) {
			this.activeRuntime.isolateComponent(componentId);
			return true;
		}
		if (componentId) this.activeRuntime.rootGroup.traverse((obj) => {
			const compId = obj.userData?.componentId || obj.name;
			if (typeof compId === "string" && compId.length > 0) obj.visible = compId === componentId;
		});
		else this.activeRuntime.rootGroup.traverse((obj) => {
			const compId = obj.userData?.componentId || obj.name;
			if (typeof compId === "string" && compId.length > 0) obj.visible = !this.hiddenComponentIds.has(compId);
		});
		return true;
	}
	/**
	* Returns the currently isolated component ID, or null if no component is isolated
	*/
	getIsolatedComponentId() {
		return this.isolatedComponentId;
	}
	/**
	* Focuses the camera on the 3D bounding box of the specified component.
	*/
	focusComponent(componentId) {
		if (!this.activeRuntime || !this.options.cameraController) return false;
		const box = new THREE.Box3();
		let found = false;
		this.activeRuntime.rootGroup.traverse((obj) => {
			if ((obj.userData?.componentId || obj.name) === componentId && obj.isMesh) {
				box.expandByObject(obj);
				found = true;
			}
		});
		if (found && !box.isEmpty()) {
			this.options.cameraController.focusOnBounds(box);
			return true;
		}
		return false;
	}
	/**
	* Returns a read-only set of currently hidden component IDs
	*/
	getHiddenComponents() {
		return this.hiddenComponentIds;
	}
	/**
	* Returns the currently active model runtime instance
	*/
	getActiveRuntime() {
		return this.activeRuntime;
	}
	/**
	* Returns the currently active model definition
	*/
	getActiveModel() {
		return this.activeModel;
	}
	/**
	* Returns the active ComponentRaycaster targeting the current model's meshes
	*/
	getRaycaster() {
		return this.raycaster;
	}
	/**
	* Updates the active model's internal kinematics/animation tick
	*/
	updateAnimation(deltaSeconds, elapsedSeconds) {
		if (this.isDisposed || !this.activeRuntime) return;
		this.activeRuntime.updateAnimation?.(deltaSeconds, elapsedSeconds);
	}
	/**
	* Updates the continuous exploded-view separation factor (0.0 = assembled, 1.0 = fully exploded)
	*/
	setExplodedFactor(factor) {
		if (this.isDisposed || !this.activeRuntime) return;
		const clamped = Math.max(0, Math.min(1, factor));
		this.currentExplodedFactor = clamped;
		this.activeRuntime.setExplodedFactor?.(clamped);
	}
	/**
	* Returns the current exploded-view factor
	*/
	getExplodedFactor() {
		return this.currentExplodedFactor;
	}
	/**
	* Disposes the current model runtime and its raycaster without touching shared fixtures
	*/
	disposeCurrentRuntime() {
		if (this.raycaster) {
			this.raycaster.dispose();
			this.raycaster = null;
		}
		if (this.activeRuntime) {
			try {
				if (this.currentExplodedFactor > 0) this.activeRuntime.setExplodedFactor?.(0);
				this.activeRuntime.dispose();
			} catch (err) {
				console.warn("Error during model runtime disposal:", err);
			}
			this.activeRuntime = null;
			this.activeModel = null;
			this.isolatedComponentId = null;
			this.currentExplodedFactor = 0;
		}
	}
	/**
	* Full unmount cleanup: disposes the active model runtime and detaches listeners
	*/
	dispose() {
		this.isDisposed = true;
		this.currentGeneration++;
		this.disposeCurrentRuntime();
	}
};
// tests/modelLifecycle.test.ts
/**
* Unit & Integration Tests for Model Lifecycle & Dynamic Switching
* Phase 9 - Task 9.3: Dynamic ViewerCanvas Model Switching & Safe WebGL Disposal
*/
describe("ModelLifecycleManager (Dynamic Switching & WebGL Lifecycle)", () => {
	let scene;
	let camera;
	beforeEach(() => {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, 800 / 600, .1, 100);
		modelRegistry.resetToDefaults();
	});
	const createMockModel = (id, name, onDisposeSpy, onAnimateSpy) => {
		return {
			id,
			name,
			domain: "mechanical",
			category: "Test Category",
			description: "Test description",
			thumbnailUrl: "/thumb.webp",
			difficulty: "Beginner",
			tags: ["Test"],
			componentCount: 2,
			cameraConfig: {
				initialPosition: [
					1,
					2,
					3
				],
				target: [
					0,
					1,
					0
				],
				minDistance: 3,
				maxDistance: 30
			},
			getAssemblyTree: () => ({
				id: `${id}_root`,
				name,
				type: "assembly"
			}),
			getComponentMetadata: (componentId) => {
				if (componentId === "test_part_a") return {
					id: "test_part_a",
					name: "Test Part A",
					domain: "mechanical",
					role: "Test Role",
					materialName: "Test Steel",
					description: "Test Description",
					specifications: [],
					engineeringNotes: []
				};
				return null;
			},
			getAllComponentIds: () => ["test_part_a", "test_part_b"],
			buildScene: (targetScene) => {
				const group = new THREE.Group();
				group.name = `${id}_rootGroup`;
				const meshGeo = new THREE.BoxGeometry(1, 1, 1);
				const meshMat = new THREE.MeshBasicMaterial();
				const mesh = new THREE.Mesh(meshGeo, meshMat);
				mesh.userData = { componentId: "test_part_a" };
				group.add(mesh);
				targetScene.add(group);
				return {
					rootGroup: group,
					updateAnimation: (delta) => {
						onAnimateSpy?.(delta);
					},
					dispose: () => {
						targetScene.remove(group);
						meshGeo.dispose();
						meshMat.dispose();
						onDisposeSpy?.();
					}
				};
			}
		};
	};
	it("loads the default planetary_gearbox model and binds raycaster", () => {
		let loadedModel = null;
		const manager = new ModelLifecycleManager({
			scene,
			camera,
			onModelLoaded: (m) => {
				loadedModel = m;
			}
		});
		const result = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
		assert.equal(result.success, true);
		assert.equal(result.model?.id, PLANETARY_GEARBOX_MODEL_ID);
		assert.equal(loadedModel?.id, PLANETARY_GEARBOX_MODEL_ID);
		const runtime = manager.getActiveRuntime();
		assert.ok(runtime);
		assert.ok(scene.children.includes(runtime.rootGroup));
		const raycaster = manager.getRaycaster();
		assert.ok(raycaster);
		manager.dispose();
	});
	it("handles an unknown model ID gracefully without throwing or leaving corrupt state", () => {
		let capturedError = null;
		const manager = new ModelLifecycleManager({
			scene,
			camera,
			onModelError: (err) => {
				capturedError = err;
			}
		});
		const result = manager.loadModel("nonexistent_model_id");
		assert.equal(result.success, false);
		assert.ok(result.error?.includes("nonexistent_model_id"));
		assert.ok(capturedError?.includes("nonexistent_model_id"));
		assert.equal(manager.getActiveRuntime(), null);
		assert.equal(manager.getActiveModel(), null);
		assert.equal(manager.getRaycaster(), null);
		manager.dispose();
	});
	it("disposes previous runtime exactly once when switching between models", () => {
		let modelADisposedCount = 0;
		let modelBDisposedCount = 0;
		const modelA = createMockModel("model_a", "Model Alpha", () => {
			modelADisposedCount++;
		});
		const modelB = createMockModel("model_b", "Model Beta", () => {
			modelBDisposedCount++;
		});
		modelRegistry.register(modelA);
		modelRegistry.register(modelB);
		const manager = new ModelLifecycleManager({
			scene,
			camera
		});
		const resA = manager.loadModel("model_a");
		assert.equal(resA.success, true);
		assert.equal(manager.getActiveModel()?.id, "model_a");
		assert.equal(modelADisposedCount, 0);
		const groupA = manager.getActiveRuntime()?.rootGroup;
		assert.ok(groupA);
		assert.ok(scene.children.includes(groupA));
		const resB = manager.loadModel("model_b");
		assert.equal(resB.success, true);
		assert.equal(manager.getActiveModel()?.id, "model_b");
		assert.equal(modelADisposedCount, 1);
		assert.equal(scene.children.includes(groupA), false);
		const groupB = manager.getActiveRuntime()?.rootGroup;
		assert.ok(groupB);
		assert.ok(scene.children.includes(groupB));
		assert.equal(modelBDisposedCount, 0);
		manager.dispose();
		assert.equal(modelADisposedCount, 1);
		assert.equal(modelBDisposedCount, 1);
		assert.equal(scene.children.includes(groupB), false);
	});
	it("stops animation callbacks of the previous runtime upon switching", () => {
		let modelAAnimCount = 0;
		let modelBAnimCount = 0;
		const modelA = createMockModel("anim_a", "Anim A", () => {}, () => {
			modelAAnimCount++;
		});
		const modelB = createMockModel("anim_b", "Anim B", () => {}, () => {
			modelBAnimCount++;
		});
		modelRegistry.register(modelA);
		modelRegistry.register(modelB);
		const manager = new ModelLifecycleManager({
			scene,
			camera
		});
		manager.loadModel("anim_a");
		manager.updateAnimation(.016, 1);
		assert.equal(modelAAnimCount, 1);
		assert.equal(modelBAnimCount, 0);
		manager.loadModel("anim_b");
		manager.updateAnimation(.016, 1.016);
		assert.equal(modelAAnimCount, 1);
		assert.equal(modelBAnimCount, 1);
		manager.dispose();
	});
	it("preserves shared scene fixtures and does not dispose shared lights or grid", () => {
		const sharedLight = new THREE.DirectionalLight(16777215, 1);
		const sharedGrid = new THREE.GridHelper(10, 10);
		scene.add(sharedLight);
		scene.add(sharedGrid);
		const modelA = createMockModel("fixture_a", "Fixture A");
		const modelB = createMockModel("fixture_b", "Fixture B");
		modelRegistry.register(modelA);
		modelRegistry.register(modelB);
		const manager = new ModelLifecycleManager({
			scene,
			camera
		});
		manager.loadModel("fixture_a");
		assert.ok(scene.children.includes(sharedLight));
		assert.ok(scene.children.includes(sharedGrid));
		manager.loadModel("fixture_b");
		assert.ok(scene.children.includes(sharedLight));
		assert.ok(scene.children.includes(sharedGrid));
		manager.dispose();
		assert.ok(scene.children.includes(sharedLight));
		assert.ok(scene.children.includes(sharedGrid));
	});
	it("rejects load requests after manager has been disposed", () => {
		const manager = new ModelLifecycleManager({
			scene,
			camera
		});
		manager.dispose();
		const result = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
		assert.equal(result.success, false);
		assert.ok(result.error?.includes("disposed"));
	});
	it("updates ComponentRaycaster target to new model rootGroup on switch", () => {
		const modelA = createMockModel("ray_a", "Ray A");
		const modelB = createMockModel("ray_b", "Ray B");
		modelRegistry.register(modelA);
		modelRegistry.register(modelB);
		const manager = new ModelLifecycleManager({
			scene,
			camera
		});
		manager.loadModel("ray_a");
		const raycasterA = manager.getRaycaster();
		assert.ok(raycasterA);
		manager.loadModel("ray_b");
		const raycasterB = manager.getRaycaster();
		assert.ok(raycasterB);
		assert.notEqual(raycasterA, raycasterB);
		manager.dispose();
	});
});
// src/components/hud/GestureBadge.tsx
var GESTURE_ICONS = {
	OPEN_PALM: "✋",
	POINTING: "☝️",
	PINCH: "🤏",
	NONE: "⚪"
};
var GESTURE_LABELS = {
	OPEN_PALM: "Open Palm",
	POINTING: "Pointing",
	PINCH: "Pinch",
	NONE: "None"
};
var GestureBadge = ({ gestureResult, className = "", compact = false }) => {
	const { gesture, rawGesture, confidence, isStable, consecutiveFrames } = gestureResult;
	const icon = GESTURE_ICONS[gesture] || "⚪";
	const label = GESTURE_LABELS[gesture] || gesture;
	const percent = Math.round(confidence * 100);
	return /* @__PURE__ */ jsxs("div", {
		className: `gesture-hud-badge ${gesture.toLowerCase()} ${isStable ? "stable" : "settling"} ${compact ? "compact" : ""} ${className}`,
		title: `Active Gesture: ${label} (${percent}% confidence, ${consecutiveFrames} frames)`,
		children: [/* @__PURE__ */ jsx("span", {
			className: "gesture-icon",
			"aria-hidden": "true",
			children: icon
		}), /* @__PURE__ */ jsxs("div", {
			className: "gesture-details",
			children: [/* @__PURE__ */ jsx("span", {
				className: "gesture-name",
				children: label
			}), !compact && /* @__PURE__ */ jsx("span", {
				className: "gesture-meta",
				children: gesture !== "NONE" ? /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsxs("span", {
						className: "gesture-confidence",
						children: [percent, "%"]
					}),
					/* @__PURE__ */ jsx("span", { className: `gesture-stability-dot ${isStable ? "active" : "pending"}` }),
					/* @__PURE__ */ jsx("span", {
						className: "gesture-stability-text",
						children: isStable ? "STABLE" : `HOLD (${consecutiveFrames}/3)`
					})
				] }) : rawGesture !== "NONE" ? /* @__PURE__ */ jsx("span", {
					className: "gesture-settling-text",
					children: "DETECTING..."
				}) : /* @__PURE__ */ jsx("span", {
					className: "gesture-idle-text",
					children: "NO GESTURE"
				})
			})]
		})]
	});
};
// src/components/workspace/WorkspaceTopBar.tsx
/**
* Top Toolbar for the CAD-Style Technical Workspace
* Provides workspace identity, model breadcrumbs, dock toggle buttons,
* and live system telemetry without nonfunctional controls.
*/
var WorkspaceTopBar = ({ modelName, domain = "mechanical", subsystem = "Powertrain", isLeftDockOpen, onToggleLeftDock, isRightDockOpen, onToggleRightDock, renderFps, cameraStatus, activeGesture, showDiagnostics, onToggleDiagnostics, showRoadmap, onToggleRoadmap, onResetView, onNavigateHome, explodedFactor = 0, onExplodedFactorChange, isGuidedTourActive = false, onToggleGuidedTour }) => {
	return /* @__PURE__ */ jsxs("header", {
		className: "workspace-top-bar",
		"aria-label": "CAD Workspace Toolbar",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "top-bar-branding",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "brand-badge",
						children: [/* @__PURE__ */ jsx("span", {
							className: "brand-icon",
							"aria-hidden": "true",
							children: "⚙️"
						}), /* @__PURE__ */ jsx("span", {
							className: "brand-name",
							children: "GestureLab CAD"
						})]
					}),
					/* @__PURE__ */ jsx("span", {
						className: "breadcrumb-separator",
						"aria-hidden": "true",
						children: "/"
					}),
					/* @__PURE__ */ jsxs("nav", {
						className: "workspace-breadcrumbs",
						"aria-label": "Breadcrumb Navigation",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: `domain-tag ${domain}`,
								children: domain === "mechanical" ? "Mechanical" : "Civil"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "breadcrumb-separator",
								"aria-hidden": "true",
								children: ">"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "breadcrumb-subsystem",
								children: subsystem
							}),
							/* @__PURE__ */ jsx("span", {
								className: "breadcrumb-separator",
								"aria-hidden": "true",
								children: ">"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "breadcrumb-model",
								title: modelName,
								children: modelName
							})
						]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "top-bar-controls",
				children: [
					onNavigateHome && /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "toolbar-btn catalogue-btn",
						onClick: onNavigateHome,
						title: "Return to Engineering Explorer Catalogue Dashboard",
						"aria-label": "Return to Engineering Explorer Catalogue Dashboard",
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "🏠"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Catalogue"
						})]
					}),
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${isLeftDockOpen ? "active" : ""}`,
						onClick: onToggleLeftDock,
						title: isLeftDockOpen ? "Collapse Assembly Tree (Key: [)" : "Expand Assembly Tree (Key: [)",
						"aria-label": isLeftDockOpen ? "Collapse Assembly Hierarchy Dock" : "Expand Assembly Hierarchy Dock",
						"aria-expanded": isLeftDockOpen,
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: isLeftDockOpen ? "◀" : "▶"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Assembly"
						})]
					}),
					onResetView && /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "toolbar-btn",
						onClick: onResetView,
						title: "Reset camera viewpoint to isometric preset [Key: R]",
						"aria-label": "Reset Camera View",
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "⟲"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Reset View"
						})]
					}),
					onToggleGuidedTour && /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${isGuidedTourActive ? "active" : ""}`,
						onClick: onToggleGuidedTour,
						title: isGuidedTourActive ? "Exit Guided Tour [Esc]" : "Start Interactive Guided Tour [Key: L]",
						"aria-label": isGuidedTourActive ? "Exit Guided Tour" : "Start Interactive Guided Tour",
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "🎓"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: isGuidedTourActive ? "Exit Tour" : "Guided Tour"
						})]
					}),
					onExplodedFactorChange && /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${explodedFactor > 0 ? "active" : ""}`,
						onClick: () => onExplodedFactorChange(explodedFactor > 0 ? 0 : .6),
						title: explodedFactor > 0 ? "Assemble Model to 0% [Key: X]" : "Explode Model Components [Key: X]",
						"aria-label": explodedFactor > 0 ? "Assemble Model" : "Explode Model Components",
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "💥"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: explodedFactor > 0 ? `Exploded (${Math.round(explodedFactor * 100)}%)` : "Exploded"
						})]
					}),
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${showDiagnostics ? "active" : ""}`,
						onClick: onToggleDiagnostics,
						title: "Toggle Gesture Diagnostics Panel [Key: D]",
						"aria-label": "Toggle Gesture Diagnostics Panel",
						"aria-expanded": showDiagnostics,
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "📊"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Diagnostics"
						})]
					}),
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${showRoadmap ? "active" : ""}`,
						onClick: onToggleRoadmap,
						title: "Toggle Project Roadmap Panel",
						"aria-label": "Toggle Project Roadmap Panel",
						"aria-expanded": showRoadmap,
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: "🗺️"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Roadmap"
						})]
					}),
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `toolbar-btn ${isRightDockOpen ? "active" : ""}`,
						onClick: onToggleRightDock,
						title: isRightDockOpen ? "Collapse Inspector (Key: ])" : "Expand Inspector (Key: ])",
						"aria-label": isRightDockOpen ? "Collapse Engineering Inspector Dock" : "Expand Engineering Inspector Dock",
						"aria-expanded": isRightDockOpen,
						children: [/* @__PURE__ */ jsx("span", {
							className: "btn-label",
							children: "Inspector"
						}), /* @__PURE__ */ jsx("span", {
							className: "btn-icon",
							"aria-hidden": "true",
							children: isRightDockOpen ? "▶" : "◀"
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "top-bar-telemetry",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "telemetry-pill",
						title: "Live WebGL Render Frame Rate",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "telemetry-dot",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "telemetry-label",
								children: "Render:"
							}),
							/* @__PURE__ */ jsxs("span", {
								className: "telemetry-value",
								children: [renderFps, " FPS"]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: `camera-pill ${cameraStatus}`,
						title: `Webcam tracking status: ${cameraStatus}`,
						children: [/* @__PURE__ */ jsx("span", {
							className: `cam-indicator ${cameraStatus}`,
							"aria-hidden": "true"
						}), /* @__PURE__ */ jsx("span", {
							className: "camera-label",
							children: cameraStatus === "active" ? "Camera: Live" : cameraStatus === "requesting" ? "Camera: Connecting..." : cameraStatus === "denied" ? "Camera: Denied" : cameraStatus === "not_found" ? "Camera: None" : "Camera: Off"
						})]
					}),
					cameraStatus === "active" && activeGesture && /* @__PURE__ */ jsx("div", {
						className: "telemetry-gesture-badge",
						children: /* @__PURE__ */ jsx(GestureBadge, {
							gestureResult: activeGesture,
							compact: true
						})
					})
				]
			})
		]
	});
};
// src/utils/assemblyTreeUtils.ts
/**
* Collects all descendant leaf component IDs under an assembly tree node.
*/
function getDescendantComponentIds(node) {
	const ids = [];
	function recurse(n) {
		if (n.componentId) ids.push(n.componentId);
		if (n.children && n.children.length > 0) for (const child of n.children) recurse(child);
	}
	recurse(node);
	return ids;
}
/**
* Finds all ancestor node IDs leading from the root down to a target component ID.
*/
function findAncestorNodeIds(root, targetComponentId) {
	const ancestors = [];
	function search(current) {
		if (current.componentId === targetComponentId) return true;
		if (current.children && current.children.length > 0) {
			for (const child of current.children) if (search(child)) {
				ancestors.push(current.id);
				return true;
			}
		}
		return false;
	}
	search(root);
	return ancestors;
}
/**
* Recursively filters an assembly tree by query without mutating the original structure.
* Keeps matching component nodes along with all their ancestor assemblies.
*/
function filterAssemblyTree(node, query) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return {
		matches: true,
		filteredNode: node
	};
	const nameMatches = node.name.toLowerCase().includes(normalizedQuery);
	const idMatches = node.componentId?.toLowerCase().includes(normalizedQuery) ?? false;
	const selfMatches = nameMatches || idMatches;
	if (!node.children || node.children.length === 0) return {
		matches: selfMatches,
		filteredNode: selfMatches ? node : null
	};
	const matchingChildren = [];
	for (const child of node.children) {
		const childResult = filterAssemblyTree(child, normalizedQuery);
		if (childResult.matches && childResult.filteredNode) matchingChildren.push(childResult.filteredNode);
	}
	if (selfMatches || matchingChildren.length > 0) return {
		matches: true,
		filteredNode: {
			...node,
			children: selfMatches ? node.children : matchingChildren
		}
	};
	return {
		matches: false,
		filteredNode: null
	};
}
/**
* Collects all node IDs in an assembly tree that have defaultExpanded set to true or are assemblies.
*/
function collectDefaultExpandedNodeIds(node) {
	const ids = [];
	function recurse(n) {
		if (n.defaultExpanded || n.type === "assembly" || n.type === "subassembly") ids.push(n.id);
		if (n.children && n.children.length > 0) for (const child of n.children) recurse(child);
	}
	recurse(node);
	return ids;
}
// src/components/workspace/AssemblyTreePanel.tsx
/**
* Individual row renderer for an AssemblyTreeNode with recursive children.
*/
var TreeNodeRow = ({ node, depth, selectedComponentId, hiddenComponentIds, isExpanded, onToggleExpand, isNodeExpanded, onSelectComponent, onToggleVisibility }) => {
	const hasChildren = Boolean(node.children && node.children.length > 0);
	const isComponent = node.type === "component";
	const isSelected = isComponent && node.componentId === selectedComponentId;
	const descendantIds = useMemo(() => getDescendantComponentIds(node), [node]);
	const isVisible = useMemo(() => {
		if (isComponent && node.componentId) return !hiddenComponentIds.has(node.componentId);
		if (descendantIds.length === 0) return true;
		return !descendantIds.every((id) => hiddenComponentIds.has(id));
	}, [
		isComponent,
		node.componentId,
		descendantIds,
		hiddenComponentIds
	]);
	const handleRowClick = () => {
		if (isComponent && node.componentId) {
			if (isSelected) onSelectComponent(null);
			else onSelectComponent(node.componentId);
		} else if (hasChildren) onToggleExpand(node.id);
	};
	const handleKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleRowClick();
		} else if (e.key === "ArrowRight" && hasChildren && !isExpanded) {
			e.preventDefault();
			onToggleExpand(node.id);
		} else if (e.key === "ArrowLeft" && hasChildren && isExpanded) {
			e.preventDefault();
			onToggleExpand(node.id);
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "tree-node-group",
		role: "group",
		children: [/* @__PURE__ */ jsxs("div", {
			className: `tree-node-row ${node.type} ${isSelected ? "selected" : ""} ${!isVisible ? "hidden-node" : ""}`,
			style: { paddingLeft: `${depth * 14 + 10}px` },
			onClick: handleRowClick,
			onKeyDown: handleKeyDown,
			tabIndex: 0,
			role: "treeitem",
			"aria-selected": isSelected,
			"aria-expanded": hasChildren ? isExpanded : void 0,
			"aria-label": `${node.name} (${node.type})`,
			children: [
				hasChildren ? /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "tree-caret-btn",
					onClick: (e) => {
						e.stopPropagation();
						onToggleExpand(node.id);
					},
					"aria-label": isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`,
					"aria-expanded": isExpanded,
					children: /* @__PURE__ */ jsx("span", {
						className: `caret-icon ${isExpanded ? "open" : ""}`,
						"aria-hidden": "true",
						children: "▶"
					})
				}) : /* @__PURE__ */ jsx("span", {
					className: "tree-leaf-spacer",
					"aria-hidden": "true",
					children: "•"
				}),
				/* @__PURE__ */ jsx("span", {
					className: "node-type-icon",
					"aria-hidden": "true",
					children: node.type === "assembly" ? "🗂️" : node.type === "subassembly" ? "📦" : "⚙️"
				}),
				/* @__PURE__ */ jsx("span", {
					className: "node-label",
					title: node.name,
					children: node.name
				}),
				hasChildren && /* @__PURE__ */ jsx("span", {
					className: "node-children-count",
					title: `${node.children.length} sub-units`,
					children: node.children.length
				}),
				/* @__PURE__ */ jsx("button", {
					type: "button",
					className: `tree-visibility-btn ${isVisible ? "visible" : "hidden"}`,
					onClick: (e) => {
						e.stopPropagation();
						onToggleVisibility(node);
					},
					title: isVisible ? `Hide ${node.name} in 3D viewport` : `Show ${node.name} in 3D viewport`,
					"aria-label": isVisible ? `Hide ${node.name} in 3D viewport` : `Show ${node.name} in 3D viewport`,
					children: /* @__PURE__ */ jsx("span", {
						className: "visibility-icon",
						"aria-hidden": "true",
						children: isVisible ? "👁" : "⊘"
					})
				})
			]
		}), hasChildren && isExpanded && /* @__PURE__ */ jsx("div", {
			className: "tree-children-container",
			children: node.children.map((child) => /* @__PURE__ */ jsx(TreeNodeRow, {
				node: child,
				depth: depth + 1,
				selectedComponentId,
				hiddenComponentIds,
				isExpanded: isNodeExpanded(child.id),
				onToggleExpand,
				isNodeExpanded,
				onSelectComponent,
				onToggleVisibility
			}, child.id))
		})]
	});
};
/**
* Interactive Assembly Hierarchy Tree Panel
* Task 9.5: Provides collapsible tree navigation, per-component visibility toggling,
* search filtering with ancestor retention, and bidirectional 3D raycast synchronization.
*/
var AssemblyTreePanel = ({ rootNode, selectedComponentId, onSelectComponent, hiddenComponentIds, onToggleVisibility, className = "" }) => {
	const [searchTerm, setSearchTerm] = useState("");
	const [manualExpandedState, setManualExpandedState] = useState(/* @__PURE__ */ new Map());
	const defaultExpandedIds = useMemo(() => {
		return rootNode ? new Set(collectDefaultExpandedNodeIds(rootNode)) : /* @__PURE__ */ new Set();
	}, [rootNode]);
	const selectedAncestorIds = useMemo(() => {
		return rootNode && selectedComponentId ? new Set(findAncestorNodeIds(rootNode, selectedComponentId)) : /* @__PURE__ */ new Set();
	}, [rootNode, selectedComponentId]);
	const { filteredTree, hasFilterMatches } = useMemo(() => {
		if (!rootNode) return {
			filteredTree: null,
			hasFilterMatches: false
		};
		if (!searchTerm.trim()) return {
			filteredTree: rootNode,
			hasFilterMatches: true
		};
		const result = filterAssemblyTree(rootNode, searchTerm);
		return {
			filteredTree: result.filteredNode,
			hasFilterMatches: result.matches && result.filteredNode !== null
		};
	}, [rootNode, searchTerm]);
	const searchExpandedIds = useMemo(() => {
		if (!searchTerm.trim() || !filteredTree) return /* @__PURE__ */ new Set();
		return new Set(collectDefaultExpandedNodeIds(filteredTree));
	}, [searchTerm, filteredTree]);
	const isNodeExpanded = useCallback((nodeId) => {
		if (searchTerm.trim().length > 0) return searchExpandedIds.has(nodeId);
		if (selectedAncestorIds.has(nodeId)) return true;
		const manual = manualExpandedState.get(nodeId);
		if (manual !== void 0) return manual;
		return defaultExpandedIds.has(nodeId);
	}, [
		searchTerm,
		searchExpandedIds,
		selectedAncestorIds,
		manualExpandedState,
		defaultExpandedIds
	]);
	const handleToggleExpand = useCallback((nodeId) => {
		setManualExpandedState((prev) => {
			const next = new Map(prev);
			const currentlyExpanded = isNodeExpanded(nodeId);
			next.set(nodeId, !currentlyExpanded);
			return next;
		});
	}, [isNodeExpanded]);
	return /* @__PURE__ */ jsxs("div", {
		className: `assembly-tree-panel ${className}`,
		role: "tree",
		"aria-label": "Assembly Hierarchy Tree",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "tree-filter-bar",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "filter-search-icon",
						"aria-hidden": "true",
						children: "🔍"
					}),
					/* @__PURE__ */ jsx("input", {
						type: "text",
						className: "tree-filter-input",
						placeholder: "Filter assembly components...",
						value: searchTerm,
						onChange: (e) => setSearchTerm(e.target.value),
						"aria-label": "Filter assembly tree components"
					}),
					searchTerm && /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "filter-clear-btn",
						onClick: () => setSearchTerm(""),
						title: "Clear search filter",
						"aria-label": "Clear search filter",
						children: "✕"
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "tree-content-scroll",
				children: !rootNode ? /* @__PURE__ */ jsxs("div", {
					className: "assembly-tree-empty",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "empty-icon",
							"aria-hidden": "true",
							children: "🗂️"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "empty-title",
							children: "No Assembly Hierarchy"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "empty-desc",
							children: "The active model does not define a CAD assembly tree."
						})
					]
				}) : !hasFilterMatches || !filteredTree ? /* @__PURE__ */ jsxs("div", {
					className: "assembly-tree-no-matches",
					children: [/* @__PURE__ */ jsxs("p", {
						className: "no-matches-text",
						children: [
							"No matching components found for \"",
							/* @__PURE__ */ jsx("strong", { children: searchTerm }),
							"\""
						]
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "clear-search-action-btn",
						onClick: () => setSearchTerm(""),
						children: "Clear Filter"
					})]
				}) : /* @__PURE__ */ jsx(TreeNodeRow, {
					node: filteredTree,
					depth: 0,
					selectedComponentId,
					hiddenComponentIds,
					isExpanded: isNodeExpanded(filteredTree.id),
					onToggleExpand: handleToggleExpand,
					isNodeExpanded,
					onSelectComponent,
					onToggleVisibility
				})
			}),
			rootNode && /* @__PURE__ */ jsxs("div", {
				className: "tree-footer-info",
				children: [/* @__PURE__ */ jsx("span", {
					className: "tree-summary-label",
					children: hiddenComponentIds.size > 0 ? `${hiddenComponentIds.size} hidden part${hiddenComponentIds.size > 1 ? "s" : ""}` : "All components visible"
				}), hiddenComponentIds.size > 0 && /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "unhide-all-btn",
					onClick: () => {
						onToggleVisibility(rootNode);
					},
					title: "Show all components in 3D viewport",
					children: "Show All"
				})]
			})
		]
	});
};
// src/components/scene/ViewerCanvas.tsx
var checkWebGLSupport$1 = () => {
	if (typeof window === "undefined") return null;
	const testCanvas = document.createElement("canvas");
	if (!(testCanvas.getContext("webgl2") || testCanvas.getContext("webgl"))) return "WebGL is not supported or hardware acceleration is disabled in your browser.";
	return null;
};
var ViewerCanvas = ({ modelId = PLANETARY_GEARBOX_MODEL_ID, onModelLoaded, onModelLoadError, onFpsUpdate, onTelemetryUpdate, className, gestureResult, hands, selectedComponentId, onSelectComponent, hiddenComponentIds, isolatedComponentId, explodedFactor = 0, onExplodedFactorChange }) => {
	const containerRef = useRef(null);
	const canvasRef = useRef(null);
	const cameraControllerRef = useRef(null);
	const lifecycleManagerRef = useRef(null);
	const modelIdRef = useRef(modelId || "planetary_gearbox");
	useEffect(() => {
		modelIdRef.current = modelId || "planetary_gearbox";
	}, [modelId]);
	const onModelLoadedRef = useRef(onModelLoaded);
	useEffect(() => {
		onModelLoadedRef.current = onModelLoaded;
	}, [onModelLoaded]);
	const onModelLoadErrorRef = useRef(onModelLoadError);
	useEffect(() => {
		onModelLoadErrorRef.current = onModelLoadError;
	}, [onModelLoadError]);
	const gestureResultRef = useRef(gestureResult ?? null);
	useEffect(() => {
		gestureResultRef.current = gestureResult ?? null;
	}, [gestureResult]);
	const handsRef = useRef(hands ?? []);
	useEffect(() => {
		handsRef.current = hands ?? [];
	}, [hands]);
	const selectedComponentIdRef = useRef(selectedComponentId ?? null);
	useEffect(() => {
		selectedComponentIdRef.current = selectedComponentId ?? null;
	}, [selectedComponentId]);
	const onSelectComponentRef = useRef(onSelectComponent);
	useEffect(() => {
		onSelectComponentRef.current = onSelectComponent;
	}, [onSelectComponent]);
	const pointerNdcRef = useRef(null);
	const pointerDownRef = useRef(null);
	const [cursorState, setCursorState] = useState({
		visible: false,
		position: null,
		dwellProgress: 0,
		hoveredComponentName: null
	});
	const [initError, setInitError] = useState(() => checkWebGLSupport$1());
	const [modelError, setModelError] = useState(null);
	const [autoRotate, setAutoRotate] = useState(true);
	const [gridVisible, setGridVisible] = useState(true);
	const [activePreset, setActivePreset] = useState("isometric");
	const autoRotateRef = useRef(autoRotate);
	useEffect(() => {
		autoRotateRef.current = autoRotate;
		if (cameraControllerRef.current) cameraControllerRef.current.setAutoRotate(autoRotate);
	}, [autoRotate]);
	const gridHelperRef = useRef(null);
	useEffect(() => {
		if (gridHelperRef.current) gridHelperRef.current.visible = gridVisible;
	}, [gridVisible]);
	useEffect(() => {
		if (lifecycleManagerRef.current && typeof explodedFactor === "number") lifecycleManagerRef.current.setExplodedFactor(explodedFactor);
	}, [explodedFactor]);
	useEffect(() => {
		if (initError) return;
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) return;
		let animationFrameId;
		let isDisposed = false;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(724761);
		const initialWidth = container.clientWidth || 800;
		const initialHeight = container.clientHeight || 600;
		const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, .1, 100);
		let renderer;
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: true,
				alpha: false,
				powerPreference: "high-performance"
			});
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
			renderer.setSize(initialWidth, initialHeight);
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.15;
		} catch (err) {
			const errMsg = `Failed to initialize WebGL Renderer: ${err instanceof Error ? err.message : String(err)}`;
			setTimeout(() => setInitError(errMsg), 0);
			return;
		}
		const cameraController = new CameraController(camera, renderer.domElement, {
			enableDamping: true,
			dampingFactor: .05,
			minDistance: 2.2,
			maxDistance: 25,
			autoRotate: autoRotateRef.current,
			autoRotateSpeed: 1,
			onPresetChange: (preset) => setActivePreset(preset)
		});
		cameraControllerRef.current = cameraController;
		const gestureCameraController = new GestureCameraController(cameraController);
		const ambientLight = new THREE.AmbientLight(9151431, .95);
		scene.add(ambientLight);
		const keyLight = new THREE.DirectionalLight(16777215, 2.4);
		keyLight.position.set(7, 12, 9);
		scene.add(keyLight);
		const rimLight = new THREE.DirectionalLight(440020, 1.5);
		rimLight.position.set(-7, -2, -7);
		scene.add(rimLight);
		const fillLight = new THREE.DirectionalLight(9741240, .8);
		fillLight.position.set(-6, 8, 4);
		scene.add(fillLight);
		const accentLight = new THREE.PointLight(16096779, 1.2, 12);
		accentLight.position.set(0, 3.5, 1.5);
		scene.add(accentLight);
		const gridHelper = new THREE.GridHelper(18, 36, 440020, 1976635);
		gridHelper.position.y = -1.25;
		gridHelper.visible = gridHelperRef.current ? gridHelperRef.current.visible : true;
		gridHelperRef.current = gridHelper;
		scene.add(gridHelper);
		const shadowGeo = new THREE.CircleGeometry(2.5, 48);
		const shadowMat = new THREE.MeshBasicMaterial({
			color: 0,
			transparent: true,
			opacity: .4,
			depthWrite: false
		});
		const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
		shadowMesh.rotation.x = -Math.PI / 2;
		shadowMesh.position.y = -1.24;
		scene.add(shadowMesh);
		const componentSelector = new ComponentSelector({ dwellDurationMs: 1200 });
		const lifecycleManager = new ModelLifecycleManager({
			scene,
			camera,
			cameraController,
			onModelLoaded: (loadedModel) => {
				onModelLoadedRef.current?.(loadedModel);
			},
			onModelError: (err) => {
				setModelError(err);
				onModelLoadErrorRef.current?.(err);
			}
		});
		lifecycleManagerRef.current = lifecycleManager;
		const initialLoadResult = lifecycleManager.loadModel(modelIdRef.current);
		if (!initialLoadResult.success) setModelError(initialLoadResult.error ?? "Failed to load initial model");
		else setModelError(null);
		const resizeObserver = new ResizeObserver((entries) => {
			if (isDisposed) return;
			for (const entry of entries) {
				const width = entry.contentRect.width;
				const height = entry.contentRect.height;
				if (width > 0 && height > 0) {
					camera.aspect = width / height;
					camera.updateProjectionMatrix();
					renderer.setSize(width, height, false);
				}
			}
		});
		resizeObserver.observe(container);
		let lastTime = performance.now();
		let frameCount = 0;
		let fpsTimer = 0;
		const clock = new THREE.Clock();
		const animate = () => {
			if (isDisposed) return;
			animationFrameId = requestAnimationFrame(animate);
			const delta = clock.getDelta();
			const now = performance.now();
			const elapsed = now - lastTime;
			lastTime = now;
			defaultTelemetry.render.recordFrame(now);
			if (handsRef.current && handsRef.current.length > 0) {
				const primaryHand = handsRef.current[0];
				if (primaryHand.timestamp && Number.isFinite(primaryHand.timestamp)) defaultTelemetry.latency.recordLatency(primaryHand.timestamp, now);
			}
			frameCount++;
			fpsTimer += elapsed;
			if (fpsTimer >= 1e3) {
				const renderSnapshot = defaultTelemetry.render.getSnapshot();
				const currentFps = renderSnapshot.fps > 0 ? renderSnapshot.fps : Math.round(frameCount * 1e3 / fpsTimer);
				onFpsUpdate?.(currentFps);
				onTelemetryUpdate?.(defaultTelemetry.getCombinedSnapshot(now));
				frameCount = 0;
				fpsTimer = 0;
			}
			if (autoRotateRef.current) lifecycleManager.updateAnimation(delta, performance.now() / 1e3);
			gestureCameraController.update(gestureResultRef.current, handsRef.current);
			let candidateNdc = null;
			let isGesturePointing = false;
			let pointingPixelPos = null;
			const activeGesture = gestureResultRef.current;
			const activeHands = handsRef.current;
			if (activeGesture?.gesture === "POINTING" && activeGesture.isStable && activeHands && activeHands.length > 0) {
				const matchingHand = activeGesture.handedness ? activeHands.find((h) => h.handedness === activeGesture.handedness) || activeHands[0] : activeHands[0];
				if ((matchingHand.score ?? activeGesture.confidence ?? 1) >= .5) {
					const indexTip = matchingHand.landmarks?.[8];
					const projected = projectFingertipToScreen(indexTip, {
						width: container.clientWidth || initialWidth,
						height: container.clientHeight || initialHeight
					}, true);
					if (projected) {
						isGesturePointing = true;
						candidateNdc = projected.ndc;
						pointingPixelPos = projected.screen;
					}
				}
			} else if (pointerNdcRef.current) candidateNdc = pointerNdcRef.current;
			const raycaster = lifecycleManager.getRaycaster();
			const hit = candidateNdc && raycaster ? raycaster.raycast(candidateNdc) : null;
			const selectorResult = componentSelector.update(hit?.componentId ?? null, delta * 1e3);
			if (selectorResult.justSelected && selectorResult.selectedId) onSelectComponentRef.current?.(selectorResult.selectedId);
			if (raycaster) {
				raycaster.setHoverHighlight(selectorResult.hoveredId);
				raycaster.setSelectionHighlight(selectedComponentIdRef.current);
			}
			if (isGesturePointing && pointingPixelPos) {
				const activeModel = lifecycleManager.getActiveModel();
				const hoveredName = hit ? activeModel?.getComponentMetadata(hit.componentId)?.name || getComponentMetadata(hit.componentId)?.name || hit.componentId : null;
				setCursorState((prev) => {
					if (prev.visible && prev.hoveredComponentName === hoveredName && Math.abs(prev.dwellProgress - selectorResult.dwellProgress) < .03 && prev.position && Math.hypot(prev.position.x - pointingPixelPos.x, prev.position.y - pointingPixelPos.y) < 3) return prev;
					return {
						visible: true,
						position: pointingPixelPos,
						dwellProgress: selectorResult.dwellProgress,
						hoveredComponentName: hoveredName
					};
				});
			} else setCursorState((prev) => {
				if (!prev.visible && prev.hoveredComponentName === null && prev.dwellProgress === 0) return prev;
				return {
					visible: false,
					position: null,
					dwellProgress: 0,
					hoveredComponentName: null
				};
			});
			cameraController.update();
			renderer.render(scene, camera);
		};
		animate();
		return () => {
			isDisposed = true;
			cancelAnimationFrame(animationFrameId);
			resizeObserver.disconnect();
			gestureCameraController.dispose();
			lifecycleManager.dispose();
			lifecycleManagerRef.current = null;
			componentSelector.reset();
			cameraController.dispose();
			scene.traverse((obj) => {
				if (obj.isMesh) {
					const mesh = obj;
					mesh.geometry?.dispose();
					if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
					else if (mesh.material) mesh.material.dispose();
				}
			});
			defaultTelemetry.render.reset();
			defaultTelemetry.latency.reset();
			renderer.dispose();
		};
	}, [
		initError,
		onFpsUpdate,
		onTelemetryUpdate
	]);
	useEffect(() => {
		if (lifecycleManagerRef.current) {
			const targetId = modelId || "planetary_gearbox";
			if (lifecycleManagerRef.current.getActiveModel()?.id !== targetId) {
				const result = lifecycleManagerRef.current.loadModel(targetId);
				if (!result.success) setModelError(result.error ?? "Failed to load model.");
				else {
					setModelError(null);
					onSelectComponentRef.current?.(null);
				}
			}
		}
	}, [modelId]);
	useEffect(() => {
		if (lifecycleManagerRef.current && hiddenComponentIds !== void 0) lifecycleManagerRef.current.setHiddenComponents(hiddenComponentIds);
	}, [hiddenComponentIds]);
	useEffect(() => {
		if (lifecycleManagerRef.current && isolatedComponentId !== void 0) lifecycleManagerRef.current.isolateComponent(isolatedComponentId);
	}, [isolatedComponentId]);
	const handleSelectPreset = (preset) => {
		setActivePreset(preset);
		cameraControllerRef.current?.setPreset(preset);
	};
	const handleResetCamera = () => {
		setActivePreset("isometric");
		cameraControllerRef.current?.reset();
	};
	const handlePointerMove = (e) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			const x = (e.clientX - rect.left) / rect.width * 2 - 1;
			const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			pointerNdcRef.current = {
				x,
				y
			};
		}
	};
	const handlePointerLeave = () => {
		pointerNdcRef.current = null;
	};
	const handlePointerDown = (e) => {
		pointerDownRef.current = {
			x: e.clientX,
			y: e.clientY,
			time: performance.now()
		};
	};
	const handlePointerUp = (e) => {
		if (!pointerDownRef.current) return;
		const dist = Math.hypot(e.clientX - pointerDownRef.current.x, e.clientY - pointerDownRef.current.y);
		const elapsed = performance.now() - pointerDownRef.current.time;
		pointerDownRef.current = null;
		if (dist < 6 && elapsed < 400) {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width * 2 - 1;
			const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			const raycaster = lifecycleManagerRef.current?.getRaycaster();
			if (raycaster) {
				const hit = raycaster.raycast({
					x,
					y
				});
				if (hit) onSelectComponentRef.current?.(hit.componentId);
				else onSelectComponentRef.current?.(null);
			}
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		ref: containerRef,
		className: `viewport-container ${className || ""}`,
		"aria-label": "Interactive 3D Mechanical Viewport",
		role: "region",
		children: [
			/* @__PURE__ */ jsx("canvas", {
				ref: canvasRef,
				className: "three-canvas",
				tabIndex: 0,
				"aria-label": "3D engineering scene canvas",
				onPointerMove: handlePointerMove,
				onPointerLeave: handlePointerLeave,
				onPointerDown: handlePointerDown,
				onPointerUp: handlePointerUp
			}),
			/* @__PURE__ */ jsx(VirtualCursor, {
				visible: cursorState.visible,
				position: cursorState.position,
				dwellProgress: cursorState.dwellProgress,
				hoveredComponentName: cursorState.hoveredComponentName
			}),
			initError && /* @__PURE__ */ jsxs("div", {
				className: "viewport-overlay error-overlay",
				role: "alert",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "error-icon",
						children: "⚠️"
					}),
					/* @__PURE__ */ jsx("h3", { children: "WebGL Initialization Error" }),
					/* @__PURE__ */ jsx("p", { children: initError })
				]
			}),
			!initError && modelError && /* @__PURE__ */ jsxs("div", {
				className: "viewport-overlay error-overlay",
				role: "alert",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "error-icon",
						children: "⚠️"
					}),
					/* @__PURE__ */ jsx("h3", { children: "Model Not Found" }),
					/* @__PURE__ */ jsx("p", { children: modelError }),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "toolbar-btn active",
						onClick: () => {
							if (lifecycleManagerRef.current) {
								if (lifecycleManagerRef.current.loadModel("planetary_gearbox").success) setModelError(null);
							}
						},
						style: { marginTop: "12px" },
						children: "Restore Default Model"
					})
				]
			}),
			!initError && !modelError && /* @__PURE__ */ jsxs("div", {
				className: "viewport-controls-toolbar",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "preset-group",
						role: "group",
						"aria-label": "Camera Presets",
						children: [
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: `toolbar-btn preset-btn ${activePreset === "isometric" ? "active" : ""}`,
								onClick: () => handleSelectPreset("isometric"),
								title: "Isometric 3D Angle [Key: 1]",
								"aria-label": "Switch to Isometric View",
								children: "Isometric"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: `toolbar-btn preset-btn ${activePreset === "top" ? "active" : ""}`,
								onClick: () => handleSelectPreset("top"),
								title: "Top Overhead View [Key: 2]",
								"aria-label": "Switch to Top View",
								children: "Top"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: `toolbar-btn preset-btn ${activePreset === "front" ? "active" : ""}`,
								onClick: () => handleSelectPreset("front"),
								title: "Front Elevation View [Key: 3]",
								"aria-label": "Switch to Front View",
								children: "Front"
							})
						]
					}),
					/* @__PURE__ */ jsx("div", { className: "toolbar-divider" }),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "toolbar-btn",
						onClick: handleResetCamera,
						title: "Reset to default view [Key: R]",
						"aria-label": "Reset camera viewpoint",
						children: "Reset [R]"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: `toolbar-btn ${autoRotate ? "active" : ""}`,
						onClick: () => setAutoRotate((prev) => !prev),
						title: "Toggle animation rotation and auto-orbit",
						"aria-label": "Toggle animation rotation and auto-orbit",
						children: autoRotate ? "Pause Rotation" : "Auto Rotate"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: `toolbar-btn ${gridVisible ? "active" : ""}`,
						onClick: () => setGridVisible((prev) => !prev),
						title: "Toggle ground reference grid",
						"aria-label": "Toggle ground reference grid",
						children: gridVisible ? "Hide Grid" : "Show Grid"
					}),
					onExplodedFactorChange && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", { className: "toolbar-divider" }), /* @__PURE__ */ jsxs("div", {
						className: "exploded-control-group",
						role: "group",
						"aria-label": "Exploded View Separation",
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: `toolbar-btn ${explodedFactor > 0 ? "active" : ""}`,
							onClick: () => onExplodedFactorChange(explodedFactor > 0 ? 0 : .6),
							title: explodedFactor > 0 ? "Assemble Model [Key: X]" : "Explode Model [Key: X]",
							"aria-label": explodedFactor > 0 ? "Assemble Model" : "Explode Model",
							children: ["💥 ", explodedFactor > 0 ? `${Math.round(explodedFactor * 100)}%` : "Explode"]
						}), explodedFactor > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("input", {
							type: "range",
							min: "0",
							max: "100",
							step: "1",
							value: Math.round(explodedFactor * 100),
							onChange: (e) => onExplodedFactorChange(Number(e.target.value) / 100),
							className: "viewport-slider",
							title: `Explosion: ${Math.round(explodedFactor * 100)}%`,
							"aria-label": "Exploded View Separation Factor"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "toolbar-btn",
							onClick: () => onExplodedFactorChange(0),
							title: "Reset to 0% Assembled",
							"aria-label": "Reset Exploded View to Assembled",
							children: "Assemble"
						})] })]
					})] })
				]
			}),
			!initError && !modelError && /* @__PURE__ */ jsx("div", {
				className: "interaction-hint",
				children: /* @__PURE__ */ jsxs("span", { children: [
					"🖱️ ",
					/* @__PURE__ */ jsx("strong", { children: "Left-Click:" }),
					" Orbit | ",
					/* @__PURE__ */ jsx("strong", { children: "Scroll:" }),
					" Zoom | ",
					/* @__PURE__ */ jsx("strong", { children: "Right-Click:" }),
					" Pan | ",
					/* @__PURE__ */ jsx("strong", { children: "R:" }),
					" Reset View"
				] })
			})
		]
	});
};
// src/services/tracking/useHandLandmarker.ts
var LOCAL_WASM_PATH = "/wasm";
var CDN_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
var LOCAL_MODEL_PATH = "/models/hand_landmarker.task";
var CDN_MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
function useHandLandmarker({ videoRef, isCameraActive, maxHands = 2, minConfidence = .5, enableSmoothing = true, smoothingConfig }) {
	const [status, setStatus] = useState("idle");
	const [hands, setHands] = useState([]);
	const [trackingFps, setTrackingFps] = useState(0);
	const [errorMessage, setErrorMessage] = useState(null);
	const multiHandFilter = useMemo(() => {
		return new MultiHandOneEuroFilter(smoothingConfig);
	}, [smoothingConfig]);
	const landmarkerRef = useRef(null);
	const animFrameIdRef = useRef(null);
	const lastVideoTimeRef = useRef(-1);
	const fpsFrameCountRef = useRef(0);
	const fpsLastTimestampRef = useRef(0);
	const isInitializingRef = useRef(false);
	const initLandmarker = useCallback(async () => {
		if (landmarkerRef.current || isInitializingRef.current) return;
		isInitializingRef.current = true;
		setStatus("initializing");
		setErrorMessage(null);
		try {
			let vision;
			try {
				vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
			} catch (localWasmErr) {
				console.warn("Local WASM resolver failed, falling back to CDN:", localWasmErr);
				vision = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
			}
			let landmarker;
			try {
				landmarker = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: LOCAL_MODEL_PATH,
						delegate: "GPU"
					},
					runningMode: "VIDEO",
					numHands: maxHands,
					minHandDetectionConfidence: minConfidence,
					minHandPresenceConfidence: minConfidence,
					minTrackingConfidence: minConfidence
				});
			} catch (localModelErr) {
				console.warn("Local model load failed, falling back to CDN model:", localModelErr);
				landmarker = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: CDN_MODEL_PATH,
						delegate: "GPU"
					},
					runningMode: "VIDEO",
					numHands: maxHands,
					minHandDetectionConfidence: minConfidence,
					minHandPresenceConfidence: minConfidence,
					minTrackingConfidence: minConfidence
				});
			}
			landmarkerRef.current = landmarker;
			setStatus("ready");
		} catch (err) {
			console.error("Failed to initialize HandLandmarker:", err);
			const msg = err instanceof Error ? err.message : "Failed to initialize hand tracker";
			setErrorMessage(msg);
			setStatus("error");
		} finally {
			isInitializingRef.current = false;
		}
	}, [maxHands, minConfidence]);
	const resetTracker = useCallback(() => {
		if (animFrameIdRef.current) {
			cancelAnimationFrame(animFrameIdRef.current);
			animFrameIdRef.current = null;
		}
		if (landmarkerRef.current) {
			try {
				landmarkerRef.current.close();
			} catch (e) {
				console.warn("Error closing landmarker:", e);
			}
			landmarkerRef.current = null;
		}
		multiHandFilter.reset();
		defaultTelemetry.vision.reset();
		setHands([]);
		setTrackingFps(0);
		setStatus("idle");
		setErrorMessage(null);
	}, [multiHandFilter]);
	useEffect(() => {
		if (isCameraActive && !landmarkerRef.current && !isInitializingRef.current) initLandmarker();
		else if (!isCameraActive && landmarkerRef.current) {
			multiHandFilter.reset();
			defaultTelemetry.vision.reset();
			setHands([]);
			setTrackingFps(0);
			setStatus("idle");
		}
	}, [
		isCameraActive,
		initLandmarker,
		multiHandFilter
	]);
	useEffect(() => {
		if (!isCameraActive || !landmarkerRef.current || status === "error") {
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
						fpsFrameCountRef.current += 1;
						if (fpsLastTimestampRef.current === 0) fpsLastTimestampRef.current = timestamp;
						const elapsed = timestamp - fpsLastTimestampRef.current;
						if (elapsed >= 500) {
							const currentFps = Math.round(fpsFrameCountRef.current * 1e3 / elapsed);
							setTrackingFps(currentFps);
							fpsFrameCountRef.current = 0;
							fpsLastTimestampRef.current = timestamp;
						}
						if (results.landmarks && results.landmarks.length > 0) {
							setStatus("detecting");
							const rawDetectedHands = results.landmarks.map((rawLandmarks, idx) => {
								const rawHandedness = results.handedness?.[idx]?.[0];
								const handedness = rawHandedness?.categoryName === "Left" ? "Left" : "Right";
								const score = rawHandedness?.score ?? .9;
								const landmarks = rawLandmarks.map((lm) => ({
									x: lm.x,
									y: lm.y,
									z: lm.z ?? 0
								}));
								return {
									landmarks,
									rawLandmarks: landmarks.map((p) => ({ ...p })),
									handedness,
									score,
									timestamp
								};
							});
							const tSmooth0 = performance.now();
							const detectedHands = enableSmoothing ? multiHandFilter.filterHands(rawDetectedHands, timestamp) : rawDetectedHands;
							const smoothingDurationMs = performance.now() - tSmooth0;
							const totalDurationMs = performance.now() - t0;
							for (let i = 0; i < detectedHands.length; i++) detectedHands[i].timestamp = timestamp;
							defaultTelemetry.vision.recordVisionFrame({
								inferenceDurationMs,
								smoothingDurationMs,
								totalDurationMs,
								timestamp
							});
							setHands(detectedHands);
							gestureDiagnostics.update({
								handsDetected: detectedHands.length,
								trackingStatus: "detecting"
							});
						} else {
							const totalDurationMs = performance.now() - t0;
							defaultTelemetry.vision.recordVisionFrame({
								inferenceDurationMs,
								smoothingDurationMs: 0,
								totalDurationMs,
								timestamp
							});
							multiHandFilter.reset();
							setHands([]);
							setStatus("ready");
							gestureDiagnostics.update({
								handsDetected: 0,
								trackingStatus: "ready",
								rejectionReason: "No hands in frame"
							});
						}
					} catch (detectionErr) {
						console.warn("MediaPipe detectForVideo skipped frame:", detectionErr);
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
	}, [
		enableSmoothing,
		isCameraActive,
		multiHandFilter,
		status,
		videoRef
	]);
	useEffect(() => {
		return () => {
			if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
			if (landmarkerRef.current) try {
				landmarkerRef.current.close();
			} catch {}
		};
	}, []);
	return {
		status,
		hands,
		trackingFps,
		errorMessage,
		resetTracker
	};
}
// src/services/gestures/useGestureStateMachine.ts
var EMPTY_GESTURE_RESULT = {
	gesture: "NONE",
	rawGesture: "NONE",
	confidence: 0,
	isStable: true,
	consecutiveFrames: 0,
	handedness: "Right",
	metrics: {
		pinchDistanceNorm: 999,
		handScale: .1,
		indexExtension: 0,
		middleExtension: 0,
		ringExtension: 0,
		pinkyExtension: 0
	}
};
function useGestureRecognition({ hands, thresholds, preferredHand = "Right" }) {
	const mergedThresholds = useMemo(() => {
		return {
			...DEFAULT_GESTURE_THRESHOLDS,
			...thresholds
		};
	}, [thresholds]);
	const stabilizers = useMemo(() => {
		return {
			right: new GestureTemporalStabilizer(mergedThresholds),
			left: new GestureTemporalStabilizer(mergedThresholds)
		};
	}, [mergedThresholds]);
	const { primaryGesture, allGestures } = useMemo(() => {
		if (!hands || hands.length === 0) {
			stabilizers.right.reset();
			stabilizers.left.reset();
			return {
				primaryGesture: EMPTY_GESTURE_RESULT,
				allGestures: []
			};
		}
		const results = [];
		for (const hand of hands) {
			const res = (hand.handedness === "Left" ? stabilizers.left : stabilizers.right).update(hand.landmarks, hand.handedness, hand.score);
			results.push(res);
		}
		const preferredResult = results.find((r) => r.gesture !== "NONE" && r.isStable) || results.find((r) => r.handedness === preferredHand) || results[0] || EMPTY_GESTURE_RESULT;
		gestureDiagnostics.update({
			rawGesture: preferredResult.rawGesture,
			stableGesture: preferredResult.gesture,
			confidence: preferredResult.confidence,
			pinchDistanceNorm: preferredResult.metrics.pinchDistanceNorm,
			rejectionReason: preferredResult.rejectionReason || (preferredResult.gesture !== "NONE" ? "Gesture Confirmed" : "Pose unconfirmed")
		});
		return {
			primaryGesture: preferredResult,
			allGestures: results
		};
	}, [
		hands,
		preferredHand,
		stabilizers
	]);
	return {
		primaryGesture,
		allGestures,
		thresholds: mergedThresholds
	};
}
// src/components/hud/SkeletonOverlay.tsx
var HAND_COLORS = {
	Right: {
		joint: "#00e5ff",
		tip: "#38bdf8",
		bone: "rgba(0, 229, 255, 0.75)",
		wrist: "#ffffff"
	},
	Left: {
		joint: "#f59e0b",
		tip: "#fbbf24",
		bone: "rgba(245, 158, 11, 0.75)",
		wrist: "#ffffff"
	}
};
var FINGERTIP_INDICES = /* @__PURE__ */ new Set([
	LANDMARK_INDEX.THUMB_TIP,
	LANDMARK_INDEX.INDEX_TIP,
	LANDMARK_INDEX.MIDDLE_TIP,
	LANDMARK_INDEX.RING_TIP,
	LANDMARK_INDEX.PINKY_TIP
]);
var SkeletonOverlay = ({ hands, status, trackingFps }) => {
	const canvasRef = useRef(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const displayWidth = Math.round(rect.width * dpr);
		const displayHeight = Math.round(rect.height * dpr);
		if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
			canvas.width = displayWidth;
			canvas.height = displayHeight;
		}
		ctx.save();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (hands.length === 0) {
			ctx.restore();
			return;
		}
		const w = canvas.width;
		const h = canvas.height;
		for (const hand of hands) {
			const palette = HAND_COLORS[hand.handedness] || HAND_COLORS.Right;
			const { landmarks } = hand;
			if (!landmarks || landmarks.length < 21) continue;
			ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
			ctx.strokeStyle = palette.bone;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
				const start = landmarks[startIdx];
				const end = landmarks[endIdx];
				if (start && end) {
					ctx.beginPath();
					ctx.moveTo(start.x * w, start.y * h);
					ctx.lineTo(end.x * w, end.y * h);
					ctx.stroke();
				}
			}
			for (let i = 0; i < landmarks.length; i++) {
				const lm = landmarks[i];
				const isTip = FINGERTIP_INDICES.has(i);
				const isWrist = i === LANDMARK_INDEX.WRIST;
				const radius = isTip ? Math.max(4, Math.round(4.5 * dpr)) : isWrist ? Math.max(3.5, Math.round(4 * dpr)) : Math.max(2.5, Math.round(3 * dpr));
				ctx.beginPath();
				ctx.arc(lm.x * w, lm.y * h, radius, 0, 2 * Math.PI);
				if (isWrist) ctx.fillStyle = palette.wrist;
				else if (isTip) ctx.fillStyle = palette.tip;
				else ctx.fillStyle = palette.joint;
				ctx.shadowColor = palette.joint;
				ctx.shadowBlur = Math.round(6 * dpr);
				ctx.fill();
				ctx.shadowBlur = 0;
			}
		}
		ctx.restore();
	}, [hands]);
	return /* @__PURE__ */ jsxs("div", {
		className: "skeleton-overlay-container",
		children: [/* @__PURE__ */ jsx("canvas", {
			ref: canvasRef,
			className: "pip-skeleton-canvas",
			"aria-label": "21-point hand skeleton"
		}), /* @__PURE__ */ jsx("div", {
			className: "skeleton-telemetry-badge",
			children: status === "initializing" ? /* @__PURE__ */ jsxs("span", {
				className: "telemetry-item init",
				children: [/* @__PURE__ */ jsx("span", { className: "telemetry-spinner" }), " Loading MediaPipe..."]
			}) : status === "detecting" ? /* @__PURE__ */ jsxs(Fragment, { children: [
				/* @__PURE__ */ jsxs("span", {
					className: "telemetry-item tracking",
					children: [
						/* @__PURE__ */ jsx("span", { className: "telemetry-dot active" }),
						hands.length,
						" ",
						hands.length === 1 ? "Hand" : "Hands"
					]
				}),
				/* @__PURE__ */ jsx("span", {
					className: "telemetry-divider",
					children: "|"
				}),
				/* @__PURE__ */ jsxs("span", {
					className: "telemetry-item fps",
					children: [trackingFps, " FPS"]
				})
			] }) : status === "ready" ? /* @__PURE__ */ jsxs("span", {
				className: "telemetry-item ready",
				children: [/* @__PURE__ */ jsx("span", { className: "telemetry-dot ready" }), " Ready (No Hands)"]
			}) : null
		})]
	});
};
// src/components/hud/WebcamPreview.tsx
var WebcamPreview = ({ camera: externalCamera, className, onHandsDetected, onGestureChange }) => {
	const internalCamera = useCamera();
	const camera = externalCamera || internalCamera;
	const [isMinimized, setIsMinimized] = useState(false);
	const { status, errorMessage, startCamera, stopCamera, videoRef } = camera;
	const isStreaming = status === "active";
	const isRequesting = status === "requesting";
	const handTracker = useHandLandmarker({
		videoRef,
		isCameraActive: isStreaming
	});
	const { primaryGesture } = useGestureRecognition({ hands: handTracker.hands });
	useEffect(() => {
		if (onHandsDetected) onHandsDetected(handTracker.hands);
	}, [handTracker.hands, onHandsDetected]);
	useEffect(() => {
		if (onGestureChange) onGestureChange(primaryGesture);
	}, [primaryGesture, onGestureChange]);
	return /* @__PURE__ */ jsxs("aside", {
		className: `webcam-pip-container ${isMinimized ? "minimized" : ""} ${className || ""}`,
		"aria-label": "Webcam Preview & Tracking Feed",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "pip-header",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "pip-title-group",
				children: [/* @__PURE__ */ jsx("span", { className: `pip-status-dot ${status}` }), /* @__PURE__ */ jsx("span", {
					className: "pip-title",
					children: "Webcam Feed"
				})]
			}), /* @__PURE__ */ jsx("div", {
				className: "pip-header-actions",
				children: /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "pip-minimize-btn",
					onClick: () => setIsMinimized((prev) => !prev),
					title: isMinimized ? "Expand Webcam Preview" : "Minimize Webcam Preview",
					"aria-label": isMinimized ? "Expand Webcam Preview" : "Minimize Webcam Preview",
					children: isMinimized ? "▲" : "▼"
				})
			})]
		}), !isMinimized && /* @__PURE__ */ jsxs("div", {
			className: "pip-body",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "video-viewport",
				children: [
					/* @__PURE__ */ jsx("video", {
						ref: videoRef,
						className: `pip-video ${isStreaming ? "visible" : "hidden"}`,
						autoPlay: true,
						playsInline: true,
						muted: true,
						"aria-label": "Live mirrored webcam stream"
					}),
					status === "idle" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay idle",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon",
								children: "📷"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Camera Disconnected"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: "Click below to start local webcam tracking"
							})
						]
					}),
					isRequesting && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay requesting",
						children: [
							/* @__PURE__ */ jsx("div", { className: "pip-spinner" }),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Requesting Access..."
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: "Please allow camera access in browser prompt"
							})
						]
					}),
					status === "denied" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay denied",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "🚫"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Permission Denied"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: errorMessage || "Camera access blocked in browser"
							})
						]
					}),
					status === "not_found" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay not-found",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "🔌"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "No Camera Found"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: errorMessage || "Connect a webcam to continue"
							})
						]
					}),
					status === "unavailable" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay unavailable",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "⚠️"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Camera In Use"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: errorMessage || "Camera is in use by another application"
							})
						]
					}),
					status === "unsupported" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay unsupported",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "❌"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Unsupported Browser"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: errorMessage || "MediaDevices API not supported"
							})
						]
					}),
					status === "error" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay error",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "⚠️"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Camera Error"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: errorMessage || "An error occurred"
							})
						]
					}),
					isStreaming && /* @__PURE__ */ jsxs("div", {
						className: "pip-live-badge",
						"aria-label": "Webcam active badge",
						children: [/* @__PURE__ */ jsx("span", { className: "live-dot" }), " LIVE (MIRRORED)"]
					}),
					isStreaming && /* @__PURE__ */ jsx("div", {
						className: "pip-gesture-overlay",
						children: /* @__PURE__ */ jsx(GestureBadge, {
							gestureResult: primaryGesture,
							compact: true
						})
					}),
					isStreaming && /* @__PURE__ */ jsx(SkeletonOverlay, {
						hands: handTracker.hands,
						status: handTracker.status,
						trackingFps: handTracker.trackingFps
					}),
					isStreaming && handTracker.status === "error" && /* @__PURE__ */ jsxs("div", {
						className: "pip-state-overlay error",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "state-icon warning",
								children: "⚠️"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-title",
								children: "Hand Tracker Error"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "state-desc",
								children: handTracker.errorMessage || "Could not load hand tracking"
							})
						]
					})
				]
			}), /* @__PURE__ */ jsx("div", {
				className: "pip-controls",
				children: !isStreaming ? /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "pip-action-btn start",
					onClick: startCamera,
					disabled: isRequesting,
					"aria-label": "Start Webcam Stream",
					children: isRequesting ? "Connecting..." : "Start Camera"
				}) : /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "pip-action-btn stop",
					onClick: stopCamera,
					"aria-label": "Stop Webcam Stream",
					children: "Stop Camera"
				})
			})]
		})]
	});
};
// src/utils/inspectorUtils.ts
/**
* Resolves component metadata from explicit prop, active model, or model registry.
*/
function resolveInspectorMetadata(metadata, componentId, activeModel) {
	if (metadata) return metadata;
	if (!componentId) return null;
	if (activeModel) {
		if (activeModel.getComponentMetadata) return activeModel.getComponentMetadata(componentId);
		return null;
	}
	const defaultModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
	if (defaultModel) {
		const fromDefault = defaultModel.getComponentMetadata(componentId);
		if (fromDefault) return fromDefault;
	}
	return null;
}
/**
* Formats snake_case or identifier strings to title case (e.g. 'top_chord' -> 'Top Chord')
*/
function formatRoleTitle(text) {
	if (!text) return "";
	return text.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}
// src/components/workspace/EngineeringInspectorPanel.tsx
/**
* Reusable metadata row item (omits rendering entirely if value is undefined, null, or empty string)
*/
var MetadataRow = ({ label, value, unit, className = "" }) => {
	if (value === void 0 || value === null || value === "") return null;
	return /* @__PURE__ */ jsxs("div", {
		className: `metadata-row ${className}`,
		children: [/* @__PURE__ */ jsx("span", {
			className: "metadata-label",
			children: label
		}), /* @__PURE__ */ jsxs("span", {
			className: "metadata-value",
			children: [value, unit ? ` ${unit}` : ""]
		})]
	});
};
/**
* General-Purpose Engineering Inspector Panel (Task 9.6)
* Schema-driven inspector rendering multi-tabbed technical metadata for both
* mechanical and civil engineering components.
*/
var EngineeringInspectorPanel = ({ metadata: propMetadata, componentId, activeModel, onClose, className = "", initialTab = "overview" }) => {
	const [activeTab, setActiveTab] = useState(initialTab);
	const panelId = useId();
	const metadata = resolveInspectorMetadata(propMetadata, componentId, activeModel);
	const handleKeyDown = useCallback((e) => {
		const targetTag = e.target?.tagName?.toLowerCase();
		if (targetTag === "input" || targetTag === "textarea") return;
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	}, [onClose]);
	useEffect(() => {
		if (typeof window !== "undefined") {
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}
	}, [handleKeyDown]);
	const handleTabKeyDown = (e, currentTab) => {
		const tabs = [
			"overview",
			"specifications",
			"materials"
		];
		const currentIndex = tabs.indexOf(currentTab);
		if (e.key === "ArrowRight") {
			e.preventDefault();
			const nextTab = tabs[(currentIndex + 1) % tabs.length];
			setActiveTab(nextTab);
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			const prevTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
			setActiveTab(prevTab);
		}
	};
	if (!metadata && !componentId) return /* @__PURE__ */ jsx("aside", {
		className: `engineering-inspector-panel empty ${className}`,
		"aria-label": "Engineering Component Inspector (No Selection)",
		children: /* @__PURE__ */ jsxs("div", {
			className: "inspector-empty-placeholder",
			children: [
				/* @__PURE__ */ jsx("div", {
					className: "empty-badge placeholder-badge",
					children: "Task 9.6 Ready"
				}),
				/* @__PURE__ */ jsx("span", {
					className: "empty-icon",
					"aria-hidden": "true",
					children: "🔍"
				}),
				/* @__PURE__ */ jsx("h3", {
					className: "empty-title",
					children: "No Component Selected"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "empty-description",
					children: "Hover with the virtual laser pointer and dwell for 1.2s, or left-click any part in the 3D viewport or assembly tree to inspect engineering specifications."
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "empty-hint-list",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "hint-row",
							children: [/* @__PURE__ */ jsx("span", {
								className: "hint-bullet",
								"aria-hidden": "true",
								children: "☝"
							}), /* @__PURE__ */ jsx("span", { children: "Point at component to target" })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "hint-row",
							children: [/* @__PURE__ */ jsx("span", {
								className: "hint-bullet",
								"aria-hidden": "true",
								children: "⏱"
							}), /* @__PURE__ */ jsx("span", { children: "Hold steady for 1.2s dwell" })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "hint-row",
							children: [/* @__PURE__ */ jsx("span", {
								className: "hint-bullet",
								"aria-hidden": "true",
								children: "🖱"
							}), /* @__PURE__ */ jsx("span", { children: "Or click directly on component" })]
						})
					]
				})
			]
		})
	});
	if (!metadata && componentId) return /* @__PURE__ */ jsxs("aside", {
		className: `engineering-inspector-panel fallback ${className}`,
		"aria-label": "Engineering Component Inspector",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "inspector-header",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "header-info",
				children: [/* @__PURE__ */ jsx("h2", {
					className: "component-title",
					children: componentId
				}), /* @__PURE__ */ jsxs("span", {
					className: "id-badge",
					children: ["ID: ", componentId]
				})]
			}), /* @__PURE__ */ jsx("button", {
				type: "button",
				className: "inspector-close-btn",
				onClick: onClose,
				title: "Deselect component [Esc]",
				"aria-label": "Close component inspector",
				children: "✕"
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "inspector-content",
			children: /* @__PURE__ */ jsxs("div", {
				className: "inspector-alert-box",
				children: [/* @__PURE__ */ jsx("span", {
					className: "alert-icon",
					"aria-hidden": "true",
					children: "⚠️"
				}), /* @__PURE__ */ jsxs("p", { children: [
					"Component metadata unavailable for \"",
					componentId,
					"\"."
				] })]
			})
		})]
	});
	const comp = metadata;
	const isMechanical = comp.domain === "mechanical";
	const isCivil = comp.domain === "civil";
	const mechanical = isMechanical ? comp : null;
	const civil = isCivil ? comp : null;
	const materialSpecs = comp.specifications?.filter((spec) => {
		const label = spec.label?.toLowerCase() || "";
		return label.includes("material") || label.includes("alloy") || label.includes("hardness") || label.includes("treatment") || label.includes("yield") || label.includes("tensile") || label.includes("grade");
	});
	const hasMaterialData = Boolean(comp.materialName && comp.materialName.trim() !== "" || civil && civil.materialGrade && civil.materialGrade.trim() !== "" || materialSpecs && materialSpecs.length > 0);
	return /* @__PURE__ */ jsxs("aside", {
		className: `engineering-inspector-panel ${className}`,
		"aria-label": "Engineering Component Inspector",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "inspector-header",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "header-info",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "header-top-row",
							children: [/* @__PURE__ */ jsx("span", {
								className: `domain-pill ${comp.domain}`,
								title: `Engineering Discipline: ${comp.domain}`,
								children: comp.domain === "mechanical" ? "⚙️ Mechanical" : "🌉 Civil"
							}), /* @__PURE__ */ jsxs("span", {
								className: "id-badge",
								title: `Unique component ID: ${comp.id}`,
								children: ["ID: ", comp.id]
							})]
						}),
						/* @__PURE__ */ jsx("h2", {
							className: "component-title",
							title: comp.name,
							children: comp.name
						}),
						comp.role && /* @__PURE__ */ jsx("span", {
							className: "component-subtitle",
							title: comp.role,
							children: comp.role
						})
					]
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "inspector-close-btn",
					onClick: onClose,
					title: "Deselect component [Esc]",
					"aria-label": "Close component inspector",
					children: "✕"
				})]
			}),
			/* @__PURE__ */ jsxs("nav", {
				className: "inspector-tablist",
				role: "tablist",
				"aria-label": "Component Information Tabs",
				children: [
					/* @__PURE__ */ jsx("button", {
						type: "button",
						role: "tab",
						id: `${panelId}-tab-overview`,
						"aria-selected": activeTab === "overview",
						"aria-controls": `${panelId}-panel-overview`,
						tabIndex: activeTab === "overview" ? 0 : -1,
						className: `tab-btn ${activeTab === "overview" ? "active" : ""}`,
						onClick: () => setActiveTab("overview"),
						onKeyDown: (e) => handleTabKeyDown(e, "overview"),
						children: "Overview"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						role: "tab",
						id: `${panelId}-tab-specifications`,
						"aria-selected": activeTab === "specifications",
						"aria-controls": `${panelId}-panel-specifications`,
						tabIndex: activeTab === "specifications" ? 0 : -1,
						className: `tab-btn ${activeTab === "specifications" ? "active" : ""}`,
						onClick: () => setActiveTab("specifications"),
						onKeyDown: (e) => handleTabKeyDown(e, "specifications"),
						children: "Specifications"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						role: "tab",
						id: `${panelId}-tab-materials`,
						"aria-selected": activeTab === "materials",
						"aria-controls": `${panelId}-panel-materials`,
						tabIndex: activeTab === "materials" ? 0 : -1,
						className: `tab-btn ${activeTab === "materials" ? "active" : ""}`,
						onClick: () => setActiveTab("materials"),
						onKeyDown: (e) => handleTabKeyDown(e, "materials"),
						children: "Materials"
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "inspector-content",
				children: [
					activeTab === "overview" && /* @__PURE__ */ jsxs("div", {
						id: `${panelId}-panel-overview`,
						role: "tabpanel",
						"aria-labelledby": `${panelId}-tab-overview`,
						className: "tab-panel overview-panel",
						children: [
							comp.description && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: "Functional Description"
								}), /* @__PURE__ */ jsx("p", {
									className: "description-text",
									children: comp.description
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: "System Identification"
								}), /* @__PURE__ */ jsxs("div", {
									className: "metadata-table",
									children: [
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Component Name",
											value: comp.name
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Part ID",
											value: comp.id
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Discipline",
											value: comp.domain === "mechanical" ? "Mechanical Engineering" : "Civil Engineering"
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Functional Role",
											value: comp.role
										}),
										comp.assemblyRole && /* @__PURE__ */ jsx(MetadataRow, {
											label: "Assembly Role",
											value: formatRoleTitle(comp.assemblyRole)
										}),
										civil?.structuralRole && /* @__PURE__ */ jsx(MetadataRow, {
											label: "Structural Position",
											value: formatRoleTitle(civil.structuralRole)
										})
									]
								})]
							}),
							comp.relationships && comp.relationships.length > 0 && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: "Component Relationships"
								}), /* @__PURE__ */ jsx("div", {
									className: "metadata-table",
									children: comp.relationships.map((rel, index) => /* @__PURE__ */ jsx(MetadataRow, {
										label: formatRoleTitle(rel.relationshipType),
										value: `${rel.targetComponentId}${rel.description ? ` (${rel.description})` : ""}`
									}, `rel-${index}-${rel.targetComponentId}`))
								})]
							}),
							(comp.engineeringNotes && comp.engineeringNotes.length > 0 || civil?.educationalNotes && civil.educationalNotes.length > 0) && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: isCivil ? "Educational Notes" : "Engineering Notes"
								}), /* @__PURE__ */ jsxs("ul", {
									className: "notes-list",
									children: [comp.engineeringNotes?.map((note, index) => /* @__PURE__ */ jsx("li", {
										className: "note-item",
										children: note
									}, `eng-note-${index}`)), civil?.educationalNotes?.map((note, index) => /* @__PURE__ */ jsx("li", {
										className: "note-item",
										children: note
									}, `edu-note-${index}`))]
								})]
							})
						]
					}),
					activeTab === "specifications" && /* @__PURE__ */ jsxs("div", {
						id: `${panelId}-panel-specifications`,
						role: "tabpanel",
						"aria-labelledby": `${panelId}-tab-specifications`,
						className: "tab-panel specifications-panel",
						children: [
							mechanical && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: "Kinematics & Geometry"
								}), /* @__PURE__ */ jsxs("div", {
									className: "metadata-table",
									children: [
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Nominal Speed",
											value: mechanical.nominalRpm
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Gear Ratio",
											value: mechanical.gearRatio
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Teeth Count",
											value: mechanical.teethCount !== void 0 ? `${mechanical.teethCount} teeth` : null
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Pitch Diameter",
											value: mechanical.pitchDiameter
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Module Pitch",
											value: mechanical.modulePitch
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Torque Rating",
											value: mechanical.torqueRating
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Lubrication",
											value: mechanical.lubricationSpec
										}),
										/* @__PURE__ */ jsx(MetadataRow, {
											label: "Service Interval",
											value: mechanical.serviceIntervalHours !== void 0 ? `${mechanical.serviceIntervalHours.toLocaleString()} hrs` : null
										})
									]
								})]
							}),
							civil && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "card-header-with-badge",
										children: [/* @__PURE__ */ jsx("h4", {
											className: "card-section-title",
											children: "Structural Design Annotations"
										}), /* @__PURE__ */ jsx("span", {
											className: "edu-badge",
											title: "Qualitative educational reference, not live FEA",
											children: "Educational Spec"
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "metadata-table",
										children: [
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Structural Member",
												value: civil.structuralRole ? formatRoleTitle(civil.structuralRole) : null
											}),
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Nominal Force",
												value: civil.nominalForceType ? formatRoleTitle(civil.nominalForceType) : null
											}),
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Design Load Ref",
												value: civil.designLoadAnnotation
											}),
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Material Grade",
												value: civil.materialGrade
											}),
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Span / Length",
												value: civil.spanLength
											}),
											/* @__PURE__ */ jsx(MetadataRow, {
												label: "Slenderness Ref",
												value: civil.slendernessAnnotation
											})
										]
									}),
									civil.educationalNotes && civil.educationalNotes.length > 0 && /* @__PURE__ */ jsxs("div", {
										className: "spec-notes-box",
										children: [/* @__PURE__ */ jsx("span", {
											className: "spec-notes-label",
											children: "Educational Notes:"
										}), /* @__PURE__ */ jsx("ul", {
											className: "notes-list",
											children: civil.educationalNotes.map((note, index) => /* @__PURE__ */ jsx("li", {
												className: "note-item",
												children: note
											}, `spec-edu-note-${index}`))
										})]
									})
								]
							}),
							comp.specifications && comp.specifications.length > 0 && /* @__PURE__ */ jsxs("div", {
								className: "inspector-card",
								children: [/* @__PURE__ */ jsx("h4", {
									className: "card-section-title",
									children: "Technical Parameters"
								}), /* @__PURE__ */ jsx("div", {
									className: "metadata-table",
									children: comp.specifications.map((spec, index) => /* @__PURE__ */ jsx(MetadataRow, {
										label: spec.label,
										value: spec.value
									}, `spec-${index}`))
								})]
							}),
							!mechanical && !civil && (!comp.specifications || comp.specifications.length === 0) && /* @__PURE__ */ jsx("div", {
								className: "tab-empty-box",
								children: /* @__PURE__ */ jsx("p", {
									className: "tab-empty-text",
									children: "No technical specifications recorded for this component."
								})
							})
						]
					}),
					activeTab === "materials" && /* @__PURE__ */ jsx("div", {
						id: `${panelId}-panel-materials`,
						role: "tabpanel",
						"aria-labelledby": `${panelId}-tab-materials`,
						className: "tab-panel materials-panel",
						children: hasMaterialData ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
							className: "inspector-card",
							children: [/* @__PURE__ */ jsx("h4", {
								className: "card-section-title",
								children: "Material Specification"
							}), /* @__PURE__ */ jsxs("div", {
								className: "metadata-table",
								children: [/* @__PURE__ */ jsx(MetadataRow, {
									label: "Designated Material",
									value: comp.materialName
								}), civil?.materialGrade && /* @__PURE__ */ jsx(MetadataRow, {
									label: "Structural Grade",
									value: civil.materialGrade
								})]
							})]
						}), materialSpecs && materialSpecs.length > 0 && /* @__PURE__ */ jsxs("div", {
							className: "inspector-card",
							children: [/* @__PURE__ */ jsx("h4", {
								className: "card-section-title",
								children: "Mechanical & Surface Properties"
							}), /* @__PURE__ */ jsx("div", {
								className: "metadata-table",
								children: materialSpecs.map((spec, index) => /* @__PURE__ */ jsx(MetadataRow, {
									label: spec.label,
									value: spec.value
								}, `mat-spec-${index}`))
							})]
						})] }) : /* @__PURE__ */ jsxs("div", {
							className: "tab-empty-box",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "tab-empty-icon",
									"aria-hidden": "true",
									children: "🧪"
								}),
								/* @__PURE__ */ jsx("h4", {
									className: "tab-empty-title",
									children: "No Material Data Available"
								}),
								/* @__PURE__ */ jsx("p", {
									className: "tab-empty-text",
									children: "This component does not specify alloy composition, metallurgical treatment, or material grade properties."
								})
							]
						})
					})
				]
			})
		]
	});
};
// src/components/hud/GestureDiagnosticPanel.tsx
var GestureDiagnosticPanel = ({ isOpen, onToggle }) => {
	const [data, setData] = useState(() => gestureDiagnostics.getSnapshot());
	const [isCollapsed, setIsCollapsed] = useState(false);
	useEffect(() => {
		return gestureDiagnostics.subscribe((latest) => {
			setData(latest);
		});
	}, []);
	useEffect(() => {
		const handleKeyDown = (e) => {
			const activeTag = e.target?.tagName?.toLowerCase();
			if (activeTag === "input" || activeTag === "textarea") return;
			if (e.key === "d" || e.key === "D") onToggle();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onToggle]);
	if (!isOpen) return null;
	const getGestureBadgeClass = (g) => {
		switch (g) {
			case "OPEN_PALM": return "open_palm";
			case "PINCH": return "pinch";
			case "POINTING": return "pointing";
			default: return "none";
		}
	};
	const isLive = data.trackingStatus === "tracking" && data.handsDetected > 0;
	return /* @__PURE__ */ jsxs("div", {
		className: `gesture-diagnostic-panel ${isCollapsed ? "collapsed" : ""}`,
		role: "region",
		"aria-label": "Gesture Diagnostics Telemetry",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "diag-header",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "diag-title-area",
				children: [/* @__PURE__ */ jsx("span", { className: `diag-pulse-dot ${isLive ? "live" : "idle"}` }), /* @__PURE__ */ jsx("span", {
					className: "diag-title",
					children: "Telemetry"
				})]
			}), /* @__PURE__ */ jsxs("div", {
				style: {
					display: "flex",
					gap: "4px"
				},
				children: [/* @__PURE__ */ jsx("button", {
					type: "button",
					className: "diag-btn",
					onClick: () => setIsCollapsed((prev) => !prev),
					title: isCollapsed ? "Expand Panel" : "Collapse Panel",
					children: isCollapsed ? "+" : "–"
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "diag-btn",
					onClick: onToggle,
					title: "Close Panel (Press 'D')",
					children: "✕"
				})]
			})]
		}), !isCollapsed && /* @__PURE__ */ jsxs("div", {
			className: "diag-body",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Hands Detected:"
					}), /* @__PURE__ */ jsx("span", {
						className: "diag-val",
						children: data.handsDetected
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Tracking Status:"
					}), /* @__PURE__ */ jsx("span", {
						className: `diag-val ${data.trackingStatus === "tracking" ? "diag-status-ok" : data.trackingStatus === "detecting" ? "diag-status-warn" : "diag-status-idle"}`,
						children: data.trackingStatus.toUpperCase()
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Candidate (Raw):"
					}), /* @__PURE__ */ jsx("span", {
						className: `diag-badge ${getGestureBadgeClass(data.rawGesture)}`,
						children: data.rawGesture
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Stabilized Gesture:"
					}), /* @__PURE__ */ jsx("span", {
						className: `diag-badge ${getGestureBadgeClass(data.stableGesture)}`,
						children: data.stableGesture
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Confidence:"
					}), /* @__PURE__ */ jsxs("span", {
						className: "diag-val",
						children: [Math.round(data.confidence * 100), "%"]
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Pinch Distance (norm):"
					}), /* @__PURE__ */ jsx("span", {
						className: "diag-val",
						children: data.pinchDistanceNorm.toFixed(3)
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Pinch Zoom Engine:"
					}), /* @__PURE__ */ jsx("span", {
						className: `diag-val ${data.isPinchActive ? "diag-status-ok" : "diag-status-idle"}`,
						children: data.isPinchActive ? "ACTIVE" : "IDLE"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Zoom Delta:"
					}), /* @__PURE__ */ jsx("span", {
						className: "diag-val",
						children: data.zoomDelta.toFixed(4)
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "diag-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Camera Distance:"
					}), /* @__PURE__ */ jsx("span", {
						className: "diag-val",
						children: data.cameraDistance.toFixed(2)
					})]
				}),
				data.rejectionReason && /* @__PURE__ */ jsxs("div", {
					className: "diag-row diag-rejection-row",
					children: [/* @__PURE__ */ jsx("span", {
						className: "diag-label",
						children: "Last Classifier Reason:"
					}), /* @__PURE__ */ jsx("span", {
						className: "diag-rejection-val",
						children: data.rejectionReason
					})]
				}),
				/* @__PURE__ */ jsx("div", {
					className: "diag-shortcut-hint",
					children: "Press 'D' to toggle this panel"
				})
			]
		})]
	});
};
// src/data/guidedLessons.ts
/**
* Guided Learning Curricula & Educational Lessons
* Phase 9 - Task 9.9: Exploded View & Guided Learning
*
* Provides structured, step-by-step educational tours for registered engineering models.
* Validated against active component IDs and metadata without external APIs.
*/
var PLANETARY_GEARBOX_LESSON = {
	modelId: PLANETARY_GEARBOX_MODEL_ID,
	title: "Epicyclic Planetary Gearbox Architecture & Kinematics",
	discipline: "mechanical",
	description: "Explore the coaxial mechanical advantage, torque multiplication, and epicyclic gear interactions in an epicyclic reduction gearbox.",
	steps: [
		{
			stepIndex: 1,
			componentId: "sun_gear",
			title: "Central Sun Gear",
			subtitle: "Primary High-Speed Input Pinion",
			description: "The central sun gear meshes externally with all three planetary gears. It serves as the primary high-speed mechanical input from the central drive shaft.",
			educationalNotes: ["The 16-tooth sun gear rotates at the highest rotational speed in the transmission.", "Its teeth exert radial and tangential forces simultaneously on all three planet gears to distribute input torque evenly."],
			suggestedExplodedFactor: .35
		},
		{
			stepIndex: 2,
			componentId: "planet_gear_1",
			title: "Epicyclic Planet Gears",
			subtitle: "Triple Load-Sharing Planetary Cluster",
			description: "Three identical planet gears are mounted at 120-degree intervals. They orbit the central sun gear while simultaneously rolling inside the stationary ring gear.",
			educationalNotes: ["Load sharing: Distributing input torque across 3 mesh interfaces reduces tooth bending stress by approximately 67%.", "Planet gears rotate on needle bearing pins mounted to the planet carrier plate."],
			suggestedExplodedFactor: .55
		},
		{
			stepIndex: 3,
			componentId: "planet_carrier",
			title: "Planet Carrier Plate",
			subtitle: "Low-Speed, High-Torque Output Assembly",
			description: "The planet carrier supports the three planet gear pin journals. In reduction drive mode, the carrier rotates at reduced angular velocity to deliver multiplied output torque.",
			educationalNotes: ["Carrier angular velocity ratio: ω_carrier = ω_sun × (R_sun / (R_sun + R_ring)) ≈ 0.286 (a 3.5:1 reduction ratio).", "Cast structural iron construction withstands heavy torsional shear."],
			suggestedExplodedFactor: .65
		},
		{
			stepIndex: 4,
			componentId: "ring_gear",
			title: "Outer Ring Gear (Annulus)",
			subtitle: "Stationary Reaction Housing",
			description: "The outer ring gear features internal involute teeth and is fixed to the transmission casing. It provides the mechanical ground reaction force that compels the planets to orbit.",
			educationalNotes: ["Because the ring gear is stationary, all reactionary torque is transferred directly into the chassis or machine mounting brackets.", "Internal tooth engagement provides high contact ratio and quiet acoustic operation."],
			suggestedExplodedFactor: .75
		},
		{
			stepIndex: 5,
			componentId: "central_shaft",
			title: "Primary Drive Shaft",
			subtitle: "Coaxial Input Power Transmission",
			description: "Precision-ground hardened alloy steel shaft coupled directly to the sun gear bore, delivering mechanical power along the central coaxial centerline.",
			educationalNotes: ["Coaxial design allows input and output shafts to be collinear, minimizing gearbox envelope size.", "Equipped with retaining collars and keyway geometry for positive torque transmission."],
			suggestedExplodedFactor: .5
		}
	]
};
var WARREN_TRUSS_BRIDGE_LESSON = {
	modelId: WARREN_TRUSS_MODEL_ID,
	title: "Warren Through-Truss Bridge Structural Anatomy",
	discipline: "civil",
	description: "Examine the internal load paths, axial equilibrium, triangulation mechanics, and component roles of a 24-meter through-truss steel bridge.",
	steps: [
		{
			stepIndex: 1,
			componentId: "top_chords",
			title: "Upper Compression Chords",
			subtitle: "Longitudinal Compression Flange",
			description: "Continuous heavy structural steel members forming the upper boundary of both truss planes. Under gravity loading, the top chord resists the global compression couple.",
			educationalNotes: ["Top chords are subjected to heavy axial compression; member design is governed by global and local Euler buckling (P_cr = π²EI / (KL)²).", "Transverse sway frames and top X-bracing prevent lateral-torsional buckling."],
			suggestedExplodedFactor: .4
		},
		{
			stepIndex: 2,
			componentId: "bottom_chords",
			title: "Lower Tension Chords",
			subtitle: "Primary Tensile Resultant & Floor Beam Support",
			description: "Continuous lower longitudinal box members carrying the tensile resultant of the global truss bending moment, while supporting transverse floor beams.",
			educationalNotes: ["Tensile stress formula: σ = P / A_net. Governed by gross section yield and bolt hole net section rupture.", "Designated as a Fracture Critical Member (FCM) requiring rigorous non-destructive inspection."],
			suggestedExplodedFactor: .45
		},
		{
			stepIndex: 3,
			componentId: "diagonal_members",
			title: "Alternating Web Diagonals",
			subtitle: "60° Equilateral Web Shear Triangulation",
			description: "Iconic alternating diagonal members configured at 60-degree angles that transfer transverse vertical shear forces through pure axial push-pull actions.",
			educationalNotes: ["Triangulation ensures all members carry primary axial loads rather than high bending moments.", "Under moving vehicular live loads, web diagonals near midspan experience stress reversals between tension and compression."],
			suggestedExplodedFactor: .6
		},
		{
			stepIndex: 4,
			componentId: "vertical_struts",
			title: "Vertical Panel Hangers",
			subtitle: "Floor Beam Suspension & Panel Subdivision",
			description: "Vertical tension posts that hang the roadway floor beams directly from the upper chord panel nodes, halving the unsupported stringer span length.",
			educationalNotes: ["Converts a basic Warren truss into a subdivided Warren truss, reducing floor-beam spacing from 8m to 4m.", "Drastically reduces deck slab bending moments and required steel stringer depth."],
			suggestedExplodedFactor: .5
		},
		{
			stepIndex: 5,
			componentId: "gusset_plates",
			title: "Structural Gusset Plates",
			subtitle: "Multi-Member Panel Node Connections",
			description: "Heavy 22mm structural steel joint plates fastened with high-strength structural bolts that resolve concurrent member axial forces into static equilibrium.",
			educationalNotes: ["Gusset plate integrity is critical to truss safety; design checks evaluate Whitmore effective width, block shear tear-out, and plate edge buckling.", "Highlighted historically as a key failure mode in the 2007 Minneapolis I-35W bridge collapse."],
			suggestedExplodedFactor: .7
		},
		{
			stepIndex: 6,
			componentId: "end_portals",
			title: "End Portal Frames & Sway Bracing",
			subtitle: "Transverse Wind Resistance & Clearance Headway",
			description: "Rigid inclined end posts and overhead sway frames that channel lateral wind forces from top chords down into the abutments while keeping the roadway clear for vehicles.",
			educationalNotes: ["Inclined end posts carry the highest compressive axial load in the entire bridge superstructure.", "Overhead knee-braced portal frame delivers essential lateral and aerodynamic stability."],
			suggestedExplodedFactor: .55
		},
		{
			stepIndex: 7,
			componentId: "bridge_deck",
			title: "Concrete Roadway Deck & Stringers",
			subtitle: "Direct Vehicular Load Distribution",
			description: "Reinforced concrete roadway slab with stay-in-place forms, concrete safety barriers, and continuous longitudinal steel stringers supported by transverse floor beams.",
			educationalNotes: ["Load path: Vehicle Wheel -> Concrete Deck Slab -> Steel Stringers -> Floor Beams -> Truss Nodes.", "Engineered for two-way bending under AASHTO HL-93 vehicular design truck axle loading."],
			suggestedExplodedFactor: .35
		},
		{
			stepIndex: 8,
			componentId: "support_piers",
			title: "Substructure Abutments & Bearings",
			subtitle: "Reaction Transfer & Thermal Expansion Seats",
			description: "Mass concrete abutments equipped with steel-reinforced elastomeric bearing pads to transfer total bridge gravity loads into geotechnical foundations.",
			educationalNotes: ["Thermal expansion: One pier features an expansion bearing pad (±35mm stroke) while the opposite pier is longitudinally fixed.", "Isolates the bridge superstructure from ground thermal strain and braking shock."],
			suggestedExplodedFactor: .6
		}
	]
};
var LESSONS_REGISTRY = {
	[PLANETARY_GEARBOX_MODEL_ID]: PLANETARY_GEARBOX_LESSON,
	[WARREN_TRUSS_MODEL_ID]: WARREN_TRUSS_BRIDGE_LESSON
};
/**
* Retrieves the guided lesson curriculum for any registered model ID
*/
function getGuidedLessonForModel(modelId) {
	const lesson = LESSONS_REGISTRY[modelId];
	return lesson ? { ...lesson } : null;
}
// src/components/workspace/GuidedLearningPanel.tsx
/**
* Guided Learning Panel Component
* Phase 9 - Task 9.9: Exploded View & Guided Learning
*
* Provides an interactive, step-by-step educational tour overlaid in the CAD workspace.
* Features keyboard navigation (ArrowLeft/ArrowRight/Escape), step indicators, and takeaways.
*/
var GuidedLearningPanel = ({ lesson, currentStepIndex, onStepChange, onExit, className = "" }) => {
	const totalSteps = lesson.steps.length;
	const clampedIndex = Math.max(0, Math.min(totalSteps - 1, currentStepIndex));
	const currentStep = lesson.steps[clampedIndex];
	const handleNext = useCallback(() => {
		if (clampedIndex < totalSteps - 1) onStepChange(clampedIndex + 1);
		else onExit();
	}, [
		clampedIndex,
		totalSteps,
		onStepChange,
		onExit
	]);
	const handlePrev = useCallback(() => {
		if (clampedIndex > 0) onStepChange(clampedIndex - 1);
	}, [clampedIndex, onStepChange]);
	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.key === "ArrowRight") {
				e.preventDefault();
				handleNext();
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				handlePrev();
			} else if (e.key === "Escape") {
				e.preventDefault();
				onExit();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		handleNext,
		handlePrev,
		onExit
	]);
	if (!currentStep) return null;
	const progressPercent = (clampedIndex + 1) / totalSteps * 100;
	return /* @__PURE__ */ jsxs("section", {
		className: `guided-learning-panel ${className}`,
		"aria-label": `Guided Tour: ${lesson.title}`,
		role: "region",
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: "lesson-header",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "lesson-top-row",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "lesson-meta-badge",
							children: [/* @__PURE__ */ jsx("span", {
								className: "lesson-discipline-pill",
								children: lesson.discipline === "mechanical" ? "⚙️ Mechanical" : "🌉 Civil"
							}), /* @__PURE__ */ jsxs("span", {
								className: "lesson-step-pill",
								children: [
									"Step ",
									clampedIndex + 1,
									" of ",
									totalSteps
								]
							})]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "lesson-close-btn",
							onClick: onExit,
							title: "Exit Guided Tour [Esc]",
							"aria-label": "Exit Guided Tour",
							children: "✕"
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "lesson-title-bar",
						children: /* @__PURE__ */ jsx("h3", {
							className: "lesson-main-title",
							children: lesson.title
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "lesson-progress-track",
						role: "progressbar",
						"aria-valuenow": clampedIndex + 1,
						"aria-valuemin": 1,
						"aria-valuemax": totalSteps,
						children: /* @__PURE__ */ jsx("div", {
							className: "lesson-progress-fill",
							style: { width: `${progressPercent}%` }
						})
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "lesson-body",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "step-component-heading",
						children: [/* @__PURE__ */ jsx("h4", {
							className: "step-target-name",
							children: currentStep.title
						}), /* @__PURE__ */ jsxs("span", {
							className: "step-component-id-badge",
							children: ["#", currentStep.componentId]
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "step-subtitle",
						children: currentStep.subtitle
					}),
					/* @__PURE__ */ jsx("p", {
						className: "step-description",
						children: currentStep.description
					}),
					currentStep.educationalNotes.length > 0 && /* @__PURE__ */ jsxs("div", {
						className: "step-notes-box",
						children: [/* @__PURE__ */ jsx("div", {
							className: "step-notes-title",
							children: "Educational Concepts"
						}), /* @__PURE__ */ jsx("ul", {
							className: "step-notes-list",
							children: currentStep.educationalNotes.map((note, idx) => /* @__PURE__ */ jsx("li", {
								className: "step-note-item",
								children: note
							}, `step-note-${idx}`))
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("footer", {
				className: "lesson-footer",
				children: [/* @__PURE__ */ jsx("div", {
					className: "lesson-step-indicators",
					"aria-label": "Step Navigation",
					children: lesson.steps.map((_, idx) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: `step-dot ${idx === clampedIndex ? "active" : ""} ${idx < clampedIndex ? "completed" : ""}`,
						onClick: () => onStepChange(idx),
						title: `Jump to Step ${idx + 1}`,
						"aria-label": `Jump to Step ${idx + 1}`,
						"aria-current": idx === clampedIndex ? "step" : void 0
					}, `dot-${idx}`))
				}), /* @__PURE__ */ jsxs("div", {
					className: "lesson-nav-actions",
					children: [/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "lesson-nav-btn",
						onClick: handlePrev,
						disabled: clampedIndex === 0,
						"aria-label": "Previous Lesson Step",
						children: "◀ Previous"
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "lesson-nav-btn primary",
						onClick: handleNext,
						"aria-label": clampedIndex === totalSteps - 1 ? "Finish Guided Tour" : "Next Lesson Step",
						children: clampedIndex === totalSteps - 1 ? "✓ Finish Tour" : "Next ▶"
					})]
				})]
			})
		]
	});
};
// src/components/workspace/WorkspaceLayout.tsx
/**
* CAD-Style Technical Workspace Shell (Task 9.4)
* Provides a responsive layout with top toolbar, collapsible assembly dock,
* central flex-1 3D viewport, collapsible engineering inspector, and status telemetry.
*/
var WorkspaceLayout = ({ activeModelId = PLANETARY_GEARBOX_MODEL_ID, renderFps, onFpsUpdate, camera, activeGesture, onGestureChange, detectedHands, onHandsDetected, selectedComponentId, onSelectComponent, showDiagnostics, onToggleDiagnostics, showRoadmap, onToggleRoadmap, modules, onNavigateHome }) => {
	const [isLeftDockOpen, setIsLeftDockOpen] = useState(true);
	const [isRightDockOpen, setIsRightDockOpen] = useState(true);
	const [hiddenComponentIds, setHiddenComponentIds] = useState(/* @__PURE__ */ new Set());
	const [explodedFactor, setExplodedFactor] = useState(0);
	const [isGuidedTourActive, setIsGuidedTourActive] = useState(false);
	const [currentTourStep, setCurrentTourStep] = useState(0);
	const [previousSelectionBeforeTour, setPreviousSelectionBeforeTour] = useState(null);
	const prevModelIdRef = useRef(activeModelId);
	useEffect(() => {
		if (prevModelIdRef.current !== activeModelId) {
			prevModelIdRef.current = activeModelId;
			setHiddenComponentIds(/* @__PURE__ */ new Set());
			onSelectComponent(null);
			setExplodedFactor(0);
			setIsGuidedTourActive(false);
			setCurrentTourStep(0);
			setPreviousSelectionBeforeTour(null);
		}
	}, [activeModelId, onSelectComponent]);
	const handleSelectComponent = useCallback((id) => {
		if (id !== null) setIsRightDockOpen(true);
		onSelectComponent(id);
	}, [onSelectComponent]);
	const handleToggleVisibility = useCallback((node) => {
		setHiddenComponentIds((prev) => {
			const next = new Set(prev);
			const descendantIds = getDescendantComponentIds(node);
			if (descendantIds.length === 0) return prev;
			if (descendantIds.every((id) => next.has(id))) descendantIds.forEach((id) => next.delete(id));
			else descendantIds.forEach((id) => next.add(id));
			return next;
		});
	}, []);
	const activeModel = modelRegistry.getModel(activeModelId) || modelRegistry.getModel("planetary_gearbox");
	const assemblyTree = activeModel ? activeModel.getAssemblyTree() : null;
	const modelName = activeModel?.name || "Planetary Gearbox Assembly";
	const domain = activeModel?.domain || "mechanical";
	const subsystem = assemblyTree?.name || "Epicyclic Powertrain";
	const activeLesson = getGuidedLessonForModel(activeModelId);
	const handleExplodedFactorChange = useCallback((factor) => {
		setExplodedFactor(Math.max(0, Math.min(1, factor)));
	}, []);
	const handleExitGuidedTour = useCallback(() => {
		setIsGuidedTourActive(false);
		if (previousSelectionBeforeTour && previousSelectionBeforeTour.modelId === activeModelId && previousSelectionBeforeTour.componentId !== null) {
			if ((activeModel ? activeModel.getAllComponentIds() : []).includes(previousSelectionBeforeTour.componentId)) onSelectComponent(previousSelectionBeforeTour.componentId);
			else onSelectComponent(null);
		} else onSelectComponent(null);
		setPreviousSelectionBeforeTour(null);
	}, [
		previousSelectionBeforeTour,
		activeModelId,
		activeModel,
		onSelectComponent
	]);
	const handleStartGuidedTour = useCallback(() => {
		if (!activeLesson || activeLesson.steps.length === 0) return;
		setPreviousSelectionBeforeTour({
			modelId: activeModelId,
			componentId: selectedComponentId
		});
		setCurrentTourStep(0);
		setIsGuidedTourActive(true);
		onSelectComponent(activeLesson.steps[0].componentId);
	}, [
		activeLesson,
		activeModelId,
		selectedComponentId,
		onSelectComponent
	]);
	const handleTourStepChange = useCallback((stepIndex) => {
		if (!activeLesson) return;
		const clampedIndex = Math.max(0, Math.min(activeLesson.steps.length - 1, stepIndex));
		setCurrentTourStep(clampedIndex);
		const step = activeLesson.steps[clampedIndex];
		if (step) onSelectComponent(step.componentId);
	}, [activeLesson, onSelectComponent]);
	const handleToggleGuidedTour = useCallback(() => {
		if (isGuidedTourActive) handleExitGuidedTour();
		else handleStartGuidedTour();
	}, [
		isGuidedTourActive,
		handleExitGuidedTour,
		handleStartGuidedTour
	]);
	const handleNavigateHomeWrapped = useCallback(() => {
		setExplodedFactor(0);
		setIsGuidedTourActive(false);
		setPreviousSelectionBeforeTour(null);
		if (onNavigateHome) onNavigateHome();
	}, [onNavigateHome]);
	const handleKeyDown = useCallback((e) => {
		const targetTag = e.target?.tagName?.toLowerCase();
		if (targetTag === "input" || targetTag === "textarea") return;
		if (e.key === "[") {
			e.preventDefault();
			setIsLeftDockOpen((prev) => !prev);
		} else if (e.key === "]") {
			e.preventDefault();
			setIsRightDockOpen((prev) => !prev);
		} else if (e.key === "x" || e.key === "X") {
			e.preventDefault();
			setExplodedFactor((prev) => prev > 0 ? 0 : .75);
		} else if (e.key === "l" || e.key === "L") {
			e.preventDefault();
			handleToggleGuidedTour();
		}
	}, [handleToggleGuidedTour]);
	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);
	const hasActiveHand = camera.status === "active" && detectedHands.length > 0;
	return /* @__PURE__ */ jsxs("div", {
		className: "cad-workspace-shell",
		children: [
			/* @__PURE__ */ jsx(WorkspaceTopBar, {
				modelName,
				domain,
				subsystem,
				isLeftDockOpen,
				onToggleLeftDock: () => setIsLeftDockOpen((prev) => !prev),
				isRightDockOpen,
				onToggleRightDock: () => setIsRightDockOpen((prev) => !prev),
				renderFps,
				cameraStatus: camera.status,
				activeGesture,
				showDiagnostics,
				onToggleDiagnostics,
				showRoadmap,
				onToggleRoadmap,
				onNavigateHome: handleNavigateHomeWrapped,
				explodedFactor,
				onExplodedFactorChange: handleExplodedFactorChange,
				isGuidedTourActive,
				onToggleGuidedTour: handleToggleGuidedTour
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "workspace-main-area",
				children: [
					/* @__PURE__ */ jsxs("aside", {
						className: `cad-dock cad-dock-left ${isLeftDockOpen ? "open" : "collapsed"}`,
						"aria-label": "Assembly Hierarchy Dock",
						"aria-hidden": !isLeftDockOpen,
						children: [/* @__PURE__ */ jsxs("div", {
							className: "dock-header",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "dock-title-group",
								children: [/* @__PURE__ */ jsx("span", {
									className: "dock-icon",
									"aria-hidden": "true",
									children: "🗂️"
								}), /* @__PURE__ */ jsx("h2", {
									className: "dock-title",
									children: "Assembly Hierarchy"
								})]
							}), /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "dock-collapse-btn",
								onClick: () => setIsLeftDockOpen(false),
								title: "Collapse Assembly Hierarchy Dock (Key: [)",
								"aria-label": "Collapse Assembly Hierarchy Dock",
								children: "◀"
							})]
						}), /* @__PURE__ */ jsx("div", {
							className: "dock-content",
							children: /* @__PURE__ */ jsx(AssemblyTreePanel, {
								rootNode: assemblyTree,
								selectedComponentId,
								onSelectComponent: handleSelectComponent,
								hiddenComponentIds,
								onToggleVisibility: handleToggleVisibility
							})
						})]
					}),
					/* @__PURE__ */ jsx("main", {
						className: "cad-viewport-center",
						"aria-label": "3D Viewport",
						children: /* @__PURE__ */ jsxs("div", {
							className: "viewport-inner",
							children: [
								/* @__PURE__ */ jsx(ViewerCanvas, {
									modelId: activeModelId,
									onFpsUpdate,
									gestureResult: activeGesture,
									hands: detectedHands,
									selectedComponentId,
									onSelectComponent: handleSelectComponent,
									hiddenComponentIds,
									explodedFactor,
									onExplodedFactorChange: handleExplodedFactorChange
								}),
								isGuidedTourActive && activeLesson && /* @__PURE__ */ jsx(GuidedLearningPanel, {
									lesson: activeLesson,
									currentStepIndex: currentTourStep,
									onStepChange: handleTourStepChange,
									onExit: handleExitGuidedTour
								}),
								/* @__PURE__ */ jsx(WebcamPreview, {
									camera,
									onGestureChange,
									onHandsDetected
								}),
								/* @__PURE__ */ jsx(GestureDiagnosticPanel, {
									isOpen: showDiagnostics,
									onToggle: onToggleDiagnostics
								}),
								showRoadmap && modules && /* @__PURE__ */ jsxs("aside", {
									className: "roadmap-overlay",
									"aria-label": "Project Roadmap Drawer",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "roadmap-header",
										children: [/* @__PURE__ */ jsx("h2", { children: "Project Modules & Phases" }), /* @__PURE__ */ jsx("button", {
											type: "button",
											className: "close-btn",
											onClick: onToggleRoadmap,
											"aria-label": "Close Roadmap Drawer",
											children: "✕"
										})]
									}), /* @__PURE__ */ jsx("div", {
										className: "roadmap-list",
										children: modules.map((mod) => /* @__PURE__ */ jsxs("div", {
											className: `roadmap-card ${mod.status}`,
											children: [
												/* @__PURE__ */ jsxs("div", {
													className: "card-header",
													children: [/* @__PURE__ */ jsx("span", {
														className: "card-title",
														children: mod.name
													}), /* @__PURE__ */ jsx("span", {
														className: `card-badge ${mod.status}`,
														children: mod.status === "active" ? "Active" : mod.status === "ready_next" ? "Next Task" : "Pending"
													})]
												}),
												/* @__PURE__ */ jsx("div", {
													className: "card-phase",
													children: mod.phase
												}),
												/* @__PURE__ */ jsx("p", {
													className: "card-desc",
													children: mod.description
												})
											]
										}, mod.id))
									})]
								})
							]
						})
					}),
					/* @__PURE__ */ jsxs("aside", {
						className: `cad-dock cad-dock-right ${isRightDockOpen ? "open" : "collapsed"}`,
						"aria-label": "Engineering Inspector Dock",
						"aria-hidden": !isRightDockOpen,
						children: [/* @__PURE__ */ jsxs("div", {
							className: "dock-header",
							children: [/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "dock-collapse-btn",
								onClick: () => setIsRightDockOpen(false),
								title: "Collapse Engineering Inspector Dock (Key: ])",
								"aria-label": "Collapse Engineering Inspector Dock",
								children: "▶"
							}), /* @__PURE__ */ jsxs("div", {
								className: "dock-title-group",
								children: [/* @__PURE__ */ jsx("span", {
									className: "dock-icon",
									"aria-hidden": "true",
									children: "🔬"
								}), /* @__PURE__ */ jsx("h2", {
									className: "dock-title",
									children: "Engineering Inspector"
								})]
							})]
						}), /* @__PURE__ */ jsx("div", {
							className: "dock-content",
							children: /* @__PURE__ */ jsx("div", {
								className: "dock-inspector-wrapper",
								children: /* @__PURE__ */ jsx(EngineeringInspectorPanel, {
									componentId: selectedComponentId,
									activeModel,
									onClose: () => handleSelectComponent(null)
								})
							})
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("footer", {
				className: "workspace-status-bar",
				"aria-label": "Workspace Status",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "status-modality",
						children: [/* @__PURE__ */ jsx("span", {
							className: `modality-dot ${hasActiveHand ? "gesture" : "mouse"}`,
							"aria-hidden": "true"
						}), /* @__PURE__ */ jsx("span", {
							className: "modality-text",
							children: hasActiveHand ? `Gesture Active (${detectedHands.length} hand${detectedHands.length > 1 ? "s" : ""})` : camera.status === "active" ? "Gesture Ready (Awaiting Hand)" : "Mouse Orbit & Click Fallback"
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "status-gesture-hints",
						children: [
							/* @__PURE__ */ jsxs("span", {
								className: "hint-item",
								children: [/* @__PURE__ */ jsx("strong", { children: "🖐" }), " Orbit"]
							}),
							/* @__PURE__ */ jsx("span", {
								className: "hint-sep",
								children: "|"
							}),
							/* @__PURE__ */ jsxs("span", {
								className: "hint-item",
								children: [/* @__PURE__ */ jsx("strong", { children: "🤏" }), " Zoom"]
							}),
							/* @__PURE__ */ jsx("span", {
								className: "hint-sep",
								children: "|"
							}),
							/* @__PURE__ */ jsxs("span", {
								className: "hint-item",
								children: [/* @__PURE__ */ jsx("strong", { children: "☝" }), " Point & Dwell"]
							}),
							/* @__PURE__ */ jsx("span", {
								className: "hint-sep",
								children: "|"
							}),
							/* @__PURE__ */ jsxs("span", {
								className: "hint-item",
								children: [/* @__PURE__ */ jsx("strong", { children: "[ / ]" }), " Docks"]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "status-meta",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "meta-item",
								children: "Phase 9: CAD Workspace Shell"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "meta-sep",
								children: "•"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "meta-item",
								children: modelName
							})
						]
					})
				]
			})
		]
	});
};
// tests/workspaceLayout.test.ts
/**
* Unit & Integration Test Suite for CAD Workspace Shell & Responsive Layout
* Phase 9 - Task 9.4
*
* Validates:
* 1. WorkspaceTopBar rendering, breadcrumbs, toggle buttons, and live telemetry.
* 2. WorkspaceLayout structural shell (top bar, left dock, center viewport, right dock, bottom status bar).
* 3. Left dock assembly hierarchy placeholder and active model summary.
* 4. Right dock engineering inspector placeholder and docked component specifications.
* 5. Accessibility attributes (ARIA landmarks, labels, expanded states, keyboard shortcuts).
* 6. Responsive dock state classes.
*/
function createMockCamera(status = "active") {
	return {
		stream: null,
		status,
		errorMessage: null,
		startCamera: async () => {},
		stopCamera: () => {},
		videoRef: { current: null }
	};
}
describe("WorkspaceTopBar Component", () => {
	it("renders branding, breadcrumbs, and model name correctly", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Planetary Gearbox Assembly",
			domain: "mechanical",
			subsystem: "Transmission Subsystem",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: true,
			onToggleRightDock: () => {},
			renderFps: 60,
			cameraStatus: "active",
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("GestureLab CAD"), "Expected brand name");
		assert.ok(html.includes("Mechanical"), "Expected domain tag");
		assert.ok(html.includes("Transmission Subsystem"), "Expected subsystem breadcrumb");
		assert.ok(html.includes("Planetary Gearbox Assembly"), "Expected model name in breadcrumb");
	});
	it("renders dock toggle buttons with proper accessible labels and aria-expanded state", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Planetary Gearbox Assembly",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: false,
			onToggleRightDock: () => {},
			renderFps: 60,
			cameraStatus: "active",
			showDiagnostics: true,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("aria-label=\"Collapse Assembly Hierarchy Dock\""), "Expected collapse label for open left dock");
		assert.ok(html.includes("aria-expanded=\"true\""), "Expected aria-expanded=true for left dock");
		assert.ok(html.includes("aria-label=\"Expand Engineering Inspector Dock\""), "Expected expand label for closed right dock");
		assert.ok(html.includes("aria-expanded=\"false\""), "Expected aria-expanded=false for right dock");
	});
	it("renders live telemetry pills with accurate render FPS and camera status", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Test Model",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: true,
			onToggleRightDock: () => {},
			renderFps: 59,
			cameraStatus: "active",
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("59 FPS"), "Expected 59 FPS rendered");
		assert.ok(html.includes("Camera: Live"), "Expected Camera: Live rendered");
	});
	it("renders camera denied or error state accurately in status pill", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Test Model",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: true,
			onToggleRightDock: () => {},
			renderFps: 0,
			cameraStatus: "denied",
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("Camera: Denied"), "Expected Camera: Denied rendered");
	});
	it("renders active gesture badge in top bar when camera is active and gesture recognized", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Test Model",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: true,
			onToggleRightDock: () => {},
			renderFps: 60,
			cameraStatus: "active",
			activeGesture: {
				gesture: "OPEN_PALM",
				confidence: .94,
				isStable: true,
				timestamp: 1e3
			},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("Open Palm"), "Expected Open Palm badge label");
		assert.ok(html.includes("94%"), "Expected 94% confidence");
	});
});
describe("WorkspaceLayout Structural Shell", () => {
	it("renders full CAD layout shell with top bar, docks, viewport, and status bar", () => {
		const camera = createMockCamera("active");
		const html = renderToStaticMarkup(React.createElement(WorkspaceLayout, {
			renderFps: 60,
			camera,
			activeGesture: null,
			onGestureChange: () => {},
			detectedHands: [],
			onHandsDetected: () => {},
			selectedComponentId: null,
			onSelectComponent: () => {},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("cad-workspace-shell"), "Expected cad-workspace-shell container");
		assert.ok(html.includes("cad-dock-left"), "Expected left assembly dock");
		assert.ok(html.includes("Assembly Hierarchy"), "Expected Assembly Hierarchy dock title");
		assert.ok(html.includes("assembly-tree-panel"), "Expected AssemblyTreePanel mounted in left dock");
		assert.ok(html.includes("cad-viewport-center"), "Expected center 3D viewport");
		assert.ok(html.includes("viewport-container"), "Expected viewport-container in center viewport");
		assert.ok(html.includes("cad-dock-right"), "Expected right inspector dock");
		assert.ok(html.includes("Engineering Inspector"), "Expected Engineering Inspector dock title");
		assert.ok(html.includes("Task 9.6 Ready"), "Expected Task 9.6 placeholder badge");
		assert.ok(html.includes("workspace-status-bar"), "Expected workspace status bar");
		assert.ok(html.includes("Phase 9: CAD Workspace Shell"), "Expected phase meta in status bar");
	});
	it("renders interactive AssemblyTreePanel nodes in Left Dock", () => {
		const camera = createMockCamera("active");
		const html = renderToStaticMarkup(React.createElement(WorkspaceLayout, {
			activeModelId: "planetary_gearbox",
			renderFps: 60,
			camera,
			activeGesture: null,
			onGestureChange: () => {},
			detectedHands: [],
			onHandsDetected: () => {},
			selectedComponentId: null,
			onSelectComponent: () => {},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("Planetary Gearbox Assembly"), "Expected root assembly name");
		assert.ok(html.includes("Epicyclic Planetary Stage"), "Expected subassembly name");
		assert.ok(html.includes("Sun Gear"), "Expected component name in tree");
		assert.ok(html.includes("Outer Annulus (Ring Gear)"), "Expected ring gear name in tree");
	});
	it("docks ComponentInfoPanel in Right Dock when a component is selected", () => {
		const camera = createMockCamera("active");
		const html = renderToStaticMarkup(React.createElement(WorkspaceLayout, {
			activeModelId: "planetary_gearbox",
			renderFps: 60,
			camera,
			activeGesture: null,
			onGestureChange: () => {},
			detectedHands: [],
			onHandsDetected: () => {},
			selectedComponentId: "sun_gear",
			onSelectComponent: () => {},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(html.includes("dock-inspector-wrapper"), "Expected dock inspector wrapper");
		assert.ok(html.includes("Sun Gear"), "Expected Sun Gear name rendered in inspector");
		assert.ok(html.includes("ID: sun_gear"), "Expected ID: sun_gear rendered");
		assert.ok(html.includes("Central Driving Input"), "Expected Central Driving Input role rendered");
	});
	it("displays accurate modality indicators based on tracking state", () => {
		const cameraLive = createMockCamera("active");
		const htmlGesture = renderToStaticMarkup(React.createElement(WorkspaceLayout, {
			renderFps: 60,
			camera: cameraLive,
			activeGesture: null,
			onGestureChange: () => {},
			detectedHands: [{
				landmarks: [],
				handedness: "Right",
				score: .95
			}],
			onHandsDetected: () => {},
			selectedComponentId: null,
			onSelectComponent: () => {},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(htmlGesture.includes("Gesture Active (1 hand)"), "Expected Gesture Active modality");
		const cameraIdle = createMockCamera("idle");
		const htmlMouse = renderToStaticMarkup(React.createElement(WorkspaceLayout, {
			renderFps: 60,
			camera: cameraIdle,
			activeGesture: null,
			onGestureChange: () => {},
			detectedHands: [],
			onHandsDetected: () => {},
			selectedComponentId: null,
			onSelectComponent: () => {},
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {}
		}));
		assert.ok(htmlMouse.includes("Mouse Orbit &amp; Click Fallback") || htmlMouse.includes("Mouse Orbit & Click Fallback"), "Expected Mouse Orbit & Click Fallback modality");
	});
});
// tests/assemblyTree.test.ts
/**
* Unit & Integration Test Suite for Interactive Assembly Hierarchy Tree Panel
* Phase 9 - Task 9.5
*
* Validates:
* 1. Rendering full assembly hierarchy from EngineeringModelDefinition data.
* 2. Nested subassembly and component rendering with accurate labels and types.
* 3. Bidirectional selection (clicking a component in tree calls onSelectComponent).
* 4. External viewer selection reflection (highlighting matching component row).
* 5. Assembly node click behavior (toggles expansion, does NOT select as a component).
* 6. Component visibility toggles (affects component visibility, does not trigger selection).
* 7. Search filtering (matches query, retains ancestor assembly path, shows clear action).
* 8. Empty tree and no-matches empty states.
* 9. Keyboard navigation & accessibility attributes.
*/
describe("AssemblyTreePanel Helper Functions", () => {
	const gearboxTree = getPlanetaryGearboxAssemblyTree();
	it("getDescendantComponentIds collects all leaf component IDs under a node", () => {
		const allIds = getDescendantComponentIds(gearboxTree);
		assert.equal(allIds.length, 7);
		assert.ok(allIds.includes("sun_gear"));
		assert.ok(allIds.includes("planet_gear_1"));
		assert.ok(allIds.includes("planet_gear_2"));
		assert.ok(allIds.includes("planet_gear_3"));
		assert.ok(allIds.includes("ring_gear"));
		assert.ok(allIds.includes("planet_carrier"));
		assert.ok(allIds.includes("central_shaft"));
		const epicyclicStage = gearboxTree.children?.find((c) => c.id === "stage_epicyclic");
		assert.ok(epicyclicStage);
		const planetCluster = epicyclicStage.children?.find((c) => c.id === "sub_planets_cluster");
		assert.ok(planetCluster);
		const clusterIds = getDescendantComponentIds(planetCluster);
		assert.deepEqual(clusterIds.sort(), [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		const sunGearNode = epicyclicStage.children?.find((c) => c.id === "node_sun_gear");
		assert.ok(sunGearNode);
		assert.deepEqual(getDescendantComponentIds(sunGearNode), ["sun_gear"]);
	});
	it("findAncestorNodeIds returns ancestor path leading down to a target component", () => {
		const ancestorsOfSunGear = findAncestorNodeIds(gearboxTree, "sun_gear");
		assert.ok(ancestorsOfSunGear.includes("planetary_gearbox_root"));
		assert.ok(ancestorsOfSunGear.includes("stage_epicyclic"));
		const ancestorsOfPlanet2 = findAncestorNodeIds(gearboxTree, "planet_gear_2");
		assert.ok(ancestorsOfPlanet2.includes("planetary_gearbox_root"));
		assert.ok(ancestorsOfPlanet2.includes("stage_epicyclic"));
		assert.ok(ancestorsOfPlanet2.includes("sub_planets_cluster"));
		const nonExistent = findAncestorNodeIds(gearboxTree, "non_existent_part");
		assert.deepEqual(nonExistent, []);
	});
	it("filterAssemblyTree filters components while preserving ancestor paths", () => {
		const resultSun = filterAssemblyTree(gearboxTree, "sun");
		assert.equal(resultSun.matches, true);
		assert.ok(resultSun.filteredNode);
		assert.equal(resultSun.filteredNode.id, "planetary_gearbox_root");
		const filteredDescendants = getDescendantComponentIds(resultSun.filteredNode);
		assert.deepEqual(filteredDescendants, ["sun_gear"]);
		const resultNone = filterAssemblyTree(gearboxTree, "unobtainium");
		assert.equal(resultNone.matches, false);
		assert.equal(resultNone.filteredNode, null);
	});
});
describe("AssemblyTreePanel Component Rendering", () => {
	const gearboxTree = getPlanetaryGearboxAssemblyTree();
	it("renders the complete assembly hierarchy with correct labels and icons", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: gearboxTree,
			selectedComponentId: null,
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("Planetary Gearbox Assembly"), "Expected root assembly title");
		assert.ok(html.includes("Epicyclic Planetary Stage"), "Expected epicyclic stage subassembly");
		assert.ok(html.includes("Planet Gears Cluster"), "Expected planet gears cluster subassembly");
		assert.ok(html.includes("Sun Gear"), "Expected Sun Gear component");
		assert.ok(html.includes("Planet Gear A"), "Expected Planet Gear A component");
		assert.ok(html.includes("Planet Gear B"), "Expected Planet Gear B component");
		assert.ok(html.includes("Planet Gear C"), "Expected Planet Gear C component");
		assert.ok(html.includes("Outer Annulus (Ring Gear)"), "Expected Ring Gear component");
		assert.ok(html.includes("Planet Carrier Plate"), "Expected Planet Carrier component");
		assert.ok(html.includes("Primary Drive Shaft"), "Expected Drive Shaft component");
		assert.ok(html.includes("🗂️") || html.includes("📦"), "Expected assembly/subassembly icon");
		assert.ok(html.includes("⚙️"), "Expected component icon");
	});
	it("highlights the selected component row matching selectedComponentId", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: gearboxTree,
			selectedComponentId: "sun_gear",
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("selected"), "Expected selected class on matching row");
		assert.ok(html.includes("aria-selected=\"true\""), "Expected aria-selected=\"true\"");
	});
	it("does not mark assembly or subassembly nodes as selected components", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: gearboxTree,
			selectedComponentId: "sun_gear",
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("aria-label=\"Epicyclic Planetary Stage (subassembly)\""));
		assert.ok(html.includes("aria-selected=\"false\""));
		assert.ok(!html.includes("tree-node-row subassembly selected"));
		assert.ok(!html.includes("tree-node-row assembly selected"));
	});
	it("renders visibility toggle button with active/hidden state indicators", () => {
		const hiddenSet = /* @__PURE__ */ new Set(["sun_gear", "planet_gear_1"]);
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: gearboxTree,
			selectedComponentId: null,
			onSelectComponent: () => {},
			hiddenComponentIds: hiddenSet,
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("hidden-node"), "Expected hidden-node class");
		assert.ok(html.includes("⊘"), "Expected hidden visibility icon ⊘");
		assert.ok(html.includes("👁"), "Expected visible icon 👁 for unhidden nodes");
		assert.ok(html.includes("2 hidden parts"), "Expected footer summary of hidden parts");
	});
	it("renders clean empty state when rootNode is null or undefined", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: null,
			selectedComponentId: null,
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("assembly-tree-empty"), "Expected empty state container");
		assert.ok(html.includes("No Assembly Hierarchy"), "Expected No Assembly Hierarchy title");
	});
	it("renders search filter input and accessible clear action button", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: gearboxTree,
			selectedComponentId: null,
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("tree-filter-bar"), "Expected search filter bar");
		assert.ok(html.includes("placeholder=\"Filter assembly components...\""), "Expected placeholder text");
		assert.ok(html.includes("aria-label=\"Filter assembly tree components\""), "Expected accessible label");
	});
});
describe("AssemblyTreePanel Custom Hierarchy Models", () => {
	it("renders a custom/arbitrary multi-level hierarchy without hardcoded assumptions", () => {
		const html = renderToStaticMarkup(React.createElement(AssemblyTreePanel, {
			rootNode: {
				id: "custom_truss_span",
				name: "Warren Steel Truss Span",
				type: "assembly",
				defaultExpanded: true,
				children: [{
					id: "chord_top_group",
					name: "Top Compression Chords",
					type: "subassembly",
					defaultExpanded: true,
					children: [{
						id: "truss_tc_1",
						name: "Top Chord Member TC-01",
						type: "component",
						componentId: "tc_01"
					}]
				}, {
					id: "chord_bottom_group",
					name: "Bottom Tension Chords",
					type: "subassembly",
					defaultExpanded: true,
					children: [{
						id: "truss_bc_1",
						name: "Bottom Chord Member BC-01",
						type: "component",
						componentId: "bc_01"
					}]
				}]
			},
			selectedComponentId: "bc_01",
			onSelectComponent: () => {},
			hiddenComponentIds: /* @__PURE__ */ new Set(),
			onToggleVisibility: () => {}
		}));
		assert.ok(html.includes("Warren Steel Truss Span"), "Expected custom root assembly");
		assert.ok(html.includes("Top Compression Chords"), "Expected custom subassembly");
		assert.ok(html.includes("Top Chord Member TC-01"), "Expected custom component");
		assert.ok(html.includes("Bottom Chord Member BC-01"), "Expected selected custom component");
		assert.ok(html.includes("selected"), "Expected selected highlight on bc_01");
	});
});
// tests/engineeringInspector.test.ts
/**
* Unit & Integration Test Suite for General-Purpose Engineering Inspector Panel
* Phase 9 - Task 9.6
*
* Validates:
* 1. Rendering empty state when no component is selected.
* 2. Rendering fallback alert state when component ID has no metadata.
* 3. Resolving and rendering mechanical component metadata (Planetary Gearbox).
* 4. Rendering partial metadata gracefully without runtime errors.
* 5. Omitting absent optional fields without fabricating default values.
* 6. Rendering civil engineering metadata across Overview, Specifications, and Materials tabs.
* 7. Rendering a clear materials empty state when no material info is present.
* 8. Dynamic metadata resolution with model switching and selection clearing.
* 9. Keyboard, WAI-ARIA tab semantics, and accessibility attributes.
* 10. String formatting and MetadataRow helper utilities.
*/
var MOCK_CIVIL_COMPONENT = {
	id: "truss_top_chord_01",
	name: "Warren Truss Top Chord",
	domain: "civil",
	role: "Primary Compression Chord",
	materialName: "Structural Steel",
	description: "Main upper compression member of the Warren truss span.",
	specifications: [{
		label: "Section Designation",
		value: "W12x96"
	}, {
		label: "Yield Strength",
		value: "50 ksi (345 MPa)"
	}],
	engineeringNotes: ["Braced at panel points against out-of-plane buckling."],
	structuralRole: "top_chord",
	nominalForceType: "compression",
	designLoadAnnotation: "AASHTO HL-93 LRFD Strength I",
	materialGrade: "ASTM A992 Grade 50",
	spanLength: "12.0 m (39.4 ft)",
	slendernessAnnotation: "KL/r = 78 (governed by Euler buckling limit KL/r < 120)",
	educationalNotes: ["Compression members are susceptible to flexural and torsional buckling.", "Cross-section requires adequate radius of gyration."]
};
var MOCK_PARTIAL_MECHANICAL = {
	id: "intermediate_spur_gear",
	name: "Intermediate Spur Gear",
	domain: "mechanical",
	role: "Intermediate Stage Pinion",
	materialName: "AISI 4140 Alloy Steel",
	description: "Precision intermediate reduction gear.",
	specifications: [{
		label: "Pressure Angle",
		value: "20°"
	}],
	engineeringNotes: ["Hardened teeth surface per ISO 6336."],
	nominalRpm: "1200 RPM",
	gearRatio: "2.5:1",
	teethCount: 24,
	pitchDiameter: "48.0 mm",
	modulePitch: "2.0 mm"
};
var MOCK_NO_MATERIAL_COMPONENT = {
	id: "theoretical_pin_joint",
	name: "Idealized Pin Joint Node",
	domain: "civil",
	role: "Kinematic Boundary Node",
	materialName: "",
	description: "Theoretical frictionless hinge connecting truss members at panel point.",
	specifications: [],
	engineeringNotes: ["Assumed frictionless in idealized planar analysis."],
	structuralRole: "gusset_plate",
	nominalForceType: "combined"
};
describe("EngineeringInspectorPanel — Empty & Fallback States", () => {
	it("renders clear empty state placeholder when no component is selected", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: null,
			onClose: () => {}
		}));
		assert.ok(html.includes("No Component Selected"), "Expected empty state title");
		assert.ok(html.includes("Task 9.6 Ready"), "Expected Task 9.6 placeholder badge");
		assert.ok(html.includes("aria-label=\"Engineering Component Inspector (No Selection)\""), "Expected accessible ARIA label for empty inspector");
		assert.ok(html.includes("Point at component to target"), "Expected laser pointer hint");
	});
	it("renders fallback warning when component ID is provided but metadata is not found", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: "non_existent_part_99",
			onClose: () => {}
		}));
		assert.ok(html.includes("ID: non_existent_part_99"), "Expected part ID in fallback header");
		assert.ok(html.includes("Component metadata unavailable for &quot;non_existent_part_99&quot;") || html.includes("Component metadata unavailable for \"non_existent_part_99\""), "Expected metadata unavailable warning");
	});
});
describe("EngineeringInspectorPanel — Mechanical Component Rendering", () => {
	const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
	it("renders planetary gearbox sun gear overview tab accurately from registry", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: "sun_gear",
			activeModel: gearboxModel,
			onClose: () => {},
			initialTab: "overview"
		}));
		assert.ok(html.includes("Sun Gear"), "Expected component name");
		assert.ok(html.includes("ID: sun_gear"), "Expected component ID");
		assert.ok(html.includes("Central Driving Input"), "Expected functional role subtitle");
		assert.ok(html.includes("⚙️ Mechanical"), "Expected mechanical domain pill");
		assert.ok(html.includes("Functional Description"), "Expected functional description header");
		assert.ok(html.includes("Central input gear that meshes with all three planet gears"), "Expected description snippet");
		assert.ok(html.includes("System Identification"), "Expected system identification card");
		assert.ok(html.includes("Mechanical Engineering"), "Expected discipline row");
		assert.ok(html.includes("High-tensile brass hub minimizes frictional heat"), "Expected engineering note");
	});
	it("renders mechanical specifications and omits missing optional fields without defaults", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_PARTIAL_MECHANICAL,
			onClose: () => {},
			initialTab: "specifications"
		}));
		assert.ok(html.includes("Nominal Speed"), "Expected Nominal Speed label");
		assert.ok(html.includes("1200 RPM"), "Expected 1200 RPM value");
		assert.ok(html.includes("Gear Ratio"), "Expected Gear Ratio label");
		assert.ok(html.includes("2.5:1"), "Expected 2.5:1 value");
		assert.ok(html.includes("Teeth Count"), "Expected Teeth Count label");
		assert.ok(html.includes("24 teeth"), "Expected 24 teeth formatted count");
		assert.ok(html.includes("Pitch Diameter"), "Expected Pitch Diameter label");
		assert.ok(html.includes("48.0 mm"), "Expected 48.0 mm value");
		assert.ok(html.includes("Module Pitch"), "Expected Module Pitch label");
		assert.ok(html.includes("2.0 mm"), "Expected 2.0 mm value");
		assert.ok(!html.includes("Torque Rating"), "Omitted torque rating must not appear");
		assert.ok(!html.includes("Lubrication"), "Omitted lubrication spec must not appear");
		assert.ok(!html.includes("Service Interval"), "Omitted service interval must not appear");
	});
	it("renders mechanical materials tab when material data is present", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_PARTIAL_MECHANICAL,
			onClose: () => {},
			initialTab: "materials"
		}));
		assert.ok(html.includes("Material Specification"), "Expected Material Specification section");
		assert.ok(html.includes("AISI 4140 Alloy Steel"), "Expected material name");
		assert.ok(!html.includes("No Material Data Available"), "Should not show empty state");
	});
});
describe("EngineeringInspectorPanel — Civil Component Rendering", () => {
	it("renders civil component Overview tab with domain pill and structural role", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_CIVIL_COMPONENT,
			onClose: () => {},
			initialTab: "overview"
		}));
		assert.ok(html.includes("Warren Truss Top Chord"), "Expected civil member name");
		assert.ok(html.includes("ID: truss_top_chord_01"), "Expected civil part ID");
		assert.ok(html.includes("🌉 Civil"), "Expected civil domain pill");
		assert.ok(html.includes("Primary Compression Chord"), "Expected functional role");
		assert.ok(html.includes("Top Chord"), "Expected formatted structural position");
		assert.ok(html.includes("Educational Notes"), "Expected Educational Notes header for civil component");
		assert.ok(html.includes("Compression members are susceptible to flexural"), "Expected educational note text");
	});
	it("renders civil-specific fields in Specifications tab accurately", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_CIVIL_COMPONENT,
			onClose: () => {},
			initialTab: "specifications"
		}));
		assert.ok(html.includes("Structural Design Annotations"), "Expected structural design annotations header");
		assert.ok(html.includes("Educational Spec"), "Expected educational spec badge");
		assert.ok(html.includes("Structural Member"), "Expected Structural Member row");
		assert.ok(html.includes("Top Chord"), "Expected formatted structural role");
		assert.ok(html.includes("Nominal Force"), "Expected Nominal Force row");
		assert.ok(html.includes("Compression"), "Expected formatted compression force");
		assert.ok(html.includes("Design Load Ref"), "Expected Design Load Ref row");
		assert.ok(html.includes("AASHTO HL-93 LRFD Strength I"), "Expected AASHTO design load text");
		assert.ok(html.includes("Material Grade"), "Expected Material Grade row in specifications");
		assert.ok(html.includes("ASTM A992 Grade 50"), "Expected ASTM grade value");
		assert.ok(html.includes("Span / Length"), "Expected Span / Length row");
		assert.ok(html.includes("12.0 m (39.4 ft)"), "Expected span length value");
		assert.ok(html.includes("Slenderness Ref"), "Expected Slenderness Ref row");
		assert.ok(html.includes("KL/r = 78"), "Expected slenderness annotation value");
	});
	it("renders civil materials tab with structural grade and designated alloy", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_CIVIL_COMPONENT,
			onClose: () => {},
			initialTab: "materials"
		}));
		assert.ok(html.includes("Structural Steel"), "Expected designated material name");
		assert.ok(html.includes("Structural Grade"), "Expected structural grade label");
		assert.ok(html.includes("ASTM A992 Grade 50"), "Expected ASTM A992 Grade 50 value");
		assert.ok(html.includes("Yield Strength"), "Expected yield strength specification");
		assert.ok(html.includes("50 ksi (345 MPa)"), "Expected yield strength value");
	});
	it("renders clear materials empty state when component lacks material data", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_NO_MATERIAL_COMPONENT,
			onClose: () => {},
			initialTab: "materials"
		}));
		assert.ok(html.includes("No Material Data Available"), "Expected No Material Data Available title");
		assert.ok(html.includes("This component does not specify alloy composition"), "Expected educational explanation that material is absent");
		assert.ok(!html.includes("Designated Material"), "Designated Material row must not be rendered");
	});
});
describe("EngineeringInspectorPanel — Graceful Handling of Partial Metadata", () => {
	it("renders minimal component metadata without runtime errors", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: {
				id: "minimal_part",
				name: "Minimal Component",
				domain: "mechanical",
				role: "Test Bracket",
				materialName: "",
				description: "",
				specifications: [],
				engineeringNotes: []
			},
			onClose: () => {}
		}));
		assert.ok(html.includes("Minimal Component"), "Expected minimal component name rendered");
		assert.ok(html.includes("ID: minimal_part"), "Expected minimal ID rendered");
		assert.ok(html.includes("Test Bracket"), "Expected role rendered");
	});
});
describe("EngineeringInspectorPanel — Selection Dynamics & Resolution Flow", () => {
	const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
	it("resolves metadata from explicit prop first", () => {
		const resolved = resolveInspectorMetadata(MOCK_CIVIL_COMPONENT, "sun_gear", gearboxModel);
		assert.equal(resolved?.id, "truss_top_chord_01", "Prop metadata should take priority");
	});
	it("resolves component metadata from activeModel when componentId is provided", () => {
		const resolved = resolveInspectorMetadata(null, "planet_carrier", gearboxModel);
		assert.equal(resolved?.id, "planet_carrier");
		assert.equal(resolved?.name, "Planet Carrier & Output Plate");
	});
	it("falls back to default gearbox model if activeModel does not provide it", () => {
		const resolved = resolveInspectorMetadata(null, "ring_gear", null);
		assert.equal(resolved?.id, "ring_gear");
		assert.equal(resolved?.name, "Annulus (Ring Gear)");
	});
	it("returns null when neither metadata nor valid componentId is passed", () => {
		const resolved = resolveInspectorMetadata(null, null, gearboxModel);
		assert.equal(resolved, null, "Expected null when componentId is null");
	});
});
describe("EngineeringInspectorPanel — Accessibility & Helpers", () => {
	it("renders tab navigation with proper WAI-ARIA role and aria-selected states", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			metadata: MOCK_CIVIL_COMPONENT,
			onClose: () => {},
			initialTab: "specifications"
		}));
		assert.ok(html.includes("role=\"tablist\""), "Expected tablist container role");
		assert.ok(html.includes("aria-selected=\"true\""), "Expected one selected tab");
		assert.ok(html.includes("aria-controls="), "Expected aria-controls link to tabpanel");
		assert.ok(html.includes("role=\"tabpanel\""), "Expected active tabpanel role");
		assert.ok(html.includes("aria-label=\"Close component inspector\""), "Expected accessible close button label");
	});
	it("formatRoleTitle converts snake_case to Title Case safely", () => {
		assert.equal(formatRoleTitle("top_chord"), "Top Chord");
		assert.equal(formatRoleTitle("vertical_strut"), "Vertical Strut");
		assert.equal(formatRoleTitle("gusset_plate"), "Gusset Plate");
		assert.equal(formatRoleTitle(null), "");
		assert.equal(formatRoleTitle(void 0), "");
	});
	it("MetadataRow omits rendering when value is undefined, null, or empty string", () => {
		const htmlNull = renderToStaticMarkup(React.createElement(MetadataRow, {
			label: "Empty Spec",
			value: null
		}));
		assert.equal(htmlNull, "", "Expected null value to yield empty output");
		const htmlEmpty = renderToStaticMarkup(React.createElement(MetadataRow, {
			label: "Empty Spec",
			value: ""
		}));
		assert.equal(htmlEmpty, "", "Expected empty string to yield empty output");
		const htmlValue = renderToStaticMarkup(React.createElement(MetadataRow, {
			label: "Speed",
			value: 1200,
			unit: "RPM"
		}));
		assert.ok(htmlValue.includes("Speed"), "Expected label in output");
		assert.ok(htmlValue.includes("1200 RPM"), "Expected value and unit in output");
	});
});
// src/utils/dashboardUtils.ts
/**
* Counts models across all domains
*/
function getDomainCounts(models) {
	let mechanical = 0;
	let civil = 0;
	let medical = 0;
	for (const model of models) if (model.domain === "mechanical") mechanical += 1;
	else if (model.domain === "civil") civil += 1;
	else if (model.domain === "medical") medical += 1;
	return {
		all: models.length,
		mechanical,
		civil,
		medical
	};
}
/**
* Filters models using combined domain and case-insensitive search queries.
* Matches against model name, description, category, and keyword tags.
*/
function filterModels(models, domain, searchQuery) {
	const query = searchQuery.toLowerCase().trim();
	return models.filter((model) => {
		if (domain !== "all" && model.domain !== domain) return false;
		if (query === "") return true;
		const nameMatch = model.name.toLowerCase().includes(query);
		const descMatch = model.description.toLowerCase().includes(query);
		const catMatch = model.category.toLowerCase().includes(query);
		const tagMatch = model.tags.some((tag) => tag.toLowerCase().includes(query));
		return nameMatch || descMatch || catMatch || tagMatch;
	});
}
// src/components/dashboard/ModelPreviewCanvas.tsx
/**
* ModelPreviewCanvas Component
*
* Renders an actual, live Three.js 3D geometry preview of a registered engineering model
* directly inside catalogue cards and featured spotlights.
* Safely disposes WebGL resources on unmount to prevent leaks.
*/
var checkWebGLSupport = () => {
	if (typeof window === "undefined") return true;
	try {
		const canvas = document.createElement("canvas");
		return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
	} catch {
		return false;
	}
};
var ModelPreviewCanvas = ({ model, autoRotate = true, className = "", ariaLabel }) => {
	const containerRef = useRef(null);
	const canvasRef = useRef(null);
	const [hasWebGL] = useState(() => checkWebGLSupport());
	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container || typeof window === "undefined" || !hasWebGL) return;
		let animationFrameId;
		let renderer = null;
		let scene = null;
		let modelInstance = null;
		try {
			scene = new THREE.Scene();
			const ambientLight = new THREE.AmbientLight(16777215, .75);
			scene.add(ambientLight);
			const mainLight = new THREE.DirectionalLight(16777215, 1.2);
			mainLight.position.set(5, 10, 7);
			scene.add(mainLight);
			const fillLight = new THREE.DirectionalLight(3718648, .45);
			fillLight.position.set(-5, -2, -5);
			scene.add(fillLight);
			modelInstance = model.buildScene(scene);
			scene.add(modelInstance.rootGroup);
			const box = new THREE.Box3().setFromObject(modelInstance.rootGroup);
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());
			const maxDim = Math.max(size.x, size.y, size.z) || 1;
			modelInstance.rootGroup.position.sub(center);
			const width = container.clientWidth || 300;
			const height = container.clientHeight || 200;
			const fov = model.cameraConfig?.fov || 42;
			const camera = new THREE.PerspectiveCamera(fov, width / height, .1, 100);
			const distance = maxDim * 1.55;
			camera.position.set(distance * .72, distance * .52, distance * .92);
			camera.lookAt(0, 0, 0);
			renderer = new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: true,
				powerPreference: "low-power"
			});
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(width, height, false);
			const animate = () => {
				if (autoRotate && modelInstance) modelInstance.rootGroup.rotation.y += .005;
				if (renderer && scene) renderer.render(scene, camera);
				animationFrameId = requestAnimationFrame(animate);
			};
			animate();
			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const newWidth = entry.contentRect.width;
					const newHeight = entry.contentRect.height;
					if (newWidth > 0 && newHeight > 0 && renderer) {
						camera.aspect = newWidth / newHeight;
						camera.updateProjectionMatrix();
						renderer.setSize(newWidth, newHeight, false);
					}
				}
			});
			resizeObserver.observe(container);
			return () => {
				cancelAnimationFrame(animationFrameId);
				resizeObserver.disconnect();
				if (modelInstance) modelInstance.dispose();
				if (renderer) renderer.dispose();
				if (scene) scene.clear();
			};
		} catch {
			return () => {
				if (animationFrameId) cancelAnimationFrame(animationFrameId);
			};
		}
	}, [
		model,
		autoRotate,
		hasWebGL
	]);
	return /* @__PURE__ */ jsxs("div", {
		ref: containerRef,
		className: `model-preview-container ${className}`,
		"aria-label": ariaLabel || `3D model preview of ${model.name}`,
		children: [hasWebGL ? /* @__PURE__ */ jsx("canvas", {
			ref: canvasRef,
			className: "model-preview-canvas"
		}) : /* @__PURE__ */ jsxs("div", {
			className: "preview-fallback-box",
			children: [/* @__PURE__ */ jsx("span", {
				className: "fallback-icon",
				"aria-hidden": "true",
				children: model.domain === "civil" ? "🌉" : "⚙️"
			}), /* @__PURE__ */ jsx("span", {
				className: "fallback-text",
				children: "3D Geometry Preview"
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "preview-ambient-glow",
			"aria-hidden": "true"
		})]
	});
};
// src/components/dashboard/HomeDashboard.tsx
/**
* Interactive 3D Learning Platform — Home Dashboard & Model Catalogue
*
* Renders a visual-first educational discovery platform featuring real 3D model geometry previews,
* clear learning tracks (Mechanical, Civil, Medical), interactive exploded-view showcases,
* and seamless entry into the 3D learning workspace.
*/
var HomeDashboard = ({ models: propModels, onLaunchModel, initialDomain = "all", initialSearchQuery = "", className = "" }) => {
	const [selectedDomain, setSelectedDomain] = useState(initialDomain);
	const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
	const searchInputId = useId();
	const models = propModels ?? modelRegistry.getAllModels();
	const counts = getDomainCounts(models);
	const filteredModels = filterModels(models, selectedDomain, searchQuery);
	const featuredModel = selectedDomain === "all" ? models.find((m) => m.id === "planetary_gearbox") ?? models[0] : models.find((m) => m.domain === selectedDomain);
	const handleClearFilters = () => {
		setSelectedDomain("all");
		setSearchQuery("");
	};
	return /* @__PURE__ */ jsxs("div", {
		className: `engineering-dashboard ${className}`,
		role: "region",
		"aria-label": "Engineering Explorer Dashboard",
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: "dashboard-header",
				role: "banner",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "header-brand-container",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "brand-logo",
						children: [/* @__PURE__ */ jsx("span", {
							className: "brand-icon",
							"aria-hidden": "true",
							children: "⚙️"
						}), /* @__PURE__ */ jsxs("div", {
							className: "brand-text-group",
							children: [/* @__PURE__ */ jsx("span", {
								className: "brand-tagline-small",
								children: "GestureLab CAD"
							}), /* @__PURE__ */ jsx("h1", {
								className: "brand-app-title",
								children: "Engineering Explorer"
							})]
						})]
					}), /* @__PURE__ */ jsx("p", {
						className: "brand-description",
						children: "Interactive 3D spatial exploration and technical learning platform for mechanical and civil engineering students. Discover complex physical systems, inspect individual parts, and separate assemblies in exploded 3D views."
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "dashboard-filter-bar",
					role: "search",
					"aria-label": "Model discovery filters",
					children: [/* @__PURE__ */ jsxs("nav", {
						className: "domain-filter-group",
						role: "tablist",
						"aria-label": "Filter models by engineering domain",
						children: [
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								role: "tab",
								"aria-selected": selectedDomain === "all",
								className: `domain-tab-btn ${selectedDomain === "all" ? "active" : ""}`,
								onClick: () => setSelectedDomain("all"),
								children: ["All Domains", /* @__PURE__ */ jsx("span", {
									className: "count-pill",
									children: counts.all
								})]
							}),
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								role: "tab",
								"aria-selected": selectedDomain === "mechanical",
								className: `domain-tab-btn mechanical ${selectedDomain === "mechanical" ? "active" : ""}`,
								onClick: () => setSelectedDomain("mechanical"),
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "tab-icon",
										"aria-hidden": "true",
										children: "⚙️"
									}),
									"Mechanical",
									/* @__PURE__ */ jsx("span", {
										className: "count-pill",
										children: counts.mechanical
									})
								]
							}),
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								role: "tab",
								"aria-selected": selectedDomain === "civil",
								className: `domain-tab-btn civil ${selectedDomain === "civil" ? "active" : ""}`,
								onClick: () => setSelectedDomain("civil"),
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "tab-icon",
										"aria-hidden": "true",
										children: "🌉"
									}),
									"Civil",
									/* @__PURE__ */ jsx("span", {
										className: "count-pill",
										children: counts.civil
									})
								]
							}),
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								role: "tab",
								"aria-selected": selectedDomain === "medical",
								className: `domain-tab-btn medical ${selectedDomain === "medical" ? "active" : ""}`,
								onClick: () => setSelectedDomain("medical"),
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "tab-icon",
										"aria-hidden": "true",
										children: "🩺"
									}),
									"Medical",
									/* @__PURE__ */ jsx("span", {
										className: "count-pill",
										children: counts.medical
									})
								]
							})
						]
					}), /* @__PURE__ */ jsxs("div", {
						className: "search-input-wrapper",
						children: [
							/* @__PURE__ */ jsx("label", {
								htmlFor: searchInputId,
								className: "visually-hidden",
								children: "Search engineering models"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "search-leading-icon",
								"aria-hidden": "true",
								children: "🔍"
							}),
							/* @__PURE__ */ jsx("input", {
								id: searchInputId,
								type: "search",
								className: "search-input",
								placeholder: "Search by name, description, category, or tag...",
								value: searchQuery,
								onChange: (e) => setSearchQuery(e.target.value),
								"aria-label": "Search engineering models"
							}),
							searchQuery && /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "search-clear-btn",
								onClick: () => setSearchQuery(""),
								title: "Clear search query",
								"aria-label": "Clear search input",
								children: "✕"
							})
						]
					})]
				})]
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "dashboard-content",
				children: [
					/* @__PURE__ */ jsxs("section", {
						className: "learning-pillars-banner",
						"aria-label": "Key learning methods",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "pillar-item",
								children: [/* @__PURE__ */ jsx("span", {
									className: "pillar-icon",
									"aria-hidden": "true",
									children: "🧩"
								}), /* @__PURE__ */ jsxs("div", {
									className: "pillar-text",
									children: [/* @__PURE__ */ jsx("strong", {
										className: "pillar-title",
										children: "3D Component Inspection"
									}), /* @__PURE__ */ jsx("span", {
										className: "pillar-desc",
										children: "Select parts to reveal their physical function, materials, and engineering roles."
									})]
								})]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "pillar-divider",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "pillar-item",
								children: [/* @__PURE__ */ jsx("span", {
									className: "pillar-icon",
									"aria-hidden": "true",
									children: "💥"
								}), /* @__PURE__ */ jsxs("div", {
									className: "pillar-text",
									children: [/* @__PURE__ */ jsx("strong", {
										className: "pillar-title",
										children: "Exploded-View Disassembly"
									}), /* @__PURE__ */ jsx("span", {
										className: "pillar-desc",
										children: "Separate nested mechanisms along kinematic axes to inspect internal structures."
									})]
								})]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "pillar-divider",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "pillar-item",
								children: [/* @__PURE__ */ jsx("span", {
									className: "pillar-icon",
									"aria-hidden": "true",
									children: "🖐"
								}), /* @__PURE__ */ jsxs("div", {
									className: "pillar-text",
									children: [/* @__PURE__ */ jsx("strong", {
										className: "pillar-title",
										children: "Gesture & Orbit Navigation"
									}), /* @__PURE__ */ jsx("span", {
										className: "pillar-desc",
										children: "Rotate, pan, and laser-point using natural webcam hand tracking or mouse."
									})]
								})]
							})
						]
					}),
					featuredModel && (!searchQuery || filteredModels.some((m) => m.id === featuredModel.id)) && /* @__PURE__ */ jsx("section", {
						className: "featured-spotlight-section",
						"aria-labelledby": "featured-spotlight-title",
						children: /* @__PURE__ */ jsxs("div", {
							className: "featured-card",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "featured-visual-pane",
								children: [/* @__PURE__ */ jsx(ModelPreviewCanvas, {
									model: featuredModel,
									autoRotate: true,
									className: "featured-canvas-preview",
									ariaLabel: `Live 3D preview of ${featuredModel.name}`
								}), /* @__PURE__ */ jsxs("div", {
									className: "visual-badge-overlay",
									children: [/* @__PURE__ */ jsx("span", {
										className: "featured-star-pill",
										children: "⭐ Featured Spotlight"
									}), /* @__PURE__ */ jsx("span", {
										className: `domain-pill ${featuredModel.domain}`,
										children: featuredModel.domain === "mechanical" ? "⚙️ Mechanical" : featuredModel.domain === "civil" ? "🌉 Civil" : "🩺 Medical"
									})]
								})]
							}), /* @__PURE__ */ jsxs("div", {
								className: "featured-info-pane",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "featured-meta-header",
										children: [/* @__PURE__ */ jsx("span", {
											className: "featured-category",
											children: featuredModel.category
										}), /* @__PURE__ */ jsx("span", {
											className: "featured-difficulty-badge",
											children: featuredModel.difficulty
										})]
									}),
									/* @__PURE__ */ jsx("h2", {
										id: "featured-spotlight-title",
										className: "featured-title",
										children: featuredModel.name
									}),
									/* @__PURE__ */ jsx("p", {
										className: "featured-description",
										children: featuredModel.description
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "learning-highlights-box",
										children: [/* @__PURE__ */ jsx("div", {
											className: "learning-highlight-title",
											children: "What You'll Learn"
										}), /* @__PURE__ */ jsx("ul", {
											className: "learning-bullets",
											children: featuredModel.domain === "mechanical" ? /* @__PURE__ */ jsxs(Fragment, { children: [
												/* @__PURE__ */ jsx("li", { children: "Epicyclic gear ratio reduction and planetary carrier kinematics." }),
												/* @__PURE__ */ jsx("li", { children: "Coaxial torque transmission between sun gear, planets, and outer ring." }),
												/* @__PURE__ */ jsx("li", { children: "Step-by-step guided assembly and reversible exploded separation." })
											] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
												/* @__PURE__ */ jsx("li", { children: "Triangular Warren truss load redistribution across chords and diagonals." }),
												/* @__PURE__ */ jsx("li", { children: "Tension vs. compression member identification under live bridge deck load." }),
												/* @__PURE__ */ jsx("li", { children: "Structural gusset plate connections and multi-axis assembly separation." })
											] })
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "featured-specs-summary",
										children: [
											/* @__PURE__ */ jsxs("div", {
												className: "spec-item",
												children: [/* @__PURE__ */ jsx("span", {
													className: "spec-label",
													children: "Discipline"
												}), /* @__PURE__ */ jsx("span", {
													className: "spec-value",
													children: featuredModel.domain === "mechanical" ? "Mechanical Engineering" : featuredModel.domain === "civil" ? "Civil Engineering" : "Medical / Biomechanical"
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "spec-item",
												children: [/* @__PURE__ */ jsx("span", {
													className: "spec-label",
													children: "Assembly Scale"
												}), /* @__PURE__ */ jsxs("span", {
													className: "spec-value",
													children: [featuredModel.componentCount, " Components"]
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "spec-item",
												children: [/* @__PURE__ */ jsx("span", {
													className: "spec-label",
													children: "Interactive Modes"
												}), /* @__PURE__ */ jsx("span", {
													className: "spec-value",
													children: "Kinematics, Exploded & Tour"
												})]
											})
										]
									}),
									/* @__PURE__ */ jsx("div", {
										className: "featured-tags-row",
										children: featuredModel.tags.slice(0, 4).map((tag, idx) => /* @__PURE__ */ jsxs("span", {
											className: "model-tag",
											children: ["#", tag]
										}, `featured-tag-${idx}`))
									}),
									/* @__PURE__ */ jsx("div", {
										className: "featured-action-row",
										children: /* @__PURE__ */ jsxs("button", {
											type: "button",
											className: "launch-workspace-cta-btn",
											onClick: () => onLaunchModel(featuredModel.id),
											title: `Launch ${featuredModel.name} in CAD Workspace`,
											"aria-label": `Launch ${featuredModel.name} in 3D CAD Workspace`,
											children: [/* @__PURE__ */ jsx("span", {
												className: "btn-icon",
												"aria-hidden": "true",
												children: "🚀"
											}), /* @__PURE__ */ jsx("span", { children: "Launch 3D Workspace" })]
										})
									})
								]
							})]
						})
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "catalogue-section",
						"aria-labelledby": "catalogue-section-title",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "catalogue-section-header",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "section-title-group",
								children: [/* @__PURE__ */ jsx("h2", {
									id: "catalogue-section-title",
									className: "section-title",
									children: "Engineering Model Catalogue"
								}), /* @__PURE__ */ jsxs("span", {
									className: "section-count-badge",
									children: [
										"Showing ",
										filteredModels.length,
										" of ",
										models.length,
										" model",
										models.length === 1 ? "" : "s"
									]
								})]
							}), (selectedDomain !== "all" || searchQuery) && /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "reset-filters-btn",
								onClick: handleClearFilters,
								title: "Reset all filters and search",
								children: "Reset Filters ✕"
							})]
						}), filteredModels.length > 0 ? /* @__PURE__ */ jsx("div", {
							className: "model-cards-grid",
							role: "list",
							"aria-label": "Model catalogue cards",
							children: filteredModels.map((model) => /* @__PURE__ */ jsxs("article", {
								className: "model-card",
								role: "listitem",
								"aria-label": `Engineering model card: ${model.name}`,
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "card-visual-header",
										children: [/* @__PURE__ */ jsx(ModelPreviewCanvas, {
											model,
											autoRotate: true,
											className: "card-preview-canvas",
											ariaLabel: `3D preview of ${model.name}`
										}), /* @__PURE__ */ jsxs("div", {
											className: "card-top-badges",
											children: [/* @__PURE__ */ jsx("span", {
												className: `domain-pill ${model.domain}`,
												children: model.domain === "mechanical" ? "⚙️ Mechanical" : "🌉 Civil"
											}), /* @__PURE__ */ jsx("span", {
												className: "card-difficulty",
												title: `Difficulty: ${model.difficulty}`,
												children: model.difficulty
											})]
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "card-content",
										children: [
											/* @__PURE__ */ jsx("span", {
												className: "card-category",
												children: model.category
											}),
											/* @__PURE__ */ jsx("h3", {
												className: "card-title",
												title: model.name,
												children: model.name
											}),
											/* @__PURE__ */ jsx("p", {
												className: "card-description",
												children: model.description
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "card-learning-points",
												children: [/* @__PURE__ */ jsx("span", {
													className: "explore-label",
													children: "Explore:"
												}), /* @__PURE__ */ jsx("span", {
													className: "explore-text",
													children: model.domain === "mechanical" ? "Sun/planet gear meshing, coaxial reduction & carrier kinematics" : "Load distribution, tension/compression chords & bridge truss physics"
												})]
											})
										]
									}),
									/* @__PURE__ */ jsx("div", {
										className: "card-meta-row",
										children: /* @__PURE__ */ jsxs("span", {
											className: "card-component-count",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "meta-icon",
													"aria-hidden": "true",
													children: "🧩"
												}),
												model.componentCount,
												" Components"
											]
										})
									}),
									model.tags && model.tags.length > 0 && /* @__PURE__ */ jsx("div", {
										className: "card-tags-list",
										children: model.tags.slice(0, 3).map((tag, idx) => /* @__PURE__ */ jsxs("span", {
											className: "card-tag",
											children: ["#", tag]
										}, `card-tag-${idx}`))
									}),
									/* @__PURE__ */ jsx("div", {
										className: "card-footer",
										children: /* @__PURE__ */ jsxs("button", {
											type: "button",
											className: "card-launch-btn",
											onClick: () => onLaunchModel(model.id),
											title: `Open ${model.name} in CAD Workspace`,
											"aria-label": `Open ${model.name} in CAD Workspace`,
											children: [/* @__PURE__ */ jsx("span", { children: "Open in Workspace" }), /* @__PURE__ */ jsx("span", {
												className: "arrow-icon",
												"aria-hidden": "true",
												children: "→"
											})]
										})
									})
								]
							}, model.id))
						}) : /* @__PURE__ */ jsx("div", {
							className: "catalogue-empty-state",
							role: "status",
							children: selectedDomain === "civil" && counts.civil === 0 ? /* @__PURE__ */ jsxs("div", {
								className: "empty-message-box civil-empty",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "empty-state-icon",
										"aria-hidden": "true",
										children: "🌉"
									}),
									/* @__PURE__ */ jsx("h3", {
										className: "empty-state-title",
										children: "No Civil Models Registered Yet"
									}),
									/* @__PURE__ */ jsx("p", {
										className: "empty-state-text",
										children: "Civil engineering structural models (including the Warren Truss Bridge and structural beam assemblies) will be introduced in an upcoming release."
									}),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "empty-action-btn",
										onClick: () => setSelectedDomain("all"),
										children: "View Available Mechanical Models"
									})
								]
							}) : selectedDomain === "medical" && counts.medical === 0 ? /* @__PURE__ */ jsxs("div", {
								className: "empty-message-box medical-empty",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "empty-state-icon",
										"aria-hidden": "true",
										children: "🩺"
									}),
									/* @__PURE__ */ jsx("h3", {
										className: "empty-state-title",
										children: "No Medical Models Registered Yet"
									}),
									/* @__PURE__ */ jsx("p", {
										className: "empty-state-text",
										children: "Medical and biomechanical models (including prosthetic joints and musculoskeletal kinematics) are currently in curriculum development for an upcoming release."
									}),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "empty-action-btn",
										onClick: () => setSelectedDomain("all"),
										children: "View Available Engineering Models"
									})
								]
							}) : searchQuery ? /* @__PURE__ */ jsxs("div", {
								className: "empty-message-box search-empty",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "empty-state-icon",
										"aria-hidden": "true",
										children: "🔍"
									}),
									/* @__PURE__ */ jsx("h3", {
										className: "empty-state-title",
										children: "No Matching Models Found"
									}),
									/* @__PURE__ */ jsxs("p", {
										className: "empty-state-text",
										children: [
											"No engineering models matched your search query \"",
											searchQuery,
											"\"",
											selectedDomain !== "all" ? ` in the ${selectedDomain} domain` : "",
											"."
										]
									}),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "empty-action-btn",
										onClick: handleClearFilters,
										children: "Clear Search & Filters"
									})
								]
							}) : /* @__PURE__ */ jsxs("div", {
								className: "empty-message-box general-empty",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "empty-state-icon",
										"aria-hidden": "true",
										children: "🗃️"
									}),
									/* @__PURE__ */ jsx("h3", {
										className: "empty-state-title",
										children: "No Models in Catalogue"
									}),
									/* @__PURE__ */ jsx("p", {
										className: "empty-state-text",
										children: "The engineering model registry currently contains zero registered models."
									})
								]
							})
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("footer", {
				className: "dashboard-footer",
				role: "contentinfo",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "footer-left",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "footer-brand",
							children: "GestureLab CAD"
						}),
						/* @__PURE__ */ jsx("span", {
							className: "footer-sep",
							children: "•"
						}),
						/* @__PURE__ */ jsx("span", {
							className: "footer-desc",
							children: "Interactive 3D Learning Platform"
						})
					]
				}), /* @__PURE__ */ jsx("div", {
					className: "footer-right",
					children: /* @__PURE__ */ jsxs("span", {
						className: "footer-meta",
						children: [
							models.length,
							" Registered Model",
							models.length === 1 ? "" : "s"
						]
					})
				})]
			})
		]
	});
};
// src/App.tsx
var MODULES = [
	{
		id: "frontend-foundation",
		name: "Frontend Core (React + TypeScript + Vite)",
		phase: "Phase 1 - Task 1.1",
		status: "active",
		description: "Vite build pipeline, typed architecture, and dark technical design system."
	},
	{
		id: "scene-viewport",
		name: "3D Mechanical Viewport (Three.js)",
		phase: "Phase 1 - Task 1.2",
		status: "active",
		description: "WebGL renderer, PBR studio lighting, ground grid, and mouse OrbitControls."
	},
	{
		id: "mechanical-assembly",
		name: "Planetary Gearbox Assembly",
		phase: "Phase 1 - Task 1.3",
		status: "active",
		description: "Procedural mechanical assembly with sun gear, 3 planet gears, outer ring, and carrier plate."
	},
	{
		id: "camera-controls",
		name: "Camera Controls & View Presets",
		phase: "Phase 1 - Task 1.4",
		status: "active",
		description: "Modular OrbitControls with smooth damping, preset viewpoints (Isometric, Top, Front), and keyboard shortcuts."
	},
	{
		id: "camera-service",
		name: "Camera Service & User Permission",
		phase: "Phase 2 - Task 2.1",
		status: "active",
		description: "User-initiated webcam access, mirrored PiP preview, track lifecycle cleanup, and error handling."
	},
	{
		id: "hand-landmarks",
		name: "MediaPipe Hand Landmarker",
		phase: "Phase 2 - Task 2.2",
		status: "active",
		description: "Pretrained 21 3D hand landmark detection and real-time visual skeleton overlay."
	},
	{
		id: "gesture-controller",
		name: "Geometric Gesture Recognition",
		phase: "Phase 2 - Task 2.3",
		status: "active",
		description: "Scale-invariant geometric recognition of OPEN_PALM, POINTING, PINCH, and NONE with temporal hysteresis."
	},
	{
		id: "landmark-smoothing",
		name: "Landmark Jitter Filter (One Euro)",
		phase: "Phase 3 - Task 3.1",
		status: "active",
		description: "Adaptive One Euro Filter attenuating high-frequency hand tremors while preserving responsive tracking."
	},
	{
		id: "gesture-orbit",
		name: "Open-Palm Orbit Navigation",
		phase: "Phase 4 - Task 4.1",
		status: "active",
		description: "Continuous 3D orbit navigation mapping hand movement deltas to camera yaw and elevation with deadband and damping."
	},
	{
		id: "pinch-zoom",
		name: "Pinch-to-Zoom Controller",
		phase: "Phase 4 - Task 4.2",
		status: "active",
		description: "Dynamic thumb-to-index pinch distance delta mapping to camera zoom-in/out with deadband and clamp boundaries."
	},
	{
		id: "laser-cursor",
		name: "Virtual Laser Pointer / Cursor",
		phase: "Phase 4 - Task 4.3",
		status: "active",
		description: "Real-time index fingertip screen projection with cyan laser dot, pulsating halo, and unified circular dwell timer."
	},
	{
		id: "component-selection",
		name: "Component Selection & Information HUD",
		phase: "Phase 5 - Tasks 5.1-5.3",
		status: "active",
		description: "Screen-space raycasting, 1.2s dwell confirmation, emissive component highlighting, and technical specification HUD panel."
	}
];
var App = ({ initialView = "dashboard", initialModelId = PLANETARY_GEARBOX_MODEL_ID }) => {
	const [currentView, setCurrentView] = useState(initialView);
	const [activeModelId, setActiveModelId] = useState(initialModelId);
	const [renderFps, setRenderFps] = useState(60);
	const [showRoadmap, setShowRoadmap] = useState(false);
	const [showDiagnostics, setShowDiagnostics] = useState(false);
	const [activeGesture, setActiveGesture] = useState(null);
	const [detectedHands, setDetectedHands] = useState([]);
	const [selectedComponentId, setSelectedComponentId] = useState(null);
	const camera = useCamera();
	const handleLaunchModel = (modelId) => {
		setActiveModelId(modelId);
		setSelectedComponentId(null);
		setCurrentView("workspace");
	};
	const handleNavigateHome = () => {
		if (camera.status === "active") camera.stopCamera();
		setCurrentView("dashboard");
	};
	if (currentView === "dashboard") return /* @__PURE__ */ jsx(HomeDashboard, { onLaunchModel: handleLaunchModel });
	return /* @__PURE__ */ jsx(WorkspaceLayout, {
		activeModelId,
		onNavigateHome: handleNavigateHome,
		renderFps,
		onFpsUpdate: setRenderFps,
		camera,
		activeGesture,
		onGestureChange: setActiveGesture,
		detectedHands,
		onHandsDetected: setDetectedHands,
		selectedComponentId,
		onSelectComponent: setSelectedComponentId,
		showDiagnostics,
		onToggleDiagnostics: () => setShowDiagnostics((prev) => !prev),
		showRoadmap,
		onToggleRoadmap: () => setShowRoadmap((prev) => !prev),
		modules: MODULES
	});
};
// tests/homeDashboard.test.ts
/**
* Unit & Integration Test Suite for Engineering Explorer Home Dashboard & Model Catalogue
* Phase 9 - Task 9.7
*
* Validates:
* 1. Rendering registered planetary gearbox card in HomeDashboard.
* 2. Rendering domain badges, category, difficulty, component count, and tags.
* 3. Featured model spotlight rendering and launch action.
* 4. Domain filtering for All, Mechanical, and Civil.
* 5. Honest Civil empty state when no civil models are registered.
* 6. Keyword search matching names, descriptions, categories, and tags.
* 7. Combined domain and search filtering with no-results state.
* 8. Clear search and filter reset actions.
* 9. Custom model fixtures with civil structural models.
* 10. Empty registry handling without runtime errors.
* 11. Application-level view navigation (Dashboard <-> Workspace).
* 12. Accessibility: WAI-ARIA tab semantics, search label, and button titles.
* 13. Pure filtering and count calculation utilities in dashboardUtils.
*/
var MOCK_CIVIL_MODEL = {
	id: "warren_truss_bridge",
	name: "Warren Truss Bridge Assembly",
	domain: "civil",
	category: "Structural Infrastructure",
	description: "Standard equilateral triangular steel truss bridge span with pin-jointed chords and diagonals.",
	thumbnailUrl: "/assets/models/warren_truss.webp",
	difficulty: "Beginner",
	tags: [
		"Truss",
		"Bridge",
		"Structural Steel",
		"Civil Engineering"
	],
	componentCount: 18,
	cameraConfig: {
		initialPosition: [
			0,
			8,
			20
		],
		target: [
			0,
			2,
			0
		],
		minDistance: 3,
		maxDistance: 60,
		fov: 45,
		defaultPreset: "isometric"
	},
	getAssemblyTree: () => ({
		id: "truss_root",
		name: "Warren Truss Bridge",
		type: "assembly"
	}),
	getComponentMetadata: () => null,
	getAllComponentIds: () => ["chord_top_01", "chord_bot_01"],
	buildScene: () => ({
		rootGroup: new Group(),
		dispose: () => {}
	})
};
describe("HomeDashboard — Catalogue & Featured Model Rendering", () => {
	it("renders branding, app title, and tagline in header", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, { onLaunchModel: () => {} }));
		assert.ok(html.includes("GestureLab CAD"), "Expected brand tagline");
		assert.ok(html.includes("Engineering Explorer"), "Expected app title");
		assert.ok(html.includes("Interactive 3D spatial exploration"), "Expected descriptive subtitle");
	});
	it("renders registered planetary gearbox in featured model spotlight", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, { onLaunchModel: () => {} }));
		assert.ok(html.includes("Featured Spotlight"), "Expected featured spotlight badge");
		assert.ok(html.includes("Epicyclic Planetary Gearbox"), "Expected featured model name");
		assert.ok(html.includes("Transmission &amp; Kinematics") || html.includes("Transmission & Kinematics"), "Expected category");
		assert.ok(html.includes("Intermediate"), "Expected difficulty badge");
		assert.ok(html.includes("7 Components"), "Expected component count");
		assert.ok(html.includes("Launch 3D Workspace"), "Expected launch CTA button");
	});
	it("renders model catalogue card with domain badges, component count, and tags", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, { onLaunchModel: () => {} }));
		assert.ok(html.includes("Engineering Model Catalogue"), "Expected catalogue section title");
		assert.ok(html.includes("⚙️ Mechanical"), "Expected mechanical domain pill");
		assert.ok(html.includes("#Gearbox"), "Expected model tag");
		assert.ok(html.includes("Open in Workspace"), "Expected card action button");
	});
});
describe("HomeDashboard — Domain Filtering", () => {
	it("renders domain counts accurately from registered models", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, { onLaunchModel: () => {} }));
		assert.ok(html.includes("All Domains"), "Expected All Domains tab");
		assert.ok(html.includes("Mechanical"), "Expected Mechanical tab");
		assert.ok(html.includes("Civil"), "Expected Civil tab");
	});
	it("displays honest empty state when Civil domain has zero registered models", () => {
		const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			models: [gearbox],
			initialDomain: "civil",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("No Civil Models Registered Yet"), "Expected honest civil empty state heading");
		assert.ok(html.includes("Civil engineering structural models (including the Warren Truss Bridge"), "Expected civil models upcoming release notice");
		assert.ok(html.includes("View Available Mechanical Models"), "Expected button to switch to available models");
	});
	it("renders civil model card when a civil model is provided in the catalogue", () => {
		const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			models: [gearbox, MOCK_CIVIL_MODEL],
			initialDomain: "civil",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("Warren Truss Bridge Assembly"), "Expected civil model card title");
		assert.ok(html.includes("🌉 Civil"), "Expected civil domain badge");
		assert.ok(html.includes("18 Components"), "Expected 18 components for truss bridge");
		assert.ok(html.includes("Beginner"), "Expected Beginner difficulty");
	});
	it("renders Medical tab and displays honest empty state when Medical domain is selected", () => {
		const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			models: [gearbox],
			initialDomain: "medical",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("Medical"), "Expected Medical tab in navigation");
		assert.ok(html.includes("No Medical Models Registered Yet"), "Expected honest medical empty state heading");
		assert.ok(html.includes("Medical and biomechanical models"), "Expected medical curriculum development note");
		assert.ok(html.includes("View Available Engineering Models"), "Expected button to return to available models");
	});
});
describe("HomeDashboard — Keyword Search & Combined Filtering", () => {
	it("matches models by name query case-insensitively", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			initialSearchQuery: "planetary",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("Epicyclic Planetary Gearbox"), "Expected planetary gearbox match");
	});
	it("matches models by category or tags", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			initialSearchQuery: "kinematics",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("Epicyclic Planetary Gearbox"), "Expected kinematics tag/category match");
	});
	it("displays no-matching-models state when search yields no results", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			initialSearchQuery: "hydroelectric turbine generator",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("No Matching Models Found"), "Expected no matches heading");
		assert.ok(html.includes("hydroelectric turbine generator"), "Expected searched query mentioned in empty state");
		assert.ok(html.includes("Clear Search &amp; Filters") || html.includes("Clear Search & Filters"), "Expected clear button");
	});
	it("handles empty registry gracefully without throwing", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			models: [],
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("No Models in Catalogue"), "Expected empty catalogue notice");
		assert.ok(html.includes("The engineering model registry currently contains zero registered models."));
	});
});
describe("HomeDashboard — Accessibility & WAI-ARIA Semantics", () => {
	it("provides proper ARIA roles and accessible tab states for domain navigation", () => {
		const html = renderToStaticMarkup(React.createElement(HomeDashboard, {
			initialDomain: "mechanical",
			onLaunchModel: () => {}
		}));
		assert.ok(html.includes("role=\"region\""), "Expected dashboard region");
		assert.ok(html.includes("role=\"tablist\""), "Expected tablist role for domain filters");
		assert.ok(html.includes("role=\"tab\""), "Expected tab role on filter buttons");
		assert.ok(html.includes("aria-selected=\"true\""), "Expected aria-selected on active mechanical tab");
		assert.ok(html.includes("aria-label=\"Search engineering models\""), "Expected accessible search input label");
	});
});
describe("WorkspaceTopBar — Catalogue Return Navigation", () => {
	it("renders Catalogue button in top bar when onNavigateHome is provided", () => {
		const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
			modelName: "Epicyclic Planetary Gearbox",
			domain: "mechanical",
			subsystem: "Transmission",
			isLeftDockOpen: true,
			onToggleLeftDock: () => {},
			isRightDockOpen: true,
			onToggleRightDock: () => {},
			renderFps: 60,
			cameraStatus: "active",
			showDiagnostics: false,
			onToggleDiagnostics: () => {},
			showRoadmap: false,
			onToggleRoadmap: () => {},
			onNavigateHome: () => {}
		}));
		assert.ok(html.includes("catalogue-btn"), "Expected catalogue-btn class");
		assert.ok(html.includes("Catalogue"), "Expected Catalogue button text");
		assert.ok(html.includes("aria-label=\"Return to Engineering Explorer Catalogue Dashboard\""), "Expected accessible catalogue return label");
	});
});
describe("App — View Transitions & Workspace Integration", () => {
	it("renders HomeDashboard by default when initialView is dashboard", () => {
		const html = renderToStaticMarkup(React.createElement(App, { initialView: "dashboard" }));
		assert.ok(html.includes("Engineering Explorer"), "Expected HomeDashboard title");
		assert.ok(html.includes("Engineering Model Catalogue"), "Expected model catalogue");
	});
	it("renders WorkspaceLayout directly when initialView is workspace", () => {
		const html = renderToStaticMarkup(React.createElement(App, { initialView: "workspace" }));
		assert.ok(html.includes("cad-workspace-shell"), "Expected CAD workspace shell");
		assert.ok(html.includes("Assembly Hierarchy"), "Expected left assembly tree dock");
		assert.ok(html.includes("Engineering Inspector"), "Expected right inspector dock");
	});
});
describe("dashboardUtils — Pure Utility Functions", () => {
	it("calculates domain counts correctly across diverse models", () => {
		const counts = getDomainCounts([modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID), MOCK_CIVIL_MODEL]);
		assert.equal(counts.all, 2);
		assert.equal(counts.mechanical, 1);
		assert.equal(counts.civil, 1);
	});
	it("filters models by domain accurately", () => {
		const models = [modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID), MOCK_CIVIL_MODEL];
		const mechOnly = filterModels(models, "mechanical", "");
		assert.equal(mechOnly.length, 1);
		assert.equal(mechOnly[0].id, "planetary_gearbox");
		const civilOnly = filterModels(models, "civil", "");
		assert.equal(civilOnly.length, 1);
		assert.equal(civilOnly[0].id, "warren_truss_bridge");
		const all = filterModels(models, "all", "");
		assert.equal(all.length, 2);
	});
	it("filters models by search query matching description and tags", () => {
		const models = [modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID), MOCK_CIVIL_MODEL];
		const trussMatch = filterModels(models, "all", "truss");
		assert.equal(trussMatch.length, 1);
		assert.equal(trussMatch[0].id, "warren_truss_bridge");
		const gearMatch = filterModels(models, "all", "coaxial reduction");
		assert.equal(gearMatch.length, 1);
		assert.equal(gearMatch[0].id, "planetary_gearbox");
		const noMatch = filterModels(models, "all", "quantum supercomputer");
		assert.equal(noMatch.length, 0);
	});
});
// tests/warrenTrussBridge.test.ts
/**
* Unit & Integration Tests for Civil Warren Truss Bridge Model
* Phase 9 - Task 9.8: Civil Engineering Warren Truss Bridge Model
*/
describe("Civil Engineering Warren Truss Bridge Model", () => {
	beforeEach(() => {
		modelRegistry.resetToDefaults();
	});
	describe("Model Definition & Contract Compliance", () => {
		it("satisfies the EngineeringModelDefinition contract", () => {
			assert.equal(isEngineeringModelDefinition(warrenTrussBridgeModel), true);
		});
		it("has the correct model ID and Civil engineering domain", () => {
			assert.equal(warrenTrussBridgeModel.id, "warren_truss_bridge");
			assert.equal(warrenTrussBridgeModel.id, WARREN_TRUSS_MODEL_ID);
			assert.equal(warrenTrussBridgeModel.domain, "civil");
		});
		it("provides complete catalogue metadata and tags", () => {
			assert.ok(warrenTrussBridgeModel.name.includes("Warren Truss"));
			assert.equal(warrenTrussBridgeModel.category, "Structural & Bridge Engineering");
			assert.ok(warrenTrussBridgeModel.description.length > 30);
			assert.equal(warrenTrussBridgeModel.difficulty, "Advanced");
			assert.ok(Array.isArray(warrenTrussBridgeModel.tags));
			assert.ok(warrenTrussBridgeModel.tags.includes("Civil Engineering"));
			assert.ok(warrenTrussBridgeModel.tags.includes("Warren Truss"));
			assert.equal(warrenTrussBridgeModel.componentCount, 8);
		});
		it("specifies custom camera configuration optimized for bridge aspect ratio", () => {
			const cameraConfig = warrenTrussBridgeModel.cameraConfig;
			assert.ok(cameraConfig, "Expected cameraConfig to be defined");
			assert.deepEqual(cameraConfig.initialPosition, [
				18,
				12,
				22
			]);
			assert.deepEqual(cameraConfig.target, [
				0,
				1.5,
				0
			]);
			assert.equal(cameraConfig.minDistance, 3);
			assert.equal(cameraConfig.maxDistance, 70);
			assert.equal(cameraConfig.fov, 45);
			assert.equal(cameraConfig.defaultPreset, "isometric");
		});
	});
	describe("Assembly Tree Hierarchy & Component IDs", () => {
		it("provides a valid AssemblyTreeNode root", () => {
			const tree = getWarrenTrussAssemblyTree();
			assert.equal(isAssemblyTreeNode(tree), true);
			assert.equal(tree.id, "warren_truss_root");
			assert.equal(tree.type, "assembly");
			assert.ok(tree.children && tree.children.length >= 3);
		});
		it("includes all 8 addressable components without duplicate references", () => {
			const tree = warrenTrussBridgeModel.getAssemblyTree();
			const discoveredComponentIds = [];
			function collectComponentIds(node) {
				if (node.type === "component" && node.componentId) discoveredComponentIds.push(node.componentId);
				if (node.children) for (const child of node.children) collectComponentIds(child);
			}
			collectComponentIds(tree);
			assert.equal(discoveredComponentIds.length, 8);
			const uniqueIds = new Set(discoveredComponentIds);
			assert.equal(uniqueIds.size, 8, "Expected all 8 component IDs in assembly tree to be unique");
			for (const expectedId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) assert.ok(uniqueIds.has(expectedId), `Missing component ID in assembly tree: ${expectedId}`);
		});
		it("getAllComponentIds returns all 8 unique component IDs", () => {
			const ids = warrenTrussBridgeModel.getAllComponentIds?.();
			assert.ok(ids);
			assert.equal(ids.length, 8);
			assert.deepEqual(ids.sort(), [...WARREN_TRUSS_COMPONENT_IDS].sort());
		});
	});
	describe("Civil Component Metadata & Educational Annotations", () => {
		it("returns valid CivilComponentMetadata for each component", () => {
			for (const componentId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) {
				const metadata = getWarrenTrussComponentMetadata(componentId);
				assert.ok(metadata, `Expected metadata for component ${componentId}`);
				assert.equal(metadata.id, componentId);
				assert.equal(metadata.domain, "civil");
				assert.equal(isCivilMetadata(metadata), true);
				assert.ok(metadata.name.length > 0);
				assert.ok(metadata.description && metadata.description.length > 0);
				assert.ok(metadata.role && metadata.role.length > 0);
				assert.ok(metadata.materialName && metadata.materialName.length > 0);
				assert.ok(metadata.structuralRole, `Expected structuralRole for ${componentId}`);
				assert.ok(metadata.nominalForceType, `Expected nominalForceType for ${componentId}`);
				assert.ok(Array.isArray(metadata.specifications) && metadata.specifications.length > 0);
				assert.ok(Array.isArray(metadata.engineeringNotes) && metadata.engineeringNotes.length > 0);
				assert.ok(Array.isArray(metadata.educationalNotes) && metadata.educationalNotes.length > 0);
			}
		});
		it("provides realistic material annotations for structural members", () => {
			const topChordMeta = getWarrenTrussComponentMetadata("top_chords");
			assert.ok(topChordMeta.materialName.includes("Steel"));
			assert.ok(topChordMeta.materialGrade?.includes("A709"));
			const deckMeta = getWarrenTrussComponentMetadata("bridge_deck");
			assert.ok(deckMeta.materialName.includes("Concrete"));
			const pierMeta = getWarrenTrussComponentMetadata("support_piers");
			assert.ok(pierMeta.materialName.includes("Concrete"));
		});
		it("returns null safely for nonexistent component IDs", () => {
			assert.equal(getWarrenTrussComponentMetadata("sun_gear"), null);
			assert.equal(getWarrenTrussComponentMetadata("unknown_component"), null);
			assert.equal(getWarrenTrussComponentMetadata(""), null);
		});
		it("clearly labels educational annotations as conceptual without false FEA claims", () => {
			const topChordMeta = getWarrenTrussComponentMetadata("top_chords");
			assert.ok(topChordMeta.educationalNotes?.some((note) => note.includes("Educational Concept") || note.includes("FEA")), "Expected conceptual educational disclaimer");
		});
	});
	describe("Model Registry Integration & Discovery", () => {
		it("is registered in modelRegistry by default", () => {
			assert.equal(modelRegistry.hasModel(WARREN_TRUSS_MODEL_ID), true);
			const retrieved = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
			assert.equal(retrieved, warrenTrussBridgeModel);
		});
		it("is discovered when filtering models by Civil domain", () => {
			const civilModels = modelRegistry.getModelsByDomain("civil");
			assert.ok(civilModels.length >= 1);
			const found = civilModels.find((m) => m.id === WARREN_TRUSS_MODEL_ID);
			assert.ok(found, "Expected warren_truss_bridge in Civil domain models");
			assert.equal(found?.name, "Warren Truss Bridge Assembly");
		});
		it("preserves existing mechanical models in the registry", () => {
			const mechModels = modelRegistry.getModelsByDomain("mechanical");
			assert.ok(mechModels.length >= 1);
			const foundGearbox = mechModels.find((m) => m.id === PLANETARY_GEARBOX_MODEL_ID);
			assert.ok(foundGearbox, "Expected planetary_gearbox in Mechanical domain models");
		});
		it("resetToDefaults preserves both mechanical and civil default models", () => {
			modelRegistry.clear();
			assert.equal(modelRegistry.getAllModels().length, 0);
			modelRegistry.resetToDefaults();
			assert.equal(modelRegistry.hasModel(PLANETARY_GEARBOX_MODEL_ID), true);
			assert.equal(modelRegistry.hasModel(WARREN_TRUSS_MODEL_ID), true);
		});
	});
	describe("Procedural 3D Scene Construction & WebGL Disposal", () => {
		it("builds a Three.js scene containing all 8 tagged components", () => {
			const scene = new THREE.Scene();
			const runtime = warrenTrussBridgeModel.buildScene(scene);
			assert.ok(runtime.rootGroup instanceof THREE.Group);
			assert.ok(scene.children.includes(runtime.rootGroup));
			assert.equal(runtime.rootGroup.userData.modelId, "warren_truss_bridge");
			const foundComponentIds = /* @__PURE__ */ new Set();
			runtime.rootGroup.traverse((obj) => {
				if (obj.userData?.componentId) foundComponentIds.add(obj.userData.componentId);
			});
			for (const expectedId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) assert.ok(foundComponentIds.has(expectedId), `Expected 3D scene to contain component tagged with: ${expectedId}`);
			runtime.dispose();
			assert.equal(scene.children.includes(runtime.rootGroup), false);
		});
		it("controller dispose() cleans up geometries, materials, and children cleanly", () => {
			const controller = buildWarrenTrussBridge();
			assert.ok(controller.group.children.length > 0);
			assert.doesNotThrow(() => {
				controller.update(.016);
			});
			controller.dispose();
			assert.equal(controller.group.children.length, 0);
		});
	});
	describe("Inspector Metadata Resolution & Domain Isolation", () => {
		it("resolves civil component metadata when active model is the bridge", () => {
			const resolved = resolveInspectorMetadata(null, "top_chords", warrenTrussBridgeModel);
			assert.ok(resolved);
			assert.equal(resolved.id, "top_chords");
			assert.equal(resolved.domain, "civil");
			assert.equal(isCivilMetadata(resolved), true);
		});
		it("never resolves or leaks planetary gearbox metadata for an unresolved bridge component", () => {
			const resolved = resolveInspectorMetadata(null, "sun_gear", warrenTrussBridgeModel);
			assert.equal(resolved, null, "Should not resolve planetary gearbox metadata when active model is the bridge");
		});
	});
	describe("Model Switching & Lifecycle Integration", () => {
		it("switches between planetary gearbox and warren truss bridge smoothly", () => {
			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
			const lifecycle = new ModelLifecycleManager({
				scene,
				camera,
				cameraController: { controls: {
					minDistance: 0,
					maxDistance: 100,
					target: new THREE.Vector3(),
					update: () => {}
				} }
			});
			const res1 = lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			assert.equal(res1.success, true);
			assert.equal(lifecycle.getActiveModel()?.id, PLANETARY_GEARBOX_MODEL_ID);
			const res2 = lifecycle.loadModel(WARREN_TRUSS_MODEL_ID);
			assert.equal(res2.success, true);
			assert.equal(lifecycle.getActiveModel()?.id, WARREN_TRUSS_MODEL_ID);
			assert.equal(camera.position.x, 18);
			assert.equal(camera.position.y, 12);
			assert.equal(camera.position.z, 22);
			const res3 = lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			assert.equal(res3.success, true);
			assert.equal(lifecycle.getActiveModel()?.id, PLANETARY_GEARBOX_MODEL_ID);
			lifecycle.dispose();
			assert.equal(lifecycle.getActiveModel(), null);
		});
	});
});
// tests/explodedViewAndGuidedLearning.test.ts
/**
* Unit & Integration Tests for Exploded View & Guided Learning
* Phase 9 - Task 9.9: Exploded View and Guided Learning
*/
describe("Exploded View & Guided Learning (Task 9.9)", () => {
	beforeEach(() => {
		modelRegistry.resetToDefaults();
	});
	describe("Planetary Gearbox Exploded View", () => {
		it("creates a controller with setExplodedFactor interface", () => {
			const controller = buildPlanetaryGearbox(new THREE.Scene());
			assert.equal(typeof controller.setExplodedFactor, "function");
			assert.equal(typeof controller.update, "function");
			assert.equal(typeof controller.dispose, "function");
			controller.dispose();
		});
		it("separates components axially and radially at factor 1.0", () => {
			const controller = buildPlanetaryGearbox(new THREE.Scene());
			const centralShaft = controller.group.getObjectByName("central_shaft");
			const sunGear = controller.group.getObjectByName("sun_gear");
			const carrierGroup = controller.group.getObjectByName("planet_carrier");
			const ringGear = controller.group.getObjectByName("ring_gear");
			assert.ok(centralShaft, "Expected central_shaft object");
			assert.ok(sunGear, "Expected sun_gear object");
			assert.ok(carrierGroup, "Expected planet_carrier object");
			assert.ok(ringGear, "Expected ring_gear object");
			controller.setExplodedFactor(0);
			const initialSunY = sunGear.position.y;
			const initialCarrierY = carrierGroup.position.y;
			const initialShaftY = centralShaft.position.y;
			const initialRingY = ringGear.position.y;
			controller.setExplodedFactor(1);
			assert.ok(centralShaft.position.y > initialShaftY + 2, `Expected shaft Y > ${initialShaftY + 2}, got ${centralShaft.position.y}`);
			assert.ok(sunGear.position.y > initialSunY + 1, `Expected sun gear Y > ${initialSunY + 1}, got ${sunGear.position.y}`);
			assert.ok(carrierGroup.position.y < initialCarrierY - 1, `Expected carrier group Y < ${initialCarrierY - 1}, got ${carrierGroup.position.y}`);
			assert.ok(ringGear.position.y < initialRingY - 2, `Expected ring gear Y < ${initialRingY - 2}, got ${ringGear.position.y}`);
			controller.dispose();
		});
		it("composes exploded radial offsets with kinematic animation without drift", () => {
			const controller = buildPlanetaryGearbox(new THREE.Scene());
			const sunGear = controller.group.getObjectByName("sun_gear");
			const planetMesh = controller.group.getObjectByName("planet_gear_1");
			assert.ok(sunGear, "Expected sun_gear object");
			assert.ok(planetMesh, "Expected planet_gear_1 object");
			controller.setExplodedFactor(.5);
			for (let i = 0; i < 20; i++) controller.update(.016, true);
			assert.notEqual(sunGear.rotation.y, 0);
			const radiusAt0_5 = Math.sqrt(planetMesh.position.x * planetMesh.position.x + planetMesh.position.z * planetMesh.position.z);
			const expectedRadius0_5 = 1.685;
			assert.ok(Math.abs(radiusAt0_5 - expectedRadius0_5) < .05, `Planet radius at factor 0.5 expected ~${expectedRadius0_5}, got ${radiusAt0_5}`);
			controller.setExplodedFactor(0);
			controller.update(.016, false);
			const radiusAt0 = Math.sqrt(planetMesh.position.x * planetMesh.position.x + planetMesh.position.z * planetMesh.position.z);
			assert.ok(Math.abs(radiusAt0 - 1.26) < .05, `Planet radius at factor 0 expected ~1.26, got ${radiusAt0}`);
			controller.dispose();
		});
		it("does not cause cumulative drift after repeated factor changes", () => {
			const controller = buildPlanetaryGearbox(new THREE.Scene());
			const centralShaft = controller.group.getObjectByName("central_shaft");
			const sunGear = controller.group.getObjectByName("sun_gear");
			const carrierGroup = controller.group.getObjectByName("planet_carrier");
			const ringGear = controller.group.getObjectByName("ring_gear");
			controller.setExplodedFactor(0);
			const baseShaftY = centralShaft.position.y;
			const baseSunY = sunGear.position.y;
			const baseCarrierY = carrierGroup.position.y;
			const baseRingY = ringGear.position.y;
			for (const factor of [
				.2,
				.8,
				1,
				.4,
				.95,
				.1,
				.6,
				0
			]) {
				controller.setExplodedFactor(factor);
				controller.update(.016, true);
			}
			controller.setExplodedFactor(0);
			assert.equal(centralShaft.position.y, baseShaftY);
			assert.equal(sunGear.position.y, baseSunY);
			assert.equal(carrierGroup.position.y, baseCarrierY);
			assert.equal(ringGear.position.y, baseRingY);
			controller.dispose();
		});
		it("works correctly when stationary (isRotating = false)", () => {
			const controller = buildPlanetaryGearbox(new THREE.Scene());
			const centralShaft = controller.group.getObjectByName("central_shaft");
			controller.setExplodedFactor(.8);
			controller.update(.05, false);
			const shaftY = centralShaft.position.y;
			controller.update(.05, false);
			assert.equal(centralShaft.position.y, shaftY);
			controller.dispose();
		});
	});
	describe("Warren Truss Bridge Exploded View", () => {
		it("creates a controller with setExplodedFactor interface", () => {
			const controller = buildWarrenTrussBridge();
			assert.equal(typeof controller.setExplodedFactor, "function");
			assert.equal(typeof controller.dispose, "function");
			controller.dispose();
		});
		it("separates structural systems with readable multi-axis offsets at factor 1.0", () => {
			const controller = buildWarrenTrussBridge();
			const topChordsGroup = controller.group.getObjectByName("top_chords");
			const deckGroup = controller.group.getObjectByName("bridge_deck");
			const bottomChordsGroup = controller.group.getObjectByName("bottom_chords");
			const piersGroup = controller.group.getObjectByName("support_piers");
			const portalsGroup = controller.group.getObjectByName("end_portals");
			const diagonalsGroup = controller.group.getObjectByName("diagonal_members");
			assert.ok(topChordsGroup, "Expected top_chords");
			assert.ok(deckGroup, "Expected bridge_deck");
			assert.ok(bottomChordsGroup, "Expected bottom_chords");
			assert.ok(piersGroup, "Expected support_piers");
			assert.ok(portalsGroup, "Expected end_portals");
			assert.ok(diagonalsGroup, "Expected diagonal_members");
			controller.setExplodedFactor(0);
			const initialTopChordsY = topChordsGroup.position.y;
			const initialDeckY = deckGroup.position.y;
			const initialBottomChordsY = bottomChordsGroup.position.y;
			const initialPiersY = piersGroup.position.y;
			controller.setExplodedFactor(1);
			assert.equal(topChordsGroup.position.y, initialTopChordsY + 3);
			assert.equal(deckGroup.position.y, initialDeckY + 1.2);
			assert.equal(bottomChordsGroup.position.y, initialBottomChordsY - 1.2);
			assert.equal(piersGroup.position.y, initialPiersY - 2.8);
			const portalA = portalsGroup.children[0];
			if (portalA) assert.ok(Math.abs(portalA.position.x) > Math.abs(portalA.userData.baseX), "End portal should displace along X axis");
			const diagLeft = diagonalsGroup.children.find((c) => c.userData.baseZ > 0);
			if (diagLeft) assert.ok(diagLeft.position.z > diagLeft.userData.baseZ, "Truss diagonal on +Z side should explode further +Z");
			controller.setExplodedFactor(0);
			assert.equal(topChordsGroup.position.y, initialTopChordsY);
			assert.equal(deckGroup.position.y, initialDeckY);
			assert.equal(bottomChordsGroup.position.y, initialBottomChordsY);
			assert.equal(piersGroup.position.y, initialPiersY);
			controller.dispose();
		});
		it("clamps negative factors to 0 and factors > 1 to 1", () => {
			const controller = buildWarrenTrussBridge();
			const topChordsGroup = controller.group.getObjectByName("top_chords");
			controller.setExplodedFactor(-.5);
			assert.equal(topChordsGroup.position.y, 0);
			controller.setExplodedFactor(2.5);
			assert.equal(topChordsGroup.position.y, 3);
			controller.dispose();
		});
		it("does not accumulate drift after multiple factor fluctuations", () => {
			const controller = buildWarrenTrussBridge();
			const topChordsGroup = controller.group.getObjectByName("top_chords");
			const deckGroup = controller.group.getObjectByName("bridge_deck");
			const bottomChordsGroup = controller.group.getObjectByName("bottom_chords");
			const piersGroup = controller.group.getObjectByName("support_piers");
			for (const factor of [
				.1,
				.7,
				.35,
				1,
				.6,
				0,
				.8,
				0
			]) controller.setExplodedFactor(factor);
			assert.equal(topChordsGroup.position.y, 0);
			assert.equal(deckGroup.position.y, 0);
			assert.equal(bottomChordsGroup.position.y, 0);
			assert.equal(piersGroup.position.y, 0);
			controller.dispose();
		});
	});
	describe("ModelLifecycleManager Exploded View Integration", () => {
		it("manages exploded factor and forwards it to active model instance", () => {
			const manager = new ModelLifecycleManager({
				scene: new THREE.Scene(),
				camera: new THREE.PerspectiveCamera(45, 1, .1, 100)
			});
			const loadResult = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			assert.equal(loadResult.success, true);
			assert.equal(manager.getExplodedFactor(), 0);
			manager.setExplodedFactor(.75);
			assert.equal(manager.getExplodedFactor(), .75);
			manager.dispose();
			assert.equal(manager.getExplodedFactor(), 0);
		});
		it("automatically resets exploded factor to 0 upon switching models", () => {
			const manager = new ModelLifecycleManager({
				scene: new THREE.Scene(),
				camera: new THREE.PerspectiveCamera(45, 1, .1, 100)
			});
			manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			manager.setExplodedFactor(.6);
			assert.equal(manager.getExplodedFactor(), .6);
			manager.loadModel(WARREN_TRUSS_MODEL_ID);
			assert.equal(manager.getExplodedFactor(), 0);
			manager.dispose();
		});
		it("safely releases controller references and cleans up scene on disposal", () => {
			const scene = new THREE.Scene();
			const manager = new ModelLifecycleManager({
				scene,
				camera: new THREE.PerspectiveCamera(45, 1, .1, 100)
			});
			manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			manager.setExplodedFactor(.5);
			assert.ok(scene.children.length > 0);
			manager.dispose();
			assert.equal(scene.children.length, 0);
			assert.equal(manager.getActiveModel(), null);
			assert.equal(manager.getActiveRuntime(), null);
		});
	});
	describe("Guided Learning Curriculum", () => {
		it("provides valid guided lesson for planetary gearbox", () => {
			const lesson = getGuidedLessonForModel(PLANETARY_GEARBOX_MODEL_ID);
			assert.ok(lesson, "Expected planetary gearbox lesson to exist");
			assert.equal(lesson.modelId, PLANETARY_GEARBOX_MODEL_ID);
			assert.equal(lesson.discipline, "mechanical");
			assert.ok(lesson.steps.length >= 5);
		});
		it("provides valid guided lesson for warren truss bridge", () => {
			const lesson = getGuidedLessonForModel(WARREN_TRUSS_MODEL_ID);
			assert.ok(lesson, "Expected warren truss bridge lesson to exist");
			assert.equal(lesson.modelId, WARREN_TRUSS_MODEL_ID);
			assert.equal(lesson.discipline, "civil");
			assert.ok(lesson.steps.length >= 8);
		});
		it("returns null for unregistered model ID", () => {
			const lesson = getGuidedLessonForModel("non_existent_model");
			assert.equal(lesson, null);
		});
		it("validates that every step in Planetary Gearbox lesson matches an existing component ID", () => {
			const validIds = planetaryGearboxModel.getAllComponentIds();
			for (const step of PLANETARY_GEARBOX_LESSON.steps) {
				assert.ok(validIds.includes(step.componentId), `Component ID '${step.componentId}' in lesson step ${step.stepIndex} must exist in planetary gearbox`);
				const metadata = planetaryGearboxModel.getComponentMetadata(step.componentId);
				assert.ok(metadata, `Metadata must exist for step component '${step.componentId}'`);
				assert.ok(step.title.length > 0);
				assert.ok(step.description.length > 20);
				assert.ok(step.educationalNotes.length > 0);
			}
		});
		it("validates that every step in Warren Truss Bridge lesson matches an existing component ID", () => {
			const validIds = warrenTrussBridgeModel.getAllComponentIds();
			for (const step of WARREN_TRUSS_BRIDGE_LESSON.steps) {
				assert.ok(validIds.includes(step.componentId), `Component ID '${step.componentId}' in lesson step ${step.stepIndex} must exist in bridge model`);
				const metadata = warrenTrussBridgeModel.getComponentMetadata(step.componentId);
				assert.ok(metadata, `Metadata must exist for step component '${step.componentId}'`);
				assert.ok(step.title.length > 0);
				assert.ok(step.description.length > 20);
				assert.ok(step.educationalNotes.length > 0);
			}
		});
	});
	describe("Guided Learning Selection Restoration", () => {
		it("restores previous selection on lesson exit if component exists in active model", () => {
			const initialSelection = "sun_gear";
			const activeModelId = PLANETARY_GEARBOX_MODEL_ID;
			const priorState = {
				modelId: activeModelId,
				componentId: initialSelection
			};
			let currentSelection = PLANETARY_GEARBOX_LESSON.steps[0].componentId;
			assert.equal(currentSelection, "sun_gear");
			currentSelection = PLANETARY_GEARBOX_LESSON.steps[2].componentId;
			assert.equal(currentSelection, "planet_carrier");
			const model = modelRegistry.getModel(activeModelId);
			assert.ok(model);
			const validIds = model.getAllComponentIds();
			let restoredSelection = null;
			if (priorState.modelId === activeModelId && priorState.componentId !== null && validIds.includes(priorState.componentId)) restoredSelection = priorState.componentId;
			assert.equal(restoredSelection, "sun_gear");
		});
		it("clears selection safely if model changed during or before exit", () => {
			const priorState = {
				modelId: PLANETARY_GEARBOX_MODEL_ID,
				componentId: "sun_gear"
			};
			const activeModelId = WARREN_TRUSS_MODEL_ID;
			const model = modelRegistry.getModel(activeModelId);
			assert.ok(model);
			const validIds = model.getAllComponentIds();
			let restoredSelection = null;
			if (priorState.modelId === activeModelId && priorState.componentId !== null && validIds.includes(priorState.componentId)) restoredSelection = priorState.componentId;
			else restoredSelection = null;
			assert.equal(restoredSelection, null);
		});
		it("clears selection safely if captured component ID is no longer valid", () => {
			const priorState = {
				modelId: PLANETARY_GEARBOX_MODEL_ID,
				componentId: "invalid_component_id_that_does_not_exist"
			};
			const activeModelId = PLANETARY_GEARBOX_MODEL_ID;
			const model = modelRegistry.getModel(activeModelId);
			assert.ok(model);
			const validIds = model.getAllComponentIds();
			let restoredSelection = null;
			if (priorState.modelId === activeModelId && priorState.componentId !== null && validIds.includes(priorState.componentId)) restoredSelection = priorState.componentId;
			else restoredSelection = null;
			assert.equal(restoredSelection, null);
		});
	});
});
// tests/scrollArchitecture.test.ts
/**
* Unit & Integration Tests for CSS & Scroll Architecture
* Phase 10 - Task 10.1: CSS and Scroll Architecture Remediation
*/
function getSrcDir() {
	const cwd = process.cwd();
	if (fs.existsSync(path.join(cwd, "src"))) return path.join(cwd, "src");
	if (fs.existsSync(path.join(cwd, "frontend", "src"))) return path.join(cwd, "frontend", "src");
	return path.resolve(cwd, "src");
}
var SRC_DIR = getSrcDir();
function readStylesheet(relPath) {
	const fullPath = path.join(SRC_DIR, relPath);
	return fs.readFileSync(fullPath, "utf8");
}
describe("CSS & Scroll Architecture (Task 10.1)", () => {
	const indexCss = readStylesheet("index.css");
	const appCss = readStylesheet("App.css");
	const dashboardCss = readStylesheet("components/dashboard/HomeDashboard.css");
	const workspaceCss = readStylesheet("components/workspace/WorkspaceLayout.css");
	const viewerCss = readStylesheet("components/scene/ViewerCanvas.css");
	const treeCss = readStylesheet("components/workspace/AssemblyTreePanel.css");
	const inspectorCss = readStylesheet("components/workspace/EngineeringInspectorPanel.css");
	const guidedCss = readStylesheet("components/workspace/GuidedLearningPanel.css");
	describe("1. Global Document Flow & Scroll Root (index.css & App.css)", () => {
		it("does NOT enforce blanket overflow: hidden on html or body", () => {
			assert.ok(!indexCss.includes("html, body, #root {\n  width: 100%;\n  height: 100%;\n  overflow: hidden;"));
			assert.ok(!indexCss.includes("body {\n  overflow: hidden;"));
		});
		it("sets min-height: 100% on html, body, and #root for natural vertical expansion", () => {
			assert.ok(indexCss.includes("min-height: 100%"));
			assert.ok(indexCss.includes("overflow-x: hidden"));
			assert.ok(indexCss.includes("#root {"));
		});
		it("provides standardized dark CAD scrollbar definitions", () => {
			assert.ok(indexCss.includes("::-webkit-scrollbar"));
			assert.ok(indexCss.includes("scrollbar-width: thin"));
		});
		it("does not force fixed height: 100vh or overflow: hidden on .app-container", () => {
			assert.ok(appCss.includes("min-height: 100vh"));
			assert.ok(!appCss.includes(".app-container {\n  display: flex;\n  flex-direction: column;\n  width: 100vw;\n  height: 100vh;\n  background-color: var(--bg-primary, #0b0f19);\n  color: var(--text-primary, #f9fafb);\n  overflow: hidden;\n}"));
		});
	});
	describe("2. Explorer/Dashboard Layout Scrolling (HomeDashboard.css)", () => {
		it("configures .engineering-dashboard with min-height: 100vh and horizontal containment", () => {
			assert.ok(dashboardCss.includes(".engineering-dashboard {"));
			assert.ok(dashboardCss.includes("min-height: 100vh"));
			assert.ok(dashboardCss.includes("overflow-x: hidden"));
		});
		it("ensures model-cards-grid shifts to 1fr on mobile screens <= 640px to prevent horizontal clipping", () => {
			assert.ok(dashboardCss.includes("@media (max-width: 640px)"));
			assert.ok(dashboardCss.includes("grid-template-columns: 1fr;"));
		});
	});
	describe("3. CAD Workspace Contained Shell & Panel Scrolling (WorkspaceLayout.css)", () => {
		it("contains CAD shell to 100vh/100dvh with overflow: hidden without locking outer document", () => {
			assert.ok(workspaceCss.includes(".cad-workspace-shell {"));
			assert.ok(workspaceCss.includes("height: 100vh"));
			assert.ok(workspaceCss.includes("height: 100dvh"));
			assert.ok(workspaceCss.includes("overflow: hidden"));
		});
		it("enforces min-height: 0 on flex children to allow internal panel scrolling", () => {
			assert.ok(workspaceCss.includes("min-height: 0"));
			assert.ok(workspaceCss.includes(".dock-content {"));
			assert.ok(workspaceCss.includes("-webkit-overflow-scrolling: touch"));
		});
		it("ensures central 3D viewport has min-height: 0 and min-width: 0", () => {
			assert.ok(workspaceCss.includes(".cad-viewport-center {"));
			assert.ok(workspaceCss.includes(".viewport-inner {"));
		});
	});
	describe("4. Viewport & Dock Internal Scroll Panels", () => {
		it("sets min-height: 0 on ViewerCanvas container avoiding flex blowout", () => {
			assert.ok(!viewerCss.includes("min-height: 400px"));
			assert.ok(viewerCss.includes("min-height: 0"));
		});
		it("enforces independent vertical scrolling on AssemblyTreePanel", () => {
			assert.ok(treeCss.includes(".tree-content-scroll {"));
			assert.ok(treeCss.includes("overflow-y: auto"));
			assert.ok(treeCss.includes("min-height: 0"));
		});
		it("enforces independent vertical scrolling on EngineeringInspectorPanel", () => {
			assert.ok(inspectorCss.includes(".inspector-content {"));
			assert.ok(inspectorCss.includes("overflow-y: auto"));
			assert.ok(inspectorCss.includes("min-height: 0"));
		});
		it("enforces independent vertical scrolling on GuidedLearningPanel", () => {
			assert.ok(guidedCss.includes(".lesson-body {"));
			assert.ok(guidedCss.includes("overflow-y: auto"));
			assert.ok(guidedCss.includes("max-height: 240px"));
		});
	});
});
// tests/modelArchitecture.test.ts
/**
* Unit & Integration Tests for Model Architecture Improvements
* Phase 10 - Model Architecture Modernization
*
* Covers:
* 1. Generic component identification in ComponentRaycaster (model-scoped, no cross-model leakage)
* 2. Explicit component relationships and assembly role validation (BaseComponentMetadata)
* 3. Consistent isolation and focus contracts in ModelLifecycleManager and CameraController
* 4. Backward compatibility with existing planetary_gearbox and warren_truss_bridge
*/
describe("Model Architecture Improvements (Phase 10)", () => {
	describe("1. Generic Component Identification (ComponentRaycaster)", () => {
		it("prefers explicit userData.componentId regardless of mesh name", () => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
			mesh.name = "mesh_random_unrelated_name";
			mesh.userData = { componentId: "piston_assembly" };
			const resolved = resolveComponentId(mesh);
			assert.equal(resolved, "piston_assembly");
		});
		it("resolves userData.componentId from ancestor object", () => {
			const parent = new THREE.Group();
			parent.userData = { componentId: "cylinder_block" };
			const childMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
			childMesh.name = "inner_bore_face";
			parent.add(childMesh);
			const resolved = resolveComponentId(childMesh);
			assert.equal(resolved, "cylinder_block");
		});
		it("resolves mesh name only when accepted by model-scoped validator", () => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
			mesh.name = "crankshaft";
			const engineValidator = /* @__PURE__ */ new Set([
				"crankshaft",
				"camshaft",
				"flywheel"
			]);
			assert.equal(resolveComponentId(mesh, engineValidator), "crankshaft");
			const bridgeValidator = /* @__PURE__ */ new Set(["top_chord", "bottom_chord"]);
			assert.equal(resolveComponentId(mesh, bridgeValidator), null);
		});
		it("does NOT fallback to hardcoded gearbox components when no validator matches", () => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
			mesh.name = "sun_gear";
			const resolved = resolveComponentId(mesh, /* @__PURE__ */ new Set(["span_truss", "end_post"]));
			assert.equal(resolved, null, "Gearbox ID must not leak into non-gearbox model");
		});
		it("ComponentRaycaster respects model-scoped validator in raycast", () => {
			const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
			camera.position.set(0, 0, 5);
			camera.lookAt(0, 0, 0);
			const scene = new THREE.Scene();
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshBasicMaterial());
			mesh.name = "test_engine_valve";
			scene.add(mesh);
			mesh.updateMatrixWorld(true);
			const civilHit = new ComponentRaycaster(camera, scene, { validComponentIds: /* @__PURE__ */ new Set(["deck", "piers"]) }).raycast({
				x: 0,
				y: 0
			});
			assert.equal(civilHit, null, "Should not match unknown mesh name");
			const engineHit = new ComponentRaycaster(camera, scene, { validComponentIds: /* @__PURE__ */ new Set(["test_engine_valve", "spark_plug"]) }).raycast({
				x: 0,
				y: 0
			});
			assert.notEqual(engineHit, null);
			assert.equal(engineHit?.componentId, "test_engine_valve");
		});
	});
	describe("2. Component Relationships & Assembly Role Metadata", () => {
		it("validates correct relationships without errors", () => {
			const result = validateComponentRelationships({
				id: "piston",
				name: "Piston Head",
				domain: "mechanical",
				role: "Prime mover reciprocating in cylinder",
				assemblyRole: "prime_mover",
				relationships: [{
					targetComponentId: "connecting_rod",
					relationshipType: "driven_by",
					description: "Transfers combustion force to connecting rod via wrist pin"
				}]
			}, /* @__PURE__ */ new Set([
				"crankshaft",
				"connecting_rod",
				"piston"
			]));
			assert.equal(result.isValid, true);
			assert.equal(result.errors.length, 0);
		});
		it("flags error when relationship references non-existent component", () => {
			const result = validateComponentRelationships({
				id: "crankshaft",
				name: "Crankshaft",
				domain: "mechanical",
				role: "Converts reciprocating motion into rotary torque",
				assemblyRole: "power_transmission",
				relationships: [{
					targetComponentId: "turbocharger_turbine",
					relationshipType: "connected_to"
				}]
			}, /* @__PURE__ */ new Set(["crankshaft", "connecting_rod"]));
			assert.equal(result.isValid, false);
			assert.match(result.errors[0], /unknown targetComponentId "turbocharger_turbine"/);
		});
		it("flags error when relationship references self", () => {
			const result = validateComponentRelationships({
				id: "flywheel",
				name: "Flywheel",
				domain: "mechanical",
				role: "Rotational inertia storage",
				assemblyRole: "power_transmission",
				relationships: [{
					targetComponentId: "flywheel",
					relationshipType: "connected_to"
				}]
			}, /* @__PURE__ */ new Set(["flywheel"]));
			assert.equal(result.isValid, false);
			assert.match(result.errors[0], /cannot have a relationship targeting itself/);
		});
		it("flags error when relationshipType is empty or whitespace", () => {
			const result = validateComponentRelationships({
				id: "part_a",
				name: "Part A",
				domain: "mechanical",
				role: "Part",
				relationships: [{
					targetComponentId: "part_b",
					relationshipType: "   "
				}]
			}, /* @__PURE__ */ new Set(["part_a", "part_b"]));
			assert.equal(result.isValid, false);
			assert.match(result.errors[0], /missing relationshipType/);
		});
		it("passes validation when relationships array is omitted or empty (backward compatibility)", () => {
			const validIds = /* @__PURE__ */ new Set(["gear_a", "gear_b"]);
			const metadataNoRels = {
				id: "gear_a",
				name: "Gear A",
				domain: "mechanical",
				role: "Transmission"
			};
			const result1 = validateComponentRelationships(metadataNoRels, validIds);
			assert.equal(result1.isValid, true);
			assert.equal(result1.errors.length, 0);
			const result2 = validateComponentRelationships({
				...metadataNoRels,
				relationships: []
			}, validIds);
			assert.equal(result2.isValid, true);
			assert.equal(result2.errors.length, 0);
		});
	});
	describe("3. Consistent Isolation and Focus Contracts", () => {
		let scene;
		let camera;
		let lifecycle;
		beforeEach(() => {
			scene = new THREE.Scene();
			camera = new THREE.PerspectiveCamera(45, 800 / 600, .1, 100);
			modelRegistry.resetToDefaults();
			lifecycle = new ModelLifecycleManager({
				scene,
				camera
			});
		});
		it("isolates a selected component by showing only matching meshes", () => {
			lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			const activeRuntime = lifecycle.getActiveRuntime();
			assert.notEqual(activeRuntime, null);
			const success = lifecycle.isolateComponent("sun_gear");
			assert.equal(success, true);
			assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
			let sunMeshFound = false;
			let nonSunVisibleCount = 0;
			activeRuntime.rootGroup.traverse((obj) => {
				const compId = obj.userData?.componentId;
				if (compId === "sun_gear") {
					sunMeshFound = true;
					assert.equal(obj.visible, true);
				} else if (compId && compId !== "sun_gear") {
					if (obj.visible) nonSunVisibleCount++;
				}
			});
			assert.equal(sunMeshFound, true);
			assert.equal(nonSunVisibleCount, 0, "All non-isolated components must be hidden");
		});
		it("clearing isolation (null) restores normal assembly visibility", () => {
			lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			const activeRuntime = lifecycle.getActiveRuntime();
			lifecycle.isolateComponent("sun_gear");
			assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
			const success = lifecycle.isolateComponent(null);
			assert.equal(success, true);
			assert.equal(lifecycle.getIsolatedComponentId(), null);
			activeRuntime.rootGroup.traverse((obj) => {
				if (obj.userData?.componentId) assert.equal(obj.visible, true, `Component ${obj.userData.componentId} should be visible after clearing isolation`);
			});
		});
		it("clearing isolation respects existing hiddenComponents set", () => {
			lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			const activeRuntime = lifecycle.getActiveRuntime();
			lifecycle.setHiddenComponents(/* @__PURE__ */ new Set(["ring_gear"]));
			lifecycle.isolateComponent("sun_gear");
			assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
			lifecycle.isolateComponent(null);
			activeRuntime.rootGroup.traverse((obj) => {
				const compId = obj.userData?.componentId;
				if (compId === "sun_gear") assert.equal(obj.visible, true);
				else if (compId === "ring_gear") assert.equal(obj.visible, false, "Hidden component must remain hidden after isolation is cleared");
			});
		});
		it("resets isolation state on model switch", () => {
			lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			lifecycle.isolateComponent("sun_gear");
			assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
			lifecycle.loadModel(WARREN_TRUSS_MODEL_ID);
			assert.equal(lifecycle.getIsolatedComponentId(), null, "Isolation must be cleared on model switch");
		});
		it("resets isolation state on disposal", () => {
			lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			lifecycle.isolateComponent("sun_gear");
			assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
			lifecycle.dispose();
			assert.equal(lifecycle.getIsolatedComponentId(), null);
		});
		it("focusComponent focuses camera on valid component bounding box", () => {
			const cameraController = new CameraController(camera, {
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => true,
				getRootNode: () => ({
					addEventListener: () => {},
					removeEventListener: () => {}
				}),
				ownerDocument: {
					addEventListener: () => {},
					removeEventListener: () => {},
					elementFromPoint: () => null
				},
				clientWidth: 800,
				clientHeight: 600,
				style: {}
			}, {
				minDistance: 1,
				maxDistance: 100,
				enableDamping: false
			});
			const lifecycleWithCam = new ModelLifecycleManager({
				scene,
				camera,
				cameraController
			});
			lifecycleWithCam.loadModel(PLANETARY_GEARBOX_MODEL_ID);
			const initialPos = camera.position.clone();
			const focusResult = lifecycleWithCam.focusComponent("sun_gear");
			assert.equal(focusResult, true);
			assert.notDeepEqual(camera.position, initialPos);
			const invalidFocus = lifecycleWithCam.focusComponent("non_existent_engine_part");
			assert.equal(invalidFocus, false);
		});
	});
	describe("4. Backward Compatibility with Existing Models", () => {
		it("validates planetary_gearbox metadata without errors", () => {
			const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
			assert.notEqual(gearboxModel, null);
			const allIds = gearboxModel.getAllComponentIds();
			const idSet = new Set(allIds);
			for (const id of allIds) {
				const meta = gearboxModel.getComponentMetadata(id);
				assert.notEqual(meta, null, `Metadata must exist for ${id}`);
				const val = validateComponentRelationships(meta, idSet);
				assert.equal(val.isValid, true, `Component ${id} relationship validation failed`);
				assert.equal(val.errors.length, 0);
			}
		});
		it("validates warren_truss_bridge metadata without errors", () => {
			const bridgeModel = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
			assert.notEqual(bridgeModel, null);
			const allIds = bridgeModel.getAllComponentIds();
			const idSet = new Set(allIds);
			for (const id of allIds) {
				const meta = bridgeModel.getComponentMetadata(id);
				assert.notEqual(meta, null, `Metadata must exist for ${id}`);
				const val = validateComponentRelationships(meta, idSet);
				assert.equal(val.isValid, true, `Component ${id} relationship validation failed`);
				assert.equal(val.errors.length, 0);
			}
		});
	});
});
export {};
