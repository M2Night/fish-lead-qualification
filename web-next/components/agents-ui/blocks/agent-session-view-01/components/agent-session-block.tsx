'use client';

import React from 'react';
import { type MotionProps, motion } from 'motion/react';
import { useSessionContext, useVoiceAssistant } from '@livekit/components-react';
import { AgentAudioVisualizerBar } from '@/components/agents-ui/agent-audio-visualizer-bar';
import {
  AgentControlBar,
  type AgentControlBarControls,
} from '@/components/agents-ui/agent-control-bar';
import { cn } from '@/lib/shadcn/utils';

const BOTTOM_VIEW_MOTION_PROPS: MotionProps = {
  variants: {
    visible: {
      opacity: 1,
      translateY: '0%',
    },
    hidden: {
      opacity: 0,
      translateY: '100%',
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.3,
    delay: 0.5,
    ease: 'easeOut',
  },
};

export interface AgentSessionView_01Props {
  /**
   * Enables or disables camera controls in the bottom control bar.
   *
   * @default false
   */
  supportsVideoInput?: boolean;
  /**
   * Enables or disables screen sharing controls in the bottom control bar.
   *
   * @default false
   */
  supportsScreenShare?: boolean;
  /**
   * Kept for API compatibility with the view controller; unused in this voice-only view.
   */
  isPreConnectBufferEnabled?: boolean;

  /** Optional class name merged onto the outer `<section>` container. */
  className?: string;
}

export function AgentSessionView_01({
  supportsVideoInput = false,
  supportsScreenShare = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isPreConnectBufferEnabled,
  ref,
  className,
  ...props
}: React.ComponentProps<'section'> & AgentSessionView_01Props) {
  const session = useSessionContext();
  const { state: agentState, audioTrack } = useVoiceAssistant();

  const controls: AgentControlBarControls = {
    leave: true,
    microphone: true,
    camera: supportsVideoInput,
    screenShare: supportsScreenShare,
  };

  return (
    <section
      ref={ref}
      className={cn('bg-background relative z-10 h-full w-full overflow-hidden', className)}
      {...props}
    >
      {/* Centered audio visualizer */}
      <div className="absolute inset-0 flex items-center justify-center">
        <AgentAudioVisualizerBar
          size="lg"
          state={agentState}
          audioTrack={audioTrack}
          className="text-foreground"
        />
      </div>

      {/* Bottom control bar */}
      <motion.div
        {...BOTTOM_VIEW_MOTION_PROPS}
        className="absolute inset-x-3 bottom-0 z-50 md:inset-x-12"
      >
        <div className="bg-background relative mx-auto max-w-2xl pb-3 md:pb-12">
          <AgentControlBar
            variant="livekit"
            controls={controls}
            isConnected={session.isConnected}
            onDisconnect={session.end}
          />
        </div>
      </motion.div>
    </section>
  );
}
