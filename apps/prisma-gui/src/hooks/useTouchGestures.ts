import { useRef, useEffect, useCallback, type RefObject } from "react";

export function usePullToRefresh(onRefresh: () => Promise<void>): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const refreshing = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (el!.scrollTop === 0) {
        startY.current = e.touches[0].clientY;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (refreshing.current || el!.scrollTop > 0) return;
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 60) {
        e.preventDefault();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (refreshing.current || el!.scrollTop > 0) return;
      const diff = e.changedTouches[0].clientY - startY.current;
      if (diff > 60) {
        refreshing.current = true;
        onRefresh().finally(() => {
          refreshing.current = false;
        });
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh]);

  return ref;
}

export function useHaptic() {
  const light = useCallback(() => {
    try { navigator.vibrate?.(10); } catch {}
  }, []);

  const medium = useCallback(() => {
    try { navigator.vibrate?.(25); } catch {}
  }, []);

  return { light, medium };
}
