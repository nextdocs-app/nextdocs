'use client';

import { useState, type ChangeEvent } from 'react';
import { Eye, EyeOff } from '@/icons';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}

/** Password input with an accessible show/hide toggle. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
  maxLength,
  required,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const toggleLabel = `${isVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`;

  return (
    <div className="nd-auth-field">
      <label className="nd-auth-label" htmlFor={id}>
        {label}
      </label>
      <div className="nd-auth-password">
        <input
          id={id}
          className="nd-auth-input"
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          maxLength={maxLength}
          required={required}
        />
        <button
          type="button"
          className="nd-auth-password-toggle"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {isVisible ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </div>
  );
}
