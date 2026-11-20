import { isValidElement, type ReactNode } from 'react';
import RootLayout from '@/app/layout';
import { SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT } from '@/lib/sidebar-preferences.util';

jest.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter' }),
}));

type TestElement = { type: unknown; props: Record<string, unknown> };

/** The scripts that have to paint before the body does. */
function headScripts(): string[] {
  const html = RootLayout({ children: null }) as unknown as TestElement;
  const children = html.props.children as ReactNode[];
  const head = children.find(
    (child): child is React.ReactElement => isValidElement(child) && child.type === 'head'
  );
  const headChildren = (head?.props as { children?: ReactNode }).children;
  const nodes = Array.isArray(headChildren) ? headChildren : [headChildren];

  return nodes.filter(isValidElement).map((node) => {
    const props = (node as React.ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>)
      .props;
    return props.dangerouslySetInnerHTML?.__html ?? '';
  });
}

describe('RootLayout', () => {
  it('resolves the stored rail collapse before the first paint', () => {
    const scripts = headScripts();

    expect(scripts).toContain(SIDEBAR_PREFERENCES_BOOTSTRAP_SCRIPT);
  });
});
