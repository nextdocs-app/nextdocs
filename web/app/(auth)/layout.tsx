import '@/styles/auth.css';

/**
 * Public auth routes share the warm, light-only surface. Neither the app store
 * nor the shell is mounted here, so this bundle stays small.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="nd-auth-root">{children}</div>;
}
