import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setBridgeEnabled, useBridgeStatus } from './status';

const LABEL = { off: 'Claude: off', connecting: 'Claude: connecting…', connected: 'Claude: connected' } as const;

/** Lets Claude Code drive this tab through the Spon MCP server. A click turns it on (taking over from another tab) or off. */
export function ClaudeStatus() {
  const { status, message } = useBridgeStatus();
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1"
        data-testid="bridge-toggle"
        data-status={status}
        title={status === 'off' ? 'Let Claude Code drive this tab through the Spon MCP server' : 'Disconnect Claude'}
        onClick={() => void setBridgeEnabled(status === 'off', true)}
      >
        <Bot className={cn('size-3.5', status === 'connected' && 'text-emerald-500', status === 'connecting' && 'animate-pulse')} />
        {LABEL[status]}
      </Button>
      {message && <span className="text-amber-500" data-testid="bridge-message">{message}</span>}
    </span>
  );
}
