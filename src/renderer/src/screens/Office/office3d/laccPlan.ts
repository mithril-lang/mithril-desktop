/**
 * Scaled roof plan of the Los Angeles Convention Center, laid over the office
 * lot. The walkable floor stays the office rectangle; this is the city-view
 * massing only.
 *
 * Overhead photos (the LA Live aerial and the satellite roof plan) show one
 * joined complex, not two roofs with a street between them. South Hall is
 * the pointed leaf, its long axis east-west, with a radial seam grid. West
 * Hall is the flat rectangle joined to that leaf's northwest edge. The
 * green-glass drum stands in the joint, not on the south plaza. Kentia Hall
 * is below South Hall and does not show on the roof.
 *
 * +Z is south, toward the office door and the city camera. Lengths are world
 * units. The leaf's footprint stays larger than the rectangle.
 */
import * as THREE from "three";
import { WORLD_H, WORLD_W } from "./core/constants";
import {
  OFFICE_DOOR_W,
  OFFICE_DOOR_X,
  ROAD_SOUTH_Z,
  ROAD_WIDTH,
} from "./core/cityPlan";

export const LACC_HALF_W = WORLD_W / 2;
export const LACC_HALF_H = WORLD_H / 2;

/** Sidewalk agents and pedestrians use, just outside the south wall. */
export const LACC_WALK_Z = 17.2;

/** Inner edge of the south carriageway. Ground props stay north of this. */
export const LACC_CURB_Z = ROAD_SOUTH_Z - ROAD_WIDTH / 2;

export const LACC_PLAN = {
  /** Pointed leaf. `a` is east-west, `b` is north-south. Solid, like the roof photo. */
  leaf: { cx: 0, cz: 6.4, a: 14.6, b: 8.2, n: 1.38 },
  /** Rectangle joined to the leaf's northwest edge. */
  west: { minX: -15.2, maxX: 1.5, minZ: -15.4, maxZ: -1.5 },
  roofY: 4.02,
  roofT: 0.42,
  /** Green-glass drum in the joint, on the leaf's north shoulder. */
  drum: { x: 2.0, z: -0.6, r: 2.05, h: 10.4 },
  /**
   * Cantilevered canopy centred on the office door. No ground columns — the
   * sidewalk at {@link LACC_WALK_Z} passes underneath.
   */
  canopy: {
    x: OFFICE_DOOR_X,
    reach: 1.65,
    halfW: 5.6,
    peakY: 4.25,
    eaveY: 2.65,
    /** Wall-face z where the truss springs. */
    z0: LACC_HALF_H + 0.22,
  },
  palms: [
    { x: -14.8, z: 17.85, h: 5.1, lean: 0.04 },
    { x: -12.2, z: 17.9, h: 4.5, lean: -0.05 },
    { x: 13.4, z: 17.85, h: 5.4, lean: 0.03 },
    { x: 15.4, z: 17.75, h: 4.7, lean: -0.04 },
  ],
} as const;

export function superellipsePoints(
  a: number,
  b: number,
  n: number,
  segments: number,
  clockwise: boolean,
): THREE.Vector2[] {
  const exp = 2 / n;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (clockwise ? -1 : 1) * ((i / segments) * Math.PI * 2);
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push(
      new THREE.Vector2(
        Math.sign(c) * Math.abs(c) ** exp * a,
        Math.sign(s) * Math.abs(s) ** exp * b,
      ),
    );
  }
  return pts;
}

/** `|x/a|^n + |z/b|^n` for a point in world space. 1 is the leaf edge. */
export function leafRho(x: number, z: number): number {
  const { cx, cz, a, b, n } = LACC_PLAN.leaf;
  return Math.abs((x - cx) / a) ** n + Math.abs((z - cz) / b) ** n;
}

export function polygonArea(pts: Array<{ x: number; z: number }>): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(sum) / 2;
}

export function hallAreas(): { south: number; west: number; ratio: number } {
  const { a, b, n } = LACC_PLAN.leaf;
  const south = polygonArea(
    superellipsePoints(a, b, n, 240, false).map((p) => ({ x: p.x, z: p.y })),
  );
  const { minX, maxX, minZ, maxZ } = LACC_PLAN.west;
  const west = (maxX - minX) * (maxZ - minZ);
  return { south, west, ratio: south / west };
}

/**
 * South Hall roof slab in local space: a solid leaf in XZ, thickness up +Y.
 * The component drops it at `(leaf.cx, roofY, leaf.cz)`.
 */
export function buildLeafGeometry(): THREE.ExtrudeGeometry {
  const { a, b, n } = LACC_PLAN.leaf;
  const shape = new THREE.Shape(superellipsePoints(a, b, n, 80, false));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: LACC_PLAN.roofT,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // Extrude grows along +Z. rotateX(+90°) lays that thickness downward;
  // the translate brings the slab back to y ∈ [0, roofT] with the leaf’s
  // +Y (shape) becoming world +Z (south) once the mesh is placed.
  g.rotateX(Math.PI / 2);
  g.translate(0, LACC_PLAN.roofT, 0);
  g.computeVertexNormals();
  return g;
}

export const LEAF_GEOMETRY = buildLeafGeometry();

/** South edge of the canopy eave, in world z. */
export function canopyEaveZ(): number {
  return LACC_PLAN.canopy.z0 + LACC_PLAN.canopy.reach;
}

/** Door opening the canopy must stay centred on. */
export const LACC_DOOR_MIN_X = OFFICE_DOOR_X - OFFICE_DOOR_W / 2;
export const LACC_DOOR_MAX_X = OFFICE_DOOR_X + OFFICE_DOOR_W / 2;
