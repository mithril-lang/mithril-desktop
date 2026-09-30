import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  LACC_DOOR_MAX_X,
  LACC_DOOR_MIN_X,
  LACC_HALF_H,
  LACC_HALF_W,
  LACC_PLAN,
  LEAF_GEOMETRY,
  canopyEaveZ,
} from "../laccPlan";

/**
 * City-view massing of the Los Angeles Convention Center over the office
 * block. South Hall is the leaf-shaped roof, West Hall the rectangle to its
 * north, and the concourse bridges the slot between them. The south door
 * wears the green-glass drum and the white space-frame canopy. Walls, glass
 * roof, collision and routing stay the office's — the skin unmounts indoors.
 */

const PANEL = "#f4f1ea";
const JOINT = "#d5cfc3";
const CONCRETE = "#c9c2b4";
const GREEN = "#178a68";
const GREEN_GLASS = "#8ed4c0";
const DRUM = "#9ed4de";
const TRUSS = "#f5f7f8";
const WEST_ROOF = "#cbbfae";
const SOUTH_ROOF = "#ddd6ca";
const LETTER = "#2c3238";

const ROOF_TOP = LACC_PLAN.roofY + LACC_PLAN.roofT;

function useLabelTexture(text: string, tracking = 0): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = LETTER;
      g.font = "700 150px system-ui, 'Helvetica Neue', sans-serif";
      g.textBaseline = "middle";
      const glyphs = [...text];
      const widths = glyphs.map((ch) => g.measureText(ch).width);
      const total =
        widths.reduce((s, w) => s + w, 0) + tracking * (glyphs.length - 1);
      let x = (c.width - total) / 2;
      glyphs.forEach((ch, i) => {
        g.fillText(ch, x, c.height / 2 + 8);
        x += widths[i] + tracking;
      });
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [text, tracking]);
}

function useDrumTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 1024;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = DRUM;
      g.fillRect(0, 0, c.width, c.height);
      // A darker reflection band, the way the drum reads in daylight.
      const shade = g.createLinearGradient(0, 0, c.width, 0);
      shade.addColorStop(0, "rgba(255,255,255,0.18)");
      shade.addColorStop(0.45, "rgba(255,255,255,0)");
      shade.addColorStop(0.62, "rgba(20,60,80,0.28)");
      shade.addColorStop(1, "rgba(255,255,255,0.08)");
      g.fillStyle = shade;
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = "rgba(255,255,255,0.88)";
      g.lineWidth = 3;
      const cols = 22;
      const rows = 32;
      for (let i = 0; i <= cols; i++) {
        const x = (i / cols) * c.width;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, c.height);
        g.stroke();
      }
      for (let j = 0; j <= rows; j++) {
        const y = (j / rows) * c.height;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(c.width, y);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
}

