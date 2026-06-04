/*
 * Stream — "Signals." Everything that happened around your site as one thread you
 * read top to bottom: who read you, who left a note, which followed sites changed.
 * A single continuous spine runs down the page; each signal is a dot on it, and
 * the ones that want a response (a reader you don't follow back, a note to reply
 * to) carry their action inline. The job is triage — clear the thread, stay in sync.
 */
import { useMemo, useState } from "react";
import { isReaction, profileHref, relTime } from "../lib";
import { Avatar } from "../ui";
import type { HomeEvent, HomeData } from "./data";
import { FollowBtn, Hint } from "./parts";

type Filter = "all" | "people" | "notes";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["people", "People"], ["notes", "Notes"]];

// Day buckets, so the thread reads "Today / This week / Earlier" instead of a
// flat wall of timestamps.
function bucket(at: string): string {
  const t = Date.parse(at);
  if (!t) return "Earlier";
  const days = (Date.now() - t) / 864e5;
  return days < 1 ? "Today" : days < 7 ? "This week" : "Earlier";
}

export function Stream({ data }: { data: HomeData }) {
  const { events, unfollowedReaders, followBack } = data;
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(
    () => events.filter((e) => filter === "all" || (filter === "people" ? e.kind === "read" : e.kind === "note")),
    [events, filter],
  );
  const weekCount = useMemo(() => events.filter((e) => bucket(e.at) !== "Earlier").length, [events]);

  return (
    <div className="stream">
      <header className="stream-top">
        <div>
          <h1 className="stream-title">Signals</h1>
          <p className="stream-sub">
            {weekCount > 0 ? `${weekCount} this week` : "What happens around your site lands here"}
            {unfollowedReaders.length > 0 ? ` · ${unfollowedReaders.length} to follow back` : ""}
          </p>
        </div>
        <div className="stream-filter" role="tablist" aria-label="Filter signals">
          {FILTERS.map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={filter === id}
              className={"stream-filter-btn" + (filter === id ? " on" : "")}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {shown.length ? (
        <ol className="thread">
          {shown.map((e, i) => {
            const b = bucket(e.at);
            const firstOfBucket = i === 0 || bucket(shown[i - 1].at) !== b;
            return (
              <li key={key(e, i)} className="thread-item">
                {firstOfBucket && <div className="thread-bucket">{b}</div>}
                <Signal e={e} onFollow={followBack} />
              </li>
            );
          })}
        </ol>
      ) : (
        <Hint>
          {filter === "notes"
            ? "No notes yet. When someone writes on your site, it shows up here."
            : filter === "people"
              ? "No Den readers yet. Share your site and the people who open it appear here."
              : "All quiet. Reads, notes and updates from sites you follow will stream in here."}
        </Hint>
      )}
    </div>
  );
}

function key(e: HomeEvent, i: number): string {
  if (e.kind === "read") return "r" + e.who.id;
  if (e.kind === "note") return "n" + e.note.id;
  return "u" + e.site.id + i;
}

function Signal({ e, onFollow }: { e: HomeEvent; onFollow: HomeData["followBack"] }) {
  if (e.kind === "read") {
    const w = e.who;
    const needs = !w.viewerFollows;
    return (
      <div className={"signal" + (needs ? " signal-hot" : "")}>
        <span className="signal-dot" aria-hidden="true" />
        <a className="signal-who" href={profileHref(w)}>
          <Avatar of={w} />
          <span className="signal-body">
            <span className="signal-line"><b>{w.name || `@${w.handle ?? "Someone"}`}</b> read your site</span>
            <span className="signal-meta">{w.views > 1 ? `${w.views} times · ` : ""}{relTime(w.lastSeen)}</span>
          </span>
        </a>
        <FollowBtn who={w} onFollow={onFollow} />
      </div>
    );
  }
  if (e.kind === "note") {
    const a = e.note.author;
    const react = isReaction(e.note.body) ? e.note.body.trim() : "";
    const href = a.handle ? `/@${a.handle}` : "/messages";
    return (
      <div className="signal">
        <span className="signal-dot" aria-hidden="true" />
        <a className="signal-who" href={href}>
          <Avatar of={a} />
          <span className="signal-body">
            <span className="signal-line">
              <b>{a.name || "Someone"}</b> {react ? <>reacted <span className="signal-react">{react}</span></> : "left a note"}
            </span>
            {!react && <span className="signal-note">{e.note.visibility === "private" ? "Private note" : e.note.body}</span>}
            <span className="signal-meta">{relTime(e.note.created)}</span>
          </span>
        </a>
        {a.handle && <a className="signal-reply" href={`/@${a.handle}`}>Reply</a>}
      </div>
    );
  }
  const s = e.site;
  return (
    <div className="signal">
      <span className="signal-dot" aria-hidden="true" />
      <a className="signal-who" href={s.url || `/@${s.handle}`} target={s.url ? "_blank" : undefined} rel="noopener">
        <Avatar of={s} />
        <span className="signal-body">
          <span className="signal-line"><b>{s.name}</b> updated their site</span>
          <span className="signal-meta">{s.lastEdited ? relTime(s.lastEdited) : "recently"}</span>
        </span>
      </a>
      <span className="signal-reply" aria-hidden="true">Open →</span>
    </div>
  );
}
