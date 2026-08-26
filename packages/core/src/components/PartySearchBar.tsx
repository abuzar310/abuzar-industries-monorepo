"use client";

export default function PartySearchBar({
  value,
  onChange,
  placeholder,
  count,
  total,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
  total: number;
}) {
  return (
    <div className="searchbar party-search">
      <span className="s-ic" aria-hidden="true">
        ⌕
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value ? (
        <button type="button" className="s-clear" onClick={() => onChange("")} aria-label="Clear search">
          ×
        </button>
      ) : null}
      <span className="s-count">{value ? count + " / " + total : total}</span>
    </div>
  );
}
