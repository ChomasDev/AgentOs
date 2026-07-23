import type { GoalConstraint } from "./constraints.js";

export interface ExpectedOutput {
  type: string;
  destination?: string;
}

export interface Goal {
  id: string;
  description: string;
  constraints: readonly GoalConstraint[];
  expectedOutputs: readonly ExpectedOutput[];
}
