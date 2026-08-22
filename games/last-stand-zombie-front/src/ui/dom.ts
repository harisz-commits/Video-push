/**
 * Winzige DOM-Helfer. Die UI ist bewusst HTML/CSS statt Babylon-GUI:
 * kleineres Bundle, echte Textdarstellung, native Safe-Area-Unterstuetzung.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = el('button', `btn clickable ${className}`.trim(), label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * Ein UI-Layer haengt unter `#ui-root` und wird beim Szenenwechsel restlos
 * entfernt — so kann keine Szene DOM-Reste hinterlassen.
 */
export class UiLayer {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, className: string) {
    this.root = el('div', `layer ${className}`);
    parent.appendChild(this.root);
  }

  add<T extends HTMLElement>(node: T): T {
    this.root.appendChild(node);
    return node;
  }

  dispose(): void {
    this.root.remove();
  }
}
