/** @jest-environment jsdom */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import type { ViewportResourceBudget } from "./viewportResourceBudget";
import { ViewportResourceMetricsCollector } from "./viewportResourceMetrics";
import {
  ViewportResourceBudgetProvider,
  useViewportResourceBudget,
  useViewportResourceMetrics,
} from "./viewportResourceBudgetContext";

interface ConsumerProps {
  onBudget: (budget: ViewportResourceBudget | undefined) => void;
}

const Consumer = ({ onBudget }: ConsumerProps) => {
  const budget = useViewportResourceBudget();
  onBudget(budget);
  return null;
};

const MetricsConsumer = ({
  onCollector,
}: {
  onCollector: (
    collector: ViewportResourceMetricsCollector | undefined
  ) => void;
}) => {
  onCollector(useViewportResourceMetrics());
  return null;
};

const callbacks = () => ({
  onLeaseGranted: jest.fn(),
  onEarlyEvictionRequested: jest.fn(),
  onEarlyEvictionCancelled: jest.fn(),
});

describe("ViewportResourceBudgetProvider", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it("provides no budget when disabled", () => {
    let observed: ViewportResourceBudget | undefined;
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled={false}>
          <Consumer onBudget={(budget) => (observed = budget)} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    expect(observed).toBeUndefined();
  });

  it("exposes metrics only while enabled", () => {
    const collector = new ViewportResourceMetricsCollector();
    let observed: ViewportResourceMetricsCollector | undefined;
    const render = (enabled: boolean) => {
      act(() => {
        ReactDOM.render(
          <ViewportResourceBudgetProvider
            enabled={enabled}
            collector={collector}
          >
            <MetricsConsumer
              onCollector={(value) => {
                observed = value;
              }}
            />
          </ViewportResourceBudgetProvider>,
          container
        );
      });
    };
    render(false);
    expect(observed).toBeUndefined();
    render(true);
    expect(observed).toBe(collector);
    render(false);
    expect(observed).toBeUndefined();
  });

  it("provides the default capacity and grants leases", () => {
    let observed: ViewportResourceBudget | undefined;
    const memberCallbacks = callbacks();
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled>
          <Consumer onBudget={(budget) => (observed = budget)} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const member = observed?.register(memberCallbacks);
    act(() => member?.requestLease());
    expect(observed?.capacity).toBe(8);
    expect(memberCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(observed?.getSnapshot().leased).toBe(1);
  });

  it("isolates separate providers and supports custom capacity", () => {
    let first: ViewportResourceBudget | undefined;
    let second: ViewportResourceBudget | undefined;
    const firstCallbacks = callbacks();
    const secondCallbacks = callbacks();
    act(() => {
      ReactDOM.render(
        <>
          <ViewportResourceBudgetProvider enabled capacity={1}>
            <Consumer onBudget={(budget) => (first = budget)} />
          </ViewportResourceBudgetProvider>
          <ViewportResourceBudgetProvider enabled capacity={2}>
            <Consumer onBudget={(budget) => (second = budget)} />
          </ViewportResourceBudgetProvider>
        </>,
        container
      );
    });
    act(() => {
      first?.register(firstCallbacks).requestLease();
      second?.register(secondCallbacks).requestLease();
    });
    expect(first).not.toBe(second);
    expect(first?.capacity).toBe(1);
    expect(second?.capacity).toBe(2);
    expect(firstCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(secondCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
  });

  it("destroys on disable and creates a fresh budget when re-enabled", () => {
    let observed: ViewportResourceBudget | undefined;
    const render = (enabled: boolean) => {
      act(() => {
        ReactDOM.render(
          <ViewportResourceBudgetProvider enabled={enabled}>
            <Consumer onBudget={(budget) => (observed = budget)} />
          </ViewportResourceBudgetProvider>,
          container
        );
      });
    };
    render(true);
    const first = observed;
    const memberCallbacks = callbacks();
    const staleMember = first?.register(memberCallbacks);
    act(() => staleMember?.requestLease());
    expect(first?.getSnapshot().leased).toBe(1);

    render(false);
    expect(observed).toBeUndefined();
    expect(first?.getSnapshot().leased).toBe(0);
    act(() => {
      staleMember?.requestLease();
      staleMember?.pin();
      staleMember?.unregister();
    });
    expect(first?.getSnapshot().leased).toBe(0);

    render(true);
    expect(observed).toBeDefined();
    expect(observed).not.toBe(first);
  });

  it("makes the budget available inside a child portal", () => {
    const portalTarget = document.createElement("div");
    document.body.appendChild(portalTarget);
    let observed: ViewportResourceBudget | undefined;
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled>
          {ReactDOM.createPortal(
            <Consumer onBudget={(budget) => (observed = budget)} />,
            portalTarget
          )}
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    expect(observed?.capacity).toBe(8);
    portalTarget.remove();
  });
});
