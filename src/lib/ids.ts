/** A short random ID, unique enough for one person's files. */
export function newId(length = 10) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}