/** White panel field, concrete podium, green clerestory. Split around the door. */
function Facade(): React.JSX.Element {
  const wallT = 0.16;
  const southZ = LACC_HALF_H + 0.2;
  const podiumH = 0.82;
  const panelTop = 3.18;
  const panelH = panelTop - podiumH;
  const panelY = podiumH + panelH / 2;
  const leftW = LACC_DOOR_MIN_X + LACC_HALF_W;
  const rightW = LACC_HALF_W - LACC_DOOR_MAX_X;
  const leftX = -LACC_HALF_W + leftW / 2;
  const rightX = LACC_DOOR_MAX_X + rightW / 2;

  return (
    <group>
      {/* South — white hall to the west of the door, green glass wing to the east. */}
      <mesh position={[leftX, podiumH / 2, southZ]}>
        <boxGeometry args={[leftW, podiumH, wallT]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.9} />
      </mesh>
      <mesh position={[leftX, panelY, southZ]}>
        <boxGeometry args={[leftW, panelH, wallT]} />
        <meshStandardMaterial color={PANEL} roughness={0.72} metalness={0.04} />
      </mesh>
      <mesh position={[rightX, podiumH / 2, southZ]}>
        <boxGeometry args={[rightW, podiumH, wallT]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.9} />
      </mesh>
      <mesh position={[rightX, panelY, southZ]}>
        <boxGeometry args={[rightW, panelH, wallT]} />
        <meshStandardMaterial
          color={GREEN_GLASS}
          roughness={0.18}
          metalness={0.35}
          transparent
          opacity={0.72}
        />
      </mesh>
      {/* Header over the open doorway. */}
      <mesh position={[LACC_PLAN.canopy.x, (2.2 + panelTop) / 2, southZ]}>
        <boxGeometry
          args={[LACC_DOOR_MAX_X - LACC_DOOR_MIN_X, panelTop - 2.2, wallT]}
        />
        <meshStandardMaterial color={PANEL} roughness={0.72} metalness={0.04} />
      </mesh>
      {/* East end is the green glass return; west end wears the solid green panel. */}
      {([-1, 1] as const).map((s) => (
        <group key={s}>
          <mesh position={[s * (LACC_HALF_W + 0.2), podiumH / 2, 0]}>
            <boxGeometry args={[wallT, podiumH, LACC_HALF_H * 2 + 0.56]} />
            <meshStandardMaterial color={CONCRETE} roughness={0.9} />
          </mesh>
          <mesh position={[s * (LACC_HALF_W + 0.2), panelY, 0]}>
            <boxGeometry args={[wallT, panelH, LACC_HALF_H * 2 + 0.56]} />
            {s < 0 ? (
              <meshStandardMaterial color={GREEN} roughness={0.55} />
            ) : (
              <meshStandardMaterial
                color={GREEN_GLASS}
                roughness={0.16}
                metalness={0.4}
                transparent
                opacity={0.78}
              />
            )}
          </mesh>
        </group>
      ))}
      <mesh position={[0, podiumH / 2, -(LACC_HALF_H + 0.2)]}>
        <boxGeometry args={[LACC_HALF_W * 2 + 0.72, podiumH, wallT]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.9} />
      </mesh>
      <mesh position={[0, panelY, -(LACC_HALF_H + 0.2)]}>
        <boxGeometry args={[LACC_HALF_W * 2 + 0.72, panelH, wallT]} />
        <meshStandardMaterial color={PANEL} roughness={0.72} metalness={0.04} />
      </mesh>
    </group>
  );
}

