import { AVATAR_COLORS } from '../world/avatar';

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
