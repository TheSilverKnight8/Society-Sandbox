// The app's icon: a cream castle keep flying a red pennant, on navy, in the Shop Manual
// colors. Same drawing as public/favicon.svg and the PNG icons in public/.

const KEEP = 'M17 21H23V25H29V21H35V25H41V21H47V31H44V52H20V31H17Z';
const DOOR = 'M28 52V44A4 4 0 0 1 36 44V52Z';
const PENNANT = 'M33 7.5L45 11.5L33 15.5Z';

export function AppMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <rect width="64" height="64" rx="12" fill="#002657" />
      <rect x="31" y="7" width="2" height="15" fill="#faeeda" />
      <path d={PENNANT} fill="#fc3f3f" />
      <path d={KEEP} fill="#faeeda" />
      <path d={DOOR} fill="#002657" />
      <rect x="24" y="34" width="3" height="5" fill="#002657" />
      <rect x="37" y="34" width="3" height="5" fill="#002657" />
      <rect x="12" y="52" width="40" height="3" rx="1" fill="#faeeda" />
    </svg>
  );
}
