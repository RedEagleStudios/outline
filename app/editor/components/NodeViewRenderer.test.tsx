/** @jest-environment jsdom */

import { Observer } from "mobx-react";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { NodeViewRenderer } from "./NodeViewRenderer";

interface TestProps {
  children?: React.ReactNode;
  isSelected?: boolean;
  label?: string;
}

const TestComponent = ({ isSelected, label }: TestProps) => (
  <div data-selected={isSelected ? "yes" : "no"}>{label}</div>
);

describe("NodeViewRenderer", () => {
  let container: HTMLDivElement;
  let portalTarget: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    portalTarget = document.createElement("div");
    document.body.append(container, portalTarget);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    portalTarget.remove();
  });

  it("reacts to selection mutations and subsequent full prop updates", () => {
    const renderer = new NodeViewRenderer<TestProps>(
      portalTarget,
      TestComponent,
      {
        isSelected: false,
        label: "initial",
      }
    );

    act(() => {
      ReactDOM.render(<Observer>{() => renderer.content}</Observer>, container);
    });
    expect(portalTarget.textContent).toBe("initial");
    expect(portalTarget.firstElementChild?.getAttribute("data-selected")).toBe(
      "no"
    );

    act(() => renderer.setProp("isSelected", true));
    expect(portalTarget.firstElementChild?.getAttribute("data-selected")).toBe(
      "yes"
    );

    const selectedElement = portalTarget.firstElementChild;
    act(() => renderer.setProp("isSelected", true));
    expect(portalTarget.firstElementChild).toBe(selectedElement);

    act(() => renderer.setProp("isSelected", false));
    expect(portalTarget.firstElementChild?.getAttribute("data-selected")).toBe(
      "no"
    );

    act(() => renderer.updateProps({ isSelected: true, label: "updated" }));
    expect(portalTarget.textContent).toBe("updated");
    expect(portalTarget.firstElementChild?.getAttribute("data-selected")).toBe(
      "yes"
    );
  });
});
