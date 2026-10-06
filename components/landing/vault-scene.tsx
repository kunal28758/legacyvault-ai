"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Procedural "vault shield" hero (no external assets, nothing to download).
 *
 * A bevelled metallic shield carrying a glowing keyhole inside a vault dial,
 * set in front of a large rotating vault ring, two tilted orbit rings and a
 * slow field of rising particles. A soft light sweeps across the shield face;
 * the whole rig leans toward the pointer (parallax) and brightens on hover.
 *
 * `animate={false}` renders one still frame (reduced motion); `active={false}`
 * stops the render loop while the hero is off screen.
 */
const NAVY = new THREE.Color("#071229");
const BLUE = new THREE.Color("#0ea5ff");
const VIOLET = new THREE.Color("#6b5cff");
const CYAN = new THREE.Color("#22d3ee");

function shieldShape(scale = 1): THREE.Shape {
  const w = 1.1 * scale;
  const top = 1.25 * scale;
  const corner = 0.2 * scale;
  const shoulder = 0.45 * scale;
  const bottom = -1.5 * scale;
  const shape = new THREE.Shape();
  shape.moveTo(-w, top - corner);
  shape.quadraticCurveTo(-w, top, -w + corner, top);
  // A shallow notch in the crest gives the silhouette its heraldic look.
  shape.quadraticCurveTo(0, top - 0.12 * scale, w - corner, top);
  shape.quadraticCurveTo(w, top, w, top - corner);
  shape.lineTo(w, shoulder);
  shape.bezierCurveTo(w, -0.45 * scale, 0.6 * scale, -1.08 * scale, 0, bottom);
  shape.bezierCurveTo(-0.6 * scale, -1.08 * scale, -w, -0.45 * scale, -w, shoulder);
  shape.closePath();
  return shape;
}

/** Round head over a flared stem, traced as one closed outline. */
function keyholeShape(): THREE.Shape {
  const radius = 0.17;
  const neck = 0.06; // half-width where the stem meets the head
  const spread = Math.asin(neck / radius);
  const shape = new THREE.Shape();
  // From the head's lower-left, the long way over the top to its lower-right…
  shape.absarc(0, 0.12, radius, -Math.PI / 2 - spread, -Math.PI / 2 + spread, true);
  // …then down the flared stem and back.
  shape.lineTo(0.1, -0.42);
  shape.lineTo(-0.1, -0.42);
  shape.closePath();
  return shape;
}

/** A soft radial glow sprite: a cheap stand-in for bloom. */
function useGlowTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

