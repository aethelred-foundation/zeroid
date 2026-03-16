'use client';

import { Shield, ArrowLeft, Home } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-primary)]">
      <div className="text-center max-w-md px-6">
        <div className="relative mx-auto w-24 h-24 mb-8">
          <div className="absolute inset-0 shield-gradient rounded-3xl rotate-45 opacity-10" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield className="w-12 h-12 text-[var(--text-tertiary)]" />
          </div>
        </div>
        <h1 className="text-6xl font-bold text-[var(--text-tertiary)] mb-4">404</h1>
        <h2 className="text-xl font-semibold mb-2">Page Not Found</h2>
        <p className="text-[var(--text-secondary)] mb-8">
          The identity you're looking for doesn't exist or has been revoked.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/" className="btn-primary">
            <Home className="w-4 h-4" />
            Dashboard
          </Link>
          <button onClick={() => window.history.back()} className="btn-secondary">
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
