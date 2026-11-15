import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useOrg } from '../components/AppShell';

export function SettingsPage() {
  const { details, reload } = useOrg();
  const [name, setName] = useState(details.org.name);
  const [membersOnly, setMembersOnly] = useState(details.org.membersOnlyMeetings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/orgs/${details.org.id}`, { method: 'PATCH', body: { name, membersOnlyMeetings: membersOnly } });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <h1>Settings</h1>
      {error && <div className="error">{error}</div>}
      <div className="card stack">
        <label>Organisation name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="check">
          <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
          Members-only meetings: only signed-in members of this organisation can join any meeting
        </label>
        <div><button className="btn btn-primary">{saved ? 'Saved' : 'Save changes'}</button></div>
      </div>
    </form>
  );
}
