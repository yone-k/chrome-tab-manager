import type { ButtonHTMLAttributes } from 'react';

import './button.css';

export type ButtonVariant = 'primary' | 'ghost';
export type ButtonSize = 'compact' | 'regular';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'ghost',
  size = 'compact',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = ['button', `button--${variant}`, `button--${size}`, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...props} />;
}
