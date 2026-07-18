import * as THREE from "three";
import type { AnimationParams, BowlParams, PartTopFace } from "../types";
import {
  getOrientationGuideLayout,
  getOrientationGuideProgress,
  getOrientationPartCenterOffset,
  getOrientationRollAngle,
  getOrientationTrackLaneWidth,
  needsVerticalOrientationGuide,
} from "./orientationGuide";
import { getEffectiveTrackTotalRise } from "./trackClimb";

const TRACK_LEAD_IN_RATIO = 0.08;
const PART_SUPPORT_CLEARANCE = 0.15;
const TWO_PI = Math.PI * 2;

export interface BowlMotionPose {
  entryProgress: number;
  guideProgress: number;
  guideRollAngle: number;
  laneCenterOffset: number;
  laneWidth: number;
  position: THREE.Vector3;
  sideAxis: THREE.Vector3;
  tangent: THREE.Vector3;
  outletProgress: number;
  progress: number;
  pathLength: number;
}

export interface PhysicalEnvelope {
  height: number;
  length: number;
  width: number;
}

export interface MotionConstraints {
  baseLaneWidth: number;
  canEnterTrack: boolean;
  canExit: boolean;
  canPassGuide: boolean;
  entryDistance: number;
  guideEntryDistance: number;
  guideLaneWidth: number;
  laneWidth: number;
  maxDistance: number;
  minimumSpacing: number;
  outletEntryDistance: number;
  outletHeight: number;
  pathLength: number;
  requiredGuideLaneWidth: number;
  requiredLaneWidth: number;
  requiredOutletHeight: number;
}

export function getVibrationFeedRate(animation: AnimationParams) {
  if (!animation.enabled || animation.amplitude <= 0 || animation.frequency <= 0 || animation.speed <= 0) {
    return 0;
  }

  const voltageRatio = THREE.MathUtils.clamp(animation.voltage / 220, 0, 1.35);
  const effectiveAmplitude = animation.amplitude * voltageRatio;
  return THREE.MathUtils.clamp(effectiveAmplitude * animation.frequency * animation.speed * 0.72, 0, 600);
}

export function getBowlMotionPose(params: BowlParams, distanceMm: number): BowlMotionPose {
  if (params.shape !== "round") {
    return getRectMotionPose(params, distanceMm);
  }

  const layout = getRoundMotionLayout(params);
  const wrappedDistance = wrapDistance(distanceMm, layout.pathLength);

  if (wrappedDistance <= layout.entryLength) {
    return getBottomEntryMotionPose(params, wrappedDistance, layout.pathLength);
  }

  const spiralDistance = wrappedDistance - layout.entryLength;
  if (spiralDistance <= layout.spiralLength) {
    const t = spiralDistance / layout.spiralLength;
    const guideState = getTrackGuideState(params, t);
    const sideAxis = getSpiralSideAxis(params, t);
    const position = getSpiralPosition(params, t)
      .add(new THREE.Vector3(0, guideState.surfaceLift, 0))
      .add(sideAxis.clone().multiplyScalar(guideState.laneCenterOffset));
    const tangent = getSpiralTangent(params, t);

    return {
      entryProgress: 1,
      guideProgress: guideState.guideProgress,
      guideRollAngle: getOrientationRollAngle(params, t),
      laneCenterOffset: guideState.laneCenterOffset,
      laneWidth: guideState.laneWidth,
      position,
      sideAxis,
      tangent,
      outletProgress: 0,
      progress: wrappedDistance / layout.pathLength,
      pathLength: layout.pathLength,
    };
  }

  const outletDistance = spiralDistance - layout.spiralLength;
  const outletProgress = THREE.MathUtils.clamp(outletDistance / layout.outletLength, 0, 1);
  const guideState = getOutletGuideState(params);
  const sideAxis = getOutletSideAxis(layout.tangent);
  const outletStart = layout.radial.clone().multiplyScalar(layout.trackCenterRadius);
  const position = outletStart
    .clone()
    .add(layout.tangent.clone().multiplyScalar(outletDistance))
    .add(sideAxis.clone().multiplyScalar(guideState.laneCenterOffset))
    .setY(layout.outletY + guideState.surfaceLift);

  return {
    entryProgress: 1,
    guideProgress: guideState.guideProgress,
    guideRollAngle: getOrientationRollAngle(params, 1),
    laneCenterOffset: guideState.laneCenterOffset,
    laneWidth: guideState.laneWidth,
    position,
    sideAxis,
    tangent: layout.tangent.clone(),
    outletProgress,
    progress: wrappedDistance / layout.pathLength,
    pathLength: layout.pathLength,
  };
}

