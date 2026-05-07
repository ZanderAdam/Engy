import type { DefaultReactSuggestionItem } from "@blocknote/react";

const STARTER_DIAGRAM = "flowchart TD\n  A --> B";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function insertMermaidItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Mermaid diagram",
    subtext: "Insert a flowchart, sequence, or other mermaid diagram",
    aliases: ["mermaid", "diagram", "flowchart"],
    group: "Diagrams",
    onItemClick: () => {
      const cursor = editor.getTextCursorPosition();
      editor.insertBlocks(
        [{ type: "mermaid", props: { code: STARTER_DIAGRAM } }],
        cursor.block,
        "after",
      );
    },
  };
}