/** Square-panel joints on the south hall face, held off the doorway. */
const PanelJoints = memo(function PanelJoints(): React.JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);
  const placements = useMemo(() => {
    const out: Array<[number, number, number, number, number, number]> = [];
    const z = LACC_HALF_H + 0.3;
    const step = 1.65;
    for (let x = -LACC_HALF_W + 0.8; x < LACC_DOOR_MIN_X - 0.2; x += step) {
      out.push([x, 2.0, z, 0.06, 2.3, 0.06]);
    }
    for (let x = LACC_DOOR_MAX_X + 0.4; x < LACC_HALF_W; x += 1.35) {
      out.push([x, 2.0, z, 0.05, 2.3, 0.05]);
    }
    for (const y of [0.82, 2.15, 3.12]) {
      out.push([
        (-LACC_HALF_W + LACC_DOOR_MIN_X) / 2,
        y,
        z,
        LACC_DOOR_MIN_X + LACC_HALF_W,
        0.05,
        0.05,
      ]);
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    placements.forEach(([x, y, z, sx, sy, sz], i) => {
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [placements]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, placements.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={JOINT} roughness={0.6} />
    </instancedMesh>
  );
});

function HallSign(): React.JSX.Element {
  const texture = useLabelTexture("LOS ANGELES CONVENTION CENTER", 28);
  const leftW = LACC_DOOR_MIN_X + LACC_HALF_W;
  return (
    <mesh position={[-LACC_HALF_W + leftW / 2, 2.45, LACC_HALF_H + 0.36]}>
      <planeGeometry args={[Math.min(leftW - 1.2, 18), 0.95]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.2}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Green barrel vault along the south clerestory — Freed's roof edge. */
const VAULT_GEOMETRY = (() => {
  const radius = 0.55;
  const length = LACC_HALF_W * 2 - 1.6;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI, false);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
    curveSegments: 10,
  });
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
})();

function SouthVault(): React.JSX.Element {
  return (
    <mesh
      geometry={VAULT_GEOMETRY}
      dispose={null}
      position={[0, 3.18, LACC_HALF_H + 0.05]}
    >
      <meshStandardMaterial
        color={GREEN_GLASS}
        roughness={0.15}
        metalness={0.25}
        transparent
        opacity={0.8}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Beam({
  a,
  b,
  thickness = 0.07,
}: {
  a: [number, number, number];
  b: [number, number, number];
  thickness?: number;
}): React.JSX.Element {
  const { mid, quat, len } = useMemo(() => {
    const av = new THREE.Vector3(...a);
    const bv = new THREE.Vector3(...b);
    const dir = bv.clone().sub(av);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    return { mid: av.add(bv).multiplyScalar(0.5), quat, len };
  }, [a, b]);
  return (
    <mesh position={mid} quaternion={quat}>
      <boxGeometry args={[thickness, len, thickness]} />
      <meshStandardMaterial color={TRUSS} roughness={0.35} metalness={0.55} />
    </mesh>
  );
}

/** White triangular space frame over the south entrance. Cantilevered. */
function EntranceCanopy(): React.JSX.Element {
  const { halfW, peakY, eaveY, reach } = LACC_PLAN.canopy;
  const members = useMemo(() => {
    const pairs: Array<[[number, number, number], [number, number, number]]> =
      [];
    const ridgeA: [number, number, number] = [0, peakY, 0.05];
    const ridgeB: [number, number, number] = [0, peakY - 0.55, reach];
    pairs.push([ridgeA, ridgeB]);
    const corners: Array<[number, number, number]> = [
      [-halfW, eaveY + 0.35, 0.05],
      [halfW, eaveY + 0.35, 0.05],
      [-halfW, eaveY, reach],
      [halfW, eaveY, reach],
    ];
    pairs.push([corners[0], ridgeA], [corners[1], ridgeA]);
    pairs.push([corners[2], ridgeB], [corners[3], ridgeB]);
    pairs.push([corners[0], corners[2]], [corners[1], corners[3]]);
    pairs.push([corners[2], corners[3]]);
    for (const t of [0.33, 0.66]) {
      const x = -halfW + 2 * halfW * t;
      pairs.push([
        [x * 0.15, peakY - 0.15, 0.08],
        [x, eaveY, reach],
      ]);
    }
    return pairs;
  }, [eaveY, halfW, peakY, reach]);

  return (
    <group position={[LACC_PLAN.canopy.x, 0, LACC_PLAN.canopy.z0]}>
      {members.map(([a, b], i) => (
        <Beam key={i} a={a} b={b} />
      ))}
      {/* Glass infill under the two slopes. */}
      {([-1, 1] as const).map((s) => (
        <mesh
          key={s}
          position={[
            s * halfW * 0.48,
            (peakY + eaveY) / 2 - 0.15,
            reach * 0.48,
          ]}
          rotation={[0.42, 0, s * -0.22]}
        >
          <planeGeometry args={[halfW * 0.92, reach * 1.15]} />
          <meshStandardMaterial
            color="#e7f4f1"
            roughness={0.08}
            metalness={0.2}
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function GlassDrum(): React.JSX.Element {
  const map = useDrumTexture();
  const { x, z, r, h } = LACC_PLAN.drum;
  const y = ROOF_TOP + h / 2;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, y, 0]} castShadow>
        <cylinderGeometry args={[r, r, h, 48]} />
        <meshStandardMaterial
          map={map}
          color="#ffffff"
          roughness={0.12}
          metalness={0.48}
          envMapIntensity={1.15}
        />
      </mesh>
      <mesh position={[0, ROOF_TOP + h + 0.08, 0]}>
        <cylinderGeometry args={[r + 0.08, r + 0.08, 0.16, 48]} />
        <meshStandardMaterial color={PANEL} roughness={0.45} metalness={0.2} />
      </mesh>
      <mesh position={[0, ROOF_TOP + 0.08, 0]}>
        <cylinderGeometry args={[r + 0.18, r + 0.22, 0.2, 40]} />
        <meshStandardMaterial color={TRUSS} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

function RoofLabel({
  text,
  x,
  z,
  width,
  y = ROOF_TOP + 0.06,
}: {
  text: string;
  x: number;
  z: number;
  width: number;
  y?: number;
}): React.JSX.Element {
  const texture = useLabelTexture(text, 18);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, y, z]}>
      <planeGeometry args={[width, width / 8]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.2}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Radial and concentric seams, the pattern on the leaf roof in overhead photos. */
function useLeafSeamTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const { a, b, n } = LACC_PLAN.leaf;
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    if (g) {
      g.clearRect(0, 0, size, size);
      const px = (x: number, z: number): [number, number] => [
        (x / a) * 0.5 * size + size / 2,
        (z / b) * 0.5 * size + size / 2,
      ];
      const exp = 2 / n;
      g.strokeStyle = "rgba(92, 90, 84, 0.85)";
      g.lineWidth = 2;
      const spokes = 28;
      for (let i = 0; i < spokes; i++) {
        const t = (i / spokes) * Math.PI * 2;
        const ct = Math.cos(t);
        const st = Math.sin(t);
        const [x1, y1] = px(
          Math.sign(ct) * Math.abs(ct) ** exp * a,
          Math.sign(st) * Math.abs(st) ** exp * b,
        );
        const [x0, y0] = px(0, 0);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      for (const scale of [0.28, 0.5, 0.72, 0.9]) {
        g.beginPath();
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          const ct = Math.cos(t);
          const st = Math.sin(t);
          const [x, y] = px(
            Math.sign(ct) * Math.abs(ct) ** exp * a * scale,
            Math.sign(st) * Math.abs(st) ** exp * b * scale,
          );
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
}

function useWestSeamTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const g = c.getContext("2d");
    if (g) {
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = "rgba(110, 104, 96, 0.8)";
      g.lineWidth = 2;
      for (let i = 1; i < 8; i++) {
        const y = (i / 8) * c.height;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(c.width, y);
        g.stroke();
      }
      for (let i = 1; i < 10; i++) {
        const x = (i / 10) * c.width;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, c.height);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
}

function SouthHallRoof(): React.JSX.Element {
  const { cx, cz, a, b } = LACC_PLAN.leaf;
  const seams = useLeafSeamTexture();
  return (
    <group position={[cx, LACC_PLAN.roofY, cz]}>
      <mesh geometry={LEAF_GEOMETRY} dispose={null} castShadow>
        <meshStandardMaterial
          color={SOUTH_ROOF}
          roughness={0.84}
          metalness={0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, LACC_PLAN.roofT + 0.02, 0]}
      >
        <planeGeometry args={[a * 2, b * 2]} />
        <meshBasicMaterial
          map={seams}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
    </group>
  );
}

/** Solid flat rectangle joined to the northwest of the leaf. */
function WestHallRoof(): React.JSX.Element {
  const { minX, maxX, minZ, maxZ } = LACC_PLAN.west;
  const seams = useWestSeamTexture();
  const h = LACC_PLAN.roofT;
  const y = LACC_PLAN.roofY + h / 2;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return (
    <group>
      <mesh position={[cx, y, cz]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={WEST_ROOF} roughness={0.88} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, LACC_PLAN.roofY + h + 0.02, cz]}
      >
        <planeGeometry args={[w - 0.2, d - 0.2]} />
        <meshBasicMaterial
          map={seams}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
    </group>
  );
}

function RoofPlant(): React.JSX.Element {
  // Small roof equipment on the solid leaf, clear of the drum at the joint.
  const units: Array<[number, number, number, number]> = [
    [-8.2, 9.6, 2.2, 1.4],
    [-2.4, 12.8, 1.8, 1.2],
    [7.6, 8.4, 2.0, 1.4],
    [10.2, 5.2, 1.6, 1.5],
  ];
  return (
    <group>
      {units.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, ROOF_TOP + 0.38, z]} castShadow>
          <boxGeometry args={[w, 0.76, d]} />
          <meshStandardMaterial
            color="#b7c0c6"
            roughness={0.55}
            metalness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

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
        <cylinderGeometry args={[0.1, 0.16, h, 8]} />
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
  const depth = canopyEaveZ() - LACC_HALF_H;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, LACC_HALF_H + depth / 2]}
        receiveShadow
      >
        <planeGeometry args={[LACC_HALF_W * 2 + 1.2, depth]} />
        <meshStandardMaterial color="#e4ddd0" roughness={0.92} />
      </mesh>
      {LACC_PLAN.palms.map((p) => (
        <Palm key={p.x} {...p} />
      ))}
    </group>
  );
}

export const ConventionCenterExterior = memo(
  function ConventionCenterExterior(): React.JSX.Element {
    return (
      <group>
        <Facade />
        <PanelJoints />
        <HallSign />
        <SouthVault />
        <EntranceCanopy />
        <SouthHallRoof />
        <WestHallRoof />
        <GlassDrum />
        <RoofPlant />
        <RoofLabel text="SOUTH HALL" x={-4.5} z={11.2} width={7.2} />
        <RoofLabel text="WEST HALL" x={-6.8} z={-8.4} width={6.4} />
        <Plaza />
      </group>
    );
  },
);
