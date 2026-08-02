/** @jest-environment jsdom */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { ThemeProvider } from "styled-components";
import { light } from "../../styles/theme";
import type { EmbedProps } from ".";
import { EmbedDescriptor } from ".";
import Berrycast from "./Berrycast";
import Diagrams from "./Diagrams";
import Dropbox from "./Dropbox";
import Gist from "./Gist";
import GitLabSnippet from "./GitLabSnippet";
import InVision from "./InVision";
import JSFiddle from "./JSFiddle";
import Linkedin from "./Linkedin";
import Pinterest from "./Pinterest";
import PlantUmlDiagrams from "./PlantUml";
import Spotify from "./Spotify";
import Trello from "./Trello";
import Vimeo from "./Vimeo";
import YouTube from "./YouTube";

interface MockFrameProps {
  style?: React.CSSProperties;
  isSelected?: boolean;
  isResizing?: boolean;
  viewportGating?: boolean;
  src?: string;
  width?: string;
  height?: string;
  title?: string;
  className?: string;
  allow?: string;
  border?: boolean;
  canonicalUrl?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}

const mockFrameProps: MockFrameProps[] = [];
const mockFrameRefs: React.ForwardedRef<HTMLIFrameElement>[] = [];

jest.mock("../../env", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../components/Frame", () => {
  const ReactModule = jest.requireActual<typeof React>("react");
  return {
    __esModule: true,
    default: ReactModule.forwardRef<HTMLIFrameElement, MockFrameProps>(
      (props, ref) => {
        mockFrameProps.push(props);
        mockFrameRefs.push(ref);
        return ReactModule.createElement("iframe", {
          ref,
          "data-testid": "mock-frame",
        });
      }
    ),
  };
});

jest.mock("react-use-measure", () => ({
  __esModule: true,
  default: () => [() => undefined, { width: 640 }],
}));

interface ServiceCase {
  name: string;
  component: React.FunctionComponent<EmbedProps>;
  href: string;
  regex: RegExp;
  expected: Partial<MockFrameProps>;
  expectsRef?: boolean;
}

