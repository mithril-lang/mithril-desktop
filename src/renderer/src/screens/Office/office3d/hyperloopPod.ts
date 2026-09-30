import { HYPERLOOP_HALF_LEN, HYPERLOOP_STATION_X } from "./core/cityPlan";

/**
 * The pod's timetable: dwell at the station, accelerate east and vanish into
 * the fog, then a fresh pod arrives from the west and brakes into the station.
 * Pure (time in, pose out) so the schedule is testable without a renderer.
 */
export const POD_DWELL_S = 6;
export const POD_DEPART_S = 14;
export const POD_GAP_S = 3;
export const POD_ARRIVE_S = 14;
export const POD_CYCLE_S =
  POD_DWELL_S + POD_DEPART_S + POD_GAP_S + POD_ARRIVE_S;

export type PodPhase = "dwell" | "departing" | "gap" | "arriving";

export interface PodPose {
  phase: PodPhase;
  /** World x along the tube; null while no pod is in view. */
  x: number | null;
}

const easeIn = (t: number): number => t * t * t;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function podPose(seconds: number): PodPose {
  const t = ((seconds % POD_CYCLE_S) + POD_CYCLE_S) % POD_CYCLE_S;
  if (t < POD_DWELL_S) return { phase: "dwell", x: HYPERLOOP_STATION_X };
  const dep = t - POD_DWELL_S;
  if (dep < POD_DEPART_S) {
    const k = easeIn(dep / POD_DEPART_S);
    return {
      phase: "departing",
      x: HYPERLOOP_STATION_X + k * (HYPERLOOP_HALF_LEN - HYPERLOOP_STATION_X),
    };
  }
  const gap = dep - POD_DEPART_S;
  if (gap < POD_GAP_S) return { phase: "gap", x: null };
  const arr = (gap - POD_GAP_S) / POD_ARRIVE_S;
  const k = 1 - easeOut(arr);
  return {
    phase: "arriving",
    x: HYPERLOOP_STATION_X - k * (HYPERLOOP_HALF_LEN + HYPERLOOP_STATION_X),
  };
}
