import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, updateProfile, uploadAvatar } from "../api";
import { ownProfilePath, squareImage } from "../lib";
import { Avatar, Button, PageHead } from "../ui";
import { LinksEditor } from "../components/LinksEditor";
import { FeedLayout } from "../home/FeedLayout";
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
    links: viewer?.links ?? [],
  });
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!viewer) return null;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // Upload happens immediately (not on Save): resize on a canvas, POST the bytes,
  // then swap in the returned cacheable URL. We merge it onto the viewer rather
  // than replacing the object — so we don't drop fields the upload omits (onboarded).
  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file || !viewer) return; // narrow viewer for the merge below
    setUploading(true);
    setStatus("");
    try {
      const updated = await uploadAvatar(await squareImage(file));
      setForm((f) => ({ ...f, avatar: updated.avatar ?? "" }));
      setViewer({ ...viewer, avatar: updated.avatar ?? null });
      toast("Photo updated");
    } catch {
      setStatus("Couldn't upload that image. Try a JPEG, PNG, or WebP.");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const updated = await updateProfile(form);
      setViewer(updated);
      toast("Saved");
      navigate(ownProfilePath(updated));
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? "That username is taken." : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <FeedLayout viewer={viewer}>
    <div className="settings-page">
      <PageHead title="Settings" />
      <div className="narrow">
      <form onSubmit={save}>
        <div className="field">
          <label>Photo</label>
          <div className="avatar-edit">
            <Avatar of={{ name: form.name, handle: form.handle, avatar: form.avatar }} />
            <div className="avatar-edit-actions">
              <Button className="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                {form.avatar ? "Change photo" : "Upload photo"}
              </Button>
              <span className="hint">A square photo works best: JPEG, PNG, or WebP.</span>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickAvatar} />
          </div>
        </div>
        <Field label="Name" value={form.name} onChange={set("name")} />
        <div className="field">
          <label htmlFor="username">Username</label>
          <div className="field-affix">
            <span className="affix">@</span>
            <input
              id="username"
              value={form.handle}
              onChange={set("handle")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>
        <Field
          label="Your site URL"
          value={form.url}
          onChange={set("url")}
          placeholder="https://you.example"
          hint="Change this and you'll need to re-verify your site."
        />
        <div className="field">
          <label>Social links</label>
          <LinksEditor value={form.links} onChange={(links) => setForm((f) => ({ ...f, links }))} />
          <p className="field-hint">Instagram, X, LinkedIn, GitHub, wherever else you are.</p>
        </div>
        <div className="field">
          <label>Account</label>
          <div className="acct">
            <span className="tag">{viewer.authMethod === "google" ? "Signed in with Google" : "Signed in with an email link"}</span>
          </div>
          <span className="hint">This is how you sign in. Your email stays private.</span>
        </div>
        <div className="row">
          <Button className="primary" type="submit" loading={saving}>Save</Button>
          <Link className="btn" to={ownProfilePath(viewer)}>Cancel</Link>
          <span className="formerr">{status}</span>
        </div>
      </form>
      </div>
    </div>
    </FeedLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={onChange} placeholder={placeholder} />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
