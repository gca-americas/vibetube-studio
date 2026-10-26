import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

/** The adk web dev UI in a frame, in the workbench's theme. The dev UI reads
 *  its theme from localStorage when it boots (ThemeProvider writes that key),
 *  and a toggle while the frame is open is applied to the frame's document so
 *  its chat and session survive. */
export function AdkFrame({ src, onLoad }: { src: string; onLoad?: () => void }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);

  const apply = useCallback(() => {
    const root = ref.current?.contentDocument?.documentElement;
    if (!root) return;
    root.classList.remove("light-theme", "dark-theme");
    root.classList.add(`${theme}-theme`);
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(apply, [apply]);

  return (
    <iframe
      ref={ref}
      title="adk web"
      src={src}
      className="h-[680px] w-full bg-card"
      onLoad={() => {
        apply();
        onLoad?.();
      }}
    />
  );
}
