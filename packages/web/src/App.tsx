import { useEffect } from 'react';
import { Landing } from './Landing.tsx';
import { useStore } from './store.ts';
import { TimelineView } from './TimelineView.tsx';

let restored = false;

export function App() {
  const hasTimeline = useStore((s) => s.timeline !== null);
  const open = useStore((s) => s.open);

  // Reopen the repo named in the URL so reloads and bookmarks work.
  useEffect(() => {
    const source = new URLSearchParams(location.search).get('repo');
    if (source && !restored) void open(source);
    restored = true;
  }, [open]);

  return hasTimeline ? <TimelineView /> : <Landing />;
}
