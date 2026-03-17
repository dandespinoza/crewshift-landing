'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startOAuthFlow, disconnectIntegration } from '@/lib/integrations/oauth';
import type { ConnectionStatus } from '@/lib/integrations/types';

interface OAuthConnectButtonProps {
  provider: string;
  status: ConnectionStatus;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export function OAuthConnectButton({ provider, status, onStatusChange }: OAuthConnectButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleConnect = () => {
    startOAuthFlow(provider);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    const result = await disconnectIntegration(provider);
    setLoading(false);

    if (result.success) {
      onStatusChange?.('disconnected');
    }
  };

  if (status === 'connected') {
    return (
      <Button variant="outline" size="sm" loading={loading} onClick={handleDisconnect}>
        Disconnect
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={handleConnect}>
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
      Connect with OAuth
    </Button>
  );
}
