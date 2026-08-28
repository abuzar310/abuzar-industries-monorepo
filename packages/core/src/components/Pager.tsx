"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Same size as Quotations. */
export const PAGE = 15;

export function usePager<T>(items: T[], size = PAGE, resetKey: string | number = "") {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size) || 1);
  const pageN = Math.min(page, pages - 1);
  const view = items.slice(pageN * size, pageN * size + size);
  return { page: pageN, pages, view, setPage, total: items.length };
}

/** Slice a list and put Prev / 1 2 … Next under the rendered block. */
export function Paged<T>({
  items,
  size = PAGE,
  resetKey = "",
  children,
}: {
  items: T[];
  size?: number;
  resetKey?: string | number;
  children: (view: T[], info: { page: number; pages: number; total: number }) => ReactNode;
}) {
  const pg = usePager(items, size, resetKey);
  return (
    <>
      {children(pg.view, { page: pg.page, pages: pg.pages, total: pg.total })}
      <Pager page={pg.page} pages={pg.pages} total={pg.total} onPage={pg.setPage} />
    </>
  );
}

function pageNums(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const out: (number | "…")[] = [0];
  const lo = Math.max(1, page - 1);
  const hi = Math.min(pages - 2, page + 1);
  if (lo > 1) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 2) out.push("…");
  out.push(pages - 1);
  return out;
}

export default function Pager({
  page,
  pages,
  onPage,
  total,
}: {
  page: number;
  pages: number;
  onPage: (n: number) => void;
  total?: number;
}) {
  if (pages <= 1) return null;
  const go = (n: number) => {
    onPage(n);
    const nav = document.activeElement?.closest(".pager");
    const list = nav?.previousElementSibling as HTMLElement | null;
    (list || nav)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <nav className="pager no-print" aria-label="Pages">
      <button type="button" className="btn sm" disabled={page === 0} onClick={() => go(page - 1)}>
        ‹ Prev
      </button>
      <div className="pager-nums">
        {pageNums(page, pages).map((n, i) =>
          n === "…" ? (
            <span key={"g" + i} className="pager-gap">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={"pager-n" + (n === page ? " on" : "")}
              aria-current={n === page ? "page" : undefined}
              onClick={() => go(n)}
            >
              {n + 1}
            </button>
          ),
        )}
      </div>
      <span className="pager-meta">
        Page {page + 1} of {pages}
        {total != null ? " · " + total : ""}
      </span>
      <button type="button" className="btn sm" disabled={page >= pages - 1} onClick={() => go(page + 1)}>
        Next ›
      </button>
    </nav>
  );
}
