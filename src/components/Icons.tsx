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

export const StarIcon = () => (
  <Icon>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </Icon>
)

export const UploadIcon = () => (
  <Icon>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5" />
  </Icon>
)

export const HomeIcon = () => (
  <Icon>
    <path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon>
    <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
  </Icon>
)

export const CardIcon = () => (
  <Icon>
    <path d="M3 6h18v12H3zM3 10h18M7 15h3" />
  </Icon>
)

export const BankIcon = () => (
  <Icon>
    <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
  </Icon>
)

export const PercentIcon = () => (
  <Icon>
    <path d="M19 5 5 19M7 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
  </Icon>
)

export const CartIcon = () => (
  <Icon>
    <path d="M3 4h2l2.4 11h11L21 8H6.2M9 20h.01M18 20h.01" />
  </Icon>
)

export const BusIcon = () => (
  <Icon>
    <path d="M6 4h12a2 2 0 0 1 2 2v10H4V6a2 2 0 0 1 2-2zM4 11h16M7 16v3M17 16v3M8 13.5h.01M16 13.5h.01" />
  </Icon>
)

export const HouseIcon = () => (
  <Icon>
    <path d="M4 21V9l8-6 8 6v12M9 21v-7h6v7" />
  </Icon>
)

export const CoffeeIcon = () => (
  <Icon>
    <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2" />
  </Icon>
)

export const HeartIcon = () => (
  <Icon>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Icon>
)

export const FilmIcon = () => (
  <Icon>
    <path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4" />
  </Icon>
)

export const BoxIcon = () => (
  <Icon>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
  </Icon>
)

export const BriefcaseIcon = () => (
  <Icon>
    <path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16" />
  </Icon>
)

export const CoinsIcon = () => (
  <Icon>
    <path d="M9 10a6 3 0 1 0 0-.01zM3 10v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4M15 7.5c3.3 0 6 1.3 6 3v4c0 1.7-2.7 3-6 3" />
  </Icon>
)

export const ArrowInIcon = () => (
  <Icon>
    <path d="M17 7 7 17M15 17H7V9" />
  </Icon>
)

export const ArrowOutIcon = () => (
  <Icon>
    <path d="M7 17 17 7M9 7h8v8" />
  </Icon>
)

export const BackspaceIcon = () => (
  <Icon width={1.9}>
    <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7zM12 9.5l5 5M17 9.5l-5 5" />
  </Icon>
)

export const SwapIcon = () => (
  <Icon>
    <path d="M8 4v16M8 4 4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4" />
  </Icon>
)

export const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Icon>
)

export const ClockIcon = () => (
  <Icon>
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
  </Icon>
)

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4" />
  </Icon>
)

export const SparkIcon = () => (
  <Icon>
    <path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
)

export const SendIcon = () => (
  <Icon>
    <path d="M5 12h13M12 5l7 7-7 7" />
  </Icon>
)
