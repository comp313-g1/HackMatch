import React, { useEffect, useRef } from 'react';

export interface HeaderMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface HeaderMenuProps {
  /** Accessible name of the menu, e.g. "Account" or "Admin". */
  label: string;
  /** Visible trigger text (the ▾ arrow is added and hidden from screen readers). */
  triggerText: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: HeaderMenuItem[];
  triggerClassName: string;
  containerClassName?: string;
}

const itemClass =
  'block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-cream-50 focus:bg-cream-100 focus:outline-none disabled:opacity-50';

/**
 * Keyboard-operable header dropdown (WCAG 2.1.1 / ARIA menu button pattern):
 * Enter/Space/ArrowDown open and focus the first item, ArrowUp opens on the last item,
 * ArrowUp/ArrowDown/Home/End move between items, Escape closes and returns focus to the
 * trigger, and Tab closes the menu so focus continues through the page.
 */
export function HeaderMenu({
  label,
  triggerText,
  open,
  onOpenChange,
  items,
  triggerClassName,
  containerClassName = 'relative',
}: HeaderMenuProps): React.JSX.Element {
  const menuId = React.useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Which item to focus when the menu opens from the keyboard (null = keep focus on trigger). */
  const pendingFocus = useRef<'first' | 'last' | null>(null);

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  const focusItem = (index: number | undefined) => {
    if (index === undefined) return;
    itemRefs.current[index]?.focus();
  };

  useEffect(() => {
    if (!open || pendingFocus.current === null) return;
    focusItem(
      pendingFocus.current === 'first'
        ? enabledIndexes[0]
        : enabledIndexes[enabledIndexes.length - 1]
    );
    pendingFocus.current = null;
    // enabledIndexes is derived from items; only re-run when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openWithFocus = (where: 'first' | 'last') => {
    pendingFocus.current = where;
    if (open) {
      focusItem(where === 'first' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
      pendingFocus.current = null;
    } else {
      onOpenChange(true);
    }
  };

  const closeAndReturnFocus = () => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openWithFocus('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openWithFocus('last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  const onTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation (Enter/Space) reports detail 0: move focus into the menu.
    if (!open && event.detail === 0) pendingFocus.current = 'first';
    onOpenChange(!open);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const position = enabledIndexes.indexOf(current);
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        focusItem(enabledIndexes[(position + 1) % enabledIndexes.length]);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        focusItem(
          enabledIndexes[(position - 1 + enabledIndexes.length) % enabledIndexes.length]
        );
        break;
      }
      case 'Home':
        event.preventDefault();
        focusItem(enabledIndexes[0]);
        break;
      case 'End':
        event.preventDefault();
        focusItem(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        closeAndReturnFocus();
        break;
      case 'Tab':
        onOpenChange(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className={containerClassName} data-nav-menu-root="true">
      <button
        ref={triggerRef}
        type="button"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        className={triggerClassName}
      >
        {triggerText} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 mt-2 w-44 rounded-lg border border-cream-200 bg-white shadow-sm p-1 z-50"
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={item.onSelect}
              disabled={item.disabled}
              className={itemClass}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
