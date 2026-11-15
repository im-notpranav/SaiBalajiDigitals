import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

/** Where a clicked row goes: a route with its params, as a Link would take them. */
export interface RowLinkTarget {
  to: string;
  params: Record<string, string>;
}

/** Clicks on these keep their own meaning and never open the row. */
const OWN_CLICK =
  "a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='checkbox'], [role='switch'], [role='combobox'], [data-no-row-link]";

/**
 * Makes a whole table row (or card) open its record, not only its View button.
 *
 * A click opens the row unless it landed on a button, link or field inside it, the person was
 * selecting text, or it came from a dialog rendered elsewhere (React bubbles portal clicks).
 * Ctrl, Cmd, Shift or the middle button open it in a new tab, as they would on a link.
 * Keyboard users keep the row's own View link, so the row itself takes no focus.
 */
export function useRowLink() {
  const navigate = useNavigate();
  const router = useRouter();

  return useCallback(
    (target: RowLinkTarget | null | undefined) => {
      if (!target) return {};

      const ownClick = (e: MouseEvent<HTMLElement>) => {
        const el = e.target as HTMLElement | null;
        if (!el || !e.currentTarget.contains(el)) return true;
        const hit = el.closest(OWN_CLICK);
        if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return true;
        return !!window.getSelection()?.toString();
      };
      const openInNewTab = () => {
        const { href } = router.buildLocation({ to: target.to, params: target.params } as never);
        window.open(href, "_blank", "noopener");
      };

      return {
        className: "cursor-pointer",
        onClick: (e: MouseEvent<HTMLElement>) => {
          if (e.defaultPrevented || e.button !== 0 || ownClick(e)) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) return openInNewTab();
          navigate({ to: target.to, params: target.params } as never);
        },
        onAuxClick: (e: MouseEvent<HTMLElement>) => {
          if (e.button !== 1 || ownClick(e)) return;
          e.preventDefault();
          openInNewTab();
        },
      };
    },
    [navigate, router],
  );
}
