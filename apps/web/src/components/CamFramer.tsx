import { useEffect, useRef, useState } from 'react';
import { type CamFrame, cleanCam, cropFor, DEFAULT_CAM, MAX_ZOOM } from '../world/avatar';

/** The telly screen's shape (4:3). */
const SCREEN_ASPECT = 4 / 3;

/**
 * Frame your webcam for your telly head: the box is what goes on the screen.
 * Drag it onto your face and zoom until your face fills the oval. Shown
 * mirrored, like a mirror, though everyone else sees you the right way round.
 */
export function CamFramer({ stream, value, onChange }: { stream: MediaStream | null; value: CamFrame; onChange: (c: CamFrame) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const drag = useRef<{ x: number; y: number; cam: CamFrame } | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    const meta = () => v.videoWidth && setAspect(v.videoWidth / v.videoHeight);
    v.addEventListener('loadedmetadata', meta);
    v.addEventListener('resize', meta);
    meta();
    return () => {
      v.removeEventListener('loadedmetadata', meta);
      v.removeEventListener('resize', meta);
    };
  }, [stream]);

  const crop = cropFor(aspect, SCREEN_ASPECT, value);
  const w = crop.repeat.x;
  const h = crop.repeat.y;
  const top = 1 - crop.offset.y - h;
  // Mirrored: the left edge on screen is the right edge of the camera image.
  const left = 1 - crop.offset.x - w;

  /** Keep the crop centre where the box can actually reach. */
  const settle = (c: CamFrame): CamFrame => {
    const r = cropFor(aspect, SCREEN_ASPECT, { ...c, x: 0.5, y: 0.5 }).repeat;
    return cleanCam({ zoom: c.zoom, x: Math.min(1 - r.x / 2, Math.max(r.x / 2, c.x)), y: Math.min(1 - r.y / 2, Math.max(r.y / 2, c.y)) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cam: settle(value) };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    onChange(settle({ ...d.cam, x: d.cam.x - dx, y: d.cam.y + dy }));
  };
  const onPointerUp = () => (drag.current = null);
  const zoom = (z: number) => onChange(settle({ ...value, zoom: z }));

  return (
    <div className="cam-framer">
      <div
        ref={boxRef}
        className="cam-framer-view"
        style={{ aspectRatio: String(aspect) }}
        onWheel={(e) => zoom(Math.min(MAX_ZOOM, Math.max(1, value.zoom - e.deltaY * 0.002)))}
      >
        <video ref={videoRef} muted playsInline autoPlay />
        {!stream && <div className="cam-framer-off">Camera off</div>}
        <div
          className="cam-framer-crop"
          role="slider"
          aria-label="Drag to frame your face"
          aria-valuenow={Math.round(value.zoom * 100)}
          tabIndex={0}
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            const step = 0.02;
            const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const m = moves[e.key];
            if (!m) return;
            e.preventDefault();
            onChange(settle({ ...value, x: value.x + m[0], y: value.y + m[1] }));
          }}
        >
          <div className="cam-framer-oval" />
        </div>
      </div>
      <div className="row cam-framer-tools">
        <label className="small" style={{ flex: 1, margin: 0 }}>
          Face size
          <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={value.zoom} onChange={(e) => zoom(Number(e.target.value))} aria-label="Zoom in on your face" />
        </label>
        <button type="button" className="btn btn-sm" onClick={() => onChange(DEFAULT_CAM)}>Reset</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Drag the box onto your face and zoom until it fills the oval. That box is what appears on your telly.</p>
    </div>
  );
}
