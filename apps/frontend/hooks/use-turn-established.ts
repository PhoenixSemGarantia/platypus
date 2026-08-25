import { useState } from "react";
import type { ChatStatus } from "ai";
import { useResetOnChange } from "@/hooks/use-reset-on-change";

/**
 * Whether the current Chat turn's stream ever started arriving.
 *
 * The one thing that tells a dropped connection from a request the server never
 * took: a turn that got bytes passed through `streaming` on its way to `error`,
 * and one that was refused went from `submitted` straight to `error`. Without
 * it, a rejected attachment and a backgrounded tab look identical from the
 * client — both are just an error on the chat hook (issue #648).
 *
 * Reset at each submit, so the answer is about the turn in hand rather than an
 * earlier one. Kept in state adjusted during render rather than a ref written
 * in an effect: the classification is read on the very render the error appears,
 * and a ref would still be holding the previous render's value by then.
 */
export const useTurnEstablished = (status: ChatStatus): boolean => {
  const [established, setEstablished] = useState(false);

  useResetOnChange(status, () => {
    if (status === "submitted") setEstablished(false);
    else if (status === "streaming") setEstablished(true);
  });

  return established;
};
