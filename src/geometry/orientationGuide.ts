import type { BowlParams, PartTopFace } from "../types";

const TWO_PI = Math.PI * 2;

export interface OrientationGuideLayout {
  clearance: number;
  entryApproachLength: number;
  entryCaptureWidth: number;
  entryLaneWidth: number;
  entryPartHeight: number;
  entryPartLength: number;
  entryPartSpan: number;
  flipEnd: number;
  flipStart: number;
  guideActive: boolean;
  proofEnd: number;
  rejectEnd: number;
  rejectStart: number;
  highSideDirection: -1 | 1;
  rollAngleDirection: -1 | 1;
  singulationStart: number;
  targetLaneWidth: number;
}

export function getOrientationGuideLayout(params: BowlParams): OrientationGuideLayout {
  const clearance = getOrientationClearance(params);
  const baseLaneWidth = getBaseLaneWidth(params);
  const entryPartSpan = getEntryPartSpan(params);
  const entryPartHeight = getEntryPartHeight(params);
  const entryPartLength = getEntryPartLength(params);
  const entryBendAllowance = getBendAllowance(params, entryPartLength);
  const targetPartWidth = getTargetPartWidth(params);
  const targetPartLength = params.partFitLength && params.partFitLength > 0
    ? params.partFitLength
    : entryPartLength;
  const targetBendAllowance = getBendAllowance(params, targetPartLength);
  const entryLaneWidth = Math.min(
    baseLaneWidth,
    Math.max(entryPartSpan + clearance * 2 + entryBendAllowance, targetPartWidth + clearance * 2),
  );
  const targetLaneWidth = Math.min(
    baseLaneWidth,
    Math.max(1, targetPartWidth + clearance * 2 + targetBendAllowance),
  );
  const spiralLength = getApproximateSpiralLength(params);
  const entryApproachLength = clamp(
    Math.max(entryPartLength * 2.4, entryPartSpan * 2.2, baseLaneWidth * 1.7),
    70,
    Math.max(70, Math.min(220, params.bowlDiameter * 0.38)),
  );
  const entryCaptureWidth = Math.min(
    Math.max(baseLaneWidth, params.bowlDiameter * 0.28),
    Math.max(baseLaneWidth * 1.75, entryPartSpan * 1.5 + clearance * 2),
  );
  const flipRatio = clamp((entryPartSpan * 6) / spiralLength, 0.16, 0.28);
  const flipStart = 0.06;
  const flipEnd = Math.min(0.34, flipStart + flipRatio);
  const proofRatio = clamp((entryPartSpan * 1.4) / spiralLength, 0.06, 0.1);
  const singulationStart = 0;
  const rejectStart = 0.025;
  const rejectEnd = Math.min(0.14, Math.max(0.1, flipStart + 0.045));

  return {
    clearance,
    entryApproachLength,
    entryCaptureWidth,
    entryLaneWidth,
    entryPartHeight,
    entryPartLength,
    entryPartSpan,
    flipEnd,
    flipStart,
    guideActive: needsVerticalOrientationGuide(params),
    highSideDirection: getOrientationHighSideDirection(params),
    proofEnd: Math.min(0.46, flipEnd + proofRatio),
    rejectEnd,
    rejectStart,
    rollAngleDirection: getOrientationRollAngleDirection(params),
    singulationStart,
    targetLaneWidth,
  };
}

export function getOrientationGuideProgress(params: BowlParams, t: number) {
  const layout = getOrientationGuideLayout(params);
  if (!layout.guideActive) return 0;
  const local = clamp((t - layout.flipStart) / Math.max(0.001, layout.flipEnd - layout.flipStart), 0, 1);
  return smootherstep(local);
}

export function getOrientationLaneProgress(params: BowlParams, t: number) {
  const layout = getOrientationGuideLayout(params);
  if (!layout.guideActive) return 0;
  const local = clamp(
    (t - layout.singulationStart) / Math.max(0.001, layout.flipEnd - layout.singulationStart),
    0,
    1,
  );
  return smootherstep(local);
}

export function getOrientationRollAngle(params: BowlParams, t: number) {
  const layout = getOrientationGuideLayout(params);
  return layout.rollAngleDirection * Math.PI * 0.5 * getOrientationGuideProgress(params, t);
}

export function getOrientationPartCenterOffset(params: BowlParams, t: number) {
  const layout = getOrientationGuideLayout(params);
  if (!layout.guideActive) return 0;
  const progress = getOrientationGuideProgress(params, t);
  const angle = progress * Math.PI * 0.5;
  return layout.highSideDirection
    * layout.targetLaneWidth
    * 0.5
    * (progress - Math.sin(angle));
}

export function getOrientationTrackLaneWidth(params: BowlParams, t: number, baseLaneWidth = getBaseLaneWidth(params)) {
  const layout = getOrientationGuideLayout(params);
  if (!layout.guideActive) return baseLaneWidth;

  if (t < layout.singulationStart) return baseLaneWidth;
  if (t < layout.flipStart) {
    const local = smootherstep(clamp(
      (t - layout.singulationStart) / Math.max(0.001, layout.flipStart - layout.singulationStart),
      0,
      1,
    ));
    return lerp(baseLaneWidth, Math.min(baseLaneWidth, layout.entryLaneWidth), local);
  }

  const progress = getOrientationGuideProgress(params, t);
  const angle = progress * Math.PI * 0.5;
  const sweptWidth = layout.entryLaneWidth * Math.cos(angle)
    + layout.targetLaneWidth * Math.sin(angle);
  const profileWidth = Math.max(layout.targetLaneWidth, sweptWidth);
  return Math.min(baseLaneWidth, profileWidth);
}