export function getBowlMotionPathLength(params: BowlParams) {
  if (params.shape !== "round") {
    return Math.max(1, Math.max(params.bowlLength, params.bowlWidth) * 0.82);
  }

  return getRoundMotionLayout(params).pathLength;
}

export function getMotionConstraints(
  params: BowlParams,
  envelope: PhysicalEnvelope,
): MotionConstraints {
  const pathLength = getBowlMotionPathLength(params);
  const guideLayout = getOrientationGuideLayout(params);
  const entryLength = params.partEntryLength && params.partEntryLength > 0
    ? params.partEntryLength
    : envelope.length;
  const entryWidth = params.partEntryWidth && params.partEntryWidth > 0
    ? params.partEntryWidth
    : envelope.width;
  const bendAllowance = getCurveBendAllowance(params, entryLength);
  const baseLaneWidth = getBaseLaneWidth(params);
  const guideLaneWidth = getRestrictedGuideLaneWidth(params, baseLaneWidth);
  const laneWidth = Math.min(baseLaneWidth, guideLaneWidth);
  const outletHeight = Math.max(1, params.outletHeight - params.trackThickness);
  const widthClearance = getMotionSideClearance(params);
  const requiredLaneWidth = entryWidth + widthClearance * 2 + bendAllowance;
  const requiredGuideLaneWidth = guideLayout.guideActive
    ? guideLayout.targetLaneWidth
    : envelope.width + widthClearance * 2 + getCurveBendAllowance(params, envelope.length);
  const canEnterTrack = requiredLaneWidth <= baseLaneWidth;
  const canPassGuide = requiredGuideLaneWidth <= guideLaneWidth;
  const requiredOutletHeight = getRequiredOutletPoseHeight(params, envelope);
  const canExit = requiredOutletHeight <= outletHeight;
  const roundLayout = params.shape === "round" ? getRoundMotionLayout(params) : null;
  const outletEntryDistance = params.shape === "round"
    ? (roundLayout?.entryLength ?? 0) + (roundLayout?.spiralLength ?? pathLength)
    : pathLength * 0.78;
  const guideEntryDistance = params.shape === "round"
    ? (roundLayout?.entryLength ?? 0)
      + (roundLayout?.spiralLength ?? pathLength) * guideLayout.singulationStart
    : pathLength * 0.18;
  const controllingLength = Math.max(envelope.length, entryLength);
  const jamClearance = Math.max(12, controllingLength * 0.35);
  const minimumSpacing = controllingLength + jamClearance;
  const entryDistance = roundLayout
    ? Math.min(roundLayout.entryLength * 0.78, Math.max(minimumSpacing * 0.45, roundLayout.entryLength * 0.55))
    : Math.max(0, minimumSpacing * 0.45);
  const maxDistance = getConstrainedMaxDistance({
    canEnterTrack,
    canExit,
    canPassGuide,
    entryDistance,
    guideEntryDistance,
    minimumSpacing,
    outletEntryDistance,
    pathLength,
  });

  return {
    baseLaneWidth,
    canEnterTrack,
    canExit,
    canPassGuide,
    entryDistance,
    guideEntryDistance,
    guideLaneWidth,
    laneWidth,
    maxDistance,
    minimumSpacing,
    outletEntryDistance,
    outletHeight,
    pathLength,
    requiredGuideLaneWidth,
    requiredLaneWidth,
    requiredOutletHeight,
  };
}

function getCurveBendAllowance(params: BowlParams, length: number) {
  if (params.shape !== "round") return 0;

  const minRadius = Math.max(1, Math.min(getTrackCenterRadius(params, 0), getTrackCenterRadius(params, 1)));
  return (length * length) / (4 * minRadius);
}

export function clampMotionDistance(distanceMm: number, constraints: MotionConstraints) {
  if (constraints.pathLength <= 0) return 0;

  if (constraints.canEnterTrack && constraints.canPassGuide && constraints.canExit) {
    return wrapDistance(distanceMm, constraints.pathLength);
  }

  return THREE.MathUtils.clamp(distanceMm, 0, constraints.maxDistance);
}

function getRequiredOutletPoseHeight(params: BowlParams, envelope: PhysicalEnvelope) {
  if (params.outletOrientation === "sideUp") {
    return Math.max(envelope.height, envelope.width);
  }

  if (params.outletOrientation === "standing") {
    return Math.max(envelope.height, envelope.length, envelope.width);
  }

  return envelope.height;
}

