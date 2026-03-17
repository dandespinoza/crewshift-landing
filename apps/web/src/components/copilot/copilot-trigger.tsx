'use client';

import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

interface CopilotTriggerProps {
  hasNotification?: boolean;
}

export function CopilotTrigger({ hasNotification = false }: CopilotTriggerProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push('/copilot')}
      aria-label="Open AI Copilot"
      className="
        fixed bottom-6 right-6 z-50
        h-14 w-14
        flex items-center justify-center
        bg-accent-600 text-white
        rounded-full
        shadow-2
        transition-all duration-200
        hover:bg-accent-700 hover:shadow-3 hover:scale-105
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2
      "
    >
      <MessageSquare className="h-6 w-6" strokeWidth={2} />

      {hasNotification && (
        <span
          aria-label="New suggestions available"
          className="
            absolute top-1 right-1
            h-3 w-3
            rounded-full
            bg-danger-solid
            border-2 border-white
          "
        />
      )}
    </button>
  );
}
