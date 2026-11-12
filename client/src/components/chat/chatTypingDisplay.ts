/**
 * US-035 / #408 — wording for the typing indicator (#404 policy, section 5:
 * up to 3 handles, then "Several people are typing"). Handles are display data
 * from the server event; a missing handle reads as "Someone". The order is
 * alphabetical so the text does not reshuffle as people refresh their signal.
 */
export function typingSummary(handles: Array<string | null>): string {
  const names = [...new Set(handles.map((handle) => handle ?? 'Someone'))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]} are typing…`;
  return 'Several people are typing…';
}
