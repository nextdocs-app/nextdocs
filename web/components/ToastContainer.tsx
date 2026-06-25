'use client';

import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { removeToast, type Toast } from '@/stores/toasts/toasts.slice';

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(() => {
      dispatch(removeToast(toast.id));
    }, duration);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id, toast.duration]);

  // Color mapping based on toast type
  let accentColor = '#3b82f6'; // info (blue)
  let icon = (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );

  if (toast.type === 'success') {
    accentColor = '#10b981'; // green
    icon = (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  } else if (toast.type === 'warning') {
    accentColor = '#f59e0b'; // amber/yellow
    icon = (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    );
  } else if (toast.type === 'error') {
    accentColor = '#ef4444'; // red
    icon = (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  }

  return (
    <div
      role="alert"
      className="nd-toast-item animate-fade-in"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        borderRadius: '8px',
        borderLeft: `4px solid ${accentColor}`,
        background: 'var(--toast-bg, rgba(255, 255, 255, 0.85))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        color: 'var(--foreground)',
        fontSize: '14px',
        fontWeight: 500,
        width: '320px',
        transition: 'all 0.2s ease-in-out',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ color: accentColor, display: 'flex', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, wordBreak: 'break-word', lineHeight: '1.4' }}>{toast.message}</div>
      <button
        onClick={() => dispatch(removeToast(toast.id))}
        aria-label="Close notification"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          color: 'var(--foreground)',
          opacity: 0.5,
          display: 'flex',
          flexShrink: 0,
          borderRadius: '4px',
          transition: 'opacity 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAppSelector((state) => state.toasts.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '12px',
        pointerEvents: 'none',
      }}
    >
      {/* Dynamic style tag for CSS variable and animations support */}
      <style>{`
        :root {
          --toast-bg: rgba(255, 255, 255, 0.85);
        }
        .dark {
          --toast-bg: rgba(30, 30, 30, 0.85);
        }
        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .nd-toast-item {
          animation: toastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
