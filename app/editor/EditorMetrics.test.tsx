/** @jest-environment jsdom */

import { Plugin, TextSelection } from "prosemirror-state";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { ThemeProvider } from "styled-components";
import { basicExtensions } from "@shared/editor/nodes";
import { ViewportResourceMetricsCollector } from "@shared/editor/components/hooks/viewportResourceMetrics";
import Extension from "@shared/editor/lib/Extension";
import { light } from "@shared/styles/theme";
import Editor, { type Editor as EditorInstance } from "~/editor";
import useDictionary from "~/hooks/useDictionary";

jest.mock("~/components/Lightbox", () => () => null);

const initialDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
};
const replacementDocument = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "replacement" }] },
  ],
};

interface HarnessProps {
  collector?: ViewportResourceMetricsCollector;
  readOnly?: boolean;
  value?: typeof initialDocument;
  dispatchDuringConstruction?: boolean;
  setEditor: (editor: EditorInstance | null) => void;
}

let constructorDispatchCompleted = false;

class ConstructorDispatchExtension extends Extension {
  get name() {
    return "constructorDispatch";
  }

  get plugins() {
    return [
      new Plugin({
        view: (view) => {
          if (!constructorDispatchCompleted) {
            constructorDispatchCompleted = true;
            view.dispatch(view.state.tr.insertText("constructor", 1));
          }
          return {};
        },
      }),
    ];
  }
}

const Harness = ({
  collector,
  readOnly,
  value,
  dispatchDuringConstruction,
  setEditor,
}: HarnessProps) => {
  const dictionary = useDictionary();
  return (
    <ThemeProvider theme={light}>
      <Editor
        ref={setEditor}
        value={value}
        defaultValue={initialDocument}
        dictionary={dictionary}
        embeds={[]}
        extensions={
          dispatchDuringConstruction
            ? [...basicExtensions, ConstructorDispatchExtension]
            : basicExtensions
        }
        onClickLink={() => undefined}
        placeholder="metrics"
        readOnly={readOnly}
        userId="metrics-user"
        viewportResourceMetrics={collector}
      />
    </ThemeProvider>
  );
};

describe("low-level Editor document-size metrics", () => {
  let container: HTMLDivElement;
  let editor: EditorInstance | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    editor = null;
    constructorDispatchCompleted = false;
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  const render = (
    collector?: ViewportResourceMetricsCollector,
    readOnly = false,
    value?: typeof initialDocument,
    dispatchDuringConstruction = false
  ) => {
    act(() => {
      ReactDOM.render(
        <Harness
          collector={collector}
          readOnly={readOnly}
          value={value}
          dispatchDuringConstruction={dispatchDuringConstruction}
          setEditor={(instance) => {
            editor = instance;
          }}
        />,
        container
      );
    });
    if (!editor) {
      throw new Error("Expected editor instance");
    }
    return editor;
  };

  it("observes initialization, doc changes, and not selection-only work", () => {
    const collector = new ViewportResourceMetricsCollector();
    const observe = jest.spyOn(collector, "observeDocumentSize");
    const instance = render(collector);
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      instance.view.dispatch(instance.view.state.tr.insertText("x", 1));
    });
    expect(observe).toHaveBeenCalledTimes(2);

    act(() => {
      instance.view.dispatch(
        instance.view.state.tr.setSelection(
          TextSelection.create(instance.view.state.doc, 1)
        )
      );
    });
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("observes external replacement, reinit, and collector replacement", () => {
    const first = new ViewportResourceMetricsCollector();
    const firstObserve = jest.spyOn(first, "observeDocumentSize");
    render(first, true, initialDocument);
    render(first, true, replacementDocument);
    expect(firstObserve).toHaveBeenCalledTimes(2);
    render(first, false, replacementDocument);
    expect(firstObserve.mock.calls.length).toBeGreaterThanOrEqual(4);

    const second = new ViewportResourceMetricsCollector();
    const secondObserve = jest.spyOn(second, "observeDocumentSize");
    render(second, false, replacementDocument);
    expect(secondObserve).toHaveBeenCalledTimes(1);
  });

  it("observes constructor-time plugin dispatch before view assignment", () => {
    const collector = new ViewportResourceMetricsCollector();
    const observe = jest.spyOn(collector, "observeDocumentSize");
    expect(() => render(collector, false, undefined, true)).not.toThrow();
    expect(constructorDispatchCompleted).toBe(true);
    expect(observe).toHaveBeenCalledWith(expect.any(Number));
    expect(observe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
