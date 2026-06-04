import { useState } from "react";
import { normalizeLink, socialLabel } from "../lib";
import { Button } from "../ui";

/**
 * Add/remove a member's social links — shared by onboarding and Edit profile.
 * Links are plain URLs; the platform label is derived per-URL (socialLabel), so
 * any site works and recognized ones (Instagram, X, …) read nicely. The parent
 * owns the array; this just edits it. Server re-validates on save.
 */
export function LinksEditor({
  value,
  onChange,
  max = 10,
}: {
  value: string[];
  onChange: (links: string[]) => void;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const url = normalizeLink(draft);
  const full = value.length >= max;

  function add() {
    if (!url || full) return;
    if (!value.includes(url)) onChange([...value, url]);
    setDraft(""); // clear whether it was new or a dupe — the input is ready for the next
  }

  return (
    <div className="links-edit">
      {value.length > 0 && (
        <ul className="link-list">
          {value.map((u) => (
            <li key={u} className="link-chip">
              <a className="link-name" href={u} target="_blank" rel="noopener noreferrer">{socialLabel(u)}</a>
              <button type="button" aria-label={`Remove ${socialLabel(u)}`} onClick={() => onChange(value.filter((x) => x !== u))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="link-add">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="instagram.com/you"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Add a social link"
          />
          <Button className="sm" onClick={add} disabled={!url}>Add</Button>
        </div>
      )}
    </div>
  );
}
