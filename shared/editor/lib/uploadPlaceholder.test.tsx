/** @jest-environment jsdom */

import { EditorState } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import ReactDOM from "react-dom";
import uploadPlaceholder from "./uploadPlaceholder";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});

interface AddPlaceholder {
  id: string;
  pos: number;
  file: File;
  src?: string;
  isImage?: boolean;
  isVideo?: boolean;
}

describe("uploadPlaceholder", () => {
  const createObjectURL = jest.fn(() => "blob:preview");
  const revokeObjectURL = jest.fn();
  let mount: HTMLDivElement;
  let view: EditorView;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    view = new EditorView(mount, {
      state: EditorState.create({ schema, plugins: [uploadPlaceholder] }),
    });
  });

  afterEach(() => {
    view.destroy();
    mount.remove();
    jest.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  const add = (placeholder: AddPlaceholder) => {
    view.dispatch(
      view.state.tr.setMeta(uploadPlaceholder, { add: placeholder })
    );
  };

  const remove = (id: string) => {
    view.dispatch(view.state.tr.setMeta(uploadPlaceholder, { remove: { id } }));
  };

  it.each(["image", "video"])(
    "revokes an internally created %s URL once when removed",
    (kind) => {
      add({
        id: kind,
        pos: 0,
        file: new File([kind], `${kind}.bin`),
        isImage: kind === "image",
        isVideo: kind === "video",
      });

      remove(kind);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      view.destroy();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    }
  );

  it("revokes an internally created preview once when the editor is destroyed", () => {
    add({
      id: "image",
      pos: 0,
      file: new File(["image"], "image.png"),
      isImage: true,
    });

    view.destroy();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does not create or revoke a caller-owned image URL", () => {
    add({
      id: "image",
      pos: 0,
      file: new File(["image"], "image.png"),
      src: "https://example.com/image.png",
      isImage: true,
    });

    remove("image");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("unmounts a file widget once when the editor is destroyed", () => {
    const unmount = jest.spyOn(ReactDOM, "unmountComponentAtNode");
    add({
      id: "file",
      pos: 0,
      file: new File(["file"], "document.pdf"),
    });

    view.destroy();
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});
