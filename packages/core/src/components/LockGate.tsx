"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/useApp";
import { USERS, unlock } from "@/lib/local-auth";
import { brandFor } from "@/lib/brand";
import { afterUnlock } from "@/store/session";

export default function LockGate() {
  const { ready, user, brandMode } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (picked) setTimeout(() => passRef.current?.focus(), 40);
  }, [picked]);

  // Cover + blur the app from the first paint until a user unlocks — never flash content.
  if (user) return null;

  const brand = brandFor(brandMode);
  const pickedUser = USERS.find((u) => u.id === picked);

  async function submit() {
    if (!picked) return;
    setErr("Checking…");
    const ok = await unlock(picked, pass);
    if (ok) {
      setErr("");
      setPass("");
      afterUnlock();
    } else {
      setErr("Wrong password");
    }
  }

  return (
    <div className="lock-gate">
      <div className="lock-card">
        <div className="lock-brand">
          {brand.name}
          <span>{brand.tagline}</span>
        </div>

        {!ready ? (
          <p className="lock-sub">Loading…</p>
        ) : !picked ? (
          <>
            <p className="lock-sub">Who&apos;s signing in?</p>
            <div className="lock-users">
              {USERS.map((u) => (
                <button key={u.id} className="lock-user" onClick={() => setPicked(u.id)}>
                  <span className="lock-avatar">{u.name.charAt(0)}</span>
                  <b>{u.name}</b>
                  <small>{u.role === "owner" ? "Owner" : "Manager"}</small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="lock-sub">
              <button className="lock-back" onClick={() => { setPicked(null); setErr(""); setPass(""); }}>
                ‹
              </button>
              Signing in as <b>{pickedUser?.name}</b>
            </p>
            <input
              ref={passRef}
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <div className="login-err">{err}</div>
            <button className="btn primary" onClick={submit}>
              Unlock
            </button>
          </>
        )}
      </div>
    </div>
  );
}
