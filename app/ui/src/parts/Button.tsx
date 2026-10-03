/**
 * Button: filled (the one main action, in ink), quiet (hairline outline), or link.
 * One filled button at most on a page or a sheet; the pattern that composes them keeps
 * that rule. A destructive action is quiet with red text and asks once more by name.
 * A button's word is the action. No fixed width, so Hindi can be longer.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Button.module.css';

export type ButtonVariant = 'filled' | 'quiet' | 'link';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  variant?: ButtonVariant | undefined;
  danger?: boolean | undefined;
  /** The button of a form: pressing it, or Enter in the form's field, submits the form. */
  submit?: boolean | undefined;
  children: ReactNode;
}

export function Button({ variant = 'quiet', danger = false, submit = false, className, children, ...rest }: ButtonProps) {
  const cls = [s.button, s[variant], danger ? s.danger : '', 'm-press', className].filter(Boolean).join(' ');
  return (
    <button type={submit ? 'submit' : 'button'} className={cls} {...rest}>
      {children}
    </button>
  );
}
