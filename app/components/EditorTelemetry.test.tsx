/** @jest-environment jsdom */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import type { ViewportResourceMetricsCollector } from "@shared/editor/components/hooks/viewportResourceMetrics";
import Analytics from "~/utils/Analytics";
import env from "~/env";
import Editor from "./Editor";

interface LowLevelProbeProps {
  viewportGatedEmbeds?: boolean;
  viewportResourceMetrics?: ViewportResourceMetricsCollector;
}

const mockLowLevelProps: LowLevelProbeProps[] = [];
let mockShareId: string | undefined;

jest.mock("react-merge-refs", () => ({ mergeRefs: () => () => undefined }));
jest.mock("~/env", () => ({
  __esModule: true,
  default: { VIEWPORT_GATED_EMBEDS_ENABLED: true },
}));
jest.mock("~/hooks/useCurrentTeam", () => ({
  __esModule: true,
  default: () => ({ getPreference: () => undefined }),
}));
jest.mock("~/hooks/useCurrentUser", () => ({
  __esModule: true,
  default: () => undefined,
}));
jest.mock("@shared/hooks/useShare", () => ({
  __esModule: true,
  default: () => ({ shareId: mockShareId }),
}));
jest.mock("~/hooks/useEmbeds", () => ({ __esModule: true, default: () => [] }));
jest.mock("~/hooks/useStores", () => ({
  __esModule: true,
  default: () => ({ comments: { orderedData: [] } }),
}));
jest.mock("~/hooks/useDictionary", () => ({
  __esModule: true,
  default: () => ({ uploadingWithProgress: () => "uploading" }),
}));
jest.mock("~/hooks/useEditorClickHandlers", () => ({
  __esModule: true,
  default: () => ({ handleClickLink: jest.fn() }),
}));
jest.mock("~/components/ClickablePadding", () => () => null);
jest.mock(
  "~/components/ErrorBoundary",
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children
);
jest.mock(
  "@shared/editor/components/Styles",
  () =>
    ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
);
jest.mock("~/utils/lazyWithRetry", () => ({
  __esModule: true,
  default: () => {
    const ReactModule = jest.requireActual<typeof React>("react");
    return ReactModule.forwardRef<HTMLElement, LowLevelProbeProps>(
      (props, _ref) => {
        mockLowLevelProps.push(props);
        return ReactModule.createElement("div", {
          "data-low-level-editor": true,
        });
      }
    );
  },
}));

describe("mounted Editor viewport telemetry", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockLowLevelProps.length = 0;
    env.VIEWPORT_GATED_EMBEDS_ENABLED = true;
    mockShareId = undefined;
    jest.restoreAllMocks();
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  const render = (eligible: boolean, injected = false) => {
    const props = {
      id: "document-id",
      value: "",
      readOnly: false,
      viewportGatingEligible: eligible,
      ...(injected
        ? {
            viewportGatedEmbeds: false,
            viewportResourceMetrics: undefined,
          }
        : {}),
    };
    act(() => {
      ReactDOM.render(<Editor {...props} />, container);
    });
  };

  it("passes resolved enabled policy and an internal collector after caller props", () => {
    render(true, true);
    expect(mockLowLevelProps.at(-1)?.viewportGatedEmbeds).toBe(true);
    expect(mockLowLevelProps.at(-1)?.viewportResourceMetrics).toBeDefined();
  });

  it("emits once on enabled unmount", () => {
    const track = jest.spyOn(Analytics, "track").mockImplementation();
    render(true);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][2]).toEqual(
      expect.objectContaining({ end_reason: "unmount" })
    );
  });

  it("pagehide wins the race with unmount", () => {
    const track = jest.spyOn(Analytics, "track").mockImplementation();
    render(true);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][2]).toEqual(
      expect.objectContaining({ end_reason: "pagehide" })
    );
  });

  it.each([
    ["global off", false, true, undefined],
    ["ineligible", true, false, undefined],
    ["public share", true, true, "share-id"],
  ])("records nothing when %s", (_name, global, eligible, shareId) => {
    const track = jest.spyOn(Analytics, "track").mockImplementation();
    env.VIEWPORT_GATED_EMBEDS_ENABLED = global;
    mockShareId = shareId;
    render(eligible);
    expect(mockLowLevelProps.at(-1)?.viewportGatedEmbeds).toBe(false);
    expect(mockLowLevelProps.at(-1)?.viewportResourceMetrics).toBeUndefined();
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("isolates analytics exceptions and does not retry", () => {
    const track = jest.spyOn(Analytics, "track").mockImplementation(() => {
      throw new Error("analytics failed");
    });
    render(true);
    expect(() => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
    }).not.toThrow();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
