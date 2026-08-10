import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";
import { s } from "../../styles";
import type { DropdownDefinition, DropdownOption } from "../lib/dropdowns";

interface DropdownMenuProps {
  definition: DropdownDefinition;
  selectedOptionId: string;
  anchorRect: Pick<DOMRect, "bottom" | "left" | "top">;
  focusKey: string;
  onSelect: (option: DropdownOption) => void;
  onEscape: () => void;
}

interface DropdownMenuPosition {
  top: number;
  left: number;
  maxHeight: number;
}

const menuGap = 4;
const viewportMargin = 8;

/** Calculates a viewport-safe position for the dropdown menu.
 *
 * @param anchorRect the chip's viewport rectangle.
 * @param menuRect the measured menu rectangle.
 * @param viewportWidth the owner document viewport width.
 * @param viewportHeight the owner document viewport height.
 * @returns the fixed menu position and available height.
 */
export function calculateDropdownMenuPosition(
  anchorRect: Pick<DOMRect, "bottom" | "left" | "top">,
  menuRect: Pick<DOMRect, "height" | "width">,
  viewportWidth: number,
  viewportHeight: number
): DropdownMenuPosition {
  const spaceBelow = Math.max(
    0,
    viewportHeight - anchorRect.bottom - menuGap - viewportMargin
  );
  const spaceAbove = Math.max(0, anchorRect.top - menuGap - viewportMargin);
  const placeAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = placeAbove ? spaceAbove : spaceBelow;
  const renderedHeight = Math.min(menuRect.height, maxHeight);
  const maxLeft = Math.max(
    viewportMargin,
    viewportWidth -
      Math.min(menuRect.width, viewportWidth - 2 * viewportMargin) -
      viewportMargin
  );

  return {
    top: placeAbove
      ? Math.max(viewportMargin, anchorRect.top - menuGap - renderedHeight)
      : anchorRect.bottom + menuGap,
    left: Math.min(Math.max(viewportMargin, anchorRect.left), maxLeft),
    maxHeight,
  };
}

/** Renders the single active dropdown menu overlay.
 *
 * @param props the active dropdown menu properties.
 * @returns the rendered dropdown menu.
 */
export function DropdownMenu({
  definition,
  selectedOptionId,
  anchorRect,
  focusKey,
  onSelect,
  onEscape,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<DropdownMenuPosition>({
    top: anchorRect.bottom + menuGap,
    left: anchorRect.left,
    maxHeight: 320,
  });

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[aria-checked='true']")
      ?.focus();
  }, [definition.id, focusKey, selectedOptionId]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const doc = menu.ownerDocument;
    const ownerWindow = doc.defaultView;
    const viewportWidth =
      doc.documentElement.clientWidth || ownerWindow?.innerWidth;
    const viewportHeight =
      doc.documentElement.clientHeight || ownerWindow?.innerHeight;
    if (!viewportWidth || !viewportHeight) {
      return;
    }
    setPosition(
      calculateDropdownMenuPosition(
        anchorRect,
        menu.getBoundingClientRect(),
        viewportWidth,
        viewportHeight
      )
    );
  }, [anchorRect, definition, selectedOptionId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitemradio']"
      ) ?? []
    );
    const current = items.findIndex((item) => item === event.target);
    let next = current;

    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    } else if (event.key === "ArrowDown") {
      next = (current + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next = (current - 1 + items.length) % items.length;
    } else {
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <Menu
      ref={menuRef}
      role="menu"
      aria-label={definition.name}
      $top={position.top}
      $left={position.left}
      $maxHeight={position.maxHeight}
      onKeyDown={handleKeyDown}
    >
      <MenuHeader>{definition.name}</MenuHeader>
      {definition.options.map((option) => (
        <MenuItem
          key={option.id}
          type="button"
          role="menuitemradio"
          aria-checked={option.id === selectedOptionId}
          tabIndex={option.id === selectedOptionId ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(option)}
        >
          <OptionPill $color={option.color}>{option.label}</OptionPill>
        </MenuItem>
      ))}
    </Menu>
  );
}

const Menu = styled.span<{
  $top: number;
  $left: number;
  $maxHeight: number;
}>`
  background: ${s("menuBackground")};
  border-radius: 6px;
  box-shadow: ${s("menuShadow")};
  box-sizing: border-box;
  display: grid;
  gap: 3px;
  left: ${({ $left }) => `${$left}px`};
  max-height: ${({ $maxHeight }) => `${$maxHeight}px`};
  max-width: calc(100vw - ${viewportMargin * 2}px);
  min-width: 180px;
  overflow-y: auto;
  padding: 8px;
  position: fixed;
  top: ${({ $top }) => `${$top}px`};
  z-index: 1000;
`;

const MenuHeader = styled.span`
  color: ${s("textSecondary")};
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 6px 6px;
  text-transform: uppercase;
`;

const MenuItem = styled.button`
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  font: inherit;
  padding: 5px 6px;
  text-align: left;

  &:focus {
    outline: none;
  }

  &:focus-visible {
    background: ${s("sidebarBackground")};
    box-shadow: inset 0 0 0 2px ${s("accent")};
  }

  &[aria-checked="true"],
  &:hover {
    background: ${s("sidebarBackground")};
  }
`;

const OptionPill = styled.span<{ $color: string }>`
  background: ${({ $color }) => $color};
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  padding: 2px 7px;
`;
