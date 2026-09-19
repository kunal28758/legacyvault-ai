"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Procedural "vault core" (no external assets): a faceted core with a glowing
 * heart, three tilted orbit rings and a sparse particle field. Colours are the
 * brand accents. `animate={false}` renders a single still frame (reduced motion).
 */
const BLUE = new THREE.Color("#53a6ff");
const PURPLE = new THREE.Color("#b27dff");
const CYAN = new THREE.Color("#36dcec");

function Core({ animate }: { animate: boolean }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    if (!animate) return;
    if (outer.current) {
      outer.current.rotation.y += delta * 0.18;
      outer.current.rotation.x += delta * 0.06;
    }
    if (inner.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.04;
      inner.current.scale.setScalar(pulse);
    }
  });
  return (
    <group>
      <mesh ref={outer}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshStandardMaterial
          color={BLUE}
          wireframe
          transparent
          opacity={0.55}
          emissive={BLUE}
          emissiveIntensity={0.35}
        />
      </mesh>
      <mesh ref={inner}>
        <icosahedronGeometry args={[0.78, 2]} />
        <meshStandardMaterial
          color={PURPLE}
          emissive={PURPLE}
          emissiveIntensity={0.9}
          roughness={0.25}
          metalness={0.35}
          flatShading
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.98, 32, 32]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.06} />
      </mesh>
    </group>
  );
}

function Ring({
  radius,
  tilt,
  speed,
  color,
  animate,
}: {
  radius: number;
  tilt: [number, number, number];
  speed: number;
  color: THREE.Color;
  animate: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.z += delta * speed;
  });
  return (
    <group rotation={tilt}>
      <mesh ref={ref}>
        <torusGeometry args={[radius, 0.012, 12, 160]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 3]}>
        <torusGeometry args={[radius, 0.028, 8, 48, Math.PI / 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} />
      </mesh>
    </group>
  );
}

function Particles({ animate, count = 420 }: { animate: boolean; count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const array = new Float32Array(count * 3);
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < count; i += 1) {
      const r = 2.4 + rand() * 3.2;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      array[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      array[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      array[i * 3 + 2] = r * Math.cos(phi);
    }
    return array;
  }, [count]);
  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.y -= delta * 0.02;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={CYAN}
        size={0.02}
        sizeAttenuation
        transparent
        opacity={0.65}
        depthWrite={false}
      />
    </points>
  );
}

function Rig({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!animate || !group.current) return;
    const x = state.pointer.x * 0.18;
    const y = state.pointer.y * 0.12;
    group.current.rotation.y += (x - group.current.rotation.y) * 0.04;
    group.current.rotation.x += (-y - group.current.rotation.x) * 0.04;
  });
  return (
    <group ref={group}>
      <Core animate={animate} />
      <Ring
        radius={1.75}
        tilt={[Math.PI / 2.6, 0.2, 0]}
        speed={0.25}
        color={BLUE}
        animate={animate}
      />
      <Ring
        radius={2.1}
        tilt={[Math.PI / 3.4, -0.5, 0.4]}
        speed={-0.18}
        color={PURPLE}
        animate={animate}
      />
      <Ring
        radius={2.45}
        tilt={[Math.PI / 3.1, 0.9, -0.3]}
        speed={0.12}
        color={CYAN}
        animate={animate}
      />
      <Particles animate={animate} />
    </group>
  );
}

export default function VaultScene({
  animate = true,
  className,
}: {
  animate?: boolean;
  className?: string;
}) {
  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0.4, 7], fov: 40 }}
      dpr={[1, 1.5]}
      frameloop={animate ? "always" : "demand"}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      aria-hidden
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 3, 4]} intensity={18} color={BLUE} />
      <pointLight position={[-4, -2, 3]} intensity={12} color={PURPLE} />
      <Rig animate={animate} />
    </Canvas>
  );
}
