import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Avatar, type AvatarLook } from '../world/avatar';
import { toon } from '../world/venue';

/**
 * A live 3D preview of your avatar for the pre-join screen: it turns gently
 * from side to side, glances about, waves now and then, and shows your webcam
 * on its telly exactly as other people will see it. Drag to spin it round.
 */
export function AvatarPreview({ name, color, look, video }: { name: string; color: string; look: AvatarLook; video: HTMLVideoElement | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<Avatar | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      host.dataset.noWebgl = 'true';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.45, 5.4);
    camera.lookAt(0, 1.28, 0);
    scene.add(new THREE.HemisphereLight('#fff9f0', '#7a7468', 1.9));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 40), toon('#d8d0c0'));
    plinth.position.y = -0.06;
    scene.add(plinth);

    const avatar = new Avatar(name, color);
    avatarRef.current = avatar;
    scene.add(avatar.root);

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Drag to spin; it drifts back to facing you when you let go.
    let spin = 0;
    let dragging = false;
    let lastX = 0;
    const canvas = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      spin += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    };
    const up = () => (dragging = false);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    const clock = new THREE.Clock();
    let t = 0;
    let nextWave = 1.5;
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      t += dt;
      if (!dragging) spin *= 1 - Math.min(1, dt * 1.5);
      if (t > nextWave) {
        avatar.playGesture('wave');
        nextWave = t + 6 + Math.random() * 4;
      }
      // Looks around to show off its profile: the head leads and the body
      // catches up, just like in the venue.
      const look = Math.sin(t * 0.45) * 0.9 + Math.sin(t * 1.3) * 0.2 * Math.max(0, Math.cos(t * 0.3)) + spin;
      avatar.update(dt, 0, Math.sin(t * 0.7) * 0.1, look);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      avatar.dispose();
      avatarRef.current = null;
      plinth.geometry.dispose();
      renderer.dispose();
      canvas.remove();
    };
    // Built once; the props below are applied live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => avatarRef.current?.setName(name || 'You'), [name]);
  useEffect(() => avatarRef.current?.setColor(color), [color]);
  useEffect(() => avatarRef.current?.setLook(look), [look]);
  useEffect(() => avatarRef.current?.setVideo(video), [video]);

  return <div ref={hostRef} className="avatar-preview" title="Drag to spin your avatar round" />;
}
