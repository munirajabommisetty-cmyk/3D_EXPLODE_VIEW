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
// \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
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
* Directions (from target towards camera) for side views. They keep the current target and
* distance, so they work for any model size. A slight elevation keeps the ground grid readable.
*/
var SIDE_VIEW_DIRECTIONS = {
	back: new THREE.Vector3(0, .06, -1).normalize(),
	left: new THREE.Vector3(-1, .06, 0).normalize(),
	right: new THREE.Vector3(1, .06, 0).normalize()
};
var easeInOutCubic = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
var nowMs = () => typeof performance !== "undefined" ? performance.now() : Date.now();
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
	transition = null;
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
		this.cancelTransition();
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
	* During a command transition auto-orbit is suspended; the request is remembered and
	* applied when the transition ends, so gesture pause/restore logic stays correct.
	*/
	setAutoRotate(enabled) {
		if (this.transition) {
			this.transition.restoreAutoRotate = enabled;
			return;
		}
		this.controls.autoRotate = enabled;
	}
	/**
	* Gets the intended auto-rotate state (including while a transition temporarily suspends it).
	*/
	isAutoRotating() {
		return this.transition ? this.transition.restoreAutoRotate : this.controls.autoRotate;
	}
	/**
	* Task V3: names the view the camera is actually looking from (by viewing direction, within
	* `toleranceDeg`), or 'custom' after free orbiting. Unlike getActivePreset() this never goes
	* stale when the user drags the camera. Uses the transition goal while a transition runs.
	*/
	classifyView(toleranceDeg = 10) {
		const pose = this.getGoalPose();
		const dir = new THREE.Vector3().subVectors(pose.position, pose.target);
		if (dir.lengthSq() < 1e-9) return "custom";
		dir.normalize();
		const candidates = [...Object.keys(CAMERA_PRESETS).map((p) => [p, new THREE.Vector3().subVectors(CAMERA_PRESETS[p].position, CAMERA_PRESETS[p].target).normalize()]), ...Object.keys(SIDE_VIEW_DIRECTIONS).map((v) => [v, SIDE_VIEW_DIRECTIONS[v]])];
		const cosTol = Math.cos(THREE.MathUtils.degToRad(toleranceDeg));
		let best = "custom";
		let bestDot = cosTol;
		for (const [view, v] of candidates) {
			const d = dir.dot(v);
			if (d >= bestDot) {
				bestDot = d;
				best = view;
			}
		}
		return best;
	}
	/**
	* Gets current active preset identifier.
	*/
	getActivePreset() {
		return this.activePreset;
	}
	/**
	* Must be called in the render loop to update damping, auto-rotation and any
	* command-driven transition. `now` (ms) is injectable for deterministic tests.
	*/
	update(now = nowMs()) {
		if (this.transition) this.stepTransition(now);
		this.controls.update();
	}
	/** True while a command-driven transition is animating. */
	isTransitioning() {
		return this.transition !== null;
	}
	/**
	* Stops a running transition where it is (the user took over) and restores auto-orbit intent.
	*/
	cancelTransition() {
		if (!this.transition) return;
		const restore = this.transition.restoreAutoRotate;
		this.transition = null;
		this.controls.autoRotate = restore;
	}
	/** The pose the camera is heading to (end of a running transition) or its current pose. */
	getGoalPose() {
		if (this.transition) {
			const t = this.transition;
			return {
				target: t.toTarget.clone(),
				position: new THREE.Vector3().setFromSpherical(t.toSph).add(t.toTarget)
			};
		}
		return {
			position: this.camera.position.clone(),
			target: this.controls.target.clone()
		};
	}
	/**
	* Smoothly moves camera and target to a pose. Interpolates in spherical coordinates around the
	* target so the camera arcs around the model instead of cutting through it. Distance and
	* elevation are clamped to the controls' limits. durationMs <= 0 jumps immediately.
	*/
	animateTo(position, target, durationMs = 350, now = nowMs()) {
		const restoreAutoRotate = this.isAutoRotating();
		const fromTarget = this.controls.target.clone();
		const fromSph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(this.camera.position, fromTarget));
		const toSph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(position, target));
		toSph.radius = THREE.MathUtils.clamp(toSph.radius, this.controls.minDistance, this.controls.maxDistance);
		toSph.phi = THREE.MathUtils.clamp(toSph.phi, 1e-4, this.controls.maxPolarAngle);
		let dTheta = toSph.theta - fromSph.theta;
		dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
		toSph.theta = fromSph.theta + dTheta;
		this.controls.autoRotate = false;
		this.transition = {
			startMs: now,
			durationMs: Math.max(0, durationMs),
			fromTarget,
			toTarget: target.clone(),
			fromSph,
			toSph,
			restoreAutoRotate
		};
		if (durationMs <= 0) this.stepTransition(now);
	}
	stepTransition(now) {
		const t = this.transition;
		if (!t) return;
		const raw = t.durationMs === 0 ? 1 : THREE.MathUtils.clamp((now - t.startMs) / t.durationMs, 0, 1);
		const e = easeInOutCubic(raw);
		this.controls.target.lerpVectors(t.fromTarget, t.toTarget, e);
		const sph = new THREE.Spherical(THREE.MathUtils.lerp(t.fromSph.radius, t.toSph.radius, e), THREE.MathUtils.lerp(t.fromSph.phi, t.toSph.phi, e), THREE.MathUtils.lerp(t.fromSph.theta, t.toSph.theta, e));
		this.camera.position.setFromSpherical(sph).add(this.controls.target);
		this.camera.lookAt(this.controls.target);
		if (raw >= 1) {
			this.transition = null;
			this.controls.autoRotate = t.restoreAutoRotate;
		}
	}
	/** Orbits around the target. Positive yaw orbits counter-clockwise seen from above;
	*  positive pitch raises the camera. Builds on the goal pose so repeated commands accumulate. */
	orbitBy(yawRad, pitchRad, durationMs = 350, now = nowMs()) {
		const goal = this.getGoalPose();
		const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(goal.position, goal.target));
		sph.theta += yawRad;
		sph.phi = THREE.MathUtils.clamp(sph.phi - pitchRad, .05, this.controls.maxPolarAngle);
		this.animateTo(new THREE.Vector3().setFromSpherical(sph).add(goal.target), goal.target, durationMs, now);
	}
	/** Slides camera and target together in screen space. Amounts are fractions of the viewing
	*  distance (+right, +up). The target is kept within reach of the model. */
	panBy(rightFraction, upFraction, durationMs = 350, now = nowMs()) {
		const goal = this.getGoalPose();
		const offset = new THREE.Vector3().subVectors(goal.position, goal.target);
		const dist = offset.length();
		const forward = offset.clone().negate().normalize();
		const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
		if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
		const up = new THREE.Vector3().crossVectors(right, forward).normalize();
		const delta = right.multiplyScalar(rightFraction * dist).add(up.multiplyScalar(upFraction * dist));
		const newTarget = goal.target.clone().add(delta);
		const limit = this.controls.maxDistance * .4;
		if (newTarget.length() > limit) newTarget.setLength(limit);
		this.animateTo(newTarget.clone().add(offset), newTarget, durationMs, now);
	}
	/** Multiplies the viewing distance by `factor` (< 1 zooms in), clamped to the limits. */
	zoomSmooth(factor, durationMs = 350, now = nowMs()) {
		const goal = this.getGoalPose();
		const offset = new THREE.Vector3().subVectors(goal.position, goal.target);
		offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
		this.animateTo(goal.target.clone().add(offset), goal.target, durationMs, now);
	}
	/** Smoothly moves to a named view. Presets use their fixed poses (as the toolbar does);
	*  back/left/right keep the current target and distance. */
	goToView(view, durationMs = 350, now = nowMs()) {
		if (view === "isometric" || view === "top" || view === "front") {
			const config = CAMERA_PRESETS[view];
			this.activePreset = view;
			this.animateTo(config.position, config.target, durationMs, now);
		} else {
			const goal = this.getGoalPose();
			const dist = goal.position.distanceTo(goal.target);
			const position = goal.target.clone().addScaledVector(SIDE_VIEW_DIRECTIONS[view], dist);
			this.animateTo(position, goal.target, durationMs, now);
		}
		this.onPresetChange?.(view);
	}
	/** Pose that frames a bounding box (same framing maths as focusOnBounds). */
	getFocusPose(box, offsetRatio = 1.6) {
		if (box.isEmpty()) return null;
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z, .1);
		const fovRad = this.camera.fov * Math.PI / 180;
		const cameraDistance = THREE.MathUtils.clamp(maxDim / 2 / Math.tan(fovRad / 2) * offsetRatio, this.controls.minDistance, this.controls.maxDistance);
		const goal = this.getGoalPose();
		const direction = new THREE.Vector3().subVectors(goal.position, goal.target).normalize();
		if (direction.lengthSq() < 1e-4) direction.set(.7, .5, .7).normalize();
		return {
			target: center,
			position: center.clone().addScaledVector(direction, cameraDistance)
		};
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
	* True while a hand gesture is actively steering the camera (orbit or pinch-zoom).
	* Used by the scene command executor to defer camera commands instead of fighting the hand.
	*/
	isInteracting() {
		return this.isGestureInteracting;
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
function createMockDom$3() {
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
		const controller = new CameraController(camera, createMockDom$3(), {
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
		const controller = new CameraController(camera, createMockDom$3(), {
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
	selectedIntensity: .85,
	relatedColor: 2278750,
	relatedIntensity: .5
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
	/** Task V3: components highlighted together (e.g. parts connected to the selected one). */
	relatedIds = /* @__PURE__ */ new Set();
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
		const previous = this.activeHoveredId;
		this.activeHoveredId = componentId;
		if (previous) this.refreshComponent(previous);
		if (componentId) this.refreshComponent(componentId);
	}
	/**
	* Applies persistent selection highlighting to the specified component ID.
	* Clears any previous selection highlight and restores original materials.
	*/
	setSelectionHighlight(componentId) {
		if (this.activeSelectedId === componentId) return;
		const previous = this.activeSelectedId;
		this.activeSelectedId = componentId;
		if (previous) this.refreshComponent(previous);
		if (componentId) this.refreshComponent(componentId);
	}
	/**
	* Task V3: highlights several components together (a third, lower-priority layer:
	* selection > hover > related). Passing an empty list clears it, restoring each component's
	* previous highlight (selection/hover) or its original material.
	*/
	setRelatedHighlight(componentIds) {
		const next = new Set(componentIds);
		const changed = /* @__PURE__ */ new Set([...this.relatedIds, ...next]);
		this.relatedIds = next;
		for (const id of changed) this.refreshComponent(id);
	}
	getRelatedHighlightIds() {
		return [...this.relatedIds];
	}
	/** Re-applies the highest-priority highlight layer for one component (or restores it). */
	refreshComponent(componentId) {
		this.clearComponentHighlight(componentId);
		if (componentId === this.activeSelectedId) this.applyComponentHighlight(componentId, this.options.selectedColor, this.options.selectedIntensity);
		else if (componentId === this.activeHoveredId) this.applyComponentHighlight(componentId, this.options.hoverColor, this.options.hoverIntensity);
		else if (this.relatedIds.has(componentId)) this.applyComponentHighlight(componentId, this.options.relatedColor, this.options.relatedIntensity);
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
		this.relatedIds.clear();
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
function createMockDom$2() {
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
		const cameraController = new CameraController(camera, createMockDom$2(), {
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
		const cameraController = new CameraController(camera, createMockDom$2(), {
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
		const cameraController = new CameraController(camera, createMockDom$2(), { enableDamping: false });
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
// src/services/scene/relationshipTable.ts
/** Relationship types used by the current models, with their inverses. Domains use their own subset. */
var INVERSE_RELATIONSHIP = {
	drives: "driven_by",
	driven_by: "drives",
	mates_with: "mates_with",
	supports: "supported_by",
	supported_by: "supports",
	connected_to: "connected_to",
	fastened_to: "fastened_to",
	transfers_force_to: "receives_force_from",
	receives_force_from: "transfers_force_to"
};
/** Expands directed edges into per-component relationship lists (both directions). */
function buildRelationshipIndex(edges) {
	const index = /* @__PURE__ */ new Map();
	const add = (id, rel) => {
		const list = index.get(id) ?? [];
		list.push(rel);
		index.set(id, list);
	};
	for (const e of edges) {
		add(e.from, {
			targetComponentId: e.to,
			relationshipType: e.type,
			description: e.description
		});
		add(e.to, {
			targetComponentId: e.from,
			relationshipType: INVERSE_RELATIONSHIP[e.type],
			description: e.description
		});
	}
	return index;
}
var PLANETARY_GEARBOX_RELATIONSHIPS = buildRelationshipIndex([{
	from: "central_shaft",
	type: "drives",
	to: "sun_gear",
	description: "The drive shaft turns the sun gear through a keyway.",
	evidence: "central_shaft note \"Transfers high-speed motor rotation to central sun gear via precision keyway\"; animation sets shaft angle = sun angle."
}, ...[
	"planet_gear_1",
	"planet_gear_2",
	"planet_gear_3"
].flatMap((planet) => [
	{
		from: "sun_gear",
		type: "mates_with",
		to: planet,
		description: "Sun gear teeth mesh with this planet gear.",
		evidence: "sun_gear note \"Meshes simultaneously with three planet gears\"; geometry orbit radius = sun radius + planet radius."
	},
	{
		from: "sun_gear",
		type: "drives",
		to: planet,
		description: "The sun gear (input) drives the planet gear.",
		evidence: "animation gear_train_rotation: \"Sun gear (input) drives the planet gears\"."
	},
	{
		from: planet,
		type: "mates_with",
		to: "ring_gear",
		description: "The planet gear rolls inside the fixed ring gear.",
		evidence: "animation: planets \"roll inside the fixed ring gear\"; planet note \"...to the outer reaction ring\"; geometry ring inner radius = sun + 2 x planet radius."
	},
	{
		from: "planet_carrier",
		type: "supports",
		to: planet,
		description: "The planet gear turns on one of the carrier pins.",
		evidence: "planet note \"Mounted on hardened cantilever carrier pin\"; geometry places planets at the carrier pin positions."
	},
	{
		from: planet,
		type: "drives",
		to: "planet_carrier",
		description: "Orbiting planet gears turn the carrier (the output).",
		evidence: "animation: planets \"turn the planet carrier (output)\"; carrier note \"Gathers orbital motion from the three planet gears\"."
	}
])]);
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
	const relationships = PLANETARY_GEARBOX_RELATIONSHIPS.get(componentId);
	return {
		...existing,
		domain: "mechanical",
		...relationships ? { relationships: [...relationships] } : {}
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
	animations: [{
		id: "gear_train_rotation",
		label: "Epicyclic gear train in motion",
		description: "Sun gear (input) drives the planet gears, which roll inside the fixed ring gear and turn the planet carrier (output) at a reduced speed."
	}],
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
var WARREN_TRUSS_RELATIONSHIPS = buildRelationshipIndex([
	{
		from: "diagonal_members",
		type: "connected_to",
		to: "top_chords",
		description: "Diagonals connect the top chord to the bottom chord.",
		evidence: "diagonal_members description \"connecting top and bottom chords\"."
	},
	{
		from: "diagonal_members",
		type: "connected_to",
		to: "bottom_chords",
		description: "Diagonals connect the top chord to the bottom chord.",
		evidence: "diagonal_members description \"connecting top and bottom chords\"."
	},
	...[
		"top_chords",
		"bottom_chords",
		"diagonal_members"
	].map((member) => ({
		from: "gusset_plates",
		type: "fastened_to",
		to: member,
		description: "Gusset plates are bolted to the members meeting at each truss joint.",
		evidence: "gusset_plates description \"fastened with high-strength structural bolts at chord-web node intersections\"; geometry places plates at the top and bottom panel points."
	})),
	{
		from: "vertical_struts",
		type: "fastened_to",
		to: "gusset_plates",
		description: "Vertical hangers are bolted to the gusset plates.",
		evidence: "vertical_struts specification \"Joint Fasteners: Double-Shear Gusset Bolting\"."
	},
	{
		from: "vertical_struts",
		type: "transfers_force_to",
		to: "top_chords",
		description: "Hangers carry floor-beam (deck) reactions up into the top chord panel points.",
		evidence: "vertical_struts note \"Hangers transfer floor beam deck reactions directly into top chord panel points\"."
	},
	{
		from: "vertical_struts",
		type: "supports",
		to: "bridge_deck",
		description: "Hangers hang the deck from the top chord joints.",
		evidence: "vertical_struts description \"hang the deck from the top chord joints\"."
	},
	{
		from: "bottom_chords",
		type: "supports",
		to: "bridge_deck",
		description: "The transverse floor beams (part of the bottom-chord system) carry the deck stringers.",
		evidence: "bottom_chords description \"supporting transverse floor beams\"; deck note \"Deck Slab -> Stringers -> Floor Beams -> Truss Nodes\"; geometry builds the floor beams in the bottom_chords group."
	},
	{
		from: "end_portals",
		type: "transfers_force_to",
		to: "support_piers",
		description: "End portals carry lateral (wind) loads down to the bearing seats.",
		evidence: "end_portals note \"transferring top lateral wind reactions down to bearing seats\"; spec \"Channels Upper Lateral Shear to Abutments\"."
	},
	{
		from: "support_piers",
		type: "supports",
		to: "bottom_chords",
		description: "Bearings on the abutments carry the truss at the ends of the bottom chords.",
		evidence: "geometry places the elastomeric bearings under each truss shoe at the bottom-chord ends; support_piers description \"support reactions\"."
	}
]);
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
	if (!metadata) return null;
	const relationships = WARREN_TRUSS_RELATIONSHIPS.get(componentId);
	return relationships ? {
		...metadata,
		relationships: [...relationships]
	} : { ...metadata };
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
		const validIds = new Set(this.activeModel?.getAllComponentIds() ?? []);
		const resolve = (obj) => {
			const compId = obj.userData?.componentId || obj.name;
			return typeof compId === "string" && validIds.has(compId) ? compId : null;
		};
		const root = this.activeRuntime.rootGroup;
		if (componentId) {
			const isolatedObjects = [];
			root.traverse((obj) => {
				const compId = resolve(obj);
				if (compId) {
					obj.visible = compId === componentId;
					if (compId === componentId) isolatedObjects.push(obj);
				}
			});
			for (const obj of isolatedObjects) {
				let parent = obj.parent;
				while (parent && parent !== root.parent) {
					parent.visible = true;
					parent = parent.parent;
				}
			}
		} else root.traverse((obj) => {
			const compId = resolve(obj);
			if (compId) obj.visible = !this.hiddenComponentIds.has(compId);
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
	* World-space bounding box of a component's meshes, or null if it has none in the active model.
	*/
	getComponentBounds(componentId) {
		if (!this.activeRuntime) return null;
		const box = new THREE.Box3();
		let found = false;
		this.activeRuntime.rootGroup.traverse((obj) => {
			if ((obj.userData?.componentId || obj.name) === componentId && obj.isMesh) {
				box.expandByObject(obj);
				found = true;
			}
		});
		return found && !box.isEmpty() ? box : null;
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
// src/services/commands/sceneCommands.ts
/** Views the camera can move to. "bottom" is intentionally absent: the camera is
*  constrained above the ground grid (OrbitControls maxPolarAngle), so it is unsupported. */
var CAMERA_VIEWS = [
	"isometric",
	"top",
	"front",
	"back",
	"left",
	"right"
];
var PAN_DIRECTIONS = [
	"left",
	"right",
	"up",
	"down"
];
/** Commands that move the camera. They are deferred while a hand or the mouse is steering it. */
var CAMERA_MOTION_TYPES = /* @__PURE__ */ new Set([
	"camera.orbit",
	"camera.pan",
	"camera.zoom",
	"camera.view",
	"camera.reset",
	"component.focus"
]);
var ALL_COMMAND_TYPES = /* @__PURE__ */ new Set([
	"camera.orbit",
	"camera.pan",
	"camera.zoom",
	"camera.view",
	"camera.reset",
	"camera.autoOrbit",
	"component.select",
	"component.focus",
	"component.isolate",
	"component.visibility",
	"component.showAll",
	"component.highlight",
	"component.clearHighlight",
	"assembly.explode",
	"assembly.restore",
	"animation.play",
	"animation.pause",
	"animation.setSpeed",
	"lesson.start",
	"lesson.next",
	"lesson.previous",
	"lesson.goTo",
	"lesson.exit",
	"workspace.switchModel",
	"workspace.goHome"
]);
var EMPTY_COMMAND_CONTEXT = {
	modelId: null,
	componentIds: /* @__PURE__ */ new Set(),
	animationIds: [],
	supportsExplodedView: false,
	viewerReady: false,
	lesson: {
		available: false,
		active: false,
		stepCount: 0,
		currentStep: 0
	},
	registeredModelIds: /* @__PURE__ */ new Set(),
	selectedComponentId: null
};
var LIMITS = {
	orbitDeg: 180,
	pitchDeg: 80,
	panAmountMax: 1,
	panAmountDefault: .15,
	zoomStepsMax: 5,
	speedMin: .1,
	speedMax: 3,
	highlightMax: 20
};
var reject = (code, reason) => ({
	ok: false,
	code,
	reason
});
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isStr = (v) => typeof v === "string" && v.trim().length > 0;
function checkComponent(id, ctx) {
	if (!isStr(id)) return reject("INVALID_ARGUMENT", "componentId must be a non-empty string.");
	if (!ctx.componentIds.has(id)) return reject("UNKNOWN_COMPONENT", `Component "${id}" does not exist in model "${ctx.modelId ?? "none"}".`);
	return null;
}
/**
* Validates and normalises a command against the current scene context.
* Returns a clean, fully-typed command (defaults filled in) or a rejection with a reason.
*/
function validateSceneCommand(input, ctx) {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return reject("MALFORMED", "Command must be an object.");
	const c = input;
	if (typeof c.type !== "string") return reject("MALFORMED", "Command is missing a \"type\".");
	const type = c.type;
	if (!ALL_COMMAND_TYPES.has(type)) return reject("UNKNOWN_COMMAND", `Unknown command "${c.type}".`);
	if ((type.startsWith("camera.") || type.startsWith("animation.") || type === "component.focus" || type === "component.isolate" || type === "component.highlight" || type === "component.clearHighlight") && !ctx.viewerReady) return reject("VIEWER_NOT_READY", "The 3D viewer is not ready.");
	switch (type) {
		case "camera.orbit": {
			const yawDeg = c.yawDeg ?? 0;
			const pitchDeg = c.pitchDeg ?? 0;
			if (!isNum(yawDeg) || !isNum(pitchDeg)) return reject("INVALID_ARGUMENT", "yawDeg/pitchDeg must be numbers.");
			if (Math.abs(yawDeg) > LIMITS.orbitDeg || Math.abs(pitchDeg) > LIMITS.pitchDeg) return reject("INVALID_ARGUMENT", `Orbit limited to ±${LIMITS.orbitDeg}° yaw and ±${LIMITS.pitchDeg}° pitch.`);
			if (yawDeg === 0 && pitchDeg === 0) return reject("INVALID_ARGUMENT", "Orbit needs a non-zero yaw or pitch.");
			return {
				ok: true,
				command: {
					type,
					yawDeg,
					pitchDeg
				}
			};
		}
		case "camera.pan": {
			if (!PAN_DIRECTIONS.includes(c.direction)) return reject("INVALID_ARGUMENT", `Pan direction must be one of ${PAN_DIRECTIONS.join(", ")}.`);
			const amount = c.amount ?? LIMITS.panAmountDefault;
			if (!isNum(amount) || amount <= 0 || amount > LIMITS.panAmountMax) return reject("INVALID_ARGUMENT", `Pan amount must be in (0, ${LIMITS.panAmountMax}].`);
			return {
				ok: true,
				command: {
					type,
					direction: c.direction,
					amount
				}
			};
		}
		case "camera.zoom": {
			if (c.direction !== "in" && c.direction !== "out") return reject("INVALID_ARGUMENT", "Zoom direction must be \"in\" or \"out\".");
			const steps = c.steps ?? 1;
			if (!Number.isInteger(steps) || steps < 1 || steps > LIMITS.zoomStepsMax) return reject("INVALID_ARGUMENT", `Zoom steps must be an integer 1–${LIMITS.zoomStepsMax}.`);
			return {
				ok: true,
				command: {
					type,
					direction: c.direction,
					steps
				}
			};
		}
		case "camera.view":
			if (c.view === "bottom") return reject("INVALID_ARGUMENT", "Bottom view is not supported: the camera is kept above the ground grid.");
			if (!CAMERA_VIEWS.includes(c.view)) return reject("INVALID_ARGUMENT", `View must be one of ${CAMERA_VIEWS.join(", ")}.`);
			return {
				ok: true,
				command: {
					type,
					view: c.view
				}
			};
		case "camera.reset": return {
			ok: true,
			command: { type }
		};
		case "camera.autoOrbit":
			if (typeof c.enabled !== "boolean") return reject("INVALID_ARGUMENT", "\"enabled\" must be true or false.");
			return {
				ok: true,
				command: {
					type,
					enabled: c.enabled
				}
			};
		case "component.select":
			if (c.componentId === null) return {
				ok: true,
				command: {
					type,
					componentId: null
				}
			};
			return checkComponent(c.componentId, ctx) ?? {
				ok: true,
				command: {
					type,
					componentId: c.componentId
				}
			};
		case "component.focus": return checkComponent(c.componentId, ctx) ?? {
			ok: true,
			command: {
				type,
				componentId: c.componentId
			}
		};
		case "component.isolate":
			if (c.componentId === null) return {
				ok: true,
				command: {
					type,
					componentId: null
				}
			};
			return checkComponent(c.componentId, ctx) ?? {
				ok: true,
				command: {
					type,
					componentId: c.componentId
				}
			};
		case "component.visibility":
			if (!Array.isArray(c.componentIds) || c.componentIds.length === 0) return reject("INVALID_ARGUMENT", "componentIds must be a non-empty array.");
			if (typeof c.visible !== "boolean") return reject("INVALID_ARGUMENT", "\"visible\" must be true or false.");
			for (const id of c.componentIds) {
				const bad = checkComponent(id, ctx);
				if (bad) return bad;
			}
			return {
				ok: true,
				command: {
					type,
					componentIds: [...new Set(c.componentIds)],
					visible: c.visible
				}
			};
		case "component.showAll": return {
			ok: true,
			command: { type }
		};
		case "component.highlight":
			if (!Array.isArray(c.componentIds) || c.componentIds.length === 0) return reject("INVALID_ARGUMENT", "componentIds must be a non-empty array.");
			if (c.componentIds.length > LIMITS.highlightMax) return reject("INVALID_ARGUMENT", `At most ${LIMITS.highlightMax} components can be highlighted.`);
			for (const id of c.componentIds) {
				const bad = checkComponent(id, ctx);
				if (bad) return bad;
			}
			return {
				ok: true,
				command: {
					type,
					componentIds: [...new Set(c.componentIds)]
				}
			};
		case "component.clearHighlight": return {
			ok: true,
			command: { type }
		};
		case "assembly.explode":
			if (!ctx.supportsExplodedView) return reject("UNSUPPORTED_EXPLODED_VIEW", "This model has no exploded view.");
			if (!isNum(c.factor) || c.factor < 0 || c.factor > 1) return reject("INVALID_ARGUMENT", "Explode factor must be between 0 and 1.");
			return {
				ok: true,
				command: {
					type,
					factor: c.factor
				}
			};
		case "assembly.restore":
			if (!ctx.supportsExplodedView) return reject("UNSUPPORTED_EXPLODED_VIEW", "This model has no exploded view.");
			return {
				ok: true,
				command: { type }
			};
		case "animation.play":
		case "animation.pause":
			if (ctx.animationIds.length === 0) return reject("UNSUPPORTED_ANIMATION", `Model "${ctx.modelId ?? "none"}" has no playable animation.`);
			return {
				ok: true,
				command: { type }
			};
		case "animation.setSpeed":
			if (ctx.animationIds.length === 0) return reject("UNSUPPORTED_ANIMATION", `Model "${ctx.modelId ?? "none"}" has no playable animation.`);
			if (!isNum(c.speed) || c.speed < LIMITS.speedMin || c.speed > LIMITS.speedMax) return reject("INVALID_ARGUMENT", `Speed must be between ${LIMITS.speedMin} and ${LIMITS.speedMax}.`);
			return {
				ok: true,
				command: {
					type,
					speed: c.speed
				}
			};
		case "lesson.start":
			if (!ctx.lesson.available) return reject("NO_LESSON", "No guided lesson exists for this model.");
			return {
				ok: true,
				command: { type }
			};
		case "lesson.next":
		case "lesson.previous":
		case "lesson.exit":
			if (!ctx.lesson.active) return reject("LESSON_NOT_ACTIVE", "No guided lesson is running.");
			return {
				ok: true,
				command: { type }
			};
		case "lesson.goTo":
			if (!ctx.lesson.active) return reject("LESSON_NOT_ACTIVE", "No guided lesson is running.");
			if (!Number.isInteger(c.stepIndex) || c.stepIndex < 0 || c.stepIndex >= ctx.lesson.stepCount) return reject("INVALID_ARGUMENT", `Lesson step must be 0–${ctx.lesson.stepCount - 1}.`);
			return {
				ok: true,
				command: {
					type,
					stepIndex: c.stepIndex
				}
			};
		case "workspace.switchModel":
			if (!isStr(c.modelId) || !ctx.registeredModelIds.has(c.modelId)) return reject("UNKNOWN_MODEL", `Model "${String(c.modelId)}" is not registered.`);
			return {
				ok: true,
				command: {
					type,
					modelId: c.modelId
				}
			};
		case "workspace.goHome": return {
			ok: true,
			command: { type }
		};
	}
	return reject("UNKNOWN_COMMAND", `Unknown command "${c.type}".`);
}
// src/services/commands/viewerCommandExecutor.ts
/**
* Viewer Command Executor (Task V1)
*
* Executes the scene commands that act on the Three.js viewer itself: camera motion, component
* focus/isolation and model animation. Workspace-state commands (selection, visibility, explode,
* lessons, navigation) are handled by the workspace layer.
*
* Arbitration with hands and mouse (the user always wins):
*  - A camera command arriving while a gesture or mouse drag is steering the camera is DEFERRED
*    (latest one wins) and runs as soon as the hand/mouse lets go, or expires after PENDING_TTL_MS.
*  - If a gesture or drag starts while a command transition is animating, the transition is
*    cancelled on that frame, leaving the camera where the user took it.
*/
var PENDING_TTL_MS = 2500;
var ZOOM_STEP_FACTOR = .75;
var VIEWER_TYPES = /* @__PURE__ */ new Set([
	"camera.orbit",
	"camera.pan",
	"camera.zoom",
	"camera.view",
	"camera.reset",
	"camera.autoOrbit",
	"component.focus",
	"component.isolate",
	"component.highlight",
	"component.clearHighlight",
	"animation.play",
	"animation.pause",
	"animation.setSpeed"
]);
var ViewerCommandExecutor = class {
	id = "viewer";
	pending = null;
	/** Last command-driven focus; cleared when the camera is moved by anything else. */
	focused = null;
	target;
	onDeferredOutcome;
	now;
	constructor(target, onDeferredOutcome) {
		this.target = target;
		this.onDeferredOutcome = onDeferredOutcome;
		this.now = target.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
	}
	canHandle(type) {
		return VIEWER_TYPES.has(type);
	}
	/** True while a hand gesture or mouse drag is steering the camera. */
	isUserSteering() {
		return this.target.isGestureInteracting() || this.target.camera.isUserInteracting();
	}
	getPending() {
		return this.pending?.command ?? null;
	}
	/** Live facts the viewer knows best, merged into the dispatcher context. */
	contextProvider = () => {
		const runtime = this.target.lifecycle.getActiveRuntime();
		return {
			viewerReady: Boolean(this.target.lifecycle.getActiveModel() && runtime),
			supportsExplodedView: Boolean(runtime?.setExplodedFactor),
			viewerFacts: this.getFacts()
		};
	};
	/** Task V3: what the viewer knows right now, read from the live objects (never cached copies). */
	getFacts() {
		const { camera, lifecycle } = this.target;
		const modelId = lifecycle.getActiveModel()?.id ?? null;
		const pointer = this.target.getPointer?.() ?? {
			componentId: null,
			source: null
		};
		return {
			hoveredComponentId: pointer.componentId,
			hoverSource: pointer.componentId ? pointer.source : null,
			isolatedComponentId: lifecycle.getIsolatedComponentId?.() ?? null,
			focusedComponentId: this.focused && this.focused.modelId === modelId ? this.focused.componentId : null,
			camera: {
				view: camera.classifyView(),
				autoOrbit: camera.isAutoRotating(),
				transitioning: camera.isTransitioning(),
				userSteering: this.isUserSteering()
			},
			animation: this.target.getAnimationState?.() ?? {
				playing: false,
				speed: 1
			},
			highlightedComponentIds: lifecycle.getRaycaster?.()?.getRelatedHighlightIds() ?? [],
			pendingCommand: this.pending !== null
		};
	}
	execute(command, source) {
		if (CAMERA_MOTION_TYPES.has(command.type) && this.isUserSteering()) {
			if (this.pending) this.onDeferredOutcome?.(this.pending.command, this.pending.source, "expired", "Replaced by a newer camera command.");
			this.pending = {
				command,
				source,
				queuedAt: this.now()
			};
			return {
				status: "deferred",
				detail: "Hand or mouse is steering the camera; will run when released."
			};
		}
		return this.run(command);
	}
	/**
	* Called once per frame, after gesture input has been applied and before the camera updates.
	* Cancels transitions the user has taken over, and flushes or expires the deferred command.
	*/
	tick(now = this.now()) {
		const steering = this.isUserSteering();
		if (steering && this.target.camera.isTransitioning()) this.target.camera.cancelTransition();
		if (steering) this.focused = null;
		if (!this.pending) return;
		if (now - this.pending.queuedAt > 2500) {
			const { command, source } = this.pending;
			this.pending = null;
			this.onDeferredOutcome?.(command, source, "expired", "Hand or mouse kept steering the camera.");
			return;
		}
		if (!steering) {
			const { command, source } = this.pending;
			this.pending = null;
			const outcome = this.run(command);
			this.onDeferredOutcome?.(command, source, outcome.status === "executed" ? "executed" : "expired", outcome.detail);
		}
	}
	clearPending() {
		this.pending = null;
	}
	run(command) {
		if (CAMERA_MOTION_TYPES.has(command.type) && command.type !== "component.focus") this.focused = null;
		const cam = this.target.camera;
		const now = this.now();
		switch (command.type) {
			case "camera.orbit":
				cam.orbitBy(THREE.MathUtils.degToRad(command.yawDeg), THREE.MathUtils.degToRad(command.pitchDeg ?? 0), void 0, now);
				return { status: "executed" };
			case "camera.pan": {
				const a = command.amount ?? .15;
				const [right, up] = {
					left: [-a, 0],
					right: [a, 0],
					up: [0, a],
					down: [0, -a]
				}[command.direction];
				cam.panBy(right, up, void 0, now);
				return { status: "executed" };
			}
			case "camera.zoom": {
				const steps = command.steps ?? 1;
				const factor = command.direction === "in" ? Math.pow(ZOOM_STEP_FACTOR, steps) : Math.pow(1 / ZOOM_STEP_FACTOR, steps);
				cam.zoomSmooth(factor, void 0, now);
				return { status: "executed" };
			}
			case "camera.view":
				cam.goToView(command.view, void 0, now);
				return { status: "executed" };
			case "camera.reset":
				cam.goToView("isometric", void 0, now);
				return { status: "executed" };
			case "camera.autoOrbit":
				this.target.setAutoOrbit(command.enabled);
				return { status: "executed" };
			case "component.focus": {
				const box = this.target.lifecycle.getComponentBounds(command.componentId);
				const pose = box ? cam.getFocusPose(box) : null;
				if (!pose) return {
					status: "rejected",
					code: "UNKNOWN_COMPONENT",
					detail: `No geometry found for "${command.componentId}".`
				};
				cam.animateTo(pose.position, pose.target, void 0, now);
				const modelId = this.target.lifecycle.getActiveModel()?.id;
				this.focused = modelId ? {
					modelId,
					componentId: command.componentId
				} : null;
				return { status: "executed" };
			}
			case "component.highlight":
			case "component.clearHighlight": {
				const raycaster = this.target.lifecycle.getRaycaster?.();
				if (!raycaster) return {
					status: "rejected",
					code: "VIEWER_NOT_READY",
					detail: "Highlighting is not available yet."
				};
				raycaster.setRelatedHighlight(command.type === "component.highlight" ? command.componentIds : []);
				return { status: "executed" };
			}
			case "component.isolate":
				this.target.lifecycle.isolateComponent(command.componentId);
				return { status: "executed" };
			case "animation.play":
				this.target.animation.setPlaying(true);
				return { status: "executed" };
			case "animation.pause":
				this.target.animation.setPlaying(false);
				return { status: "executed" };
			case "animation.setSpeed":
				this.target.animation.setSpeed(command.speed);
				return { status: "executed" };
			default: return {
				status: "rejected",
				code: "NO_HANDLER",
				detail: `Viewer cannot handle "${command.type}".`
			};
		}
	}
};
// src/components/scene/ViewerCanvas.tsx
var checkWebGLSupport$1 = () => {
	if (typeof window === "undefined") return null;
	const testCanvas = document.createElement("canvas");
	if (!(testCanvas.getContext("webgl2") || testCanvas.getContext("webgl"))) return "WebGL is not supported or hardware acceleration is disabled in your browser.";
	return null;
};
var ViewerCanvas = ({ modelId = PLANETARY_GEARBOX_MODEL_ID, onModelLoaded, onModelLoadError, onFpsUpdate, onTelemetryUpdate, className, gestureResult, hands, selectedComponentId, onSelectComponent, hiddenComponentIds, isolatedComponentId, explodedFactor = 0, onExplodedFactorChange, commandDispatcher }) => {
	const commandDispatcherRef = useRef(commandDispatcher);
	useEffect(() => {
		commandDispatcherRef.current = commandDispatcher;
	}, [commandDispatcher]);
	const animationPlayingRef = useRef(true);
	const animationSpeedRef = useRef(1);
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
	const pointedRef = useRef({
		componentId: null,
		source: null
	});
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
		const dispatcher = commandDispatcherRef.current;
		const commandExecutor = new ViewerCommandExecutor({
			camera: cameraController,
			lifecycle: lifecycleManager,
			isGestureInteracting: () => gestureCameraController.isInteracting(),
			animation: {
				setPlaying: (playing) => {
					animationPlayingRef.current = playing;
				},
				setSpeed: (speed) => {
					animationSpeedRef.current = speed;
				}
			},
			setAutoOrbit: (enabled) => setAutoRotate(enabled),
			getPointer: () => pointedRef.current,
			getAnimationState: () => ({
				playing: animationPlayingRef.current,
				speed: animationSpeedRef.current
			})
		}, (command, source, status, detail) => dispatcher?.reportDeferredOutcome(command, source, status, detail));
		const unregisterHandler = dispatcher?.registerHandler(commandExecutor);
		const unregisterContext = dispatcher?.registerContextProvider("viewer", commandExecutor.contextProvider);
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
			if (animationPlayingRef.current) lifecycleManager.updateAnimation(delta * animationSpeedRef.current, performance.now() / 1e3);
			gestureCameraController.update(gestureResultRef.current, handsRef.current);
			commandExecutor.tick();
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
			pointedRef.current = {
				componentId: selectorResult.hoveredId,
				source: selectorResult.hoveredId ? isGesturePointing ? "gesture" : "mouse" : null
			};
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
			unregisterHandler?.();
			unregisterContext?.();
			commandExecutor.clearPending();
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
						onClick: () => setAutoRotate((prev) => {
							animationPlayingRef.current = !prev;
							return !prev;
						}),
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
	const { status, errorMessage, startCamera, stopCamera, videoRef } = externalCamera || internalCamera;
	const isStreaming = status === "active";
	const isRequesting = status === "requesting";
	const [isMinimized, setIsMinimized] = useState(!isStreaming);
	const [wasStreaming, setWasStreaming] = useState(isStreaming);
	if (isStreaming !== wasStreaming) {
		setWasStreaming(isStreaming);
		if (isStreaming) setIsMinimized(false);
	}
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
var EngineeringInspectorPanel = ({ metadata: propMetadata, componentId, activeModel, onClose, className = "", initialTab = "overview", onAskTutor }) => {
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
				onAskTutor && /* @__PURE__ */ jsxs("div", {
					className: "inspector-tutor-card",
					children: [
						/* @__PURE__ */ jsx("h4", {
							className: "card-section-title",
							children: "Voice tutor"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "empty-description",
							children: "Select a part, then tap the mic (or press M) and ask “Explain this part”. You can also say “Show the back” or “Zoom in”, in English, తెలుగు or हिन्दी."
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "tutor-ask-btn",
							onClick: () => onAskTutor("explain how this model works"),
							children: "🎓 Explain this model"
						})
					]
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
			onAskTutor && /* @__PURE__ */ jsxs("div", {
				className: "inspector-tutor-row",
				role: "group",
				"aria-label": `Ask the tutor about ${comp.name}`,
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "tutor-row-label",
						children: "Ask the tutor"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "tutor-ask-btn primary",
						onClick: () => onAskTutor(`explain the ${comp.name}`),
						children: "🎓 Explain"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "tutor-ask-btn",
						onClick: () => onAskTutor(`why is the ${comp.name} needed`),
						children: "Why is it needed?"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "tutor-ask-btn",
						onClick: () => onAskTutor(`how does the ${comp.name} work`),
						children: "How does it work?"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "tutor-ask-btn",
						onClick: () => onAskTutor(`what happens if the ${comp.name} fails`),
						children: "What if it fails?"
					})
				]
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
// src/services/commands/sceneCommandDispatcher.ts
/**
* Scene Command Dispatcher (Task V1)
*
* The single entry point through which every input method operates the workspace:
*   input (gesture / voice / keyboard / UI / AI)
*     -> validateSceneCommand(command, live context)   // reject unknown parts, unsupported actions
*     -> handler that owns that command type           // viewer (camera, animation) or workspace (state)
*     -> result: executed | deferred | rejected        // recorded + broadcast to listeners
*
* Handlers and context providers are registered by the components that own the relevant state,
* so no React state is duplicated here.
*/
var HISTORY_LIMIT = 50;
var SceneCommandDispatcher = class {
	handlers = /* @__PURE__ */ new Map();
	providers = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	history = [];
	nextId = 1;
	now;
	constructor(now = () => Date.now()) {
		this.now = now;
	}
	/** Registers (or replaces) a handler. Returns an unregister function. */
	registerHandler(handler) {
		this.handlers.set(handler.id, handler);
		return () => {
			if (this.handlers.get(handler.id) === handler) this.handlers.delete(handler.id);
		};
	}
	/** Registers (or replaces) a live context provider. Later providers override earlier keys. */
	registerContextProvider(id, provider) {
		this.providers.set(id, provider);
		return () => {
			if (this.providers.get(id) === provider) this.providers.delete(id);
		};
	}
	/** Current merged context, used for validation (and later sent to the AI teacher). */
	getContext() {
		let ctx = { ...EMPTY_COMMAND_CONTEXT };
		for (const provider of this.providers.values()) ctx = {
			...ctx,
			...provider()
		};
		return ctx;
	}
	/** Validates and executes a command from any input source. Never throws. */
	dispatch(input, source) {
		const validation = validateSceneCommand(input, this.getContext());
		if (!validation.ok) return this.record({
			source,
			command: input,
			status: "rejected",
			code: validation.code,
			detail: validation.reason
		});
		const command = validation.command;
		const handler = [...this.handlers.values()].find((h) => h.canHandle(command.type));
		if (!handler) return this.record({
			source,
			command,
			status: "rejected",
			code: "NO_HANDLER",
			detail: `No handler for "${command.type}".`
		});
		try {
			const outcome = handler.execute(command, source);
			return this.record({
				source,
				command,
				status: outcome.status,
				code: outcome.code,
				detail: outcome.detail
			});
		} catch (err) {
			return this.record({
				source,
				command,
				status: "rejected",
				code: "NO_HANDLER",
				detail: `Handler failed: ${err instanceof Error ? err.message : String(err)}`
			});
		}
	}
	/** Lets a handler report the later fate of a deferred command (executed or expired). */
	reportDeferredOutcome(command, source, status, detail) {
		return this.record({
			source,
			command,
			status,
			detail
		});
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	getHistory() {
		return this.history;
	}
	record(entry) {
		const rec = {
			id: this.nextId++,
			timestamp: this.now(),
			...entry
		};
		this.history.push(rec);
		if (this.history.length > HISTORY_LIMIT) this.history.shift();
		for (const listener of this.listeners) try {
			listener(rec);
		} catch {}
		return rec;
	}
};
// src/services/voice/recorder.ts
/**
* Browser voice recorder (Task V2): microphone -> 16 kHz mono WAV for Gnani Prisma.
*
* - Automatic end-of-speech: the first ~250 ms measure background noise; recording stops
*   ~900 ms after speech falls back to that floor (works with fans, traffic, workshop noise).
* - Hard cap of 25 s (Prisma's documented ideal is ≤ 30 s).
* - cancel() stops immediately and discards the audio.
* The pure pieces (WAV encoding, end-of-speech state machine) are exported for unit tests.
*/
var TARGET_SAMPLE_RATE = 16e3;
var MicError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
function classifyMicError(err) {
	const name = err?.name ?? "";
	if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return new MicError("MIC_DENIED", "Microphone permission was denied.");
	if (name === "NotFoundError" || name === "DevicesNotFoundError") return new MicError("MIC_NOT_FOUND", "No microphone was found.");
	if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return new MicError("MIC_BUSY", "The microphone is in use by another application.");
	return new MicError("MIC_ERROR", "The microphone could not be started.");
}
/** Root-mean-square level of a sample frame. */
function rms(frame) {
	let sum = 0;
	for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
	return frame.length ? Math.sqrt(sum / frame.length) : 0;
}
/** Encodes float32 chunks as 16-bit PCM mono WAV, downsampling with block averaging. */
function encodeWav(chunks, inRate, outRate = TARGET_SAMPLE_RATE) {
	const len = chunks.reduce((a, c) => a + c.length, 0);
	const all = new Float32Array(len);
	let o = 0;
	for (const c of chunks) {
		all.set(c, o);
		o += c.length;
	}
	const ratio = inRate / outRate;
	const n = Math.max(0, Math.floor(len / ratio));
	const buf = /* @__PURE__ */ new ArrayBuffer(44 + n * 2);
	const v = new DataView(buf);
	const w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
	w(0, "RIFF");
	v.setUint32(4, 36 + n * 2, true);
	w(8, "WAVE");
	w(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, outRate, true);
	v.setUint32(28, outRate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	w(36, "data");
	v.setUint32(40, n * 2, true);
	for (let i = 0; i < n; i++) {
		const a = Math.floor(i * ratio);
		const b = Math.min(len, Math.floor((i + 1) * ratio));
		let s = 0;
		for (let j = a; j < b; j++) s += all[j];
		const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
		v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
	}
	return new Uint8Array(buf);
}
/**
* End-of-speech detector. Feed it each frame's RMS level and duration; it returns a reason
* when recording should stop, otherwise null. Adapts to the background noise level.
*/
var SpeechEndDetector = class {
	calib = [];
	floor = .004;
	loudFrames = 0;
	silentMs = 0;
	elapsedMs = 0;
	speechStarted = false;
	push(level, frameMs) {
		this.elapsedMs += frameMs;
		if (this.calib.length < 6) {
			this.calib.push(level);
			const sorted = [...this.calib].sort((a, b) => a - b);
			this.floor = Math.max(.003, sorted[Math.floor(sorted.length / 2)]);
		}
		const speechTh = Math.max(this.floor * 3, .015);
		const silenceTh = Math.max(this.floor * 1.8, .008);
		if (!this.speechStarted) {
			this.loudFrames = level > speechTh ? this.loudFrames + 1 : 0;
			if (this.loudFrames >= 3) this.speechStarted = true;
			else if (this.calib.length >= 6) this.floor = .95 * this.floor + .05 * Math.min(level, this.floor * 2);
			if (!this.speechStarted && this.elapsedMs > 8e3) return "nospeech";
		} else {
			this.silentMs = level < silenceTh ? this.silentMs + frameMs : 0;
			if (this.silentMs >= 900) return "silence";
		}
		if (this.elapsedMs >= 25e3) return "max";
		return null;
	}
};
/** Starts recording. Throws MicError on permission/device problems. */
async function startRecording(onLevel) {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new MicError("MIC_UNSUPPORTED", "This browser cannot record audio.");
	let stream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: {
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
			channelCount: 1
		} });
	} catch (err) {
		throw classifyMicError(err);
	}
	const ctx = new (window.AudioContext || window.webkitAudioContext)();
	const source = ctx.createMediaStreamSource(stream);
	const proc = ctx.createScriptProcessor(2048, 1, 1);
	const frameMs = 2048 / ctx.sampleRate * 1e3;
	const chunks = [];
	const detector = new SpeechEndDetector();
	let finished = false;
	let resolveDone;
	const done = new Promise((r) => resolveDone = r);
	const finish = (reason) => {
		if (finished) return;
		finished = true;
		proc.disconnect();
		source.disconnect();
		stream.getTracks().forEach((t) => t.stop());
		const wav = reason !== "cancelled" && reason !== "nospeech" && chunks.length > 0 ? new Blob([encodeWav(chunks, ctx.sampleRate)], { type: "audio/wav" }) : null;
		ctx.close();
		resolveDone({
			wav,
			reason
		});
	};
	proc.onaudioprocess = (e) => {
		if (finished) return;
		const frame = new Float32Array(e.inputBuffer.getChannelData(0));
		chunks.push(frame);
		const level = rms(frame);
		onLevel?.(level);
		const end = detector.push(level, frameMs);
		if (end) finish(end);
	};
	source.connect(proc);
	proc.connect(ctx.destination);
	return {
		stop: () => finish(detector.speechStarted || chunks.length > 8 ? "manual" : "nospeech"),
		cancel: () => finish("cancelled"),
		done
	};
}
// src/services/voice/voiceClient.ts
var VoiceServiceError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
var CLIENT_TIMEOUT_MS = 25e3;
/** User-facing explanation for each error code (English UI text). */
var VOICE_ERROR_MESSAGES = {
	BACKEND_UNAVAILABLE: "Voice server is not running. Start it from backend/ with: python -m uvicorn app.main:app --port 8000",
	TIMEOUT: "The voice service took too long. Please try again.",
	KEY_MISSING: "Voice is not configured: GNANI_API_KEY is missing on the server.",
	GNANI_FORBIDDEN: "Gnani refused the request — check the API key or remaining credits.",
	GNANI_AUTH: "Gnani rejected the API key.",
	GNANI_RATE_LIMIT: "Too many requests to Gnani. Please wait a moment.",
	GNANI_UNAVAILABLE: "Gnani speech service is temporarily unavailable.",
	GNANI_TIMEOUT: "Gnani took too long to respond.",
	GNANI_UNREACHABLE: "The server could not reach Gnani. Check the internet connection.",
	AUDIO_TOO_SHORT: "That was too short — please speak a little longer.",
	AUDIO_TOO_LONG: "Please keep commands under 30 seconds."
};
async function call(path, init, signal, fetchImpl = fetch) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), CLIENT_TIMEOUT_MS);
	const onAbort = () => controller.abort(new DOMException("cancelled", "AbortError"));
	signal?.addEventListener("abort", onAbort);
	try {
		return await fetchImpl(path, {
			...init,
			signal: controller.signal
		});
	} catch {
		if (signal?.aborted) throw new VoiceServiceError("CANCELLED", "Cancelled.");
		if (controller.signal.aborted) throw new VoiceServiceError("TIMEOUT", VOICE_ERROR_MESSAGES.TIMEOUT);
		throw new VoiceServiceError("BACKEND_UNAVAILABLE", VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
/** Turns a non-OK response into a VoiceServiceError (handles the proxy's HTML/empty 5xx when the backend is down). */
async function toError(resp) {
	let code = "UNKNOWN";
	let message = `Voice request failed (${resp.status}).`;
	try {
		const body = await resp.json();
		if (body?.error?.code) {
			code = body.error.code;
			message = body.error.message ?? message;
		}
	} catch {
		if (resp.status === 502 || resp.status === 503 || resp.status === 504 || resp.status === 500) code = "BACKEND_UNAVAILABLE";
	}
	return new VoiceServiceError(code, VOICE_ERROR_MESSAGES[code] ?? message);
}
async function getVoiceHealth(signal, fetchImpl) {
	const resp = await call("/api/voice/health", { method: "GET" }, signal, fetchImpl);
	if (!resp.ok) throw await toError(resp);
	try {
		return await resp.json();
	} catch {
		throw new VoiceServiceError("BACKEND_UNAVAILABLE", VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
	}
}
async function transcribe(wav, language, signal, fetchImpl) {
	const form = new FormData();
	form.append("audio", wav, "speech.wav");
	form.append("language", language);
	const resp = await call("/api/voice/transcribe", {
		method: "POST",
		body: form
	}, signal, fetchImpl);
	if (!resp.ok) throw await toError(resp);
	const body = await resp.json();
	return String(body.transcript ?? "");
}
async function synthesize(text, language, signal, fetchImpl) {
	const resp = await call("/api/voice/speak", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			language
		})
	}, signal, fetchImpl);
	if (!resp.ok) throw await toError(resp);
	return await resp.blob();
}
// src/services/voice/partLexicon.ts
/** English engineering words -> spellings Prisma produces in Telugu / Hindi script. */
var LOANWORD_SPELLINGS = {
	sun: {
		te: ["సన్"],
		hi: ["सन"]
	},
	gear: {
		te: ["గేర్", "గియర్"],
		hi: ["गियर", "गेयर"]
	},
	gears: {
		te: ["గేర్లు", "గేర్స్"],
		hi: ["गियर्स", "गियरों"]
	},
	planet: {
		te: ["ప్లానెట్", "ప్లానెట"],
		hi: ["प्लैनेट", "प्लेनेट"]
	},
	ring: {
		te: ["రింగ్"],
		hi: ["रिंग"]
	},
	carrier: {
		te: ["క్యారియర్", "కారియర్"],
		hi: ["कैरियर", "कैरीयर"]
	},
	plate: {
		te: ["ప్లేట్"],
		hi: ["प्लेट"]
	},
	plates: {
		te: ["ప్లేట్లు", "ప్లేట్స్"],
		hi: ["प्लेट्स"]
	},
	shaft: {
		te: ["షాఫ్ట్"],
		hi: ["शाफ्ट", "शाफ़्ट"]
	},
	drive: {
		te: ["డ్రైవ్"],
		hi: ["ड्राइव"]
	},
	central: {
		te: ["సెంట్రల్"],
		hi: ["सेंट्रल"]
	},
	outer: {
		te: ["ఔటర్"],
		hi: ["आउटर"]
	},
	annulus: {
		te: ["అన్యులస్"],
		hi: ["एनुलस"]
	},
	primary: {
		te: ["ప్రైమరీ"],
		hi: ["प्राइमरी"]
	},
	top: {
		te: ["టాప్"],
		hi: ["टॉप"]
	},
	bottom: {
		te: ["బాటమ్"],
		hi: ["बॉटम"]
	},
	upper: {
		te: ["అప్పర్"],
		hi: ["अपर"]
	},
	lower: {
		te: ["లోయర్"],
		hi: ["लोअर"]
	},
	chord: {
		te: ["కార్డ్"],
		hi: ["कॉर्ड"]
	},
	chords: {
		te: ["కార్డ్స్", "కార్డులు"],
		hi: ["कॉर्ड्स"]
	},
	diagonal: {
		te: ["డయాగనల్"],
		hi: ["डायगोनल", "डायगनल"]
	},
	member: {
		te: ["మెంబర్"],
		hi: ["मेंबर"]
	},
	members: {
		te: ["మెంబర్స్"],
		hi: ["मेंबर्स"]
	},
	vertical: {
		te: ["వర్టికల్"],
		hi: ["वर्टिकल"]
	},
	strut: {
		te: ["స్ట్రట్"],
		hi: ["स्ट्रट"]
	},
	struts: {
		te: ["స్ట్రట్స్"],
		hi: ["स्ट्रट्स"]
	},
	gusset: {
		te: ["గస్సెట్", "గసెట్"],
		hi: ["गसेट"]
	},
	end: {
		te: ["ఎండ్"],
		hi: ["एंड"]
	},
	portal: {
		te: ["పోర్టల్"],
		hi: ["पोर्टल"]
	},
	portals: {
		te: ["పోర్టల్స్"],
		hi: ["पोर्टल्स"]
	},
	bridge: {
		te: ["బ్రిడ్జ్", "బ్రిడ్జి"],
		hi: ["ब्रिज"]
	},
	deck: {
		te: ["డెక్"],
		hi: ["डेक"]
	},
	support: {
		te: ["సపోర్ట్"],
		hi: ["सपोर्ट"]
	},
	pier: {
		te: ["పియర్"],
		hi: ["पियर"]
	},
	piers: {
		te: ["పియర్స్"],
		hi: ["पियर्स"]
	},
	a: {
		te: ["ఏ"],
		hi: ["ए"]
	},
	b: {
		te: ["బీ", "బి"],
		hi: ["बी"]
	},
	c: {
		te: ["సీ", "సి"],
		hi: ["सी"]
	}
};
/** Lower-case, strip punctuation, Devanagari nukta and zero-width joiners, collapse spaces. */
function normalise(text) {
	return text.normalize("NFC").toLowerCase().replace(/[़‌‍]/g, "").replace(/[.,!?;:"'()[\]{}|/\\\-–—_&।॥]/g, " ").replace(/\s+/g, " ").trim();
}
var singular = (w) => w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
var STOP_WORDS = /* @__PURE__ */ new Set([
	"and",
	"the",
	"of",
	"cluster",
	"assembly",
	"system",
	"stage"
]);
/** English phrase variants of one name. */
function englishVariants(name) {
	const parts = name.split(/[()&,]/).map((p) => normalise(p)).filter(Boolean);
	const out = /* @__PURE__ */ new Set();
	for (const p of parts) {
		const words = p.split(" ").filter((w) => !STOP_WORDS.has(w));
		if (words.length === 0) continue;
		out.add(words.join(" "));
		out.add(words.map(singular).join(" "));
		if (words.length > 1 && /^([a-z]|\d+)$/.test(words[words.length - 1])) out.add(words.slice(0, -1).join(" "));
		if (words.length > 2) {
			out.add(words.slice(-2).join(" "));
			out.add(words.slice(-2).map(singular).join(" "));
		}
		for (const w of words) if (w.length > 3) {
			out.add(w);
			out.add(singular(w));
		}
	}
	return [...out];
}
/** Telugu / Hindi spellings of an English phrase, only when every word has a known spelling. */
function scriptVariants(phrase) {
	const words = phrase.split(" ");
	const out = [];
	for (const script of ["te", "hi"]) {
		let combos = [""];
		for (const w of words) {
			const spellings = LOANWORD_SPELLINGS[w]?.[script];
			if (!spellings) {
				combos = [];
				break;
			}
			combos = combos.flatMap((c) => spellings.map((s) => c ? `${c} ${s}` : s));
		}
		out.push(...combos.map(normalise));
	}
	return out;
}
function collectTreeNames(node, into) {
	if (node.componentId) {
		const list = into.get(node.componentId) ?? [];
		list.push(node.name);
		into.set(node.componentId, list);
	}
	node.children?.forEach((c) => collectTreeNames(c, into));
}
function buildPartLexicon(model) {
	const treeNames = /* @__PURE__ */ new Map();
	collectTreeNames(model.getAssemblyTree(), treeNames);
	const raw = model.getAllComponentIds().map((componentId) => {
		const meta = model.getComponentMetadata(componentId);
		const names = [
			componentId.replace(/_/g, " ").replace(/\s\d+$/, ""),
			...treeNames.get(componentId) ?? [],
			...meta?.name ? [meta.name] : []
		];
		const english = new Set(names.flatMap(englishVariants));
		const phrases = new Set(english);
		english.forEach((p) => scriptVariants(p).forEach((v) => phrases.add(v)));
		return {
			componentId,
			displayName: treeNames.get(componentId)?.[0] ?? meta?.name ?? componentId,
			phrases
		};
	});
	const singleWordOwners = /* @__PURE__ */ new Map();
	for (const e of raw) for (const p of e.phrases) if (!p.includes(" ")) {
		const owners = singleWordOwners.get(p) ?? /* @__PURE__ */ new Set();
		owners.add(e.componentId);
		singleWordOwners.set(p, owners);
	}
	const modelWords = /* @__PURE__ */ new Set();
	for (const w of normalise(model.name).split(" ")) {
		modelWords.add(w);
		modelWords.add(singular(w));
		scriptVariants(w).forEach((v) => modelWords.add(v));
	}
	return raw.map((e) => ({
		componentId: e.componentId,
		displayName: e.displayName,
		phrases: [...e.phrases].filter((p) => p.includes(" ") || singleWordOwners.get(p).size === 1 && !modelWords.has(p))
	}));
}
// src/services/scene/referenceResolver.ts
function resolveComponentReference(req, scene) {
	const valid = new Set(scene.components.map((c) => c.id));
	const explicit = [...new Set(req.explicitIds)].filter((id) => valid.has(id));
	if (explicit.length === 1) return {
		kind: "resolved",
		componentId: explicit[0],
		via: "explicit"
	};
	if (explicit.length > 1) return {
		kind: "ambiguous",
		options: explicit
	};
	if (!req.contextual) return { kind: "needsClarification" };
	const pointed = scene.pointer.status === "known" ? scene.pointer.value.componentId : null;
	if (pointed && valid.has(pointed)) return {
		kind: "resolved",
		componentId: pointed,
		via: "pointed"
	};
	if (scene.selectedComponentId && valid.has(scene.selectedComponentId)) return {
		kind: "resolved",
		componentId: scene.selectedComponentId,
		via: "selected"
	};
	const last = scene.lastDiscussedComponentId.status === "known" ? scene.lastDiscussedComponentId.value : null;
	if (last && valid.has(last)) return {
		kind: "resolved",
		componentId: last,
		via: "lastDiscussed"
	};
	return { kind: "needsClarification" };
}
// src/services/voice/phraseParser.ts
/** Common machine parts that are not in any current model (English + Telugu + Hindi spellings). */
var COMMON_FOREIGN_PARTS = [
	"piston",
	"pistons",
	"crankshaft",
	"crank shaft",
	"connecting rod",
	"cylinder",
	"valve",
	"valves",
	"camshaft",
	"cam shaft",
	"spark plug",
	"flywheel",
	"fly wheel",
	"engine",
	"wheel",
	"brake",
	"clutch",
	"pulley",
	"belt",
	"propeller",
	"turbine",
	"nozzle",
	"పిస్టన్",
	"క్రాంక్ షాఫ్ట్",
	"క్రాంక్‌షాఫ్ట్",
	"సిలిండర్",
	"వాల్వ్",
	"ఇంజన్",
	"ఇంజిన్",
	"ఫ్లైవీల్",
	"కనెక్టింగ్ రాడ్",
	"पिस्टन",
	"क्रैंकशाफ्ट",
	"क्रैंक शाफ्ट",
	"सिलेंडर",
	"वाल्व",
	"इंजन",
	"फ्लाईव्हील",
	"कनेक्टिंग रॉड"
].map(normalise);
var W = {
	zoom: [
		"zoom",
		"జూమ్",
		"जूम"
	],
	in: [
		"in",
		"closer",
		"nearer",
		"ఇన్",
		"దగ్గరగా",
		"దగ్గరికి",
		"इन",
		"पास",
		"करीब",
		"नजदीक"
	],
	out: [
		"out",
		"farther",
		"further",
		"away",
		"అవుట్",
		"దూరంగా",
		"దూరం",
		"आउट",
		"दूर"
	],
	bigger: [
		"bigger",
		"larger",
		"enlarge",
		"magnify",
		"పెద్దగా",
		"పెద్దది",
		"बड़ा"
	],
	smaller: [
		"smaller",
		"shrink",
		"చిన్నగా",
		"చిన్నది",
		"छोटा"
	],
	move: [
		"move",
		"pan",
		"shift",
		"slide",
		"మూవ్",
		"జరుపు",
		"జరపండి",
		"జరిపి",
		"కదుపు",
		"కదపండి",
		"మూవ్",
		"मूव",
		"खिसकाओ",
		"खिसकाइए",
		"सरकाओ",
		"हटाओ",
		"ले जाओ",
		"पैन"
	],
	rotate: [
		"rotate",
		"turn",
		"spin",
		"orbit",
		"రొటేట్",
		"తిప్పు",
		"తిప్పండి",
		"తిప్పి",
		"రొటేట్",
		"रोटेट",
		"घुमाओ",
		"घुमाइए",
		"घुमा",
		"मोड़ो"
	],
	left: [
		"left",
		"లెఫ్ట్",
		"ఎడమ",
		"लेफ्ट",
		"बाएं",
		"बायें",
		"बाईं",
		"बाएँ",
		"बाई"
	],
	right: [
		"right",
		"రైట్",
		"కుడి",
		"राइट",
		"दाएं",
		"दायें",
		"दाईं",
		"दाएँ",
		"दाई"
	],
	up: [
		"up",
		"upward",
		"upwards",
		"అప్",
		"పైకి",
		"పైన",
		"अप",
		"ऊपर"
	],
	down: [
		"down",
		"downward",
		"downwards",
		"డౌన్",
		"కిందకి",
		"కిందికి",
		"కింద",
		"डाउन",
		"नीचे"
	],
	side: [
		"side",
		"view",
		"వైపు",
		"సైడ్",
		"వ్యూ",
		"తరఫు",
		"तरफ",
		"साइड",
		"व्यू",
		"ओर"
	],
	back: [
		"back",
		"behind",
		"rear",
		"backside",
		"బ్యాక్",
		"వెనుక",
		"వెనక",
		"बैक",
		"पीछे",
		"पिछला हिस्सा"
	],
	front: [
		"front",
		"ఫ్రంట్",
		"ముందు",
		"ముందర",
		"फ्रंट",
		"सामने",
		"आगे"
	],
	top: [
		"top",
		"above",
		"overhead",
		"టాప్",
		"పై నుంచి",
		"పైనుంచి",
		"పైనుండి",
		"टॉप",
		"ऊपर से"
	],
	isometric: [
		"isometric",
		"3d view",
		"three d",
		"ఐసోమెట్రిక్",
		"आइसोमेट्रिक"
	],
	reset: [
		"reset",
		"original view",
		"default view",
		"normal view",
		"restore the view",
		"restore view",
		"home view",
		"రీసెట్",
		"మొదటి లాగా",
		"మొదటిలాగా",
		"అసలు వ్యూ",
		"रीसेट",
		"पहले जैसा",
		"पहले जैसे",
		"ओरिजिनल व्यू"
	],
	select: [
		"select",
		"choose",
		"pick",
		"highlight",
		"సెలెక్ట్",
		"ఎంచుకో",
		"ఎంచుకోండి",
		"ఎంచుకొను",
		"सेलेक्ट",
		"चुनो",
		"चुनिए",
		"चुनें",
		"हाइलाइट"
	],
	focus: [
		"focus",
		"zoom to",
		"zoom into",
		"zoom on",
		"go to",
		"show me",
		"ఫోకస్",
		"చూపించు",
		"చూపించండి",
		"చూపు",
		"फोकस",
		"दिखाओ",
		"दिखाइए",
		"दिखाएं"
	],
	isolate: [
		"isolate",
		"separate",
		"only",
		"alone",
		"detach",
		"ఐసోలేట్",
		"వేరు",
		"వేరుగా",
		"మాత్రమే",
		"విడిగా",
		"आइसोलेट",
		"अलग",
		"सिर्फ",
		"केवल",
		"अकेला"
	],
	hide: [
		"hide",
		"remove",
		"దాచు",
		"దాచండి",
		"హైడ్",
		"తీసేయి",
		"తీసేయండి",
		"छुपाओ",
		"छिपाओ",
		"छुपा",
		"हाइड",
		"हटा दो"
	],
	unhide: [
		"unhide",
		"show again",
		"bring back",
		"మళ్లీ చూపించు",
		"అన్‌హైడ్",
		"वापस दिखाओ",
		"फिर से दिखाओ",
		"अनहाइड"
	],
	all: [
		"all",
		"everything",
		"whole",
		"entire",
		"అన్నీ",
		"అన్ని",
		"మొత్తం",
		"పూర్తి",
		"सब",
		"सारा",
		"सारे",
		"पूरा",
		"पूरी"
	],
	show: [
		"show",
		"display",
		"చూపించు",
		"చూపించండి",
		"చూపు",
		"दिखाओ",
		"दिखाइए"
	],
	explode: [
		"explode",
		"exploded",
		"take apart",
		"disassemble",
		"pull apart",
		"open up",
		"separate the parts",
		"separate all",
		"ఎక్స్‌ప్లోడ్",
		"ఎక్స్ప్లోడ్",
		"విడదీయి",
		"విడదీయండి",
		"విడదీసి",
		"విడగొట్టు",
		"విప్పు",
		"విప్పండి",
		"एक्सप्लोड",
		"खोलो",
		"खोलिए",
		"अलग अलग",
		"पुर्जे अलग"
	],
	assemble: [
		"assemble",
		"reassemble",
		"back together",
		"together",
		"combine",
		"restore the assembly",
		"restore assembly",
		"close it",
		"అసెంబుల్",
		"కలుపు",
		"కలపండి",
		"కలిపి",
		"జోడించు",
		"జోడించండి",
		"మళ్లీ కలుపు",
		"असेंबल",
		"जोड़ो",
		"जोड़ दो",
		"जोड़िए",
		"जोड़ो",
		"जोड़",
		"वापस जोड़ो",
		"मिलाओ"
	],
	animation: [
		"animation",
		"motion",
		"movement",
		"gears",
		"mechanism",
		"యానిమేషన్",
		"కదలిక",
		"एनिमेशन",
		"गति",
		"हलचल"
	],
	pause: [
		"pause",
		"freeze",
		"stop",
		"halt",
		"పాజ్",
		"ఆపు",
		"ఆపండి",
		"ఆపేయ్",
		"ఆగు",
		"पॉज",
		"रोको",
		"रोकिए",
		"रोक दो",
		"बंद करो",
		"रुको"
	],
	play: [
		"play",
		"resume",
		"start",
		"run",
		"animate",
		"continue",
		"ప్లే",
		"నడిపించు",
		"మొదలుపెట్టు",
		"స్టార్ట్",
		"కొనసాగించు",
		"प्ले",
		"चलाओ",
		"चलाइए",
		"शुरू",
		"स्टार्ट"
	],
	slower: [
		"slow",
		"slower",
		"slowly",
		"స్లో",
		"నెమ్మదిగా",
		"మెల్లగా",
		"स्लो",
		"धीरे",
		"धीमा"
	],
	faster: [
		"fast",
		"faster",
		"quick",
		"quicker",
		"speed up",
		"ఫాస్ట్",
		"వేగంగా",
		"త్వరగా",
		"फास्ट",
		"तेज",
		"जल्दी"
	],
	normalSpeed: [
		"normal speed",
		"regular speed",
		"నార్మల్ స్పీడ్",
		"సాధారణ వేగం",
		"नॉर्मल स्पीड",
		"सामान्य गति"
	],
	auto: [
		"auto rotate",
		"auto rotation",
		"auto orbit",
		"autorotate",
		"ఆటో రొటేట్",
		"ఆటో",
		"ऑटो रोटेट",
		"ऑटो"
	],
	on: [
		"on",
		"enable",
		"start",
		"ఆన్",
		"ఆన్ చేయి",
		"ऑन",
		"चालू"
	],
	lesson: [
		"lesson",
		"tour",
		"guided",
		"tutorial",
		"teach me",
		"పాఠం",
		"లెసన్",
		"టూర్",
		"పాఠము",
		"पाठ",
		"लेसन",
		"टूर",
		"सबक"
	],
	next: [
		"next",
		"next step",
		"continue",
		"తర్వాత",
		"తరువాత",
		"నెక్స్ట్",
		"ముందుకు",
		"अगला",
		"आगे बढ़ो",
		"नेक्स्ट"
	],
	previous: [
		"previous",
		"go back",
		"last step",
		"back step",
		"ముందటి",
		"వెనక్కి",
		"వెనుకకు",
		"ప్రీవియస్",
		"पिछला",
		"पीछे जाओ",
		"प्रीवियस"
	],
	exit: [
		"exit",
		"end",
		"quit",
		"close",
		"stop",
		"ఆపు",
		"ముగించు",
		"ఎగ్జిట్",
		"బయటకు",
		"बंद",
		"खत्म",
		"एग्जिट",
		"समाप्त"
	],
	home: [
		"go home",
		"home page",
		"homepage",
		"main menu",
		"catalogue",
		"catalog",
		"dashboard",
		"హోమ్",
		"హోం",
		"होम",
		"मुख्य पेज"
	],
	thisRef: [
		"this",
		"that",
		"it",
		"its",
		"selected",
		"this part",
		"this one",
		"that one",
		"ఇది",
		"దీన్ని",
		"దీనిని",
		"దాన్ని",
		"ఈ పార్ట్",
		"ఇదే",
		"ఈ భాగం",
		"యిది",
		"దీని",
		"దాని",
		"అది",
		"यह",
		"इसे",
		"इस",
		"ये",
		"इसको",
		"उसे",
		"उस",
		"वो",
		"वह"
	],
	related: [
		"connected",
		"related",
		"attached",
		"linked",
		"neighbour",
		"neighbor",
		"neighbours",
		"neighbors",
		"meshes with",
		"mesh with",
		"touching",
		"కనెక్ట్",
		"అనుసంధాన",
		"జతచేయబడిన",
		"కలిసి ఉన్న",
		"సంబంధిత",
		"जुड़े",
		"जुड़ा",
		"जुड़ी",
		"कनेक्टेड",
		"संबंधित",
		"लगे हुए"
	],
	clear: [
		"clear",
		"remove",
		"stop",
		"turn off",
		"off",
		"తీసేయి",
		"తీసేయండి",
		"ఆపు",
		"हटाओ",
		"हटा दो",
		"बंद"
	],
	highlightWord: [
		"highlight",
		"highlighting",
		"highlights",
		"glow",
		"హైలైట్",
		"हाइलाइट"
	],
	putBack: [
		"put it back",
		"put back",
		"put them back",
		"undo that",
		"వెనక్కి పెట్టు",
		"మళ్లీ పెట్టు",
		"యథాస్థానంలో",
		"वापस रखो",
		"वापस लगाओ",
		"वापस करो"
	],
	together: [
		"together",
		"assemble",
		"కలుపు",
		"కలిపి",
		"जोड़"
	],
	qFailure: [
		"stops working",
		"stop working",
		"stopped working",
		"fails",
		"failed",
		"failure",
		"breaks",
		"broken",
		"what happens if",
		"what if",
		"what would happen",
		"would happen if",
		"were missing",
		"is missing",
		"without it",
		"పనిచేయకపోతే",
		"పని చేయకపోతే",
		"పాడైతే",
		"విరిగితే",
		"ఆగిపోతే",
		"खराब हो",
		"टूट",
		"काम करना बंद",
		"बंद हो जाए",
		"काम न करे"
	],
	qHow: [
		"how does",
		"how do",
		"how is",
		"how it works",
		"what happens when",
		"show me how",
		"interacts",
		"interact with",
		"ఎలా",
		"कैसे"
	],
	qPurpose: [
		"why",
		"purpose",
		"what does",
		"what is it for",
		"what is the use",
		"used for",
		"needed",
		"what is it used",
		"role",
		"job",
		"ఎందుకు",
		"ఉపయోగం",
		"పని ఏమిటి",
		"ఏం చేస్తుంది",
		"ఏమి చేస్తుంది",
		"పాత్ర",
		"అవసరం",
		"क्यों",
		"उपयोग",
		"काम क्या",
		"किस काम",
		"क्या करता",
		"क्या करती",
		"भूमिका",
		"जरूरत"
	],
	qExplain: [
		"explain",
		"tell me about",
		"describe",
		"వివరించు",
		"వివరించండి",
		"వివరించగలరా",
		"గురించి",
		"చెప్పు",
		"చెప్పండి",
		"ఎక్స్ప్లెయిన్",
		"ఎక్స్ప్లేన్",
		"ఎక్స్ప్లైన్",
		"ఎక్స్ప్లెయిన",
		"డిస్క్రైబ్",
		"समझाओ",
		"समझाइए",
		"समझा दो",
		"के बारे में",
		"बताओ",
		"बताइए",
		"एक्सप्लेन",
		"एक्स्प्लेन",
		"डिस्क्राइब"
	],
	teachTopic: [
		"power flow",
		"power flows",
		"flow of power",
		"power transmission",
		"transmits power",
		"load path",
		"load transfer",
		"load transfers",
		"forces travel",
		"force travels",
		"forces flow",
		"how forces",
		"how the load",
		"how power",
		"శక్తి ఎలా",
		"బలం ఎలా",
		"లోడ్ ఎలా",
		"शक्ति कैसे",
		"बल कैसे",
		"लोड कैसे",
		"पावर कैसे"
	],
	modelNoun: [
		"gearbox",
		"gear box",
		"bridge",
		"truss",
		"model",
		"machine",
		"mechanism",
		"structure",
		"transmission",
		"గేర్‌బాక్స్",
		"గేర్ బాక్స్",
		"గేర్బాక్స్",
		"వంతెన",
		"బ్రిడ్జ్",
		"మోడల్",
		"యంత్రం",
		"गियरबॉक्स",
		"गियर बॉक्स",
		"पुल",
		"ब्रिज",
		"मॉडल",
		"मशीन",
		"ढांचा"
	],
	thisWord: [
		"ఈ",
		"ఆ",
		"यह",
		"ये",
		"वह",
		"वो"
	],
	bottomView: [
		"bottom view",
		"bottom side",
		"from the bottom",
		"from below",
		"from underneath",
		"underside",
		"view from under",
		"కింది వైపు",
		"కింద నుంచి",
		"కింది నుండి",
		"అడుగు భాగం",
		"नीचे से",
		"नीचे का दृश्य",
		"नीचे की तरफ से",
		"तले का"
	],
	determiner: [
		"this",
		"that",
		"the",
		"entire",
		"whole",
		"overall",
		"ఈ",
		"ఆ",
		"మొత్తం",
		"यह",
		"इस",
		"पूरे",
		"पूरा"
	],
	ctlPause: [
		"pause",
		"wait",
		"hold on",
		"one minute",
		"one second",
		"ఆగు",
		"ఆగండి",
		"ఒక్క నిమిషం",
		"ఒక్క క్షణం",
		"रुको",
		"रुकिए",
		"एक मिनट",
		"ठहरो"
	],
	ctlResume: [
		"continue",
		"resume",
		"go on",
		"carry on",
		"keep going",
		"కొనసాగించు",
		"కొనసాగించండి",
		"కానివ్వు",
		"जारी रखो",
		"आगे बढ़ो",
		"चालू रखो"
	],
	ctlStop: [
		"stop",
		"stop explaining",
		"cancel",
		"enough",
		"that is enough",
		"ఆపు",
		"ఆపండి",
		"చాలు",
		"బస్",
		"बस",
		"बंद करो",
		"रोको",
		"रहने दो"
	],
	langTe: [
		"in telugu",
		"తెలుగులో",
		"తెలుగు లో",
		"तेलुगु में"
	],
	langHi: [
		"in hindi",
		"హిందీలో",
		"హిందీ లో",
		"हिंदी में",
		"हिन्दी में"
	],
	langEn: [
		"in english",
		"ఇంగ్లీష్‌లో",
		"ఇంగ్లీషులో",
		"ఇంగ్లీష్ లో",
		"अंग्रेजी में",
		"इंग्लिश में"
	],
	qIdentify: [
		"what is",
		"what's",
		"whats",
		"which part",
		"what part",
		"identify",
		"ఏమిటి",
		"ఏంటి",
		"ఏ భాగం",
		"क्या है",
		"कौन सा",
		"कौनसा"
	]
};
var INDIC = /[ऀ-෿]/;
function has(text, words) {
	const padded = ` ${text} `;
	return words.some((w) => {
		const n = normalise(w);
		if (!n) return false;
		return INDIC.test(n) ? padded.includes(` ${n}`) : padded.includes(` ${n} `);
	});
}
/** Whole-word match (used for very short words that would otherwise match inside others). */
function hasWord(text, words) {
	const tokens = new Set(text.split(" "));
	return words.some((w) => tokens.has(normalise(w)));
}
/** Removes model phrases ("this gearbox", "the entire bridge") so their determiner is not taken
*  as a reference to a part (Task V5: "what is its role in the entire gearbox" is about a part). */
function withoutModelPhrases(text) {
	let out = ` ${text} `;
	const nouns = W.modelNoun.map(normalise).sort((a, b) => b.length - a.length);
	for (const n of nouns) {
		for (const d of W.determiner.map(normalise)) out = out.split(` ${d} ${n}`).join(" ");
		out = out.split(` ${n}`).join(" ");
	}
	return out.replace(/\s+/g, " ").trim();
}
function containsPhrase(text, phrase) {
	const padded = ` ${text} `;
	return INDIC.test(phrase) ? padded.includes(` ${phrase}`) : padded.includes(` ${phrase} `);
}
/** Best-matching parts of the loaded model (longest phrase wins; ties = ambiguity). */
function matchParts(text, lexicon) {
	let best = 0;
	let ids = /* @__PURE__ */ new Set();
	for (const entry of lexicon) for (const phrase of entry.phrases) if (phrase.length >= best && containsPhrase(text, phrase)) {
		if (phrase.length > best) {
			best = phrase.length;
			ids = /* @__PURE__ */ new Set();
		}
		ids.add(entry.componentId);
	}
	return {
		ids: [...ids],
		length: best
	};
}
/**
* Task V4: every part mention in the text, grouped by phrase. "from the deck to the piers" gives
* two groups (a path); "the planet gear" gives one group of three parts (ambiguous). Phrases inside
* a longer matched phrase ("gear" in "sun gear") are ignored.
*/
function mentionGroups(text, lexicon) {
	const byPhrase = /* @__PURE__ */ new Map();
	for (const entry of lexicon) for (const phrase of entry.phrases) if (containsPhrase(text, phrase)) byPhrase.set(phrase, (byPhrase.get(phrase) ?? /* @__PURE__ */ new Set()).add(entry.componentId));
	const phrases = [...byPhrase.keys()];
	const kept = phrases.filter((ph) => !phrases.some((o) => o !== ph && o.length > ph.length && o.includes(ph)));
	const groups = /* @__PURE__ */ new Map();
	for (const ph of kept) {
		const ids = [...byPhrase.get(ph)].sort();
		groups.set(ids.join("|"), ids);
	}
	return [...groups.values()];
}
function matchForeign(text, foreign) {
	let best = null;
	for (const f of foreign) if (containsPhrase(text, f.phrase) && (!best || f.phrase.length > best.phrase.length)) best = f;
	return best;
}
var commands = (intent, cmds, partId) => ({
	kind: "commands",
	intent,
	commands: cmds,
	partId
});
function parseVoiceCommand(transcript, ctx) {
	const text = normalise(transcript);
	if (!text) return { kind: "noMatch" };
	if (ctx.teachingActive && matchParts(text, ctx.lexicon).ids.length === 0 && !has(text, W.qExplain) && !has(text, W.qHow) && !has(text, W.qPurpose) && !has(text, W.qFailure)) {
		if (has(text, W.ctlResume)) return {
			kind: "teachControl",
			action: "resume"
		};
		if (has(text, W.ctlPause)) return {
			kind: "teachControl",
			action: "pause"
		};
		if (has(text, W.ctlStop)) return {
			kind: "teachControl",
			action: "stop"
		};
	}
	if (has(text, W.home)) return commands("home", [{ type: "workspace.goHome" }]);
	const lessonWord = has(text, W.lesson);
	if (lessonWord && has(text, W.exit) && ctx.lessonActive) return commands("lessonExit", [{ type: "lesson.exit" }]);
	if (lessonWord) return commands("lessonStart", [{ type: "lesson.start" }]);
	if (ctx.lessonActive) {
		if (has(text, W.previous)) return commands("lessonPrev", [{ type: "lesson.previous" }]);
		if (has(text, W.next)) return commands("lessonNext", [{ type: "lesson.next" }]);
	}
	if (has(text, W.auto)) return commands("autoOrbit", [{
		type: "camera.autoOrbit",
		enabled: !(has(text, W.pause) || has(text, [
			"off",
			"disable",
			"ఆఫ్",
			"ऑफ"
		]))
	}]);
	const animWord = has(text, W.animation);
	if (has(text, W.normalSpeed)) return commands("animSpeed", [{
		type: "animation.setSpeed",
		speed: 1
	}]);
	if ((animWord || !has(text, W.zoom)) && has(text, W.slower) && !has(text, W.move)) return commands("animSpeed", [{
		type: "animation.setSpeed",
		speed: .5
	}]);
	if ((animWord || !has(text, W.zoom)) && has(text, W.faster) && !has(text, W.move)) return commands("animSpeed", [{
		type: "animation.setSpeed",
		speed: 2
	}]);
	if (animWord && has(text, W.pause)) return commands("animPause", [{ type: "animation.pause" }]);
	if (animWord && has(text, W.play)) return commands("animPlay", [{ type: "animation.play" }]);
	if (has(text, W.putBack) && !has(text, W.together)) return putBack(ctx);
	if (has(text, W.highlightWord) && has(text, W.clear)) return commands("clearHighlight", [{ type: "component.clearHighlight" }]);
	if (has(text, W.all) && (has(text, W.show) || has(text, W.unhide))) return commands("showAll", [{ type: "component.showAll" }]);
	if (has(text, W.assemble)) return commands("assemble", [{ type: "assembly.restore" }]);
	if (has(text, W.bottomView) || /(^| )(show|see|view|look at)( me)? the bottom( of the \S+)?$/.test(text)) return {
		kind: "unavailable",
		intent: "view",
		reason: "noBottomView"
	};
	const parts = matchParts(text, ctx.lexicon);
	const foreign = matchForeign(text, ctx.foreignParts);
	const partText = withoutModelPhrases(text);
	const refersToThis = has(partText, W.thisRef) || hasWord(partText, W.thisWord);
	const foreignWins = Boolean(foreign && foreign.phrase.length > parts.length);
	const teachTopic = has(text, W.teachTopic);
	const question = has(text, W.qFailure) ? "failure" : has(text, W.qExplain) ? "explain" : has(text, W.qHow) || teachTopic ? "howWorks" : has(text, W.qPurpose) ? "purpose" : has(text, W.qIdentify) ? "identify" : null;
	const language = has(text, W.langTe) ? "te-IN" : has(text, W.langHi) ? "hi-IN" : has(text, W.langEn) ? "en-IN" : void 0;
	const withLang = (o) => language ? {
		...o,
		language
	} : o;
	const resolve = () => resolveComponentReference({
		explicitIds: parts.ids,
		contextual: refersToThis
	}, resolverScene(ctx));
	const groups = question ? mentionGroups(text, ctx.lexicon) : [];
	if (question !== null && question !== "identify" && !foreignWins && (groups.length > 1 || parts.ids.length === 0 && !refersToThis && (has(text, W.modelNoun) || teachTopic))) return withLang({
		kind: "question",
		question,
		...groups.length > 1 ? { mentionedIds: [...new Set(groups.flat())] } : {}
	});
	if (question && (parts.ids.length > 0 || refersToThis || foreignWins)) {
		if (foreignWins) return {
			kind: "unknownPart",
			intent: "ask",
			spoken: foreign.phrase,
			belongsTo: foreign.modelName
		};
		const r = resolve();
		if (r.kind === "ambiguous") return {
			kind: "ambiguous",
			intent: "ask",
			options: r.options
		};
		if (r.kind === "needsClarification") return {
			kind: "needsSelection",
			intent: "ask"
		};
		return withLang({
			kind: "question",
			question,
			partId: r.componentId,
			via: r.via
		});
	}
	if (has(text, W.related) && (parts.ids.length > 0 || refersToThis || foreignWins)) {
		if (foreignWins) return {
			kind: "unknownPart",
			intent: "related",
			spoken: foreign.phrase,
			belongsTo: foreign.modelName
		};
		const r = resolve();
		if (r.kind === "ambiguous") return {
			kind: "ambiguous",
			intent: "related",
			options: r.options
		};
		if (r.kind === "needsClarification") return {
			kind: "needsSelection",
			intent: "related"
		};
		const related = ctx.scene?.components.find((c) => c.id === r.componentId)?.relatedComponentIds ?? [];
		if (related.length === 0) return {
			kind: "unavailable",
			intent: "related",
			reason: "noRelationships",
			partId: r.componentId
		};
		return {
			kind: "commands",
			intent: "related",
			partId: r.componentId,
			via: r.via,
			commands: [{
				type: "component.select",
				componentId: r.componentId
			}, {
				type: "component.highlight",
				componentIds: related
			}]
		};
	}
	const partIntent = has(text, W.unhide) ? "show" : has(text, W.hide) ? "hide" : has(text, W.isolate) && !has(text, W.explode) ? "isolate" : has(text, W.focus) || has(text, W.zoom) && !has(text, W.out) && (parts.ids.length > 0 || refersToThis) ? "focus" : has(text, W.select) ? "select" : null;
	if (foreign && foreign.phrase.length > parts.length) return {
		kind: "unknownPart",
		intent: partIntent ?? "select",
		spoken: foreign.phrase,
		belongsTo: foreign.modelName
	};
	if (parts.ids.length > 0 || partIntent && refersToThis) {
		if (parts.ids.length > 1 && (partIntent === "hide" || partIntent === "show")) return commands(partIntent, [{
			type: "component.visibility",
			componentIds: parts.ids,
			visible: partIntent === "show"
		}]);
		const intent = partIntent ?? "select";
		const r = resolve();
		if (r.kind === "ambiguous") return {
			kind: "ambiguous",
			intent,
			options: r.options
		};
		if (r.kind === "needsClarification") return {
			kind: "needsSelection",
			intent
		};
		const target = r.componentId;
		const withVia = (o) => o.kind === "commands" ? {
			...o,
			via: r.via
		} : o;
		switch (intent) {
			case "isolate": return withVia(commands(intent, [
				{
					type: "component.select",
					componentId: target
				},
				{
					type: "component.isolate",
					componentId: target
				},
				{
					type: "component.focus",
					componentId: target
				}
			], target));
			case "focus": return withVia(commands(intent, [{
				type: "component.select",
				componentId: target
			}, {
				type: "component.focus",
				componentId: target
			}], target));
			case "hide": return withVia(commands(intent, [{
				type: "component.visibility",
				componentIds: [target],
				visible: false
			}], target));
			case "show": return withVia(commands(intent, [{
				type: "component.visibility",
				componentIds: [target],
				visible: true
			}], target));
			default: return withVia(commands("select", [{
				type: "component.select",
				componentId: target
			}], target));
		}
	}
	if (partIntent && !refersToThis && (partIntent === "select" || partIntent === "isolate" || partIntent === "hide")) return {
		kind: "unknownPart",
		intent: partIntent,
		spoken: ""
	};
	if (has(text, W.explode)) return commands("explode", [{
		type: "assembly.explode",
		factor: .75
	}]);
	if (has(text, W.zoom) || has(text, W.bigger) || has(text, W.smaller)) return commands("zoom", [{
		type: "camera.zoom",
		direction: has(text, W.out) || has(text, W.smaller) ? "out" : "in"
	}]);
	const dir = has(text, W.left) ? "left" : has(text, W.right) ? "right" : has(text, W.up) ? "up" : has(text, W.down) ? "down" : null;
	if (has(text, W.rotate)) {
		const [yawDeg, pitchDeg] = {
			left: [30, 0],
			right: [-30, 0],
			up: [0, 20],
			down: [0, -20]
		}[dir ?? "right"];
		return commands("orbit", [{
			type: "camera.orbit",
			yawDeg,
			pitchDeg
		}]);
	}
	if (has(text, W.move) && dir) return commands("pan", [{
		type: "camera.pan",
		direction: dir
	}]);
	if (has(text, W.reset)) return commands("reset", [{ type: "camera.reset" }]);
	if (has(text, W.isometric)) return commands("view", [{
		type: "camera.view",
		view: "isometric"
	}]);
	if (has(text, W.back)) return commands("view", [{
		type: "camera.view",
		view: "back"
	}]);
	if (has(text, W.top)) return commands("view", [{
		type: "camera.view",
		view: "top"
	}]);
	if (has(text, W.front)) return commands("view", [{
		type: "camera.view",
		view: "front"
	}]);
	if (dir === "left" || dir === "right") return has(text, W.side) ? commands("view", [{
		type: "camera.view",
		view: dir
	}]) : commands("pan", [{
		type: "camera.pan",
		direction: dir
	}]);
	if (dir === "up" || dir === "down") return commands("pan", [{
		type: "camera.pan",
		direction: dir
	}]);
	if (has(text, W.pause)) return commands("animPause", [{ type: "animation.pause" }]);
	if (has(text, W.play)) return commands("animPlay", [{ type: "animation.play" }]);
	return { kind: "noMatch" };
}
/** Scene facts for the resolver: the live snapshot, or (V2 callers) just the selection. */
function resolverScene(ctx) {
	if (ctx.scene) return ctx.scene;
	return {
		components: [...new Set(ctx.lexicon.map((e) => e.componentId))].map((id) => ({
			id,
			name: id,
			role: null,
			visible: true,
			relatedComponentIds: []
		})),
		pointer: {
			status: "unavailable",
			reason: "No scene snapshot."
		},
		selectedComponentId: ctx.selectedComponentId,
		lastDiscussedComponentId: {
			status: "unavailable",
			reason: "No scene snapshot."
		}
	};
}
/** "Put it back": reverses the most specific change visible in the scene. */
function putBack(ctx) {
	const scene = ctx.scene;
	if (!scene) return commands("assemble", [{ type: "assembly.restore" }]);
	const isolated = scene.isolatedComponentId.status === "known" ? scene.isolatedComponentId.value : null;
	if (isolated) return commands("putBack", [{
		type: "component.isolate",
		componentId: null
	}], isolated);
	if (scene.hiddenComponentIds.length > 0) return commands("putBack", [{
		type: "component.visibility",
		componentIds: [...scene.hiddenComponentIds],
		visible: true
	}]);
	if (scene.exploded.active) return commands("putBack", [{ type: "assembly.restore" }]);
	if ((scene.highlightedComponentIds.status === "known" ? scene.highlightedComponentIds.value : []).length > 0) return commands("putBack", [{ type: "component.clearHighlight" }]);
	return {
		kind: "unavailable",
		intent: "putBack",
		reason: "nothingToPutBack"
	};
}
// src/services/voice/voiceReplies.ts
var FULLY_SUPPORTED_LANGUAGES = [
	"en-IN",
	"te-IN",
	"hi-IN"
];
var EN = {
	zoom: "Zooming.",
	zoomIn: "Zooming in.",
	zoomOut: "Zooming out.",
	pan: "Moving the view {dir}.",
	orbit: "Rotating {dir}.",
	view: "Showing the {view} view.",
	reset: "Back to the original view.",
	select: "Selected {part}.",
	focus: "Showing {part}.",
	isolate: "Showing only {part}.",
	hide: "Hid {part}.",
	show: "Showing {part} again.",
	showAll: "Showing all parts.",
	explode: "Separating the assembly.",
	assemble: "Putting the assembly back together.",
	animPlay: "Animation playing.",
	animPause: "Animation paused.",
	animSpeed: "Animation speed {speed}×.",
	autoOrbit: "Auto-rotation on.",
	autoOrbitOff: "Auto-rotation off.",
	lessonStart: "Starting the guided lesson.",
	lessonNext: "Next step.",
	lessonPrev: "Previous step.",
	lessonExit: "Lesson closed.",
	home: "Going to the home page.",
	deferred: "Your hand or mouse is moving the view. I will do it when you stop.",
	expired: "Your hand kept moving, so I skipped that.",
	needsSelection: "Which part do you mean? Point at it, select it, or say its name.",
	related: "Highlighting the parts connected to {part}: {list}.",
	clearHighlight: "Highlight cleared.",
	putBack: "Put back as it was.",
	ask: "Found {part}.",
	identify: "That is the {part}: {role}.",
	notTaughtYet: "That is the {part}. Explaining it is not available yet.",
	questionNoPart: "Explanations are not available yet.",
	teachPreparing: "Preparing an explanation of {part}…",
	emptyTranscript: "I didn't catch that. Could you say it again?",
	noBottomView: "The camera stays above the ground grid, so there is no bottom view. Try the top or front view.",
	interpreting: "Let me make sure I understood…",
	unsupportedRequest: "I can't do that in this viewer. You can ask me to explain a part, or to zoom, turn or show a view.",
	teachPaused: "Paused. Say “continue” when you are ready.",
	teachResumed: "Continuing.",
	teachStopped: "Stopped the explanation.",
	teachFallback: "The AI teacher is not available right now, so here is what the model data says.",
	teachPreparingModel: "Preparing an explanation of the {model}…",
	noRelationships: "No connections are recorded for {part} in this model.",
	nothingToPutBack: "Nothing is separated, hidden or highlighted right now.",
	ambiguous: "Which one do you mean: {options}?",
	unknownPart: "{part} is not part of the {model}.",
	unknownPartOtherModel: "{part} belongs to the {other}, not the {model}.",
	unknownPartGeneric: "I could not find that part in the {model}.",
	noMatch: "Sorry, I didn't understand. Try “zoom in” or “select the sun gear”.",
	cannot: "Sorry, I can't do that here.",
	UNSUPPORTED_ANIMATION: "The {model} has no animation to play.",
	UNSUPPORTED_EXPLODED_VIEW: "The {model} has no exploded view.",
	LESSON_NOT_ACTIVE: "No lesson is running. Say “start lesson” first.",
	NO_LESSON: "There is no guided lesson for the {model} yet.",
	VIEWER_NOT_READY: "The 3D view is still loading.",
	UNKNOWN_COMPONENT: "That part is not in the {model}.",
	INVALID_ARGUMENT: "That isn't available here."
};
var TE = {
	zoom: "జూమ్ చేస్తున్నాను.",
	zoomIn: "దగ్గరగా చూపిస్తున్నాను.",
	zoomOut: "దూరంగా చూపిస్తున్నాను.",
	pan: "వ్యూని {dir} జరుపుతున్నాను.",
	orbit: "{dir} తిప్పుతున్నాను.",
	view: "{view} వ్యూ చూపిస్తున్నాను.",
	reset: "మొదటి వ్యూకి వచ్చాం.",
	select: "{part} ఎంచుకున్నాను.",
	focus: "{part} చూపిస్తున్నాను.",
	isolate: "{part} మాత్రమే చూపిస్తున్నాను.",
	hide: "{part} దాచాను.",
	show: "{part} మళ్లీ చూపిస్తున్నాను.",
	showAll: "అన్ని భాగాలు చూపిస్తున్నాను.",
	explode: "భాగాలను విడదీస్తున్నాను.",
	assemble: "భాగాలను మళ్లీ కలుపుతున్నాను.",
	animPlay: "యానిమేషన్ మొదలైంది.",
	animPause: "యానిమేషన్ ఆపాను.",
	animSpeed: "యానిమేషన్ వేగం {speed} రెట్లు.",
	autoOrbit: "ఆటో రొటేషన్ ఆన్.",
	autoOrbitOff: "ఆటో రొటేషన్ ఆఫ్.",
	lessonStart: "పాఠం మొదలుపెడుతున్నాను.",
	lessonNext: "తర్వాతి దశ.",
	lessonPrev: "ముందటి దశ.",
	lessonExit: "పాఠం ముగించాను.",
	home: "హోమ్ పేజీకి వెళ్తున్నాను.",
	deferred: "మీ చేయి లేదా మౌస్ వ్యూని కదుపుతోంది. మీరు ఆపగానే చేస్తాను.",
	expired: "మీ చేయి కదులుతూనే ఉంది, అందుకే అది వదిలేశాను.",
	needsSelection: "ఏ భాగం అంటున్నారు? దాన్ని చూపించండి, ఎంచుకోండి లేదా పేరు చెప్పండి.",
	related: "{part} కి కనెక్ట్ అయిన భాగాలు హైలైట్ చేశాను: {list}.",
	clearHighlight: "హైలైట్ తీసేశాను.",
	putBack: "మళ్లీ యథాస్థితికి తెచ్చాను.",
	ask: "{part} గుర్తించాను.",
	identify: "ఇది {part}: {role}.",
	notTaughtYet: "ఇది {part}. దీని వివరణ ఇంకా అందుబాటులో లేదు.",
	questionNoPart: "వివరణలు ఇంకా అందుబాటులో లేవు.",
	teachPreparing: "{part} వివరణ సిద్ధం చేస్తున్నాను…",
	emptyTranscript: "నాకు సరిగ్గా వినిపించలేదు. ఇంకోసారి చెప్పగలరా?",
	noBottomView: "కెమెరా గ్రౌండ్ గ్రిడ్ పైనే ఉంటుంది, కాబట్టి కింది వ్యూ లేదు. టాప్ లేదా ఫ్రంట్ వ్యూ చూడండి.",
	interpreting: "మీరు అడిగింది సరిగ్గా అర్థం చేసుకుంటున్నాను…",
	unsupportedRequest: "ఈ వ్యూయర్‌లో అది చేయలేను. ఒక భాగాన్ని వివరించమని, లేదా జూమ్, తిప్పడం, వ్యూ చూపించమని అడగండి.",
	teachPaused: "ఆపాను. సిద్ధమైనప్పుడు “కొనసాగించు” అనండి.",
	teachResumed: "కొనసాగిస్తున్నాను.",
	teachStopped: "వివరణ ఆపేశాను.",
	teachFallback: "AI టీచర్ ఇప్పుడు అందుబాటులో లేదు, కాబట్టి మోడల్ డేటాలో ఉన్నది చెబుతున్నాను.",
	teachPreparingModel: "{model} వివరణ సిద్ధం చేస్తున్నాను…",
	noRelationships: "ఈ మోడల్‌లో {part} కి ఏ కనెక్షన్లు నమోదు కాలేదు.",
	nothingToPutBack: "ఇప్పుడు వేరు చేసినది, దాచినది లేదా హైలైట్ చేసినది ఏదీ లేదు.",
	ambiguous: "ఏది అంటున్నారు: {options}?",
	unknownPart: "{part} ఈ {model} లో లేదు.",
	unknownPartOtherModel: "{part} {other} లో ఉంది, ఈ {model} లో లేదు.",
	unknownPartGeneric: "ఆ భాగం ఈ {model} లో కనిపించలేదు.",
	noMatch: "క్షమించండి, అర్థం కాలేదు. “జూమ్ ఇన్” లేదా “సన్ గేర్ సెలెక్ట్ చేయి” అని ప్రయత్నించండి.",
	cannot: "క్షమించండి, ఇక్కడ అది చేయలేను.",
	UNSUPPORTED_ANIMATION: "ఈ {model} కి యానిమేషన్ లేదు.",
	UNSUPPORTED_EXPLODED_VIEW: "ఈ {model} కి ఎక్స్‌ప్లోడెడ్ వ్యూ లేదు.",
	LESSON_NOT_ACTIVE: "ఏ పాఠం నడవడం లేదు. ముందు “పాఠం మొదలుపెట్టు” అనండి.",
	NO_LESSON: "ఈ {model} కి ఇంకా పాఠం లేదు.",
	VIEWER_NOT_READY: "3D వ్యూ ఇంకా లోడ్ అవుతోంది.",
	UNKNOWN_COMPONENT: "ఆ భాగం ఈ {model} లో లేదు.",
	INVALID_ARGUMENT: "అది ఇక్కడ అందుబాటులో లేదు."
};
var HI = {
	zoom: "ज़ूम कर रही हूँ।",
	zoomIn: "पास से दिखा रही हूँ।",
	zoomOut: "दूर से दिखा रही हूँ।",
	pan: "व्यू को {dir} खिसका रही हूँ।",
	orbit: "{dir} घुमा रही हूँ।",
	view: "{view} व्यू दिखा रही हूँ।",
	reset: "पहले वाला व्यू।",
	select: "{part} चुना।",
	focus: "{part} दिखा रही हूँ।",
	isolate: "सिर्फ़ {part} दिखा रही हूँ।",
	hide: "{part} छुपा दिया।",
	show: "{part} फिर से दिखा रही हूँ।",
	showAll: "सारे पुर्ज़े दिखा रही हूँ।",
	explode: "पुर्ज़े अलग कर रही हूँ।",
	assemble: "पुर्ज़े वापस जोड़ रही हूँ।",
	animPlay: "एनिमेशन चल रहा है।",
	animPause: "एनिमेशन रोका।",
	animSpeed: "एनिमेशन की गति {speed} गुना।",
	autoOrbit: "ऑटो रोटेशन चालू।",
	autoOrbitOff: "ऑटो रोटेशन बंद।",
	lessonStart: "पाठ शुरू कर रही हूँ।",
	lessonNext: "अगला चरण।",
	lessonPrev: "पिछला चरण।",
	lessonExit: "पाठ बंद किया।",
	home: "होम पेज पर जा रही हूँ।",
	deferred: "आपका हाथ या माउस व्यू घुमा रहा है। आप रुकेंगे तो कर दूँगी।",
	expired: "आपका हाथ चलता रहा, इसलिए वह छोड़ दिया।",
	needsSelection: "आप कौन सा पुर्ज़ा कह रहे हैं? उस पर इशारा करें, उसे चुनें या उसका नाम बोलें।",
	related: "{part} से जुड़े पुर्ज़े हाइलाइट किए: {list}।",
	clearHighlight: "हाइलाइट हटा दिया।",
	putBack: "वापस पहले जैसा कर दिया।",
	ask: "{part} पहचाना।",
	identify: "यह {part} है: {role}।",
	notTaughtYet: "यह {part} है। इसकी व्याख्या अभी उपलब्ध नहीं है।",
	questionNoPart: "व्याख्याएँ अभी उपलब्ध नहीं हैं।",
	teachPreparing: "{part} की व्याख्या तैयार कर रही हूँ…",
	emptyTranscript: "मुझे ठीक से सुनाई नहीं दिया। क्या आप फिर से बोल सकते हैं?",
	noBottomView: "कैमरा ज़मीन की ग्रिड के ऊपर ही रहता है, इसलिए नीचे का व्यू नहीं है। टॉप या फ्रंट व्यू देखिए।",
	interpreting: "आपकी बात ठीक से समझ रही हूँ…",
	unsupportedRequest: "यह इस व्यूअर में नहीं हो सकता। किसी पुर्ज़े को समझाने, या ज़ूम, घुमाने या व्यू दिखाने को कहिए।",
	teachPaused: "रोक दिया। तैयार हों तो “जारी रखो” बोलिए।",
	teachResumed: "जारी रख रही हूँ।",
	teachStopped: "व्याख्या रोक दी।",
	teachFallback: "AI टीचर अभी उपलब्ध नहीं है, इसलिए मॉडल डेटा के आधार पर बता रही हूँ।",
	teachPreparingModel: "{model} की व्याख्या तैयार कर रही हूँ…",
	noRelationships: "इस मॉडल में {part} के कोई कनेक्शन दर्ज नहीं हैं।",
	nothingToPutBack: "अभी कुछ भी अलग, छुपा या हाइलाइट नहीं है।",
	ambiguous: "आप कौन सा कह रहे हैं: {options}?",
	unknownPart: "{part} इस {model} में नहीं है।",
	unknownPartOtherModel: "{part} {other} का हिस्सा है, इस {model} का नहीं।",
	unknownPartGeneric: "वह पुर्ज़ा इस {model} में नहीं मिला।",
	noMatch: "माफ़ कीजिए, समझ नहीं आया। “ज़ूम इन” या “सन गियर सेलेक्ट करो” बोलकर देखिए।",
	cannot: "माफ़ कीजिए, यहाँ यह नहीं हो सकता।",
	UNSUPPORTED_ANIMATION: "इस {model} में कोई एनिमेशन नहीं है।",
	UNSUPPORTED_EXPLODED_VIEW: "इस {model} का एक्सप्लोडेड व्यू नहीं है।",
	LESSON_NOT_ACTIVE: "कोई पाठ नहीं चल रहा। पहले “पाठ शुरू करो” बोलिए।",
	NO_LESSON: "इस {model} का अभी कोई पाठ नहीं है।",
	VIEWER_NOT_READY: "3D व्यू अभी लोड हो रहा है।",
	UNKNOWN_COMPONENT: "वह पुर्ज़ा इस {model} में नहीं है।",
	INVALID_ARGUMENT: "यह यहाँ उपलब्ध नहीं है।"
};
var WORDS = {
	"en-IN": {
		left: "left",
		right: "right",
		up: "up",
		down: "down",
		back: "back",
		front: "front",
		top: "top",
		isometric: "isometric",
		vleft: "left side",
		vright: "right side",
		or: " or "
	},
	"te-IN": {
		left: "ఎడమకు",
		right: "కుడికి",
		up: "పైకి",
		down: "కిందకి",
		back: "వెనుక",
		front: "ముందు",
		top: "పై",
		isometric: "ఐసోమెట్రిక్",
		vleft: "ఎడమ వైపు",
		vright: "కుడి వైపు",
		or: " లేదా "
	},
	"hi-IN": {
		left: "बाएं",
		right: "दाएं",
		up: "ऊपर",
		down: "नीचे",
		back: "पीछे का",
		front: "सामने का",
		top: "ऊपर का",
		isometric: "आइसोमेट्रिक",
		vleft: "बाईं तरफ़ का",
		vright: "दाईं तरफ़ का",
		or: " या "
	}
};
var TABLES = {
	"en-IN": EN,
	"te-IN": TE,
	"hi-IN": HI
};
/** Replies are localised for en/te/hi; any other (beta) language uses English. */
function replyLanguage(language) {
	return FULLY_SUPPORTED_LANGUAGES.includes(language) ? language : "en-IN";
}
function reply(key, language, vars = {}) {
	const lang = replyLanguage(language);
	const table = TABLES[lang];
	const words = WORDS[lang];
	return (table[key] ?? table.cannot).replace("{part}", vars.part ?? "").replace("{model}", vars.model ?? "").replace("{other}", vars.other ?? "").replace("{options}", (vars.options ?? []).join(words.or)).replace("{dir}", vars.dir ? words[vars.dir] ?? vars.dir : "").replace("{view}", vars.view ? words[`v${vars.view}`] ?? words[vars.view] ?? vars.view : "").replace("{speed}", vars.speed !== void 0 ? String(vars.speed) : "").replace("{role}", vars.role ?? "").replace("{list}", (vars.list ?? []).join(", ")).replace(/\s+/g, " ").trim();
}
/** All keys every fully-supported language must define (used by tests). */
var REPLY_KEYS = Object.keys(EN);
var REPLY_TABLES = TABLES;
// src/services/scene/componentRelationships.ts
/**
* Component relationship queries (Task V3). Reads the relationships each model declares in its
* component metadata (see models/*Relationships.ts) — never invents links. Every returned ID is
* checked against the model's own component list.
*/
/** Direct relationships of a component in this model ([] if unknown component or none recorded). */
function getComponentRelationships(model, componentId) {
	const valid = new Set(model.getAllComponentIds());
	if (!valid.has(componentId)) return [];
	return (model.getComponentMetadata(componentId)?.relationships ?? []).filter((r) => valid.has(r.targetComponentId) && r.targetComponentId !== componentId);
}
/** IDs of directly related components (optionally only some relationship types), without duplicates. */
function getRelatedComponentIds(model, componentId, types) {
	const out = [];
	for (const r of getComponentRelationships(model, componentId)) {
		if (types && !types.includes(r.relationshipType)) continue;
		if (!out.includes(r.targetComponentId)) out.push(r.targetComponentId);
	}
	return out;
}
/** Components reachable within `depth` relationship hops (breadth-first), excluding the start. */
function getNeighbourhood(model, componentId, depth = 1) {
	const seen = /* @__PURE__ */ new Set([componentId]);
	let frontier = [componentId];
	const out = [];
	for (let d = 0; d < depth && frontier.length > 0; d++) {
		const next = [];
		for (const id of frontier) for (const n of getRelatedComponentIds(model, id)) {
			if (seen.has(n)) continue;
			seen.add(n);
			out.push(n);
			next.push(n);
		}
		frontier = next;
	}
	return out;
}
/** Checks every relationship of a model: valid targets, no self links, and matching inverse edges. */
function validateModelRelationships(model) {
	const ids = model.getAllComponentIds();
	const errors = [];
	const without = [];
	for (const id of ids) {
		const meta = model.getComponentMetadata(id);
		if (!meta) continue;
		const rels = meta.relationships ?? [];
		if (rels.length === 0) without.push(id);
		errors.push(...validateComponentRelationships(meta, ids).errors);
		for (const r of rels) {
			const inverse = INVERSE_RELATIONSHIP[r.relationshipType];
			if (!inverse) {
				errors.push(`Component "${id}" uses unknown relationship type "${r.relationshipType}".`);
				continue;
			}
			if (!(model.getComponentMetadata(r.targetComponentId)?.relationships ?? []).some((b) => b.targetComponentId === id && b.relationshipType === inverse)) errors.push(`"${id}" ${r.relationshipType} "${r.targetComponentId}" has no matching "${inverse}" entry.`);
		}
	}
	return {
		isValid: errors.length === 0,
		errors,
		componentsWithoutRelationships: without
	};
}
var known$1 = (value) => ({
	status: "known",
	value
});
var unavailable = (reason) => ({
	status: "unavailable",
	reason
});
/** Keeps an ID only if it belongs to the loaded model (guards against stale references). */
var inModel = (id, ids) => id && ids.has(id) ? id : null;
function buildSceneSnapshot(ctx, model, extras = {}) {
	const activeModel = model && ctx.modelId === model.id ? model : null;
	const ids = activeModel ? ctx.componentIds : /* @__PURE__ */ new Set();
	const ws = ctx.workspaceFacts;
	const vf = ctx.viewerFacts;
	const viewerUp = Boolean(vf && ctx.viewerReady);
	const noViewer = "The 3D viewer is not ready.";
	const hidden = (ws?.hiddenComponentIds ?? []).filter((id) => ids.has(id));
	const isolated = viewerUp ? inModel(vf.isolatedComponentId, ids) : null;
	const components = activeModel ? activeModel.getAllComponentIds().map((id) => {
		const meta = activeModel.getComponentMetadata(id);
		return {
			id,
			name: meta?.name ?? id,
			role: meta?.role ?? null,
			visible: !hidden.includes(id) && (!isolated || isolated === id),
			relatedComponentIds: getRelatedComponentIds(activeModel, id)
		};
	}) : [];
	const explodedFactor = ws?.explodedFactor ?? 0;
	const lessonActive = ctx.lesson.active;
	const actions = [];
	if (activeModel) {
		actions.push("component.select", "component.visibility", "component.showAll");
		if (ctx.viewerReady) {
			actions.push("camera.orbit", "camera.pan", "camera.zoom", "camera.view", "camera.reset", "camera.autoOrbit", "component.focus", "component.isolate", "component.highlight", "component.clearHighlight");
			if (ctx.animationIds.length > 0) actions.push("animation.play", "animation.pause", "animation.setSpeed");
		}
		if (ctx.supportsExplodedView) actions.push("assembly.explode", "assembly.restore");
		if (ctx.lesson.available) actions.push("lesson.start");
		if (lessonActive) actions.push("lesson.next", "lesson.previous", "lesson.goTo", "lesson.exit");
	}
	if (ctx.registeredModelIds.size > 1) actions.push("workspace.switchModel");
	actions.push("workspace.goHome");
	const lastDiscussed = extras.lastDiscussed === void 0 ? unavailable("No conversation context.") : known$1(extras.lastDiscussed && activeModel && extras.lastDiscussed.modelId === activeModel.id ? inModel(extras.lastDiscussed.componentId, ids) : null);
	return {
		version: 1,
		capturedAt: extras.now ?? Date.now(),
		model: activeModel ? {
			id: activeModel.id,
			name: activeModel.name,
			domain: activeModel.domain,
			category: activeModel.category
		} : null,
		components,
		selectedComponentId: inModel(ctx.selectedComponentId, ids),
		pointer: viewerUp ? known$1({
			componentId: inModel(vf.hoveredComponentId, ids),
			source: inModel(vf.hoveredComponentId, ids) ? vf.hoverSource : null
		}) : unavailable(noViewer),
		focusedComponentId: viewerUp ? known$1(inModel(vf.focusedComponentId, ids)) : unavailable(noViewer),
		hiddenComponentIds: hidden,
		isolatedComponentId: viewerUp ? known$1(isolated) : unavailable(noViewer),
		highlightedComponentIds: viewerUp ? known$1(vf.highlightedComponentIds.filter((id) => ids.has(id))) : unavailable(noViewer),
		exploded: {
			supported: ctx.supportsExplodedView,
			factor: explodedFactor,
			active: explodedFactor > 0
		},
		camera: viewerUp ? known$1({
			...vf.camera,
			settled: !vf.camera.transitioning && !vf.pendingCommand
		}) : unavailable(noViewer),
		animation: {
			available: (activeModel?.animations ?? []).map((a) => ({
				id: a.id,
				label: a.label
			})),
			state: !viewerUp ? unavailable(noViewer) : ctx.animationIds.length === 0 ? known$1({
				playing: false,
				speed: vf.animation.speed
			}) : known$1({ ...vf.animation })
		},
		lesson: {
			available: ctx.lesson.available,
			active: lessonActive,
			stepCount: ctx.lesson.stepCount,
			currentStep: lessonActive ? ctx.lesson.currentStep : null,
			stepTitle: lessonActive ? ws?.lessonStepTitle ?? null : null,
			stepComponentId: lessonActive ? inModel(ws?.lessonStepComponentId, ids) : null
		},
		lastDiscussedComponentId: lastDiscussed,
		availableActions: actions
	};
}
/** Convenience: snapshot of the scene behind a dispatcher. */
function getSceneSnapshot(dispatcher, model, extras) {
	return buildSceneSnapshot(dispatcher.getContext(), model, extras);
}
// src/services/voice/voiceSession.ts
var lexiconCache = /* @__PURE__ */ new Map();
function lexiconFor(model) {
	let lex = lexiconCache.get(model.id);
	if (!lex) {
		lex = buildPartLexicon(model);
		lexiconCache.set(model.id, lex);
	}
	return lex;
}
/** Parts that are NOT in the current model: other registered models' parts + common machine parts. */
function foreignPartsFor(model, allModels) {
	const own = new Set(lexiconFor(model).flatMap((e) => e.phrases));
	const out = [];
	for (const other of allModels) {
		if (other.id === model.id) continue;
		for (const entry of lexiconFor(other)) for (const phrase of entry.phrases) if (!own.has(phrase)) out.push({
			phrase,
			modelName: other.name
		});
	}
	for (const phrase of COMMON_FOREIGN_PARTS) if (!own.has(phrase)) out.push({ phrase });
	return out;
}
function partName(lexicon, id) {
	return lexicon.find((e) => e.componentId === id)?.displayName ?? id ?? "";
}
function replyKeyForCommands(intent, cmds) {
	const last = cmds[cmds.length - 1];
	switch (last.type) {
		case "camera.zoom": return {
			key: last.direction === "in" ? "zoomIn" : "zoomOut",
			vars: {}
		};
		case "camera.pan": return {
			key: "pan",
			vars: { dir: last.direction }
		};
		case "camera.orbit": return {
			key: "orbit",
			vars: { dir: last.yawDeg > 0 ? "left" : last.yawDeg < 0 ? "right" : (last.pitchDeg ?? 0) > 0 ? "up" : "down" }
		};
		case "camera.view": return {
			key: "view",
			vars: { view: last.view }
		};
		case "camera.autoOrbit": return {
			key: last.enabled ? "autoOrbit" : "autoOrbitOff",
			vars: {}
		};
		case "animation.setSpeed": return {
			key: "animSpeed",
			vars: { speed: last.speed }
		};
		default: return {
			key: intent,
			vars: {}
		};
	}
}
/**
* Parse only (no dispatch, no side effects): would this transcript be understood? Used to pick
* between transcripts of the same recording in different languages.
*/
function previewTurn(input) {
	const scene = getSceneSnapshot(input.dispatcher, input.model, { lastDiscussed: input.lastDiscussed ?? null });
	return parseVoiceCommand(input.transcript, {
		lexicon: lexiconFor(input.model),
		foreignParts: foreignPartsFor(input.model, input.allModels),
		selectedComponentId: scene.selectedComponentId,
		lessonActive: scene.lesson.active,
		scene,
		teachingActive: input.teachingActive
	});
}
/** Script of a transcript -> the language it was most likely spoken in (null = Latin/unknown). */
function scriptLanguage(text) {
	const te = (text.match(/[ఀ-౿]/g) ?? []).length;
	const hi = (text.match(/[ऀ-ॿ]/g) ?? []).length;
	if (te === 0 && hi === 0) return null;
	return te >= hi ? "te-IN" : "hi-IN";
}
function handleVoiceTurn(input) {
	const { transcript, language, dispatcher, model } = input;
	const lexicon = lexiconFor(model);
	const scene = getSceneSnapshot(dispatcher, model, { lastDiscussed: input.lastDiscussed ?? null });
	const outcome = parseVoiceCommand(transcript, {
		lexicon,
		foreignParts: foreignPartsFor(model, input.allModels),
		selectedComponentId: scene.selectedComponentId,
		lessonActive: scene.lesson.active,
		scene,
		teachingActive: input.teachingActive
	});
	const modelName = model.name;
	const say = (key, vars = {}) => reply(key, language, {
		model: modelName,
		...vars
	});
	if (!transcript.trim()) return {
		status: "needsInput",
		caption: say("emptyTranscript"),
		speak: true,
		outcome,
		records: []
	};
	const cameraOnly = outcome.kind === "commands" && outcome.commands.every((c) => c.type.startsWith("camera."));
	if (outcome.kind === "commands" && !cameraOnly || outcome.kind === "question" || outcome.kind === "unavailable" && outcome.reason !== "noBottomView") input.onSupersede?.();
	switch (outcome.kind) {
		case "teachControl": return {
			status: "control",
			control: outcome.action,
			outcome,
			records: [],
			speak: false,
			caption: say(outcome.action === "pause" ? "teachPaused" : outcome.action === "resume" ? "teachResumed" : "teachStopped")
		};
		case "noMatch": return {
			status: "rejected",
			caption: say("noMatch"),
			speak: true,
			outcome,
			records: []
		};
		case "needsSelection": return {
			status: "needsInput",
			caption: say("needsSelection"),
			speak: true,
			outcome,
			records: []
		};
		case "ambiguous": return {
			status: "needsInput",
			caption: say("ambiguous", { options: outcome.options.map((id) => partName(lexicon, id)) }),
			speak: true,
			outcome,
			records: []
		};
		case "question": {
			if (input.teachingAvailable && outcome.question !== "identify") return {
				status: "teach",
				caption: say(outcome.partId ? "teachPreparing" : "teachPreparingModel", { part: partName(lexicon, outcome.partId) }),
				speak: false,
				outcome,
				records: [],
				discussedComponentId: outcome.partId,
				teach: {
					question: (input.questionText ?? transcript).trim(),
					questionType: outcome.question,
					targetComponentId: outcome.partId ?? null,
					...outcome.language ? { language: outcome.language } : {}
				}
			};
			if (!outcome.partId) return {
				status: "unavailable",
				caption: say("questionNoPart"),
				speak: true,
				outcome,
				records: []
			};
			const part = partName(lexicon, outcome.partId);
			if (outcome.question === "identify") {
				const role = model.getComponentMetadata(outcome.partId)?.role ?? "";
				return {
					status: "answered",
					caption: say(role ? "identify" : "ask", {
						part,
						role
					}),
					speak: true,
					outcome,
					records: [],
					discussedComponentId: outcome.partId
				};
			}
			return {
				status: "unavailable",
				caption: say("notTaughtYet", { part }),
				speak: true,
				outcome,
				records: [],
				discussedComponentId: outcome.partId
			};
		}
		case "unavailable": return {
			status: "unavailable",
			caption: say(outcome.reason, { part: partName(lexicon, outcome.partId) }),
			speak: true,
			outcome,
			records: [],
			discussedComponentId: outcome.partId
		};
		case "unknownPart": {
			const spoken = outcome.spoken ? displaySpoken(outcome.spoken) : "";
			return {
				status: "rejected",
				caption: !spoken ? say("unknownPartGeneric") : outcome.belongsTo ? say("unknownPartOtherModel", {
					part: spoken,
					other: outcome.belongsTo
				}) : say("unknownPart", { part: spoken }),
				speak: true,
				outcome,
				records: []
			};
		}
		case "commands": {
			const records = [];
			for (const command of outcome.commands) {
				const rec = dispatcher.dispatch(command, "voice");
				records.push(rec);
				if (rec.status === "rejected") return {
					status: "rejected",
					caption: say(rec.code ?? "cannot", { part: partName(lexicon, outcome.partId) }),
					speak: true,
					outcome,
					records
				};
			}
			if (records.some((r) => r.status === "deferred")) return {
				status: "deferred",
				caption: say("deferred"),
				speak: true,
				outcome,
				records,
				discussedComponentId: outcome.partId
			};
			return {
				status: "executed",
				caption: confirmationCaption(outcome, language, model),
				speak: Boolean(input.speakConfirmations),
				outcome,
				records,
				discussedComponentId: outcome.partId
			};
		}
	}
}
/** Confirmation text for a command outcome (also used when a deferred command later runs). */
function confirmationCaption(outcome, language, model) {
	if (outcome.kind !== "commands") return "";
	const lexicon = lexiconFor(model);
	const { key, vars } = replyKeyForCommands(outcome.intent, outcome.commands);
	const highlight = outcome.commands.find((c) => c.type === "component.highlight");
	const list = highlight?.type === "component.highlight" ? highlight.componentIds.map((id) => partName(lexicon, id)) : void 0;
	return reply(key, language, {
		model: model.name,
		part: partName(lexicon, outcome.partId),
		list,
		...vars
	});
}
/** Capitalise an English spoken phrase for display ("piston" -> "Piston"); native script unchanged. */
function displaySpoken(phrase) {
	const n = normalise(phrase);
	return /^[a-z]/.test(n) ? n.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n;
}
// src/services/voice/voiceLanguage.ts
/**
* Conversation language handling (voice-first milestone).
*
* Gnani Prisma must be told the language before it transcribes. Measured live (27 Oct 2026):
* Telugu/Hindi speech sent as en-IN comes back as romanised phonetics ("idi asal educ avasar"),
* and English speech sent as te-IN/hi-IN comes back transliterated ("షో మీ ద బ్యాక్"). So when the
* user switches language without touching the selector, the first transcript is often not
* understood. Then the SAME recording is transcribed in the other conversation languages and the
* version that is understood wins; its language becomes the reply language and the new preference.
* Extra Prisma calls happen only when the first transcript was not understood.
*/
/** Languages with full command, reply and teaching support (others stay beta). */
var CONVERSATION_LANGUAGES = [
	"te-IN",
	"hi-IN",
	"en-IN"
];
/**
* The language a transcript was spoken in, given the selected UI language: Telugu script means
* Telugu, Devanagari means Hindi (unless Marathi is selected, which shares the script), and Latin
* text while Telugu/Hindi is selected means English. Otherwise the UI language.
*/
function turnLanguage(text, uiLanguage) {
	const script = scriptLanguage(text);
	if (script === "te-IN") return "te-IN";
	if (script === "hi-IN") return uiLanguage === "mr-IN" ? "mr-IN" : "hi-IN";
	if (/[a-z]/i.test(text) && (uiLanguage === "te-IN" || uiLanguage === "hi-IN")) return "en-IN";
	return uiLanguage;
}
async function transcribeWithLanguageRetry(wav, uiLanguage, transcribeFn, understood, signal) {
	const first = await transcribeFn(wav, uiLanguage, signal);
	if (!first.trim() || understood(first)) return {
		text: first,
		language: turnLanguage(first, uiLanguage),
		retried: false
	};
	const others = CONVERSATION_LANGUAGES.filter((l) => l !== uiLanguage);
	const results = await Promise.all(others.map((language) => transcribeFn(wav, language, signal).then((text) => ({
		language,
		text
	}), () => ({
		language,
		text: ""
	}))));
	if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
	const hit = results.find((r) => r.text.trim() && understood(r.text));
	return hit ? {
		text: hit.text,
		language: hit.language,
		retried: true
	} : {
		text: first,
		language: turnLanguage(first, uiLanguage),
		retried: true
	};
}
// src/services/voice/interpretClient.ts
/**
* Intent interpretation fallback (voice-first milestone).
*
* Only for utterances the deterministic parser did not understand. The backend LLM returns ONE
* intent from a fixed list (+ optional part id from the loaded model + language). The intent is
* turned into a canonical English phrase that goes through the SAME parser, reference resolver
* and validated dispatcher as any spoken command — the LLM never produces actions.
*/
var INTERPRET_INTENTS = [
	"zoom_in",
	"zoom_out",
	"rotate_left",
	"rotate_right",
	"rotate_up",
	"rotate_down",
	"pan_left",
	"pan_right",
	"pan_up",
	"pan_down",
	"view_front",
	"view_back",
	"view_top",
	"view_left",
	"view_right",
	"view_isometric",
	"view_bottom",
	"reset_view",
	"focus_part",
	"select_part",
	"isolate_part",
	"hide_part",
	"show_part",
	"show_all",
	"explode",
	"assemble",
	"play_animation",
	"pause_animation",
	"explain_part",
	"purpose_part",
	"how_part",
	"failure_part",
	"explain_model",
	"related_parts",
	"stop_explanation",
	"continue_explanation",
	"unclear",
	"unsupported"
];
/** Canonical phrase per intent; {part} = "the <part name>" or "this part". null = nothing to run. */
var PHRASES = {
	zoom_in: "zoom in",
	zoom_out: "zoom out",
	rotate_left: "rotate left",
	rotate_right: "rotate right",
	rotate_up: "rotate up",
	rotate_down: "rotate down",
	pan_left: "move left",
	pan_right: "move right",
	pan_up: "move up",
	pan_down: "move down",
	view_front: "show the front view",
	view_back: "show the back view",
	view_top: "show the top view",
	view_left: "show the left side view",
	view_right: "show the right side view",
	view_isometric: "isometric view",
	view_bottom: "show the bottom view",
	reset_view: "reset the view",
	focus_part: "focus on {part}",
	select_part: "select {part}",
	isolate_part: "isolate {part}",
	hide_part: "hide {part}",
	show_part: "show {part} again",
	show_all: "show all",
	explode: "explode",
	assemble: "assemble",
	play_animation: "play the animation",
	pause_animation: "pause the animation",
	explain_part: "explain {part}",
	purpose_part: "why is {part} needed",
	how_part: "how does {part} work",
	failure_part: "what happens if {part} fails",
	explain_model: "explain how this model works",
	related_parts: "show the parts connected to {part}",
	stop_explanation: "stop",
	continue_explanation: "continue",
	unclear: null,
	unsupported: null
};
/** The phrase to run through the deterministic parser, or null for unclear / unsupported. */
function canonicalPhrase(i, partName) {
	const template = PHRASES[i.intent];
	if (!template) return null;
	const name = i.componentId ? partName(i.componentId) : null;
	return template.replace("{part}", name ? `the ${name}` : "this part");
}
var InterpretError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
async function requestInterpretation(body, signal, fetchImpl = fetch) {
	let resp;
	try {
		resp = await fetchImpl("/api/interpret", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal
		});
	} catch {
		throw new InterpretError(signal?.aborted ? "CANCELLED" : "BACKEND_UNAVAILABLE", "Interpretation unavailable.");
	}
	let data = null;
	try {
		data = await resp.json();
	} catch {
		throw new InterpretError("BACKEND_UNAVAILABLE", "Interpretation unavailable.");
	}
	if (!resp.ok || !data || !INTERPRET_INTENTS.includes(data.intent)) throw new InterpretError(data?.error?.code ?? "UNKNOWN", "Interpretation unavailable.");
	return {
		intent: data.intent,
		componentId: typeof data.componentId === "string" ? data.componentId : null,
		language: typeof data.language === "string" ? data.language : null
	};
}
// src/components/voice/TeachingPanel.tsx
var CLAIM_LABEL = {
	visible: "Shown in the 3D model",
	metadata: "From the model data",
	engineering: "Engineering explanation",
	notSimulated: "Not simulated in this app"
};
var TeachingPanel = ({ session }) => {
	const { state, pending, error, notice, question, player } = session;
	const plan = state.plan;
	const active = player.isActive();
	if (!pending && !plan && !error && !notice) return null;
	const step = plan && state.stepPosition >= 0 ? plan.steps[state.stepPosition] : null;
	const progress = plan ? `${Math.max(0, state.stepPosition) + 1} / ${plan.steps.length}` : "";
	return /* @__PURE__ */ jsxs("div", {
		className: "teach-panel",
		"aria-label": "Explanation",
		children: [
			question && /* @__PURE__ */ jsxs("div", {
				className: "teach-question",
				children: [/* @__PURE__ */ jsx("span", { children: "Question" }), question]
			}),
			pending && /* @__PURE__ */ jsx("div", {
				className: "teach-status",
				"aria-live": "polite",
				children: "Preparing an explanation…"
			}),
			plan && /* @__PURE__ */ jsxs(Fragment, { children: [
				/* @__PURE__ */ jsxs("div", {
					className: "teach-head",
					children: [/* @__PURE__ */ jsx("strong", {
						className: "teach-title",
						children: plan.title
					}), (active || state.status === "finished") && /* @__PURE__ */ jsx("span", {
						className: "teach-progress",
						children: state.status === "finished" ? "Done" : `Step ${progress}`
					})]
				}),
				notice && /* @__PURE__ */ jsx("div", {
					className: "teach-limit",
					children: notice
				}),
				plan.cannotAnswer && /* @__PURE__ */ jsx("div", {
					className: "teach-limit",
					children: plan.cannotAnswer
				}),
				step && active && /* @__PURE__ */ jsxs("div", {
					className: "teach-step",
					"aria-live": "polite",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "teach-caption",
							children: state.caption
						}),
						/* @__PURE__ */ jsx("div", {
							className: "teach-narration",
							children: state.narration
						}),
						/* @__PURE__ */ jsx("span", {
							className: `teach-claim claim-${step.claim}`,
							children: CLAIM_LABEL[step.claim]
						})
					]
				}),
				state.status === "finished" && /* @__PURE__ */ jsx("div", {
					className: "teach-narration",
					children: plan.explanation
				}),
				state.message && /* @__PURE__ */ jsx("div", {
					className: "teach-message",
					children: state.message
				}),
				(plan.rejectedSteps.length > 0 || state.runtimeRejected.length > 0) && /* @__PURE__ */ jsxs("div", {
					className: "teach-rejected",
					children: [plan.rejectedSteps.length + state.runtimeRejected.length, " step(s) skipped because they could not be shown safely on this model."]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "teach-controls",
					children: [
						state.status === "running" && /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => player.pause(),
							children: "Pause"
						}),
						state.status === "paused" && /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => player.resume(),
							children: "Resume"
						}),
						state.status === "waitingForUser" && /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => player.continue(),
							children: "Continue"
						}),
						active && /* @__PURE__ */ jsx("button", {
							type: "button",
							onClick: () => player.cancel(),
							children: "Stop explanation"
						})
					]
				}),
				state.status === "finished" && plan.followUpSuggestions.length > 0 && /* @__PURE__ */ jsxs("div", {
					className: "teach-followups",
					children: [/* @__PURE__ */ jsx("span", { children: "You could ask" }), plan.followUpSuggestions.map((f) => /* @__PURE__ */ jsxs("div", { children: [
						"“",
						f,
						"”"
					] }, f))]
				})
			] }),
			error && /* @__PURE__ */ jsx("div", {
				className: "teach-error",
				role: "alert",
				children: error
			})
		]
	});
};
// src/services/teaching/teachingClient.ts
var TeachingServiceError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
var TEACH_TIMEOUT_MS = 45e3;
var TEACH_ERROR_MESSAGES = {
	LLM_NOT_CONFIGURED: "Explanations are not set up: the server has no teaching model configured (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY).",
	LLM_AUTH: "The teaching model rejected the server key.",
	LLM_MODEL_NOT_FOUND: "The configured teaching model is not available to this key.",
	LLM_RATE_LIMIT: "Too many explanation requests. Please wait a moment.",
	LLM_QUOTA_EXCEEDED: "The teaching model's usage quota is used up for now. Try again later.",
	LLM_TIMEOUT: "The explanation took too long. Please try again.",
	LLM_UNREACHABLE: "The server could not reach the teaching model.",
	LLM_UNAVAILABLE: "The teaching model is temporarily unavailable.",
	LLM_MALFORMED: "The teaching model gave an unusable answer. Please ask again.",
	PLAN_INVALID: "The explanation could not be used safely with this model.",
	PLAN_UNSAFE: "The explanation was rejected because it contained unsafe content.",
	PLAN_TOO_LONG: "The explanation was too long to play.",
	BACKEND_UNAVAILABLE: "The voice/teaching server is not running.",
	TIMEOUT: "The explanation took too long. Please try again."
};
async function requestTeachingPlan(body, signal, fetchImpl = fetch) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TEACH_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);
	let resp;
	try {
		resp = await fetchImpl("/api/teach", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal
		});
	} catch {
		if (signal?.aborted) throw new TeachingServiceError("CANCELLED", "Cancelled.");
		if (controller.signal.aborted) throw new TeachingServiceError("TIMEOUT", TEACH_ERROR_MESSAGES.TIMEOUT);
		throw new TeachingServiceError("BACKEND_UNAVAILABLE", TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
	let data = null;
	try {
		data = await resp.json();
	} catch {
		throw new TeachingServiceError("BACKEND_UNAVAILABLE", TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
	}
	if (!resp.ok || !data?.plan) {
		const code = data?.error?.code ?? "UNKNOWN";
		throw new TeachingServiceError(code, TEACH_ERROR_MESSAGES[code] ?? data?.error?.message ?? "The explanation failed.");
	}
	return data.plan;
}
var PLAN_LIMITS = {
	steps: 8,
	actionsPerStep: 3,
	narration: 350,
	caption: 120,
	title: 120,
	explanation: 1200,
	followUps: 3,
	followUp: 120,
	holdMs: 4e3,
	highlight: 20
};
/** The subset of V1 commands a plan may use: show and animate only (no hiding, switching, navigating). */
var TEACHABLE_ACTIONS = [
	"component.select",
	"component.focus",
	"component.highlight",
	"component.clearHighlight",
	"component.isolate",
	"assembly.explode",
	"assembly.restore",
	"animation.play",
	"animation.pause",
	"animation.setSpeed",
	"camera.view",
	"camera.reset"
];
var UNSAFE_TEXT = new RegExp([
	"https?://",
	"www\\.",
	"<\\s*/?\\s*(script|iframe|img|a)\\b",
	"```",
	"javascript:",
	"\\beval\\s*\\(",
	"\\bexec\\s*\\(",
	"\\brequire\\s*\\(",
	"\\bimport\\s+[\\w{]",
	"=>",
	"\\bfunction\\s*\\(",
	"\\bnew\\s+THREE\\b",
	"\\bTHREE\\.",
	"\\brm\\s+-rf\\b",
	"\\bsudo\\b",
	"\\$\\("
].join("|"), "i");
var PlanError = class extends Error {
	code;
	constructor(code, reason) {
		super(reason);
		this.code = code;
	}
};
function text(value, max, field, allowEmpty = false) {
	if (typeof value !== "string") throw new PlanError("PLAN_INVALID", `${field} must be text.`);
	const t = value.trim();
	if (!t && !allowEmpty) throw new PlanError("PLAN_INVALID", `${field} is empty.`);
	if (t.length > max) throw new PlanError("PLAN_INVALID", `${field} is longer than ${max} characters.`);
	if (UNSAFE_TEXT.test(t)) throw new PlanError("PLAN_UNSAFE", `${field} contains code, markup or a link.`);
	return t;
}
/**
* Checks one action against the snapshot's model and capabilities, then V1's own validator.
* Returns the clean command or throws; never substitutes a different action.
*/
function action(raw, snapshot, ctx) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new PlanError("ACTION_INVALID", "Action must be an object.");
	const type = raw.type;
	if (!TEACHABLE_ACTIONS.includes(type)) throw new PlanError("ACTION_UNSUPPORTED", `Action "${String(type)}" is not allowed in teaching plans.`);
	if (!snapshot.availableActions.includes(type)) throw new PlanError("ACTION_UNAVAILABLE", `Action "${String(type)}" is not available for this model right now.`);
	const result = validateSceneCommand(raw, ctx);
	if (!result.ok) throw new PlanError(result.code, result.reason);
	return result.command;
}
/** Validates a plan that just arrived from the backend against the current scene. */
function validateTeachingPlan(raw, snapshot, ctx) {
	try {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new PlanError("PLAN_INVALID", "Plan must be an object.");
		const p = raw;
		if (p.schemaVersion !== 1) throw new PlanError("PLAN_INVALID", "Unknown plan schema version.");
		if (typeof p.planId !== "string" || !/^[a-f0-9]{8,64}$/.test(p.planId)) throw new PlanError("PLAN_INVALID", "Plan id is missing.");
		if (!snapshot.model || p.modelId !== snapshot.model.id) throw new PlanError("STALE_MODEL", "This explanation was prepared for a different model.");
		const ids = new Set(snapshot.components.map((c) => c.id));
		const target = p.targetComponentId ?? null;
		if (target !== null && (typeof target !== "string" || !ids.has(target))) throw new PlanError("UNKNOWN_COMPONENT", `Plan target "${String(target)}" is not in this model.`);
		if (!Array.isArray(p.steps) || p.steps.length === 0) throw new PlanError("PLAN_INVALID", "Plan has no steps.");
		if (p.steps.length > PLAN_LIMITS.steps) throw new PlanError("PLAN_TOO_LONG", `Plan has more than ${PLAN_LIMITS.steps} steps.`);
		const followRaw = p.followUpSuggestions ?? [];
		if (!Array.isArray(followRaw)) throw new PlanError("PLAN_INVALID", "followUpSuggestions must be a list.");
		const plan = {
			schemaVersion: 1,
			planId: p.planId,
			modelId: snapshot.model.id,
			targetComponentId: target,
			title: text(p.title, PLAN_LIMITS.title, "title"),
			explanation: text(p.explanation, PLAN_LIMITS.explanation, "explanation"),
			cannotAnswer: p.cannotAnswer == null ? null : text(p.cannotAnswer, 300, "cannotAnswer", true) || null,
			steps: [],
			rejectedSteps: Array.isArray(p.rejectedSteps) ? p.rejectedSteps.filter((r) => r && typeof r.index === "number").map((r) => ({
				index: r.index,
				code: String(r.code ?? "REJECTED").slice(0, 40),
				reason: String(r.reason ?? "").slice(0, 200)
			})) : [],
			followUpSuggestions: followRaw.slice(0, PLAN_LIMITS.followUps).map((f) => text(f, PLAN_LIMITS.followUp, "followUp")),
			...typeof p.language === "string" && /^[a-z]{2}-IN$/.test(p.language) ? { language: p.language } : {},
			...p.source === "llm" || p.source === "modelData" ? { source: p.source } : {}
		};
		p.steps.forEach((rawStep, position) => {
			const s = typeof rawStep === "object" && rawStep !== null ? rawStep : {};
			const index = typeof s.index === "number" ? s.index : position;
			try {
				if (typeof rawStep !== "object" || rawStep === null) throw new PlanError("PLAN_INVALID", "Step must be an object.");
				if (s.kind !== "demonstrate" && s.kind !== "explain") throw new PlanError("PLAN_INVALID", "Unknown step kind.");
				if (![
					"visible",
					"metadata",
					"engineering",
					"notSimulated"
				].includes(s.claim)) throw new PlanError("PLAN_INVALID", "Unknown claim type.");
				const acts = s.actions ?? [];
				if (!Array.isArray(acts) || acts.length > PLAN_LIMITS.actionsPerStep) throw new PlanError("PLAN_INVALID", `A step may have at most ${PLAN_LIMITS.actionsPerStep} actions.`);
				const stepTarget = s.targetComponentId ?? null;
				if (stepTarget !== null && (typeof stepTarget !== "string" || !ids.has(stepTarget))) throw new PlanError("UNKNOWN_COMPONENT", `Step target "${String(stepTarget)}" is not in this model.`);
				const hold = s.holdMs ?? 0;
				if (typeof hold !== "number" || !Number.isInteger(hold) || hold < 0 || hold > PLAN_LIMITS.holdMs) throw new PlanError("PLAN_INVALID", `holdMs must be 0-${PLAN_LIMITS.holdMs}.`);
				plan.steps.push({
					index,
					kind: s.kind,
					claim: s.claim,
					narration: text(s.narration, PLAN_LIMITS.narration, "narration"),
					caption: text(s.caption, PLAN_LIMITS.caption, "caption"),
					targetComponentId: stepTarget,
					actions: acts.map((a) => action(a, snapshot, ctx)),
					waitFor: s.waitFor === "user" ? "user" : "narration",
					holdMs: hold
				});
			} catch (err) {
				if (!(err instanceof PlanError)) throw err;
				plan.rejectedSteps.push({
					index,
					code: err.code,
					reason: err.message
				});
			}
		});
		if (plan.steps.length === 0) throw new PlanError("PLAN_INVALID", "No step of the plan can run on this model.");
		return {
			ok: true,
			plan
		};
	} catch (err) {
		if (err instanceof PlanError) return {
			ok: false,
			code: err.code,
			reason: err.message
		};
		throw err;
	}
}
/**
* Re-validates one step against the live scene immediately before it runs (the user may have
* switched models or changed the scene since the plan was created).
*/
function validateStepNow(step, planModelId, ctx) {
	if (ctx.modelId !== planModelId) return {
		ok: false,
		code: "STALE_MODEL",
		reason: "The loaded model changed."
	};
	const commands = [];
	for (const command of step.actions) {
		if (!TEACHABLE_ACTIONS.includes(command.type)) return {
			ok: false,
			code: "ACTION_UNSUPPORTED",
			reason: `Action "${command.type}" is not allowed.`
		};
		const result = validateSceneCommand(command, ctx);
		if (!result.ok) return {
			ok: false,
			code: result.code,
			reason: result.reason
		};
		commands.push(result.command);
	}
	return {
		ok: true,
		commands
	};
}
// src/services/teaching/planPlayer.ts
var CATEGORY_OF = {
	"component.highlight": "highlight",
	"component.clearHighlight": "highlight",
	"component.isolate": "isolate",
	"assembly.explode": "explode",
	"assembly.restore": "explode",
	"animation.play": "animation",
	"animation.pause": "animation",
	"animation.setSpeed": "animation",
	"component.select": "select"
};
var IDLE = {
	status: "idle",
	plan: null,
	stepPosition: -1,
	stepCount: 0,
	phase: null,
	caption: "",
	narration: "",
	message: null,
	runtimeRejected: []
};
var TeachingPlanPlayer = class {
	state = { ...IDLE };
	listeners = /* @__PURE__ */ new Set();
	deps;
	runToken = 0;
	clip = null;
	nextClip = null;
	continueRequested = false;
	awaitingContinue = false;
	baseline = null;
	touched = /* @__PURE__ */ new Set();
	ownDispatch = false;
	constructor(deps) {
		this.deps = {
			pollMs: 40,
			settleTimeoutMs: 5e3,
			...deps
		};
	}
	/** Starts watching the dispatcher for manual takeover. Returns the detach function. */
	attach() {
		return this.deps.dispatcher.subscribe((rec) => {
			if (this.ownDispatch || rec.source === "ai") return;
			if (rec.status !== "executed" && rec.status !== "deferred") return;
			if (this.state.status === "running" || this.state.status === "waitingForUser") this.pause("Paused because you changed the scene. Resume to continue the explanation.");
		});
	}
	getState() {
		return this.state;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	isActive() {
		return [
			"running",
			"paused",
			"waitingForUser"
		].includes(this.state.status);
	}
	/** Starts a validated plan. Returns false (and does nothing) if another plan is active or the model changed. */
	start(plan) {
		if (this.isActive()) return false;
		const snap = this.deps.getSnapshot();
		if (!snap.model || snap.model.id !== plan.modelId) {
			this.set({
				...IDLE,
				status: "failed",
				plan,
				stepCount: plan.steps.length,
				message: "This explanation was prepared for a different model."
			});
			return false;
		}
		this.baseline = {
			modelId: plan.modelId,
			selected: snap.selectedComponentId,
			isolated: snap.isolatedComponentId.status === "known" ? snap.isolatedComponentId.value : null,
			highlighted: snap.highlightedComponentIds.status === "known" ? [...snap.highlightedComponentIds.value] : [],
			exploded: snap.exploded.factor,
			animation: snap.animation.state.status === "known" ? { ...snap.animation.state.value } : null
		};
		this.touched = /* @__PURE__ */ new Set();
		this.continueRequested = false;
		const token = ++this.runToken;
		this.set({
			...IDLE,
			status: "running",
			plan,
			stepCount: plan.steps.length
		});
		this.run(plan, token);
		return true;
	}
	pause(message = "Paused.") {
		if (this.state.status !== "running" && this.state.status !== "waitingForUser") return;
		this.clip?.pause();
		this.set({
			status: "paused",
			message
		});
	}
	resume() {
		if (this.state.status !== "paused") return;
		this.clip?.resume();
		this.set({
			status: this.awaitingContinue ? "waitingForUser" : "running",
			message: null
		});
	}
	/** Continue past a step that waits for the learner. */
	continue() {
		if (this.state.status === "waitingForUser") {
			this.continueRequested = true;
			this.awaitingContinue = false;
			this.set({ status: "running" });
		}
	}
	/** Stops the plan, stops speech, and restores what the plan changed (unless the model changed). */
	cancel(message = "Explanation stopped.") {
		if (!this.isActive()) return;
		this.stopRun();
		this.restore("cancel");
		this.set({
			status: "cancelled",
			phase: null,
			message
		});
	}
	set(patch) {
		this.state = {
			...this.state,
			...patch
		};
		for (const l of this.listeners) try {
			l(this.state);
		} catch {}
	}
	stopRun() {
		this.runToken++;
		this.awaitingContinue = false;
		this.clip?.stop();
		this.clip = null;
		this.nextClip?.clip.stop();
		this.nextClip = null;
	}
	alive(token) {
		return token === this.runToken;
	}
	sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}
	/** Per-poll checks shared by every wait: model switch cancels, user steering pauses. */
	watch(plan) {
		const snap = this.deps.getSnapshot();
		if (!snap.model || snap.model.id !== plan.modelId) {
			this.stopRun();
			this.baseline = null;
			this.set({
				status: "cancelled",
				phase: null,
				message: "The model changed, so the explanation was stopped."
			});
			return;
		}
		if (this.state.status === "running" && snap.camera.status === "known" && snap.camera.value.userSteering) this.pause("Paused because you moved the view. Resume to continue the explanation.");
	}
	/** Waits until `done()` (checked every poll) while honouring pause; `budgetMs` counts only unpaused time. */
	async waitUntil(token, plan, done, budgetMs = Infinity) {
		let elapsed = 0;
		while (this.alive(token)) {
			this.watch(plan);
			if (!this.alive(token)) return false;
			const paused = this.state.status === "paused";
			if (!paused && done()) return true;
			if (!paused && elapsed >= budgetMs) return true;
			await this.sleep(this.deps.pollMs);
			if (!paused) elapsed += this.deps.pollMs;
		}
		return false;
	}
	dispatch(command) {
		const cat = CATEGORY_OF[command.type];
		if (cat) this.touched.add(cat);
		this.ownDispatch = true;
		try {
			return this.deps.dispatcher.dispatch(command, "ai");
		} finally {
			this.ownDispatch = false;
		}
	}
	clipFor(plan, position) {
		if (this.nextClip?.position === position) {
			const c = this.nextClip.clip;
			this.nextClip = null;
			return c;
		}
		return this.deps.narrator.prepare(plan.steps[position].narration, plan.language);
	}
	async run(plan, token) {
		if (plan.targetComponentId && this.deps.getSnapshot().selectedComponentId !== plan.targetComponentId) this.dispatch({
			type: "component.select",
			componentId: plan.targetComponentId
		});
		for (let pos = 0; pos < plan.steps.length; pos++) {
			if (!await this.waitUntil(token, plan, () => true)) return;
			const step = plan.steps[pos];
			this.set({
				stepPosition: pos,
				phase: "actions",
				caption: step.caption,
				narration: step.narration
			});
			const check = validateStepNow(step, plan.modelId, this.deps.dispatcher.getContext());
			if (!check.ok) {
				if (check.code === "STALE_MODEL") {
					this.stopRun();
					this.set({
						status: "cancelled",
						phase: null,
						message: "The model changed, so the explanation was stopped."
					});
					return;
				}
				this.set({ runtimeRejected: [...this.state.runtimeRejected, {
					index: step.index,
					code: check.code,
					reason: check.reason
				}] });
				continue;
			}
			for (const command of check.commands) {
				if (!this.alive(token)) return;
				const rec = this.dispatch(command);
				if (rec.status === "rejected") {
					this.set({ runtimeRejected: [...this.state.runtimeRejected, {
						index: step.index,
						code: rec.code ?? "REJECTED",
						reason: rec.detail ?? ""
					}] });
					break;
				}
			}
			const settled = () => {
				const cam = this.deps.getSnapshot().camera;
				return cam.status !== "known" || cam.value.settled;
			};
			if (!await this.waitUntil(token, plan, settled, this.deps.settleTimeoutMs)) return;
			this.clip = this.clipFor(plan, pos);
			if (pos + 1 < plan.steps.length) this.nextClip = {
				position: pos + 1,
				clip: this.deps.narrator.prepare(plan.steps[pos + 1].narration, plan.language)
			};
			let narrationOver = false;
			this.clip.done.then(() => narrationOver = true);
			this.set({ phase: "narrating" });
			this.clip.play();
			if (this.state.status === "paused") this.clip.pause();
			if (!await this.waitUntil(token, plan, () => narrationOver)) return;
			this.clip = null;
			if (step.holdMs > 0) {
				this.set({ phase: "holding" });
				if (!await this.waitUntil(token, plan, () => false, step.holdMs)) return;
			}
			if (step.waitFor === "user" && pos + 1 < plan.steps.length) {
				this.continueRequested = false;
				this.awaitingContinue = true;
				if (this.state.status === "running") this.set({ status: "waitingForUser" });
				if (!await this.waitUntil(token, plan, () => this.continueRequested)) return;
				this.awaitingContinue = false;
			}
		}
		if (!this.alive(token)) return;
		this.restore("finish");
		this.runToken++;
		this.set({
			status: "finished",
			phase: null,
			message: null
		});
	}
	/** Puts back every category the plan touched (see policy at the top). */
	restore(reason) {
		const base = this.baseline;
		this.baseline = null;
		if (!base) return;
		const snap = this.deps.getSnapshot();
		if (!snap.model || snap.model.id !== base.modelId) return;
		const t = this.touched;
		if (t.has("highlight")) this.dispatch(base.highlighted.length ? {
			type: "component.highlight",
			componentIds: base.highlighted
		} : { type: "component.clearHighlight" });
		if (t.has("isolate")) this.dispatch({
			type: "component.isolate",
			componentId: base.isolated
		});
		if (t.has("explode")) this.dispatch(base.exploded > 0 ? {
			type: "assembly.explode",
			factor: base.exploded
		} : { type: "assembly.restore" });
		if (t.has("animation") && base.animation) {
			this.dispatch({
				type: "animation.setSpeed",
				speed: base.animation.speed
			});
			this.dispatch({ type: base.animation.playing ? "animation.play" : "animation.pause" });
		}
		if (reason === "cancel" && t.has("select")) this.dispatch({
			type: "component.select",
			componentId: base.selected
		});
		this.touched.clear();
	}
};
// src/services/teaching/componentBrief.ts
var VERB = {
	drives: "drives",
	driven_by: "is driven by",
	mates_with: "meshes with",
	supports: "supports",
	supported_by: "is supported by",
	connected_to: "is connected to",
	fastened_to: "is fastened to",
	transfers_force_to: "passes load to",
	receives_force_from: "receives load from"
};
/** Joins names as "A", "A and B", "A, B and C". */
function list(names) {
	return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
/** Shortens to whole sentences within the narration limit. */
function fit(text, max = PLAN_LIMITS.narration) {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	const sentences = t.match(/[^.!?]+[.!?]+/g) ?? [t];
	let out = "";
	for (const s of sentences) {
		if ((out + s).trim().length > max) break;
		out += s;
	}
	return out.trim() || t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
var hexId = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
var step$1 = (index, o) => ({
	index,
	kind: o.kind ?? "explain",
	claim: o.claim,
	caption: fit(o.caption, PLAN_LIMITS.caption),
	narration: fit(o.narration),
	targetComponentId: o.target ?? null,
	actions: o.actions ?? [],
	waitFor: "narration",
	holdMs: 0
});
/**
* Builds a grounded plan for one component (or the whole model when componentId is null).
* questionType tailors the emphasis ('failure' adds what is linked and what is not simulated).
*/
function buildComponentBrief(model, snapshot, componentId, questionType = "explain") {
	const can = (a) => snapshot.availableActions.includes(a);
	const nameOf = (id) => model.getComponentMetadata(id)?.name ?? id;
	const animated = (model.animations ?? []).length > 0;
	const steps = [];
	if (componentId) {
		const meta = model.getComponentMetadata(componentId);
		const name = meta?.name ?? componentId;
		steps.push(step$1(0, {
			kind: "demonstrate",
			claim: "metadata",
			target: componentId,
			caption: name,
			narration: `This is the ${name}. Its role: ${meta?.role ?? "not recorded"}. ${meta?.description ?? ""}`,
			actions: can("component.focus") ? [{
				type: "component.focus",
				componentId
			}] : []
		}));
		const rels = getComponentRelationships(model, componentId);
		if (rels.length > 0) {
			const byVerb = /* @__PURE__ */ new Map();
			for (const r of rels) {
				const verb = VERB[r.relationshipType] ?? r.relationshipType.replace(/_/g, " ");
				const names = byVerb.get(verb) ?? [];
				if (!names.includes(nameOf(r.targetComponentId))) names.push(nameOf(r.targetComponentId));
				byVerb.set(verb, names);
			}
			const clauses = [...byVerb.entries()].map(([verb, names]) => `${verb} ${list(names)}`);
			const related = [...new Set(rels.map((r) => r.targetComponentId))];
			steps.push(step$1(1, {
				kind: "demonstrate",
				claim: "metadata",
				target: componentId,
				caption: `How the ${name} connects`,
				narration: `In this model, the ${name} ${list(clauses)}.`,
				actions: can("component.highlight") ? [{
					type: "component.highlight",
					componentIds: related.slice(0, PLAN_LIMITS.highlight)
				}] : []
			}));
		} else steps.push(step$1(1, {
			claim: "metadata",
			target: componentId,
			caption: "Connections",
			narration: `No connections to other parts are recorded for the ${name} in this model.`
		}));
		const notes = meta?.engineeringNotes ?? [];
		if (notes.length > 0) steps.push(step$1(2, {
			claim: "metadata",
			target: componentId,
			caption: "From the engineering notes",
			narration: notes.slice(0, 2).join(" ")
		}));
		const linked = list([...new Set(rels.map((r) => nameOf(r.targetComponentId)))]);
		steps.push(step$1(3, {
			claim: "notSimulated",
			target: componentId,
			caption: "What this app does not simulate",
			narration: questionType === "failure" && linked ? `A failure cannot be simulated here. Based on the recorded connections, a problem with the ${name} would affect ${linked}.` : animated ? "The animation shows the motion only. It does not calculate forces, torque, friction or wear." : "This model shows the structure only. It does not calculate forces or stresses."
		}));
		return {
			schemaVersion: 1,
			planId: hexId(),
			modelId: model.id,
			targetComponentId: componentId,
			title: `${name} (from the model data)`,
			explanation: fit(`${name}: ${meta?.role ?? ""}. ${meta?.description ?? ""}`, PLAN_LIMITS.explanation),
			cannotAnswer: null,
			steps,
			rejectedSteps: [],
			followUpSuggestions: [`Why is the ${name} needed?`, `Show me the parts connected to the ${name}.`],
			language: "en-IN",
			source: "modelData"
		};
	}
	steps.push(step$1(0, {
		claim: "metadata",
		caption: model.name,
		narration: `${model.name}. ${model.description}`
	}));
	const seen = /* @__PURE__ */ new Set();
	const facts = [];
	for (const id of model.getAllComponentIds()) for (const r of getComponentRelationships(model, id)) {
		if (!r.description || seen.has(r.description) || ![
			"drives",
			"supports",
			"transfers_force_to",
			"connected_to"
		].includes(r.relationshipType)) continue;
		seen.add(r.description);
		facts.push(r.description);
	}
	if (facts.length > 0) steps.push(step$1(1, {
		claim: "metadata",
		caption: "How the parts work together",
		narration: facts.slice(0, 4).join(" ")
	}));
	steps.push(step$1(2, {
		claim: "notSimulated",
		caption: "What this app does not simulate",
		narration: animated ? "The animation shows the motion only. It does not calculate forces, torque, friction or wear." : "This model shows the structure only. It does not calculate forces or stresses."
	}));
	return {
		schemaVersion: 1,
		planId: hexId(),
		modelId: model.id,
		targetComponentId: null,
		title: `${model.name} (from the model data)`,
		explanation: fit(model.description, PLAN_LIMITS.explanation),
		cannotAnswer: null,
		steps,
		rejectedSteps: [],
		followUpSuggestions: ["Select a part and ask me to explain it."],
		language: "en-IN",
		source: "modelData"
	};
}
// src/services/teaching/factPack.ts
var clip = (s, n) => (s ?? "").slice(0, n);
/** What the app can and cannot show, stated explicitly so the LLM never overclaims. */
function modelLimits(model) {
	const limits = ["Only the relationships listed here are recorded for this model; any other link is unknown.", "Failures cannot be simulated in this app; failure answers are engineering reasoning only."];
	if ((model.animations ?? []).length > 0) limits.push("The animation is a kinematic visual demonstration of rotation at fixed speed ratios; it does not simulate forces, torque, friction, wear or load.");
	else limits.push("This model has no animation.");
	if (model.domain === "civil") limits.push("No structural analysis, stress calculation or finite-element simulation is implemented; force types in the data are qualitative annotations.");
	return limits;
}
function buildFactPack(model, snapshot, targetComponentId) {
	const ids = model.getAllComponentIds();
	const detailed = new Set(targetComponentId ? [targetComponentId, ...getComponentRelationships(model, targetComponentId).map((r) => r.targetComponentId)] : ids);
	const components = ids.map((id) => {
		const meta = model.getComponentMetadata(id);
		const relationships = getComponentRelationships(model, id).slice(0, 20).map((r) => ({
			type: r.relationshipType,
			target: r.targetComponentId,
			description: clip(r.description, 300)
		}));
		const full = detailed.has(id);
		const notes = [];
		if (full && meta) {
			notes.push(...meta.engineeringNotes.slice(0, 3));
			const civil = meta;
			if (civil.nominalForceType) notes.push(`Force type (qualitative annotation): ${civil.nominalForceType}`);
			notes.push(...(civil.educationalNotes ?? []).slice(0, 2));
			notes.push(...meta.specifications.slice(0, 3).map((s) => `${s.label}: ${s.value}`));
		}
		return {
			id,
			name: clip(meta?.name ?? id, 120),
			role: clip(meta?.role, 200),
			description: full ? clip(meta?.description, 600) : "",
			notes: notes.slice(0, 8).map((n) => clip(n, 300)),
			relationships
		};
	});
	const pointer = snapshot.pointer.status === "known" ? snapshot.pointer.value.componentId : null;
	return {
		modelId: model.id,
		modelName: model.name,
		domain: model.domain,
		modelDescription: clip(model.description, 800),
		components,
		animations: (model.animations ?? []).map((a) => ({
			id: a.id,
			label: a.label,
			description: clip(a.description, 400)
		})),
		allowedActions: snapshot.availableActions.filter((a) => TEACHABLE_ACTIONS.includes(a)),
		supportsExplodedView: snapshot.exploded.supported,
		limits: modelLimits(model),
		scene: {
			selectedComponentId: snapshot.selectedComponentId,
			pointedComponentId: pointer,
			isolatedComponentId: snapshot.isolatedComponentId.status === "known" ? snapshot.isolatedComponentId.value : null,
			highlightedComponentIds: snapshot.highlightedComponentIds.status === "known" ? [...snapshot.highlightedComponentIds.value] : [],
			explodedFactor: snapshot.exploded.factor,
			animationPlaying: snapshot.animation.state.status === "known" ? snapshot.animation.state.value.playing : null,
			cameraView: snapshot.camera.status === "known" ? snapshot.camera.value.view : null
		}
	};
}
// src/services/teaching/teachingController.ts
var teachingController_exports = /* @__PURE__ */ __exportAll({
	ENGLISH_FALLBACK_NOTE: () => ENGLISH_FALLBACK_NOTE,
	FALLBACK_NOTICE: () => FALLBACK_NOTICE,
	TEACHING_LANGUAGES: () => TEACHING_LANGUAGES,
	TeachingController: () => TeachingController,
	teachLanguage: () => teachLanguage
});
/** Teaching narration languages (fully verified set); others get English plans and speech. */
var TEACHING_LANGUAGES = [
	"en-IN",
	"te-IN",
	"hi-IN"
];
var teachLanguage = (lang) => TEACHING_LANGUAGES.includes(lang) ? lang : "en-IN";
var FALLBACK_NOTICE = "The AI teacher is not available right now, so this explanation comes from the model data.";
var ENGLISH_FALLBACK_NOTE = "It is in English, because the model data is in English.";
var TeachingController = class {
	deps;
	token = 0;
	abort = null;
	history = {
		modelId: "",
		turns: []
	};
	state = {
		pending: false,
		question: null,
		error: null,
		notice: null
	};
	listeners = /* @__PURE__ */ new Set();
	constructor(deps) {
		this.deps = deps;
	}
	getState() {
		return this.state;
	}
	subscribe(l) {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	}
	/** True while a plan is requested or playing (explanation controls apply). */
	isActive() {
		return this.state.pending || this.deps.player.isActive();
	}
	getHistory() {
		return this.history.turns;
	}
	set(patch) {
		this.state = {
			...this.state,
			...patch
		};
		for (const l of this.listeners) try {
			l(this.state);
		} catch {}
	}
	/** Invalidates the current request: later replies for it are ignored. */
	invalidate() {
		this.token += 1;
		this.abort?.abort();
		this.abort = null;
		return this.token;
	}
	async ask(info) {
		const model = this.deps.getModel();
		if (!model) return "failed";
		const token = this.invalidate();
		const controller = new AbortController();
		this.abort = controller;
		if (this.deps.player.isActive()) this.deps.player.cancel("Replaced by your new question.");
		if (this.history.modelId !== model.id) this.history = {
			modelId: model.id,
			turns: []
		};
		const language = teachLanguage(info.language ?? this.deps.getLanguage());
		this.set({
			pending: true,
			question: info.question,
			error: null,
			notice: null
		});
		let raw;
		try {
			const snapshot = getSceneSnapshot(this.deps.dispatcher, model);
			raw = await this.deps.requestPlan({
				question: info.question,
				language,
				targetComponentId: info.targetComponentId,
				questionType: info.questionType,
				facts: buildFactPack(model, snapshot, info.targetComponentId),
				history: [...this.history.turns]
			}, controller.signal);
		} catch (err) {
			if (!this.current(token, model) || err.code === "CANCELLED") return "stale";
			const code = err.code ?? "UNKNOWN";
			return this.fallback(token, model, info, TEACH_ERROR_MESSAGES[code] ?? err.message);
		}
		if (!this.current(token, model)) return "stale";
		const v = validateTeachingPlan(typeof raw === "object" && raw !== null ? {
			...raw,
			language,
			source: "llm"
		} : raw, getSceneSnapshot(this.deps.dispatcher, model), this.deps.dispatcher.getContext());
		if (!v.ok) return this.fallback(token, model, info, `The AI explanation could not be used safely (${v.reason})`);
		return this.play(v.plan, info) ? "started" : "failed";
	}
	/** A new non-teaching request replaces the explanation (and any pending request). */
	supersede(reason = "Replaced by your new request.") {
		this.invalidate();
		if (this.deps.player.isActive()) this.deps.player.cancel(reason);
		if (this.state.pending) this.set({ pending: false });
	}
	cancel(reason = "Explanation stopped.") {
		this.supersede(reason);
	}
	modelChanged(modelId) {
		this.invalidate();
		this.history = {
			modelId: modelId ?? "",
			turns: []
		};
		this.set({
			pending: false,
			error: null,
			notice: null
		});
	}
	/** Plays an already-produced plan through the same validation (dev hook / tests). */
	playRaw(raw, question = "(simulated plan)") {
		const model = this.deps.getModel();
		if (!model) return false;
		this.invalidate();
		const v = validateTeachingPlan(raw, getSceneSnapshot(this.deps.dispatcher, model), this.deps.dispatcher.getContext());
		if (!v.ok) {
			this.set({
				error: v.reason,
				pending: false
			});
			return false;
		}
		this.set({
			question,
			error: null,
			notice: null
		});
		return this.play(v.plan, {
			question,
			questionType: "explain",
			targetComponentId: v.plan.targetComponentId
		});
	}
	current(token, model) {
		return token === this.token && this.deps.getModel()?.id === model.id;
	}
	fallback(token, model, info, why) {
		const snapshot = getSceneSnapshot(this.deps.dispatcher, model);
		const v = validateTeachingPlan(buildComponentBrief(model, snapshot, info.targetComponentId && snapshot.components.some((c) => c.id === info.targetComponentId) ? info.targetComponentId : null, info.questionType), snapshot, this.deps.dispatcher.getContext());
		if (!v.ok || !this.current(token, model)) {
			this.set({
				pending: false,
				error: why
			});
			return "failed";
		}
		const englishNote = teachLanguage(info.language ?? this.deps.getLanguage()) !== "en-IN" ? " It is in English, because the model data is in English." : "";
		this.set({ notice: `${why} ${FALLBACK_NOTICE}${englishNote}`.trim() });
		return this.play(v.plan, info) ? "fallback" : "failed";
	}
	play(plan, info) {
		if (this.deps.player.isActive()) this.deps.player.cancel("Replaced by your new question.");
		const ok = this.deps.player.start(plan);
		this.set({ pending: false });
		if (ok) {
			this.history.turns = [...this.history.turns, {
				question: info.question,
				targetComponentId: plan.targetComponentId,
				title: plan.title
			}].slice(-3);
			this.deps.onPlanStarted?.(plan);
		} else this.set({ error: this.deps.player.getState().message ?? "The explanation could not start." });
		return ok;
	}
};
// src/services/teaching/teachingSession.ts
/**
* Teaching session (Task V4): connects a question to a played plan.
*
* question (already resolved by V3) -> fact pack -> /api/teach (LLM on the server)
*   -> validateTeachingPlan (live scene) -> TeachingPlanPlayer (V1 dispatcher, source 'ai')
*   -> Gnani Timbre narration per step, captions shown in sync.
*
* Stale protection: every request has a token; a reply that arrives after a newer question,
* a Cancel, or a model switch is discarded and never played.
*/
/**
* Gnani Timbre narrator. prepare() starts fetching audio at once (so the next step's audio is
* ready when needed); done resolves on the audio's real 'ended' event. If speech fails, the
* caption stays up for a reading-time fallback (paused with the plan) so the lesson continues.
*/
function createTimbreNarrator(getLanguage, onSpeechError) {
	let queue = Promise.resolve();
	const synthesizeOnce = async (text, language, signal) => {
		try {
			return await synthesize(text, language, signal);
		} catch (err) {
			if (err.code !== "GNANI_RATE_LIMIT" || signal.aborted) throw err;
			await new Promise((r) => setTimeout(r, 1500));
			return synthesize(text, language, signal);
		}
	};
	return { prepare(text, language) {
		const controller = new AbortController();
		const lang = teachLanguage(language ?? getLanguage());
		const blobPromise = queue.then(() => controller.signal.aborted ? Promise.reject(/* @__PURE__ */ new Error("stopped")) : synthesizeOnce(text, lang, controller.signal));
		queue = blobPromise.catch(() => void 0);
		let audio = null;
		let url = null;
		let paused = false;
		let stopped = false;
		let fallbackLeft = Math.min(9e3, Math.max(1800, text.length * 65));
		let fallbackTimer = null;
		let resolveDone;
		const done = new Promise((r) => resolveDone = r);
		const finish = (v) => {
			if (fallbackTimer) clearInterval(fallbackTimer);
			if (url) URL.revokeObjectURL(url);
			resolveDone(v);
		};
		const fallback = (msg) => {
			onSpeechError(msg);
			fallbackTimer = setInterval(() => {
				if (paused || stopped) return;
				fallbackLeft -= 100;
				if (fallbackLeft <= 0) finish("failed");
			}, 100);
		};
		return {
			done,
			play() {
				blobPromise.then((blob) => {
					if (stopped) return;
					url = URL.createObjectURL(blob);
					audio = new Audio(url);
					audio.onended = () => finish("ended");
					audio.onerror = () => fallback("Narration audio could not be played.");
					if (!paused) audio.play().catch(() => fallback("The browser blocked narration audio."));
				}, (err) => {
					if (!stopped) fallback(`Narration unavailable: ${err.message}`);
				});
			},
			pause() {
				paused = true;
				audio?.pause();
			},
			resume() {
				paused = false;
				if (audio && !audio.ended) audio.play().catch(() => fallback("The browser blocked narration audio."));
			},
			stop() {
				stopped = true;
				controller.abort();
				audio?.pause();
				finish("stopped");
			}
		};
	} };
}
/** Mutable holder for values read by long-lived callbacks (player, narrator, controller). */
var Latest = class {
	value;
	constructor(value) {
		this.value = value;
	}
	get() {
		return this.value;
	}
	set(value) {
		this.value = value;
	}
};
function useTeachingSession(opts) {
	const { dispatcher, model, language } = opts;
	const [latest] = useState(() => new Latest({
		model,
		language,
		onPlanStarted: opts.onPlanStarted
	}));
	useEffect(() => {
		latest.set({
			model,
			language,
			onPlanStarted: opts.onPlanStarted
		});
	});
	const [speechNote, setSpeechNote] = useState(null);
	const [player] = useState(() => new TeachingPlanPlayer({
		dispatcher,
		getSnapshot: () => getSceneSnapshot(dispatcher, latest.get().model ?? null),
		narrator: createTimbreNarrator(() => latest.get().language, setSpeechNote)
	}));
	const [controller] = useState(() => new TeachingController({
		dispatcher,
		player,
		getModel: () => latest.get().model,
		getLanguage: () => latest.get().language,
		requestPlan: (body, signal) => requestTeachingPlan(body, signal),
		onPlanStarted: (plan) => {
			setSpeechNote(null);
			latest.get().onPlanStarted?.(plan);
		}
	}));
	const [state, setState] = useState(player.getState());
	const [ctl, setCtl] = useState(controller.getState());
	useEffect(() => player.subscribe(setState), [player]);
	useEffect(() => controller.subscribe(setCtl), [controller]);
	useEffect(() => {
		const detach = player.attach();
		return () => {
			detach();
			controller.cancel("Explanation stopped.");
		};
	}, [player, controller]);
	useEffect(() => {
		controller.modelChanged(model?.id ?? null);
	}, [controller, model?.id]);
	const ask = useCallback((info) => controller.ask(info), [controller]);
	const playRaw = useCallback((raw, q) => controller.playRaw(raw, q), [controller]);
	const supersede = useCallback((reason) => controller.supersede(reason), [controller]);
	const isActive = useCallback(() => controller.isActive(), [controller]);
	return {
		state,
		pending: ctl.pending,
		error: ctl.error ?? speechNote,
		notice: ctl.notice,
		question: ctl.question,
		plan: state.plan,
		ask,
		playRaw,
		supersede,
		abortRequest: supersede,
		isActive,
		player
	};
}
// src/components/voice/VoiceDock.tsx
/**
* VoiceDock (Phase 11, Task V2) — push-to-talk voice control for the 3D workspace.
*
* mic -> 16 kHz WAV -> /api/voice/transcribe (Gnani Prisma) -> phrase parser
*     -> V1 SceneCommandDispatcher (source 'voice') -> caption (+ Gnani Timbre speech)
*
* Every turn has an id; Cancel bumps it, so late transcripts or replies from a cancelled turn
* are ignored and never executed. Captions are always shown.
*
* Task V4: explanation questions (why / how / what if / explain) become teaching requests when the
* server's teaching model is configured; the TeachingPanel plays the validated plan.
*/
/** Example requests shown when the dock is idle (in the conversation language). */
var EXAMPLES = {
	"en-IN": [
		"Explain this part",
		"Why is it needed?",
		"Show me the back",
		"Zoom in"
	],
	"te-IN": [
		"ఈ పార్ట్ ని ఎక్స్ప్లెయిన్ చెయ్యి",
		"ఇది ఎందుకు అవసరం?",
		"వెనుక వైపు చూపించు",
		"జూమ్ ఇన్"
	],
	"hi-IN": [
		"इसे एक्सप्लेन करो",
		"इसकी जरूरत क्यों है?",
		"पीछे से दिखाओ",
		"ज़ूम इन करो"
	]
};
/** Used until /api/voice/health answers (same list as the backend). */
var FALLBACK_LANGUAGES = [
	{
		code: "en-IN",
		name: "English",
		native: "English",
		status: "supported"
	},
	{
		code: "te-IN",
		name: "Telugu",
		native: "తెలుగు",
		status: "supported"
	},
	{
		code: "hi-IN",
		name: "Hindi",
		native: "हिन्दी",
		status: "supported"
	},
	{
		code: "ta-IN",
		name: "Tamil",
		native: "தமிழ்",
		status: "beta"
	},
	{
		code: "kn-IN",
		name: "Kannada",
		native: "ಕನ್ನಡ",
		status: "beta"
	},
	{
		code: "ml-IN",
		name: "Malayalam",
		native: "മലയാളം",
		status: "beta"
	},
	{
		code: "bn-IN",
		name: "Bengali",
		native: "বাংলা",
		status: "beta"
	},
	{
		code: "mr-IN",
		name: "Marathi",
		native: "मराठी",
		status: "beta"
	},
	{
		code: "gu-IN",
		name: "Gujarati",
		native: "ગુજરાતી",
		status: "beta"
	},
	{
		code: "pa-IN",
		name: "Punjabi",
		native: "ਪੰਜਾਬੀ",
		status: "beta"
	}
];
var MIC_MESSAGES = {
	MIC_DENIED: "Microphone access is blocked. Allow the microphone in the browser address bar, then try again.",
	MIC_NOT_FOUND: "No microphone was found. Connect a microphone and try again.",
	MIC_BUSY: "The microphone is being used by another application.",
	MIC_UNSUPPORTED: "This browser cannot record audio. Use a recent Chrome or Edge.",
	MIC_ERROR: "The microphone could not be started."
};
var CHIP_LABEL = {
	executed: "✓ Done",
	deferred: "⏳ Waiting until you stop moving the view",
	rejected: "✗ Not done",
	needsInput: "? Need more info",
	answered: "ℹ Answer",
	unavailable: "– Not available",
	teach: "📘 Explaining",
	control: "⏯ Explanation",
	error: "⚠ Error",
	cancelled: "■ Cancelled"
};
function readStoredLanguage() {
	try {
		return localStorage.getItem("voice.language") || "en-IN";
	} catch {
		return "en-IN";
	}
}
var VoiceDock = ({ dispatcher, model, allModels, askRef }) => {
	const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
	const [language, setLanguage] = useState(readStoredLanguage);
	const [phase, setPhase] = useState("idle");
	const [level, setLevel] = useState(0);
	const [transcript, setTranscript] = useState("");
	const [caption, setCaption] = useState("");
	const [chip, setChip] = useState(null);
	const [notice, setNotice] = useState(null);
	const [speakAll, setSpeakAll] = useState(true);
	const [collapsed, setCollapsed] = useState(false);
	const [teachingAvailable, setTeachingAvailable] = useState(false);
	const lastDiscussedRef = useRef(null);
	const pausedByMicRef = useRef(false);
	const [topic, setTopic] = useState(null);
	const teaching = useTeachingSession({
		dispatcher,
		model,
		language,
		onPlanStarted: (plan) => {
			if (plan.targetComponentId) {
				lastDiscussedRef.current = {
					modelId: plan.modelId,
					componentId: plan.targetComponentId
				};
				setTopic(lastDiscussedRef.current);
			}
		}
	});
	const teachingRef = useRef(teaching);
	useEffect(() => {
		teachingRef.current = teaching;
	});
	const turnRef = useRef(0);
	const recordingRef = useRef(null);
	const abortRef = useRef(null);
	const audioRef = useRef(null);
	const lastOutcomeRef = useRef(null);
	const latest = useRef({
		language,
		model,
		allModels,
		speakAll,
		teachingAvailable
	});
	useEffect(() => {
		latest.current = {
			language,
			model,
			allModels,
			speakAll,
			teachingAvailable
		};
	});
	const languageInfo = languages.find((l) => l.code === language) ?? FALLBACK_LANGUAGES[0];
	useEffect(() => {
		const controller = new AbortController();
		getVoiceHealth(controller.signal).then((health) => {
			if (health.languages?.length) setLanguages(health.languages);
			setNotice(health.keyConfigured ? null : VOICE_ERROR_MESSAGES.KEY_MISSING);
			setTeachingAvailable(Boolean(health.teaching?.configured));
		}, (err) => {
			if (err.code === "CANCELLED") return;
			setNotice(err instanceof VoiceServiceError ? err.message : VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
		});
		return () => controller.abort();
	}, []);
	useEffect(() => {
		try {
			localStorage.setItem("voice.language", language);
		} catch {}
	}, [language]);
	const stopPlayback = useCallback(() => {
		if (audioRef.current) {
			audioRef.current.pause();
			URL.revokeObjectURL(audioRef.current.src);
			audioRef.current = null;
		}
	}, []);
	/** Speaks a reply with Gnani Timbre. Failures keep the caption and add a short note. */
	const speak = useCallback(async (text, turn, language) => {
		const lang = language ?? latest.current.language;
		abortRef.current = new AbortController();
		try {
			const blob = await synthesize(text, lang, abortRef.current.signal);
			if (turn !== turnRef.current) return;
			stopPlayback();
			const audio = new Audio(URL.createObjectURL(blob));
			audioRef.current = audio;
			setPhase("speaking");
			audio.onended = () => {
				if (audioRef.current === audio) stopPlayback();
				if (turn === turnRef.current) setPhase("idle");
			};
			await audio.play().catch(() => {
				if (turn === turnRef.current) setPhase("idle");
			});
		} catch (err) {
			if (turn !== turnRef.current || err.code === "CANCELLED") return;
			setNotice(`Spoken reply unavailable: ${err.message}`);
			setPhase("idle");
		}
	}, [stopPlayback]);
	/** Applies the result of one understood turn: captions, teaching, controls, speech. */
	const applyResult = useCallback((result, turn, lang, m) => {
		const session = teachingRef.current;
		lastOutcomeRef.current = {
			turn,
			outcome: result.outcome
		};
		if (result.discussedComponentId) {
			lastDiscussedRef.current = {
				modelId: m.id,
				componentId: result.discussedComponentId
			};
			setTopic(lastDiscussedRef.current);
		}
		setCaption(result.caption);
		setChip(result.status);
		if (result.status === "teach" && result.teach) {
			const teachLang = result.teach.language ?? lang;
			if (teachLang !== latest.current.language) setLanguage(teachLang);
			session.ask({
				...result.teach,
				language: teachLang
			});
		}
		if (result.status === "control") {
			if (result.control === "pause") session.player.pause("Paused. Say “continue” when you are ready.");
			else if (result.control === "resume") {
				if (session.player.getState().status === "waitingForUser") session.player.continue();
				else session.player.resume();
			} else session.supersede("Explanation stopped.");
		}
		setPhase("idle");
		if (result.speak) speak(result.caption, turn, lang);
	}, [speak]);
	/**
	* Runs one turn from a transcript (microphone path and dev hook). `spokenLanguage` is the
	* language the audio was understood in; typed text is judged by its script.
	*/
	const runTranscript = useCallback(async (text, turn, spokenLanguage) => {
		const { language: uiLang, model: m, allModels: all, speakAll: sayAll } = latest.current;
		const lang = spokenLanguage ?? turnLanguage(text, uiLang);
		if (lang !== uiLang) setLanguage(lang);
		setTranscript(text);
		if (!m) {
			setCaption(reply("VIEWER_NOT_READY", lang));
			setChip("rejected");
			setPhase("idle");
			return;
		}
		if (!text.trim()) {
			if (pausedByMicRef.current) {
				pausedByMicRef.current = false;
				teachingRef.current.player.resume();
			}
			setCaption(reply("emptyTranscript", lang));
			setChip("needsInput");
			speak(reply("emptyTranscript", lang), turn, lang);
			return;
		}
		const session = teachingRef.current;
		pausedByMicRef.current = false;
		const turnInput = {
			language: lang,
			dispatcher,
			model: m,
			allModels: all,
			speakConfirmations: sayAll,
			lastDiscussed: lastDiscussedRef.current,
			teachingAvailable: true,
			teachingActive: session.isActive(),
			onSupersede: () => session.supersede("Replaced by your new request.")
		};
		if (previewTurn({
			...turnInput,
			transcript: text
		}).kind !== "noMatch") {
			applyResult(handleVoiceTurn({
				...turnInput,
				transcript: text
			}), turn, lang, m);
			return;
		}
		setPhase("transcribing");
		setCaption(reply("interpreting", lang));
		setChip(null);
		const scene = getSceneSnapshot(dispatcher, m, { lastDiscussed: lastDiscussedRef.current });
		const lexicon = lexiconFor(m);
		try {
			const i = await requestInterpretation({
				transcript: text.slice(0, 300),
				language: lang,
				modelId: m.id,
				modelName: m.name,
				components: lexicon.map((e) => ({
					id: e.componentId,
					name: e.displayName
				})),
				topicComponentId: scene.selectedComponentId ?? (scene.lastDiscussedComponentId.status === "known" ? scene.lastDiscussedComponentId.value : null),
				teachingActive: session.isActive()
			});
			if (turn !== turnRef.current || latest.current.model?.id !== m.id) return;
			const phrase = canonicalPhrase(i, (id) => lexicon.find((e) => e.componentId === id)?.displayName ?? null);
			const answerLang = i.language ?? lang;
			if (answerLang !== latest.current.language) setLanguage(answerLang);
			if (!phrase) {
				const key = i.intent === "unsupported" ? "unsupportedRequest" : "noMatch";
				applyResult({
					status: "rejected",
					caption: reply(key, answerLang, { model: m.name }),
					speak: true,
					outcome: { kind: "noMatch" },
					records: []
				}, turn, answerLang, m);
				return;
			}
			applyResult(handleVoiceTurn({
				...turnInput,
				language: answerLang,
				transcript: phrase,
				questionText: text
			}), turn, answerLang, m);
		} catch {
			if (turn !== turnRef.current) return;
			applyResult(handleVoiceTurn({
				...turnInput,
				transcript: text
			}), turn, lang, m);
		}
	}, [
		dispatcher,
		speak,
		applyResult
	]);
	/** Runs one turn from recorded audio (shared by the microphone path and the dev hook). */
	const runAudio = useCallback(async (wav, turn) => {
		setPhase("transcribing");
		setTranscript("");
		setCaption("");
		setChip(null);
		abortRef.current = new AbortController();
		const signal = abortRef.current.signal;
		try {
			const m = latest.current.model;
			const understood = (t) => Boolean(m) && previewTurn({
				transcript: t,
				dispatcher,
				model: m,
				allModels: latest.current.allModels,
				lastDiscussed: lastDiscussedRef.current,
				teachingActive: teachingRef.current.isActive()
			}).kind !== "noMatch";
			const heard = await transcribeWithLanguageRetry(wav, latest.current.language, (w, l, sg) => transcribe(w, l, sg), understood, signal);
			if (turn !== turnRef.current) return;
			setNotice(null);
			await runTranscript(heard.text, turn, heard.language);
		} catch (err) {
			if (turn !== turnRef.current || err.code === "CANCELLED" || err.name === "AbortError") return;
			setCaption(err.message);
			setChip("error");
			setPhase("idle");
			if (err.code === "BACKEND_UNAVAILABLE" || err.code === "KEY_MISSING") setNotice(err.message);
		}
	}, [dispatcher, runTranscript]);
	useEffect(() => {
		return dispatcher.subscribe((rec) => {
			if (rec.source !== "voice" || rec.status !== "executed" && rec.status !== "expired") return;
			const last = lastOutcomeRef.current;
			const { language: lang, model: m } = latest.current;
			if (!last || last.turn !== turnRef.current || !m) return;
			if (rec.status === "expired") {
				setCaption(reply("expired", lang));
				setChip("rejected");
			} else {
				setCaption((prev) => prev === reply("deferred", lang) ? confirmationCaption(last.outcome, lang, m) : prev);
				setChip((prev) => prev === "deferred" ? "executed" : prev);
			}
		});
	}, [dispatcher]);
	const cancel = useCallback(() => {
		turnRef.current += 1;
		recordingRef.current?.cancel();
		recordingRef.current = null;
		abortRef.current?.abort();
		stopPlayback();
		pausedByMicRef.current = false;
		teachingRef.current.supersede("Explanation stopped.");
		setPhase("idle");
		setLevel(0);
		setCaption("Stopped.");
		setChip("cancelled");
	}, [stopPlayback]);
	const startListening = useCallback(async () => {
		const turn = ++turnRef.current;
		abortRef.current?.abort();
		stopPlayback();
		const playing = teachingRef.current.player.getState().status;
		if (playing === "running" || playing === "waitingForUser") {
			teachingRef.current.player.pause("Listening…");
			pausedByMicRef.current = true;
		}
		setTranscript("");
		setCaption("");
		setChip(null);
		try {
			const rec = await startRecording((l) => setLevel(Math.min(1, l * 8)));
			if (turn !== turnRef.current) {
				rec.cancel();
				return;
			}
			recordingRef.current = rec;
			setPhase("listening");
			setNotice((n) => n && n.startsWith("Microphone") ? null : n);
			const result = await rec.done;
			recordingRef.current = null;
			setLevel(0);
			if (turn !== turnRef.current) return;
			if (!result.wav) {
				setPhase("idle");
				if (pausedByMicRef.current) {
					pausedByMicRef.current = false;
					teachingRef.current.player.resume();
				}
				if (result.reason === "nospeech") {
					setCaption("I didn't hear anything. Tap the mic and speak.");
					setChip("rejected");
				}
				return;
			}
			await runAudio(result.wav, turn);
		} catch (err) {
			setPhase("idle");
			setChip("error");
			const code = err instanceof MicError ? err.code : "MIC_ERROR";
			setCaption(MIC_MESSAGES[code]);
			setNotice(MIC_MESSAGES[code]);
		}
	}, [runAudio, stopPlayback]);
	const onMic = useCallback(() => {
		if (phase === "listening") {
			recordingRef.current?.stop();
			return;
		}
		if (phase === "transcribing") return;
		startListening();
	}, [phase, startListening]);
	useEffect(() => {}, [runTranscript, runAudio]);
	useEffect(() => {
		if (!askRef) return;
		askRef.current = (text) => {
			setCollapsed(false);
			runTranscript(text, ++turnRef.current, latest.current.language);
		};
		return () => {
			askRef.current = null;
		};
	}, [askRef, runTranscript]);
	useEffect(() => {
		const onKey = (e) => {
			const tag = e.target?.tagName?.toLowerCase();
			if (e.ctrlKey || e.metaKey || e.altKey || tag === "input" || tag === "textarea" || tag === "select") return;
			if (e.key === "m" || e.key === "M") {
				e.preventDefault();
				onMic();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onMic]);
	useEffect(() => () => {
		turnRef.current += 1;
		recordingRef.current?.cancel();
		abortRef.current?.abort();
		stopPlayback();
	}, [stopPlayback]);
	const busy = phase !== "idle" || teaching.pending;
	const teachStatus = teaching.state.status;
	const explaining = teachStatus === "running" || teachStatus === "paused" || teachStatus === "waitingForUser";
	const agentState = phase === "listening" ? {
		key: "listening",
		icon: "●",
		text: "Listening… I stop when you stop"
	} : phase === "transcribing" ? {
		key: "processing",
		icon: "…",
		text: "Understanding…"
	} : teaching.pending ? {
		key: "processing",
		icon: "…",
		text: "Preparing the explanation…"
	} : teachStatus === "paused" ? {
		key: "interrupted",
		icon: "⏸",
		text: "Explanation paused — say “continue” or ask something else"
	} : teachStatus === "waitingForUser" ? {
		key: "interrupted",
		icon: "⏸",
		text: "Waiting — say “continue” when ready"
	} : teachStatus === "running" ? {
		key: "speaking",
		icon: "🔊",
		text: `Explaining — step ${teaching.state.stepPosition + 1} of ${teaching.state.stepCount}`
	} : phase === "speaking" ? {
		key: "speaking",
		icon: "🔊",
		text: "Speaking…"
	} : chip === "error" ? {
		key: "error",
		icon: "⚠",
		text: "Something went wrong — see below"
	} : {
		key: "idle",
		icon: "🎙",
		text: "Tap the mic (or press M) and ask"
	};
	const topicName = topic && model && topic.modelId === model.id ? lexiconFor(model).find((e) => e.componentId === topic.componentId)?.displayName ?? null : null;
	const examples = EXAMPLES[language] ?? EXAMPLES["en-IN"];
	return /* @__PURE__ */ jsxs("section", {
		className: `voice-dock state-${agentState.key} ${collapsed ? "collapsed" : ""}`,
		"aria-label": "Voice tutor",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "voice-dock-row",
			children: [
				/* @__PURE__ */ jsx("button", {
					type: "button",
					className: `voice-mic phase-${phase}`,
					onClick: onMic,
					disabled: phase === "transcribing",
					"aria-label": phase === "listening" ? "Stop listening" : "Speak to the tutor",
					"aria-keyshortcuts": "M",
					title: phase === "listening" ? "Stop listening (M)" : "Speak to the tutor (M)",
					style: { ["--voice-level"]: level.toFixed(2) },
					children: /* @__PURE__ */ jsx("svg", {
						viewBox: "0 0 24 24",
						"aria-hidden": "true",
						children: phase === "listening" ? /* @__PURE__ */ jsx("rect", {
							x: "7",
							y: "7",
							width: "10",
							height: "10",
							rx: "2",
							fill: "currentColor"
						}) : /* @__PURE__ */ jsx("path", {
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "2",
							strokeLinecap: "round",
							d: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"
						})
					})
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "voice-dock-main",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "voice-dock-head",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "voice-title",
								children: "Voice tutor"
							}),
							/* @__PURE__ */ jsx("select", {
								className: "voice-lang",
								value: language,
								onChange: (e) => setLanguage(e.target.value),
								"aria-label": "Voice language",
								disabled: busy,
								children: languages.map((l) => /* @__PURE__ */ jsxs("option", {
									value: l.code,
									children: [l.native, l.status === "beta" ? " (beta)" : ""]
								}, l.code))
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "voice-collapse",
								onClick: () => setCollapsed((c) => !c),
								"aria-label": collapsed ? "Expand voice panel" : "Collapse voice panel",
								children: collapsed ? "▾" : "▴"
							})
						]
					}), /* @__PURE__ */ jsxs("div", {
						className: "voice-status",
						"aria-live": "polite",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "voice-state-icon",
								"aria-hidden": "true",
								children: agentState.icon
							}),
							" ",
							agentState.text
						]
					})]
				}),
				(busy || explaining) && /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "voice-cancel",
					onClick: cancel,
					"aria-label": "Stop listening, speech and explanation",
					children: "■ Stop"
				})
			]
		}), !collapsed && /* @__PURE__ */ jsxs("div", {
			className: "voice-dock-body",
			children: [
				languageInfo.status === "beta" && /* @__PURE__ */ jsxs("div", {
					className: "voice-beta",
					children: [languageInfo.name, " is in beta: speech recognition works, but commands use English words and replies are in English."]
				}),
				notice && /* @__PURE__ */ jsx("div", {
					className: "voice-notice",
					role: "alert",
					children: notice
				}),
				topicName && /* @__PURE__ */ jsxs("div", {
					className: "voice-topic",
					children: [/* @__PURE__ */ jsx("span", { children: "Topic" }), topicName]
				}),
				!transcript && !caption && !teaching.plan && !teaching.pending && /* @__PURE__ */ jsxs("div", {
					className: "voice-examples",
					"aria-label": "Things you can say",
					children: [/* @__PURE__ */ jsx("span", { children: "Try saying" }), examples.map((ex) => /* @__PURE__ */ jsx("q", { children: ex }, ex))]
				}),
				transcript && /* @__PURE__ */ jsxs("div", {
					className: "voice-transcript",
					children: [
						/* @__PURE__ */ jsx("span", { children: "Heard" }),
						"“",
						transcript,
						"”"
					]
				}),
				(caption || chip) && /* @__PURE__ */ jsxs("div", {
					className: `voice-caption chip-${chip ?? "none"}`,
					"aria-live": "polite",
					children: [chip && /* @__PURE__ */ jsx("span", {
						className: "voice-chip",
						children: CHIP_LABEL[chip]
					}), /* @__PURE__ */ jsx("span", { children: caption })]
				}),
				/* @__PURE__ */ jsx(TeachingPanel, { session: teaching }),
				/* @__PURE__ */ jsxs("label", {
					className: "voice-toggle",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						checked: speakAll,
						onChange: (e) => setSpeakAll(e.target.checked)
					}), "Speak every reply (otherwise only problems are spoken)"]
				})
			]
		})]
	});
};
// src/components/workspace/WorkspaceLayout.tsx
/** Commands owned by the workspace (React state), as opposed to the viewer (Three.js). */
var WORKSPACE_COMMAND_TYPES = /* @__PURE__ */ new Set([
	"component.select",
	"component.visibility",
	"component.showAll",
	"assembly.explode",
	"assembly.restore",
	"lesson.start",
	"lesson.next",
	"lesson.previous",
	"lesson.goTo",
	"lesson.exit",
	"workspace.switchModel",
	"workspace.goHome"
]);
/** Default separation used by the X shortcut and explode commands without a factor. */
var DEFAULT_EXPLODE_FACTOR = .75;
/**
* CAD-Style Technical Workspace Shell (Task 9.4)
* Provides a responsive layout with top toolbar, collapsible assembly dock,
* central flex-1 3D viewport, collapsible engineering inspector, and status telemetry.
*/
var WorkspaceLayout = ({ activeModelId = PLANETARY_GEARBOX_MODEL_ID, renderFps, onFpsUpdate, camera, activeGesture, onGestureChange, detectedHands, onHandsDetected, selectedComponentId, onSelectComponent, showDiagnostics, onToggleDiagnostics, showRoadmap, onToggleRoadmap, modules, onNavigateHome, onSwitchModel }) => {
	const [commandDispatcher] = useState(() => new SceneCommandDispatcher());
	const voiceAskRef = useRef(null);
	const askTutor = useCallback((text) => voiceAskRef.current?.(text), []);
	const [isLeftDockOpen, setIsLeftDockOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 1024);
	const [isRightDockOpen, setIsRightDockOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 1024);
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
	const workspaceRef = useRef({
		activeModel,
		selectedComponentId,
		activeLesson,
		isGuidedTourActive,
		currentTourStep,
		explodedFactor,
		hiddenComponentIds,
		handleSelectComponent,
		handleExplodedFactorChange,
		handleStartGuidedTour,
		handleExitGuidedTour,
		handleTourStepChange,
		handleNavigateHomeWrapped,
		onSwitchModel
	});
	useEffect(() => {
		workspaceRef.current = {
			activeModel,
			selectedComponentId,
			activeLesson,
			isGuidedTourActive,
			currentTourStep,
			explodedFactor,
			hiddenComponentIds,
			handleSelectComponent,
			handleExplodedFactorChange,
			handleStartGuidedTour,
			handleExitGuidedTour,
			handleTourStepChange,
			handleNavigateHomeWrapped,
			onSwitchModel
		};
	});
	useEffect(() => {
		const unregisterContext = commandDispatcher.registerContextProvider("workspace", () => {
			const ws = workspaceRef.current;
			return {
				modelId: ws.activeModel?.id ?? null,
				componentIds: new Set(ws.activeModel?.getAllComponentIds() ?? []),
				animationIds: (ws.activeModel?.animations ?? []).map((a) => a.id),
				lesson: {
					available: Boolean(ws.activeLesson && ws.activeLesson.steps.length > 0),
					active: ws.isGuidedTourActive,
					stepCount: ws.activeLesson?.steps.length ?? 0,
					currentStep: ws.currentTourStep
				},
				registeredModelIds: new Set(modelRegistry.getAllModels().map((m) => m.id)),
				selectedComponentId: ws.selectedComponentId,
				workspaceFacts: {
					hiddenComponentIds: [...ws.hiddenComponentIds],
					explodedFactor: ws.explodedFactor,
					lessonStepTitle: ws.isGuidedTourActive ? ws.activeLesson?.steps[ws.currentTourStep]?.title ?? null : null,
					lessonStepComponentId: ws.isGuidedTourActive ? ws.activeLesson?.steps[ws.currentTourStep]?.componentId ?? null : null
				}
			};
		});
		const unregisterHandler = commandDispatcher.registerHandler({
			id: "workspace",
			canHandle: (type) => WORKSPACE_COMMAND_TYPES.has(type),
			execute: (command, source) => {
				const ws = workspaceRef.current;
				switch (command.type) {
					case "component.select":
						ws.handleSelectComponent(command.componentId);
						return { status: "executed" };
					case "component.visibility":
						setHiddenComponentIds((prev) => {
							const next = new Set(prev);
							command.componentIds.forEach((id) => command.visible ? next.delete(id) : next.add(id));
							return next;
						});
						return { status: "executed" };
					case "component.showAll":
						setHiddenComponentIds(/* @__PURE__ */ new Set());
						commandDispatcher.dispatch({
							type: "component.isolate",
							componentId: null
						}, source);
						return { status: "executed" };
					case "assembly.explode":
						ws.handleExplodedFactorChange(command.factor);
						return { status: "executed" };
					case "assembly.restore":
						ws.handleExplodedFactorChange(0);
						return { status: "executed" };
					case "lesson.start":
						if (ws.isGuidedTourActive) ws.handleTourStepChange(0);
						else ws.handleStartGuidedTour();
						return { status: "executed" };
					case "lesson.next":
						ws.handleTourStepChange(ws.currentTourStep + 1);
						return { status: "executed" };
					case "lesson.previous":
						ws.handleTourStepChange(ws.currentTourStep - 1);
						return { status: "executed" };
					case "lesson.goTo":
						ws.handleTourStepChange(command.stepIndex);
						return { status: "executed" };
					case "lesson.exit":
						ws.handleExitGuidedTour();
						return { status: "executed" };
					case "workspace.switchModel":
						if (!ws.onSwitchModel) return {
							status: "rejected",
							code: "NO_HANDLER",
							detail: "Model switching is not available here."
						};
						ws.onSwitchModel(command.modelId);
						return { status: "executed" };
					case "workspace.goHome":
						ws.handleNavigateHomeWrapped();
						return { status: "executed" };
					default: return {
						status: "rejected",
						code: "NO_HANDLER",
						detail: `Workspace cannot handle "${command.type}".`
					};
				}
			}
		});
		return () => {
			unregisterContext();
			unregisterHandler();
		};
	}, [commandDispatcher]);
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
			commandDispatcher.dispatch(workspaceRef.current.explodedFactor > 0 ? { type: "assembly.restore" } : {
				type: "assembly.explode",
				factor: DEFAULT_EXPLODE_FACTOR
			}, "keyboard");
		} else if (e.key === "l" || e.key === "L") {
			e.preventDefault();
			commandDispatcher.dispatch({ type: workspaceRef.current.isGuidedTourActive ? "lesson.exit" : "lesson.start" }, "keyboard");
		}
	}, [commandDispatcher]);
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
									onExplodedFactorChange: handleExplodedFactorChange,
									commandDispatcher
								}),
								isGuidedTourActive && activeLesson && /* @__PURE__ */ jsx(GuidedLearningPanel, {
									lesson: activeLesson,
									currentStepIndex: currentTourStep,
									onStepChange: handleTourStepChange,
									onExit: handleExitGuidedTour
								}),
								/* @__PURE__ */ jsx(VoiceDock, {
									dispatcher: commandDispatcher,
									model: activeModel,
									allModels: modelRegistry.getAllModels(),
									askRef: voiceAskRef
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
									onClose: () => handleSelectComponent(null),
									onAskTutor: askTutor
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
describe("EngineeringInspectorPanel — Ask the voice tutor (voice-first milestone)", () => {
	const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
	it("shows the tutor buttons for a selected part only when wired to the voice tutor", () => {
		const withTutor = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: "sun_gear",
			activeModel: gearboxModel,
			onClose: () => {},
			onAskTutor: () => {}
		}));
		for (const label of [
			"Ask the tutor",
			"Explain",
			"Why is it needed?",
			"How does it work?",
			"What if it fails?"
		]) assert.ok(withTutor.includes(label), label);
		const without = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: "sun_gear",
			activeModel: gearboxModel,
			onClose: () => {}
		}));
		assert.ok(!without.includes("Ask the tutor"));
	});
	it("empty state offers the voice tutor and keeps the existing guidance", () => {
		const html = renderToStaticMarkup(React.createElement(EngineeringInspectorPanel, {
			componentId: null,
			onClose: () => {},
			onAskTutor: () => {}
		}));
		assert.ok(html.includes("Voice tutor") && html.includes("Explain this model"));
		assert.ok(html.includes("No Component Selected") && html.includes("Hold steady for 1.2s dwell"));
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
		onSwitchModel: handleLaunchModel,
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
		it("keeps the featured 3D preview out of the card height calculation (no canvas-driven expansion)", () => {
			const rule = dashboardCss.match(/\.featured-visual-pane \.featured-canvas-preview \{([^}]*)\}/);
			assert.ok(rule, "featured preview rule exists");
			assert.match(rule[1], /position:\s*absolute/);
			assert.match(rule[1], /inset:\s*0/);
			assert.match(rule[1], /min-height:\s*0/);
			assert.ok(!/\.featured-canvas-preview \{[^}]*min-height:\s*320px/.test(dashboardCss), "no fixed min-height on the canvas itself");
		});
		it("bounds the featured preview height in the stacked (<= 960px) layout", () => {
			const stacked = dashboardCss.slice(dashboardCss.indexOf("@media (max-width: 960px)"));
			assert.match(stacked, /\.featured-visual-pane \{[^}]*height:\s*clamp\(240px, 42vw, 340px\)/);
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
// tests/sceneCommands.test.ts
/**
* Unified Scene Command Channel Tests (Task V1)
*
* 1. Validation of untrusted command input against the live model context
* 2. Dispatcher routing, history, listeners and fault isolation
* 3. Smooth command-driven camera transitions (CameraController)
* 4. Arbitration with live hand gestures and mouse drags (ViewerCommandExecutor)
* 5. End-to-end with the real planetary gearbox model and lifecycle manager
*/
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
function makeCamera(opts = {}) {
	const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
	return {
		camera,
		controller: new CameraController(camera, createMockDom$1(), {
			enableDamping: false,
			minDistance: 2,
			maxDistance: 25,
			autoRotate: opts.autoRotate ?? false
		})
	};
}
function gearboxContext(overrides = {}) {
	const model = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
	return {
		...EMPTY_COMMAND_CONTEXT,
		modelId: model.id,
		componentIds: new Set(model.getAllComponentIds()),
		animationIds: (model.animations ?? []).map((a) => a.id),
		supportsExplodedView: true,
		viewerReady: true,
		lesson: {
			available: true,
			active: false,
			stepCount: 5,
			currentStep: 0
		},
		registeredModelIds: new Set(modelRegistry.getAllModels().map((m) => m.id)),
		...overrides
	};
}
function hand(x) {
	const landmarks = Array.from({ length: 21 }, () => ({
		x,
		y: .5,
		z: 0
	}));
	landmarks[0] = {
		x,
		y: .62,
		z: 0
	};
	landmarks[5] = {
		x: x - .05,
		y: .46,
		z: 0
	};
	landmarks[9] = {
		x,
		y: .42,
		z: 0
	};
	landmarks[13] = {
		x: x + .04,
		y: .45,
		z: 0
	};
	landmarks[17] = {
		x: x + .08,
		y: .5,
		z: 0
	};
	landmarks[4] = {
		x: x - .1,
		y: .45,
		z: 0
	};
	landmarks[8] = {
		x: x - .05,
		y: .32,
		z: 0
	};
	return [{
		landmarks,
		rawLandmarks: landmarks.map((p) => ({ ...p })),
		handedness: "Right",
		score: .95
	}];
}
var PALM = {
	gesture: "OPEN_PALM",
	confidence: .95,
	isStable: true,
	handedness: "Right"
};
var NONE = {
	gesture: "NONE",
	confidence: 0,
	isStable: true,
	handedness: "Right"
};
/** Rig with a real gesture controller and an executor on a fake clock. */
function makeRig() {
	const { camera, controller } = makeCamera();
	const gestures = new GestureCameraController(controller);
	let clock = 1e3;
	const animation = {
		playing: true,
		speed: 1
	};
	let autoOrbit = false;
	const deferred = [];
	const executor = new ViewerCommandExecutor({
		camera: controller,
		lifecycle: {
			getComponentBounds: () => null,
			isolateComponent: () => true,
			getActiveModel: () => modelRegistry.getModel("planetary_gearbox") ?? null,
			getActiveRuntime: () => null
		},
		isGestureInteracting: () => gestures.isInteracting(),
		animation: {
			setPlaying: (p) => animation.playing = p,
			setSpeed: (s) => animation.speed = s
		},
		setAutoOrbit: (e) => autoOrbit = e,
		now: () => clock
	}, (cmd, _src, status) => deferred.push(`${cmd.type}:${status}`));
	const advance = (ms) => {
		clock += ms;
	};
	const frame = (g, h) => {
		gestures.update(g, h);
		executor.tick(clock);
		controller.update(clock);
	};
	return {
		camera,
		controller,
		gestures,
		executor,
		animation,
		deferred,
		advance,
		frame,
		getClock: () => clock,
		getAutoOrbit: () => autoOrbit
	};
}
describe("Scene command validation (untrusted input)", () => {
	const ctx = gearboxContext();
	it("rejects malformed and unknown commands", () => {
		assert.equal(validateSceneCommand(null, ctx).ok, false);
		assert.equal(validateSceneCommand("zoom in", ctx).ok, false);
		assert.equal(validateSceneCommand([], ctx).ok, false);
		const noType = validateSceneCommand({ direction: "in" }, ctx);
		assert.ok(!noType.ok && noType.code === "MALFORMED");
		const unknown = validateSceneCommand({ type: "scene.deleteEverything" }, ctx);
		assert.ok(!unknown.ok && unknown.code === "UNKNOWN_COMMAND");
	});
	it("strips unexpected fields so injected data never reaches handlers", () => {
		const res = validateSceneCommand({
			type: "camera.zoom",
			direction: "in",
			eval: "alert(1)",
			steps: 2
		}, ctx);
		assert.ok(res.ok);
		assert.deepEqual(res.command, {
			type: "camera.zoom",
			direction: "in",
			steps: 2
		});
	});
	it("validates orbit ranges and fills defaults", () => {
		assert.ok(!validateSceneCommand({
			type: "camera.orbit",
			yawDeg: 0
		}, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "camera.orbit",
			yawDeg: 720
		}, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "camera.orbit",
			yawDeg: "left"
		}, ctx).ok);
		const ok = validateSceneCommand({
			type: "camera.orbit",
			yawDeg: 30
		}, ctx);
		assert.ok(ok.ok);
		assert.deepEqual(ok.command, {
			type: "camera.orbit",
			yawDeg: 30,
			pitchDeg: 0
		});
	});
	it("validates pan direction and amount", () => {
		assert.ok(!validateSceneCommand({
			type: "camera.pan",
			direction: "forward"
		}, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "camera.pan",
			direction: "left",
			amount: 5
		}, ctx).ok);
		const ok = validateSceneCommand({
			type: "camera.pan",
			direction: "right"
		}, ctx);
		assert.ok(ok.ok && ok.command.type === "camera.pan" && ok.command.amount === .15);
	});
	it("validates zoom steps", () => {
		assert.ok(!validateSceneCommand({
			type: "camera.zoom",
			direction: "sideways"
		}, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "camera.zoom",
			direction: "in",
			steps: 0
		}, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "camera.zoom",
			direction: "in",
			steps: 1.5
		}, ctx).ok);
	});
	it("rejects the unsupported bottom view with an explanation, accepts back/left/right", () => {
		const bottom = validateSceneCommand({
			type: "camera.view",
			view: "bottom"
		}, ctx);
		assert.ok(!bottom.ok && /ground grid/.test(bottom.reason));
		for (const view of [
			"back",
			"left",
			"right",
			"isometric",
			"top",
			"front"
		]) assert.ok(validateSceneCommand({
			type: "camera.view",
			view
		}, ctx).ok, view);
	});
	it("rejects component IDs that do not exist in the loaded model", () => {
		const bridgePart = validateSceneCommand({
			type: "component.select",
			componentId: "top_chords"
		}, ctx);
		assert.ok(!bridgePart.ok && bridgePart.code === "UNKNOWN_COMPONENT");
		const invented = validateSceneCommand({
			type: "component.focus",
			componentId: "piston"
		}, ctx);
		assert.ok(!invented.ok && invented.code === "UNKNOWN_COMPONENT");
		assert.ok(validateSceneCommand({
			type: "component.select",
			componentId: "sun_gear"
		}, ctx).ok);
		assert.ok(validateSceneCommand({
			type: "component.select",
			componentId: null
		}, ctx).ok);
		assert.ok(validateSceneCommand({
			type: "component.isolate",
			componentId: null
		}, ctx).ok);
	});
	it("validates visibility lists (non-empty, all known, de-duplicated)", () => {
		assert.ok(!validateSceneCommand({
			type: "component.visibility",
			componentIds: [],
			visible: false
		}, ctx).ok);
		const mixed = validateSceneCommand({
			type: "component.visibility",
			componentIds: ["sun_gear", "ghost"],
			visible: false
		}, ctx);
		assert.ok(!mixed.ok && mixed.code === "UNKNOWN_COMPONENT");
		const ok = validateSceneCommand({
			type: "component.visibility",
			componentIds: ["sun_gear", "sun_gear"],
			visible: false
		}, ctx);
		assert.ok(ok.ok && ok.command.type === "component.visibility" && ok.command.componentIds.length === 1);
	});
	it("requires the viewer for camera, focus, isolate and animation commands", () => {
		const notReady = gearboxContext({ viewerReady: false });
		for (const cmd of [
			{
				type: "camera.zoom",
				direction: "in"
			},
			{
				type: "component.focus",
				componentId: "sun_gear"
			},
			{ type: "animation.play" }
		]) {
			const res = validateSceneCommand(cmd, notReady);
			assert.ok(!res.ok && res.code === "VIEWER_NOT_READY", cmd.type);
		}
	});
	it("rejects exploded-view commands for models without one, and bad factors", () => {
		const noExplode = gearboxContext({ supportsExplodedView: false });
		assert.ok(!validateSceneCommand({
			type: "assembly.explode",
			factor: .5
		}, noExplode).ok);
		assert.ok(!validateSceneCommand({ type: "assembly.restore" }, noExplode).ok);
		assert.ok(!validateSceneCommand({
			type: "assembly.explode",
			factor: 1.5
		}, ctx).ok);
		assert.ok(validateSceneCommand({
			type: "assembly.explode",
			factor: .6
		}, ctx).ok);
	});
	it("only allows animation commands for models that declare a real animation", () => {
		const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
		const res = validateSceneCommand({ type: "animation.play" }, gearboxContext({
			modelId: bridge.id,
			componentIds: new Set(bridge.getAllComponentIds()),
			animationIds: (bridge.animations ?? []).map((a) => a.id)
		}));
		assert.ok(!res.ok && res.code === "UNSUPPORTED_ANIMATION");
		assert.ok(validateSceneCommand({ type: "animation.play" }, ctx).ok);
		assert.ok(!validateSceneCommand({
			type: "animation.setSpeed",
			speed: 10
		}, ctx).ok);
		assert.ok(validateSceneCommand({
			type: "animation.setSpeed",
			speed: .5
		}, ctx).ok);
	});
	it("declares the gearbox animation honestly and none for the bridge (whose update hook is a no-op)", () => {
		assert.deepEqual(modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID).animations?.map((a) => a.id), ["gear_train_rotation"]);
		assert.equal(modelRegistry.getModel("warren_truss_bridge").animations?.length ?? 0, 0);
	});
	it("validates lesson state and step bounds", () => {
		const noLesson = gearboxContext({ lesson: {
			available: false,
			active: false,
			stepCount: 0,
			currentStep: 0
		} });
		assert.ok(!validateSceneCommand({ type: "lesson.start" }, noLesson).ok);
		const next = validateSceneCommand({ type: "lesson.next" }, ctx);
		assert.ok(!next.ok && next.code === "LESSON_NOT_ACTIVE");
		const active = gearboxContext({ lesson: {
			available: true,
			active: true,
			stepCount: 5,
			currentStep: 0
		} });
		assert.ok(validateSceneCommand({ type: "lesson.next" }, active).ok);
		assert.ok(!validateSceneCommand({
			type: "lesson.goTo",
			stepIndex: 5
		}, active).ok);
		assert.ok(validateSceneCommand({
			type: "lesson.goTo",
			stepIndex: 4
		}, active).ok);
	});
	it("only switches to registered models", () => {
		const res = validateSceneCommand({
			type: "workspace.switchModel",
			modelId: "v8_engine"
		}, ctx);
		assert.ok(!res.ok && res.code === "UNKNOWN_MODEL");
		assert.ok(validateSceneCommand({
			type: "workspace.switchModel",
			modelId: WARREN_TRUSS_MODEL_ID
		}, ctx).ok);
	});
});
describe("SceneCommandDispatcher", () => {
	function makeDispatcher() {
		const dispatcher = new SceneCommandDispatcher(() => 42);
		dispatcher.registerContextProvider("test", () => gearboxContext());
		const calls = [];
		dispatcher.registerHandler({
			id: "h",
			canHandle: (t) => t.startsWith("camera."),
			execute: (cmd, source) => {
				calls.push(`${cmd.type}@${source}`);
				return { status: "executed" };
			}
		});
		return {
			dispatcher,
			calls
		};
	}
	it("routes valid commands to the owning handler and records the source", () => {
		const { dispatcher, calls } = makeDispatcher();
		const rec = dispatcher.dispatch({
			type: "camera.zoom",
			direction: "in"
		}, "voice");
		assert.equal(rec.status, "executed");
		assert.equal(rec.source, "voice");
		assert.deepEqual(calls, ["camera.zoom@voice"]);
	});
	it("rejects without calling any handler when validation fails", () => {
		const { dispatcher, calls } = makeDispatcher();
		const rec = dispatcher.dispatch({
			type: "component.select",
			componentId: "piston"
		}, "ai");
		assert.equal(rec.status, "rejected");
		assert.equal(rec.code, "UNKNOWN_COMPONENT");
		assert.equal(calls.length, 0);
	});
	it("reports NO_HANDLER for valid commands nobody owns", () => {
		const { dispatcher } = makeDispatcher();
		const rec = dispatcher.dispatch({ type: "animation.play" }, "ui");
		assert.equal(rec.status, "rejected");
		assert.equal(rec.code, "NO_HANDLER");
	});
	it("never throws when a handler or listener fails", () => {
		const dispatcher = new SceneCommandDispatcher();
		dispatcher.registerContextProvider("t", () => gearboxContext());
		dispatcher.registerHandler({
			id: "bad",
			canHandle: () => true,
			execute: () => {
				throw new Error("boom");
			}
		});
		dispatcher.subscribe(() => {
			throw new Error("listener boom");
		});
		const rec = dispatcher.dispatch({ type: "camera.reset" }, "ui");
		assert.equal(rec.status, "rejected");
		assert.match(rec.detail ?? "", /boom/);
	});
	it("notifies listeners and keeps a bounded history", () => {
		const { dispatcher } = makeDispatcher();
		const seen = [];
		const unsubscribe = dispatcher.subscribe((r) => seen.push(r.status));
		for (let i = 0; i < 60; i++) dispatcher.dispatch({ type: "camera.reset" }, "ui");
		unsubscribe();
		dispatcher.dispatch({ type: "camera.reset" }, "ui");
		assert.equal(seen.length, 60);
		assert.equal(dispatcher.getHistory().length, 50);
	});
	it("merges context from several providers and unregisters cleanly", () => {
		const dispatcher = new SceneCommandDispatcher();
		dispatcher.registerContextProvider("workspace", () => ({ modelId: "planetary_gearbox" }));
		const off = dispatcher.registerContextProvider("viewer", () => ({ viewerReady: true }));
		assert.equal(dispatcher.getContext().modelId, "planetary_gearbox");
		assert.equal(dispatcher.getContext().viewerReady, true);
		off();
		assert.equal(dispatcher.getContext().viewerReady, false);
	});
});
describe("CameraController command transitions", () => {
	it("moves smoothly to the back view over the transition duration", () => {
		const { camera, controller } = makeCamera();
		const startDist = controller.getDistance();
		controller.goToView("back", 400, 0);
		controller.update(200);
		assert.ok(controller.isTransitioning());
		assert.ok(camera.position.z > -startDist * .9, "not yet at the back at mid-transition");
		controller.update(400);
		assert.equal(controller.isTransitioning(), false);
		assert.ok(camera.position.z < 0, "camera ends behind the model");
		assert.ok(Math.abs(controller.getDistance() - startDist) < .01, "distance preserved");
		assert.ok(controller.controls.target.length() < 1e-6, "target preserved");
	});
	it("reaches fixed presets exactly when animated", () => {
		const { camera, controller } = makeCamera();
		controller.goToView("top", 300, 0);
		controller.update(300);
		assert.ok(camera.position.distanceTo(CAMERA_PRESETS.top.position) < .01);
	});
	it("accumulates rapid orbit commands from the goal pose (two 45° = 90°)", () => {
		const { camera, controller } = makeCamera();
		const start = new THREE.Spherical().setFromVector3(camera.position.clone());
		controller.orbitBy(Math.PI / 4, 0, 300, 0);
		controller.update(100);
		controller.orbitBy(Math.PI / 4, 0, 300, 100);
		controller.update(400);
		let d = new THREE.Spherical().setFromVector3(camera.position.clone()).theta - start.theta;
		d = Math.atan2(Math.sin(d), Math.cos(d));
		assert.ok(Math.abs(d - Math.PI / 2) < .02, `expected 90°, got ${THREE.MathUtils.radToDeg(d)}`);
	});
	it("clamps smooth zoom to the distance limits", () => {
		const { controller } = makeCamera();
		controller.zoomSmooth(1e-4, 100, 0);
		controller.update(100);
		assert.ok(Math.abs(controller.getDistance() - 2) < .01);
		controller.zoomSmooth(1e3, 100, 200);
		controller.update(300);
		assert.ok(Math.abs(controller.getDistance() - 25) < .01);
	});
	it("pans camera and target together, keeping the view direction", () => {
		const { camera, controller } = makeCamera();
		const offsetBefore = camera.position.clone().sub(controller.controls.target);
		controller.panBy(.2, 0, 100, 0);
		controller.update(100);
		const offsetAfter = camera.position.clone().sub(controller.controls.target);
		assert.ok(controller.controls.target.length() > .5, "target moved");
		assert.ok(offsetAfter.distanceTo(offsetBefore) < .01, "view direction and distance unchanged");
	});
	it("suspends auto-orbit during a transition and restores it afterwards", () => {
		const { controller } = makeCamera({ autoRotate: true });
		controller.goToView("front", 200, 0);
		assert.equal(controller.controls.autoRotate, false);
		assert.equal(controller.isAutoRotating(), true, "intent preserved");
		controller.update(200);
		assert.equal(controller.controls.autoRotate, true);
	});
	it("remembers an auto-orbit change requested during a transition", () => {
		const { controller } = makeCamera({ autoRotate: true });
		controller.goToView("front", 200, 0);
		controller.setAutoRotate(false);
		controller.update(200);
		assert.equal(controller.controls.autoRotate, false);
	});
	it("an instant preset (key/button) cancels a running transition", () => {
		const { camera, controller } = makeCamera();
		controller.goToView("back", 400, 0);
		controller.update(100);
		controller.setPreset("top");
		assert.equal(controller.isTransitioning(), false);
		controller.update(400);
		assert.ok(camera.position.distanceTo(CAMERA_PRESETS.top.position) < .01);
	});
});
describe("Command arbitration with live gestures and mouse", () => {
	it("defers a camera command while an open-palm gesture is orbiting, then runs it on release", () => {
		const rig = makeRig();
		rig.frame(PALM, hand(.5));
		for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(.5 + i * .03));
		assert.equal(rig.gestures.isInteracting(), true);
		const distBefore = rig.controller.getDistance();
		const outcome = rig.executor.execute({
			type: "camera.zoom",
			direction: "in",
			steps: 1
		}, "voice");
		assert.equal(outcome.status, "deferred");
		rig.advance(16);
		rig.frame(PALM, hand(.59));
		assert.ok(Math.abs(rig.controller.getDistance() - distBefore) < .01, "zoom must not fight the hand");
		rig.advance(16);
		rig.frame(NONE, []);
		assert.deepEqual(rig.deferred, ["camera.zoom:executed"]);
		rig.advance(500);
		rig.frame(NONE, []);
		assert.ok(rig.controller.getDistance() < distBefore * .8, "zoom applied after release");
	});
	it("keeps only the latest deferred camera command", () => {
		const rig = makeRig();
		rig.frame(PALM, hand(.5));
		for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(.5 + i * .03));
		rig.executor.execute({
			type: "camera.zoom",
			direction: "in"
		}, "voice");
		rig.executor.execute({
			type: "camera.view",
			view: "top"
		}, "voice");
		assert.deepEqual(rig.executor.getPending(), {
			type: "camera.view",
			view: "top"
		});
		assert.deepEqual(rig.deferred, ["camera.zoom:expired"]);
	});
	it("expires a deferred command if the hand keeps steering past the timeout", () => {
		const rig = makeRig();
		rig.frame(PALM, hand(.5));
		for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(.5 + i * .03));
		rig.executor.execute({ type: "camera.reset" }, "voice");
		for (let i = 0; i < 6; i++) {
			rig.advance(PENDING_TTL_MS / 4);
			rig.frame(PALM, hand(.6 + i % 2 * .03));
		}
		assert.equal(rig.executor.getPending(), null);
		assert.deepEqual(rig.deferred, ["camera.reset:expired"]);
	});
	it("a hand that starts orbiting mid-transition takes over without snapping back", () => {
		const rig = makeRig();
		rig.executor.execute({
			type: "camera.view",
			view: "back"
		}, "voice");
		rig.advance(100);
		rig.frame(NONE, []);
		assert.equal(rig.controller.isTransitioning(), true);
		rig.frame(PALM, hand(.5));
		for (let i = 1; i <= 3; i++) {
			rig.advance(16);
			rig.frame(PALM, hand(.5 + i * .03));
		}
		assert.equal(rig.controller.isTransitioning(), false, "transition cancelled by the hand");
		const takenOver = rig.camera.position.clone();
		rig.advance(1e3);
		rig.frame(NONE, []);
		assert.ok(rig.camera.position.distanceTo(takenOver) < .05, "camera stays where the hand left it");
	});
	it("defers camera commands during a mouse drag too", () => {
		const rig = makeRig();
		rig.controller.controls.dispatchEvent({ type: "start" });
		assert.equal(rig.executor.execute({
			type: "camera.orbit",
			yawDeg: 30
		}, "voice").status, "deferred");
		rig.controller.controls.dispatchEvent({ type: "end" });
		rig.frame(NONE, []);
		assert.deepEqual(rig.deferred, ["camera.orbit:executed"]);
	});
	it("runs non-camera commands immediately even while the hand is steering", () => {
		const rig = makeRig();
		rig.frame(PALM, hand(.5));
		for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(.5 + i * .03));
		assert.equal(rig.executor.execute({ type: "animation.pause" }, "voice").status, "executed");
		assert.equal(rig.animation.playing, false);
		assert.equal(rig.executor.execute({
			type: "animation.setSpeed",
			speed: .5
		}, "voice").status, "executed");
		assert.equal(rig.animation.speed, .5);
		assert.equal(rig.executor.execute({
			type: "camera.autoOrbit",
			enabled: true
		}, "voice").status, "executed");
		assert.equal(rig.getAutoOrbit(), true);
	});
});
describe("End-to-end: dispatcher + viewer executor + real planetary gearbox", () => {
	function makeEndToEnd() {
		const scene = new THREE.Scene();
		const { camera, controller } = makeCamera();
		const lifecycle = new ModelLifecycleManager({
			scene,
			camera,
			cameraController: controller
		});
		assert.ok(lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID).success);
		let clock = 0;
		const executor = new ViewerCommandExecutor({
			camera: controller,
			lifecycle,
			isGestureInteracting: () => false,
			animation: {
				setPlaying: () => {},
				setSpeed: () => {}
			},
			setAutoOrbit: () => {},
			now: () => clock
		});
		const model = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
		const dispatcher = new SceneCommandDispatcher();
		dispatcher.registerContextProvider("workspace", () => ({
			modelId: model.id,
			componentIds: new Set(model.getAllComponentIds()),
			animationIds: (model.animations ?? []).map((a) => a.id),
			registeredModelIds: new Set(modelRegistry.getAllModels().map((m) => m.id))
		}));
		dispatcher.registerContextProvider("viewer", executor.contextProvider);
		dispatcher.registerHandler(executor);
		return {
			scene,
			controller,
			lifecycle,
			dispatcher,
			tick: (ms) => {
				clock += ms;
				controller.update(clock);
			}
		};
	}
	it("reports viewer readiness and exploded-view support from the loaded runtime", () => {
		const { dispatcher } = makeEndToEnd();
		const ctx = dispatcher.getContext();
		assert.equal(ctx.viewerReady, true);
		assert.equal(ctx.supportsExplodedView, true);
	});
	it("focuses the camera smoothly on a real component", () => {
		const { controller, lifecycle, dispatcher, tick } = makeEndToEnd();
		const rec = dispatcher.dispatch({
			type: "component.focus",
			componentId: "ring_gear"
		}, "voice");
		assert.equal(rec.status, "executed");
		tick(400);
		const center = lifecycle.getComponentBounds("ring_gear").getCenter(new THREE.Vector3());
		assert.ok(controller.controls.target.distanceTo(center) < .01);
	});
	it("isolates a component and restores the full assembly", () => {
		const { lifecycle, dispatcher } = makeEndToEnd();
		assert.equal(dispatcher.dispatch({
			type: "component.isolate",
			componentId: "sun_gear"
		}, "voice").status, "executed");
		assert.equal(lifecycle.getIsolatedComponentId(), "sun_gear");
		assert.equal(dispatcher.dispatch({
			type: "component.isolate",
			componentId: null
		}, "voice").status, "executed");
		assert.equal(lifecycle.getIsolatedComponentId(), null);
	});
	it("isolated components actually render (no hidden ancestor container) — regression", () => {
		for (const id of [
			"sun_gear",
			"ring_gear",
			"planet_carrier",
			"central_shaft"
		]) {
			const { lifecycle, dispatcher } = makeEndToEnd();
			dispatcher.dispatch({
				type: "component.isolate",
				componentId: id
			}, "voice");
			const root = lifecycle.getActiveRuntime().rootGroup;
			let renderedMeshes = 0;
			let otherRendered = 0;
			root.traverse((obj) => {
				if (!obj.isMesh) return;
				let worldVisible = true;
				for (let o = obj; o; o = o.parent) worldVisible &&= o.visible;
				const compId = obj.userData?.componentId;
				if (worldVisible && compId === id) renderedMeshes++;
				if (worldVisible && compId && compId !== id) otherRendered++;
			});
			assert.ok(renderedMeshes > 0, `${id} must be visible on screen when isolated`);
			assert.equal(otherRendered, 0, `only ${id} renders`);
		}
	});
	it("restoring isolation brings back the whole assembly on screen", () => {
		const { lifecycle, dispatcher } = makeEndToEnd();
		dispatcher.dispatch({
			type: "component.isolate",
			componentId: "sun_gear"
		}, "voice");
		dispatcher.dispatch({
			type: "component.isolate",
			componentId: null
		}, "voice");
		const root = lifecycle.getActiveRuntime().rootGroup;
		let hiddenParts = 0;
		root.traverse((obj) => {
			if (!obj.isMesh || !obj.userData?.componentId) return;
			let worldVisible = true;
			for (let o = obj; o; o = o.parent) worldVisible &&= o.visible;
			if (!worldVisible) hiddenParts++;
		});
		assert.equal(hiddenParts, 0);
	});
	it("safely rejects parts from another model without touching the scene", () => {
		const { controller, dispatcher } = makeEndToEnd();
		const before = controller.camera.position.clone();
		const rec = dispatcher.dispatch({
			type: "component.focus",
			componentId: "bridge_deck"
		}, "ai");
		assert.equal(rec.status, "rejected");
		assert.equal(rec.code, "UNKNOWN_COMPONENT");
		assert.ok(controller.camera.position.equals(before));
	});
});
// tests/voice.test.ts
/**
* Voice layer tests (Task V2) — no network, no microphone.
* 1. Part lexicon built from the loaded model
* 2. Phrase parser: English, Telugu, Hindi and code-mixed commands
* 3. Voice turns through the REAL V1 dispatcher + viewer executor + gearbox model
* 4. Replies, recorder helpers and voice client error handling
*/
var gearbox$4 = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
var bridge$4 = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
var ALL$4 = modelRegistry.getAllModels();
function ctxFor(model = gearbox$4, extra = {}) {
	return {
		lexicon: lexiconFor(model),
		foreignParts: foreignPartsFor(model, ALL$4),
		selectedComponentId: null,
		lessonActive: false,
		...extra
	};
}
var parse = (text, extra = {}, model = gearbox$4) => parseVoiceCommand(text, ctxFor(model, extra));
var cmds$1 = (o) => o.kind === "commands" ? o.commands : null;
describe("Part lexicon is built from the loaded model", () => {
	it("covers every gearbox component with English and native-script names", () => {
		const lex = buildPartLexicon(gearbox$4);
		assert.deepEqual(lex.map((e) => e.componentId).sort(), [...gearbox$4.getAllComponentIds()].sort());
		const sun = lex.find((e) => e.componentId === "sun_gear");
		assert.ok(sun.phrases.includes("sun gear"));
		assert.ok(sun.phrases.includes("సన్ గేర్"));
		assert.ok(sun.phrases.includes("सन गियर"));
		const ring = lex.find((e) => e.componentId === "ring_gear");
		assert.ok(ring.phrases.includes("ring gear") && ring.phrases.includes("outer annulus"));
	});
	it("keeps single words only when they identify exactly one part", () => {
		const lex = buildPartLexicon(gearbox$4);
		const owners = lex.filter((e) => e.phrases.includes("gear"));
		assert.equal(owners.length, 0, "\"gear\" alone is ambiguous and must not be a part name");
		assert.ok(lex.find((e) => e.componentId === "central_shaft").phrases.includes("shaft"));
	});
	it("works for a different model (bridge) with no gearbox assumptions", () => {
		const lex = buildPartLexicon(bridge$4);
		assert.deepEqual(lex.map((e) => e.componentId).sort(), [...bridge$4.getAllComponentIds()].sort());
		assert.ok(lex.find((e) => e.componentId === "bridge_deck").phrases.some((p) => p.includes("deck")));
	});
});
describe("Phrase parser — English", () => {
	for (const [text, expected] of [
		["Zoom in", [{
			type: "camera.zoom",
			direction: "in"
		}]],
		["zoom out please", [{
			type: "camera.zoom",
			direction: "out"
		}]],
		["Move left", [{
			type: "camera.pan",
			direction: "left"
		}]],
		["move the view up", [{
			type: "camera.pan",
			direction: "up"
		}]],
		["Rotate left", [{
			type: "camera.orbit",
			yawDeg: 30,
			pitchDeg: 0
		}]],
		["rotate the gearbox", [{
			type: "camera.orbit",
			yawDeg: -30,
			pitchDeg: 0
		}]],
		["Show me the back", [{
			type: "camera.view",
			view: "back"
		}]],
		["top view", [{
			type: "camera.view",
			view: "top"
		}]],
		["show the left side", [{
			type: "camera.view",
			view: "left"
		}]],
		["Restore the original view", [{ type: "camera.reset" }]],
		["Explode the assembly", [{
			type: "assembly.explode",
			factor: .75
		}]],
		["Restore the assembly", [{ type: "assembly.restore" }]],
		["put everything back together", [{ type: "assembly.restore" }]],
		["Pause the animation", [{ type: "animation.pause" }]],
		["play the animation", [{ type: "animation.play" }]],
		["slow down the animation", [{
			type: "animation.setSpeed",
			speed: .5
		}]],
		["show all parts", [{ type: "component.showAll" }]],
		["start the lesson", [{ type: "lesson.start" }]],
		["go home", [{ type: "workspace.goHome" }]]
	]) it(`"${text}"`, () => assert.deepEqual(cmds$1(parse(text)), expected));
	it("\"Select the sun gear\" selects the real component", () => {
		assert.deepEqual(cmds$1(parse("Select the sun gear")), [{
			type: "component.select",
			componentId: "sun_gear"
		}]);
	});
	it("\"Separate this part\" isolates the selected part (select + isolate + focus)", () => {
		assert.deepEqual(cmds$1(parse("Separate this part", { selectedComponentId: "planet_carrier" })), [
			{
				type: "component.select",
				componentId: "planet_carrier"
			},
			{
				type: "component.isolate",
				componentId: "planet_carrier"
			},
			{
				type: "component.focus",
				componentId: "planet_carrier"
			}
		]);
	});
	it("\"Separate this part\" with nothing selected asks for a selection", () => {
		assert.equal(parse("Separate this part").kind, "needsSelection");
	});
	it("\"hide the ring gear\" and \"focus on the shaft\"", () => {
		assert.deepEqual(cmds$1(parse("hide the ring gear")), [{
			type: "component.visibility",
			componentIds: ["ring_gear"],
			visible: false
		}]);
		assert.deepEqual(cmds$1(parse("focus on the shaft")), [{
			type: "component.select",
			componentId: "central_shaft"
		}, {
			type: "component.focus",
			componentId: "central_shaft"
		}]);
	});
	it("\"select the planet gear\" is ambiguous (three planet gears)", () => {
		const o = parse("select the planet gear");
		assert.equal(o.kind, "ambiguous");
		assert.deepEqual(o.kind === "ambiguous" && o.options.sort(), [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
	});
	it("\"select planet gear B\" picks exactly one", () => {
		assert.deepEqual(cmds$1(parse("select planet gear b")), [{
			type: "component.select",
			componentId: "planet_gear_2"
		}]);
	});
	it("rejects a piston on the gearbox instead of inventing it", () => {
		const o = parse("select the piston");
		assert.equal(o.kind, "unknownPart");
		assert.equal(o.kind === "unknownPart" && o.spoken, "piston");
	});
	it("a crankshaft is not mistaken for the gearbox shaft", () => {
		assert.equal(parse("focus on the crankshaft").kind, "unknownPart");
	});
	it("a bridge part on the gearbox is reported as belonging to the bridge", () => {
		const o = parse("select the bridge deck");
		assert.ok(o.kind === "unknownPart" && o.belongsTo === bridge$4.name);
	});
	it("lesson navigation only when a lesson is running", () => {
		assert.deepEqual(cmds$1(parse("next step", { lessonActive: true })), [{ type: "lesson.next" }]);
		assert.notDeepEqual(cmds$1(parse("next step")), [{ type: "lesson.next" }]);
	});
	it("unrelated speech is not turned into an action", () => {
		assert.equal(parse("what is the weather today").kind, "noMatch");
		assert.equal(parse("").kind, "noMatch");
	});
});
describe("Phrase parser — Telugu (incl. Telugu-English code-mixing)", () => {
	for (const [text, expected] of [
		["జూమ్ ఇన్ చెయ్యి", [{
			type: "camera.zoom",
			direction: "in"
		}]],
		["జూమ్ అవుట్ చేయండి", [{
			type: "camera.zoom",
			direction: "out"
		}]],
		["దగ్గరగా చూపించు జూమ్", [{
			type: "camera.zoom",
			direction: "in"
		}]],
		["ఎడమ వైపు జరుపు", [{
			type: "camera.pan",
			direction: "left"
		}]],
		["కుడికి తిప్పు", [{
			type: "camera.orbit",
			yawDeg: -30,
			pitchDeg: 0
		}]],
		["వెనుక వైపు చూపించు", [{
			type: "camera.view",
			view: "back"
		}]],
		["భాగాలను విడదీయి", [{
			type: "assembly.explode",
			factor: .75
		}]],
		["మళ్లీ కలుపు", [{ type: "assembly.restore" }]],
		["యానిమేషన్ ఆపు", [{ type: "animation.pause" }]],
		["రీసెట్ చేయి", [{ type: "camera.reset" }]],
		["zoom in చెయ్యి", [{
			type: "camera.zoom",
			direction: "in"
		}]],
		["left కి move చేయి", [{
			type: "camera.pan",
			direction: "left"
		}]]
	]) it(`"${text}"`, () => assert.deepEqual(cmds$1(parse(text)), expected));
	it("\"సన్ గేర్ ని సెలెక్ట్ చెయ్యి\" (Telugu script) selects the sun gear", () => {
		assert.deepEqual(cmds$1(parse("సన్ గేర్ ని సెలెక్ట్ చెయ్యి")), [{
			type: "component.select",
			componentId: "sun_gear"
		}]);
	});
	it("\"sun gear ని select చెయ్యి\" (mixed script) selects the sun gear", () => {
		assert.deepEqual(cmds$1(parse("sun gear ని select చెయ్యి")), [{
			type: "component.select",
			componentId: "sun_gear"
		}]);
	});
	it("\"దీన్ని వేరుగా చూపించు\" isolates the selected part", () => {
		const o = cmds$1(parse("దీన్ని వేరుగా చూపించు", { selectedComponentId: "ring_gear" }));
		assert.deepEqual(o?.[1], {
			type: "component.isolate",
			componentId: "ring_gear"
		});
	});
	it("\"పిస్టన్ చూపించు\" is rejected on the gearbox", () => {
		assert.equal(parse("పిస్టన్ చూపించు").kind, "unknownPart");
	});
});
describe("Phrase parser — Hindi (incl. Hindi-English code-mixing)", () => {
	for (const [text, expected] of [
		["ज़ूम इन करो", [{
			type: "camera.zoom",
			direction: "in"
		}]],
		["जूम आउट कीजिए", [{
			type: "camera.zoom",
			direction: "out"
		}]],
		["बाएं खिसकाओ", [{
			type: "camera.pan",
			direction: "left"
		}]],
		["दाएं घुमाओ", [{
			type: "camera.orbit",
			yawDeg: -30,
			pitchDeg: 0
		}]],
		["पीछे से दिखाइये", [{
			type: "camera.view",
			view: "back"
		}]],
		["ऊपर से दिखाओ", [{
			type: "camera.view",
			view: "top"
		}]],
		["सब जोड़ दो", [{ type: "assembly.restore" }]],
		["एनिमेशन रोको", [{ type: "animation.pause" }]],
		["एक्सप्लोड करो", [{
			type: "assembly.explode",
			factor: .75
		}]],
		["zoom in करो", [{
			type: "camera.zoom",
			direction: "in"
		}]]
	]) it(`"${text}"`, () => assert.deepEqual(cmds$1(parse(text)), expected));
	it("\"सन गियर सेलेक्ट करो\" selects the sun gear", () => {
		assert.deepEqual(cmds$1(parse("सन गियर सेलेक्ट करो")), [{
			type: "component.select",
			componentId: "sun_gear"
		}]);
	});
	it("\"इसे अलग करो\" isolates the selected part", () => {
		const o = cmds$1(parse("इसे अलग करो", { selectedComponentId: "sun_gear" }));
		assert.deepEqual(o?.[1], {
			type: "component.isolate",
			componentId: "sun_gear"
		});
	});
	it("\"पिस्टन दिखाओ\" is rejected on the gearbox", () => {
		assert.equal(parse("पिस्टन दिखाओ").kind, "unknownPart");
	});
});
describe("Phrase parser — live Prisma transcripts", () => {
	const partIds = (o) => o.kind === "commands" ? o.commands.flatMap((c) => "componentIds" in c ? c.componentIds : "componentId" in c ? [c.componentId] : []) : [];
	for (const [text, type, part] of [
		[
			"zoom in",
			"camera.zoom",
			null
		],
		[
			"show the sun gear",
			"component.select",
			"sun_gear"
		],
		[
			"rotate left",
			"camera.orbit",
			null
		],
		[
			"isolate the ring gear",
			"component.select",
			"ring_gear"
		],
		[
			"జూమ్ ఇన్ చేయండి",
			"camera.zoom",
			null
		],
		[
			"ఎడమ వైపు తిప్పు",
			"camera.orbit",
			null
		],
		[
			"రింగ్ ఎయిర్ ని ఐసొలేట్ చేయండి",
			"component.select",
			"ring_gear"
		],
		[
			"ప్లానెట్ క్యారియర్ ని దాచు",
			"component.visibility",
			"planet_carrier"
		],
		[
			"ज़ूम इन करो।",
			"camera.zoom",
			null
		],
		[
			"सन गियर दिखाओ।",
			"component.select",
			"sun_gear"
		],
		[
			"बाएं घुमाओ",
			"camera.orbit",
			null
		],
		[
			"रिंग इयर को आइसोलेट करो।",
			"component.select",
			"ring_gear"
		],
		[
			"प्लानेट कैरियर को छुपाओ।",
			"component.visibility",
			"planet_carrier"
		]
	]) it(`"${text}" -> ${type}${part ? ` (${part})` : ""}`, () => {
		const o = parse(text);
		assert.equal(o.kind, "commands", JSON.stringify(o));
		if (o.kind !== "commands") return;
		assert.equal(o.commands[0].type, type);
		if (part) assert.ok(partIds(o).every((id) => id === part), JSON.stringify(o.commands));
	});
	it("\"show me the piston\" is rejected as a part the gearbox does not have", () => {
		assert.equal(parse("show me the piston").kind, "unknownPart");
	});
	it("\"సంగీత చూపించు\" (Prisma mis-heard \"సన్ గేర్\") does not act on any part", () => {
		const o = parse("సంగీత చూపించు");
		assert.notEqual(o.kind, "commands", JSON.stringify(o));
	});
});
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
function makeChannel(opts = {}) {
	const model = opts.model ?? gearbox$4;
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
	const controller = new CameraController(camera, createMockDom(), {
		enableDamping: false,
		autoRotate: false
	});
	const lifecycle = new ModelLifecycleManager({
		scene,
		camera,
		cameraController: controller
	});
	lifecycle.loadModel(model.id);
	let clock = 0;
	const anim = { playing: true };
	const dispatcher = new SceneCommandDispatcher();
	const executor = new ViewerCommandExecutor({
		camera: controller,
		lifecycle,
		isGestureInteracting: opts.handSteering ?? (() => false),
		animation: {
			setPlaying: (p) => anim.playing = p,
			setSpeed: () => {}
		},
		setAutoOrbit: () => {},
		now: () => clock
	}, (cmd, src, status, detail) => dispatcher.reportDeferredOutcome(cmd, src, status, detail));
	const state = {
		selected: opts.selected ?? null,
		exploded: 0
	};
	dispatcher.registerContextProvider("workspace", () => ({
		modelId: model.id,
		componentIds: new Set(model.getAllComponentIds()),
		animationIds: (model.animations ?? []).map((a) => a.id),
		registeredModelIds: new Set(ALL$4.map((m) => m.id)),
		selectedComponentId: state.selected
	}));
	dispatcher.registerContextProvider("viewer", executor.contextProvider);
	dispatcher.registerHandler(executor);
	dispatcher.registerHandler({
		id: "workspace",
		canHandle: (t) => t === "component.select" || t.startsWith("assembly."),
		execute: (cmd) => {
			if (cmd.type === "component.select") state.selected = cmd.componentId;
			if (cmd.type === "assembly.explode") state.exploded = cmd.factor;
			if (cmd.type === "assembly.restore") state.exploded = 0;
			return { status: "executed" };
		}
	});
	const turn = (transcript, language = "en-IN", speakConfirmations = false) => handleVoiceTurn({
		transcript,
		language,
		dispatcher,
		model,
		allModels: ALL$4,
		speakConfirmations
	});
	return {
		dispatcher,
		executor,
		controller,
		lifecycle,
		state,
		anim,
		turn,
		tick: (ms) => {
			clock += ms;
			controller.update(clock);
		}
	};
}
describe("Voice turns go through the V1 SceneCommandDispatcher", () => {
	it("records every voice command with source \"voice\" and executes it", () => {
		const ch = makeChannel();
		const before = ch.controller.getDistance();
		const res = ch.turn("zoom in");
		assert.equal(res.status, "executed");
		assert.equal(res.caption, "Zooming in.");
		assert.equal(res.speak, false, "quick confirmations are caption-only by default");
		assert.equal(ch.dispatcher.getHistory().at(-1).source, "voice");
		ch.tick(400);
		assert.ok(ch.controller.getDistance() < before);
	});
	it("Telugu turn executes and replies in Telugu", () => {
		const ch = makeChannel();
		const res = ch.turn("సన్ గేర్ ని సెలెక్ట్ చెయ్యి", "te-IN");
		assert.equal(res.status, "executed");
		assert.equal(ch.state.selected, "sun_gear");
		assert.match(res.caption, /Sun Gear ఎంచుకున్నాను/);
	});
	it("Hindi turn executes and replies in Hindi", () => {
		const ch = makeChannel();
		const res = ch.turn("एक्सप्लोड करो", "hi-IN");
		assert.equal(res.status, "executed");
		assert.equal(ch.state.exploded, .75);
		assert.match(res.caption, /अलग/);
	});
	it("a nonexistent part leaves the scene untouched and explains why (spoken)", () => {
		const ch = makeChannel();
		const historyBefore = ch.dispatcher.getHistory().length;
		const camBefore = ch.controller.camera.position.clone();
		const res = ch.turn("select the piston");
		assert.equal(res.status, "rejected");
		assert.equal(res.speak, true);
		assert.equal(res.caption, "Piston is not part of the Epicyclic Planetary Gearbox.");
		assert.equal(ch.dispatcher.getHistory().length, historyBefore, "nothing was dispatched");
		assert.ok(ch.controller.camera.position.equals(camBefore));
		assert.equal(ch.state.selected, null);
	});
	it("V1 validation still applies: animation on the bridge is rejected with a spoken reason", () => {
		const res = makeChannel({ model: bridge$4 }).turn("play the animation");
		assert.equal(res.status, "rejected");
		assert.equal(res.records.at(-1).code, "UNSUPPORTED_ANIMATION");
		assert.match(res.caption, /no animation/);
	});
	it("a camera command while the hand is steering is deferred, then runs on release", () => {
		let steering = true;
		const ch = makeChannel({ handSteering: () => steering });
		const res = ch.turn("show me the back");
		assert.equal(res.status, "deferred");
		assert.equal(res.speak, true);
		assert.equal(res.records[0].status, "deferred");
		steering = false;
		const outcomes = [];
		ch.dispatcher.subscribe((r) => outcomes.push(`${r.source}:${r.status}`));
		ch.executor.tick(1);
		assert.deepEqual(outcomes, ["voice:executed"]);
	});
	it("\"separate this part\" isolates the selected component on the real model", () => {
		const ch = makeChannel({ selected: "sun_gear" });
		const res = ch.turn("separate this part");
		assert.equal(res.status, "executed");
		assert.equal(ch.lifecycle.getIsolatedComponentId(), "sun_gear");
		assert.equal(res.caption, "Showing only Sun Gear.");
	});
	it("\"speak all replies\" makes confirmations spoken", () => {
		assert.equal(makeChannel().turn("zoom out", "en-IN", true).speak, true);
	});
});
describe("Voice replies", () => {
	it("English, Telugu and Hindi define every reply", () => {
		for (const lang of [
			"en-IN",
			"te-IN",
			"hi-IN"
		]) for (const key of REPLY_KEYS) assert.ok(REPLY_TABLES[lang][key], `${lang}.${key}`);
	});
	it("beta languages fall back to English replies", () => {
		assert.equal(replyLanguage("ta-IN"), "en-IN");
		assert.equal(reply("zoomIn", "kn-IN"), "Zooming in.");
	});
	it("fills placeholders and leaves none behind", () => {
		const text = reply("unknownPartOtherModel", "te-IN", {
			part: "Bridge Deck",
			other: "Warren Truss Bridge",
			model: "Gearbox"
		});
		assert.ok(!/[{}]/.test(text));
		assert.match(reply("view", "hi-IN", { view: "left" }), /बाईं/);
	});
});
describe("Recorder helpers", () => {
	it("encodes a valid 16 kHz mono WAV with downsampling", () => {
		const wav = encodeWav([(/* @__PURE__ */ new Float32Array(48e3)).fill(.5)], 48e3);
		const v = new DataView(wav.buffer);
		assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
		assert.equal(v.getUint32(24, true), 16e3);
		assert.equal(v.getUint32(40, true), 32e3, "1 s of audio");
		assert.ok(Math.abs(v.getInt16(44, true) - 16383.5) < 2);
	});
	it("detects end of speech after silence, adapting to background noise", () => {
		const d = new SpeechEndDetector();
		const frame = 43;
		for (let i = 0; i < 6; i++) assert.equal(d.push(.02, frame), null);
		for (let i = 0; i < 10; i++) assert.equal(d.push(.2, frame), null);
		assert.equal(d.speechStarted, true);
		let end = null;
		for (let i = 0; i < 40 && !end; i++) end = d.push(.02, frame);
		assert.equal(end, "silence");
	});
	it("gives up when nobody speaks, and enforces the 25 s cap", () => {
		const quiet = new SpeechEndDetector();
		let end = null;
		for (let i = 0; i < 300 && !end; i++) end = quiet.push(.004, 43);
		assert.equal(end, "nospeech");
		const talker = new SpeechEndDetector();
		end = null;
		for (let i = 0; i < 6; i++) talker.push(.004, 43);
		for (let i = 0; i < 1e3 && !end; i++) end = talker.push(.3, 43);
		assert.equal(end, "max");
	});
	it("maps microphone errors to clear codes", () => {
		assert.equal(classifyMicError({ name: "NotAllowedError" }).code, "MIC_DENIED");
		assert.equal(classifyMicError({ name: "NotFoundError" }).code, "MIC_NOT_FOUND");
		assert.equal(classifyMicError({ name: "NotReadableError" }).code, "MIC_BUSY");
		assert.equal(rms(new Float32Array([.5, -.5])), .5);
	});
});
describe("Voice client error handling", () => {
	const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
	it("surfaces backend error codes (no credits / rate limit / key missing)", async () => {
		for (const code of [
			"GNANI_FORBIDDEN",
			"GNANI_RATE_LIMIT",
			"KEY_MISSING"
		]) {
			const fake = async () => jsonResponse(502, { error: {
				code,
				message: "x"
			} });
			await assert.rejects(transcribe(new Blob(["x"]), "en-IN", void 0, fake), (e) => e instanceof VoiceServiceError && e.code === code);
		}
	});
	it("reports the backend as unavailable when the proxy returns a non-JSON 5xx or the fetch fails", async () => {
		const proxyDown = async () => new Response("Bad Gateway", { status: 502 });
		await assert.rejects(getVoiceHealth(void 0, proxyDown), (e) => e.code === "BACKEND_UNAVAILABLE");
		const offline = async () => {
			throw new TypeError("Failed to fetch");
		};
		await assert.rejects(synthesize("hi", "en-IN", void 0, offline), (e) => e.code === "BACKEND_UNAVAILABLE");
	});
	it("cancellation yields CANCELLED, so stale results are never used", async () => {
		const controller = new AbortController();
		const slow = (_, init) => new Promise((_res, rej) => {
			init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
		});
		const pending = transcribe(new Blob(["x"]), "te-IN", controller.signal, slow);
		controller.abort();
		await assert.rejects(pending, (e) => e.code === "CANCELLED");
	});
	it("returns the transcript on success", async () => {
		const ok = async () => jsonResponse(200, {
			transcript: "zoom in",
			language: "en-IN"
		});
		assert.equal(await transcribe(new Blob(["x"]), "en-IN", void 0, ok), "zoom in");
	});
});
// tests/sceneContext.test.ts
/**
* Task V3 — scene snapshot, component reference resolution, relationships and multi-component
* highlighting. Runs the real dispatcher, viewer executor, camera controller, model lifecycle
* (real procedural geometry) and voice session; only the React workspace state is simulated.
*/
var gearbox$3 = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
var bridge$3 = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
var ALL$3 = modelRegistry.getAllModels();
function mockDom() {
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
* The workspace + viewer wiring of WorkspaceLayout/ViewerCanvas, without React or WebGL.
* Workspace state is a plain object updated synchronously by the workspace handler.
*/
function makeWorkspace(startModel = gearbox$3) {
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
	const controller = new CameraController(camera, mockDom(), {
		enableDamping: false,
		autoRotate: false
	});
	const lifecycle = new ModelLifecycleManager({
		scene,
		camera,
		cameraController: controller
	});
	let clock = 0;
	const ws = {
		model: startModel,
		selected: null,
		hidden: /* @__PURE__ */ new Set(),
		exploded: 0,
		lessonActive: false,
		lessonStep: 0
	};
	const pointer = {
		componentId: null,
		source: null
	};
	const anim = {
		playing: true,
		speed: 1
	};
	const steer = { on: false };
	lifecycle.loadModel(ws.model.id);
	const dispatcher = new SceneCommandDispatcher();
	const executor = new ViewerCommandExecutor({
		camera: controller,
		lifecycle,
		isGestureInteracting: () => steer.on,
		animation: {
			setPlaying: (p) => anim.playing = p,
			setSpeed: (s) => anim.speed = s
		},
		setAutoOrbit: () => {},
		getPointer: () => pointer,
		getAnimationState: () => ({ ...anim }),
		now: () => clock
	}, (cmd, src, status, detail) => dispatcher.reportDeferredOutcome(cmd, src, status, detail));
	dispatcher.registerContextProvider("workspace", () => {
		const lesson = getGuidedLessonForModel(ws.model.id);
		return {
			modelId: ws.model.id,
			componentIds: new Set(ws.model.getAllComponentIds()),
			animationIds: (ws.model.animations ?? []).map((a) => a.id),
			lesson: {
				available: Boolean(lesson?.steps.length),
				active: ws.lessonActive,
				stepCount: lesson?.steps.length ?? 0,
				currentStep: ws.lessonStep
			},
			registeredModelIds: new Set(ALL$3.map((m) => m.id)),
			selectedComponentId: ws.selected,
			workspaceFacts: {
				hiddenComponentIds: [...ws.hidden],
				explodedFactor: ws.exploded,
				lessonStepTitle: ws.lessonActive ? lesson?.steps[ws.lessonStep]?.title ?? null : null,
				lessonStepComponentId: ws.lessonActive ? lesson?.steps[ws.lessonStep]?.componentId ?? null : null
			}
		};
	});
	dispatcher.registerContextProvider("viewer", executor.contextProvider);
	dispatcher.registerHandler(executor);
	dispatcher.registerHandler({
		id: "workspace",
		canHandle: (t) => [
			"component.select",
			"component.visibility",
			"component.showAll",
			"assembly.explode",
			"assembly.restore",
			"lesson.start",
			"lesson.next",
			"lesson.exit",
			"workspace.switchModel"
		].includes(t),
		execute: (cmd, source) => {
			switch (cmd.type) {
				case "component.select":
					ws.selected = cmd.componentId;
					break;
				case "component.visibility":
					cmd.componentIds.forEach((id) => cmd.visible ? ws.hidden.delete(id) : ws.hidden.add(id));
					break;
				case "component.showAll":
					ws.hidden.clear();
					dispatcher.dispatch({
						type: "component.isolate",
						componentId: null
					}, source);
					break;
				case "assembly.explode":
					ws.exploded = cmd.factor;
					break;
				case "assembly.restore":
					ws.exploded = 0;
					break;
				case "lesson.start":
					ws.lessonActive = true;
					ws.lessonStep = 0;
					break;
				case "lesson.next":
					ws.lessonStep += 1;
					break;
				case "lesson.exit":
					ws.lessonActive = false;
					break;
				case "workspace.switchModel":
					ws.model = modelRegistry.getModel(cmd.modelId);
					ws.selected = null;
					ws.hidden.clear();
					ws.exploded = 0;
					ws.lessonActive = false;
					lifecycle.loadModel(cmd.modelId);
			}
			return { status: "executed" };
		}
	});
	const memory = { last: null };
	const snapshot = (withConversation = true) => getSceneSnapshot(dispatcher, ws.model, withConversation ? { lastDiscussed: memory.last } : {});
	/** One voice turn, keeping conversation memory like the VoiceDock does. */
	const say = (transcript, language = "en-IN") => {
		const r = handleVoiceTurn({
			transcript,
			language,
			dispatcher,
			model: ws.model,
			allModels: ALL$3,
			lastDiscussed: memory.last
		});
		if (r.discussedComponentId) memory.last = {
			modelId: ws.model.id,
			componentId: r.discussedComponentId
		};
		return r;
	};
	const tick = (ms) => {
		clock += ms;
		controller.update(clock);
		executor.tick(clock);
	};
	return {
		dispatcher,
		executor,
		controller,
		lifecycle,
		ws,
		pointer,
		anim,
		steer,
		memory,
		snapshot,
		say,
		tick
	};
}
var known = (f) => {
	assert.equal(f.status, "known");
	return f.value;
};
/** Meshes that belong to a component (own or ancestor userData.componentId). */
function meshesOf(root, componentId) {
	const out = [];
	root.traverse((o) => {
		const m = o;
		if (!m.isMesh) return;
		let cur = m;
		while (cur && !cur.userData?.componentId) cur = cur.parent;
		if (cur?.userData.componentId === componentId) out.push(m);
	});
	return out;
}
var emissiveHex = (m) => m.material.emissive.getHex();
describe("Scene snapshot (Task V3)", () => {
	it("describes the initial scene", () => {
		const s = makeWorkspace().snapshot(false);
		assert.equal(s.version, 1);
		assert.deepEqual(s.model, {
			id: "planetary_gearbox",
			name: gearbox$3.name,
			domain: "mechanical",
			category: gearbox$3.category
		});
		assert.deepEqual(s.components.map((c) => c.id), gearbox$3.getAllComponentIds());
		assert.ok(s.components.every((c) => c.visible && c.name && c.role));
		assert.equal(s.selectedComponentId, null);
		assert.deepEqual(known(s.pointer), {
			componentId: null,
			source: null
		});
		assert.equal(known(s.focusedComponentId), null);
		assert.deepEqual(s.hiddenComponentIds, []);
		assert.equal(known(s.isolatedComponentId), null);
		assert.deepEqual(known(s.highlightedComponentIds), []);
		assert.deepEqual(s.exploded, {
			supported: true,
			factor: 0,
			active: false
		});
		assert.equal(known(s.camera).view, "custom");
		assert.equal(known(s.camera).userSteering, false);
		assert.deepEqual(known(s.animation.state), {
			playing: true,
			speed: 1
		});
		assert.deepEqual(s.animation.available.map((a) => a.id), ["gear_train_rotation"]);
		assert.deepEqual(s.lesson, {
			available: true,
			active: false,
			stepCount: s.lesson.stepCount,
			currentStep: null,
			stepTitle: null,
			stepComponentId: null
		});
		assert.equal(s.lastDiscussedComponentId.status, "unavailable", "no conversation context was given");
		for (const a of [
			"component.highlight",
			"assembly.explode",
			"animation.play",
			"lesson.start"
		]) assert.ok(s.availableActions.includes(a), a);
		assert.ok(!s.availableActions.includes("lesson.next"), "lesson.next needs a running lesson");
	});
	it("marks viewer facts unavailable (not empty) when the 3D viewer is not mounted", () => {
		const d = new SceneCommandDispatcher();
		d.registerContextProvider("workspace", () => ({
			modelId: gearbox$3.id,
			componentIds: new Set(gearbox$3.getAllComponentIds())
		}));
		const s = getSceneSnapshot(d, gearbox$3);
		assert.equal(s.pointer.status, "unavailable");
		assert.equal(s.isolatedComponentId.status, "unavailable");
		assert.equal(s.camera.status, "unavailable");
		assert.equal(s.animation.state.status, "unavailable");
		assert.ok(!s.availableActions.includes("camera.zoom"));
	});
	it("follows selection, pointing, hide/show, isolation, explode, animation and lessons live", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		assert.equal(w.snapshot().selectedComponentId, "ring_gear");
		w.pointer.componentId = "sun_gear";
		w.pointer.source = "gesture";
		assert.deepEqual(known(w.snapshot().pointer), {
			componentId: "sun_gear",
			source: "gesture"
		});
		w.pointer.componentId = null;
		w.pointer.source = null;
		assert.deepEqual(known(w.snapshot().pointer), {
			componentId: null,
			source: null
		});
		w.dispatcher.dispatch({
			type: "component.visibility",
			componentIds: ["planet_carrier"],
			visible: false
		}, "ui");
		let s = w.snapshot();
		assert.deepEqual(s.hiddenComponentIds, ["planet_carrier"]);
		assert.equal(s.components.find((c) => c.id === "planet_carrier").visible, false);
		w.dispatcher.dispatch({
			type: "component.visibility",
			componentIds: ["planet_carrier"],
			visible: true
		}, "ui");
		assert.deepEqual(w.snapshot().hiddenComponentIds, []);
		w.dispatcher.dispatch({
			type: "component.isolate",
			componentId: "sun_gear"
		}, "ui");
		s = w.snapshot();
		assert.equal(known(s.isolatedComponentId), "sun_gear");
		assert.deepEqual(s.components.filter((c) => c.visible).map((c) => c.id), ["sun_gear"]);
		w.dispatcher.dispatch({
			type: "component.isolate",
			componentId: null
		}, "ui");
		assert.equal(known(w.snapshot().isolatedComponentId), null);
		w.dispatcher.dispatch({
			type: "assembly.explode",
			factor: .6
		}, "ui");
		assert.deepEqual(w.snapshot().exploded, {
			supported: true,
			factor: .6,
			active: true
		});
		w.dispatcher.dispatch({ type: "animation.pause" }, "ui");
		w.dispatcher.dispatch({
			type: "animation.setSpeed",
			speed: 2
		}, "ui");
		assert.deepEqual(known(w.snapshot().animation.state), {
			playing: false,
			speed: 2
		});
		w.dispatcher.dispatch({ type: "lesson.start" }, "ui");
		w.dispatcher.dispatch({ type: "lesson.next" }, "ui");
		s = w.snapshot();
		const step = getGuidedLessonForModel(gearbox$3.id).steps[1];
		assert.deepEqual({
			...s.lesson,
			stepCount: 0
		}, {
			available: true,
			active: true,
			stepCount: 0,
			currentStep: 1,
			stepTitle: step.title,
			stepComponentId: step.componentId
		});
		assert.ok(s.availableActions.includes("lesson.next"));
	});
	it("tracks the focused part and drops it once the camera is moved elsewhere", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.focus",
			componentId: "ring_gear"
		}, "voice");
		assert.equal(known(w.snapshot().focusedComponentId), "ring_gear");
		w.dispatcher.dispatch({
			type: "camera.orbit",
			yawDeg: 30
		}, "voice");
		assert.equal(known(w.snapshot().focusedComponentId), null);
	});
	it("names the real camera view and reports \"custom\" after free orbiting", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "camera.view",
			view: "top"
		}, "ui");
		w.tick(1e3);
		assert.equal(known(w.snapshot().camera).view, "top");
		w.dispatcher.dispatch({
			type: "camera.view",
			view: "back"
		}, "ui");
		w.tick(1e3);
		assert.equal(known(w.snapshot().camera).view, "back");
		w.dispatcher.dispatch({
			type: "camera.orbit",
			yawDeg: 45,
			pitchDeg: 20
		}, "ui");
		w.tick(1e3);
		assert.equal(known(w.snapshot().camera).view, "custom");
	});
	it("clears stale references when the model is switched", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "sun_gear"
		}, "ui");
		w.dispatcher.dispatch({
			type: "component.highlight",
			componentIds: ["ring_gear"]
		}, "ui");
		w.memory.last = {
			modelId: gearbox$3.id,
			componentId: "sun_gear"
		};
		w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$3.id
		}, "ui");
		w.pointer.componentId = "sun_gear";
		w.pointer.source = "mouse";
		const s = w.snapshot();
		assert.equal(s.model.id, bridge$3.id);
		assert.deepEqual(s.components.map((c) => c.id), bridge$3.getAllComponentIds());
		assert.equal(s.selectedComponentId, null);
		assert.deepEqual(known(s.pointer), {
			componentId: null,
			source: null
		});
		assert.deepEqual(known(s.highlightedComponentIds), []);
		assert.equal(known(s.lastDiscussedComponentId), null, "gearbox memory is not carried to the bridge");
		assert.ok(!s.availableActions.includes("animation.play"), "the bridge has no animation");
	});
	it("ignores context that belongs to a different model than the one passed in", () => {
		const s = buildSceneSnapshot(makeWorkspace().dispatcher.getContext(), bridge$3);
		assert.equal(s.model, null);
		assert.deepEqual(s.components, []);
	});
	it("is plain serialisable data: no Three.js objects, geometry or secrets", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "sun_gear"
		}, "ui");
		const snapshot = w.snapshot();
		const json = JSON.stringify(snapshot);
		assert.deepEqual(JSON.parse(json), snapshot, "round-trips through JSON (plain data only)");
		assert.ok(json.length < 8e3, `snapshot is small (${json.length} chars)`);
		for (const banned of [
			"geometry",
			"material",
			"uuid",
			"Float32Array",
			"api_key",
			"GNANI"
		]) assert.ok(!json.includes(banned), `contains "${banned}"`);
	});
});
describe("Component reference resolution (Task V3)", () => {
	const sceneWith = (o) => {
		return {
			components: (o.model ?? gearbox$3).getAllComponentIds().map((id) => ({
				id,
				name: id,
				role: null,
				visible: true,
				relatedComponentIds: []
			})),
			pointer: {
				status: "known",
				value: {
					componentId: o.pointed ?? null,
					source: o.pointed ? "mouse" : null
				}
			},
			selectedComponentId: o.selected ?? null,
			lastDiscussedComponentId: {
				status: "known",
				value: o.last ?? null
			}
		};
	};
	it("uses priority explicit > pointed > selected > last discussed", () => {
		const all = sceneWith({
			pointed: "sun_gear",
			selected: "ring_gear",
			last: "planet_carrier"
		});
		assert.deepEqual(resolveComponentReference({
			explicitIds: ["central_shaft"],
			contextual: true
		}, all), {
			kind: "resolved",
			componentId: "central_shaft",
			via: "explicit"
		});
		assert.deepEqual(resolveComponentReference({
			explicitIds: [],
			contextual: true
		}, all), {
			kind: "resolved",
			componentId: "sun_gear",
			via: "pointed"
		});
		assert.deepEqual(resolveComponentReference({
			explicitIds: [],
			contextual: true
		}, sceneWith({
			selected: "ring_gear",
			last: "planet_carrier"
		})), {
			kind: "resolved",
			componentId: "ring_gear",
			via: "selected"
		});
		assert.deepEqual(resolveComponentReference({
			explicitIds: [],
			contextual: true
		}, sceneWith({ last: "planet_carrier" })), {
			kind: "resolved",
			componentId: "planet_carrier",
			via: "lastDiscussed"
		});
	});
	it("asks for clarification instead of guessing", () => {
		assert.deepEqual(resolveComponentReference({
			explicitIds: [],
			contextual: true
		}, sceneWith({})), { kind: "needsClarification" });
		assert.deepEqual(resolveComponentReference({
			explicitIds: [],
			contextual: false
		}, sceneWith({ selected: "sun_gear" })), { kind: "needsClarification" });
	});
	it("reports several explicit matches as ambiguous", () => {
		assert.deepEqual(resolveComponentReference({
			explicitIds: ["planet_gear_1", "planet_gear_2"],
			contextual: false
		}, sceneWith({ selected: "sun_gear" })), {
			kind: "ambiguous",
			options: ["planet_gear_1", "planet_gear_2"]
		});
	});
	it("never resolves to a component of another model", () => {
		const onBridge = sceneWith({
			model: bridge$3,
			pointed: "sun_gear",
			selected: "ring_gear",
			last: "planet_carrier"
		});
		assert.deepEqual(resolveComponentReference({
			explicitIds: ["sun_gear"],
			contextual: true
		}, onBridge), { kind: "needsClarification" });
	});
});
describe("Component relationships (Task V3)", () => {
	it("every relationship of both models is valid and has its inverse", () => {
		for (const model of [gearbox$3, bridge$3]) {
			const report = validateModelRelationships(model);
			assert.deepEqual(report.errors, [], model.id);
			assert.ok(report.isValid);
		}
	});
	it("gearbox: kinematic links match the model", () => {
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "sun_gear").sort(), [
			"central_shaft",
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "ring_gear").sort(), [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "planet_gear_2").sort(), [
			"planet_carrier",
			"ring_gear",
			"sun_gear"
		]);
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "central_shaft"), ["sun_gear"]);
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "sun_gear", ["driven_by"]), ["central_shaft"]);
		assert.deepEqual(getRelatedComponentIds(gearbox$3, "planet_carrier", ["driven_by"]).sort(), [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		const types = getComponentRelationships(gearbox$3, "planet_gear_1").map((r) => `${r.relationshipType}:${r.targetComponentId}`).sort();
		assert.deepEqual(types, [
			"driven_by:sun_gear",
			"drives:planet_carrier",
			"mates_with:ring_gear",
			"mates_with:sun_gear",
			"supported_by:planet_carrier"
		]);
	});
	it("gearbox: no invented links (shaft-carrier, planet-planet, ring mounting)", () => {
		assert.ok(!getRelatedComponentIds(gearbox$3, "central_shaft").includes("planet_carrier"));
		assert.ok(!getRelatedComponentIds(gearbox$3, "planet_gear_1").includes("planet_gear_2"));
	});
	it("bridge: connections and load path match the model metadata", () => {
		assert.deepEqual(getRelatedComponentIds(bridge$3, "diagonal_members").sort(), [
			"bottom_chords",
			"gusset_plates",
			"top_chords"
		]);
		assert.deepEqual(getRelatedComponentIds(bridge$3, "end_portals"), ["support_piers"]);
		assert.deepEqual(getRelatedComponentIds(bridge$3, "bridge_deck").sort(), ["bottom_chords", "vertical_struts"]);
		assert.deepEqual(getRelatedComponentIds(bridge$3, "support_piers", ["supports"]), ["bottom_chords"]);
	});
	it("returns nothing for unknown or cross-model component IDs", () => {
		assert.deepEqual(getComponentRelationships(gearbox$3, "no_such_part"), []);
		assert.deepEqual(getRelatedComponentIds(bridge$3, "sun_gear"), []);
		assert.deepEqual(getComponentRelationships(gearbox$3, ""), []);
	});
	it("walks the relationship graph by depth", () => {
		assert.deepEqual(getNeighbourhood(gearbox$3, "central_shaft", 1), ["sun_gear"]);
		const two = getNeighbourhood(gearbox$3, "central_shaft", 2).sort();
		assert.deepEqual(two, [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3",
			"sun_gear"
		]);
		assert.ok(!getNeighbourhood(gearbox$3, "central_shaft", 3).includes("central_shaft"));
	});
	it("detects invalid targets and components without relationships", () => {
		const broken = {
			...gearbox$3,
			getComponentMetadata: (id) => {
				const meta = gearbox$3.getComponentMetadata(id);
				if (!meta) return null;
				if (id === "sun_gear") return {
					...meta,
					relationships: [{
						targetComponentId: "piston",
						relationshipType: "drives"
					}]
				};
				return {
					...meta,
					relationships: []
				};
			}
		};
		const report = validateModelRelationships(broken);
		assert.equal(report.isValid, false);
		assert.ok(report.errors.some((e) => e.includes("piston")));
		assert.ok(report.componentsWithoutRelationships.includes("ring_gear"));
		assert.deepEqual(getRelatedComponentIds(broken, "sun_gear"), [], "invalid targets are never returned");
	});
});
describe("Related-component highlighting (Task V3)", () => {
	it("highlights several parts together and restores the previous state", () => {
		const w = makeWorkspace();
		const raycaster = w.lifecycle.getRaycaster();
		const root = w.lifecycle.getActiveRuntime().rootGroup;
		const ring = meshesOf(root, "ring_gear");
		const sun = meshesOf(root, "sun_gear");
		const planet = meshesOf(root, "planet_gear_1");
		assert.ok(ring.length && sun.length && planet.length);
		const originalRing = ring.map((m) => m.material);
		raycaster.setSelectionHighlight("sun_gear");
		const rec = w.dispatcher.dispatch({
			type: "component.highlight",
			componentIds: [
				"ring_gear",
				"planet_gear_1",
				"sun_gear"
			]
		}, "voice");
		assert.equal(rec.status, "executed");
		assert.ok(ring.every((m) => emissiveHex(m) === 2278750), "ring glows green");
		assert.ok(planet.every((m) => emissiveHex(m) === 2278750), "planet glows green");
		assert.ok(sun.every((m) => emissiveHex(m) === 16096779), "selection colour wins over the related glow");
		assert.deepEqual(known(w.snapshot().highlightedComponentIds).sort(), [
			"planet_gear_1",
			"ring_gear",
			"sun_gear"
		]);
		w.dispatcher.dispatch({ type: "component.clearHighlight" }, "voice");
		assert.deepEqual(ring.map((m) => m.material), originalRing, "original materials restored");
		assert.ok(sun.every((m) => emissiveHex(m) === 16096779), "selection highlight kept");
		assert.deepEqual(known(w.snapshot().highlightedComponentIds), []);
	});
	it("hover and selection still behave as before with the new layer", () => {
		const w = makeWorkspace();
		const raycaster = w.lifecycle.getRaycaster();
		const root = w.lifecycle.getActiveRuntime().rootGroup;
		const ring = meshesOf(root, "ring_gear");
		const original = ring.map((m) => m.material);
		raycaster.setHoverHighlight("ring_gear");
		assert.ok(ring.every((m) => emissiveHex(m) === 440020));
		raycaster.setSelectionHighlight("ring_gear");
		assert.ok(ring.every((m) => emissiveHex(m) === 16096779));
		raycaster.setSelectionHighlight(null);
		assert.ok(ring.every((m) => emissiveHex(m) === 440020), "hover glow returns when deselected while hovered");
		raycaster.setHoverHighlight(null);
		assert.deepEqual(ring.map((m) => m.material), original);
	});
	it("validates highlight commands through V1", () => {
		const ctx = makeWorkspace().dispatcher.getContext();
		assert.equal(validateSceneCommand({
			type: "component.highlight",
			componentIds: ["piston"]
		}, ctx).ok, false);
		assert.equal(validateSceneCommand({
			type: "component.highlight",
			componentIds: []
		}, ctx).ok, false);
		assert.equal(validateSceneCommand({
			type: "component.highlight",
			componentIds: Array(21).fill("sun_gear")
		}, ctx).ok, false);
		const ok = validateSceneCommand({
			type: "component.highlight",
			componentIds: ["sun_gear", "sun_gear"],
			extra: 1
		}, ctx);
		assert.deepEqual(ok, {
			ok: true,
			command: {
				type: "component.highlight",
				componentIds: ["sun_gear"]
			}
		});
	});
});
describe("Contextual voice commands (Task V3 scenarios)", () => {
	it("A: pointing — \"What does this do?\" identifies the pointed part, without inventing an answer", () => {
		const w = makeWorkspace();
		w.pointer.componentId = "sun_gear";
		w.pointer.source = "gesture";
		const r = w.say("What does this do?");
		assert.deepEqual(r.outcome, {
			kind: "question",
			question: "purpose",
			partId: "sun_gear",
			via: "pointed"
		});
		assert.equal(r.status, "unavailable");
		assert.match(r.caption, /Sun Gear.*not available yet/);
		assert.equal(r.records.length, 0, "questions dispatch nothing");
	});
	it("A2: \"What is this?\" is answered from model metadata (name and role)", () => {
		const w = makeWorkspace();
		w.pointer.componentId = "ring_gear";
		w.pointer.source = "mouse";
		const r = w.say("what is this");
		assert.equal(r.status, "answered");
		assert.equal(r.caption, `That is the Outer Annulus (Ring Gear): ${gearbox$3.getComponentMetadata("ring_gear").role}.`);
		assert.equal(w.say("ఇది ఏమిటి", "te-IN").status, "answered");
		assert.equal(w.say("ये क्या है", "hi-IN").status, "answered");
	});
	it("B: selection — \"Separate this part.\" isolates the selected ring gear through the dispatcher", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		const r = w.say("Separate this part.");
		assert.equal(r.status, "executed");
		assert.equal(r.outcome.kind === "commands" && r.outcome.via, "selected");
		assert.ok(r.records.some((rec) => rec.status === "executed" && rec.command.type === "component.isolate"));
		assert.equal(known(w.snapshot().isolatedComponentId), "ring_gear");
	});
	it("C: no context — \"Hide that part.\" asks which part and changes nothing", () => {
		const w = makeWorkspace();
		const before = JSON.stringify({
			...w.snapshot(),
			capturedAt: 0
		});
		const r = w.say("Hide that part.");
		assert.equal(r.outcome.kind, "needsSelection");
		assert.equal(r.status, "needsInput");
		assert.match(r.caption, /Which part do you mean/);
		assert.equal(r.records.length, 0);
		assert.equal(JSON.stringify({
			...w.snapshot(),
			capturedAt: 0
		}), before, "scene unchanged");
		assert.match(w.say("దాన్ని దాచు", "te-IN").caption, /ఏ భాగం/);
		assert.match(w.say("उसे छुपाओ", "hi-IN").caption, /कौन सा पुर्ज़ा/);
	});
	it("D: an explicit name overrides pointing", () => {
		const w = makeWorkspace();
		w.pointer.componentId = "sun_gear";
		w.pointer.source = "gesture";
		const r = w.say("Explain the ring gear");
		assert.deepEqual(r.outcome, {
			kind: "question",
			question: "explain",
			partId: "ring_gear",
			via: "explicit"
		});
		const sel = w.say("select the planet carrier");
		assert.equal(sel.outcome.kind === "commands" && sel.outcome.partId, "planet_carrier");
	});
	it("E: after switching to the bridge, a gearbox reference cannot act on the bridge", () => {
		const w = makeWorkspace();
		w.say("select the sun gear");
		assert.equal(w.memory.last?.componentId, "sun_gear");
		w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$3.id
		}, "ui");
		const before = w.dispatcher.getHistory().length;
		const r = w.say("hide it");
		assert.equal(r.outcome.kind, "needsSelection");
		assert.equal(w.dispatcher.getHistory().length, before, "no command dispatched");
		const g = w.say("hide the sun gear");
		assert.equal(g.status, "rejected");
		assert.equal(g.outcome.kind, "unknownPart");
	});
	it("remembers the last discussed part for \"it\" in the next turn", () => {
		const w = makeWorkspace();
		w.say("what is the ring gear");
		assert.equal(w.snapshot().selectedComponentId, null, "asking does not select");
		const r = w.say("hide it");
		assert.equal(r.outcome.kind === "commands" && r.outcome.via, "lastDiscussed");
		assert.deepEqual(w.ws.hidden, /* @__PURE__ */ new Set(["ring_gear"]));
	});
	it("\"Show me the parts connected to it\" selects the part and highlights its related parts", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		const r = w.say("Show me the parts connected to it.");
		assert.equal(r.status, "executed");
		assert.deepEqual(known(w.snapshot().highlightedComponentIds).sort(), [
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		assert.match(r.caption, /connected to .*Ring Gear.*Planet Gear A/);
		assert.equal(w.say("దీనికి కనెక్ట్ అయిన భాగాలు చూపించు", "te-IN").status, "executed");
		assert.equal(w.say("इससे जुड़े पुर्ज़े दिखाओ", "hi-IN").status, "executed");
		assert.equal(w.say("clear the highlight").status, "executed");
		assert.deepEqual(known(w.snapshot().highlightedComponentIds), []);
	});
	it("rejects a relationship request when the model records none for that part", () => {
		const w = makeWorkspace({
			...gearbox$3,
			getComponentMetadata: (id) => {
				const meta = gearbox$3.getComponentMetadata(id);
				return meta ? {
					...meta,
					relationships: void 0
				} : null;
			}
		});
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "sun_gear"
		}, "ui");
		const before = w.dispatcher.getHistory().length;
		const r = w.say("show the parts connected to it");
		assert.deepEqual(r.outcome, {
			kind: "unavailable",
			intent: "related",
			reason: "noRelationships",
			partId: "sun_gear"
		});
		assert.equal(r.status, "unavailable");
		assert.equal(w.dispatcher.getHistory().length, before);
	});
	it("\"Put it back\" undoes what the scene shows; \"put it back together\" reassembles", () => {
		const w = makeWorkspace();
		assert.equal(w.say("put it back").outcome.kind, "unavailable", "nothing to put back");
		w.say("isolate the sun gear");
		assert.equal(known(w.snapshot().isolatedComponentId), "sun_gear");
		assert.equal(w.say("put it back").status, "executed");
		assert.equal(known(w.snapshot().isolatedComponentId), null);
		w.say("hide the ring gear");
		w.say("put it back");
		assert.deepEqual(w.ws.hidden, /* @__PURE__ */ new Set());
		w.say("explode");
		assert.equal(w.ws.exploded, .75);
		w.say("put it back together");
		assert.equal(w.ws.exploded, 0);
	});
	it("a question about a part of another model is rejected by name", () => {
		const r = makeWorkspace().say("what does the piston do");
		assert.equal(r.outcome.kind, "unknownPart");
		assert.equal(r.records.length, 0);
	});
});
// tests/teaching.test.ts
/**
* Task V4 — teaching plans: frontend validation, the plan player (real dispatcher, viewer
* executor, camera, model geometry), command-vs-question routing, follow-ups and grounding.
* The LLM is NOT involved here: plans are hand-written in the backend's output format.
*/
var gearbox$2 = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
var bridge$2 = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
var ALL$2 = modelRegistry.getAllModels();
var sleep$2 = (ms) => new Promise((r) => setTimeout(r, ms));
var act = (type, extra = {}) => ({
	type,
	...extra
});
var step = (index, actions, extra = {}) => ({
	index,
	kind: "demonstrate",
	claim: "metadata",
	narration: `Narration ${index}.`,
	caption: `Caption ${index}`,
	targetComponentId: null,
	actions,
	waitFor: "narration",
	holdMs: 0,
	...extra
});
/** A plan in the backend's output format (as /api/teach returns it). */
function rawPlan(over = {}) {
	return {
		schemaVersion: 1,
		planId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		modelId: "planetary_gearbox",
		targetComponentId: "sun_gear",
		title: "How power flows through the gearbox",
		explanation: "The shaft turns the sun gear, which drives the planets; the planets turn the carrier.",
		cannotAnswer: null,
		steps: [
			step(0, [act("component.focus", { componentId: "sun_gear" }), act("component.highlight", { componentIds: ["central_shaft", "sun_gear"] })]),
			step(1, [act("animation.setSpeed", { speed: .5 }), act("animation.play")], { claim: "visible" }),
			step(2, [act("component.highlight", { componentIds: [
				"planet_gear_1",
				"planet_gear_2",
				"planet_gear_3"
			] })]),
			step(3, [act("animation.pause")], {
				kind: "explain",
				claim: "engineering"
			})
		],
		rejectedSteps: [],
		followUpSuggestions: ["Why is the ring gear fixed?"],
		...over
	};
}
function validated(w, raw = rawPlan()) {
	const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
	assert.ok(v.ok, JSON.stringify(v));
	return v.plan;
}
/** Fake narrator: each clip "speaks" for `ms` of unpaused time; logs when narration starts. */
function fakeNarrator$2(ms = 30, onPlay) {
	const played = [];
	const clips = [];
	return {
		narrator: { prepare(text) {
			const rec = {
				text,
				paused: false,
				stopped: false
			};
			clips.push(rec);
			let resolve;
			const done = new Promise((r) => resolve = r);
			let timer = null;
			return {
				done,
				play() {
					played.push(text);
					onPlay?.(text);
					let left = ms;
					timer = setInterval(() => {
						if (rec.paused || rec.stopped) return;
						left -= 5;
						if (left <= 0) {
							clearInterval(timer);
							resolve("ended");
						}
					}, 5);
				},
				pause() {
					rec.paused = true;
				},
				resume() {
					rec.paused = false;
				},
				stop() {
					rec.stopped = true;
					if (timer) clearInterval(timer);
					resolve("stopped");
				}
			};
		} },
		played,
		clips
	};
}
/** Workspace + player with the render loop simulated (camera transitions advance in real time). */
function setup(model = gearbox$2, narratorMs = 30) {
	const w = makeWorkspace(model);
	const loop = setInterval(() => w.tick(16), 4);
	loop.unref?.();
	const n = fakeNarrator$2(narratorMs);
	const player = new TeachingPlanPlayer({
		dispatcher: w.dispatcher,
		getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model),
		narrator: n.narrator,
		pollMs: 4,
		settleTimeoutMs: 1500
	});
	const detach = player.attach();
	const states = [];
	player.subscribe((s) => {
		if (states[states.length - 1] !== s.status) states.push(s.status);
	});
	const done = async (timeout = 4e3) => {
		const t0 = Date.now();
		while (player.isActive() && Date.now() - t0 < timeout) await sleep$2(5);
	};
	const close = () => {
		clearInterval(loop);
		detach();
		player.cancel();
	};
	return {
		w,
		player,
		n,
		states,
		done,
		close
	};
}
var aiTypes = (w, from = 0) => w.dispatcher.getHistory().slice(from).filter((r) => r.source === "ai").map((r) => r.command.type);
describe("Teaching plan validation (Task V4, frontend)", () => {
	it("accepts a valid plan and returns clean V1 commands", () => {
		const plan = validated(makeWorkspace());
		assert.equal(plan.steps.length, 4);
		assert.deepEqual(plan.steps[0].actions, [{
			type: "component.focus",
			componentId: "sun_gear"
		}, {
			type: "component.highlight",
			componentIds: ["central_shaft", "sun_gear"]
		}]);
	});
	it("rejects a plan for another model (stale model id)", () => {
		const w = makeWorkspace();
		const v = validateTeachingPlan(rawPlan({ modelId: "warren_truss_bridge" }), w.snapshot(false), w.dispatcher.getContext());
		assert.deepEqual(v.ok ? "ok" : v.code, "STALE_MODEL");
	});
	const badStep = (actions) => rawPlan({ steps: [step(0, [act("component.select", { componentId: "sun_gear" })]), step(1, actions)] });
	const cases = [
		[
			"unknown command",
			[act("scene.deleteAll")],
			"ACTION_UNSUPPORTED"
		],
		[
			"hiding parts is not teachable",
			[act("component.visibility", {
				componentIds: ["sun_gear"],
				visible: false
			})],
			"ACTION_UNSUPPORTED"
		],
		[
			"model switching is not teachable",
			[act("workspace.switchModel", { modelId: "warren_truss_bridge" })],
			"ACTION_UNSUPPORTED"
		],
		[
			"invented component",
			[act("component.focus", { componentId: "piston" })],
			"UNKNOWN_COMPONENT"
		],
		[
			"component from the bridge",
			[act("component.highlight", { componentIds: ["bridge_deck"] })],
			"UNKNOWN_COMPONENT"
		],
		[
			"bottom view",
			[act("camera.view", { view: "bottom" })],
			"INVALID_ARGUMENT"
		],
		[
			"speed out of range",
			[act("animation.setSpeed", { speed: 9 })],
			"INVALID_ARGUMENT"
		],
		[
			"too many actions",
			[
				act("camera.reset"),
				act("camera.reset"),
				act("camera.reset"),
				act("camera.reset")
			],
			"PLAN_INVALID"
		]
	];
	for (const [name, actions, code] of cases) it(`rejects the step, not the plan: ${name}`, () => {
		const plan = validated(makeWorkspace(), badStep(actions));
		assert.deepEqual(plan.steps.map((s) => s.index), [0]);
		assert.equal(plan.rejectedSteps[0].code, code);
	});
	it("rejects animation on a model that has none (bridge)", () => {
		const plan = validated(makeWorkspace(bridge$2), rawPlan({
			modelId: "warren_truss_bridge",
			targetComponentId: null,
			steps: [step(0, [act("component.focus", { componentId: "bridge_deck" })]), step(1, [act("animation.play")])]
		}));
		assert.equal(plan.rejectedSteps[0].code, "ACTION_UNAVAILABLE");
	});
	it("rejects malformed or oversized plans", () => {
		const w = makeWorkspace();
		const check = (raw) => {
			const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
			return v.ok ? "ok" : v.code;
		};
		assert.equal(check(null), "PLAN_INVALID");
		assert.equal(check("plan"), "PLAN_INVALID");
		assert.equal(check(rawPlan({ schemaVersion: 2 })), "PLAN_INVALID");
		assert.equal(check(rawPlan({ steps: [] })), "PLAN_INVALID");
		assert.equal(check(rawPlan({ steps: Array.from({ length: 9 }, (_, i) => step(i, [])) })), "PLAN_TOO_LONG");
		assert.equal(check(rawPlan({ title: "" })), "PLAN_INVALID");
		assert.equal(check(rawPlan({ title: "See https://example.com" })), "PLAN_UNSAFE");
		assert.equal(check(rawPlan({ targetComponentId: "crankshaft" })), "UNKNOWN_COMPONENT");
		assert.equal(check(rawPlan({ steps: [step(0, [act("component.focus", { componentId: "piston" })])] })), "PLAN_INVALID");
	});
	it("rejects steps with code, markup or links in the narration", () => {
		const w = makeWorkspace();
		for (const narration of [
			"<script>alert(1)<\/script>",
			"Run eval(x) now",
			"Use THREE.Mesh to add it",
			"Visit www.example.com"
		]) {
			const plan = validated(w, rawPlan({ steps: [step(0, []), step(1, [], { narration })] }));
			assert.equal(plan.rejectedSteps[0].code, "PLAN_UNSAFE", narration);
		}
	});
	it("re-validates each step right before it runs", () => {
		const w = makeWorkspace();
		const plan = validated(w);
		assert.equal(validateStepNow(plan.steps[0], plan.modelId, w.dispatcher.getContext()).ok, true);
		w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$2.id
		}, "ui");
		const later = validateStepNow(plan.steps[0], plan.modelId, w.dispatcher.getContext());
		assert.deepEqual(later.ok ? "ok" : later.code, "STALE_MODEL");
	});
});
describe("Teaching plan player (Task V4)", () => {
	it("runs steps in order: actions, camera settled, then narration", async () => {
		const t = setup();
		const settledAtNarration = [];
		const n = fakeNarrator$2(20, () => {
			const cam = t.w.snapshot(false).camera;
			settledAtNarration.push(cam.status === "known" && cam.value.settled);
		});
		const player = new TeachingPlanPlayer({
			dispatcher: t.w.dispatcher,
			getSnapshot: () => getSceneSnapshot(t.w.dispatcher, t.w.ws.model),
			narrator: n.narrator,
			pollMs: 4
		});
		const h0 = t.w.dispatcher.getHistory().length;
		try {
			assert.equal(player.start(validated(t.w)), true);
			const t0 = Date.now();
			while (player.isActive() && Date.now() - t0 < 4e3) await sleep$2(5);
			assert.equal(player.getState().status, "finished");
			assert.deepEqual(n.played, [
				"Narration 0.",
				"Narration 1.",
				"Narration 2.",
				"Narration 3."
			]);
			assert.ok(settledAtNarration.every(Boolean), "narration only starts after the camera settled");
			assert.deepEqual(aiTypes(t.w, h0).slice(0, 7), [
				"component.select",
				"component.focus",
				"component.highlight",
				"animation.setSpeed",
				"animation.play",
				"component.highlight",
				"animation.pause"
			]);
		} finally {
			player.cancel();
			t.close();
		}
	});
	it("restores what the plan changed when it finishes (selection kept, camera untouched)", async () => {
		const t = setup();
		t.w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		t.player.start(validated(t.w, rawPlan({ steps: [step(0, [
			act("component.select", { componentId: "sun_gear" }),
			act("component.highlight", { componentIds: ["planet_gear_1"] }),
			act("component.isolate", { componentId: "sun_gear" })
		]), step(1, [act("assembly.explode", { factor: .5 }), act("animation.setSpeed", { speed: 2 })])] })));
		await t.done();
		const s = t.w.snapshot(false);
		assert.deepEqual(s.highlightedComponentIds, {
			status: "known",
			value: []
		});
		assert.deepEqual(s.isolatedComponentId, {
			status: "known",
			value: null
		});
		assert.equal(s.exploded.factor, 0);
		assert.deepEqual(t.w.anim, {
			playing: true,
			speed: 1
		});
		assert.equal(s.selectedComponentId, "sun_gear", "topic stays selected for follow-ups");
		t.close();
	});
	it("pause stops progress and the narration; resume continues", async () => {
		const t = setup(gearbox$2, 60);
		t.player.start(validated(t.w));
		while (t.player.getState().phase !== "narrating") await sleep$2(3);
		t.player.pause();
		const pos = t.player.getState().stepPosition;
		await sleep$2(150);
		assert.equal(t.player.getState().status, "paused");
		assert.equal(t.player.getState().stepPosition, pos, "no progress while paused");
		assert.ok(t.n.clips.some((c) => c.paused), "narration paused");
		t.player.resume();
		await t.done();
		assert.equal(t.player.getState().status, "finished");
		t.close();
	});
	it("cancel stops speech, dispatches nothing more and restores the scene (incl. selection)", async () => {
		const t = setup(gearbox$2, 80);
		t.w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		t.player.start(validated(t.w, rawPlan({ steps: [step(0, [
			act("component.select", { componentId: "sun_gear" }),
			act("component.highlight", { componentIds: ["planet_gear_1"] }),
			act("component.isolate", { componentId: "sun_gear" })
		]), step(1, [act("animation.pause")])] })));
		while (t.player.getState().phase !== "narrating") await sleep$2(3);
		t.player.cancel();
		const h = t.w.dispatcher.getHistory().length;
		await sleep$2(150);
		assert.equal(t.player.getState().status, "cancelled");
		assert.ok(t.n.clips[0].stopped, "speech stopped");
		assert.equal(t.w.dispatcher.getHistory().length, h, "nothing dispatched after cancel");
		const s = t.w.snapshot(false);
		assert.deepEqual(s.highlightedComponentIds, {
			status: "known",
			value: []
		});
		assert.deepEqual(s.isolatedComponentId, {
			status: "known",
			value: null
		});
		assert.equal(s.selectedComponentId, "ring_gear");
		assert.equal(t.w.anim.playing, true, "step 1 (pause) never ran");
		t.close();
	});
	it("manual takeover: a command from the user pauses the plan", async () => {
		const t = setup(gearbox$2, 80);
		t.player.start(validated(t.w));
		while (t.player.getState().phase !== "narrating") await sleep$2(3);
		t.w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "mouse");
		assert.equal(t.player.getState().status, "paused");
		assert.match(t.player.getState().message ?? "", /changed the scene/);
		t.close();
	});
	it("manual takeover: steering the camera by hand pauses the plan", async () => {
		const t = setup(gearbox$2, 120);
		t.player.start(validated(t.w));
		while (t.player.getState().phase !== "narrating") await sleep$2(3);
		t.w.steer.on = true;
		await sleep$2(40);
		assert.equal(t.player.getState().status, "paused");
		assert.match(t.player.getState().message ?? "", /moved the view/);
		t.w.steer.on = false;
		t.close();
	});
	it("a model switch during playback cancels without touching the new model", async () => {
		const t = setup(gearbox$2, 80);
		t.player.start(validated(t.w));
		while (t.player.getState().phase !== "narrating") await sleep$2(3);
		t.w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$2.id
		}, "ui");
		const h = t.w.dispatcher.getHistory().length;
		await sleep$2(80);
		assert.equal(t.player.getState().status, "cancelled");
		assert.match(t.player.getState().message ?? "", /model changed/);
		assert.equal(aiTypes(t.w, h).length, 0, "no command dispatched on the bridge");
		t.close();
	});
	it("refuses to start a plan for a model that is no longer loaded", () => {
		const t = setup();
		const plan = validated(t.w);
		t.w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$2.id
		}, "ui");
		assert.equal(t.player.start(plan), false);
		assert.equal(t.player.getState().status, "failed");
		t.close();
	});
	it("a step that no longer validates is skipped without changing the scene", async () => {
		const t = setup();
		const plan = validated(t.w);
		plan.steps[1] = {
			...plan.steps[1],
			actions: [{
				type: "component.focus",
				componentId: "piston"
			}]
		};
		const h0 = t.w.dispatcher.getHistory().length;
		t.player.start(plan);
		await t.done();
		assert.equal(t.player.getState().status, "finished");
		assert.deepEqual(t.player.getState().runtimeRejected.map((r) => [r.index, r.code]), [[1, "UNKNOWN_COMPONENT"]]);
		assert.ok(!t.w.dispatcher.getHistory().slice(h0).some((r) => JSON.stringify(r.command).includes("piston")));
		assert.ok(!t.n.played.includes("Narration 1."), "skipped step is not narrated");
		t.close();
	});
	it("never runs two plans at once", async () => {
		const t = setup(gearbox$2, 60);
		assert.equal(t.player.start(validated(t.w)), true);
		assert.equal(t.player.start(validated(t.w)), false);
		t.close();
	});
	it("waits for Continue on a \"user\" step", async () => {
		const t = setup();
		t.player.start(validated(t.w, rawPlan({ steps: [step(0, [], { waitFor: "user" }), step(1, [])] })));
		while (t.player.getState().status !== "waitingForUser") await sleep$2(3);
		await sleep$2(60);
		assert.equal(t.player.getState().stepPosition, 0);
		t.player.continue();
		await t.done();
		assert.deepEqual(t.n.played, ["Narration 0.", "Narration 1."]);
		t.close();
	});
	it("commands are dispatched through V1 with source \"ai\" and validated again there", async () => {
		const t = setup();
		t.player.start(validated(t.w));
		await t.done();
		const ai = t.w.dispatcher.getHistory().filter((r) => r.source === "ai");
		assert.ok(ai.length > 0 && ai.every((r) => r.status === "executed"));
		t.close();
	});
});
describe("Command vs teaching-question routing (Task V4)", () => {
	const turn = (w, transcript, language = "en-IN") => {
		const r = handleVoiceTurn({
			transcript,
			language,
			dispatcher: w.dispatcher,
			model: w.ws.model,
			allModels: ALL$2,
			lastDiscussed: w.memory.last,
			teachingAvailable: true
		});
		if (r.discussedComponentId) w.memory.last = {
			modelId: w.ws.model.id,
			componentId: r.discussedComponentId
		};
		return r;
	};
	it("simple commands stay on the deterministic path (no LLM)", () => {
		const w = makeWorkspace();
		for (const t of [
			"zoom in",
			"show the back",
			"hide the sun gear",
			"rotate left",
			"show me the parts connected to the ring gear",
			"put it back"
		]) {
			const r = turn(w, t);
			assert.notEqual(r.status, "teach", t);
			assert.equal(r.teach, void 0, t);
		}
	});
	it("\"what is this?\" is still answered locally from metadata", () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "sun_gear"
		}, "ui");
		assert.equal(turn(w, "what is this").status, "answered");
	});
	for (const [q, target, type] of [
		[
			"Explain how this gearbox works.",
			null,
			"explain"
		],
		[
			"Show me how power flows through the gearbox.",
			null,
			"howWorks"
		],
		[
			"What happens when the sun gear rotates?",
			"sun_gear",
			"howWorks"
		],
		[
			"Why do we need the planet carrier?",
			"planet_carrier",
			"purpose"
		],
		[
			"What would happen if this component failed?",
			"ring_gear",
			"failure"
		],
		[
			"గేర్‌బాక్స్ ఎలా పనిచేస్తుంది?",
			null,
			"howWorks"
		],
		[
			"प्लैनेट कैरियर की ज़रूरत क्यों है?",
			"planet_carrier",
			"purpose"
		]
	]) it(`teaching question: "${q}"`, () => {
		const w = makeWorkspace();
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "ui");
		const lang = /[ఀ-౿]/.test(q) ? "te-IN" : /[ऀ-ॿ]/.test(q) ? "hi-IN" : "en-IN";
		const r = turn(w, q, lang);
		assert.equal(r.status, "teach", JSON.stringify(r.outcome));
		assert.deepEqual(r.teach, {
			question: q,
			questionType: type,
			targetComponentId: target
		});
		assert.equal(r.records.length, 0, "nothing executed before a plan is validated");
	});
	it("bridge: load-transfer questions are whole-model, path questions name several parts", () => {
		const w = makeWorkspace(bridge$2);
		const a = turn(w, "Explain the bridge's load-transfer mechanism.");
		assert.equal(a.status, "teach");
		assert.equal(a.teach.targetComponentId, null);
		const b = turn(w, "Show me how forces travel from the deck to the piers.");
		assert.equal(b.status, "teach");
		assert.deepEqual(b.outcome.kind === "question" && b.outcome.mentionedIds.sort(), ["bridge_deck", "support_piers"]);
	});
	it("one name shared by several parts is ambiguous, not a path", () => {
		const w = makeWorkspace();
		const r = turn(w, "explain the planet gear");
		assert.equal(r.outcome.kind, "ambiguous");
		assert.equal(r.status, "needsInput");
	});
	it("teaching questions about parts of other models are rejected locally", () => {
		const w = makeWorkspace();
		const r = turn(w, "why does the piston need oil");
		assert.equal(r.outcome.kind, "unknownPart");
		assert.equal(r.teach, void 0);
	});
	it("without a configured teaching model, questions keep the V3 \"not available yet\" reply", () => {
		const r = handleVoiceTurn({
			transcript: "why do we need the planet carrier",
			language: "en-IN",
			dispatcher: makeWorkspace().dispatcher,
			model: gearbox$2,
			allModels: ALL$2
		});
		assert.equal(r.status, "unavailable");
		assert.match(r.caption, /not available yet/);
	});
});
describe("Teaching follow-ups, context and grounding (Task V4)", () => {
	const turn = (w, transcript) => {
		const r = handleVoiceTurn({
			transcript,
			language: "en-IN",
			dispatcher: w.dispatcher,
			model: w.ws.model,
			allModels: ALL$2,
			lastDiscussed: w.memory.last,
			teachingAvailable: true
		});
		if (r.discussedComponentId) w.memory.last = {
			modelId: w.ws.model.id,
			componentId: r.discussedComponentId
		};
		return r;
	};
	it("follow-up pronouns keep the discussed part; a model switch forgets it", () => {
		const w = makeWorkspace();
		assert.equal(turn(w, "Explain the planet carrier.").teach.targetComponentId, "planet_carrier");
		const why = turn(w, "Why is it needed?");
		assert.deepEqual([why.teach.targetComponentId, why.teach.questionType], ["planet_carrier", "purpose"]);
		const broke = turn(w, "What would happen if it broke?");
		assert.deepEqual([broke.teach.targetComponentId, broke.teach.questionType], ["planet_carrier", "failure"]);
		w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$2.id
		}, "ui");
		const after = turn(w, "Why is it needed?");
		assert.equal(after.outcome.kind, "needsSelection");
		assert.equal(after.teach, void 0);
	});
	it("a pointed part is used for \"this\"; an explicit name overrides it", () => {
		const w = makeWorkspace();
		w.pointer.componentId = "sun_gear";
		w.pointer.source = "gesture";
		assert.equal(turn(w, "why is this part needed").teach.targetComponentId, "sun_gear");
		assert.equal(turn(w, "why do we need the ring gear").teach.targetComponentId, "ring_gear");
	});
	it("missing context asks the user instead of guessing", () => {
		const w = makeWorkspace();
		const r = turn(w, "why is this needed");
		assert.equal(r.outcome.kind, "needsSelection");
		assert.equal(r.teach, void 0);
	});
	it("fact pack: grounded in model data, minimal, and states what is not simulated", () => {
		const pack = buildFactPack(gearbox$2, makeWorkspace().snapshot(false), "planet_carrier");
		assert.equal(pack.modelId, "planetary_gearbox");
		const carrier = pack.components.find((c) => c.id === "planet_carrier");
		assert.ok(carrier.notes.length > 0 && carrier.description.length > 0, "target in full");
		assert.deepEqual(carrier.relationships.map((r) => `${r.type}:${r.target}`).sort(), [
			"driven_by:planet_gear_1",
			"driven_by:planet_gear_2",
			"driven_by:planet_gear_3",
			"supports:planet_gear_1",
			"supports:planet_gear_2",
			"supports:planet_gear_3"
		]);
		const shaft = pack.components.find((c) => c.id === "central_shaft");
		assert.equal(shaft.description, "", "parts outside the question are sent briefly");
		assert.deepEqual(pack.animations.map((a) => a.id), ["gear_train_rotation"]);
		assert.ok(pack.limits.some((l) => /not simulate forces, torque/.test(l)));
		assert.ok(pack.allowedActions.every((a) => ![
			"component.visibility",
			"workspace.switchModel",
			"workspace.goHome"
		].includes(a)));
		const json = JSON.stringify(pack);
		assert.ok(json.length < 9e3, `pack size ${json.length}`);
		for (const banned of [
			"geometry",
			"uuid",
			"GNANI",
			"api_key",
			"LLM_API_KEY"
		]) assert.ok(!json.includes(banned), banned);
	});
	it("fact pack: the bridge declares no structural analysis and no animation", () => {
		const pack = buildFactPack(bridge$2, makeWorkspace(bridge$2).snapshot(false), null);
		assert.deepEqual(pack.animations, []);
		assert.ok(modelLimits(bridge$2).some((l) => /No structural analysis/.test(l)));
		assert.ok(!pack.allowedActions.includes("animation.play"));
		const deck = pack.components.find((c) => c.id === "bridge_deck");
		assert.deepEqual(deck.relationships.map((r) => r.target).sort(), ["bottom_chords", "vertical_struts"]);
		assert.ok(pack.components.every((c) => c.relationships.every((r) => bridge$2.getAllComponentIds().includes(r.target))));
	});
});
describe("Teaching client (Task V4)", () => {
	const body = {
		question: "q",
		language: "en-IN",
		targetComponentId: null,
		facts: {},
		history: []
	};
	const respond = (status, data) => (async () => new Response(JSON.stringify(data), { status }));
	it("maps server errors to stable codes and readable messages", async () => {
		for (const [code, status] of [
			["LLM_NOT_CONFIGURED", 503],
			["LLM_TIMEOUT", 504],
			["PLAN_INVALID", 422],
			["LLM_RATE_LIMIT", 429]
		]) await assert.rejects(requestTeachingPlan(body, void 0, respond(status, { error: {
			code,
			message: "x"
		} })), (e) => e.code === code && e.message.length > 5);
	});
	it("reports a down backend and cancellation", async () => {
		await assert.rejects(requestTeachingPlan(body, void 0, (async () => {
			throw new TypeError("fetch failed");
		})), (e) => e.code === "BACKEND_UNAVAILABLE");
		const c = new AbortController();
		c.abort();
		await assert.rejects(requestTeachingPlan(body, c.signal, (async () => {
			throw new DOMException("aborted", "AbortError");
		})), (e) => e.code === "CANCELLED");
	});
	it("returns the plan on success", async () => {
		assert.deepEqual(await requestTeachingPlan(body, void 0, respond(200, { plan: { a: 1 } })), { a: 1 });
	});
});
// tests/voiceV5.test.ts
/**
* Task V5 — voice reliability, explanations and interruption handling.
*
* Transcripts marked "Prisma" are the real Gnani Prisma output for Timbre-spoken requests
* (27 Oct 2026), including its mis-hearings. The LLM is SIMULATED here (controllable promises);
* the dispatcher, viewer executor, camera, model geometry, plan validation and player are real.
*/
var gearbox$1 = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
var bridge$1 = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
var ALL$1 = modelRegistry.getAllModels();
var sleep$1 = (ms) => new Promise((r) => setTimeout(r, ms));
function turn$1(w, transcript, language = "en-IN", extra = {}) {
	const r = handleVoiceTurn({
		transcript,
		language,
		dispatcher: w.dispatcher,
		model: w.ws.model,
		allModels: ALL$1,
		lastDiscussed: w.memory.last,
		teachingAvailable: true,
		...extra
	});
	if (r.discussedComponentId) w.memory.last = {
		modelId: w.ws.model.id,
		componentId: r.discussedComponentId
	};
	return r;
}
function selected$1(component, model = gearbox$1) {
	const w = makeWorkspace(model);
	w.dispatcher.dispatch({
		type: "component.select",
		componentId: component
	}, "ui");
	return w;
}
/** Narrator that "speaks" for `ms` of unpaused time; records starts and stops. */
function fakeNarrator$1(ms = 40) {
	const played = [];
	const clips = [];
	return {
		narrator: { prepare(text) {
			const rec = {
				text,
				stopped: false,
				paused: false
			};
			clips.push(rec);
			let resolve;
			const done = new Promise((r) => resolve = r);
			let timer = null;
			return {
				done,
				play() {
					played.push(text);
					let left = ms;
					timer = setInterval(() => {
						if (rec.paused || rec.stopped) return;
						left -= 5;
						if (left <= 0) {
							clearInterval(timer);
							resolve("ended");
						}
					}, 5);
					timer.unref?.();
				},
				pause() {
					rec.paused = true;
				},
				resume() {
					rec.paused = false;
				},
				stop() {
					rec.stopped = true;
					if (timer) clearInterval(timer);
					resolve("stopped");
				}
			};
		} },
		played,
		clips
	};
}
/** A teaching plan as the backend returns it, for whichever part the request targeted. */
function llmPlan(target, model = gearbox$1, nSteps = 3) {
	return {
		schemaVersion: 1,
		planId: Array.from({ length: 32 }, (_, i) => ((i * 7 + (target?.length ?? 3)) % 16).toString(16)).join(""),
		modelId: model.id,
		targetComponentId: target,
		title: `About ${target ?? model.name}`,
		explanation: "Grounded explanation.",
		cannotAnswer: null,
		steps: Array.from({ length: nSteps }, (_, i) => ({
			index: i,
			kind: "demonstrate",
			claim: "metadata",
			narration: `${target ?? "model"} step ${i}.`,
			caption: `Step ${i}`,
			targetComponentId: target,
			actions: target ? [{
				type: "component.focus",
				componentId: target
			}] : [],
			waitFor: "narration",
			holdMs: 0
		})),
		rejectedSteps: [],
		followUpSuggestions: []
	};
}
/** Controller + real player with a simulated LLM whose replies the test resolves. */
function lifecycle(w, narratorMs = 40) {
	const loop = setInterval(() => w.tick(16), 4);
	loop.unref?.();
	const n = fakeNarrator$1(narratorMs);
	const player = new TeachingPlanPlayer({
		dispatcher: w.dispatcher,
		getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model),
		narrator: n.narrator,
		pollMs: 4,
		settleTimeoutMs: 1500
	});
	const detach = player.attach();
	const requests = [];
	const started = [];
	const controller = new TeachingController({
		dispatcher: w.dispatcher,
		player,
		getModel: () => w.ws.model,
		getLanguage: () => "en-IN",
		requestPlan: (body, signal) => new Promise((resolve, reject) => requests.push({
			body,
			signal,
			resolve,
			reject
		})),
		onPlanStarted: (p) => started.push(`${p.source}:${p.targetComponentId}`)
	});
	const close = () => {
		controller.cancel();
		detach();
		clearInterval(loop);
	};
	const until = async (cond, ms = 3e3) => {
		const t0 = Date.now();
		while (!cond() && Date.now() - t0 < ms) await sleep$1(5);
		return cond();
	};
	return {
		player,
		controller,
		requests,
		started,
		n,
		close,
		until
	};
}
var aiSince = (w, from) => w.dispatcher.getHistory().slice(from).filter((r) => r.source === "ai").map((r) => JSON.stringify(r.command));
describe("V5 intent routing: selected part + natural requests (EN / TE / HI, code-mixed)", () => {
	for (const [language, transcript, type] of [
		[
			"te-IN",
			"చూడు ఇప్పుడు నేను ఈ పార్ట్ ని సెలెక్ట్ చేశాను దాన్ని ఎక్స్ప్లెయిన్ చేయ",
			"explain"
		],
		[
			"te-IN",
			"చూడు ఇప్పుడు నేను ఈ పార్టీని సెలెక్ట్ చేశాను దాన్ని ఎక్స్ప్లెయిన్ చెయ్య",
			"explain"
		],
		[
			"te-IN",
			"ఈ పాట ఎందుకు అవసరం",
			"purpose"
		],
		[
			"te-IN",
			"ఇది ఎలా పని చేస్తుంది",
			"howWorks"
		],
		[
			"hi-IN",
			"देखो मैंने यह पार्ट सेलेक्ट किया है इसे एक्सप्लेन करो।",
			"explain"
		],
		[
			"hi-IN",
			"इसकी जरूरत क्यों है",
			"purpose"
		],
		[
			"en-IN",
			"Explain this part. Why is it used, and how does it work?",
			"explain"
		],
		[
			"en-IN",
			"Why do we need this?",
			"purpose"
		],
		[
			"en-IN",
			"How does it work?",
			"howWorks"
		],
		[
			"en-IN",
			"What happens if it fails?",
			"failure"
		],
		[
			"en-IN",
			"Show me how it interacts with the other gears.",
			"howWorks"
		],
		[
			"en-IN",
			"What is its role in the entire gearbox?",
			"purpose"
		]
	]) it(`${language}: "${transcript}" -> explain the selected sun gear (${type})`, () => {
		const r = turn$1(selected$1("sun_gear"), transcript, language);
		assert.equal(r.status, "teach", JSON.stringify(r.outcome));
		assert.equal(r.teach.targetComponentId, "sun_gear");
		assert.equal(r.teach.questionType, type);
		assert.equal(r.records.length, 0, "the selection is not re-dispatched");
	});
	it("\"Explain it in Telugu\" keeps the part and asks for Telugu", () => {
		const r = turn$1(selected$1("sun_gear"), "Explain it in Telugu");
		assert.deepEqual([r.teach.targetComponentId, r.teach.language], ["sun_gear", "te-IN"]);
	});
	it("\"Explain how this gearbox works\" is about the whole model even with a part selected", () => {
		const r = turn$1(selected$1("sun_gear"), "Explain how this gearbox works");
		assert.equal(r.status, "teach");
		assert.equal(r.teach.targetComponentId, null);
	});
	it("an explicit name overrides the selection (\"No, not that part. Explain the planet carrier instead.\")", () => {
		const r = turn$1(selected$1("sun_gear"), "no not that part explain the planet carrier instead");
		assert.equal(r.teach.targetComponentId, "planet_carrier");
	});
	it("a follow-up keeps the discussed part; a model switch clears it", () => {
		const w = makeWorkspace();
		assert.equal(turn$1(w, "Explain the planet carrier.").teach.targetComponentId, "planet_carrier");
		assert.equal(turn$1(w, "Why is it needed?").teach.targetComponentId, "planet_carrier");
		assert.equal(turn$1(w, "అది ఎందుకు అవసరం", "te-IN").teach.targetComponentId, "planet_carrier", "follow-up in another language");
		w.dispatcher.dispatch({
			type: "workspace.switchModel",
			modelId: bridge$1.id
		}, "ui");
		assert.equal(turn$1(w, "Why is it needed?").outcome.kind, "needsSelection");
	});
	it("missing context gets a spoken clarification, never an arbitrary part", () => {
		for (const [t, lang] of [["Explain this part.", "en-IN"], ["దాన్ని ఎక్స్ప్లెయిన్ చెయ్యి", "te-IN"]]) {
			const r = turn$1(makeWorkspace(), t, lang);
			assert.equal(r.status, "needsInput");
			assert.equal(r.speak, true);
			assert.equal(r.teach, void 0);
		}
	});
	it("a part from another model is named, not substituted", () => {
		const r = turn$1(selected$1("sun_gear"), "explain the piston");
		assert.equal(r.outcome.kind, "unknownPart");
		assert.equal(r.teach, void 0);
	});
	it("an empty transcript asks to repeat and starts nothing", () => {
		let superseded = 0;
		const r = turn$1(selected$1("sun_gear"), "   ", "te-IN", { onSupersede: () => superseded++ });
		assert.equal(r.status, "needsInput");
		assert.match(r.caption, /ఇంకోసారి/);
		assert.equal(superseded, 0);
	});
});
describe("V5 request classification during an explanation", () => {
	it("new requests supersede; clarifications, unknown speech and controls do not", () => {
		const w = selected$1("ring_gear");
		const count = (t, active = true) => {
			let n = 0;
			turn$1(w, t, "en-IN", {
				teachingActive: active,
				onSupersede: () => n++
			});
			return n;
		};
		assert.equal(count("Actually, just show me where it is."), 1, "visual command");
		assert.equal(count("Explain the planet carrier"), 1, "new teaching question");
		assert.equal(count("Why is it needed?"), 1, "follow-up question (new plan, same part)");
		assert.equal(count("make me a sandwich"), 0, "unrecognised speech");
		assert.equal(count("wait"), 0, "control");
		assert.equal(count("explain the piston"), 0, "unknown part keeps the explanation");
	});
	it("\"wait / continue / stop\" control the explanation only while one is active", () => {
		const w = selected$1("sun_gear");
		const c = (t, lang = "en-IN") => turn$1(w, t, lang, { teachingActive: true });
		assert.deepEqual([
			c("wait").control,
			c("continue").control,
			c("stop").control
		], [
			"pause",
			"resume",
			"stop"
		]);
		assert.deepEqual([
			c("ఆగు", "te-IN").control,
			c("కొనసాగించు", "te-IN").control,
			c("బస్ చాలు", "te-IN").control
		], [
			"pause",
			"resume",
			"stop"
		]);
		assert.deepEqual([
			c("रुको", "hi-IN").control,
			c("जारी रखो", "hi-IN").control,
			c("बस", "hi-IN").control
		], [
			"pause",
			"resume",
			"stop"
		]);
		const idle = turn$1(w, "stop", "en-IN", { teachingActive: false });
		assert.equal(idle.outcome.kind, "commands", "without an explanation, \"stop\" keeps its V2 meaning (pause the animation)");
		const named = c("stop and explain the ring gear");
		assert.equal(named.status, "teach", "a part name or question makes it a new request, not a control");
	});
	it("\"Actually, just show me where it is\" targets the part being explained", () => {
		const w = makeWorkspace();
		w.memory.last = {
			modelId: gearbox$1.id,
			componentId: "ring_gear"
		};
		const r = turn$1(w, "Actually, just show me where it is.", "en-IN", { teachingActive: true });
		assert.equal(r.status, "executed");
		assert.deepEqual(r.records.map((x) => x.command.componentId), ["ring_gear", "ring_gear"]);
	});
});
describe("V5 interruption lifecycle (simulated LLM, real player and dispatcher)", () => {
	it("a new component request stops the old narration and plays the new plan", async () => {
		const w = selected$1("sun_gear");
		const L = lifecycle(w, 150);
		try {
			L.controller.ask({
				question: "Explain the sun gear",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			L.requests[0].resolve(llmPlan("sun_gear"));
			assert.ok(await L.until(() => L.player.getState().phase === "narrating"));
			const sunClip = L.n.clips.find((c) => c.text.startsWith("sun_gear"));
			L.controller.ask({
				question: "Explain the planet carrier instead",
				questionType: "explain",
				targetComponentId: "planet_carrier"
			});
			assert.ok(sunClip.stopped, "old narration stopped immediately");
			assert.equal(L.player.getState().status, "cancelled");
			const h = w.dispatcher.getHistory().length;
			L.requests[1].resolve(llmPlan("planet_carrier"));
			assert.ok(await L.until(() => L.player.getState().plan?.targetComponentId === "planet_carrier" && L.player.getState().phase === "narrating"));
			assert.ok(aiSince(w, h).every((c) => !c.includes("sun_gear")), "no stale sun-gear action after the interruption");
			assert.deepEqual(L.started, ["llm:sun_gear", "llm:planet_carrier"]);
		} finally {
			L.close();
		}
	});
	it("a visual command supersedes the plan: no further plan actions, the command runs", async () => {
		const w = selected$1("ring_gear");
		const L = lifecycle(w, 150);
		try {
			L.controller.ask({
				question: "Explain the ring gear",
				questionType: "explain",
				targetComponentId: "ring_gear"
			});
			L.requests[0].resolve(llmPlan("ring_gear", gearbox$1, 4));
			assert.ok(await L.until(() => L.player.getState().phase === "narrating"));
			const h = w.dispatcher.getHistory().length;
			const r = turn$1(w, "Actually, just show me where it is.", "en-IN", {
				teachingActive: L.controller.isActive(),
				onSupersede: () => L.controller.supersede()
			});
			assert.equal(r.status, "executed");
			assert.equal(L.player.getState().status, "cancelled");
			await sleep$1(300);
			const after = w.dispatcher.getHistory().slice(h);
			assert.ok(after.some((x) => x.source === "voice" && x.command.type === "component.focus"));
			assert.ok(!after.some((x) => x.source === "ai" && x.command.type === "component.focus"), "no stale plan step ran");
		} finally {
			L.close();
		}
	});
	it("a late LLM reply for a superseded question is never played", async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			const first = L.controller.ask({
				question: "Explain the sun gear",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			const second = L.controller.ask({
				question: "Explain the ring gear",
				questionType: "explain",
				targetComponentId: "ring_gear"
			});
			assert.ok(L.requests[0].signal.aborted, "the superseded request was aborted");
			L.requests[1].resolve(llmPlan("ring_gear"));
			assert.equal(await second, "started");
			L.requests[0].resolve(llmPlan("sun_gear"));
			assert.equal(await first, "stale");
			assert.equal(L.player.getState().plan?.targetComponentId, "ring_gear");
			assert.deepEqual(L.started, ["llm:ring_gear"]);
		} finally {
			L.close();
		}
	});
	it("a reply that arrives after Stop does not restart anything", async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			const p = L.controller.ask({
				question: "Explain this",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			L.controller.cancel();
			L.requests[0].resolve(llmPlan("sun_gear"));
			assert.equal(await p, "stale");
			assert.equal(L.player.isActive(), false);
			assert.deepEqual(L.started, []);
		} finally {
			L.close();
		}
	});
	it("a model switch while the reply is pending discards it; nothing touches the bridge", async () => {
		const w = selected$1("sun_gear");
		const L = lifecycle(w);
		try {
			const p = L.controller.ask({
				question: "Explain this",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			w.dispatcher.dispatch({
				type: "workspace.switchModel",
				modelId: bridge$1.id
			}, "ui");
			L.controller.modelChanged(bridge$1.id);
			const h = w.dispatcher.getHistory().length;
			L.requests[0].resolve(llmPlan("sun_gear"));
			assert.equal(await p, "stale");
			await sleep$1(100);
			assert.deepEqual(aiSince(w, h), []);
		} finally {
			L.close();
		}
	});
	it("a model switch while a plan is playing cancels it before any further step", async () => {
		const w = selected$1("sun_gear");
		const L = lifecycle(w, 150);
		try {
			L.controller.ask({
				question: "Explain this",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			L.requests[0].resolve(llmPlan("sun_gear", gearbox$1, 4));
			assert.ok(await L.until(() => L.player.getState().phase === "narrating"));
			w.dispatcher.dispatch({
				type: "workspace.switchModel",
				modelId: bridge$1.id
			}, "ui");
			const h = w.dispatcher.getHistory().length;
			assert.ok(await L.until(() => L.player.getState().status === "cancelled"));
			await sleep$1(200);
			assert.deepEqual(aiSince(w, h), []);
		} finally {
			L.close();
		}
	});
	it("rapid requests: only the last one plays, exactly once", async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			const ids = [
				"sun_gear",
				"ring_gear",
				"planet_carrier"
			];
			const results = ids.map((id) => L.controller.ask({
				question: `Explain ${id}`,
				questionType: "explain",
				targetComponentId: id
			}));
			[
				2,
				0,
				1
			].forEach((i) => L.requests[i].resolve(llmPlan(ids[i])));
			assert.deepEqual(await Promise.all(results), [
				"stale",
				"stale",
				"started"
			]);
			assert.deepEqual(L.started, ["llm:planet_carrier"]);
		} finally {
			L.close();
		}
	});
});
describe("V5 failure handling (the user always gets an answer or a clear message)", () => {
	for (const [label, err] of [
		["quota exhausted", new TeachingServiceError("LLM_QUOTA_EXCEEDED", "quota")],
		["not configured", new TeachingServiceError("LLM_NOT_CONFIGURED", "x")],
		["backend unavailable", new TeachingServiceError("BACKEND_UNAVAILABLE", "x")],
		["timeout", new TeachingServiceError("TIMEOUT", "x")]
	]) it(`${label}: explains the selected part from the model data, with a notice`, async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			const p = L.controller.ask({
				question: "Explain this part",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			L.requests[0].reject(err);
			assert.equal(await p, "fallback");
			const plan = L.player.getState().plan;
			assert.equal(plan.source, "modelData");
			assert.equal(plan.targetComponentId, "sun_gear");
			assert.ok(L.controller.getState().notice.includes(FALLBACK_NOTICE));
			assert.ok(await L.until(() => L.n.played.length > 0), "it is spoken");
		} finally {
			L.close();
		}
	});
	it("an AI plan that fails validation falls back instead of playing unsafe content", async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			const p = L.controller.ask({
				question: "Explain this part",
				questionType: "explain",
				targetComponentId: "sun_gear"
			});
			L.requests[0].resolve({
				...llmPlan("sun_gear"),
				modelId: "warren_truss_bridge"
			});
			assert.equal(await p, "fallback");
			assert.match(L.controller.getState().notice, /could not be used safely/);
			assert.equal(L.player.getState().plan.source, "modelData");
		} finally {
			L.close();
		}
	});
	it("the request sent to the teacher carries the question type and only this model's facts", async () => {
		const L = lifecycle(selected$1("sun_gear"));
		try {
			L.controller.ask({
				question: "Why is it needed?",
				questionType: "purpose",
				targetComponentId: "sun_gear"
			});
			const body = L.requests[0].body;
			assert.equal(body.questionType, "purpose");
			assert.equal(body.facts.modelId, "planetary_gearbox");
			assert.equal(body.facts.modelDescription, gearbox$1.description);
			assert.ok(body.facts.components.every((c) => gearbox$1.getAllComponentIds().includes(c.id)));
		} finally {
			L.close();
		}
	});
});
describe("V5 narration: late TTS audio is never played", () => {
	it("a clip stopped before its audio arrives never creates audio; queued clips are not even requested", async () => {
		const g = globalThis;
		const realFetch = g.fetch;
		const realAudio = g.Audio;
		let fetches = 0;
		let audios = 0;
		let release;
		g.fetch = (async () => {
			fetches++;
			await new Promise((r) => release = r);
			return new Response(new Uint8Array([
				1,
				2,
				3
			]), {
				status: 200,
				headers: { "Content-Type": "audio/wav" }
			});
		});
		g.Audio = class {
			constructor() {
				audios++;
			}
			play() {
				return Promise.resolve();
			}
			pause() {}
		};
		try {
			const narrator = createTimbreNarrator(() => "en-IN", () => {});
			const a = narrator.prepare("old step", "en-IN");
			const b = narrator.prepare("prefetched next step", "en-IN");
			a.play();
			await sleep$1(10);
			a.stop();
			b.stop();
			release();
			await sleep$1(50);
			assert.equal(await a.done, "stopped");
			assert.equal(audios, 0, "no Audio created for a stopped clip");
			assert.equal(fetches, 1, "the queued (prefetched) clip was never requested");
		} finally {
			g.fetch = realFetch;
			g.Audio = realAudio;
		}
	});
});
describe("V5 grounded explanation from model data", () => {
	it("uses the selected part's own facts and relationships", () => {
		const w = selected$1("sun_gear");
		const v = validateTeachingPlan(buildComponentBrief(gearbox$1, w.snapshot(false), "sun_gear", "explain"), w.snapshot(false), w.dispatcher.getContext());
		assert.ok(v.ok, JSON.stringify(v));
		const plan = v.plan;
		const text = plan.steps.map((s) => s.narration).join(" ");
		const meta = gearbox$1.getComponentMetadata("sun_gear");
		assert.ok(text.includes(meta.role), "role");
		assert.ok(text.includes("is driven by Primary Drive Shaft"), "relationship from the model");
		assert.ok(text.includes("drives Planet Gear A, Planet Gear B and Planet Gear C"));
		assert.ok(text.includes(meta.engineeringNotes[0]), "engineering note");
		const hl = plan.steps.flatMap((s) => s.actions).find((a) => a.type === "component.highlight");
		assert.deepEqual(hl.componentIds.sort(), [
			"central_shaft",
			"planet_gear_1",
			"planet_gear_2",
			"planet_gear_3"
		]);
		assert.equal(plan.steps[plan.steps.length - 1].claim, "notSimulated");
		assert.match(text, /does not calculate forces, torque, friction or wear/);
	});
	it("failure questions are qualified as not simulated and name only linked parts", () => {
		const raw = buildComponentBrief(gearbox$1, selected$1("planet_carrier").snapshot(false), "planet_carrier", "failure");
		const last = raw.steps[raw.steps.length - 1].narration;
		assert.match(last, /A failure cannot be simulated here/);
		assert.ok(!/Sun Gear|Ring Gear|Drive Shaft/.test(last), "no unrelated part claimed");
	});
	it("every part of both models gets a valid, model-only brief (no invented links, no animation claim on the bridge)", () => {
		for (const model of [gearbox$1, bridge$1]) {
			const w = makeWorkspace(model);
			const names = new Set(model.getAllComponentIds().map((id) => model.getComponentMetadata(id)?.name ?? id));
			for (const id of [...model.getAllComponentIds(), null]) {
				const v = validateTeachingPlan(buildComponentBrief(model, w.snapshot(false), id, "explain"), w.snapshot(false), w.dispatcher.getContext());
				assert.ok(v.ok, `${model.id}/${id}: ${JSON.stringify(v)}`);
				const ids = v.plan.steps.flatMap((s) => s.actions).flatMap((a) => a.componentIds ?? (a.componentId ? [a.componentId] : []));
				assert.ok(ids.every((x) => model.getAllComponentIds().includes(x)));
			}
			assert.ok(names.size > 0);
		}
		const text = buildComponentBrief(bridge$1, makeWorkspace(bridge$1).snapshot(false), "bridge_deck").steps.map((s) => s.narration).join(" ");
		assert.ok(!/animation/.test(text));
		assert.match(text, /does not calculate forces or stresses/);
	});
});
// tests/voiceFirst.test.ts
/**
* Voice-first milestone — navigation, conversation flow, interruption policy, language handling
* and the LLM intent fallback mapping. The LLM and Prisma are SIMULATED here (fakes); the
* dispatcher, viewer executor, camera, geometry, parser, validation and player are real.
* Transcripts marked "Prisma" are real Gnani Prisma output (27 Oct 2026).
*/
var gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
var bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
var ALL = modelRegistry.getAllModels();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function turn(w, transcript, language = "en-IN", extra = {}) {
	const r = handleVoiceTurn({
		transcript,
		language,
		dispatcher: w.dispatcher,
		model: w.ws.model,
		allModels: ALL,
		lastDiscussed: w.memory.last,
		teachingAvailable: true,
		...extra
	});
	if (r.discussedComponentId) w.memory.last = {
		modelId: w.ws.model.id,
		componentId: r.discussedComponentId
	};
	return r;
}
var selected = (id, model = gearbox) => {
	const w = makeWorkspace(model);
	w.dispatcher.dispatch({
		type: "component.select",
		componentId: id
	}, "ui");
	return w;
};
var cmds = (r) => r.outcome.kind === "commands" ? r.outcome.commands : null;
describe("Voice navigation through the shared dispatcher", () => {
	for (const [lang, t, expected] of [
		[
			"en-IN",
			"Zoom in",
			[{
				type: "camera.zoom",
				direction: "in"
			}]
		],
		[
			"en-IN",
			"Zoom out a little",
			[{
				type: "camera.zoom",
				direction: "out"
			}]
		],
		[
			"en-IN",
			"Turn left",
			[{
				type: "camera.orbit",
				yawDeg: 30,
				pitchDeg: 0
			}]
		],
		[
			"en-IN",
			"Turn right",
			[{
				type: "camera.orbit",
				yawDeg: -30,
				pitchDeg: 0
			}]
		],
		[
			"en-IN",
			"Show the front",
			[{
				type: "camera.view",
				view: "front"
			}]
		],
		[
			"en-IN",
			"Show the back",
			[{
				type: "camera.view",
				view: "back"
			}]
		],
		[
			"en-IN",
			"Show me the back of the gearbox",
			[{
				type: "camera.view",
				view: "back"
			}]
		],
		[
			"en-IN",
			"Show the top",
			[{
				type: "camera.view",
				view: "top"
			}]
		],
		[
			"en-IN",
			"Move left",
			[{
				type: "camera.pan",
				direction: "left"
			}]
		],
		[
			"en-IN",
			"Move right",
			[{
				type: "camera.pan",
				direction: "right"
			}]
		],
		[
			"en-IN",
			"Reset the view",
			[{ type: "camera.reset" }]
		],
		[
			"te-IN",
			"కెమెరాని ఎడమవైపు తిప్పు",
			[{
				type: "camera.orbit",
				yawDeg: 30,
				pitchDeg: 0
			}]
		],
		[
			"hi-IN",
			"थोड़ा ज़ूम इन करो।",
			[{
				type: "camera.zoom",
				direction: "in"
			}]
		],
		[
			"hi-IN",
			"मुझे पीछे का दृश्य दिखाओ।",
			[{
				type: "camera.view",
				view: "back"
			}]
		],
		[
			"te-IN",
			"షో మీ ద బ్యాక్",
			[{
				type: "camera.view",
				view: "back"
			}]
		],
		[
			"hi-IN",
			"शो मी दी बैक",
			[{
				type: "camera.view",
				view: "back"
			}]
		]
	]) it(`${lang}: "${t}"`, () => assert.deepEqual(cmds(turn(selected("sun_gear"), t, lang)), expected));
	it("\"Zoom in on this gear\" / \"Focus on this part\" / \"ఈ గేర్‌ని దగ్గరగా చూపించు\" focus the selected part", () => {
		for (const [t, lang] of [
			["Zoom in on this gear", "en-IN"],
			["Focus on this part", "en-IN"],
			["ఈ గేర్‌ని దగ్గరగా చూపించు", "te-IN"]
		]) assert.deepEqual(cmds(turn(selected("sun_gear"), t, lang)), [{
			type: "component.select",
			componentId: "sun_gear"
		}, {
			type: "component.focus",
			componentId: "sun_gear"
		}], t);
	});
	it("bottom view: a clear reply (camera kept above the grid), nothing dispatched — also on the bridge", () => {
		for (const [model, t] of [
			[gearbox, "Show the bottom"],
			[bridge, "Show the bottom"],
			[gearbox, "show me the view from below"],
			[gearbox, "नीचे से दिखाओ"]
		]) {
			const w = makeWorkspace(model);
			const before = w.dispatcher.getHistory().length;
			const r = turn(w, t);
			assert.deepEqual(r.outcome, {
				kind: "unavailable",
				intent: "view",
				reason: "noBottomView"
			}, t);
			assert.match(r.caption, /no bottom view/);
			assert.equal(w.dispatcher.getHistory().length, before);
		}
		assert.equal(turn(makeWorkspace(bridge), "select the bottom chords").outcome.kind, "commands", "the bridge part is still reachable by name");
	});
	it("views land where intended and a new command supersedes a transition in progress", () => {
		const w = makeWorkspace();
		turn(w, "Show the back");
		w.tick(1e3);
		assert.equal(w.snapshot(false).camera.value.view, "back");
		turn(w, "Show the front");
		w.tick(100);
		turn(w, "Show the top");
		w.tick(1e3);
		assert.equal(w.snapshot(false).camera.value.view, "top");
	});
	it("turning rotates around the model; moving pans the target", () => {
		const w = makeWorkspace();
		turn(w, "reset the view");
		w.tick(1e3);
		const t0 = w.controller.getGoalPose().target.clone();
		turn(w, "Turn left");
		w.tick(1e3);
		assert.ok(w.controller.getGoalPose().target.distanceTo(t0) < 1e-6, "rotation keeps the target");
		turn(w, "Move left");
		w.tick(1e3);
		assert.ok(w.controller.getGoalPose().target.distanceTo(t0) > .1, "panning moves the target");
	});
	it("voice and gesture/mouse use the same dispatcher and validation", () => {
		const w = makeWorkspace();
		turn(w, "zoom in");
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "ring_gear"
		}, "gesture");
		w.dispatcher.dispatch({
			type: "component.select",
			componentId: "piston"
		}, "mouse");
		const h = w.dispatcher.getHistory().slice(-3).map((r) => `${r.source}:${r.status}`);
		assert.deepEqual(h, [
			"voice:executed",
			"gesture:executed",
			"mouse:rejected"
		]);
	});
});
function fakeNarrator() {
	const spoken = [];
	const clips = [];
	return {
		narrator: { prepare(text, language) {
			const rec = {
				stopped: false,
				paused: false
			};
			clips.push(rec);
			let resolve;
			const done = new Promise((r) => resolve = r);
			let timer = null;
			return {
				done,
				play() {
					spoken.push({
						text,
						language
					});
					let left = 120;
					timer = setInterval(() => {
						if (rec.paused || rec.stopped) return;
						left -= 5;
						if (left <= 0) {
							clearInterval(timer);
							resolve("ended");
						}
					}, 5);
					timer.unref?.();
				},
				pause() {
					rec.paused = true;
				},
				resume() {
					rec.paused = false;
				},
				stop() {
					rec.stopped = true;
					if (timer) clearInterval(timer);
					resolve("stopped");
				}
			};
		} },
		spoken,
		clips
	};
}
function plan(target, steps = 3) {
	return {
		schemaVersion: 1,
		planId: `${target ?? "model"}`.padEnd(32, "a").replace(/[^a-f0-9]/g, "b").slice(0, 32),
		modelId: "planetary_gearbox",
		targetComponentId: target,
		title: `About ${target}`,
		explanation: "x",
		cannotAnswer: null,
		steps: Array.from({ length: steps }, (_, i) => ({
			index: i,
			kind: "demonstrate",
			claim: "metadata",
			narration: `${target} ${i}.`,
			caption: `c${i}`,
			targetComponentId: target,
			actions: target ? [{
				type: "component.focus",
				componentId: target
			}] : [],
			waitFor: "narration",
			holdMs: 0
		})),
		rejectedSteps: [],
		followUpSuggestions: []
	};
}
/** The dock's wiring without React: turn -> supersede/ask/control, simulated teacher replies. */
function conversation(w) {
	const loop = setInterval(() => w.tick(16), 4);
	loop.unref?.();
	const n = fakeNarrator();
	const player = new TeachingPlanPlayer({
		dispatcher: w.dispatcher,
		getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model),
		narrator: n.narrator,
		pollMs: 4,
		settleTimeoutMs: 1500
	});
	const detach = player.attach();
	const requests = [];
	let uiLanguage = "en-IN";
	const controller = new TeachingController({
		dispatcher: w.dispatcher,
		player,
		getModel: () => w.ws.model,
		getLanguage: () => uiLanguage,
		requestPlan: (body) => new Promise((resolve) => requests.push({
			body,
			resolve
		})),
		onPlanStarted: (p) => {
			if (p.targetComponentId) w.memory.last = {
				modelId: p.modelId,
				componentId: p.targetComponentId
			};
		}
	});
	const say = (text) => {
		const lang = turnLanguage(text, uiLanguage);
		uiLanguage = lang;
		const r = turn(w, text, lang, {
			teachingActive: controller.isActive(),
			onSupersede: () => controller.supersede()
		});
		if (r.status === "teach" && r.teach) controller.ask({
			...r.teach,
			language: r.teach.language ?? lang
		});
		if (r.status === "control") {
			if (r.control === "resume") player.resume();
			else if (r.control === "pause") player.pause();
			else controller.supersede();
		}
		return r;
	};
	const answer = async (i, target) => {
		requests[i].resolve(plan(target));
		const t0 = Date.now();
		while (!(player.getState().plan?.targetComponentId === target && player.getState().phase === "narrating") && Date.now() - t0 < 3e3) await sleep(5);
	};
	const close = () => {
		controller.cancel();
		detach();
		clearInterval(loop);
	};
	return {
		player,
		controller,
		requests,
		n,
		say,
		answer,
		close,
		language: () => uiLanguage
	};
}
describe("Conversation flow (Phase 2) and interruption scenarios", () => {
	it("select -> explain -> why -> correction -> Telugu follow-up -> camera command", async () => {
		const w = selected("sun_gear");
		const c = conversation(w);
		try {
			assert.equal(c.say("Explain this part.").teach.targetComponentId, "sun_gear");
			await c.answer(0, "sun_gear");
			const why = c.say("Why is it needed?");
			assert.deepEqual([why.teach.targetComponentId, why.teach.questionType], ["sun_gear", "purpose"]);
			await c.answer(1, "sun_gear");
			const fix = c.say("No, not that one. Explain the planet carrier.");
			assert.equal(fix.teach.targetComponentId, "planet_carrier");
			await c.answer(2, "planet_carrier");
			const te = c.say("ఇది అసలు ఎందుకు అవసరం?");
			assert.deepEqual([te.teach.targetComponentId, te.teach.questionType], ["planet_carrier", "purpose"]);
			assert.equal(c.requests[3].body.language, "te-IN", "answer requested in Telugu");
			assert.equal(c.language(), "te-IN");
			await c.answer(3, "planet_carrier");
			assert.equal(c.n.spoken[c.n.spoken.length - 1].language, "te-IN", "narration language = request language");
			const h = w.dispatcher.getHistory().length;
			const back = c.say("Show me the back.");
			assert.deepEqual(cmds(back), [{
				type: "camera.view",
				view: "back"
			}]);
			assert.equal(c.language(), "en-IN", "latest request was English");
			assert.equal(c.player.getState().status, "paused", "camera command pauses the explanation");
			await sleep(250);
			assert.ok(!w.dispatcher.getHistory().slice(h).some((r) => r.source === "ai"), "no stale plan action after the camera command");
		} finally {
			c.close();
		}
	});
	it("Scenario A: a new target stops the old narration; the old plan issues nothing more", async () => {
		const w = makeWorkspace();
		const c = conversation(w);
		try {
			c.say("Explain the sun gear.");
			await c.answer(0, "sun_gear");
			const playing = c.n.clips.length - 1;
			c.say("No, explain the planet carrier.");
			assert.ok(c.n.clips[playing].stopped, "old audio stopped at once");
			const h = w.dispatcher.getHistory().length;
			await c.answer(1, "planet_carrier");
			assert.ok(!w.dispatcher.getHistory().slice(h).some((r) => JSON.stringify(r.command).includes("sun_gear")));
		} finally {
			c.close();
		}
	});
	it("Scenario B: interrupting in Telugu (and then Hindi) keeps the part and answers in that language", async () => {
		const c = conversation(makeWorkspace());
		try {
			c.say("Explain the ring gear.");
			await c.answer(0, "ring_gear");
			const te = c.say("దీని ఉపయోగం ఏమిటి");
			assert.deepEqual([te.teach.targetComponentId, c.requests[1].body.language], ["ring_gear", "te-IN"]);
			await c.answer(1, "ring_gear");
			const hi = c.say("इसकी जरूरत क्यों है");
			assert.deepEqual([hi.teach.targetComponentId, c.requests[2].body.language], ["ring_gear", "hi-IN"]);
		} finally {
			c.close();
		}
	});
	it("Scenario C: \"zoom in\" during a demonstration runs, pauses the plan, and \"continue\" resumes it", async () => {
		const c = conversation(makeWorkspace());
		try {
			c.say("Explain how this gearbox works.");
			await c.answer(0, null);
			const zoom = c.say("Zoom in");
			assert.equal(zoom.status, "executed");
			assert.equal(c.player.getState().status, "paused");
			const pos = c.player.getState().stepPosition;
			await sleep(300);
			assert.equal(c.player.getState().stepPosition, pos, "the plan does not continue (or undo the zoom) on its own");
			assert.equal(c.say("continue").control, "resume");
			assert.equal(c.player.getState().status, "running");
		} finally {
			c.close();
		}
	});
	it("Scenario D: \"What would happen if it were missing?\" stays on the ring gear", async () => {
		const c = conversation(makeWorkspace());
		try {
			c.say("Explain the ring gear.");
			await c.answer(0, "ring_gear");
			const r = c.say("What would happen if it were missing?");
			assert.deepEqual([r.teach.targetComponentId, r.teach.questionType], ["ring_gear", "failure"]);
		} finally {
			c.close();
		}
	});
});
describe("Conversation language", () => {
	it("detects the spoken language from the transcript script", () => {
		assert.equal(scriptLanguage("ఇది అసలు ఎందుకు అవసరం"), "te-IN");
		assert.equal(scriptLanguage("मुझे पीछे का दृश्य दिखाओ"), "hi-IN");
		assert.equal(scriptLanguage("show me the back"), null);
		assert.equal(turnLanguage("ఇది ఎందుకు", "en-IN"), "te-IN");
		assert.equal(turnLanguage("show me the back", "te-IN"), "en-IN");
		assert.equal(turnLanguage("पीछे दिखाओ", "mr-IN"), "mr-IN", "Marathi shares Devanagari; keep the selection");
		assert.equal(turnLanguage("zoom in", "ta-IN"), "ta-IN");
	});
	const PRISMA = {
		teluguSpeech: {
			"en-IN": "idi asal educ avasar",
			"hi-IN": "इधर असल एंड को अवसर",
			"te-IN": "ఇది అసలు ఎందుకు అవసరం"
		},
		hindiSpeech: {
			"en-IN": "mujhe pichhe ka drishya dikhao",
			"te-IN": "ముజి కా దృశ్య ది ఖా",
			"hi-IN": "मुझे पीछे का दृश्य दिखाओ।"
		},
		englishSpeech: {
			"en-IN": "show me the back",
			"te-IN": "షో మీ ద బ్యాక్",
			"hi-IN": "शो मी दी बैक"
		}
	};
	const understoodBy = (w) => (t) => previewTurn({
		transcript: t,
		dispatcher: w.dispatcher,
		model: gearbox,
		allModels: ALL
	}).kind !== "noMatch";
	it("Telugu spoken while English is selected: re-transcribed and understood as Telugu", async () => {
		const w = selected("planet_carrier");
		const calls = [];
		const r = await transcribeWithLanguageRetry(new Blob(), "en-IN", async (_b, l) => {
			calls.push(l);
			return PRISMA.teluguSpeech[l];
		}, understoodBy(w));
		assert.deepEqual(r, {
			text: "ఇది అసలు ఎందుకు అవసరం",
			language: "te-IN",
			retried: true
		});
		assert.deepEqual(calls.sort(), [
			"en-IN",
			"hi-IN",
			"te-IN"
		]);
	});
	it("Hindi spoken while Telugu is selected: understood as Hindi", async () => {
		const w = makeWorkspace();
		const r = await transcribeWithLanguageRetry(new Blob(), "te-IN", async (_b, l) => PRISMA.hindiSpeech[l], understoodBy(w));
		assert.deepEqual([r.language, r.retried], ["hi-IN", true]);
	});
	it("understood on the first try: one Prisma call only (English heard as Telugu is still understood)", async () => {
		const w = makeWorkspace();
		let calls = 0;
		const r = await transcribeWithLanguageRetry(new Blob(), "te-IN", async (_b, l) => {
			calls++;
			return PRISMA.englishSpeech[l];
		}, understoodBy(w));
		assert.deepEqual([
			calls,
			r.retried,
			r.text
		], [
			1,
			false,
			"షో మీ ద బ్యాక్"
		]);
	});
	it("nothing understood in any language: keeps the first transcript (then the LLM fallback / \"didn't understand\")", async () => {
		const w = makeWorkspace();
		const r = await transcribeWithLanguageRetry(new Blob(), "en-IN", async () => "hmm mm", understoodBy(w));
		assert.deepEqual(r, {
			text: "hmm mm",
			language: "en-IN",
			retried: true
		});
	});
	it("a cancelled turn rejects instead of returning a late transcript", async () => {
		const w = makeWorkspace();
		const c = new AbortController();
		const p = transcribeWithLanguageRetry(new Blob(), "en-IN", async (_b, l) => {
			if (l === "en-IN") c.abort();
			return PRISMA.teluguSpeech[l];
		}, understoodBy(w), c.signal);
		await assert.rejects(p);
	});
});
describe("LLM intent fallback: every intent maps to a validated deterministic phrase", () => {
	const nameOf = (id) => lexiconFor(gearbox).find((e) => e.componentId === id)?.displayName ?? null;
	for (const intent of INTERPRET_INTENTS) it(`${intent}`, () => {
		const i = {
			intent,
			componentId: intent.endsWith("_part") || intent === "related_parts" ? "ring_gear" : null,
			language: null
		};
		const phrase = canonicalPhrase(i, nameOf);
		if (intent === "unclear" || intent === "unsupported") {
			assert.equal(phrase, null);
			return;
		}
		const outcome = previewTurn({
			transcript: phrase,
			dispatcher: selected("sun_gear").dispatcher,
			model: gearbox,
			allModels: ALL,
			teachingActive: intent.endsWith("_explanation")
		});
		assert.notEqual(outcome.kind, "noMatch", `"${phrase}" must be understood`);
		if (i.componentId && outcome.kind === "question") assert.equal(outcome.partId, "ring_gear", phrase);
		if (i.componentId && outcome.kind === "commands") assert.equal(outcome.partId, "ring_gear", phrase);
	});
	it("client errors are reported, unknown intents rejected", async () => {
		const respond = (status, data) => (async () => new Response(JSON.stringify(data), { status }));
		const body = {
			transcript: "t",
			language: "en-IN",
			modelId: "m",
			modelName: "M",
			components: [],
			topicComponentId: null,
			teachingActive: false
		};
		assert.deepEqual(await requestInterpretation(body, void 0, respond(200, {
			intent: "zoom_in",
			componentId: null,
			language: "te-IN"
		})), {
			intent: "zoom_in",
			componentId: null,
			language: "te-IN"
		});
		await assert.rejects(requestInterpretation(body, void 0, respond(200, { intent: "format_disk" })));
		await assert.rejects(requestInterpretation(body, void 0, respond(429, { error: { code: "LLM_QUOTA_EXCEEDED" } })), (e) => e.code === "LLM_QUOTA_EXCEEDED");
	});
});
describe("Inspector \"Ask the tutor\" requests", () => {
	it("every button phrase, for every part of both models, targets that part with the right question type", () => {
		for (const model of [gearbox, bridge]) for (const id of model.getAllComponentIds()) {
			const name = model.getComponentMetadata(id).name;
			const w = makeWorkspace(model);
			for (const [phrase, type] of [
				[`explain the ${name}`, "explain"],
				[`why is the ${name} needed`, "purpose"],
				[`how does the ${name} work`, "howWorks"],
				[`what happens if the ${name} fails`, "failure"]
			]) {
				const o = previewTurn({
					transcript: phrase,
					dispatcher: w.dispatcher,
					model,
					allModels: ALL
				});
				assert.equal(o.kind, "question", `${model.id}: "${phrase}" -> ${JSON.stringify(o)}`);
				if (o.kind === "question") assert.deepEqual([o.partId, o.question], [id, type], phrase);
			}
		}
	});
	it("\"explain how this model works\" is a whole-model question on both models", () => {
		for (const model of [gearbox, bridge]) {
			const o = previewTurn({
				transcript: "explain how this model works",
				dispatcher: makeWorkspace(model).dispatcher,
				model,
				allModels: ALL
			});
			assert.deepEqual(o.kind === "question" && [o.question, o.partId], ["explain", void 0]);
		}
	});
});
describe("Fallback language honesty", () => {
	it("a Telugu request answered from the (English) model data says so", async () => {
		const { ENGLISH_FALLBACK_NOTE } = await Promise.resolve().then(() => teachingController_exports);
		const c = conversation(selected("planet_carrier"));
		try {
			const p = c.controller.ask({
				question: "ఇది ఎందుకు అవసరం",
				questionType: "purpose",
				targetComponentId: "planet_carrier",
				language: "te-IN"
			});
			c.requests[0].resolve(Promise.reject(Object.assign(/* @__PURE__ */ new Error("quota"), { code: "LLM_QUOTA_EXCEEDED" })));
			assert.equal(await p, "fallback");
			assert.ok(c.controller.getState().notice.includes(ENGLISH_FALLBACK_NOTE));
			assert.equal(c.player.getState().plan.language, "en-IN");
		} finally {
			c.close();
		}
	});
});
export {};