function Shield({ animate, hoverRef }: { animate: boolean; hoverRef: React.RefObject<number> }) {
  const emblem = useRef<THREE.MeshStandardMaterial>(null);
  const dial = useRef<THREE.Group>(null);
  const edge = useRef<THREE.LineBasicMaterial>(null);

  const body = useMemo(() => {
    const geometry = new THREE.ExtrudeGeometry(shieldShape(), {
      depth: 0.28,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.07,
      bevelSegments: 5,
      curveSegments: 40,
    });
    geometry.center();
    return geometry;
  }, []);

  const face = useMemo(() => {
    const geometry = new THREE.ExtrudeGeometry(shieldShape(0.8), {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 3,
      curveSegments: 40,
    });
    geometry.center();
    return geometry;
  }, []);

  const outline = useMemo(() => {
    const points = shieldShape(1.08).getPoints(120);
    return new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, 0)),
    );
  }, []);

  const keyhole = useMemo(() => {
    const geometry = new THREE.ExtrudeGeometry(keyholeShape(), {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.012,
      bevelSegments: 2,
      curveSegments: 24,
    });
    geometry.center();
    return geometry;
  }, []);

  const ticks = useMemo(
    () =>
      Array.from({ length: 36 }, (_, index) => {
        const angle = (index / 36) * Math.PI * 2;
        return { angle, long: index % 3 === 0 };
      }),
    [],
  );

  useFrame((state, delta) => {
    const glow = 1 + (hoverRef.current ?? 0) * 0.8;
    if (emblem.current) {
      const pulse = animate ? 0.15 * Math.sin(state.clock.elapsedTime * 1.6) : 0;
      emblem.current.emissiveIntensity = (1.4 + pulse) * glow;
    }
    if (edge.current) edge.current.opacity = 0.55 + (hoverRef.current ?? 0) * 0.4;
    if (animate && dial.current)
      dial.current.rotation.z -= delta * (0.25 + (hoverRef.current ?? 0) * 0.5);
  });

  return (
    <group>
      <mesh geometry={body} castShadow>
        <meshPhysicalMaterial
          color={NAVY}
          metalness={0.92}
          roughness={0.28}
          clearcoat={1}
          clearcoatRoughness={0.15}
          emissive={BLUE}
          emissiveIntensity={0.06}
        />
      </mesh>
      <mesh geometry={face} position={[0, 0.02, 0.2]}>
        <meshPhysicalMaterial
          color="#101d42"
          metalness={0.6}
          roughness={0.12}
          transmission={0.2}
          thickness={0.4}
          clearcoat={1}
          emissive={VIOLET}
          emissiveIntensity={0.08}
        />
      </mesh>
      <lineLoop geometry={outline} position={[0, 0.02, 0.24]}>
        <lineBasicMaterial ref={edge} color={CYAN} transparent opacity={0.6} />
      </lineLoop>

      {/* Vault dial and keyhole */}
      <group position={[0, 0.15, 0.27]}>
        <mesh>
          <torusGeometry args={[0.5, 0.028, 16, 96]} />
          <meshStandardMaterial
            color={BLUE}
            emissive={BLUE}
            emissiveIntensity={1.1}
            metalness={0.4}
            roughness={0.3}
          />
        </mesh>
        <group ref={dial}>
          {ticks.map(({ angle, long }) => (
            <mesh
              key={angle}
              position={[Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0]}
              rotation={[0, 0, angle]}
            >
              <boxGeometry args={[long ? 0.09 : 0.05, 0.014, 0.02]} />
              <meshBasicMaterial
                color={long ? CYAN : VIOLET}
                transparent
                opacity={long ? 0.95 : 0.6}
              />
            </mesh>
          ))}
        </group>
        <mesh geometry={keyhole} position={[0, 0, 0.02]}>
          <meshStandardMaterial
            ref={emblem}
            color={CYAN}
            emissive={CYAN}
            emissiveIntensity={1.4}
            metalness={0.2}
            roughness={0.25}
          />
        </mesh>
      </group>
    </group>
  );
}

