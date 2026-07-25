import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc" | null;

export function useSortableTable<T>(
  items: T[],
  defaultKey: keyof T & string,
  getValue: (item: T, key: keyof T & string) => string | number | Date,
) {
  const [sortKey, setSortKey] = useState<keyof T & string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const toggleSort = (key: keyof T & string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) {
      return [...items].sort((a, b) => {
        const av = getValue(a, defaultKey);
        const bv = getValue(b, defaultKey);
        if (av instanceof Date && bv instanceof Date) return bv.getTime() - av.getTime();
        if (typeof av === "number" && typeof bv === "number") return bv - av;
        return String(bv).localeCompare(String(av), undefined, { sensitivity: "base" });
      });
    }

    return [...items].sort((a, b) => {
      const av = getValue(a, sortKey);
      const bv = getValue(b, sortKey);
      let cmp = 0;
      if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir, defaultKey, getValue]);

  return { sorted, sortKey, sortDir, toggleSort };
}

export function SortableHead<T extends string = string>({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className = "",
}: {
  label: string;
  column: T;
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (col: T) => void;
  className?: string;
}) {
  const active = sortKey === column;
  const arrow = !active ? "↕" : sortDir === "asc" ? "↑" : "↓";
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${className}`}
    >
      {label} <span className="text-[10px] opacity-60">{arrow}</span>
    </button>
  );
}
