import { useEffect, useRef, useState, ReactNode } from 'react';

interface DeferredChartProps {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
}

/** Defers mounting children until the container scrolls into view. */
export default function DeferredChart({
  children,
  minHeight = 200,
  rootMargin = '200px',
}: DeferredChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref} style={{ minHeight }}>
      {visible ? children : (
        <div className="flex items-center justify-center text-sm text-gray-400" style={{ minHeight }}>
          Scroll to load chart…
        </div>
      )}
    </div>
  );
}
