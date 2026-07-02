'use client';

import { useMemo, useState } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { type AppConfig, DEFAULT_LANGUAGE, DEFAULT_VOICE } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { LeadQualView } from '@/components/app/lead-qual-view';

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
      <LeadQualView
        appConfig={appConfig}
        language={language}
        voice={voice}
        onLanguageChange={setLanguage}
        onVoiceChange={setVoice}
      />
    </AgentSessionProvider>
  );
}
