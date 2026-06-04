/*
 * Command — "Type to do anything." The home as a single command bar. One focused
 * input drives everything: jump to anyone in your graph, follow a reader back, or
 * run an action (verify your site, copy your widget, open Notes). Arrow keys move,
 * Enter runs, Escape clears. It's the power-user home — and a fitting one for a
 * protocol meant to be driven by people and agents alike. Nothing on screen but an
 * input and the few things worth doing right now.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { compact, host } from "../lib";
import { Avatar } from "../ui";
import { useToast } from "../providers";
import type { HomeData } from "./data";

type Person = { id: string; name: string; handle: string | null; avatar: string | null; url: string | null };
type Item = { id: string; group: "Actions" | "Follow back" | "Jump to"; label: string; sub?: string; hint: string; person?: Person; run: () => void };

export function Command({ data }: { data: HomeData }) {
  const { viewer, following, discovery, crews, analytics, unfollowedReaders, followBack } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const widgetTag = `<script src="${location.origin}/w/${viewer.id.replace(/^den:/, "")}.js"></script>`;
  const copyWidget = () => {
    navigator.clipboard?.writeText(widgetTag).then(() => toast("Widget snippet copied")).catch(() => {});
  };

  // Everyone in your graph, de-duped — the "jump to" pool (readers you haven't
  // followed back are pulled out into their own group below).
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    const add = (p: Partial<Person> & { id?: string | null }) => {
      if (!p?.id || p.id === viewer.id || map.has(p.id)) return;
      map.set(p.id, { id: p.id, name: p.name || "", handle: p.handle ?? null, avatar: p.avatar ?? null, url: p.url ?? null });
    };
    following.forEach(add);
    discovery.recommended.forEach(add);
    (crews ?? []).forEach((c) => c.faces.forEach(add));
    (analytics?.recent ?? []).forEach(add);
    return [...map.values()];
  }, [following, discovery, crews, analytics, viewer.id]);

  const openPerson = (p: Person) => {
    if (p.handle) location.assign(`/@${p.handle}`);
    else if (p.url) window.open(p.url, "_blank", "noopener");
  };

  // The full command set, before filtering.
  const all = useMemo<Item[]>(() => {
    const actions: Item[] = [];
    if (viewer.url && !viewer.verified)
      actions.push({ id: "a-verify", group: "Actions", label: "Verify your site", sub: host(viewer.url), hint: "Open", run: () => navigate("/verify") });
    actions.push({ id: "a-notes", group: "Actions", label: "Open Notes", hint: "Open", run: () => navigate("/notes") });
    actions.push({ id: "a-messages", group: "Actions", label: "Open Messages", hint: "Open", run: () => navigate("/messages") });
    actions.push({ id: "a-widget", group: "Actions", label: "Copy your widget snippet", hint: "Copy", run: copyWidget });
    actions.push({ id: "a-edit", group: "Actions", label: "Edit your profile", hint: "Open", run: () => navigate("/edit") });
    if (viewer.handle)
      actions.push({ id: "a-site", group: "Actions", label: "View your site", sub: `@${viewer.handle}`, hint: "Open", run: () => location.assign(`/@${viewer.handle}`) });

    const back: Item[] = unfollowedReaders.map((r) => ({
      id: "f-" + r.id, group: "Follow back", label: r.name || `@${r.handle ?? "someone"}`,
      sub: r.views === 1 ? "read you" : `read you ${compact(r.views)}x`, hint: "Follow",
      person: r, run: () => followBack(r),
    }));

    const skip = new Set(unfollowedReaders.map((r) => r.id));
    const jump: Item[] = people.filter((p) => !skip.has(p.id)).map((p) => ({
      id: "j-" + p.id, group: "Jump to", label: p.name || `@${p.handle ?? "site"}`,
      sub: p.handle ? `@${p.handle}` : p.url ? host(p.url) : undefined, hint: "Open",
      person: p, run: () => openPerson(p),
    }));

    return [...actions, ...back, ...jump];
  }, [viewer, people, unfollowedReaders, followBack]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? all.filter((i) => (i.label + " " + (i.sub ?? "")).toLowerCase().includes(q))
      : all;
    // Keep the resting (empty-query) view tidy: all actions + a handful of each.
    if (q) return matched;
    const take = (g: Item["group"], n: number) => matched.filter((i) => i.group === g).slice(0, n);
    return [...take("Actions", 9), ...take("Follow back", 4), ...take("Jump to", 8)];
  }, [all, query]);

  useEffect(() => { setSel(0); }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === "Escape") { setQuery(""); }
  };

  // Keep the highlighted row in view as you arrow through.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return (
    <div className="cmd">
      <div className="cmd-bar">
        <span className="cmd-prompt" aria-hidden="true">›</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to someone, follow back, or run a command"
          aria-label="Command"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
        />
        <kbd className="cmd-kbd">esc</kbd>
      </div>

      <div className="cmd-list" ref={listRef} role="listbox">
        {items.length === 0 ? (
          <p className="home-hint">Nothing matches "{query.trim()}". Try a name, a handle, or a command.</p>
        ) : (
          items.map((it, i) => {
            const header = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
            return (
              <div key={it.id}>
                {header && <div className="cmd-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  data-i={i}
                  className={"cmd-row" + (i === sel ? " sel" : "")}
                  onMouseMove={() => setSel(i)}
                  onClick={() => it.run()}
                >
                  <span className="cmd-glyph">
                    {it.person ? <Avatar of={it.person} /> : <span className="cmd-action" aria-hidden="true">⌘</span>}
                  </span>
                  <span className="cmd-text">
                    <span className="cmd-label">{it.label}</span>
                    {it.sub && <span className="cmd-sub">{it.sub}</span>}
                  </span>
                  <span className="cmd-hint">{it.hint} <span className="cmd-enter" aria-hidden="true">↵</span></span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
