import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  HYPERLOOP_HALF_LEN,
  HYPERLOOP_PYLON_GAP,
  HYPERLOOP_PYLON_HALF_SPAN,
  HYPERLOOP_R,
  HYPERLOOP_STATION_D,
  HYPERLOOP_STATION_H,
  HYPERLOOP_STATION_W,
  HYPERLOOP_STATION_X,
  HYPERLOOP_STATION_Z,
  HYPERLOOP_Y,
  HYPERLOOP_Z,
} from "../core/cityPlan";
import { podPose } from "../hyperloopPod";

const WHITE = "#eef2f6";
const STEEL = "#8b95a1";
const CYAN = "#22d3ee";
const CAP_R = HYPERLOOP_R + 0.65;
const CAP_LEN = HYPERLOOP_STATION_W - 2;

const PYLON_XS: number[] = (() => {
  const xs: number[] = [];
  const n = Math.floor(HYPERLOOP_HALF_LEN / HYPERLOOP_PYLON_GAP);
  for (let i = -n; i <= n; i++) xs.push(i * HYPERLOOP_PYLON_GAP);
  // Skip the station cap span: it carries its own supports.
  return xs.filter((x) => Math.abs(x - HYPERLOOP_STATION_X) > CAP_LEN / 2 + 1);
})();

const RING_XS: number[] = (() => {
  const xs: number[] = [];
  for (let x = -HYPERLOOP_HALF_LEN; x <= HYPERLOOP_HALF_LEN; x += 6) {
    if (Math.abs(x - HYPERLOOP_STATION_X) > CAP_LEN / 2) xs.push(x);
  }
  return xs;
})();

/** Tube, support portals and the glowing running strip. */
const Track = memo(function Track(): React.JSX.Element {
  const rings = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    if (rings.current) {
      RING_XS.forEach((x, i) => {
        m.makeTranslation(x, HYPERLOOP_Y, HYPERLOOP_Z);
        rings.current!.setMatrixAt(i, m);
      });
      rings.current.instanceMatrix.needsUpdate = true;
    }
    const legH = HYPERLOOP_Y - HYPERLOOP_R;
    if (legs.current) {
      let i = 0;
      for (const x of PYLON_XS) {
        for (const s of [-1, 1]) {
          m.makeTranslation(
            x,
            legH / 2,
            HYPERLOOP_Z + s * HYPERLOOP_PYLON_HALF_SPAN,
          );
          legs.current.setMatrixAt(i++, m);
        }
      }
      legs.current.instanceMatrix.needsUpdate = true;
    }
    if (beams.current) {
      PYLON_XS.forEach((x, i) => {
        m.makeTranslation(x, HYPERLOOP_Y - HYPERLOOP_R - 0.15, HYPERLOOP_Z);
        beams.current!.setMatrixAt(i, m);
      });
      beams.current.instanceMatrix.needsUpdate = true;
    }
  }, []);

  const legH = HYPERLOOP_Y - HYPERLOOP_R;
  return (
    <group>
      {/* Tube: translucent so the pod is visible inside it. */}
      <mesh
        position={[0, HYPERLOOP_Y, HYPERLOOP_Z]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[HYPERLOOP_R, HYPERLOOP_R, HYPERLOOP_HALF_LEN * 2, 20, 1, true]}
        />
        <meshStandardMaterial
          color="#dbe7f0"
          roughness={0.15}
          metalness={0.5}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Running strip along the crown */}
      <mesh position={[0, HYPERLOOP_Y + HYPERLOOP_R + 0.02, HYPERLOOP_Z]}>
        <boxGeometry args={[HYPERLOOP_HALF_LEN * 2, 0.06, 0.28]} />
        <meshStandardMaterial
          color={CYAN}
          emissive={CYAN}
          emissiveIntensity={0.9}
        />
      </mesh>
      <instancedMesh
        ref={rings}
        args={[undefined, undefined, RING_XS.length]}
        frustumCulled={false}
      >
        <torusGeometry args={[HYPERLOOP_R + 0.03, 0.06, 6, 20]} />
        <meshStandardMaterial color={WHITE} roughness={0.4} metalness={0.4} />
      </instancedMesh>
      <instancedMesh
        ref={legs}
        args={[undefined, undefined, PYLON_XS.length * 2]}
        castShadow
        frustumCulled={false}
      >
        <boxGeometry args={[0.55, legH, 0.55]} />
        <meshStandardMaterial color={WHITE} roughness={0.55} metalness={0.15} />
      </instancedMesh>
      <instancedMesh
        ref={beams}
        args={[undefined, undefined, PYLON_XS.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.9, 0.3, HYPERLOOP_PYLON_HALF_SPAN * 2 + 0.55]} />
        <meshStandardMaterial color={STEEL} roughness={0.45} metalness={0.4} />
      </instancedMesh>
    </group>
  );
});

/** The pod, driven by the pure timetable in hyperloopPod.ts. */
const Pod = memo(function Pod(): React.JSX.Element {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const { x } = podPose(clock.elapsedTime);
    g.visible = x !== null;
    if (x !== null) g.position.x = x;
  });
  return (
    <group ref={group} position={[0, HYPERLOOP_Y, HYPERLOOP_Z]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.6, 6.4, 6, 16]} />
        <meshStandardMaterial
          color="#f8fafc"
          roughness={0.25}
          metalness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.15, 0.55]}>
        <boxGeometry args={[4.6, 0.22, 0.05]} />
        <meshStandardMaterial
          color="#0b1220"
          emissive={CYAN}
          emissiveIntensity={0.7}
        />
      </mesh>
      <mesh position={[0, 0.15, -0.55]}>
        <boxGeometry args={[4.6, 0.22, 0.05]} />
        <meshStandardMaterial
          color="#0b1220"
          emissive={CYAN}
          emissiveIntensity={0.7}
        />
      </mesh>
    </group>
  );
});

