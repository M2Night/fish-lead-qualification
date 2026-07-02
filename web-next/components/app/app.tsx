'use client';

import { useMemo, useState } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import { type AppConfig, DEFAULT_LANGUAGE, DEFAULT_VOICE } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ErrorBoundary } from '@/components/app/error-boundary';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';

function AppSetup() {
  useAgentErrors();

  return null;
}

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  // The voice + language chosen on the landing page. They ride agentMetadata to the
  // worker, so they must be in the useSession options before start() runs.
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);

  // Recreate the token source whenever the selection changes so it starts with an
  // empty cache. livekit-client's TokenSourceCached has an inverted cache check
  // (shouldReturnCachedValueFromFetch returns the cached token when the fetch
  // options DIFFER from the cached ones), so a single reused source would hand back
  // the stale token minted for the previous selection. A fresh source per selection
  // sidesteps the bug — its cache is empty, so it always fetches with the current
  // agentMetadata.
  const tokenSource = useMemo(() => {
    return TokenSource.endpoint('/api/token');
    // `language`/`voice` are intentionally in the deps (not used in the body) to force
    // a fresh, empty-cache token source whenever the choice changes — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, voice]);

  const sessionOptions = useMemo(
    () => ({
      agentName: appConfig.agentName,
      agentMetadata: JSON.stringify({ language, voice }),
      agentConnectTimeoutMilliseconds: 20_000,
    }),
    [appConfig.agentName, language, voice]
  );

  const session = useSession(tokenSource, sessionOptions);

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ErrorBoundary>
          <ViewController
            appConfig={appConfig}
            language={language}
            voice={voice}
            onLanguageChange={setLanguage}
            onVoiceChange={setVoice}
          />
        </ErrorBoundary>
      </main>
      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
