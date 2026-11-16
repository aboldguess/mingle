import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Match } from './match';
import type { Card } from './session';
import type { Branding, PodId } from './venue';
import { BOARD_H, BOARD_W } from './venue';
import { PEN_COLORS, paintStroke, type Stroke } from './whiteboard';

export interface PersonRow {
  id: string;
  name: string;
  color: string;
  tag?: string;
  goal?: string;
  you?: boolean;
  bot?: boolean;
  hand?: boolean;
  mic?: boolean;
  muted?: boolean;
  where?: string;
}

/**
 * Everyone in the venue. Anyone can teleport to a person; hosts also get the
 * door queue, the hall mic, mute/remove and the "call everyone" button.
 */
export function PeoplePanel(props: {
  people: PersonRow[];
  isHost: boolean;
  code?: string;
  onGoTo: (id: string) => void;
  onPassMic?: (id: string | null) => void;
  onSummon?: () => void;
  onAnnounce?: (text: string) => void;
  matches?: Match[];
  groups?: { count: number; mine: number | null } | null;
  tableCount?: number;
  onMakeGroups?: (n: number) => void;
  onEndGroups?: () => void;
  onVisitTable?: (table: number) => void;
  branding?: Branding | null;
  onBranding?: (b: Branding) => void;
  onClose: () => void;
}) {
  const { people, isHost, code, matches = [], groups } = props;
  const [groupCount, setGroupCount] = useState(4);
  const [brand, setBrand] = useState<Branding>(() => props.branding ?? { name: '', sponsor: '', color: '#3f4a5a' });
  const [pending, setPending] = useState<Array<{ id: string; displayName: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const live = Boolean(code);

  const loadPending = useCallback(async () => {
    if (!isHost || !code) return;
    try {
      setPending((await api<{ pending: typeof pending }>(`/meetings/${code}/admissions`)).pending);
    } catch {
      /* transient; next poll retries */
    }
  }, [code, isHost]);

  useEffect(() => {
    void loadPending();
    if (!isHost || !code) return;
    const t = setInterval(loadPending, 3000);
    return () => clearInterval(t);
  }, [loadPending, isHost, code]);

  const act = async (path: string, body: unknown = {}) => {
    setError(null);
    try {
      await api(path, { body });
      await loadPending();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const hands = people.filter((p) => p.hand);
  const sorted = [...people].sort((a, b) => Number(b.you) - Number(a.you) || Number(b.mic) - Number(a.mic) || Number(b.hand) - Number(a.hand) || a.name.localeCompare(b.name));

  return (
    <aside className="host-panel world-panel" aria-label="People">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>People ({people.length})</h3>
        <button className="btn btn-sm" onClick={props.onClose} aria-label="Close">✕</button>
      </div>
      {error && <div className="error">{error}</div>}

      {isHost && (
        <div className="host-tools">
          <div className="small muted">Host tools</div>
          <button className="btn btn-sm" onClick={props.onSummon}>📣 Call everyone to the auditorium</button>
          <form
            className="row"
            style={{ flexWrap: 'nowrap', gap: '0.3rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              props.onAnnounce?.(announcement);
              setAnnouncement('');
            }}
          >
            <input value={announcement} maxLength={200} placeholder="Announcement to everyone" onChange={(e) => setAnnouncement(e.target.value)} />
            <button className="btn btn-sm" disabled={!announcement.trim()}>Send</button>
          </form>
          <div className="small muted" style={{ marginTop: 4 }}>Discussion groups</div>
          {groups ? (
            <>
              <div className="row" style={{ gap: '0.3rem' }}>
                {Array.from({ length: groups.count || props.tableCount || 0 }, (_, i) => (
                  <button key={i} className="btn btn-sm" onClick={() => props.onVisitTable?.(i)} title={`Drop in on table ${i + 1}`}>Visit {i + 1}</button>
                ))}
              </div>
              <button className="btn btn-sm" onClick={props.onEndGroups}>End groups</button>
            </>
          ) : (
            <div className="row" style={{ flexWrap: 'nowrap', gap: '0.3rem' }}>
              <select value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} aria-label="Number of tables">
                {[2, 3, 4, 5, 6, 8].filter((n) => n <= (props.tableCount || 8)).map((n) => (
                  <option key={n} value={n}>{n} tables</option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => props.onMakeGroups?.(groupCount)}>Split the room</button>
            </div>
          )}
          <div className="small muted" style={{ marginTop: 4 }}>Venue signage</div>
          <form
            className="stack"
            style={{ gap: '0.3rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              props.onBranding?.(brand);
            }}
          >
            <input value={brand.name} maxLength={28} placeholder="Event name on the back wall" onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
            <div className="row" style={{ flexWrap: 'nowrap', gap: '0.3rem' }}>
              <input value={brand.sponsor} maxLength={22} placeholder="Sponsor (optional)" onChange={(e) => setBrand({ ...brand, sponsor: e.target.value })} />
              <input type="color" value={brand.color} onChange={(e) => setBrand({ ...brand, color: e.target.value })} aria-label="Brand colour" style={{ flex: '0 0 36px', padding: 0, height: 30 }} />
            </div>
            <button className="btn btn-sm">Update signs</button>
          </form>
        </div>
      )}

      {matches.length > 0 && (
        <div className="match-note">
          <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>Worth meeting</div>
          {matches.slice(0, 3).map((m) => (
            <div key={m.id} className="row spread" style={{ flexWrap: 'nowrap', gap: '0.3rem' }}>
              <span className="small">{m.name} {m.reason}</span>
              <button className="btn btn-sm" onClick={() => props.onGoTo(m.id)}>Go</button>
            </div>
          ))}
        </div>
      )}

      {isHost && live && pending.length > 0 && (
        <>
          <h3>At the door ({pending.length})</h3>
          {pending.map((p) => (
            <div className="person" key={p.id}>
              <span>{p.displayName}</span>
              <span className="row" style={{ gap: '0.3rem' }}>
                <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/admissions/${p.id}`, { admit: true })}>Let in</button>
                <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/admissions/${p.id}`, { admit: false })}>Deny</button>
              </span>
            </div>
          ))}
        </>
      )}

      {hands.length > 0 && <div className="small hands-note">✋ {hands.length} hand{hands.length > 1 ? 's' : ''} up{isHost ? ': pass them the mic to let the whole hall hear them' : ''}</div>}

      {sorted.map((p) => (
        <div className="person" key={p.id}>
          <span className="person-name">
            <span className="dot" style={{ background: p.color }} />
            <span>
              {p.name}
              {p.you && ' (you)'}
              {p.hand && ' ✋'}
              {p.mic && ' 🎤'}
              {p.bot && <span className="muted"> · bot</span>}
              {p.muted && <span className="muted"> · muted</span>}
              {(p.tag || p.where) && (
                <span className="small muted person-sub">
                  {p.where}
                  {p.tag && p.where ? ' · ' : ''}
                  {p.tag && `Ask me about ${p.tag}`}
                </span>
              )}
              {p.goal && <span className="small muted person-sub">Here to {p.goal.replace(/^here to\s+/i, '')}</span>}
            </span>
          </span>
          <span className="row" style={{ gap: '0.3rem', flexWrap: 'nowrap' }}>
            {!p.you && <button className="btn btn-sm" title="Teleport next to them" onClick={() => props.onGoTo(p.id)}>Go</button>}
            {isHost && props.onPassMic && (p.mic ? (
              <button className="btn btn-sm" onClick={() => props.onPassMic!(null)}>Take mic</button>
            ) : (
              (p.hand || !p.you) && <button className="btn btn-sm" onClick={() => props.onPassMic!(p.id)}>Give mic</button>
            ))}
            {isHost && live && !p.you && !p.bot && !p.muted && <button className="btn btn-sm" onClick={() => act(`/meetings/${code}/participants/${encodeURIComponent(p.id)}/mute`)}>Mute</button>}
            {isHost && live && !p.you && !p.bot && (
              <button className="btn btn-sm" onClick={() => confirm(`Remove ${p.name}?`) && act(`/meetings/${code}/participants/${encodeURIComponent(p.id)}/remove`)}>Remove</button>
            )}
          </span>
        </div>
      ))}
    </aside>
  );
}

/** Business cards you've collected, with export. */
export function CardsPanel({ cards, eventTitle, onClose }: { cards: Card[]; eventTitle: string; onClose: () => void }) {
  const download = (name: string, type: string, body: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const vcf = () =>
    cards
      .map((c) => {
        const esc = (v: string) => v.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, ' ');
        const email = /@/.test(c.contact) && !/\s/.test(c.contact) ? `EMAIL:${esc(c.contact)}\n` : '';
        const url = /^https?:\/\//.test(c.contact) ? `URL:${esc(c.contact)}\n` : '';
        const note = `NOTE:Met at ${esc(eventTitle)} on Mingle${c.tag ? `. Ask them about ${esc(c.tag)}` : ''}${!email && !url && c.contact ? `. ${esc(c.contact)}` : ''}\n`;
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${esc(c.name)}\n${email}${url}${note}END:VCARD`;
      })
      .join('\n');
  const csv = () => {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return ['Name,Contact,Ask me about,Met at,When', ...cards.map((c) => [c.name, c.contact, c.tag, eventTitle, new Date(c.at).toISOString()].map(q).join(','))].join('\n');
  };
  return (
    <aside className="host-panel world-panel" aria-label="Business cards">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Cards ({cards.length})</h3>
        <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="small muted">Stand near someone and press <kbd>E</kbd> to give them your card. Cards people give you land here.</p>
      {cards.map((c) => (
        <div className="card-row" key={c.id}>
          <strong>{c.name}</strong>
          {c.tag && <div className="small muted">Ask me about {c.tag}</div>}
          {c.contact && <div className="small">{c.contact}</div>}
        </div>
      ))}
      {cards.length > 0 && (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button className="btn btn-sm" onClick={() => download('mingle-contacts.vcf', 'text/vcard', vcf())}>Download vCards</button>
          <button className="btn btn-sm" onClick={() => download('mingle-contacts.csv', 'text/csv', csv())}>Download CSV</button>
        </div>
      )}
    </aside>
  );
}

/** Full-size editor for a pod whiteboard. Strokes are shared with everyone in the venue. */
export function BoardEditor(props: {
  board: PodId;
  label: string;
  /** Bumps whenever the board changes, so we repaint. */
  rev: number;
  paintInto: (canvas: HTMLCanvasElement) => void;
  onStroke: (s: Stroke) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PEN_COLORS[0]!);
  const [width, setWidth] = useState(6);
  const drawing = useRef<Stroke | null>(null);
  const { paintInto, rev } = props;

  useEffect(() => {
    const c = canvasRef.current;
    if (c && !drawing.current) paintInto(c);
  }, [paintInto, rev]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 1000)].map((n) => Math.min(1000, Math.max(0, n)));
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { b: props.board, c: color, w: width, p: point(e) };
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = drawing.current;
    if (!s) return;
    const [x, y] = point(e);
    const lx = s.p[s.p.length - 2]!;
    const ly = s.p[s.p.length - 1]!;
    if (Math.hypot(x! - lx, y! - ly) < 4) return;
    s.p.push(x!, y!);
    // Draw the new segment straight away for a responsive pen.
    paintStroke(e.currentTarget.getContext('2d')!, { ...s, p: [lx, ly, x!, y!] }, BOARD_W, BOARD_H);
    if (s.p.length > 1800) up();
  };
  const up = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s) props.onStroke(s);
  };

  return (
    <div className="board-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="board-card">
        <div className="row spread">
          <strong>{props.label} whiteboard</strong>
          <span className="small muted">Everyone sees what you draw</span>
        </div>
        <canvas ref={canvasRef} width={BOARD_W} height={BOARD_H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Whiteboard: draw with the mouse" />
        <div className="board-tools">
          {PEN_COLORS.map((c) => (
            <button key={c} className={`board-swatch ${c === color ? 'selected' : ''}`} style={{ background: c }} aria-label={`Pen ${c}`} onClick={() => setColor(c)} />
          ))}
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Pen size">
            <option value={4}>Fine</option>
            <option value={6}>Medium</option>
            <option value={14}>Marker</option>
            <option value={36}>Highlighter</option>
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={props.onClear}>Wipe board</button>
          <button className="btn btn-sm btn-primary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
