/**
 * Copy text to the clipboard with a graceful fallback.
 *
 * `navigator.clipboard` is undefined in insecure contexts (plain http, some
 * mobile in-app browsers), where the modern API throws. This helper tries the
 * async Clipboard API first, then falls back to a temporary textarea +
 * `document.execCommand('copy')`, and never throws — callers receive a boolean
 * so they can decide whether to show success feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Insecure context or permission denied — fall through to the legacy path.
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
