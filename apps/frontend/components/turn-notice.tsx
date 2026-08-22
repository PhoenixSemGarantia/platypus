import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The muted warning row for a per-turn notice about how an answer was produced
 * or how it ended — under a Chat reply, under a delegated Sub-Agent response,
 * and in Trigger run history.
 *
 * It carries the two cut-short notices — the output ceiling and the step
 * ceiling, never both of one turn — and the search-was-unavailable notice. A
 * Chat reply can show a cut-short row and the search row at once: how the reply
 * was produced, then how it ended.
 *
 * The row is shared; the wording is not. Each surface owns its own sentence as
 * an exported constant its tests assert against — the ceiling notices name
 * their subject ("Response", "Sub-Agent response", "Run") per surface.
 */
export const TurnNotice = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center gap-1.5 text-muted-foreground text-xs",
      className,
    )}
  >
    <TriangleAlertIcon className="size-3.5 shrink-0" />
    <span>{children}</span>
  </div>
);
