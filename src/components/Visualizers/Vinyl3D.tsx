import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Track } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface Vinyl3DProps {
  track: Track | null;
  isPlaying: boolean;
  quality?: 'ultra' | 'balanced' | 'low' | 'canvas2d' | 'disabled';
}

export const Vinyl3D: React.FC<Vinyl3DProps> = ({ track, isPlaying, quality = 'ultra' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const vinylGroupRef = useRef<THREE.Group | null>(null);
  const toneArmRef = useRef<THREE.Group | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    if (!containerRef.current || quality === 'disabled') return;

    const width = containerRef.current.clientWidth || 320;
    const height = containerRef.current.clientHeight || 320;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 4.2, 5.5);
    camera.lookAt(0, 0, 0);

    // Renderer with high performance & battery optimization
    const renderer = new THREE.WebGLRenderer({
      antialias: quality === 'ultra',
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'ultra' ? 2 : 1.2));
    renderer.shadowMap.enabled = quality === 'ultra';
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const pinkLight = new THREE.PointLight(0xff007f, 3.5, 20);
    pinkLight.position.set(-3, 4, 3);
    scene.add(pinkLight);

    const cyanLight = new THREE.PointLight(0x00f2fe, 3.5, 20);
    cyanLight.position.set(3, 4, -2);
    scene.add(cyanLight);

    // Vinyl Disc Group
    const vinylGroup = new THREE.Group();
    scene.add(vinylGroup);
    vinylGroupRef.current = vinylGroup;

    // 1. Base Vinyl Disc Cylinder
    const discGeo = new THREE.CylinderGeometry(2.3, 2.3, 0.08, quality === 'ultra' ? 64 : 32);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x0c0d14,
      roughness: 0.25,
      metalness: 0.85,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    vinylGroup.add(disc);

    // 2. Vinyl Grooves (Rings)
    for (let r = 1.1; r < 2.2; r += 0.12) {
      const ringGeo = new THREE.RingGeometry(r, r + 0.04, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x1f2338,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.042;
      vinylGroup.add(ring);
    }

    // 3. Center Label (Art Texture)
    const labelGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.086, 32);
    const textureLoader = new THREE.TextureLoader();
    
    // Default art texture fallback
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      roughness: 0.4,
      metalness: 0.1,
    });

    if (track?.thumbnailUrl) {
      textureLoader.load(
        track.thumbnailUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          disc.material = discMat;
          labelMat.map = tex;
          labelMat.needsUpdate = true;
        },
        undefined,
        () => {
          // fallback to vibrant gradient color
          labelMat.color.setHex(0xdb2777);
        }
      );
    }
    const centerLabel = new THREE.Mesh(labelGeo, labelMat);
    vinylGroup.add(centerLabel);

    // 4. Center Spindle Pin Hole
    const spindleGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.14, 16);
    const spindleMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0x00f2fe,
      emissiveIntensity: 0.4,
    });
    const spindle = new THREE.Mesh(spindleGeo, spindleMat);
    vinylGroup.add(spindle);

    // 5. Tone Arm Needle
    const toneArmGroup = new THREE.Group();
    toneArmGroup.position.set(2.4, 0.2, 1.8);
    scene.add(toneArmGroup);
    toneArmRef.current = toneArmGroup;

    // Base pivot
    const pivotGeo = new THREE.CylinderGeometry(0.25, 0.28, 0.4, 16);
    const pivotMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const pivot = new THREE.Mesh(pivotGeo, pivotMat);
    toneArmGroup.add(pivot);

    // Arm Rod
    const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 16);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 });
    const rod = new THREE.Mesh(rodGeo, rodMat);
    rod.rotation.x = Math.PI / 2;
    rod.rotation.z = -Math.PI / 6;
    rod.position.set(-0.9, 0.2, -0.9);
    toneArmGroup.add(rod);

    // Cartridge / Needle Head
    const headGeo = new THREE.BoxGeometry(0.14, 0.1, 0.25);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      emissive: 0xff007f,
      emissiveIntensity: 0.6,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(-1.8, 0.1, -1.8);
    toneArmGroup.add(head);

    // Animation Loop with dynamic rotation and battery saver
    let rotationSpeed = 0;
    const freqData = new Uint8Array(32);

    const animate = () => {
      // Check if page is visible or battery saver is active
      if (document.hidden) {
        animFrameIdRef.current = requestAnimationFrame(animate);
        return;
      }

      if (isPlayingRef.current) {
        // Accelerate smoothly to playing RPM
        rotationSpeed = THREE.MathUtils.lerp(rotationSpeed, 0.025, 0.05);
      } else {
        // Decelerate smoothly to stop
        rotationSpeed = THREE.MathUtils.lerp(rotationSpeed, 0, 0.03);
      }

      if (vinylGroupRef.current) {
        vinylGroupRef.current.rotation.y -= rotationSpeed;

        // Reactive audio bounce
        if (isPlayingRef.current) {
          audioEngine.getAnalyserData(freqData);
          const bassAverage = (freqData[0] + freqData[1] + freqData[2]) / (3 * 255);
          const scale = 1 + bassAverage * 0.04;
          vinylGroupRef.current.scale.set(scale, 1, scale);
        }
      }

      // Smooth Tone-arm landing
      if (toneArmRef.current) {
        const targetArmRotation = isPlayingRef.current ? -0.22 : 0.35;
        toneArmRef.current.rotation.y = THREE.MathUtils.lerp(
          toneArmRef.current.rotation.y,
          targetArmRotation,
          0.04
        );
      }

      renderer.render(scene, camera);
      animFrameIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const newW = containerRef.current.clientWidth || 320;
      const newH = containerRef.current.clientHeight || 320;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (rendererRef.current && rendererRef.current.domElement) {
        rendererRef.current.dispose();
      }
    };
  }, [quality, track?.id, track?.thumbnailUrl]);

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none pointer-events-none">
      <div
        ref={containerRef}
        className="w-full h-full max-w-[340px] max-h-[340px] sm:max-w-[400px] sm:max-h-[400px] flex items-center justify-center"
      />
      {/* Ambient background glow ring */}
      <div className="absolute inset-0 m-auto w-64 h-64 rounded-full bg-gradient-to-tr from-pink-500/20 via-cyan-500/15 to-purple-600/20 blur-3xl -z-10 animate-pulse-glow" />
    </div>
  );
};
