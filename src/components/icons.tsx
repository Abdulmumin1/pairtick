import type { SVGProps } from "react";

const I = (d: string) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d={d} />
  </svg>
);

export const IconMic = I("M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3");
export const IconMicOff = I("M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3");
export const IconVideo = I("M3 7h12v10H3zM15 10l6-3v10l-6-3");
export const IconVideoOff = I("M3 3l18 18M15 11V7H7M3 7v10h12v-2M15 10l6-3v10l-3-1.5");
export const IconPhone = I("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2");
export const IconLeave = I("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2M3 3l18 18");
export const IconScreen = I("M3 5h18v11H3zM8 20h8M12 16v4");
export const IconPlay = I("M7 5v14l11-7z");
export const IconSend = I("M4 12l16-8-6 16-2-7z");
export const IconStop = I("M6 6h12v12H6z");
export const IconArrow = I("M5 12h14M13 6l6 6-6 6");
export const IconBack = I("M19 12H5M11 6l-6 6 6 6");
