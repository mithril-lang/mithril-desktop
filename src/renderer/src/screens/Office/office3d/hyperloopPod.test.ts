import { describe, expect, it } from "vitest";
import { HYPERLOOP_HALF_LEN, HYPERLOOP_STATION_X } from "./core/cityPlan";
import {
  POD_ARRIVE_S,
  POD_CYCLE_S,
  POD_DEPART_S,
  POD_DWELL_S,
  POD_GAP_S,
  podPose,
} from "./hyperloopPod";

describe("hyperloop pod schedule", () => {
  it("dwells at the station at the start of every cycle", () => {
    expect(podPose(0)).toEqual({ phase: "dwell", x: HYPERLOOP_STATION_X });
    expect(podPose(POD_CYCLE_S + 1).phase).toBe("dwell");
  });

  it("departs east, ending at the tube's far end", () => {
    const start = podPose(POD_DWELL_S + 0.01).x!;
    const end = podPose(POD_DWELL_S + POD_DEPART_S - 0.01).x!;
    expect(start).toBeCloseTo(HYPERLOOP_STATION_X, 1);
    expect(end).toBeGreaterThan(HYPERLOOP_HALF_LEN * 0.99);
  });

  it("has no pod in view during the gap", () => {
    expect(podPose(POD_DWELL_S + POD_DEPART_S + POD_GAP_S / 2)).toEqual({
      phase: "gap",
      x: null,
    });
  });

  it("arrives from the west and brakes into the station", () => {
    const base = POD_DWELL_S + POD_DEPART_S + POD_GAP_S;
    expect(podPose(base + 0.01).x!).toBeLessThan(-HYPERLOOP_HALF_LEN * 0.99);
    expect(podPose(base + POD_ARRIVE_S - 0.01).x!).toBeCloseTo(
      HYPERLOOP_STATION_X,
      1,
    );
  });

  it("never leaves the tube", () => {
    for (let t = 0; t < POD_CYCLE_S; t += 0.25) {
      const { x } = podPose(t);
      if (x !== null)
        expect(Math.abs(x)).toBeLessThanOrEqual(HYPERLOOP_HALF_LEN + 1e-6);
    }
  });
});
