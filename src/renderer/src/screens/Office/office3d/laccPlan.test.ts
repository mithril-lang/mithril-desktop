import { describe, expect, it } from "vitest";
import {
  LACC_CURB_Z,
  LACC_DOOR_MAX_X,
  LACC_DOOR_MIN_X,
  LACC_HALF_H,
  LACC_PLAN,
  LACC_WALK_Z,
  LEAF_GEOMETRY,
  canopyEaveZ,
  hallAreas,
  leafRho,
} from "./laccPlan";

describe("LACC roof plan", () => {
  it("keeps the leaf roof larger than the west rectangle", () => {
    const { south, west } = hallAreas();
    expect(south).toBeGreaterThan(west);
  });

  it("joins West Hall to the leaf's north edge, as in the overhead photo", () => {
    const leafNorth = LACC_PLAN.leaf.cz - LACC_PLAN.leaf.b;
    expect(Math.abs(LACC_PLAN.west.maxZ - leafNorth)).toBeLessThan(1.2);
    expect(LACC_PLAN.west.maxX).toBeLessThan(LACC_PLAN.leaf.a);
  });

  it("keeps the leaf roof on the building, clear of the sidewalk", () => {
    const southTip = LACC_PLAN.leaf.cz + LACC_PLAN.leaf.b;
    const eastTip = LACC_PLAN.leaf.cx + LACC_PLAN.leaf.a;
    expect(southTip).toBeLessThan(LACC_HALF_H);
    expect(eastTip).toBeLessThan(LACC_HALF_H);
    expect(southTip).toBeLessThan(LACC_WALK_Z - 1);
  });

  it("seats the glass drum in the joint on the leaf's north shoulder", () => {
    const { x, z, r } = LACC_PLAN.drum;
    const { cz, b } = LACC_PLAN.leaf;
    expect(z).toBeLessThan(cz - b * 0.4);
    expect(leafRho(x, z)).toBeLessThan(1);
    expect(leafRho(x, z)).toBeGreaterThan(0.5);
    // The drum straddles onto the rectangle; its north edge leaves the leaf.
    expect(z - r).toBeLessThan(LACC_PLAN.west.maxZ);
    expect(x + r).toBeGreaterThan(LACC_PLAN.west.maxX);
  });

  it("lays the solid leaf slab flat in XZ", () => {
    LEAF_GEOMETRY.computeBoundingBox();
    const box = LEAF_GEOMETRY.boundingBox!;
    expect(box.min.y).toBeGreaterThan(-1e-3);
    expect(box.max.y).toBeCloseTo(LACC_PLAN.roofT, 2);
    expect(box.max.x).toBeCloseTo(LACC_PLAN.leaf.a, 1);
    expect(box.max.z).toBeCloseTo(LACC_PLAN.leaf.b, 1);
    expect(box.min.z).toBeCloseTo(-LACC_PLAN.leaf.b, 1);
  });

  it("cantilevers the canopy over the door without landing on the walk", () => {
    const { x, halfW, eaveY } = LACC_PLAN.canopy;
    expect(x).toBeGreaterThan(LACC_DOOR_MIN_X);
    expect(x).toBeLessThan(LACC_DOOR_MAX_X);
    expect(eaveY).toBeGreaterThan(2.2);
    expect(canopyEaveZ()).toBeLessThan(LACC_CURB_Z);
    expect(canopyEaveZ()).toBeGreaterThan(LACC_WALK_Z);
    // Palms flank the plaza; none stand on the door-to-sidewalk line.
    for (const palm of LACC_PLAN.palms) {
      const clearOfDoor =
        Math.hypot(palm.x - x, palm.z - LACC_WALK_Z) > halfW * 0.35;
      expect(clearOfDoor).toBe(true);
      expect(palm.z).toBeLessThan(LACC_CURB_Z);
    }
  });
});
