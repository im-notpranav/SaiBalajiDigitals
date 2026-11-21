import type { ComponentProps } from "react";
import { useRowLink } from "@/hooks/useRowLink";
import { cn } from "@/lib/utils";

/**
 * A table row that opens its record on a click anywhere in it. Links, buttons and boxes inside
 * keep their own click (see useRowLink).
 */
export function LinkRow({
  to,
  params,
  className,
  children,
  ...rest
}: { to: string; params: Record<string, string> } & ComponentProps<"tr">) {
  const linkProps = useRowLink();
  const { className: linkClass, ...handlers } = linkProps({ to, params });
  return (
    <tr {...rest} {...handlers} className={cn(className, linkClass)}>
      {children}
    </tr>
  );
}
