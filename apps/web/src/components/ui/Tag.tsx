import type { ReactNode } from 'react';

export function Tag({
  children,
  variant = 'muted',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'muted' | 'outline';
}) {
  return <span className={`tag tag-${variant}`}>{children}</span>;
}
