/**
 * Ctrl+W. Most terminal programs delete the word before the cursor when they
 * read it, because readline gives it that function.
 *
 * This is a deliberate approximation. The byte goes to whichever program holds
 * the PTY, and this module knows nothing about that program. A program with a
 * different function for Ctrl+W gets an action the gesture did not intend. Keep
 * it: the alternative is to send nothing, and both gestures that use it then do
 * nothing at all — which is the fault this module exists to correct.
 */
const DELETE_WORD = '\x17';

/**
 * Change one `beforeinput` event into the bytes for a PTY. Returns null to
 * ignore the event.
 *
 * The function ignores `insertCompositionText` and `insertFromPaste`. The
 * emulator commits these through its own `compositionend` and `paste` handlers.
 * If this function also sent them, the terminal got each composed word twice.
 */
export function softKeyboardBytes(inputType: string, data: string | null): string | null {
  switch (inputType) {
    case 'insertText':
      return data ? data.replace(/\n/g, '\r') : null;
    case 'insertReplacementText':
      // The keyboard replaces the word before the cursor with a correction.
      // Delete that word first. The event identifies the text to replace with a
      // DOM range, which a PTY cannot use — and `getTargetRanges()` gives an
      // empty list for a textarea. Without the delete, the terminal keeps the
      // original word and puts the correction after it: "teh" becomes "tehthe".
      return data ? DELETE_WORD + data.replace(/\n/g, '\r') : null;
    case 'insertLineBreak':
    case 'insertParagraph':
      return '\r';
    case 'deleteWordBackward':
      // A swipe on the backspace key, or a long press on iOS.
      return DELETE_WORD;
    case 'deleteContentBackward':
      return '\x7f';
    case 'deleteContentForward':
      return '\x1b[3~';
    default:
      return null;
  }
}

/**
 * Send on-screen keyboard input to the PTY.
 *
 * ghostty-web 0.4.0 reads keyboard input only from `keydown`. A physical
 * keyboard sends `keydown`. An on-screen keyboard usually does not: Android and
 * iOS send the characters as `beforeinput`, and give the placeholder value 229
 * for `keyCode` on `keydown`. The emulator discards these. Thus the terminal
 * shows output but ignores the on-screen keyboard.
 *
 * The listener uses the capture phase on the container. Therefore it gets each
 * event before the textarea that the emulator made, and no later handler sends
 * the same keystroke again.
 *
 * Upstream added a `beforeinput` path after release 0.4.0. Remove this module
 * when that release is available.
 */
export function attachSoftKeyboardInput(
  container: HTMLElement,
  send: (data: string) => void,
): () => void {
  const onBeforeInput = (event: Event) => {
    const { inputType, data } = event as InputEvent;
    const bytes = softKeyboardBytes(inputType, data);
    if (bytes === null) return;
    event.preventDefault();
    event.stopPropagation();
    send(bytes);
  };

  container.addEventListener('beforeinput', onBeforeInput, true);
  return () => container.removeEventListener('beforeinput', onBeforeInput, true);
}
