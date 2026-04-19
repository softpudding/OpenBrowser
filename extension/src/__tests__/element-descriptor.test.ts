import { describe, expect, test } from 'bun:test';

// The descriptor module is plain JS designed for page-context injection; it
// also exports via CommonJS so tests can import it directly. Bun interprets
// the default-export as the module.exports object.
import descriptorModule from '../commands/element-descriptor.injected.js';

const { buildElementDescriptor } = descriptorModule as unknown as {
  buildElementDescriptor: (element: unknown) => Record<string, unknown>;
};

type Attrs = Record<string, string | null>;

interface MockOptions {
  tagName: string;
  attrs?: Attrs;
  textContent?: string;
  value?: string;
  checked?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  options?: MockElement[];
  labelNode?: MockElement;
  selectedOptions?: MockElement[];
  parent?: MockElement;
  classList?: string[];
  children?: MockElement[];
  descendants?: Record<string, MockElement>;
}

class MockElement {
  nodeType = 1;
  tagName: string;
  attrs: Attrs;
  textContent: string;
  value?: string;
  checked?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  options: MockElement[];
  selectedOptions: MockElement[];
  labelNode?: MockElement;
  selected?: boolean;
  parentElement: MockElement | null;
  classList: string[];
  children: MockElement[];
  descendants: Record<string, MockElement>;

  constructor(options: MockOptions) {
    this.tagName = options.tagName.toUpperCase();
    this.attrs = options.attrs ?? {};
    this.textContent = options.textContent ?? '';
    this.value = options.value;
    this.checked = options.checked;
    this.multiple = options.multiple;
    this.disabled = options.disabled;
    this.options = options.options ?? [];
    this.selectedOptions = options.selectedOptions ?? [];
    this.labelNode = options.labelNode;
    this.parentElement = options.parent ?? null;
    this.classList = options.classList ?? [];
    this.children = options.children ?? [];
    this.descendants = options.descendants ?? {};
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  querySelector(selector: string): MockElement | null {
    return this.descendants[selector] ?? null;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
      ? (this.attrs[name] ?? null)
      : null;
  }

  cloneNode(): MockElement {
    return new MockElement({
      tagName: this.tagName,
      attrs: { ...this.attrs },
      textContent: this.textContent,
    });
  }

  querySelectorAll(selector: string): MockElement[] {
    if (this.tagName.toLowerCase() === 'select' && selector === 'option') {
      return this.options;
    }
    return [];
  }

  closest(sel: string): MockElement | null {
    if (sel === 'label' && this.labelNode) return this.labelNode;
    return null;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 10, height: 10, top: 0, bottom: 0, left: 0, right: 0 };
  }

  remove() {
    // no-op — used by descriptor's label cloning path.
  }

  get ownerDocument() {
    return {
      body: null,
      getElementById: (_id: string) => null,
      querySelector: (_sel: string) => null,
    };
  }
}

function el(options: MockOptions): MockElement {
  return new MockElement(options);
}

