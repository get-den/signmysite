/*
 * Orbit — "Your signmysite." The home as your place in the graph rather than a dashboard.
 * You sit at the center; the people around you ring outward — your crew close in,
 * the readers who found you this week further out. It's identity-forward and a
 * little playful (this is a product kids use), and it makes one thing legible at a
 * glance: your corner of the web is inhabited. Follow a reader back and they move
 * from the outer ring into your circle. The job is belonging.
 */
import { useState } from "react";
import type { Cohort } from "../api";
import { compact, profileHref } from "../lib";
import { Avatar, Button, Tip, useCopy } from "../ui";
import type { HomeData } from "./data";
import { FollowBtn, Hint } from "./parts";

/** The minimal identity a ring face needs — satisfied by readers and crew alike. */
type Face = { name?: string | null; handle?: string | null; avatar?: string | null; url?: string | null };

// A face on a ring: placed by angle (radians) at a % radius from center. The
// outer ring fans readers across the top arc; the inner ring seats your crew.
function Satellite({
  of, angle, radius, hot, delay,
}: {
  of: Face; angle: number; radius: number; hot?: boolean; delay: number;
}) {
  const left = 50 + radius * Math.cos(angle);
  const top = 50 + radius * Math.sin(angle);
  return (
    <Tip label={of.name || `@${of.handle ?? "someone"}`}>
      <a
        className={"sat" + (hot ? " sat-hot" : "")}
        href={profileHref(of)}
        style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}ms` }}
        aria-label={of.name || undefined}
      >
        <Avatar of={of} />
      </a>
    </Tip>
  );
}

export function Orbit({ data }: { data: HomeData }) {
  const { viewer, stats, analytics, unfollowedReaders, crews, followBack } = data;
  const readers = (analytics?.recent ?? []).slice(0, 9);
  const crew = crews && crews.length ? crews[0] : null;
  // Your own face is already the center — drop it from the crew ring.
  const inner = (crew?.faces ?? []).filter((f) => f.id !== viewer.id).slice(0, 6);

  // Outer ring: readers fanned across an arc (−145°…−35°-ish, biased to the top so
  // faces sit above the center label). Inner ring: crew, evenly spaced.
  const arc = (i: number, n: number, spread: number, offset: number) =>
    n <= 1 ? offset : offset + (i / (n - 1) - 0.5) * spread;

  return (
    <div className="orbit">
      <div className="orbit-stage" role="img" aria-label={`${viewer.name || "You"} and ${analytics?.knownVisitors ?? 0} signmysite readers`}>
        <div className="orbit-rings" aria-hidden="true"><span /><span /></div>

        {readers.map((r, i) => (
          <Satellite
            key={r.id} of={r} radius={43} delay={120 + i * 45}
            hot={!r.viewerFollows}
            angle={arc(i, readers.length, Math.PI * 1.15, -Math.PI / 2)}
          />
        ))}
        {inner.map((f, i) => (
          <Satellite
            key={f.id} of={f} radius={25} delay={80 + i * 45}
            angle={arc(i, inner.length, Math.PI * 1.1, Math.PI / 2)}
          />
        ))}

        <a className="orbit-me" href={viewer.handle ? `/@${viewer.handle}` : "#"} aria-label="Your profile">
          <Avatar of={viewer} />
        </a>
      </div>

      <div className="orbit-caption">
        <div className="orbit-name">{viewer.name || "You"}</div>
        <div className="orbit-reach">
          <b>{compact(stats?.views)}</b> reads
          <span className="dot" /> <b>{compact(stats?.followers)}</b> followers
          {analytics?.knownVisitors ? <><span className="dot" /> <b>{compact(analytics.knownVisitors)}</b> signmysite readers</> : null}
        </div>
      </div>

      <div className="orbit-legend">
        <section className="orbit-col">
          <div className="orbit-col-head">
            <h2>Reading you</h2>
            {analytics ? <span className="muted">{compact(analytics.knownVisitors)} from signmysite · 30 days</span> : null}
          </div>
          {unfollowedReaders.length ? (
            <ul className="reader-list reader-list-tight">
              {unfollowedReaders.slice(0, 5).map((who) => (
                <li className="reader" key={who.id}>
                  <a className="reader-id" href={profileHref(who)}>
                    <Avatar of={who} />
                    <span className="reader-meta">
                      <b>{who.name || `@${who.handle ?? "someone"}`}</b>
                      <span className="reader-sub">{who.views === 1 ? "read you" : `${compact(who.views)}x`}</span>
                    </span>
                  </a>
                  <FollowBtn who={who} onFollow={followBack} />
                </li>
              ))}
            </ul>
          ) : (
            <Hint>Everyone reading you is already in your circle.</Hint>
          )}
        </section>

        <CrewBlock crew={crew} makeCrew={data.makeCrew} />
      </div>
    </div>
  );
}

// A crew is the cold-start fix: one invite link that mutually follows a whole
// friend group. Here it's the inner ring's source — make one, or copy the link to
// fill it. Kept compact: the dashboard's full crew manager isn't the point here.
function CrewBlock({ crew, makeCrew }: { crew: Cohort | null; makeCrew: HomeData["makeCrew"] }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy(crew?.joinUrl ?? "");

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await makeCrew(name);
    setName("");
    setBusy(false);
  };

  return (
    <section className="orbit-col">
      <div className="orbit-col-head">
        <h2>Your crew</h2>
        <span className="muted">Everyone follows everyone</span>
      </div>
      {crew ? (
        <div className="crew-mini">
          <div className="crew-faces">
            {crew.faces.slice(0, 5).map((f) => <Avatar key={f.id} of={f} />)}
          </div>
          <div className="crew-mini-meta">
            <b>{crew.name}</b>
            <span className="muted">{crew.memberCount} {crew.memberCount === 1 ? "site" : "sites"}</span>
          </div>
          <Button className="sm" onClick={copy}>{copied ? "Copied" : "Copy invite"}</Button>
        </div>
      ) : (
        <div className="crew-create">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name a crew (e.g. our class)"
            maxLength={60}
            aria-label="Crew name"
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          />
          <Button className="primary" loading={busy} disabled={!name.trim()} onClick={create}>Create</Button>
        </div>
      )}
    </section>
  );
}
