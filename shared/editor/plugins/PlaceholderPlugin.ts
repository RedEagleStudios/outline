import filter from "lodash/filter";
import find from "lodash/find";
import map from "lodash/map";
import type { Node, ResolvedPos } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

type Config = Array<{
  /** Condition to meet for the placeholder to be applied to a node */
  condition: (args: {
    /** Node to which the placeholder is expected to be applied */
    node: Node;
    /** Resolved position corresponding to start of node */
    $start: ResolvedPos;
    /** Parent of node to which the placeholder is expected to be applied */
    parent: Node | null;
    /** Current editor state */
    state: EditorState;
    /** Text content of the document */
    textContent: string;
  }) => boolean;
  /** Placeholder text */
  text: string;
}>;

interface DecorationRange {
  from: number;
  to: number;
}

interface ParagraphWithPosition {
  node: Node;
  $start: ResolvedPos;
  parent: Node | null;
}

export class PlaceholderPlugin extends Plugin {
  constructor(config: Config) {
    super({
      state: {
        init: (_, state: EditorState) => ({
          decorations: this.createDecorations(state, config),
        }),
        apply: (tr, pluginState, oldState, newState) => {
          // Only recompute if doc or selection changed
          if (tr.docChanged) {
            return { decorations: this.createDecorations(newState, config) };
          }

          if (tr.selectionSet) {
            return {
              decorations: this.updateDecorations(
                tr,
                pluginState.decorations,
                oldState,
                newState,
                config
              ),
            };
          }
          return pluginState;
        },
      },
      props: {
        decorations: (state) => {
          const pluginState = this.getState(state);
          return pluginState ? pluginState.decorations : null;
        },
      },
    });
  }

  private createDecorations(state: EditorState, config: Config) {
    const paras: ParagraphWithPosition[] = [];
    state.doc.descendants((node, pos, parent) => {
      if (node.type.name === "paragraph") {
        paras.push({ node, $start: state.doc.resolve(pos + 1), parent });
        return false;
      }
      return true;
    });

    let textContent: string | undefined;
    const decorations: Decoration[] = filter(
      map(paras, (para) => {
        const condMet = find(config, (conf) =>
          conf.condition({
            node: para.node,
            $start: para.$start,
            parent: para.parent,
            state,
            get textContent() {
              textContent ??= state.doc.textContent;
              return textContent;
            },
          })
        );
        return condMet
          ? Decoration.node(
              para.$start.pos - 1,
              para.$start.pos - 1 + para.node.nodeSize,
              {
                class: "placeholder",
                "data-empty-text": condMet.text,
              }
            )
          : undefined;
      }),
      (decoration) => decoration !== undefined
    );
    return DecorationSet.create(state.doc, decorations);
  }

  private updateDecorations(
    tr: Transaction,
    decorations: DecorationSet,
    oldState: EditorState,
    newState: EditorState,
    config: Config
  ) {
    const ranges = this.getAffectedRanges(tr, oldState, newState);
    if (!ranges.length) {
      return decorations.map(tr.mapping, tr.doc);
    }

    let nextDecorations = decorations.map(tr.mapping, tr.doc);
    const decorationsToRemove = ranges.flatMap((range) =>
      nextDecorations.find(range.from, range.to)
    );
    nextDecorations = nextDecorations.remove(decorationsToRemove);

    return nextDecorations.add(
      newState.doc,
      this.createDecorationsForRanges(newState, config, ranges)
    );
  }

  private createDecorationsForRanges(
    state: EditorState,
    config: Config,
    ranges: DecorationRange[]
  ) {
    const paragraphs = new Map<number, ParagraphWithPosition>();

    ranges.forEach((range) => {
      state.doc.nodesBetween(range.from, range.to, (node, pos, parent) => {
        if (node.type.name === "paragraph") {
          paragraphs.set(pos, {
            node,
            $start: state.doc.resolve(pos + 1),
            parent,
          });
          return false;
        }
        return true;
      });
    });

    let textContent: string | undefined;
    return filter(
      map([...paragraphs.values()], (para) => {
        const condMet = find(config, (conf) =>
          conf.condition({
            node: para.node,
            $start: para.$start,
            parent: para.parent,
            state,
            get textContent() {
              textContent ??= state.doc.textContent;
              return textContent;
            },
          })
        );
        return condMet
          ? Decoration.node(
              para.$start.pos - 1,
              para.$start.pos - 1 + para.node.nodeSize,
              {
                class: "placeholder",
                "data-empty-text": condMet.text,
              }
            )
          : undefined;
      }),
      (decoration) => decoration !== undefined
    );
  }

  private getAffectedRanges(
    tr: Transaction,
    oldState: EditorState,
    newState: EditorState
  ) {
    const ranges: DecorationRange[] = [];

    tr.mapping.maps.forEach((map, index) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        const subsequentMapping = tr.mapping.slice(index + 1);
        this.addContainingParagraphRange(
          newState,
          subsequentMapping.map(newStart),
          ranges
        );
        this.addContainingParagraphRange(
          newState,
          subsequentMapping.map(newEnd),
          ranges
        );
      });
    });

    if (tr.selectionSet) {
      this.addContainingParagraphRange(
        newState,
        tr.mapping.map(oldState.selection.from),
        ranges
      );
      this.addContainingParagraphRange(
        newState,
        tr.mapping.map(oldState.selection.to),
        ranges
      );
      this.addContainingParagraphRange(
        newState,
        newState.selection.from,
        ranges
      );
      this.addContainingParagraphRange(newState, newState.selection.to, ranges);
    }

    return this.mergeRanges(ranges);
  }

  private addContainingParagraphRange(
    state: EditorState,
    pos: number,
    ranges: DecorationRange[]
  ) {
    const resolvedPos = state.doc.resolve(
      Math.max(0, Math.min(pos, state.doc.content.size))
    );

    for (let depth = resolvedPos.depth; depth > 0; depth--) {
      if (resolvedPos.node(depth).type.name === "paragraph") {
        ranges.push({
          from: resolvedPos.before(depth),
          to: resolvedPos.after(depth),
        });
        return;
      }
    }
  }

  private mergeRanges(ranges: DecorationRange[]) {
    const sortedRanges = ranges
      .filter((range) => range.from < range.to)
      .sort((a, b) => a.from - b.from);
    const mergedRanges: DecorationRange[] = [];

    sortedRanges.forEach((range) => {
      const previousRange = mergedRanges[mergedRanges.length - 1];
      if (!previousRange || range.from > previousRange.to) {
        mergedRanges.push({ ...range });
        return;
      }

      previousRange.to = Math.max(previousRange.to, range.to);
    });

    return mergedRanges;
  }
}
