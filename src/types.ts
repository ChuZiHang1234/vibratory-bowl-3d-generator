export type BowlShape = "round" | "rect";
export type BowlProfile = "cylindrical" | "conical";
export type FeedDirection = "clockwise" | "counterclockwise";
export type ExportFormat = "stl" | "obj" | "step";
export type OutletOrientation = "free" | "frontUp" | "backUp" | "sideUp" | "standing";
export type PartTopFace =
  | "auto"
  | "xPositive"
  | "xNegative"
  | "yPositive"
  | "yNegative"
  | "zPositive"
  | "zNegative";

export interface BowlParams {
  shape: BowlShape;
  bowlProfile: BowlProfile;
  conicalBottomRatio: number;
  bowlDiameter: number;
  bowlLength: number;
  bowlWidth: number;
  bowlHeight: number;
  wallThickness: number;
  bottomThickness: number;
  trackTurns: number;
  trackWidth: number;
  trackThickness: number;
  trackClimbAngleDeg: number;
  trackRisePerTurn: number;
  guardHeight: number;
  outletWidth: number;
  outletHeight: number;
  outletLength: number;
  outletOrientation: OutletOrientation;
  partTopFace: PartTopFace;
  feedDirection: FeedDirection;
  baseLength: number;
  baseWidth: number;
  baseHeight: number;
}

export interface PartFaceSelection {
  axis: PartTopFace;
  label: string;
  normal: [number, number, number];
}

export interface AnimationParams {
  enabled: boolean;
  voltage: number;
  frequency: number;
  amplitude: number;
  speed: number;
  partCount: number;
}

export interface PartAnalysis {
  fileName: string;
  format: "STL" | "OBJ" | "STEP";
  length: number;
  width: number;
  height: number;
  volume: number | null;
  center: [number, number, number];
  stableFace: string;
  recommendedFeedDirection: string;
}

export const defaultParams: BowlParams = {
  shape: "round",
  bowlProfile: "cylindrical",
  conicalBottomRatio: 72,
  bowlDiameter: 420,
  bowlLength: 460,
  bowlWidth: 460,
  bowlHeight: 260,
  wallThickness: 4,
  bottomThickness: 8,
  trackTurns: 2.5,
  trackWidth: 42,
  trackThickness: 6,
  trackClimbAngleDeg: 3.5,
  trackRisePerTurn: 70,
  guardHeight: 24,
  outletWidth: 48,
  outletHeight: 34,
  outletLength: 130,
  outletOrientation: "free",
  partTopFace: "auto",
  feedDirection: "clockwise",
  baseLength: 520,
  baseWidth: 520,
  baseHeight: 70,
};

export const defaultAnimationParams: AnimationParams = {
  enabled: false,
  voltage: 180,
  frequency: 50,
  amplitude: 3,
  speed: 1,
  partCount: 6,
};
