/**
 * Matchmaking: pair what you're "here to" find with what others say
 * "ask me about", and the other way round. Plain keyword overlap with light
 * stemming: good enough to nudge people towards a useful conversation.
 */

const STOP = new Set(
  'a an the and or of to for in on at with about my me i we our your you is are be meet find looking look learn talk chat get some any more new people someone here into from by how what who'.split(' '),
);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

function stem(w: string) {
  return w.replace(/(ing|ers|er|es|s)$/, '') || w;
}

export interface MatchInput {
  id: string;
  name: string;
  tag?: string;
  goal?: string;
}

export interface Match {
  id: string;
  name: string;
  /** Why we matched, in words. */
  reason: string;
  score: number;
}

/** People worth meeting, best first. */
export function findMatches(me: { tag?: string; goal?: string }, others: MatchInput[]): Match[] {
  const myGoal = keywords(me.goal ?? '');
  const myTag = keywords(me.tag ?? '');
  const out: Match[] = [];
  for (const o of others) {
    const theyOffer = overlap(myGoal, keywords(o.tag ?? ''));
    const theyWant = overlap(myTag, keywords(o.goal ?? ''));
    const score = theyOffer * 2 + theyWant;
    if (!score) continue;
    const reason = theyOffer ? `can help with “${o.tag}”` : `is here to ${o.goal!.replace(/^here to\s+/i, '')}, and you know about ${me.tag}`;
    out.push({ id: o.id, name: o.name, reason, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

function overlap(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}
