import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const aiSelectionDecorationPluginKey = new PluginKey<DecorationSet>(
  "ai-selection-decoration"
);

/**
 * Creates temporary decorations that keep AI-selected text visible while focus is
 * in the prompt input.
 *
 * @returns a ProseMirror plugin for AI selection decorations.
 */
export function createAISelectionDecorationPlugin() {
  return new Plugin<DecorationSet>({
    key: aiSelectionDecorationPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, decorations) {
        const meta = tr.getMeta(aiSelectionDecorationPluginKey);

        if (meta === null) {
          return DecorationSet.empty;
        }

        if (meta) {
          return DecorationSet.create(tr.doc, [
            Decoration.inline(meta.from, meta.to, {
              class: "ai-selection-decoration",
            }),
          ]);
        }

        return decorations.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return aiSelectionDecorationPluginKey.getState(state);
      },
    },
  });
}
