export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type Role = 'owner' | 'admin' | 'member';

export interface Me {
  user: { id: string; email: string; name: string };
  orgs: Array<{ id: string; name: string; slug: string; plan: string; role: Role }>;
  isPlatformAdmin: boolean;
}

export interface Meeting {
  id: string;
  orgId: string;
  hostId: string | null;
  hostName?: string | null;
  code: string;
  title: string;
  description: string | null;
  scheduledStart: string | null;
  durationMinutes: number;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  allowGuests: boolean;
  waitingRoom: boolean;
  muteOnEntry: boolean;
  joinUrl: string;
}

export interface PlanInfo {
  id: 'free' | 'pro' | 'business';
  name: string;
  maxParticipants: number;
  maxMeetingMinutes: number;
  maxMembers: number;
  monthlyPriceUsd: number;
  features: string[];
}

export interface OrgDetails {
  org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    effectivePlan: PlanInfo['id'];
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    membersOnlyMeetings: boolean;
  };
  role: Role;
  limits: Omit<PlanInfo, 'id'>;
  usage: { members: number };
  billingEnabled: boolean;
}

export interface JoinResult {
  status: 'admitted';
  token: string;
  serverUrl: string;
  isHost: boolean;
  identity: string;
  muteOnEntry: boolean;
  planLimitEndsAt: string | null;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return 'Anytime';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Build an .ics calendar file for a meeting so people can add it to Outlook/Google/Apple calendars. */
export function buildIcs(m: Pick<Meeting, 'title' | 'description' | 'scheduledStart' | 'durationMinutes' | 'joinUrl' | 'code'>): string {
  const start = m.scheduledStart ? new Date(m.scheduledStart) : new Date();
  const end = new Date(start.getTime() + m.durationMinutes * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const description = `${m.description ? `${m.description}\n\n` : ''}Join with Mingle: ${m.joinUrl}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mingle//Meetings//EN',
    'BEGIN:VEVENT',
    `UID:${m.code}@mingle`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(m.title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(m.joinUrl)}`,
    `URL:${m.joinUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