function VaultRing({ animate }: { animate: boolean }) {
  const ring = useRef<THREE.Group>(null);
  const marks = useMemo(
    () => Array.from({ length: 72 }, (_, index) => (index / 72) * Math.PI * 2),
    [],
  );
  useFrame((_, delta) => {
    if (animate && ring.current) ring.current.rotation.z += delta * 0.05;
  });
  return (
    <group position={[0, 0, -0.9]}>
      <mesh>
        <torusGeometry args={[2.15, 0.07, 24, 160]} />
        <meshStandardMaterial
          color="#0c1838"
          metalness={0.95}
          roughness={0.35}
          emissive={BLUE}
          emissiveIntensity={0.08}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[1.98, 0.01, 8, 200]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.55} />
      </mesh>
      <group ref={ring}>
        {marks.map((angle, index) => (
          <mesh
            key={angle}
            position={[Math.cos(angle) * 2.3, Math.sin(angle) * 2.3, 0]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[index % 6 === 0 ? 0.16 : 0.07, 0.018, 0.02]} />
            <meshBasicMaterial
              color={index % 6 === 0 ? CYAN : VIOLET}
              transparent
              opacity={index % 6 === 0 ? 0.85 : 0.35}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function OrbitRing({
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
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.z += delta * speed;
  });
  return (
    <group rotation={tilt}>
      <group ref={ref}>
        <mesh>
          <torusGeometry args={[radius, 0.008, 8, 200]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} />
        </mesh>
        <mesh position={[radius, 0, 0]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

function Particles({ animate, count = 360 }: { animate: boolean; count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const array = new Float32Array(count * 3);
    let seed = 11;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < count; i += 1) {
      const radius = 1.4 + rand() * 3.4;
      const angle = rand() * Math.PI * 2;
      array[i * 3] = Math.cos(angle) * radius;
      array[i * 3 + 1] = (rand() - 0.5) * 6;
      array[i * 3 + 2] = Math.sin(angle) * radius * 0.6 - 0.5;
    }
    return array;
  }, [count]);

  useFrame((_, delta) => {
    if (!animate || !ref.current) return;
    const attribute = ref.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      let y = attribute.getY(i) + delta * (0.08 + (i % 7) * 0.012);
      if (y > 3) y = -3;
      attribute.setY(i, y);
    }
    attribute.needsUpdate = true;
    ref.current.rotation.y -= delta * 0.015;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={CYAN}
        size={0.022}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function LightSweep({ animate }: { animate: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    if (!light.current) return;
    const t = animate ? state.clock.elapsedTime : 1.2;
    // Crosses the shield every ~7 s, resting briefly at the edges.
    light.current.position.x = Math.sin(t * 0.9) * 2.4;
    light.current.position.y = 0.6 + Math.cos(t * 0.45) * 0.6;
  });
  return (
    <pointLight ref={light} position={[0, 0.6, 2.2]} intensity={14} distance={6} color={CYAN} />
  );
}

function Rig({ animate, hoverRef }: { animate: boolean; hoverRef: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const glowTexture = useGlowTexture();
  const glow = useRef<THREE.SpriteMaterial>(null);

  useFrame((state, delta) => {
    if (glow.current) {
      glow.current.opacity = 0.42 + (hoverRef.current ?? 0) * 0.25;
    }
    if (!animate || !group.current) return;
    const idle = Math.sin(state.clock.elapsedTime * 0.35) * 0.18;
    const targetY = state.pointer.x * 0.35 + idle;
    const targetX = -state.pointer.y * 0.2;
    group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, delta * 2.5);
    group.current.rotation.x += (targetX - group.current.rotation.x) * Math.min(1, delta * 2.5);
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.06;
  });

  return (
    <group ref={group}>
      <sprite scale={[5.2, 5.2, 1]} position={[0, 0.1, -1.2]}>
        <spriteMaterial
          ref={glow}
          map={glowTexture}
          color={VIOLET}
          transparent
          opacity={0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite scale={[3, 3, 1]} position={[0, 0.2, -0.4]}>
        <spriteMaterial
          map={glowTexture}
          color={BLUE}
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <VaultRing animate={animate} />
      <Shield animate={animate} hoverRef={hoverRef} />
      <OrbitRing
        radius={2.6}
        tilt={[Math.PI / 2.5, 0.25, 0]}
        speed={0.22}
        color={BLUE}
        animate={animate}
      />
      <OrbitRing
        radius={2.9}
        tilt={[Math.PI / 3, -0.55, 0.35]}
        speed={-0.14}
        color={VIOLET}
        animate={animate}
      />
      <Particles animate={animate} />
    </group>
  );
}

export default function VaultScene({
  animate = true,
  active = true,
  className,
}: {
  animate?: boolean;
  active?: boolean;
  className?: string;
}) {
  // Eased 0 → 1 while the pointer is over the scene; read inside the frame loop.
  const hoverRef = useRef(0);
  const targetRef = useRef(0);

  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0.1, 7.2], fov: 38 }}
      dpr={[1, 1.75]}
      frameloop={animate && active ? "always" : "demand"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
      onPointerEnter={() => (targetRef.current = 1)}
      onPointerLeave={() => (targetRef.current = 0)}
      aria-hidden
    >
      <HoverEase hoverRef={hoverRef} targetRef={targetRef} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} color="#dbe6ff" />
      <pointLight position={[-4, -1.5, 2.5]} intensity={22} color={VIOLET} distance={9} />
      <pointLight position={[4, 2.5, -2]} intensity={16} color={BLUE} distance={9} />
      <LightSweep animate={animate} />
      <Rig animate={animate} hoverRef={hoverRef} />
    </Canvas>
  );
}

function HoverEase({
  hoverRef,
  targetRef,
}: {
  hoverRef: React.RefObject<number>;
  targetRef: React.RefObject<number>;
}) {
  useFrame((_, delta) => {
    hoverRef.current =
      (hoverRef.current ?? 0) +
      ((targetRef.current ?? 0) - (hoverRef.current ?? 0)) * Math.min(1, delta * 4);
  });
  return null;
}
