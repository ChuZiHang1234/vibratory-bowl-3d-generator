export type BowlShape = "round" | "rect";
export type BowlProfile = "cylindrical" | "conical";
export type FeedDirection = "clockwise" | "counterclockwise";

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
  trackRisePerTurn: number;
  guardHeight: number;
  outletWidth: number;
  outletHeight: number;
  outletLength: number;
  feedDirection: FeedDirection;
  baseLength: number;
  baseWidth: number;
  baseHeight: number;
}

export interface PartAnalysis {
  fileName: string;
  format: "STL" | "OBJ";
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
  bowlHeight: 150,
  wallThickness: 4,
  bottomThickness: 8,
  trackTurns: 2.5,
  trackWidth: 42,
  trackThickness: 6,
  trackRisePerTurn: 26,
  guardHeight: 24,
  outletWidth: 48,
  outletHeight: 34,
  outletLength: 130,
  feedDirection: "clockwise",
  baseLength: 520,
  baseWidth: 520,
  baseHeight: 70,
};
