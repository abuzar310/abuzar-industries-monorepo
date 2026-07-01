"use client";
import { useState } from "react";
import { useApp } from "@/store/useApp";
import { setShowLogin, setSyncState } from "@/store/app-store";
import { doLogin } from "@/store/session";

export default function LoginGate() {
  const { showLogin, loginStrict } = useApp();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  if (!showLogin) return null;

  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const showSkip = !(loginStrict && online);

  async function submit() {
    setErr("Checking…");
    const msg = await doLogin(email, pass);
    setErr(msg);
    if (!msg) setPass("");
  }

  function onKey(e: React.KeyboardEvent, isEmail: boolean) {
    const ent = e.code === "Enter" || e.code === "NumpadEnter" || (!e.code && e.key === "Enter");
    if (!ent) return;
    e.preventDefault();
    if (isEmail && !pass) return; // let focus fall to password naturally
    submit();
  }

  return (
    <div className="login-gate">
      <div className="login-card">
        <h3>Abuzar Industries</h3>
        <p className="note">Sign in to access your data</p>
        <input
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => onKey(e, true)}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => onKey(e, false)}
        />
        <div className="login-err">{err}</div>
        <button className="btn primary" onClick={submit}>
          Sign in
        </button>
        {showSkip && (
          <button
            className="login-skip"
            onClick={() => {
              setShowLogin(false);
              setSyncState("queue");
            }}
          >
            Continue offline (this device only)
          </button>
        )}
      </div>
    </div>
  );
}
