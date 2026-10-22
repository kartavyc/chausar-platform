import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from './cx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one filled button in a row. secondary: outlined. quiet: reads like a link. */
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', className, type = 'button', ref, ...rest }: ButtonProps) {
  return <button ref={ref} type={type} className={cx(s.button, s[variant], className)} data-variant={variant} {...rest} />;
}
