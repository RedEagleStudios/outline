import { useCallback } from "react";
import ColorPicker from "@shared/components/ColorPicker";
import { useEditor } from "./EditorContext";

type Props = {
  /** The currently active color. */
  activeColor: string;
};

function TextColorPicker({ activeColor }: Props) {
  const { commands } = useEditor();

  const handleSelect = useCallback(
    (color: string) => {
      if (commands.text_color) {
        commands.text_color({ color });
      }
    },
    [commands]
  );

  return (
    <ColorPicker
      alpha={false}
      activeColor={activeColor}
      onSelect={handleSelect}
    />
  );
}

export default TextColorPicker;