function getRectMotionPose(params: BowlParams, distanceMm: number): BowlMotionPose {
  const pathLength = getBowlMotionPathLength(params);
  const wrappedDistance = wrapDistance(distanceMm, pathLength);
  const t = wrappedDistance / pathLength;
  const x = THREE.MathUtils.lerp(-params.bowlLength * 0.36, params.bowlLength * 0.36, t);
  const z = params.bowlWidth * 0.28;
  const y = params.baseHeight + params.bottomThickness + PART_SUPPORT_CLEARANCE;
  const guideProgress = params.partTopFace === "yPositive" ? 1 : 0;

  return {
    entryProgress: 1,
    guideProgress,
    guideRollAngle: 0,
    laneCenterOffset: 0,
    laneWidth: getBaseLaneWidth(params),
    position: new THREE.Vector3(x, y, z),
    sideAxis: new THREE.Vector3(0, 0, 1),
    tangent: new THREE.Vector3(1, 0, 0),
    outletProgress: t > 0.78 ? (t - 0.78) / 0.22 : 0,
    progress: t,
    pathLength,
  };
}

function getBottomEntryMotionPose(
  params: BowlParams,
  entryDistance: number,
  pathLength: number,
): BowlMotionPose {
  const guideLayout = getOrientationGuideLayout(params);
  const entryLength = Math.max(1, guideLayout.entryApproachLength);
  const entryProgress = THREE.MathUtils.clamp(entryDistance / entryLength, 0, 1);
  const blend = smootherstep(entryProgress);
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const startAngle = Math.PI * 0.2;
  const trackCenterRadius = getTrackCenterRadius(params, 0);
  const entryAngle = entryLength / Math.max(20, trackCenterRadius);
  const angle = startAngle - sign * entryAngle * (1 - entryProgress);
  const baseLaneWidth = getBaseLaneWidth(params);
  const laneWidth = THREE.MathUtils.lerp(guideLayout.entryCaptureWidth, baseLaneWidth, blend);
  const outerReferenceRadius = trackCenterRadius + baseLaneWidth / 2;
  const centerRadius = Math.max(1, outerReferenceRadius - laneWidth / 2);
  const sideAxis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
  const tangent = new THREE.Vector3(sign * -Math.sin(angle), 0, sign * Math.cos(angle)).normalize();
  const position = sideAxis
    .clone()
    .multiplyScalar(centerRadius)
    .setY(params.baseHeight + params.bottomThickness + PART_SUPPORT_CLEARANCE);

  return {
    entryProgress,
    guideProgress: 0,
    guideRollAngle: 0,
    laneCenterOffset: 0,
    laneWidth,
    position,
    sideAxis,
    tangent,
    outletProgress: 0,
    progress: entryDistance / Math.max(1, pathLength),
    pathLength,
  };
}

function getRoundMotionLayout(params: BowlParams) {
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalRise = getEffectiveTotalRise(params);
  const startAngle = Math.PI * 0.2;
  const endAngle = startAngle + sign * params.trackTurns * TWO_PI;
  const profileRatio = getProfileHeightRatio(params, totalRise);
  const outerRadius = getRoundProfileRadius(params, profileRatio);
  const trackCenterRadius = Math.max(1, outerRadius - params.wallThickness - params.trackWidth / 2);
  const radial = new THREE.Vector3(Math.cos(endAngle), 0, Math.sin(endAngle)).normalize();
  const tangent = new THREE.Vector3(sign * -Math.sin(endAngle), 0, sign * Math.cos(endAngle)).normalize();
  const wallExitDistance = Math.sqrt(Math.max(0, outerRadius * outerRadius - trackCenterRadius * trackCenterRadius));
  const outletLength = Math.max(1, wallExitDistance + params.outletLength * 0.96);
  const entryLength = getOrientationGuideLayout(params).entryApproachLength;
  const startRadius = getTrackCenterRadius(params, 0);
  const endRadius = getTrackCenterRadius(params, 1);
  const averageRadius = (startRadius + endRadius) / 2;
  const arcLength = Math.abs(params.trackTurns * TWO_PI * averageRadius);
  const spiralLength = Math.max(1, Math.hypot(arcLength, totalRise));
  const pathLength = entryLength + spiralLength + outletLength;
  const outletY = params.baseHeight
    + params.bottomThickness
    + params.trackThickness
    + totalRise
    + PART_SUPPORT_CLEARANCE;

  return {
    entryLength,
    radial,
    tangent,
    trackCenterRadius,
    spiralLength,
    outletLength,
    pathLength,
    outletY,
  };
}

