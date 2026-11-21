import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderMenu } from './HeaderMenu';

function Harness({ onProfile = vi.fn(), signOutDisabled = false }) {
  const [open, setOpen] = useState(false);
  return (
    <HeaderMenu
      label="Account"
      triggerText="Sahil"
      open={open}
      onOpenChange={setOpen}
      triggerClassName=""
      items={[
        { key: 'profile', label: 'Profile', onSelect: onProfile },
        { key: 'settings', label: 'Settings', onSelect: vi.fn() },
        { key: 'sign-out', label: 'Sign out', onSelect: vi.fn(), disabled: signOutDisabled },
      ]}
    />
  );
}

const trigger = () => screen.getByRole('button', { name: 'Sahil' });

describe('HeaderMenu keyboard support (WCAG 2.1.1)', () => {
  it('hides the ▾ arrow from the accessible name and starts closed', () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on ArrowDown and focuses the first item', () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus();
  });

  it('opens on ArrowUp and focuses the last enabled item', () => {
    render(<Harness signOutDisabled />);
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
  });

  it('moves with ArrowDown/ArrowUp (wrapping), Home and End', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  it('closes on Escape when opened with the mouse and focus is still on the trigger', () => {
    render(<Harness />);
    fireEvent.click(trigger(), { detail: 1 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when Tab moves focus out of the menu', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keyboard activation (Enter/Space click) moves focus into the menu', () => {
    render(<Harness />);
    fireEvent.click(trigger(), { detail: 0 });
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus();
  });

  it('runs the item action on click', () => {
    const onProfile = vi.fn();
    render(<Harness onProfile={onProfile} />);
    fireEvent.click(trigger(), { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(onProfile).toHaveBeenCalledTimes(1);
  });
});
