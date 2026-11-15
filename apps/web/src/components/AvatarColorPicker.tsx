import { AVATAR_COLORS, type AvatarLook, cleanLook, DEFAULT_LOOK, PROPS } from '../world/avatar';

const KEY = 'mingle.avatarColor';

export function savedAvatarColor(): string {
  try {
    const c = localStorage.getItem(KEY);
    if (c && AVATAR_COLORS.includes(c)) return c;
  } catch {
    /* storage can be blocked */
  }
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

/** Pick the colour of your avatar's hoodie. */
export function AvatarColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Avatar colour">
      <span className="small muted">Hoodie colour</span>
      <div className="row" style={{ gap: '0.4rem' }}>
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={c}
            className={`swatch ${c === value ? 'selected' : ''}`}
            style={{ background: c }}
            onClick={() => {
              onChange(c);
              try {
                localStorage.setItem(KEY, c);
              } catch {
                /* ignore */
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

const PROFILE_KEY = 'mingle.profile';

export interface ProfileInput {
  tag: string;
  contact: string;
  /** "Here to…": what you want out of the event. Drives matchmaking. */
  goal: string;
  look: AvatarLook;
}

export function savedProfile(): ProfileInput {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return { tag: str(p.tag), contact: str(p.contact), goal: str(p.goal), look: cleanLook(p.look) };
  } catch {
    return { tag: '', contact: '', goal: '', look: DEFAULT_LOOK };
  }
}

function persist(p: ProfileInput) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Your name tag ("Ask me about…" and "Here to…"), your business card, and how
 * your avatar looks.
 */
export function ProfileFields({ value, onChange }: { value: ProfileInput; onChange: (p: ProfileInput) => void }) {
  const set = (p: ProfileInput) => {
    onChange(p);
    persist(p);
  };
  const setLook = (look: Partial<AvatarLook>) => set({ ...value, look: { ...value.look, ...look } });
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label style={{ flex: 1, minWidth: 180 }}>
          Ask me about… <span className="muted small">(on your name tag)</span>
          <input value={value.tag} maxLength={60} placeholder="e.g. climate tech, hiring, sourdough" onChange={(e) => set({ ...value, tag: e.target.value })} />
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          Here to… <span className="muted small">(we'll suggest people to meet)</span>
          <input value={value.goal} maxLength={60} placeholder="e.g. find a designer, learn about funding" onChange={(e) => set({ ...value, goal: e.target.value })} />
        </label>
      </div>
      <label>
        Business card <span className="muted small">(optional)</span>
        <input value={value.contact} maxLength={120} placeholder="Email or LinkedIn URL" onChange={(e) => set({ ...value, contact: e.target.value })} />
      </label>
      <details className="avatar-details">
        <summary className="small">Customise your avatar</summary>
        <div className="avatar-style" style={{ marginTop: '0.5rem' }}>
          <label className="small">
            Height
            <input type="range" min={0.9} max={1.1} step={0.02} value={value.look.height} onChange={(e) => setLook({ height: Number(e.target.value) })} />
          </label>
          <label className="small">
            Build
            <input type="range" min={0.8} max={1.2} step={0.02} value={value.look.build} onChange={(e) => setLook({ build: Number(e.target.value) })} />
          </label>
          <label className="small">
            Telly
            <select value={value.look.tv} onChange={(e) => setLook({ tv: e.target.value as AvatarLook['tv'] })}>
              <option value="crt">Retro CRT</option>
              <option value="flat">Slim flat screen</option>
            </select>
          </label>
          <label className="small">
            Conversation starter
            <select value={value.look.prop} onChange={(e) => setLook({ prop: e.target.value as AvatarLook['prop'] })}>
              {PROPS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </>
  );
}
