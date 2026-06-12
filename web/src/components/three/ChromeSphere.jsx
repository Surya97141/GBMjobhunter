import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';

function RotatingSphere() {
  const meshRef = useRef(null);

  useFrame(() => {
    if (meshRef.current) meshRef.current.rotation.y += 0.004;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.8, 64, 64]} />
      <meshPhysicalMaterial
        metalness={1}
        roughness={0}
        transmission={0.85}
        thickness={2.5}
        ior={1.5}
        envMapIntensity={2.5}
      />
    </mesh>
  );
}

export default function ChromeSphere() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 40 }}
      gl={{ alpha: true }}
      style={{ background: 'transparent', width: '100%', height: '100%' }}
    >
      <RotatingSphere />
      <Environment preset="city" />
      <OrbitControls enableZoom={false} enablePan={false} />
    </Canvas>
  );
}
