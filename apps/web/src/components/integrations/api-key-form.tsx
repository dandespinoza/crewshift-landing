'use client';

import { useState } from 'react';
import { Eye, EyeOff, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AuthType, ConnectionStatus } from '@/lib/integrations/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const authLabels: Partial<Record<AuthType, { primary: string; secondary?: string }>> = {
  api_key: { primary: 'API Key' },
  bearer_token: { primary: 'API Token' },
  basic_auth: { primary: 'Username / ID', secondary: 'Password / Secret' },
  jwt: { primary: 'JWT Token' },
};

interface ApiKeyFormProps {
  provider: string;
  authType: AuthType;
  status: ConnectionStatus;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export function ApiKeyForm({ provider, authType, status, onStatusChange }: ApiKeyFormProps) {
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [showPrimary, setShowPrimary] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = authLabels[authType] || { primary: 'Credentials' };
  const needsSecondary = authType === 'basic_auth';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/integrations/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          credentials: needsSecondary
            ? { username: primary, password: secondary }
            : { token: primary },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to connect');
        return;
      }

      onStatusChange?.('connected');
      setPrimary('');
      setSecondary('');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'connected') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <Key className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-700">Credentials saved securely</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/integrations/${provider}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            setLoading(false);
            if (res.ok) onStatusChange?.('disconnected');
          }}
          loading={loading}
        >
          Remove credentials
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Primary credential */}
      <div className="space-y-1.5">
        <label htmlFor={`${provider}-primary`} className="text-sm font-medium text-text-primary">
          {labels.primary}
        </label>
        <div className="relative">
          <Input
            id={`${provider}-primary`}
            type={showPrimary ? 'text' : 'password'}
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder={`Enter your ${labels.primary.toLowerCase()}`}
            required
          />
          <button
            type="button"
            onClick={() => setShowPrimary(!showPrimary)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
          >
            {showPrimary ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Secondary credential (basic auth) */}
      {needsSecondary && labels.secondary && (
        <div className="space-y-1.5">
          <label htmlFor={`${provider}-secondary`} className="text-sm font-medium text-text-primary">
            {labels.secondary}
          </label>
          <div className="relative">
            <Input
              id={`${provider}-secondary`}
              type={showSecondary ? 'text' : 'password'}
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              placeholder={`Enter your ${labels.secondary.toLowerCase()}`}
              required
            />
            <button
              type="button"
              onClick={() => setShowSecondary(!showSecondary)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              {showSecondary ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <Button type="submit" size="sm" loading={loading} disabled={!primary}>
        <Key className="mr-1.5 h-3.5 w-3.5" />
        Save & Connect
      </Button>
    </form>
  );
}
