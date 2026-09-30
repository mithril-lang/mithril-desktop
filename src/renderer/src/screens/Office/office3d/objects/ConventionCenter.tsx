import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WORLD_W, WORLD_H } from "../core/constants";
import { OFFICE_DOOR_X } from "../core/cityPlan";

/**
 * The office block dressed as the Los Angeles Convention Center: a teal
 * parapet ring with the LACC sign over the entrance, a cantilevered steel
 * canopy, aluminium fins down the flanks, rooftop plant, flagpoles and the
 * palm-lined plaza. It only adds exterior skin around the existing walls and
 * glass roof, so interiors, collision and routing are untouched. City view
 * only — interiors never mount it.
 */

const WALL_H = 3.6;
const PARAPET_H = 1.0;
const PARAPET_T = 0.5;
const TEAL = "#0e7c86";
const NAVY = "#12304a";
const SILVER = "#cfd6dd";
const CORAL = "#f26b4f";
const GOLD = "#f5b942";

const HALF_W = WORLD_W / 2;
const HALF_H = WORLD_H / 2;

/** Teal parapet band that wraps the roofline. */
function Parapet(): React.JSX.Element {
  const y = WALL_H + PARAPET_H / 2;
  const w = WORLD_W + PARAPET_T;
  const d = WORLD_H + PARAPET_T;
  return (
    <group>
      {([-1, 1] as const).map((s) => (
        <group key={s}>
          <mesh position={[0, y, s * HALF_H]} castShadow>
            <boxGeometry args={[w, PARAPET_H, PARAPET_T]} />
            <meshStandardMaterial
              color={TEAL}
              roughness={0.5}
              metalness={0.2}
            />
          </mesh>
          <mesh position={[s * HALF_W, y, 0]} castShadow>
            <boxGeometry args={[PARAPET_T, PARAPET_H, d]} />
            <meshStandardMaterial
              color={TEAL}
              roughness={0.5}
              metalness={0.2}
            />
          </mesh>
        </group>
      ))}
      {/* Silver cap rail */}
      {([-1, 1] as const).map((s) => (
        <group key={`cap-${s}`}>
          <mesh position={[0, WALL_H + PARAPET_H + 0.04, s * HALF_H]}>
            <boxGeometry args={[w + 0.1, 0.08, PARAPET_T + 0.1]} />
            <meshStandardMaterial
              color={SILVER}
              roughness={0.3}
              metalness={0.6}
            />
          </mesh>
          <mesh position={[s * HALF_W, WALL_H + PARAPET_H + 0.04, 0]}>
            <boxGeometry args={[PARAPET_T + 0.1, 0.08, d + 0.1]} />
            <meshStandardMaterial
              color={SILVER}
              roughness={0.3}
              metalness={0.6}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** "LOS ANGELES CONVENTION CENTER" fascia sign, drawn to a canvas texture. */
function FasciaSign(): React.JSX.Element {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = NAVY;
      g.fillRect(0, 0, c.width, c.height);
      // Colour blocks echo the venue's checkerboard facade.
      const blocks = [TEAL, CORAL, GOLD, "#3aa6d8"];
      for (let i = 0; i < 12; i++) {
        g.fillStyle = blocks[i % blocks.length];
        g.fillRect(i * 44, 0, 44, 22);
        g.fillRect(c.width - (i + 1) * 44, c.height - 22, 44, 22);
      }
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "800 112px system-ui, 'Helvetica Neue', sans-serif";
      g.fillText(
        "LOS ANGELES CONVENTION CENTER",
        c.width / 2,
        c.height / 2 + 2,
      );
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  const w = 20;
  return (
    <mesh position={[0, WALL_H + PARAPET_H / 2, HALF_H + PARAPET_T / 2 + 0.02]}>
      <planeGeometry args={[w, w / 8]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Cantilevered steel canopy over the south entrance. */
function EntranceCanopy(): React.JSX.Element {
  const depth = 2.6;
  const width = 12;
  const wallFace = HALF_H + 0.1;
  const tilt = 0.09; // slopes down toward the street
  return (
    <group position={[OFFICE_DOOR_X, 0, wallFace]}>
      <mesh position={[0, 3.35, depth / 2]} rotation={[tilt, 0, 0]} castShadow>
        <boxGeometry args={[width, 0.14, depth]} />
        <meshStandardMaterial color={SILVER} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Coloured leading edge */}
      <mesh position={[0, 3.24, depth]}>
        <boxGeometry args={[width, 0.22, 0.12]} />
        <meshStandardMaterial color={CORAL} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (width / 2 - 0.4), 1.65, depth - 0.15]}>
          <cylinderGeometry args={[0.07, 0.07, 3.3, 10]} />
          <meshStandardMaterial
            color={SILVER}
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Vertical aluminium fins down the north, east and west flanks. */
const Fins = memo(function Fins(): React.JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);
  const placements = useMemo(() => {
    const out: Array<{ x: number; z: number; rotY: number; color: string }> =
      [];
    const palette = [TEAL, SILVER, NAVY, SILVER];
    const step = 1.8;
    let k = 0;
    for (let x = -HALF_W + 1; x <= HALF_W - 1; x += step) {
      out.push({ x, z: -HALF_H - 0.2, rotY: 0, color: palette[k++ % 4] });
    }
    for (let z = -HALF_H + 1; z <= HALF_H - 1; z += step) {
      out.push({
        x: -HALF_W - 0.2,
        z,
        rotY: Math.PI / 2,
        color: palette[k++ % 4],
      });
      out.push({
        x: HALF_W + 0.2,
        z,
        rotY: Math.PI / 2,
        color: palette[k++ % 4],
      });
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    placements.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY);
      m.compose(new THREE.Vector3(p.x, WALL_H / 2, p.z), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [placements]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, placements.length]}
      castShadow
      frustumCulled={false}
    >
      <boxGeometry args={[0.32, WALL_H, 0.22]} />
      <meshStandardMaterial roughness={0.35} metalness={0.5} />
    </instancedMesh>
  );
});

/** Rooftop plant: a few HVAC boxes sitting on the glass roof frame. */
function RoofPlant(): React.JSX.Element {
  const units: Array<[number, number, number, number]> = [
    [-11, -11, 3.2, 2],
    [-6.5, -11.5, 2.4, 1.8],
    [10.5, -10.5, 3.6, 2.2],
    [-12, 9, 2.6, 2.6],
  ];
  return (
    <group>
      {units.map(([x, z, w, d], i) => (
        <group key={i} position={[x, WALL_H + 0.62 + 0.45, z]}>
          <mesh castShadow>
            <boxGeometry args={[w, 0.9, d]} />
            <meshStandardMaterial
              color="#aeb7c0"
              roughness={0.6}
              metalness={0.3}
            />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.45, 0.45, 0.12, 14]} />
            <meshStandardMaterial
              color="#5c6670"
              roughness={0.5}
              metalness={0.5}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Flagpoles on the four roof corners, flags streaming east. */
function Flags(): React.JSX.Element {
  const colors = [CORAL, GOLD, "#3aa6d8", TEAL];
  const corners: Array<[number, number]> = [
    [-HALF_W, HALF_H],
    [HALF_W, HALF_H],
    [-HALF_W, -HALF_H],
    [HALF_W, -HALF_H],
  ];
  const base = WALL_H + PARAPET_H;
  return (
    <group>
      {corners.map(([x, z], i) => (
        <group key={i} position={[x, base, z]}>
          <mesh position={[0, 2, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 4, 8]} />
            <meshStandardMaterial
              color={SILVER}
              metalness={0.7}
              roughness={0.3}
            />
          </mesh>
          <mesh position={[0.55, 3.6, 0]}>
            <planeGeometry args={[1.1, 0.68]} />
            <meshStandardMaterial
              color={colors[i]}
              side={THREE.DoubleSide}
              roughness={0.7}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A simple palm: leaning trunk with a crown of drooping fronds. */
function Palm({
  x,
  z,
  h,
  lean,
}: {
  x: number;
  z: number;
  h: number;
  lean: number;
}): React.JSX.Element {
  const fronds = 7;
  return (
    <group position={[x, 0, z]} rotation={[0, 0, lean]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.17, h, 8]} />
        <meshStandardMaterial color="#7a5a3c" roughness={0.9} />
      </mesh>
      <group position={[0, h, 0]}>
        {Array.from({ length: fronds }).map((_, i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i / fronds) * Math.PI * 2) * 0.7,
              -0.1,
              Math.sin((i / fronds) * Math.PI * 2) * 0.7,
            ]}
            rotation={[0, -(i / fronds) * Math.PI * 2, -0.7]}
            scale={[1, 0.08, 0.32]}
          >
            <boxGeometry args={[1.8, 1, 1]} />
            <meshStandardMaterial color="#2f7d3a" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Plaza(): React.JSX.Element {
  // Palms flank the plaza but stay clear of the entrance and the sidewalk
  // lane pedestrians use (z ≈ 17.2).
  const palms: Array<[number, number, number, number]> = [
    [-15.6, HALF_H + 1.9, 5.2, 0.04],
    [-12.9, HALF_H + 1.9, 4.6, -0.05],
    [13.9, HALF_H + 1.9, 5.6, 0.03],
    [15.7, HALF_H + 1.9, 4.8, -0.04],
  ];
  return (
    <group>
      {/* Paved forecourt strip in front of the building */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.015, HALF_H + 1.5]}
        receiveShadow
      >
        <planeGeometry args={[WORLD_W + 2, 3]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.9} />
      </mesh>
      {palms.map(([x, z, h, lean]) => (
        <Palm key={x} x={x} z={z} h={h} lean={lean} />
      ))}
    </group>
  );
}

export const ConventionCenterExterior = memo(
  function ConventionCenterExterior(): React.JSX.Element {
    return (
      <group>
        <Parapet />
        <FasciaSign />
        <EntranceCanopy />
        <Fins />
        <RoofPlant />
        <Flags />
        <Plaza />
      </group>
    );
  },
);
