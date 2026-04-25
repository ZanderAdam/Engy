'use client';

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import Link from 'next/link';
import { useOptionalTab } from './tab-context';

type VLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  prefetch?: boolean;
};

export const VLink = forwardRef<HTMLAnchorElement, VLinkProps>(function VLink(
  { href, onClick, onAuxClick, children, ...rest },
  ref,
) {
  const tab = useOptionalTab();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (!tab) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      tab.openNewTab(href, e.shiftKey);
      return;
    }
    e.preventDefault();
    tab.pushVirtual(href);
  }

  function handleAuxClick(e: MouseEvent<HTMLAnchorElement>) {
    onAuxClick?.(e);
    if (e.defaultPrevented) return;
    if (!tab) return;
    if (e.button !== 1) return;
    e.preventDefault();
    tab.openNewTab(href, false);
  }

  if (!tab) {
    return (
      <Link ref={ref} href={href} {...rest} onClick={onClick} onAuxClick={onAuxClick}>
        {children}
      </Link>
    );
  }

  return (
    <Link
      ref={ref}
      href={href}
      {...rest}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
    >
      {children}
    </Link>
  );
});
