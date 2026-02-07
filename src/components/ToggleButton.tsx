import type { ButtonHTMLAttributes, MouseEventHandler } from 'react';

import './toggle-button.css';

type ToggleButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> & {
  pressed: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: MouseEventHandler<HTMLButtonElement>;
  ariaLabelOn?: string;
  ariaLabelOff?: string;
};

export function ToggleButton({
  pressed,
  onLabel,
  offLabel,
  onToggle,
  ariaLabelOn,
  ariaLabelOff,
  className,
  type = 'button',
  ...props
}: ToggleButtonProps) {
  const classes = ['button', 'button--ghost', 'button--compact', 'toggle-button'];
  if (pressed) {
    classes.push('toggle-button--pressed');
  }
  if (className) {
    classes.push(className);
  }
  const currentLabel = pressed ? onLabel : offLabel;
  const currentAriaLabel = pressed ? (ariaLabelOn ?? onLabel) : (ariaLabelOff ?? offLabel);
  return (
    <button
      type={type}
      className={classes.join(' ')}
      aria-pressed={pressed}
      aria-label={currentAriaLabel}
      title={currentLabel}
      onClick={onToggle}
      {...props}
    >
      {currentLabel}
    </button>
  );
}
