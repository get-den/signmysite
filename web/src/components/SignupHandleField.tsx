import { useEffect, useRef, useState } from "react";
import { checkHandle } from "../api";
import { normHandle, SIGNUP_HANDLE_KEY } from "../lib";
import { Spinner } from "../ui";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "bad"; reason: string };

function storedHandle(): string {
  try { return localStorage.getItem(SIGNUP_HANDLE_KEY) || ""; } catch { return ""; }
}

export function SignupHandleField() {
  const [handle, setHandle] = useState(storedHandle);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    try {
      if (handle) localStorage.setItem(SIGNUP_HANDLE_KEY, handle);
      else localStorage.removeItem(SIGNUP_HANDLE_KEY);
    } catch { /* ignore */ }
  }, [handle]);

  useEffect(() => {
    const h = handle;
    if (!h) return setCheck({ state: "idle" });
    if (h.length < 3) return setCheck({ state: "bad", reason: "At least 3 characters." });
    setCheck({ state: "checking" });
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await checkHandle(h);
        if (my !== seq.current) return;
        setCheck(r.available ? { state: "ok" } : { state: "bad", reason: r.reason || "Already taken." });
      } catch {
        if (my === seq.current) setCheck({ state: "idle" });
      }
    }, 320);
    return () => clearTimeout(t);
  }, [handle]);

  return (
    <div className="signup-handle-wrap">
      <div className={"signup-handle " + check.state}>
        <span className="signup-prefix">@</span>
        <input
          value={handle}
          onChange={(e) => setHandle(normHandle(e.target.value))}
          placeholder="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Username"
        />
        <span className="signup-tick">
          {check.state === "checking" ? <Spinner /> : check.state === "ok" ? "✓" : check.state === "bad" ? "✕" : ""}
        </span>
      </div>
      {check.state === "bad" && <div className="signup-msg bad">{check.reason}</div>}
      {check.state === "ok" && <div className="signup-msg ok">@{handle} is available.</div>}
    </div>
  );
}
