'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accessKey }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push('/dashboard');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-noise">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="border-b-2 border-neutral-800 pb-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 bg-neutral-900"></div>
            <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
              Raisedash <span className="font-light text-neutral-500">KPI</span>
            </h1>
          </div>
          <p className="text-xs text-neutral-500 pl-5 uppercase tracking-wider">
            Access Control System
          </p>
        </div>

        {/* Login Card */}
        <div className="tech-border bg-white/50 p-6">
          <div className="section-header mb-6">
            <div className="section-tag">Authentication</div>
            <div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="access-key" className="block text-xs uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                Access Key
              </label>
              <input
                id="access-key"
                name="access-key"
                type="text"
                required
                className="tech-input w-full"
                placeholder="ENTER YOUR ACCESS KEY"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="tech-border bg-neutral-100 p-3">
                <div className="flex items-start gap-2">
                  <div className="w-1 h-1 bg-neutral-900 mt-1.5"></div>
                  <p className="text-xs text-neutral-900 font-mono tracking-wide">{error}</p>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="tech-button w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 bg-neutral-900 animate-pulse-subtle"></span>
                    Processing...
                  </span>
                ) : (
                  'Authenticate'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-neutral-300">
            <p className="text-[10px] text-neutral-400 uppercase tracking-wider text-center">
              Secure Access · Authorized Personnel Only
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] text-neutral-400 uppercase tracking-wider">
          <p>Raisedash KPI Dashboard v1.0</p>
        </div>
      </div>
    </div>
  );
}
