import type { BowlParams } from "../types";

const TWO_PI = Math.PI * 2;

export function getTrackRisePerTurn(params: BowlParams) {
  if (params.shape !== "round") {
    return Math.max(4, params.trackRisePerTurn);
  }

  const angleRad = degreesToRadians(getTrackClimbAngleDeg(params));
  return Math.tan(angleRad) * TWO_PI * getNominalTrackCenterRadius(params);
}

export function getRequestedTrackTotalRise(params: BowlParams) {
  return getTrackRisePerTurn(params) * params.trackTurns;
}

export function getEffectiveTrackTotalRise(params: BowlParams) {
  const requested = getRequestedTrackTotalRise(params);
  return Math.min(requested, getMaxTrackTotalRise(params));
}

export function getEffectiveTrackClimbAngleDeg(params: BowlParams) {
  if (params.shape !== "round" || params.trackTurns <= 0) {
    return getTrackClimbAngleDeg(params);
  }

  const risePerTurn = getEffectiveTrackTotalRise(params) / params.trackTurns;
  const runPerTurn = TWO_PI * getNominalTrackCenterRadius(params);
  return radiansToDegrees(Math.atan2(risePerTurn, Math.max(1, runPerTurn)));
}

export function getRequiredBowlHeightForTrackClimb(params: BowlParams, margin = 28) {
  return params.bottomThickness
    + params.trackThickness
    + params.guardHeight
    + getRequestedTrackTotalRise(params)
    + margin;
}

export function getTrackClimbAngleDeg(params: BowlParams) {
  return clamp(params.trackClimbAngleDeg || 3.5, 0.5, 12);
}

function getNominalTrackCenterRadius(params: BowlParams) {
  const topRadius = params.bowlDiameter / 2;
  const profileScale = params.bowlProfile === "conical"
    ? clamp((params.conicalBottomRatio / 100 + 1) / 2, 0.55, 1)
    : 1;
  const profileRadius = topRadius * profileScale;
  return Math.max(20, profileRadius - params.wallThickness - params.trackWidth / 2);
}

function getMaxTrackTotalRise(params: BowlParams) {
  return Math.max(
    8,
    params.bowlHeight - params.bottomThickness - params.trackThickness - params.guardHeight - 4,
  );
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180;
}

function radiansToDegrees(value: number) {
  return value * 180 / Math.PI;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
