import { LANGUAGES, VOICES } from '@/app-config';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WelcomeViewProps {
  startButtonText: string;
  language: string;
  voice: string;
  onLanguageChange: (language: string) => void;
  onVoiceChange: (voice: string) => void;
  onStartCall: () => void;
}

export const WelcomeView = ({
  startButtonText,
  language,
  voice,
  onLanguageChange,
  onVoiceChange,
  onStartCall,
  ref,
}: React.ComponentProps<'div'> & WelcomeViewProps) => {
  return (
    <div ref={ref}>
      <section className="bg-background mx-auto flex max-w-prose flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="text-foreground text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
          Fish Lead Qualification
        </h1>

        <p className="text-muted-foreground mt-4 max-w-prose text-base leading-relaxed text-pretty md:text-lg">
          Talk to a LiveKit voice agent for lead qualification. Pick a voice and a language, then
          start the call.
        </p>

        <div className="mt-8 flex w-full max-w-md flex-col gap-4">
          <label className="flex flex-col gap-2 text-left">
            <span className="text-foreground text-sm font-medium">Voice</span>
            <Select value={voice} onValueChange={onVoiceChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-left">
            <span className="text-foreground text-sm font-medium">Language</span>
            <Select value={language} onValueChange={onLanguageChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <Button
          size="lg"
          onClick={onStartCall}
          className="mt-8 w-64 rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {startButtonText}
        </Button>
      </section>
    </div>
  );
};
