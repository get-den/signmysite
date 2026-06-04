/*
 * Directory ("Index") — the opposite of Gallery: not one image anywhere, just
 * type. Your whole graph as a clean printed index — the sites you follow, the
 * people reading you, your crew, a few to discover — each a single line you can
 * scan and jump from. When you don't want to browse pictures, you want to find a
 * name. Tabular, quiet, dense but unhurried. (Named Directory to avoid colliding
 * with index.tsx on case-insensitive filesystems; the layout label is "Index".)
 */
import type { ReactNode } from "react";
import type { ViewerVisit } from "../api";
import { compact, host, profileHref, relTime } from "../lib";
import type { HomeData } from "./data";

export function Directory({ data }: { data: HomeData }) {
  const { following, analytics, crews, discovery, followBack } = data;
  const readers = analytics?.recent ?? [];

  return (
    <div className="index">
      <Section title="Following" count={following.length}>
        {following.map((s) => (
          <Row
            key={s.id} href={profileHref(s)}
            name={s.name} sub={s.handle ? `@${s.handle}` : host(s.url || "")}
            right={s.isNew ? "new" : s.lastEdited ? relTime(s.lastEdited) : ""}
            fresh={s.isNew}
          />
        ))}
      </Section>

      <Section title="Reading you" count={readers.length}>
        {readers.map((r) => <ReaderLine key={r.id} r={r} onFollow={() => followBack(r)} />)}
      </Section>

      {crews && crews.length > 0 && (
        <Section title="Your crew" count={crews.length}>
          {crews.map((c) => (
            <Row key={c.id} name={c.name} sub={`${c.memberCount} ${c.memberCount === 1 ? "site" : "sites"}`}
                 right={c.role === "owner" ? "you own this" : "member"} />
          ))}
        </Section>
      )}

      <Section title="Discover" count={discovery.recommended.length}>
        {discovery.recommended.map((s) => (
          <Row key={s.id} href={profileHref(s)} name={s.name}
               sub={s.handle ? `@${s.handle}` : host(s.url || "")} right={s.reason || ""} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="ix-section">
      <div className="ix-head"><h2>{title}</h2><span className="ix-count">{count}</span></div>
      <div className="ix-rows">{children}</div>
    </section>
  );
}

function Row({ href, name, sub, right, fresh }: {
  href?: string; name: string; sub?: string; right?: string; fresh?: boolean;
}) {
  const inner = (
    <>
      <span className="ix-name">{name}{fresh && <span className="ix-new" aria-hidden="true" />}</span>
      {sub && <span className="ix-sub">{sub}</span>}
      {right && <span className="ix-right">{right}</span>}
    </>
  );
  return href ? <a className="ix-row" href={href}>{inner}</a> : <div className="ix-row">{inner}</div>;
}

// A reader line carries an inline follow-back, so the name still links to their
// profile while the action stays separate.
function ReaderLine({ r, onFollow }: { r: ViewerVisit; onFollow: () => void }) {
  return (
    <div className="ix-row ix-row-split">
      <a className="ix-id" href={r.handle ? `/@${r.handle}` : r.url || "#"}>
        <span className="ix-name">{r.name || `@${r.handle ?? "someone"}`}</span>
        <span className="ix-sub">{r.handle ? `@${r.handle}` : host(r.url || "")}</span>
      </a>
      <span className="ix-right">
        <span className="ix-stat">{r.views > 1 ? `${compact(r.views)} reads` : "1 read"}</span>
        {r.viewerFollows
          ? <span className="ix-tag">following</span>
          : <button type="button" className="ix-act" onClick={onFollow}>Follow back</button>}
      </span>
    </div>
  );
}
