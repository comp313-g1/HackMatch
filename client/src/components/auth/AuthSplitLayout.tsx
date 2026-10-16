import React from 'react';

export interface AuthSplitLayoutProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * Presentational two-column auth card (stacks on mobile).
 * Left: serif title + short copy. Right: form / OAuth content.
 */
export function AuthSplitLayout({
  title,
  description,
  children,
}: AuthSplitLayoutProps): React.JSX.Element {
  return (
    <div className="w-full max-w-4xl mx-auto overflow-hidden rounded-xl border border-cream-200 bg-white shadow-sm md:grid md:grid-cols-2">
      <aside className="flex flex-col justify-center border-b border-cream-200 bg-cream-100 px-8 py-10 md:border-b-0 md:border-r">
        <h2 className="font-display text-3xl font-semibold tracking-tight text-forest-900 mb-3">
          {title}
        </h2>
        <p className="text-sm text-ink-muted leading-relaxed max-w-sm">{description}</p>
      </aside>
      <div className="px-6 py-8 sm:px-8">{children}</div>
    </div>
  );
}

export default AuthSplitLayout;
