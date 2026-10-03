/** Empty input has no request. Reviewed wording is passed verbatim, including
 * leading/trailing spaces and line breaks; the Engine owns disclosure limits. */
export function submittedQuestion(text: string): string | null {
  return text.trim().length === 0 ? null : text;
}