function getSpiralPosition(params: BowlParams, t: number) {
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * TWO_PI;
  const startAngle = Math.PI * 0.2;
  const angle = startAngle + sign * totalAngle * t;
  const radius = getTrackCenterRadius(params, t);
  const totalRise = getEffectiveTotalRise(params);
  const y = params.baseHeight
    + params.bottomThickness
    + totalRise * t
    + getTrackThicknessAt(t, params.trackThickness)
    + PART_SUPPORT_CLEARANCE;

  return new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
}

function getSpiralSideAxis(params: BowlParams, t: number) {
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * TWO_PI;
  const startAngle = Math.PI * 0.2;
  const angle = startAngle + sign * totalAngle * t;
  return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
}

function getSpiralTangent(params: BowlParams, t: number) {
  const sampleStep = 0.003;
  const previous = getSpiralPosition(params, THREE.MathUtils.clamp(t - sampleStep, 0, 1));
  const next = getSpiralPosition(params, THREE.MathUtils.clamp(t + sampleStep, 0, 1));
  const tangent = next.sub(previous);
  tangent.y = 0;

  if (tangent.lengthSq() < 0.000001) {
    const sign = params.feedDirection === "clockwise" ? -1 : 1;
    const angle = Math.PI * 0.2 + sign * params.trackTurns * TWO_PI * t;
    tangent.set(sign * -Math.sin(angle), 0, sign * Math.cos(angle));
  }

  return tangent.normalize();
}

function getTrackCenterRadius(params: BowlParams, t: number) {
  const totalRise = getEffectiveTotalRise(params);
  const profileRatio = getProfileHeightRatio(params, totalRise * t);
  return Math.max(1, getRoundProfileRadius(params, profileRatio) - params.wallThickness - params.trackWidth / 2);
}

function getTrackGuideState(params: BowlParams, t: number) {
  const baseLaneWidth = getBaseLaneWidth(params);
  const verticalGuide = needsVerticalOrientationGuide(params);
  if (!verticalGuide) {
    // A top face is already stable on the bowl floor. Unsupported 180-degree
    // targets must not be faked later in the spiral by animation alone.
    return createGuideState(params.partTopFace === "yPositive" ? 1 : 0, 0, baseLaneWidth);
  }

  const guideProgress = getOrientationGuideProgress(params, t);
  const laneWidth = getOrientationTrackLaneWidth(params, t, baseLaneWidth);
  const laneCenterOffset = getOrientationPartCenterOffset(params, t);
  const surfaceLift = getGuideSurfaceLift(params) * guideProgress;

  return createGuideState(guideProgress, laneCenterOffset, laneWidth, surfaceLift);
}

function getOutletGuideState(params: BowlParams) {
  const baseLaneWidth = getBaseLaneWidth(params);
  if (!needsVerticalOrientationGuide(params)) {
    return createGuideState(params.partTopFace === "yPositive" ? 1 : 0, 0, baseLaneWidth);
  }

  const laneWidth = getRestrictedGuideLaneWidth(params, baseLaneWidth);
  return createGuideState(
    1,
    getGuideLaneCenterOffset(params, laneWidth),
    laneWidth,
    getGuideSurfaceLift(params),
  );
}

function createGuideState(
  guideProgress: number,
  laneCenterOffset: number,
  laneWidth: number,
  surfaceLift = 0,
) {
  return {
    guideProgress,
    laneCenterOffset,
    laneWidth,
    surfaceLift,
  };
}

function getGuideSurfaceLift(_params: BowlParams) {
  // The renderer lifts the part by the instantaneous rotated envelope, while
  // this path remains the physical support-surface reference.
  return 0;
}

function getBaseLaneWidth(params: BowlParams) {
  return params.shape === "round"
    ? Math.max(1, params.trackWidth - params.wallThickness * 1.5)
    : Math.max(1, params.bowlWidth - params.wallThickness * 2);
}

function getRestrictedGuideLaneWidth(params: BowlParams, baseLaneWidth = getBaseLaneWidth(params)) {
  if (needsVerticalOrientationGuide(params)) {
    return Math.min(baseLaneWidth, getOrientationGuideLayout(params).targetLaneWidth);
  }
  if (params.partTopFace === "auto") return baseLaneWidth;
  return Math.min(baseLaneWidth, getOrientationLaneWidth(params));
}