describe('buildElementDescriptor', () => {
  test('plain button with aria-label captures name and tag', () => {
    const descriptor = buildElementDescriptor(
      el({ tagName: 'button', attrs: { 'aria-label': 'Close' } }),
    );
    expect(descriptor).toMatchObject({ tag: 'button', name: 'Close' });
    expect((descriptor as { text?: string }).text).toBeUndefined();
  });

  test('link surfaces short href and visible text', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'a',
        textContent: '  AAPL  ',
        attrs: { href: '/stocks/aapl' },
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'a',
      text: 'AAPL',
      href: '/stocks/aapl',
    });
  });

  test('email input exposes placeholder and value', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'input',
        attrs: { type: 'email', placeholder: 'you@example.com' },
        value: 'alice@x.io',
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'input',
      inputType: 'email',
      placeholder: 'you@example.com',
      value: 'alice@x.io',
    });
  });

  test('password input masks the value', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'input',
        attrs: { type: 'password' },
        value: 'hunter2',
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'input',
      inputType: 'password',
      value: '•••',
    });
  });

  test('checkbox reports checked state', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'input',
        attrs: { type: 'checkbox' },
        checked: true,
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'input',
      inputType: 'checkbox',
      checked: true,
    });
  });

  test('select emits every option including optgroup and disabled/selected flags', () => {
    const group = el({ tagName: 'optgroup', attrs: { label: 'Americas' } });
    const opt1 = el({
      tagName: 'option',
      textContent: 'United States',
      value: 'US',
      parent: group,
    });
    opt1.selected = true;
    const opt2 = el({
      tagName: 'option',
      textContent: 'Canada',
      value: 'CA',
      parent: group,
    });
    const opt3 = el({
      tagName: 'option',
      textContent: 'Unavailable',
      value: 'XX',
      parent: group,
    });
    opt3.disabled = true;

    const select = el({
      tagName: 'select',
      attrs: { name: 'country' },
      options: [opt1, opt2, opt3],
      value: 'US',
    });

    const descriptor = buildElementDescriptor(select) as {
      tag: string;
      options: Array<Record<string, unknown>>;
      value?: string;
      name?: string;
    };

    expect(descriptor.tag).toBe('select');
    expect(descriptor.options).toHaveLength(3);
    expect(descriptor.options[0]).toMatchObject({
      value: 'US',
      label: 'United States',
      selected: true,
      group: 'Americas',
    });
    expect(descriptor.options[2]).toMatchObject({
      value: 'XX',
      label: 'Unavailable',
      disabled: true,
    });
    expect(descriptor.value).toBe('US');
  });

  test('div with role=button and no text falls back to accessible name', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'div',
        attrs: { role: 'button', title: 'Filter by date' },
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'div',
      role: 'button',
      name: 'Filter by date',
    });
  });

  test('anonymous span falls back to class tokens and icon hint', () => {
    const useNode = el({
      tagName: 'use',
      attrs: { 'xlink:href': '#like' },
    });
    const iconChild = el({
      tagName: 'svg',
      classList: ['reds-icon', 'like-icon'],
      descendants: { use: useNode },
    });
    const span = el({
      tagName: 'span',
      classList: ['like-wrapper', 'like-active'],
      children: [iconChild],
      descendants: { use: useNode, 'img[alt], [aria-label]': null as any },
    });
    const descriptor = buildElementDescriptor(span) as {
      tag: string;
      classHint?: string[];
      icon?: string;
      text?: string;
      name?: string;
    };
    expect(descriptor.tag).toBe('span');
    expect(descriptor.text).toBeUndefined();
    expect(descriptor.name).toBeUndefined();
    expect(descriptor.classHint).toContain('like-wrapper');
    expect(descriptor.classHint).toContain('like-active');
    expect(descriptor.icon).toBe('like');
  });

  test('class fallback skips Vue scope hashes and utility noise', () => {
    const span = el({
      tagName: 'span',
      classList: [
        'data-v-9403e00c',
        'wrapper',
        'mt-2',
        'js-like-toggle',
      ],
      attrs: {},
    });
    const descriptor = buildElementDescriptor(span) as {
      classHint?: string[];
    };
    expect(descriptor.classHint).toEqual(['js-like-toggle']);
  });

  test('class fallback suppressed when text is present', () => {
    const span = el({
      tagName: 'span',
      classList: ['like-wrapper', 'like-active'],
      textContent: 'Like',
    });
    const descriptor = buildElementDescriptor(span) as {
      classHint?: string[];
      text?: string;
    };
    expect(descriptor.text).toBe('Like');
    expect(descriptor.classHint).toBeUndefined();
  });

  test('disabled attribute and aria-expanded become flags', () => {
    const descriptor = buildElementDescriptor(
      el({
        tagName: 'button',
        textContent: 'Advanced options',
        attrs: { 'aria-expanded': 'false', disabled: '' },
      }),
    );
    expect(descriptor).toMatchObject({
      tag: 'button',
      text: 'Advanced options',
      disabled: true,
      expanded: false,
    });
  });
});
