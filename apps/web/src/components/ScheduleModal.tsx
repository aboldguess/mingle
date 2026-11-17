import { useState, type FormEvent } from 'react';
import { api, type Meeting } from '../api';

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleModal({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: (m: Meeting) => void }) {
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const [form, setForm] = useState({
    title: '',
    description: '',
    start: toLocalInput(nextHour),
    durationMinutes: 30,
    allowGuests: true,
    waitingRoom: false,
    muteOnEntry: false,
    presenters: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { meeting } = await api<{ meeting: Meeting }>(`/orgs/${orgId}/meetings`, {
        body: {
          title: form.title,
          description: form.description || null,
          scheduledStart: new Date(form.start).toISOString(),
          durationMinutes: form.durationMinutes,
          allowGuests: form.allowGuests,
          waitingRoom: form.waitingRoom,
          muteOnEntry: form.muteOnEntry,
          presenterEmails: form.presenters.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
        },
      });
      onCreated(meeting);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal stack" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Schedule an event">
        <h2>Schedule an event</h2>
        {error && <div className="error">{error}</div>}
        <label>Title<input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Friday mixer, All-hands keynote…" /></label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <label style={{ flex: 2 }}>Starts<input type="datetime-local" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label style={{ flex: 1 }}>
            Duration
            <select value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </div>
        <label>Description<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>
          Presenters <span className="muted small">(optional: emails, comma separated)</span>
          <input value={form.presenters} onChange={(e) => setForm({ ...form, presenters: e.target.value })} placeholder="speaker@example.com, panelist@example.com" />
          <span className="small muted">When set, the stage is roped off: only these people (signed in with that email) and hosts can go up to the podium.</span>
        </label>
        <label className="check"><input type="checkbox" checked={form.allowGuests} onChange={(e) => setForm({ ...form, allowGuests: e.target.checked })} />Allow guests without an account</label>
        <label className="check"><input type="checkbox" checked={form.waitingRoom} onChange={(e) => setForm({ ...form, waitingRoom: e.target.checked })} />Queue at the door for people outside the team</label>
        <label className="check"><input type="checkbox" checked={form.muteOnEntry} onChange={(e) => setForm({ ...form, muteOnEntry: e.target.checked })} />Mute people when they arrive</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Schedule</button>
        </div>
      </form>
    </div>
  );
}
