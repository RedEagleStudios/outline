import { useState } from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { ThemeProvider } from "styled-components";
import { buildDarkTheme } from "../../styles/theme";
import { defaultDropdownDefinition } from "../lib/dropdowns";
import { calculateDropdownMenuPosition, DropdownMenu } from "./DropdownMenu";

const describeDOM = typeof document === "undefined" ? describe.skip : describe;

describeDOM("DropdownMenu", () => {
  const anchorRect = { top: 10, bottom: 30, left: 20 };

  it("focuses the selected item and supports complete menu navigation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handleEscape = jest.fn();
    act(() => {
      ReactDOM.render(
        <DropdownMenu
          definition={defaultDropdownDefinition}
          selectedOptionId="design"
          anchorRect={anchorRect}
          focusKey="chip-1"
          onSelect={jest.fn()}
          onEscape={handleEscape}
        />,
        container
      );
    });
    const menu = container.querySelector<HTMLElement>("[role='menu']");
    const items = container.querySelectorAll<HTMLElement>(
      "[role='menuitemradio']"
    );
    expect(menu?.getAttribute("aria-label")).toBe(
      defaultDropdownDefinition.name
    );
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(items[0]);

    const press = (target: HTMLElement, key: string) => {
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true })
        );
      });
    };

    press(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(items[items.length - 1], "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(items[0], "End");
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(items[items.length - 1], "Home");
    expect(document.activeElement).toBe(items[0]);
    press(items[0], "Escape");
    expect(handleEscape).toHaveBeenCalledTimes(1);

    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it("refocuses the selected item when switching chips with one definition", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let switchChip: (() => void) | undefined;

    function MenuHarness() {
      const [focusKey, setFocusKey] = useState("chip-1");
      switchChip = () => setFocusKey("chip-2");
      return (
        <DropdownMenu
          definition={defaultDropdownDefinition}
          selectedOptionId="design"
          anchorRect={anchorRect}
          focusKey={focusKey}
          onSelect={jest.fn()}
          onEscape={jest.fn()}
        />
      );
    }

    act(() => {
      ReactDOM.render(<MenuHarness />, container);
    });
    const selected = container.querySelector<HTMLElement>(
      "[aria-checked='true']"
    );
    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).not.toBe(selected);
    act(() => switchChip?.());
    expect(document.activeElement).toBe(selected);

    ReactDOM.unmountComponentAtNode(container);
    outsideButton.remove();
    container.remove();
  });

  it("uses the active theme for the singleton menu", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dark = buildDarkTheme({});
    act(() => {
      ReactDOM.render(
        <ThemeProvider theme={dark}>
          <DropdownMenu
            definition={defaultDropdownDefinition}
            selectedOptionId="design"
            anchorRect={anchorRect}
            focusKey="chip-1"
            onSelect={jest.fn()}
            onEscape={jest.fn()}
          />
        </ThemeProvider>,
        container
      );
    });
    const menu = container.querySelector<HTMLElement>("[role='menu']");
    if (!menu) {
      throw new Error("Expected the dropdown menu to render");
    }
    expect(window.getComputedStyle(menu).backgroundColor).toBe(
      "rgb(24, 28, 37)"
    );

    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });
});

describe("calculateDropdownMenuPosition", () => {
  it("flips above and clamps to the owner viewport edges", () => {
    expect(
      calculateDropdownMenuPosition(
        { top: 170, bottom: 190, left: 260 },
        { width: 180, height: 120 },
        320,
        200
      )
    ).toEqual({ top: 46, left: 132, maxHeight: 158 });
  });

  it("keeps a stable gap below when there is room", () => {
    expect(
      calculateDropdownMenuPosition(
        { top: 20, bottom: 40, left: 20 },
        { width: 180, height: 100 },
        320,
        300
      )
    ).toEqual({ top: 44, left: 20, maxHeight: 248 });
  });
});
