import * as THREE from "three";
import type { AnimationParams, BowlParams } from "../types";
import { getEffectiveTrackTotalRise } from "./trackClimb";

const TRACK_LEAD_IN_RATIO = 0.08;
const TWO_PI = Math.PI * 2;

export interface BowlMotionPose {
  position: THREE.Vector3;
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
  canEnterTrack: boolean;
  canExit: boolean;
  entryDistance: number;
  laneWidth: number;
  maxDistance: number;
  minimumSpacing: number;
  outletEntryDistance: number;
  outletHeight: number;
  pathLength: number;
  requiredLaneWidth: number;
  requiredOutletHeight: number;
}

export function getVibrationFeedRate(animation: AnimationParams) {
  if (!animation.enabled || animation.amplitude <= 0 || animation.frequency <= 0 || animation.speed <= 0) {
    return 0;
  }

  const voltageRatio = THREE.MathUtils.clamp(animation.voltage / 220, 0, 1.35);
  const effectiveAmplitude = animation.amplitude * voltageRatio;
  return THREE.MathUtils.clamp(effectiveAmplitude * animation.frequency * animation.speed * 2.1, 0, 1800);
}

export function getBowlMotionPose(params: BowlParams, distanceMm: number): BowlMotionPose {
  if (params.shape !== "round") {
    return getRectMotionPose(params, distanceMm);
  }

  const layout = getRoundMotionLayout(params);
  const wrappedDistance = wrapDistance(distanceMm, layout.pathLength);

  if (wrappedDistance <= layout.spiralLength) {
    const t = wrappedDistance / layout.spiralLength;
    const position = getSpiralPosition(params, t);
    const tangent = getSpiralTangent(params, t);

    return {
      position,
      tangent,
      outletProgress: 0,
      progress: wrappedDistance / layout.pathLength,
      pathLength: layout.pathLength,
    };
  }

  const outletDistance = wrappedDistance - layout.spiralLength;
  const outletProgress = THREE.MathUtils.clamp(outletDistance / layout.outletLength, 0, 1);
  const outletStart = layout.radial.clone().multiplyScalar(layout.trackCenterRadius);
  const position = outletStart
    .clone()
    .add(layout.tangent.clone().multiplyScalar(outletDistance))
    .setY(layout.outletY);

  return {
    position,
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
  const bendAllowance = getCurveBendAllowance(params, envelope.length);
  const laneWidth = params.shape === "round"
    ? Math.max(1, params.trackWidth - params.wallThickness * 1.5)
    : Math.max(1, params.bowlWidth - params.wallThickness * 2);
  const outletHeight = Math.max(1, params.outletHeight - params.trackThickness);
  const widthClearance = Math.max(3, Math.min(8, params.trackWidth * 0.08));
  const requiredLaneWidth = envelope.width + widthClearance * 2 + bendAllowance;
  const canEnterTrack = requiredLaneWidth <= laneWidth;
  const requiredOutletHeight = getRequiredOutletPoseHeight(params, envelope);
  const canExit = requiredOutletHeight <= outletHeight;
  const outletEntryDistance = params.shape === "round"
    ? getRoundMotionLayout(params).spiralLength
    : pathLength * 0.78;
  const jamClearance = Math.max(12, envelope.length * 0.35);
  const minimumSpacing = envelope.length + jamClearance;
  const entryDistance = Math.max(0, minimumSpacing * 0.45);
  const maxDistance = canEnterTrack
    ? canExit
      ? pathLength
      : Math.max(entryDistance, outletEntryDistance - minimumSpacing * 0.35)
    : Math.max(0, entryDistance * 0.35);

  return {
    canEnterTrack,
    canExit,
    entryDistance,
    laneWidth,
    maxDistance,
    minimumSpacing,
    outletEntryDistance,
    outletHeight,
    pathLength,
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

  if (constraints.canEnterTrack && constraints.canExit) {
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
  const y = params.baseHeight + params.bottomThickness + 2;

  return {
    position: new THREE.Vector3(x, y, z),
    tangent: new THREE.Vector3(1, 0, 0),
    outletProgress: t > 0.78 ? (t - 0.78) / 0.22 : 0,
    progress: t,
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
  const startRadius = getTrackCenterRadius(params, 0);
  const endRadius = getTrackCenterRadius(params, 1);
  const averageRadius = (startRadius + endRadius) / 2;
  const arcLength = Math.abs(params.trackTurns * TWO_PI * averageRadius);
  const spiralLength = Math.max(1, Math.hypot(arcLength, totalRise));
  const pathLength = spiralLength + outletLength;
  const outletY = params.baseHeight + params.bottomThickness + params.trackThickness + totalRise + 2;

  return {
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
    + 2;

  return new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
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

function getEffectiveTotalRise(params: BowlParams) {
  return getEffectiveTrackTotalRise(params);
}

function getTrackThicknessAt(t: number, thickness: number) {
  return thickness * smoothstep(THREE.MathUtils.clamp(t / TRACK_LEAD_IN_RATIO, 0, 1));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
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

function wrapDistance(distanceMm: number, pathLength: number) {
  return ((distanceMm % pathLength) + pathLength) % pathLength;
}
