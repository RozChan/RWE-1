import type { ReactNode, SVGProps } from "react";

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: string }) {
  const paths: Record<string, ReactNode> = {
    logo: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="4" />
        <path d="M8 9h8M8 13h5M8 17h8" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    folder: (
      <>
        <path d="M3 7h7l2 2h9v10H3z" />
        <path d="M3 7V5h7l2 2" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l2 2v16H5z" />
        <path d="M8 3v6h8V3M8 21v-7h8v7" />
      </>
    ),
    export: (
      <>
        <path d="M12 3v12M7 8l5-5 5 5" />
        <path d="M5 14v7h14v-7" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    file: (
      <>
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 13h6M9 17h6" />
      </>
    ),
    transcript: (
      <>
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 11h6M9 15h6M9 19h4" />
      </>
    ),
    summary: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h5M8 16h7" />
        <path d="m15 12 1 1 2-2" />
      </>
    ),
    robot: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="3" />
        <path d="M12 3v4M9 3h6M8 12h.01M16 12h.01M8 16h8" />
      </>
    ),
    spark: (
      <>
        <path d="m12 2-1.4 5.6L5 9l5.6 1.4L12 16l1.4-5.6L19 9l-5.6-1.4Z" />
        <path d="m5 16-.7 2.3L2 19l2.3.7L5 22l.7-2.3L8 19l-2.3-.7Z" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
