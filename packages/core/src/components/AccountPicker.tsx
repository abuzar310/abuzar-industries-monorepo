"use client";

/** Tap-to-pick UPI account: chips for accounts used before + an inline field for a new one.
 *  `value` is the chosen account name (a chip value, or whatever is typed). */
export default function AccountPicker({
  value,
  onChange,
  accounts,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: string[];
}) {
  const known = accounts.includes(value.trim());
  return (
    <div className="acct-pick">
      {accounts.map((a) => (
        <button
          key={a}
          type="button"
          className={"acct-chip" + (value.trim() === a ? " on" : "")}
          onClick={() => onChange(a)}
        >
          {a}
        </button>
      ))}
      <input
        className="acct-new"
        placeholder={accounts.length ? "+ new account" : "account name (e.g. GPay / PhonePe)"}
        value={known ? "" : value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
