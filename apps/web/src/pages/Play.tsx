import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { savedAvatarColor, savedProfile } from '../components/AvatarColorPicker';
import { Logo } from '../components/Logo';
import { type JoinChoices, PreJoinStudio } from '../components/PreJoinStudio';
import { useSession } from '../session';
import { WorldView } from '../world/WorldView';

/** Solo demo: wander the venue with a crowd of bots, no account or server media needed. */
export function PlayPage() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [color, setColor] = useState(savedAvatarColor);
  const [choices, setChoices] = useState<JoinChoices | null>(null);
  const [profile, setProfile] = useState(savedProfile);

  if (choices) {
    return (
      <WorldView
        mode="solo"
        name={choices.username || 'You'}
        color={color}
        profile={profile}
        title="Demo venue"
        soloCamera={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : undefined}
        onLeave={() => navigate('/')}
      />
    );
  }

  return (
    <div className="prejoin">
      <div className="card prejoin-card prejoin-wide stack">
        <Logo />
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>Try the venue solo</h1>
          <p className="muted small" style={{ margin: 0 }}>
            A crowd of friendly bots is already mingling. Catch the keynote, swap business cards, and try the soundproof pods.
          </p>
        </div>
        <PreJoinStudio defaultName={me?.user.name ?? ''} color={color} onColor={setColor} profile={profile} onProfile={setProfile} joinLabel="Enter the venue" withMic={false} onJoin={setChoices} />
        <p className="small muted" style={{ margin: 0 }}>
          Best on a computer with a keyboard and mouse. Want real people? <Link to={me ? '/app' : '/signup'}>Host an event</Link>.
        </p>
      </div>
    </div>
  );
}
