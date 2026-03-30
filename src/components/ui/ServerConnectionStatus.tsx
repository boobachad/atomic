import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useUIStore } from '../../stores/ui';

export function ServerConnectionStatus() {
  const serverConnected = useUIStore(s => s.serverConnected);
  const prevConnected = useRef<boolean | null>(null);
  const hasEverConnected = useRef(false);

  useEffect(() => {
    if (serverConnected) {
      // Only show reconnection toast if we previously had a successful connection
      // that was then lost — not on the very first connect
      if (hasEverConnected.current && prevConnected.current === false) {
        toast.success('Reconnected to server', { duration: 3000 });
      }
      hasEverConnected.current = true;
    }
    prevConnected.current = serverConnected;
  }, [serverConnected]);

  if (serverConnected || !hasEverConnected.current) {
    return null;
  }

  return (
    <div className="fixed bottom-5 left-5 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-lg">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
        <span className="text-sm text-[var(--color-text-secondary)]">
          Server disconnected — reconnecting...
        </span>
      </div>
    </div>
  );
}
