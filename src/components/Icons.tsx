import type { ReactNode } from 'react'

function Icon({ children, width = 2 }: { children: ReactNode; width?: number }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const ListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3" />
  </Icon>
)

export const WalletIcon = () => (
  <Icon>
    <path d="M18 9V5H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7" />
    <path d="M16.5 14h.01" strokeWidth="3" />
  </Icon>
)

export const ChartIcon = () => (
  <Icon>
    <path d="M5 20v-8M12 20V4M19 20v-5" strokeWidth="3" />
  </Icon>
)

export const TagIcon = () => (
  <Icon>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
    <path d="M7.5 7.5h.01" strokeWidth="3" />
  </Icon>
)

export const RepeatIcon = () => (
  <Icon>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Icon>
)

export const BellIcon = () => (
  <Icon>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
  </Icon>
)

export const CalendarIcon = () => (
  <Icon>
    <path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </Icon>
)

export const MoreIcon = () => (
  <Icon width={3}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon width={2.5}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
)

export const ChevronRightIcon = () => (
  <Icon>
    <path d="M9 18l6-6-6-6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M18 6L6 18M6 6l12 12" />
  </Icon>
)

export const TransferIcon = () => (
  <Icon>
    <path d="M4 8h15l-3-3M20 16H5l3 3" />
  </Icon>
)

export const ChevronDownIcon = () => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon width={2.5}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
)
