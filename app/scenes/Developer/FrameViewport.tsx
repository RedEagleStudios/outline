import { NodeSelection, TextSelection } from "prosemirror-state";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import Frame from "@shared/editor/components/Frame";
import type { ViewportResourceBudgetSnapshot } from "@shared/editor/components/hooks/viewportResourceBudget";
import {
  useViewportResourceBudget,
  ViewportResourceBudgetProvider,
} from "@shared/editor/components/hooks/viewportResourceBudgetContext";
import type { EmbedDescriptor, EmbedProps } from "@shared/editor/embeds";
import { richExtensions } from "@shared/editor/nodes";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Editor, { type Editor as EditorInstance } from "~/editor";
import useDictionary from "~/hooks/useDictionary";

const defaultFrameCount = 18;
const mixedEmbedCount = 18;
const fixtureMarker = "frame-viewport=";
const genericCanonicalPrefix = "https://frame-viewport.local/fixture/generic/";
const customCanonicalPrefix = "https://frame-viewport.local/fixture/custom/";
const injectedInputId = "frame-viewport-injected-input";
const injectedInputValue = "phase-b-fixed-value";

const genericEmbedDescriptor: EmbedDescriptor = {
  id: "frame-viewport-fixture",
  title: "Frame viewport fixture",
  regexMatch: [/^https:\/\/frame-viewport\.local\/fixture\/generic\/(\d+)$/],
  transformMatch: (matches) =>
    `/_health?frame-viewport-embed=generic-${matches[1] ?? "unknown"}`,
  matcher: (url) =>
    url.match(/^https:\/\/frame-viewport\.local\/fixture\/generic\/(\d+)$/) ||
    false,
};

