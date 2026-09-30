import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as SkeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PERSON_WORLD_HEIGHT } from "../core/constants";
import { pickCharacterModel } from "../core/characters";
import { tintCharacterClone } from "../core/glb";
import type { AgentPlace } from "../core/types";
import type { CommunityPeer } from "../../community/types";
import type { PeerLiveStore } from "../../community/useCommunity";

/** Stable 0..1 hash of a peer id, so everyone sees the same rig and colour. */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Snap instead of gliding when a pose jumps further than this (teleport/lag). */
const SNAP_DIST = 8;
const FOLLOW_RATE = 9;

const RemoteAvatar = memo(function RemoteAvatar({
  peer,
  live,
  visiblePlace,
}: {
  peer: CommunityPeer;
  live: React.RefObject<PeerLiveStore>;
  visiblePlace: AgentPlace | null;
}): React.JSX.Element {
  const model = useMemo(() => pickCharacterModel(hash01(peer.id)), [peer.id]);
  const tint = useMemo(
    () =>
      `#${new THREE.Color()
        .setHSL(hash01(`${peer.id}:c`), 0.62, 0.5)
        .getHexString()}`,
    [peer.id],
  );
  const { scene, animations } = useGLTF(model.url);
  const groupRef = useRef<THREE.Group>(null);
  const seeded = useRef(false);

  const { cloned, mixer, walkIdx, idleIdx, autoScale } = useMemo(() => {
    const c = SkeletonClone(scene);
    c.updateMatrixWorld(true);
    tintCharacterClone(c, tint, 0.6, model.shirtMaterials);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(c).getSize(size);
    const names = animations.map((a) => a.name.toLowerCase());
    return {
      cloned: c,
      mixer: new THREE.AnimationMixer(c),
      walkIdx: names.findIndex((n) => n.includes("walk")),
      idleIdx: names.findIndex((n) => n.includes("idle")),
      autoScale: size.y > 0 ? PERSON_WORLD_HEIGHT / size.y : 1,
    };
  }, [scene, animations, tint, model]);

  const actions = useRef<{
    walk: THREE.AnimationAction | null;
    idle: THREE.AnimationAction | null;
  }>({ walk: null, idle: null });

  useEffect(() => {
    const walk =
      walkIdx >= 0 ? mixer.clipAction(animations[walkIdx], cloned) : null;
    const idle =
      idleIdx >= 0 ? mixer.clipAction(animations[idleIdx], cloned) : null;
    walk?.reset().setEffectiveWeight(0).play();
    idle?.reset().setEffectiveWeight(1).play();
    actions.current = { walk, idle };
    return () => {
      actions.current = { walk: null, idle: null };
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
    };
  }, [mixer, cloned, animations, walkIdx, idleIdx]);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const step = Math.min(delta, 0.05);
    const pose = live.current?.get(peer.id)?.pose;
    const show =
      !!pose && (visiblePlace === null || pose.place === visiblePlace);
    g.visible = show;
    if (!pose || !show) return;
    mixer.update(step);

    if (
      !seeded.current ||
      Math.hypot(pose.x - g.position.x, pose.z - g.position.z) > SNAP_DIST
    ) {
      g.position.set(pose.x, 0, pose.z);
      g.rotation.y = pose.ry;
      seeded.current = true;
    } else {
      g.position.x = THREE.MathUtils.damp(
        g.position.x,
        pose.x,
        FOLLOW_RATE,
        step,
      );
      g.position.z = THREE.MathUtils.damp(
        g.position.z,
        pose.z,
        FOLLOW_RATE,
        step,
      );
      let diff = pose.ry - g.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.rotation.y += diff * Math.min(1, 12 * step);
    }

    const { walk, idle } = actions.current;
    if (walk && idle) {
      const w = THREE.MathUtils.damp(
        walk.getEffectiveWeight(),
        pose.mv ? 1 : 0,
        12,
        step,
      );
      walk.setEffectiveWeight(w);
      idle.setEffectiveWeight(Math.max(0, 1 - w));
    }
  });

  const labelWidth = Math.max(1.0, peer.name.length * 0.13 + 0.5);
  return (
    <group ref={groupRef} visible={false}>
      <primitive object={cloned} scale={autoScale} />
      <Billboard position={[0, PERSON_WORLD_HEIGHT + 0.45, 0]}>
        <mesh position={[0, 0, -0.001]}>
          <planeGeometry args={[labelWidth, 0.36]} />
          <meshBasicMaterial color="#080c14" transparent opacity={0.85} />
        </mesh>
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.2}
          color={tint}
          anchorX="center"
          anchorY="middle"
        >
          {peer.name}
        </Text>
      </Billboard>
    </group>
  );
});

/**
 * Other Community members walking the world. Only peers in walk mode publish a
 * pose; each is drawn from a stable rig + shirt colour derived from their id,
 * gliding toward their latest pose. Like AgentsLayer it stays mounted in every
 * location and toggles per-avatar visibility by place.
 */
export const RemoteAvatarsLayer = memo(function RemoteAvatarsLayer({
  peers,
  live,
  visiblePlace,
}: {
  peers: CommunityPeer[];
  live: React.RefObject<PeerLiveStore>;
  visiblePlace: AgentPlace | null;
}): React.JSX.Element {
  return (
    <group>
      {peers.map((p) => (
        <RemoteAvatar
          key={p.id}
          peer={p}
          live={live}
          visiblePlace={visiblePlace}
        />
      ))}
    </group>
  );
});
