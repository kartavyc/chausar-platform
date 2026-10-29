// Original shared plain-text shortening, with no source or runtime access.
/** Shortens text for a check detail without cutting it in the middle of a long line. */
export function quote(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 3).trimEnd()}...`;
}