export function needsVerticalOrientationGuide(params: BowlParams) {
  return isSideTopFace(params.partTopFace)
    || (params.partTopFace === "auto"
      && (params.outletOrientation === "sideUp" || params.outletOrientation === "standing"));
}

export function isSideTopFace(face: PartTopFace) {
  return face === "xPositive" || face === "xNegative" || face === "zPositive" || face === "zNegative";
}

export function getOrientationSideBias(face: PartTopFace): -1 | 1 {
  return face === "xNegative" || face === "zNegative" ? -1 : 1;
}

export function getOrientationRollAngleDirection(params: BowlParams): -1 | 1 {
  if (params.partTopFace === "xPositive" || params.partTopFace === "xNegative") {
    return getOrientationSideBias(params.partTopFace);
  }
  if (params.partTopFace === "zPositive" || params.partTopFace === "zNegative") {
    return (getOrientationSideBias(params.partTopFace) * -1) as -1 | 1;
  }

  return getOrientationForwardAxisFromParams(params) === "x" ? -1 : 1;
}

export function getOrientationHighSideDirection(params: BowlParams): -1 | 1 {
  const feedDirection = params.feedDirection === "clockwise" ? 1 : -1;
  return (getOrientationRollAngleDirection(params) * feedDirection * -1) as -1 | 1;
}

export function getOrientationForwardAxis(
  face: PartTopFace,
  horizontalX: number,
  horizontalZ: number,
): "x" | "z" {
  // A side face can only be raised by rolling around the other horizontal axis.
  // Keeping that axis parallel to travel makes the animated rotation and swept
  // guide surface describe the same physical motion from entry to exit.
  if (face === "xPositive" || face === "xNegative") return "z";
  if (face === "zPositive" || face === "zNegative") return "x";
  return horizontalX >= horizontalZ ? "x" : "z";
}

export function getOrientationForwardAxisFromParams(params: BowlParams): "x" | "z" {
  if (isSideTopFace(params.partTopFace)) {
    return getOrientationForwardAxis(params.partTopFace, 0, 0);
  }
  return params.partForwardAxis ?? "x";
}

export function getOrientationClearance(params: BowlParams) {
  if (params.partFitClearance && params.partFitClearance > 0) {
    return params.partFitClearance;
  }

  return clamp(params.trackWidth * 0.045, 1.2, 3);
}

export function getEntryPartSpan(params: BowlParams) {
  if (params.partEntryWidth && params.partEntryWidth > 0) return params.partEntryWidth;
  if (params.partFitHeight && params.partFitHeight > 0 && isSideTopFace(params.partTopFace)) {
    return params.partFitHeight;
  }
  return Math.max(8, params.trackWidth * 0.66);
}

export function getEntryPartHeight(params: BowlParams) {
  if (params.partEntryHeight && params.partEntryHeight > 0) return params.partEntryHeight;
  if (params.partFitWidth && params.partFitWidth > 0 && isSideTopFace(params.partTopFace)) {
    return params.partFitWidth;
  }
  return Math.max(2, Math.min(params.trackThickness, params.trackWidth * 0.18));
}

export function getEntryPartLength(params: BowlParams) {
  if (params.partEntryLength && params.partEntryLength > 0) return params.partEntryLength;
  if (params.partFitLength && params.partFitLength > 0) return params.partFitLength;
  return Math.max(12, params.trackWidth * 0.9);
}

function getTargetPartWidth(params: BowlParams) {
  if (isSideTopFace(params.partTopFace) && params.partFitWidth && params.partFitWidth > 0) {
    return params.partFitWidth;
  }
  if ((params.outletOrientation === "sideUp" || params.outletOrientation === "standing")
    && params.partEntryHeight && params.partEntryHeight > 0) {
    return params.partEntryHeight;
  }
  if (params.partFitWidth && params.partFitWidth > 0) return params.partFitWidth;
  return getEntryPartHeight(params);
}

function getBaseLaneWidth(params: BowlParams) {
  return params.shape === "round"
    ? Math.max(1, params.trackWidth - params.wallThickness * 1.5)
    : Math.max(1, params.bowlWidth - params.wallThickness * 2);
}

function getApproximateSpiralLength(params: BowlParams) {
  const centerRadius = params.shape === "round"
    ? Math.max(20, params.bowlDiameter / 2 - params.wallThickness - params.trackWidth / 2)
    : Math.max(20, Math.min(params.bowlLength, params.bowlWidth) / 2 - params.wallThickness - params.trackWidth / 2);
  const arcLength = Math.max(1, Math.abs(params.trackTurns) * TWO_PI * centerRadius);
  const rise = Math.max(0, params.trackRisePerTurn * params.trackTurns);
  return Math.max(1, Math.hypot(arcLength, rise));
}

function getBendAllowance(params: BowlParams, partLength: number) {
  if (params.shape !== "round" || partLength <= 0) return 0;
  const radius = Math.max(20, params.bowlDiameter / 2 - params.wallThickness - params.trackWidth / 2);
  return (partLength * partLength) / (4 * radius);
}

function smootherstep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