function getOrientationLaneWidth(params: BowlParams) {
  const fittedWidth = getFittedLaneWidth(params);
  if (fittedWidth !== null) return fittedWidth;

  const railThickness = Math.max(4, params.wallThickness);
  if (isSideTopFace(params.partTopFace)) {
    return THREE.MathUtils.clamp(params.trackWidth * 0.46, railThickness * 3.2, params.trackWidth * 0.62);
  }

  return THREE.MathUtils.clamp(params.trackWidth * 0.72, railThickness * 4.2, params.trackWidth - railThickness * 1.4);
}

function getGuideLaneCenterOffset(params: BowlParams, laneWidth: number) {
  if (needsVerticalOrientationGuide(params)) return 0;
  if (!isSideTopFace(params.partTopFace)) return 0;

  const visibleContactOffset = THREE.MathUtils.clamp(
    params.partFitWidth ? getMotionSideClearance(params) * 0.8 : params.trackWidth * 0.14,
    0.4,
    laneWidth * 0.2,
  );
  return getTopFaceSideBias(params.partTopFace) * visibleContactOffset;
}

function getFittedLaneWidth(params: BowlParams) {
  if (!params.partFitWidth || params.partFitWidth <= 0) return null;
  return params.partFitWidth + getMotionSideClearance(params) * 2 + getFittedBendAllowance(params);
}

function getMotionSideClearance(params: BowlParams) {
  if (params.partFitClearance && params.partFitClearance > 0) {
    return params.partFitClearance;
  }

  return Math.max(3, Math.min(8, params.trackWidth * 0.08));
}

function getFittedBendAllowance(params: BowlParams) {
  if (params.shape !== "round" || !params.partFitLength || params.partFitLength <= 0) return 0;

  const minRadius = Math.max(1, Math.min(getTrackCenterRadius(params, 0), getTrackCenterRadius(params, 1)));
  return (params.partFitLength * params.partFitLength) / (4 * minRadius);
}

function isSideTopFace(face: PartTopFace) {
  return face === "xPositive" || face === "xNegative" || face === "zPositive" || face === "zNegative";
}

function getTopFaceSideBias(face: PartTopFace) {
  return face === "xNegative" || face === "zNegative" ? -1 : 1;
}

function getConstrainedMaxDistance({
  canEnterTrack,
  canExit,
  canPassGuide,
  entryDistance,
  guideEntryDistance,
  minimumSpacing,
  outletEntryDistance,
  pathLength,
}: {
  canEnterTrack: boolean;
  canExit: boolean;
  canPassGuide: boolean;
  entryDistance: number;
  guideEntryDistance: number;
  minimumSpacing: number;
  outletEntryDistance: number;
  pathLength: number;
}) {
  if (!canEnterTrack) {
    return Math.max(0, entryDistance * 0.35);
  }

  if (!canPassGuide) {
    return Math.max(0, guideEntryDistance - minimumSpacing * 0.25);
  }

  if (!canExit) {
    return Math.max(entryDistance, outletEntryDistance - minimumSpacing * 0.35);
  }

  return pathLength;
}

function getEffectiveTotalRise(params: BowlParams) {
  return getEffectiveTrackTotalRise(params);
}

function getTrackThicknessAt(t: number, thickness: number) {
  return thickness * smoothstep(THREE.MathUtils.clamp(t / TRACK_LEAD_IN_RATIO, 0, 1));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function smootherstep(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function getProfileHeightRatio(params: BowlParams, localRise: number) {
  return (params.bottomThickness + localRise) / Math.max(1, params.bowlHeight);
}

function getRoundProfileRadius(params: BowlParams, heightRatio: number) {
  const topRadius = params.bowlDiameter / 2;
  if (params.bowlProfile === "cylindrical") {
    return topRadius;
  }

  const bottomRadius = topRadius * THREE.MathUtils.clamp(params.conicalBottomRatio / 100, 0.35, 1);
  return bottomRadius + (topRadius - bottomRadius) * THREE.MathUtils.clamp(heightRatio, 0, 1);
}

function getOutletSideAxis(tangent: THREE.Vector3) {
  return new THREE.Vector3()
    .crossVectors(tangent.clone().normalize(), new THREE.Vector3(0, 1, 0))
    .normalize();
}

function wrapDistance(distanceMm: number, pathLength: number) {
  return ((distanceMm % pathLength) + pathLength) % pathLength;
}
