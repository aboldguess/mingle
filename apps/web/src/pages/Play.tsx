import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AvatarColorPicker, ProfileFields, savedAvatarColor, savedProfile } from '../components/AvatarColorPicker';
import { Logo } from '../components/Logo';
import { useSession } from '../session';
import { WorldView } from '../world/WorldView';

/** Solo demo: wander the venue with a crowd of bots, no account or server media needed. */
export function PlayPage() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.user.name ?? '');
  const [color, setColor] = useState(savedAvatarColor);
  const [playing, setPlaying] = useState(false);
  const [profile, setProfile] = useState(savedProfile);

  if (playing) {
    return <WorldView mode="solo" name={name.trim() || 'You'} color={color} profile={profile} title="Demo venue" onLeave={() => navigate('/')} />;
  }

  return (
    <div className="prejoin">
      <form
        className="card prejoin-card stack"
        onSubmit={(e) => {
          e.preventDefault();
          setPlaying(true);
        }}
      >
        <Logo />
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>Try the venue solo</h1>
          <p className="muted small" style={{ margin: 0 }}>
            A crowd of friendly bots is already mingling. Catch the keynote, swap business cards, and try the soundproof pods.
          </p>
        </div>
        <label>
          Your name
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="What should your name tag say?" autoFocus />
        </label>
        <ProfileFields value={profile} onChange={setProfile} />
        <AvatarColorPicker value={color} onChange={setColor} />
        <button className="btn btn-primary btn-lg" type="submit">Enter the venue</button>
        <p className="small muted" style={{ margin: 0 }}>
          Best on a computer with a keyboard and mouse. Want real people? <Link to={me ? '/app' : '/signup'}>Host an event</Link>.
        </p>
      </form>
    </div>
  );
}