const cases: ServiceCase[] = [
  {
    name: "YouTube",
    component: YouTube,
    href: "https://www.youtube.com/watch?v=abcdefghijk&t=12s",
    regex: /[?&]v=([a-zA-Z0-9_-]{11})/,
    expected: {
      src: "https://www.youtube.com/embed/abcdefghijk?modestbranding=1&start=12",
      referrerPolicy: "strict-origin-when-cross-origin",
    },
  },
  {
    name: "Vimeo",
    component: Vimeo,
    href: "https://vimeo.com/123456/hash",
    regex: /(http|https):\/\/(www\.)?vimeo\.com\/()()(123456)\/(hash)/,
    expected: { height: "412px", border: false },
  },
  ...[
    ["episode", "232px"],
    ["show", "232px"],
    ["track", "80px"],
    ["playlist", "380px"],
  ].map(
    ([kind, height]): ServiceCase => ({
      name: `Spotify ${kind}`,
      component: Spotify,
      href: `https://open.spotify.com/${kind}/identifier`,
      regex: /^https?:\/\/open\.spotify\.com\/(.*)$/,
      expected: { height, allow: "encrypted-media" },
    })
  ),
  {
    name: "Berrycast",
    component: Berrycast,
    href: "https://berrycast.com/conversations/example/",
    regex: /^https:\/\/(www\.)?berrycast\.com\/conversations\/(.*)$/,
    expected: { height: "360px", border: false },
  },
  {
    name: "Pinterest",
    component: Pinterest,
    href: "https://www.pinterest.com/outline/board/",
    regex: /^https:\/\/www\.pinterest\.com\/([^/]+)\/([^/]+)\/$/,
    expected: { width: "100%", height: "400px" },
    expectsRef: true,
  },
  {
    name: "LinkedIn existing embed",
    component: Linkedin,
    href: "https://www.linkedin.com/embed/feed/update/urn:li:share:123",
    regex:
      /^https:\/\/www\.linkedin\.com\/(?:posts\/.*-(ugcPost|activity)-(\d+)-.*|(embed)\/.*)$/,
    expected: {
      src: "https://www.linkedin.com/embed/feed/update/urn:li:share:123",
    },
  },
  {
    name: "LinkedIn generated feed",
    component: Linkedin,
    href: "https://www.linkedin.com/posts/example-activity-123-example",
    regex:
      /^https:\/\/www\.linkedin\.com\/(?:posts\/.*-(ugcPost|activity)-(\d+)-.*|(embed)\/.*)$/,
    expected: {
      src: "https://www.linkedin.com/embed/feed/update/urn:li:activity:123",
    },
  },
  ...[
    ["card", "c", "316px", "141px"],
    ["board", "b", "248px", "185px"],
  ].map(
    ([name, kind, width, height]): ServiceCase => ({
      name: `Trello ${name}`,
      component: Trello,
      href: `https://trello.com/${kind}/identifier/title`,
      regex: /^https:\/\/trello\.com\/(c|b)\/([^/]*)(.*)?$/,
      expected: { width, height },
    })
  ),
  ...[
    ["file", "fi/example", "550px"],
    ["folder", "fo/example", "350px"],
  ].map(
    ([name, path, height]): ServiceCase => ({
      name: `Dropbox ${name}`,
      component: Dropbox,
      href: `https://www.dropbox.com/scl/${path}`,
      regex: /^https?:\/\/(www.)?dropbox\.com\/(s|scl)\/(.*)$/,
      expected: { width: "100%", height },
    })
  ),
  {
    name: "Gist",
    component: Gist,
    href: "https://gist.github.com/outline/identifier",
    regex: /^https:\/\/gist\.github\.com\/([^/]+)\/(.*)$/,
    expected: { width: "100%", height: "355px" },
  },
  {
    name: "GitLab snippet",
    component: GitLabSnippet,
    href: "https://gitlab.com/outline/project/-/snippets/123",
    regex: /^https:\/\/gitlab\.com\/.*\/snippets\/(\d+)$/,
    expected: { width: "100%", height: "400px" },
    expectsRef: true,
  },
  {
    name: "InVision",
    component: InVision,
    href: "https://invis.io/example",
    regex: /^https:\/\/(invis\.io\/.*)$/,
    expected: { src: "https://invis.io/example" },
  },
  {
    name: "JSFiddle",
    component: JSFiddle,
    href: "https://jsfiddle.net/outline/example/",
    regex: /^https?:\/\/jsfiddle\.net\/(.*)\/(.*)$/,
    expected: {
      border: true,
      referrerPolicy: "strict-origin-when-cross-origin",
    },
  },
  {
    name: "Diagrams.net",
    component: Diagrams,
    href: "https://viewer.diagrams.net/?title=Architecture",
    regex: /^https:\/\/viewer\.diagrams\.net\/.*$/,
    expected: {
      canonicalUrl: "https://viewer.diagrams.net/?title=Architecture",
      border: true,
    },
  },
  {
    name: "PlantUML",
    component: PlantUmlDiagrams,
    href: "https://editor.plantuml.com/uml/diagram",
    regex: /\/uml\/([a-zA-Z0-9_-]+)/,
    expected: {
      canonicalUrl: "https://editor.plantuml.com/uml/diagram",
      border: true,
    },
  },
];

describe("custom embed Frame forwarding", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    mockFrameProps.length = 0;
    mockFrameRefs.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it.each(cases)("forwards only runtime props for $name", (service) => {
    const matches = service.href.match(service.regex);
    if (!matches) {
      throw new Error(`Fixture did not match ${service.name}`);
    }
    const descriptor = new EmbedDescriptor({
      id: service.name,
      title: service.name,
      component: service.component,
    });
    const style = { width: 640, height: 360 };

    act(() => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <service.component
            attrs={{ href: service.href }}
            embed={descriptor}
            matches={matches}
            isEditable
            isSelected
            isResizing
            viewportGating
            style={style}
          />
        </ThemeProvider>,
        container
      );
    });

    expect(mockFrameProps).toHaveLength(1);
    const frameProps = mockFrameProps[0];
    expect(frameProps).toEqual(
      expect.objectContaining({
        style,
        isSelected: true,
        isResizing: true,
        viewportGating: true,
        ...service.expected,
      })
    );
    expect(frameProps).not.toHaveProperty("attrs");
    expect(frameProps).not.toHaveProperty("embed");
    expect(frameProps).not.toHaveProperty("matches");
    expect(frameProps).not.toHaveProperty("isEditable");
    expect(container.querySelector("iframe")?.getAttribute("attrs")).toBeNull();

    if (service.expectsRef) {
      expect(mockFrameRefs[0]).not.toBeNull();
    }
  });
});
