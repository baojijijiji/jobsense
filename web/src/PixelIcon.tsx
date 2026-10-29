import type { ReactNode, SVGProps } from 'react'

// Keep the existing icon API so presentation changes do not affect its callers.
export type PixelIconName =
  | 'home'
  | 'archive'
  | 'file'
  | 'search'
  | 'applications'
  | 'resume'
  | 'project'
  | 'research'
  | 'skill'
  | 'plus'
  | 'upload'
  | 'chevron'
  | 'sparkle'
  | 'history'
  | 'sun'
  | 'moon'
  | 'settings'
  | 'logout'
  | 'download'
  | 'more'
  | 'check'
  | 'arrow'

const glyphs: Record<PixelIconName, ReactNode> = {
  home: <><path d="m3.5 10 8.5-7 8.5 7v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19Z" /><path d="M9 20.5v-7h6v7" /></>,
  archive: <><rect x="5" y="3" width="14" height="18" rx="1.7" /><path d="M8.5 7.5h7M8.5 11.5h7M8.5 15.5H13" /></>,
  file: <path d="m8.5 13.5 6-6a2.12 2.12 0 0 1 3 3L10 18a4.24 4.24 0 0 1-6-6l8-8a5.3 5.3 0 0 1 7.5 7.5l-8 8" />,
  search: <><circle cx="10.5" cy="10.5" r="6.8" /><path d="m15.5 15.5 5 5" /></>,
  applications: <><path d="m21 3-7.3 18-3.8-7.9L2 9.3Z" /><path d="m9.9 13.1 6-5.5" /></>,
  resume: <><path d="M14.5 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-11Z" /><path d="M14 3v6h5.5M8 12h8M8 15.5h8M8 18h4.5" /></>,
  project: <path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V7h18" />,
  research: <><path d="m2 8 10-5 10 5-10 5Z" /><path d="M6 10v6c3.8 3.1 8.2 3.1 12 0v-6M22 8v7" /></>,
  skill: <><path d="m3 7 9-5 9 5-9 5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></>,
  plus: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  upload: <><path d="M7 17H6a4.5 4.5 0 0 1-.7-8.9A6.5 6.5 0 0 1 18 7.3 4.9 4.9 0 0 1 18 17h-1" /><path d="M12 21V10m-4 4 4-4 4 4" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  sparkle: <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z" />,
  history: <><path d="M3 4v5h5" /><path d="M3.5 8a9 9 0 1 1-.2 7M12 7v5l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.5 13.2A8.8 8.8 0 0 1 10.8 3.5a8.8 8.8 0 1 0 9.7 9.7Z" />,
  settings: <><path d="m9.8 3-.6 2.2-2 .9-2-.6L3 9.3l1.5 1.6v2.2L3 14.7l2.2 3.8 2-.6 2 .9.6 2.2h4.4l.6-2.2 2-.9 2 .6 2.2-3.8-1.5-1.6v-2.2L21 9.3l-2.2-3.8-2 .6-2-.9-.6-2.2Z" /><circle cx="12" cy="12" r="3" /></>,
  logout: <><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M9 12h12m-4-4 4 4-4 4" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  more: <><circle cx="5" cy="12" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="19" cy="12" r=".9" fill="currentColor" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
}

export function PixelIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: PixelIconName }) {
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.55"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
    aria-hidden={props['aria-label'] ? undefined : true}
    focusable="false"
  >{glyphs[name]}</svg>
}
