export const tc = (s: string) =>
  s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export const tagColorIdx = (name: string): number => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % 8;
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