function CustomFixtureEmbed({
  attrs,
  embed,
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: EmbedProps) {
  const index = matches[1] ?? "unknown";
  return (
    <Frame
      src={`/_health?frame-viewport-embed=custom-${index}`}
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      canonicalUrl={attrs.href}
      title={embed.title}
      referrerPolicy="strict-origin-when-cross-origin"
      border
    />
  );
}

const customEmbedDescriptor: EmbedDescriptor = {
  id: "frame-viewport-custom-fixture",
  title: "Frame viewport custom fixture",
  regexMatch: [/^https:\/\/frame-viewport\.local\/fixture\/custom\/(\d+)$/],
  component: CustomFixtureEmbed,
  matcher: (url) =>
    url.match(/^https:\/\/frame-viewport\.local\/fixture\/custom\/(\d+)$/) ||
    false,
};

const genericEmbedDescriptors = [genericEmbedDescriptor];
const customEmbedDescriptors = [customEmbedDescriptor];
const mixedEmbedDescriptors = [genericEmbedDescriptor, customEmbedDescriptor];

type EmbedMode = "generic" | "custom" | "mixed";

const genericEmbedDocument = {
  type: "doc",
  content: [
    {
      type: "embed",
      attrs: { href: `${genericCanonicalPrefix}1` },
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Selection target after the embed." }],
    },
  ],
};

const customEmbedDocument = {
  type: "doc",
  content: [
    {
      type: "embed",
      attrs: { href: `${customCanonicalPrefix}1` },
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Selection target after the embed." }],
    },
  ],
};

const mixedEmbedDocument = {
  type: "doc",
  content: Array.from({ length: mixedEmbedCount }, (_, offset) => {
    const index = offset + 1;
    const mode = index % 2 === 1 ? "generic" : "custom";
    const prefix =
      mode === "generic" ? genericCanonicalPrefix : customCanonicalPrefix;
    return [
      {
        type: "embed",
        attrs: { href: `${prefix}${index}` },
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Mixed ${mode} Embed ${index}`,
          },
        ],
      },
    ];
  }).flat(),
};

interface FrameDiagnosticsState {
  active: number;
  nearViewport: number;
  frameWrapperHeight: number | null;
  frameWrapperWidth: number | null;
  scrollHeight: number;
}

interface EmbedDiagnosticsState {
  iframeMounted: boolean;
  selected: boolean;
  wrapperHeight: number | null;
  wrapperWidth: number | null;
  iframeGeneration: number | null;
  iframeChanged: boolean;
  inputPresent: boolean;
  inputValue: string | null;
  mixedIframeCount: number;
  mixedGenericIframeCount: number;
  mixedCustomIframeCount: number;
}

interface VisibilityDiagnosticsState {
  status: "visible" | "hidden";
  changeCount: number;
  lastChangedAt: string | null;
}

const initialFrameDiagnostics: FrameDiagnosticsState = {
  active: 0,
  nearViewport: 0,
  frameWrapperHeight: null,
  frameWrapperWidth: null,
  scrollHeight: 0,
};

const initialEmbedDiagnostics: EmbedDiagnosticsState = {
  iframeMounted: false,
  selected: false,
  wrapperHeight: null,
  wrapperWidth: null,
  iframeGeneration: null,
  iframeChanged: false,
  inputPresent: false,
  inputValue: null,
  mixedIframeCount: 0,
  mixedGenericIframeCount: 0,
  mixedCustomIframeCount: 0,
};

function DirectFrameBudgetDiagnostics() {
  const budget = useViewportResourceBudget();
  const [snapshot, setSnapshot] = useState<ViewportResourceBudgetSnapshot>(
    () =>
      budget
        ? budget.getSnapshot()
        : {
            capacity: 8,
            leased: 0,
            active: 0,
            cooling: 0,
            queued: 0,
            pinned: 0,
          }
  );

  useEffect(() => {
    if (!budget) {
      return;
    }
    const updateSnapshot = () => {
      const next = budget.getSnapshot();
      setSnapshot((current) =>
        current.capacity === next.capacity &&
        current.leased === next.leased &&
        current.active === next.active &&
        current.cooling === next.cooling &&
        current.queued === next.queued &&
        current.pinned === next.pinned
          ? current
          : next
      );
    };
    updateSnapshot();
    const interval = window.setInterval(updateSnapshot, 200);
    return () => window.clearInterval(interval);
  }, [budget]);

  return (
    <BudgetDiagnostics>
      <strong>Direct Frame budget</strong>
      <div>
        capacity {snapshot.capacity} · leased {snapshot.leased} · active{" "}
        {snapshot.active} · cooling {snapshot.cooling} · queued{" "}
        {snapshot.queued} · pinned {snapshot.pinned}
      </div>
    </BudgetDiagnostics>
  );
}

/**
 * Renders an isolated development fixture for generic iframe viewport gating.
 *
 * @returns development frame viewport fixture scene.
 */
export function FrameViewport() {
  const dictionary = useDictionary();
  const editorRef = useRef<EditorInstance>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const fixtureRef = useRef<HTMLDivElement>(null);
  const currentGenerationRef = useRef(0);
  const iframeIdsRef = useRef(new WeakMap<HTMLIFrameElement, number>());
  const nextIframeIdRef = useRef(1);
  const previousIframeIdRef = useRef<number>();
  const lastIframeChangeRef = useRef(false);
  const [viewportGatedEmbeds, setViewportGatedEmbeds] = useState(true);
  const [embedMode, setEmbedMode] = useState<EmbedMode>("generic");
  const [embedGeneration, setEmbedGeneration] = useState(0);
  const [frameCount, setFrameCount] = useState(defaultFrameCount);
  const [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [loadEventCount, setLoadEventCount] = useState(0);
  const [lastAction, setLastAction] = useState("Editor fixture ready");
  const [frameDiagnostics, setFrameDiagnostics] =
    useState<FrameDiagnosticsState>(initialFrameDiagnostics);
  const [embedDiagnostics, setEmbedDiagnostics] =
    useState<EmbedDiagnosticsState>(initialEmbedDiagnostics);
  const [visibilityDiagnostics, setVisibilityDiagnostics] =
    useState<VisibilityDiagnosticsState>(() => ({
      status:
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? "hidden"
          : "visible",
      changeCount: 0,
      lastChangedAt: null,
    }));

  const getEmbedIframe = useCallback(
    () => editorSurfaceRef.current?.querySelector("iframe") ?? null,
    []
  );

  const removeInjectedInput = useCallback(() => {
    const iframe = getEmbedIframe();
    try {
      iframe?.contentDocument?.getElementById(injectedInputId)?.remove();
    } catch (_error) {
      // The iframe may have navigated to a cross-origin document.
    }
  }, [getEmbedIframe]);

  const updateDiagnostics = useCallback(() => {
    const fixture = fixtureRef.current;
    const nearViewport = fixture
      ? Array.from(
          fixture.querySelectorAll<HTMLElement>("[data-frame-item]")
        ).filter((element) => {
          const target = element.lastElementChild;
          if (!(target instanceof HTMLElement)) {
            return false;
          }
          const rectangle = target.getBoundingClientRect();
          return (
            rectangle.bottom >= -1000 &&
            rectangle.top <= window.innerHeight + 1000
          );
        }).length
      : 0;
    const firstFrameItem =
      fixture?.querySelector<HTMLElement>("[data-frame-item]");
    const frameWrapper = firstFrameItem?.lastElementChild;
    const frameWrapperRectangle =
      frameWrapper instanceof HTMLElement
        ? frameWrapper.getBoundingClientRect()
        : null;
    const nextFrameDiagnostics = {
      active: fixture?.querySelectorAll("iframe").length ?? 0,
      nearViewport,
      frameWrapperHeight: frameWrapperRectangle?.height ?? null,
      frameWrapperWidth: frameWrapperRectangle?.width ?? null,
      scrollHeight: document.documentElement.scrollHeight,
    };
    setFrameDiagnostics((current) =>
      JSON.stringify(current) === JSON.stringify(nextFrameDiagnostics)
        ? current
        : nextFrameDiagnostics
    );

    const instance = editorRef.current;
    const embedIframes = Array.from(
      editorSurfaceRef.current?.querySelectorAll("iframe") ?? []
    );
    const iframe = embedIframes[0] ?? null;
    const embedNode =
      editorSurfaceRef.current?.querySelector<HTMLElement>(".component-embed");
    const wrapper = embedNode?.firstElementChild;
    const wrapperRectangle =
      wrapper instanceof HTMLElement ? wrapper.getBoundingClientRect() : null;
    let iframeGeneration: number | null = null;
    let iframeChanged = false;
    let inputPresent = false;
    let inputValue: string | null = null;

    if (iframe) {
      const knownId = iframeIdsRef.current.get(iframe);
      iframeGeneration = knownId ?? nextIframeIdRef.current++;
      if (knownId === undefined) {
        iframeIdsRef.current.set(iframe, iframeGeneration);
        lastIframeChangeRef.current =
          previousIframeIdRef.current !== undefined &&
          previousIframeIdRef.current !== iframeGeneration;
      }
      iframeChanged = lastIframeChangeRef.current;
      previousIframeIdRef.current = iframeGeneration;
      try {
        const detectedInput =
          iframe.contentDocument?.getElementById(injectedInputId);
        inputPresent = detectedInput?.tagName === "INPUT";
        inputValue = inputPresent
          ? (detectedInput?.getAttribute("value") ?? null)
          : null;
      } catch (_error) {
        // Unavailable and cross-origin documents are reported as no input.
      }
    }

    const selection = instance?.view.state.selection;
    const nextEmbedDiagnostics = {
      iframeMounted: !!iframe,
      selected:
        selection instanceof NodeSelection &&
        selection.node.type.name === "embed",
      wrapperHeight: wrapperRectangle?.height ?? null,
      wrapperWidth: wrapperRectangle?.width ?? null,
      iframeGeneration,
      iframeChanged,
      inputPresent,
      inputValue,
      mixedIframeCount: embedIframes.length,
      mixedGenericIframeCount: embedIframes.filter((element) =>
        element.src.includes("frame-viewport-embed=generic-")
      ).length,
      mixedCustomIframeCount: embedIframes.filter((element) =>
        element.src.includes("frame-viewport-embed=custom-")
      ).length,
    };
    setEmbedDiagnostics((current) =>
      JSON.stringify(current) === JSON.stringify(nextEmbedDiagnostics)
        ? current
        : nextEmbedDiagnostics
    );
  }, []);

  useEffect(() => {
    updateDiagnostics();
    const interval = window.setInterval(updateDiagnostics, 500);
    window.addEventListener("scroll", updateDiagnostics, { passive: true });
    window.addEventListener("resize", updateDiagnostics);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("scroll", updateDiagnostics);
      window.removeEventListener("resize", updateDiagnostics);
      removeInjectedInput();
    };
  }, [removeInjectedInput, updateDiagnostics]);

  useEffect(() => {
    updateDiagnostics();
  }, [frameCount, generation, mounted, updateDiagnostics]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setVisibilityDiagnostics((current) => ({
        status: document.visibilityState === "hidden" ? "hidden" : "visible",
        changeCount: current.changeCount + 1,
        lastChangedAt: new Date().toISOString(),
      }));
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleSelectEmbed = useCallback(() => {
    const instance = editorRef.current;
    if (!instance) {
      setLastAction("Error: editor is unavailable");
      return;
    }
    let embedPosition: number | undefined;
    instance.view.state.doc.descendants((node, position) => {
      if (embedPosition !== undefined || node.type.name !== "embed") {
        return true;
      }
      embedPosition = position;
      return false;
    });
    if (embedPosition === undefined) {
      setLastAction("Error: embed node is unavailable");
      return;
    }
    const transaction = instance.view.state.tr.setSelection(
      NodeSelection.create(instance.view.state.doc, embedPosition)
    );
    instance.view.dispatch(transaction);
    setLastAction("Embed NodeView selected");
    updateDiagnostics();
  }, [updateDiagnostics]);

  const handleEmbedGatingToggle = useCallback(() => {
    const enabled = !viewportGatedEmbeds;
    setViewportGatedEmbeds(enabled);
    setLastAction(
      enabled
        ? "Embed gating enabled; remount the NodeView to apply it"
        : "Embed gating disabled live; mounted iframe identity should remain"
    );
  }, [viewportGatedEmbeds]);

  const handleEmbedModeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const mode: EmbedMode =
        event.target.value === "mixed"
          ? "mixed"
          : event.target.value === "custom"
            ? "custom"
            : "generic";
      removeInjectedInput();
      setEmbedMode(mode);
      setEmbedGeneration((value) => value + 1);
      setEmbedDiagnostics(initialEmbedDiagnostics);
      setLastAction(
        `${
          mode === "mixed"
            ? "Mixed Embeds"
            : mode === "generic"
              ? "Generic Embed"
              : "Custom Embed"
        } selected; fixture NodeViews recreated`
      );
    },
    [removeInjectedInput]
  );

  const handleEmbedRemount = useCallback(() => {
    removeInjectedInput();
    setEmbedGeneration((value) => value + 1);
    setEmbedDiagnostics(initialEmbedDiagnostics);
    setLastAction(
      `${embedMode === "mixed" ? "Mixed Embed NodeViews" : "Embed NodeView"} remounted with gating ${
        viewportGatedEmbeds ? "enabled" : "disabled"
      }`
    );
  }, [embedMode, removeInjectedInput, viewportGatedEmbeds]);

  const handleMoveSelection = useCallback(() => {
    const instance = editorRef.current;
    if (!instance) {
      setLastAction("Error: editor is unavailable");
      return;
    }
    let paragraphPosition: number | undefined;
    instance.view.state.doc.descendants((node, position) => {
      if (paragraphPosition !== undefined || node.type.name !== "paragraph") {
        return true;
      }
      paragraphPosition = position + 1;
      return false;
    });
    if (paragraphPosition === undefined) {
      setLastAction("Error: paragraph selection target is unavailable");
      return;
    }
    const resolved = instance.view.state.doc.resolve(paragraphPosition);
    instance.view.dispatch(
      instance.view.state.tr.setSelection(TextSelection.near(resolved))
    );
    setLastAction("Selection moved below embed");
    updateDiagnostics();
  }, [updateDiagnostics]);

  const handleInjectInput = useCallback(() => {
    const iframe = getEmbedIframe();
    if (!iframe) {
      setLastAction("Error: iframe is not mounted");
      return;
    }
    try {
      const iframeDocument = iframe.contentDocument;
      const parent = iframeDocument?.body ?? iframeDocument?.documentElement;
      if (!iframeDocument || !parent) {
        setLastAction("Error: iframe document is unavailable");
        return;
      }
      const existingInput = iframeDocument.getElementById(injectedInputId);
      existingInput?.remove();
      const input = iframeDocument.createElement("input");
      input.id = injectedInputId;
      input.setAttribute("aria-label", "Phase B injected evidence input");
      parent.appendChild(input);
      input.setAttribute("value", injectedInputValue);
      input.value = injectedInputValue;
      setLastAction("Fixed-value input injected without focus");
      updateDiagnostics();
    } catch (error) {
      const message = error instanceof Error ? error.message : "access denied";
      setLastAction(`Error: iframe document unavailable (${message})`);
    }
  }, [getEmbedIframe, updateDiagnostics]);

  const handleBeforePrint = useCallback(() => {
    if (mounted) {
      setLastAction(
        "Unmount the direct Frame list before running beforeprint; printing pins every mounted frame"
      );
      return;
    }
    window.dispatchEvent(new Event("beforeprint"));
    setLastAction("Synthetic beforeprint dispatched; embed requested to pin");
    updateDiagnostics();
  }, [mounted, updateDiagnostics]);

  const handleFullscreen = useCallback(async () => {
    const iframe = getEmbedIframe();
    if (!iframe) {
      setLastAction("Error: iframe is not mounted");
      return;
    }
    if (!iframe.requestFullscreen) {
      setLastAction("Error: fullscreen is not supported");
      return;
    }
    try {
      await iframe.requestFullscreen();
      setLastAction("Iframe fullscreen requested");
    } catch (error) {
      const message = error instanceof Error ? error.message : "request denied";
      setLastAction(`Error: fullscreen request failed (${message})`);
    }
    updateDiagnostics();
  }, [getEmbedIframe, updateDiagnostics]);

  const handleMountToggle = useCallback(() => {
    setMounted((value) => !value);
  }, []);
  const handleFrameLoad = useCallback(() => {
    if (generation !== currentGenerationRef.current) {
      return;
    }
    setLoadEventCount((value) => value + 1);
  }, [generation]);
  const resetFrameList = useCallback(() => {
    removeInjectedInput();
    currentGenerationRef.current += 1;
    setLoadEventCount(0);
    setMounted(true);
    setGeneration(currentGenerationRef.current);
    setFrameDiagnostics(initialFrameDiagnostics);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [removeInjectedInput]);
  const handleReset = useCallback(() => {
    resetFrameList();
  }, [resetFrameList]);
  const handleFrameCountChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setFrameCount(event.target.value === "100" ? 100 : defaultFrameCount);
      resetFrameList();
    },
    [resetFrameList]
  );
  const handleRefresh = useCallback(() => {
    updateDiagnostics();
    setLastAction("Diagnostics refreshed");
  }, [updateDiagnostics]);
  const handleClickLink = useCallback(() => undefined, []);

  return (
    <Scene title="Frame viewport fixture">
      <Heading>Frame viewport fixture</Heading>
      <Description>
        Development-only generic frames. Scroll through the list to inspect
        viewport mounting, cooling, and re-entry in Chromium.
      </Description>

      <Section aria-labelledby="embed-nodeview-heading">
        <SectionHeading id="embed-nodeview-heading">
          Production Embed NodeView
        </SectionHeading>
        <Description>
          Select or scroll the embed to inspect gating. Resize manually with its
          existing bottom handle.
        </Description>
        <Description>
          Disabling is live and fail-open: a mounted iframe keeps its identity
          while observers and budgeting clean up. Enabling applies only to new
          or remounted NodeViews; use Remount Embed NodeView for this fixture.
          This Embed uses its own Editor budget and is not included in Direct
          Frame budget.
        </Description>
        <Description>
          Generic and custom modes share the same Editor budget. Native video,
          images, and Drive links are outside this iframe gate. Background-tab
          evidence requires Page visibility to report hidden.
        </Description>
        <Description>
          Mixed Embeds is the authoritative shared-budget hard-cap mode: all 18
          NodeViews share this Editor’s capacity-8 budget. The Direct Frame list
          is a separate scope.
        </Description>
        <Controls aria-label="Embed NodeView controls">
          <ControlLabel>
            Embed mode
            <select value={embedMode} onChange={handleEmbedModeChange}>
              <option value="generic">Generic Embed</option>
              <option value="custom">Custom Embed</option>
              <option value="mixed">Mixed Embeds</option>
            </select>
          </ControlLabel>
          <button type="button" onClick={handleEmbedGatingToggle}>
            {viewportGatedEmbeds
              ? "Disable Embed gating"
              : "Enable Embed gating"}
          </button>
          <button type="button" onClick={handleEmbedRemount}>
            Remount Embed NodeView{embedMode === "mixed" ? "s" : ""}
          </button>
          <button type="button" onClick={handleSelectEmbed}>
            Select {embedMode === "mixed" ? "first " : ""}Embed NodeView
          </button>
          <button type="button" onClick={handleMoveSelection}>
            Move selection below {embedMode === "mixed" ? "first " : ""}embed
          </button>
          <button type="button" onClick={handleInjectInput}>
            Inject fixed-value input
            {embedMode === "mixed" ? " into first iframe" : ""}
          </button>
          <button type="button" onClick={handleRefresh}>
            Refresh diagnostics
          </button>
          <button
            type="button"
            onClick={handleBeforePrint}
            disabled={mounted}
            aria-describedby="beforeprint-help"
          >
            Trigger beforeprint pin test
          </button>
          <button type="button" onClick={handleFullscreen}>
            Request {embedMode === "mixed" ? "first " : ""}iframe fullscreen
          </button>
        </Controls>
        <Description id="beforeprint-help">
          Beforeprint is available only while the direct Frame list is unmounted
          because printing pins every mounted frame.
        </Description>
        <Diagnostics aria-live="polite" aria-atomic="false">
          <div>
            Embed mode:{" "}
            {embedMode === "mixed"
              ? "Mixed Embeds"
              : embedMode === "generic"
                ? "Generic Embed"
                : "Custom Embed"}
          </div>
          <div>Fixture NodeView remount generation: {embedGeneration}</div>
          <div>
            Embed viewport gating policy:{" "}
            {viewportGatedEmbeds ? "enabled" : "disabled"}
          </div>
          <div>Page visibility: {visibilityDiagnostics.status}</div>
          <div>
            Visibility changes: {visibilityDiagnostics.changeCount}; last:{" "}
            {visibilityDiagnostics.lastChangedAt ?? "none"}
          </div>
          {embedMode === "mixed" && (
            <>
              <div>
                Total mixed iframe elements in DOM:{" "}
                {embedDiagnostics.mixedIframeCount}
              </div>
              <div>
                Generic mixed iframe elements in DOM:{" "}
                {embedDiagnostics.mixedGenericIframeCount}
              </div>
              <div>
                Custom mixed iframe elements in DOM:{" "}
                {embedDiagnostics.mixedCustomIframeCount}
              </div>
            </>
          )}
          <div>
            Iframe mounted: {embedDiagnostics.iframeMounted ? "yes" : "no"}
          </div>
          <div>Embed selected: {embedDiagnostics.selected ? "yes" : "no"}</div>
          <div>
            Actual wrapper geometry:{" "}
            {embedDiagnostics.wrapperWidth === null ||
            embedDiagnostics.wrapperHeight === null
              ? "unmounted"
              : `${embedDiagnostics.wrapperWidth.toFixed(
                  1
                )}px × ${embedDiagnostics.wrapperHeight.toFixed(1)}px`}
          </div>
          <div>
            Iframe identity generation:{" "}
            {embedDiagnostics.iframeGeneration ?? "unmounted"}
          </div>
          <div>
            Iframe identity changed on last observation:{" "}
            {embedDiagnostics.iframeChanged ? "yes" : "no"}
          </div>
          <div>
            Injected input:{" "}
            {embedDiagnostics.inputPresent ? "present" : "absent"}
            {embedDiagnostics.inputValue !== null
              ? ` (${embedDiagnostics.inputValue})`
              : ""}
          </div>
          <div>Last action/error: {lastAction}</div>
        </Diagnostics>
        <EditorSurface ref={editorSurfaceRef} $mixed={embedMode === "mixed"}>
          <Editor
            key={embedGeneration}
            ref={editorRef}
            defaultValue={
              embedMode === "mixed"
                ? mixedEmbedDocument
                : embedMode === "generic"
                  ? genericEmbedDocument
                  : customEmbedDocument
            }
            dictionary={dictionary}
            embeds={
              embedMode === "mixed"
                ? mixedEmbedDescriptors
                : embedMode === "generic"
                  ? genericEmbedDescriptors
                  : customEmbedDescriptors
            }
            extensions={richExtensions}
            onClickLink={handleClickLink}
            onInit={updateDiagnostics}
            placeholder="Frame viewport embed fixture"
            viewportGatedEmbeds={viewportGatedEmbeds}
          />
        </EditorSurface>
      </Section>

      <ViewportResourceBudgetProvider enabled capacity={8}>
        <Section aria-labelledby="direct-frame-heading">
          <SectionHeading id="direct-frame-heading">
            Direct Frame scaling
          </SectionHeading>
          <Description>
            Unpinned leased stays at or below 8. Pinned frames bypass the cap
            and are counted separately. A rapid pass may never mount because
            entry must dwell for 100ms.
          </Description>
          <Description>
            Untouched off-screen frames cool for up to 30 seconds. Cooling
            resources keep leases until normal expiry or fresh-confirmed
            pressure eviction. Frames that are focused, interacted with, or
            print-pinned remain active until Reset/remount; Reset creates a new
            generation and clears lifetime pins.
          </Description>
          <Controls aria-label="Direct Frame controls">
            <ControlLabel>
              Frame count
              <select value={frameCount} onChange={handleFrameCountChange}>
                <option value="18">18</option>
                <option value="100">100</option>
              </select>
            </ControlLabel>
            <button type="button" onClick={handleMountToggle}>
              {mounted ? "Unmount" : "Mount"} list
            </button>
            <button type="button" onClick={handleReset}>
              Reset and scroll to top
            </button>
            <button type="button" onClick={handleRefresh}>
              Refresh diagnostics
            </button>
          </Controls>
          <Diagnostics aria-live="polite" aria-atomic="false">
            <DirectFrameBudgetDiagnostics />
            <div>List mounted: {mounted ? "yes" : "no"}</div>
            <div>Total fixture frames: {mounted ? frameCount : 0}</div>
            <div>
              Frames near viewport threshold: {frameDiagnostics.nearViewport}
            </div>
            <div>
              Raw direct iframe elements in DOM: {frameDiagnostics.active}
            </div>
            <div>Document scroll height: {frameDiagnostics.scrollHeight}px</div>
            <div>
              First Frame wrapper geometry:{" "}
              {frameDiagnostics.frameWrapperWidth === null ||
              frameDiagnostics.frameWrapperHeight === null
                ? "unmounted"
                : `${frameDiagnostics.frameWrapperWidth.toFixed(
                    1
                  )}px × ${frameDiagnostics.frameWrapperHeight.toFixed(1)}px`}
            </div>
            <div>
              Iframe load events this generation (mount toggles keep count):{" "}
              {loadEventCount}
            </div>
          </Diagnostics>
          <Fixture ref={fixtureRef} key={generation}>
            {mounted &&
              Array.from({ length: frameCount }, (_, index) => {
                const src = `/_health?${fixtureMarker}${index + 1}`;
                return (
                  <FrameItem key={src} data-frame-item>
                    <FrameLabel>Frame {index + 1}</FrameLabel>
                    <Frame
                      src={src}
                      title={`Viewport fixture frame ${index + 1}`}
                      style={{ width: "100%", height: 320 }}
                      viewportGating
                      border
                      onLoad={handleFrameLoad}
                    />
                  </FrameItem>
                );
              })}
          </Fixture>
        </Section>
      </ViewportResourceBudgetProvider>
    </Scene>
  );
}

const Description = styled.p`
  max-width: 680px;
`;

const Section = styled.section`
  margin-top: 32px;
`;

const SectionHeading = styled.h2`
  margin: 0 0 8px;
  font-size: 18px;
`;

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 16px 0 12px;
`;

const ControlLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const Diagnostics = styled.div`
  position: sticky;
  top: 8px;
  z-index: 1;
  width: fit-content;
  max-width: 100%;
  margin-bottom: 24px;
  padding: 10px 12px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  background: ${(props) => props.theme.background};
  font-family: monospace;
  line-height: 1.5;
`;

const BudgetDiagnostics = styled.div`
  margin-bottom: 6px;
`;

const EditorSurface = styled.div<{ $mixed?: boolean }>`
  max-width: 760px;
  min-height: 480px;

  ${(props) =>
    props.$mixed &&
    `
      .component-embed {
        margin-bottom: 360px;
      }
    `}
`;

const Fixture = styled.div`
  max-width: 760px;
`;

const FrameItem = styled.section`
  min-height: 720px;
`;

const FrameLabel = styled.h2`
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
`;

export default FrameViewport;
