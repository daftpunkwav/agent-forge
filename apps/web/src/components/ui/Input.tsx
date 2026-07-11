import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <span
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 6,
          color: 'var(--foreground)',
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--muted-foreground)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
