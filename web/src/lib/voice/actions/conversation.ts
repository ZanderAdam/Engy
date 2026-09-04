import type { VoiceAction } from '../registry';

interface ConversationActionsDeps {
  /** Read at run time, not at registry-build time: the mode can change
   * between the two, and the answer has to reflect what is true when spoken. */
  isActive: () => boolean;
  setActive: (on: boolean) => void;
}

/**
 * Hands-free back-and-forth with the focused terminal's agent: dictation
 * submits itself after a stretch of silence, so a reply needs no key and no
 * spoken "send".
 *
 * A mode rather than the default because auto-submitting is not always
 * wanted — dictating a long prompt in pieces needs those pauses to be free.
 */
export function createConversationActions(deps: ConversationActionsDeps): VoiceAction[] {
  return [
    {
      id: 'voice.conversation.start',
      title: 'Start a conversation',
      phrases: ['start conversation', 'start talking', 'conversation mode'],
      run: () => {
        if (deps.isActive()) return 'Already in a conversation.';
        deps.setActive(true);
        return 'Conversation on. I will send when you stop talking.';
      },
    },
    {
      id: 'voice.conversation.stop',
      title: 'End the conversation',
      phrases: ['stop conversation', 'stop talking', 'end conversation'],
      run: () => {
        if (!deps.isActive()) return 'Not in a conversation.';
        deps.setActive(false);
        return 'Conversation off.';
      },
    },
  ];
}