function StationSign(): React.JSX.Element {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#0b1220";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = CYAN;
      g.fillRect(0, c.height - 10, c.width, 10);
      g.fillStyle = "#fff";
      g.font = "700 64px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("HYPERLOOP  ·  LACC STATION", c.width / 2, c.height / 2 - 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh
      position={[
        HYPERLOOP_STATION_X,
        HYPERLOOP_STATION_H - 0.8,
        HYPERLOOP_STATION_Z + HYPERLOOP_STATION_D / 2 + 0.06,
      ]}
    >
      <planeGeometry args={[12, 1.5]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/**
 * Station: a white capsule cap around the tube (where the pod stops), and a
 * ground terminal north of the road joined to it by a glass skybridge.
 */
const Station = memo(function Station(): React.JSX.Element {
  const sx = HYPERLOOP_STATION_X;
  const tz = HYPERLOOP_STATION_Z;
  const tw = HYPERLOOP_STATION_W;
  const td = HYPERLOOP_STATION_D;
  const th = HYPERLOOP_STATION_H;
  // The terminal's road-facing (south) side is the glass front.
  const frontZ = tz + td / 2;
  const bridgeLen = HYPERLOOP_Z - frontZ;
  const bridgeZ = (HYPERLOOP_Z + frontZ) / 2;
  return (
    <group>
      {/* Station cap around the tube */}
      <mesh
        position={[sx, HYPERLOOP_Y, HYPERLOOP_Z]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[CAP_R, CAP_R, CAP_LEN, 24]} />
        <meshStandardMaterial color={WHITE} roughness={0.3} metalness={0.3} />
      </mesh>
      {/* Window band on both flanks */}
      {([-1, 1] as const).map((s) => (
        <mesh
          key={s}
          position={[sx, HYPERLOOP_Y + 0.1, HYPERLOOP_Z + s * (CAP_R + 0.01)]}
        >
          <boxGeometry args={[CAP_LEN - 3, 0.7, 0.04]} />
          <meshStandardMaterial
            color="#0b1220"
            emissive={CYAN}
            emissiveIntensity={0.35}
            roughness={0.1}
            metalness={0.6}
          />
        </mesh>
      ))}
      {/* Supports under the cap */}
      {[-1, 1].flatMap((sxSign) =>
        [-1, 1].map((szSign) => (
          <mesh
            key={`${sxSign}${szSign}`}
            position={[
              sx + sxSign * (CAP_LEN / 2 - 1.5),
              (HYPERLOOP_Y - CAP_R) / 2,
              HYPERLOOP_Z + szSign * HYPERLOOP_PYLON_HALF_SPAN,
            ]}
          >
            <boxGeometry args={[0.8, HYPERLOOP_Y - CAP_R, 0.8]} />
            <meshStandardMaterial
              color={WHITE}
              roughness={0.5}
              metalness={0.2}
            />
          </mesh>
        )),
      )}
      {/* Terminal hall */}
      <mesh position={[sx, th / 2, tz]} castShadow receiveShadow>
        <boxGeometry args={[tw, th, td]} />
        <meshStandardMaterial
          color="#d7dee6"
          roughness={0.6}
          metalness={0.15}
        />
      </mesh>
      {/* Glass front (faces the road) */}
      <mesh position={[sx, th / 2 - 0.4, frontZ + 0.03]}>
        <planeGeometry args={[tw - 2, th - 1.6]} />
        <meshStandardMaterial
          color="#9fd8ee"
          roughness={0.05}
          metalness={0.5}
          transparent
          opacity={0.45}
          emissive={CYAN}
          emissiveIntensity={0.12}
        />
      </mesh>
      {/* Sweeping roof: the upper half of a cylinder laid along x */}
      <mesh
        position={[sx, th, tz]}
        rotation={[0, 0, Math.PI / 2]}
        // Local x is world y after the rotation: flatten the arch to ~2.5 high.
        scale={[0.45, 1, 1]}
        castShadow
      >
        <cylinderGeometry
          args={[td / 2 + 0.6, td / 2 + 0.6, tw + 1, 24, 1, false, 0, Math.PI]}
        />
        <meshStandardMaterial
          color={WHITE}
          roughness={0.35}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Skybridge from the terminal roofline to the station cap */}
      <mesh position={[sx, th + 0.6, bridgeZ]}>
        <boxGeometry args={[2.2, 1.8, Math.abs(bridgeLen)]} />
        <meshStandardMaterial
          color="#bfe6f5"
          roughness={0.05}
          metalness={0.4}
          transparent
          opacity={0.55}
        />
      </mesh>
      <StationSign />
    </group>
  );
});

/** Elevated hyperloop line with terminal and shuttling pod (city view only). */
export const HyperloopLine = memo(function HyperloopLine(): React.JSX.Element {
  return (
    <group>
      <Track />
      <Station />
      <Pod />
    </group>
  );
});
