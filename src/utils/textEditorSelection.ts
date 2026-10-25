/** Map DOM endpoints through all text descendants, not just the first text node.
 * Element offsets count children; root offsets count source lines. */
export function textEditorSourceOffset(editor: HTMLElement, node: Node, offset: number): number {
  const lines = Array.from(editor.querySelectorAll<HTMLElement>('[data-line]'));
  if (node === editor) {
    const preceding = Array.from(editor.childNodes).slice(0, offset);
    return Math.min(lines.map(line => line.textContent ?? '').join('\n').length,
      preceding.reduce((sum, child) => sum + (child.textContent?.length ?? 0) + 1, 0));
  }
  let start = 0;
  for (const line of lines) {
    if (line.contains(node)) {
      const range = document.createRange();
      range.selectNodeContents(line);
      range.setEnd(node, offset);
      return start + range.toString().length;
    }
    start += (line.textContent?.length ?? 0) + 1;
  }
  return 0;
}

export function textEditorCursorPoint(editor: HTMLElement, offset: number): [Node, number] {
  const lines = Array.from(editor.querySelectorAll<HTMLElement>('[data-line]'));
  let remaining = Math.max(0, offset);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const length = line.textContent?.length ?? 0;
    if (remaining <= length || i === lines.length - 1) {
      remaining = Math.min(remaining, length);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const size = node.textContent?.length ?? 0;
        if (remaining <= size) return [node, remaining];
        remaining -= size;
        node = walker.nextNode();
      }
      return [line, 0];
    }
    remaining -= length + 1;
  }
  return [editor, 0];
}
