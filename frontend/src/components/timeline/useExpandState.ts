import { useState } from 'react';

/**
 * Expand/collapse state for timeline cards.
 *
 * - `autoExpanded` is the state the card would pick on its own; it may change
 *   over time (e.g. a command collapses once it succeeds).
 * - `expanded` is an explicit user choice owned by the parent. Rows of the
 *   virtualized timeline unmount when scrolled away, so the parent has to keep
 *   the choice for it to survive.
 * - Without a parent, the user's choice is kept locally and still wins over
 *   `autoExpanded`.
 */
export function useExpandState(
  autoExpanded: boolean,
  expanded?: boolean,
  onExpandedChange?: (next: boolean) => void,
): [boolean, () => void] {
  const [localChoice, setLocalChoice] = useState<boolean | null>(null);
  const isExpanded = expanded ?? localChoice ?? autoExpanded;

  const toggle = () => {
    const next = !isExpanded;
    setLocalChoice(next);
    onExpandedChange?.(next);
  };

  return [isExpanded, toggle];
}
