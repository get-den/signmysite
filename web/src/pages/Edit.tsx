import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, updateProfile } from "../api";
import { useToast, useViewer } from "../providers";

export function Edit() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: viewer?.name ?? "",
    handle: viewer?.handle ?? "",
    url: viewer?.url ?? "",
    avatar: viewer?.avatar ?? "",
    bio: viewer?.bio ?? "",
  });
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  if (!viewer) return null;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus("Saving…");
    try {
      const updated = await updateProfile(form);
      setViewer(updated);
      toast("Saved");
      navigate("/site");
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? "That handle is taken." : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="section">Edit profile</h2>
      <form onSubmit={save}>
        <Field label="Name" value={form.name} onChange={set("name")} />
        <Field label="Handle" value={form.handle} onChange={set("handle")} />
        <Field label="Your site URL" value={form.url} onChange={set("url")} placeholder="https://you.example" />
        <Field label="Avatar image URL" value={form.avatar} onChange={set("avatar")} placeholder="https://…/me.jpg" />
        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" value={form.bio} onChange={set("bio")} />
        </div>
        <div className="row">
          <button className="btn primary" type="submit" disabled={saving}>
            Save
          </button>
          <Link className="btn" to="/site">
            Cancel
          </Link>
          <span className="formerr">{status}</span>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}
