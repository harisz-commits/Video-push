import React from "react";
import type { IconName } from "../../../lib/schema";

/**
 * One hand-drawn set, one grid, one stroke weight.
 *
 * Rules that make them look like a family — break any of them and it shows
 * immediately when two icons sit next to each other:
 *   - 48x48 viewBox, geometry kept inside a 4px margin
 *   - 2px stroke, round caps and joins, no scaling of stroke width
 *   - flat fill only, expressed as low-opacity currentColor
 *   - no gradients, no shadows, no second colour
 */

export type IconProps = {
  size?: number;
  color?: string;
  /** Opacity of the flat fill areas. */
  fillOpacity?: number;
  style?: React.CSSProperties;
};

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 48,
  color = "currentColor",
  style,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    shapeRendering="geometricPrecision"
  >
    {children}
  </svg>
);

/** Flat fill helper — keeps every filled area at the same visual weight. */
const fill = (opacity: number) => ({
  fill: "currentColor",
  fillOpacity: opacity,
  stroke: "none",
});

export const Wheat: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M24 43V19" />
    <path d="M24 19c0-5 3-8 3-8s3 3 3 8-3 8-3 8-3-3-3-8Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M24 19c0-5-3-8-3-8s-3 3-3 8 3 8 3 8 3-3 3-8Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M24 19c0-5 3-8 3-8s3 3 3 8-3 8-3 8-3-3-3-8Z" />
    <path d="M24 19c0-5-3-8-3-8s-3 3-3 8 3 8 3 8 3-3 3-8Z" />
    <path d="M24 31c0-4 3-6 3-6s2 3 2 6-2 6-2 6-3-2-3-6Z" />
    <path d="M24 31c0-4-3-6-3-6s-2 3-2 6 2 6 2 6 3-2 3-6Z" />
  </Svg>
);

export const Barn: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 21 24 9l18 12v20H6V21Z" {...fill(p.fillOpacity ?? 0.16)} />
    <path d="M6 21 24 9l18 12v20H6V21Z" />
    <path d="M19 41V28h10v13" {...fill(p.fillOpacity ?? 0.24)} />
    <path d="M19 41V28h10v13" />
    <path d="M6 25h36" />
  </Svg>
);

export const Tractor: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 30V19h11l4 8h9v3" {...fill(p.fillOpacity ?? 0.18)} />
    <path d="M9 30V19h11l4 8h9v3" />
    <circle cx="16" cy="34" r="7" {...fill(p.fillOpacity ?? 0.16)} />
    <circle cx="16" cy="34" r="7" />
    <circle cx="36" cy="36" r="5" />
    <path d="M13 19v-4h7v4" />
  </Svg>
);

export const Soil: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M5 27h38v14H5V27Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M5 27h38v14H5V27Z" />
    <path d="M5 34h38" />
    <path d="M24 27v-6" />
    <path d="M24 21c0-4 3-6 6-6 0 4-2 6-6 6Z" {...fill(p.fillOpacity ?? 0.28)} />
    <path d="M24 21c0-4 3-6 6-6 0 4-2 6-6 6Z" />
    <path d="M24 23c0-4-3-6-6-6 0 4 2 6 6 6Z" />
  </Svg>
);

export const Ship: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M7 30h34l-4 9H11l-4-9Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M7 30h34l-4 9H11l-4-9Z" />
    <path d="M13 30V21h9v9" />
    <path d="M22 30v-6h9v6" {...fill(p.fillOpacity ?? 0.24)} />
    <path d="M22 30v-6h9v6" />
    <path d="M31 21V13" />
  </Svg>
);

export const Factory: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 41V24l10 6v-6l10 6v-6l10 6v11H6Z" {...fill(p.fillOpacity ?? 0.18)} />
    <path d="M6 41V24l10 6v-6l10 6v-6l10 6v11H6Z" />
    <path d="M36 24V9h6v21" />
  </Svg>
);

export const Flame: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M24 6c8 8 12 13 12 20a12 12 0 0 1-24 0c0-7 4-12 12-20Z" {...fill(p.fillOpacity ?? 0.16)} />
    <path d="M24 6c8 8 12 13 12 20a12 12 0 0 1-24 0c0-7 4-12 12-20Z" />
    <path d="M24 24c3.5 4 5 6 5 9a5 5 0 0 1-10 0c0-3 1.5-5 5-9Z" {...fill(p.fillOpacity ?? 0.3)} />
    <path d="M24 24c3.5 4 5 6 5 9a5 5 0 0 1-10 0c0-3 1.5-5 5-9Z" />
  </Svg>
);

export const Fertilizer: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M13 17h22l-3 24H16l-3-24Z" {...fill(p.fillOpacity ?? 0.18)} />
    <path d="M13 17h22l-3 24H16l-3-24Z" />
    <path d="M17 17V9h14v8" />
    <circle cx="21" cy="28" r="1.6" {...fill(0.9)} />
    <circle cx="27" cy="31" r="1.6" {...fill(0.9)} />
    <circle cx="23" cy="35" r="1.6" {...fill(0.9)} />
  </Svg>
);

export const Sun: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="24" cy="24" r="9" {...fill(p.fillOpacity ?? 0.22)} />
    <circle cx="24" cy="24" r="9" />
    <path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M37.4 10.6l-4.2 4.2M14.8 33.2l-4.2 4.2" />
  </Svg>
);

export const Droplet: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M24 6c7 9 12 14 12 20a12 12 0 0 1-24 0c0-6 5-11 12-20Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M24 6c7 9 12 14 12 20a12 12 0 0 1-24 0c0-6 5-11 12-20Z" />
    <path d="M18 27a6 6 0 0 0 6 6" />
  </Svg>
);

export const Cart: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M5 9h5l4 20h20" />
    <path d="M12 15h30l-3 11H14l-2-11Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M12 15h30l-3 11H14l-2-11Z" />
    <circle cx="17" cy="38" r="3" {...fill(0.9)} />
    <circle cx="33" cy="38" r="3" {...fill(0.9)} />
  </Svg>
);

export const Gear: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path
      d="M24 6l3 5h6l1 6 5 3-2 6 2 6-5 3-1 6h-6l-3 5-3-5h-6l-1-6-5-3 2-6-2-6 5-3 1-6h6l3-5Z"
      {...fill(p.fillOpacity ?? 0.16)}
    />
    <path d="M24 6l3 5h6l1 6 5 3-2 6 2 6-5 3-1 6h-6l-3 5-3-5h-6l-1-6-5-3 2-6-2-6 5-3 1-6h6l3-5Z" />
    <circle cx="24" cy="24" r="6" />
  </Svg>
);

export const Satellite: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="19" y="19" width="10" height="10" rx="1" {...fill(p.fillOpacity ?? 0.24)} />
    <rect x="19" y="19" width="10" height="10" rx="1" />
    <path d="M19 22H7v4h12" {...fill(p.fillOpacity ?? 0.16)} />
    <path d="M19 22H7v4h12" />
    <path d="M29 22h12v4H29" {...fill(p.fillOpacity ?? 0.16)} />
    <path d="M29 22h12v4H29" />
    <path d="M24 19v-6" />
    <path d="M19 13a7 7 0 0 1 10 0" />
    <path d="M24 29v10" />
  </Svg>
);

export const Seed: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M24 42c-6 0-10-5-10-11s4-13 10-13 10 7 10 13-4 11-10 11Z" {...fill(p.fillOpacity ?? 0.2)} />
    <path d="M24 42c-6 0-10-5-10-11s4-13 10-13 10 7 10 13-4 11-10 11Z" />
    <path d="M24 18V8" />
    <path d="M24 12c0-4 4-6 8-6 0 4-3 6-8 6Z" {...fill(p.fillOpacity ?? 0.3)} />
    <path d="M24 12c0-4 4-6 8-6 0 4-3 6-8 6Z" />
  </Svg>
);

export const Recycle: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M24 7l7 12h-14L24 7Z" {...fill(p.fillOpacity ?? 0.22)} />
    <path d="M24 7l7 12h-14L24 7Z" />
    <path d="M38 39l-7-12 12-1-5 13Z" {...fill(p.fillOpacity ?? 0.22)} />
    <path d="M38 39l-7-12 12-1-5 13Z" />
    <path d="M10 39l14 0-6-11-8 11Z" {...fill(p.fillOpacity ?? 0.22)} />
    <path d="M10 39l14 0-6-11-8 11Z" />
  </Svg>
);

export const Shelf: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="6" y="8" width="36" height="32" rx="1" {...fill(p.fillOpacity ?? 0.12)} />
    <rect x="6" y="8" width="36" height="32" rx="1" />
    <path d="M6 19h36M6 30h36" />
    <rect x="10" y="12" width="5" height="7" {...fill(0.55)} />
    <rect x="18" y="12" width="5" height="7" {...fill(0.35)} />
    <rect x="10" y="23" width="5" height="7" {...fill(0.35)} />
  </Svg>
);

export const Coin: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="24" cy="24" r="17" {...fill(p.fillOpacity ?? 0.18)} />
    <circle cx="24" cy="24" r="17" />
    <circle cx="24" cy="24" r="11" />
    <path d="M24 17v14M20 21h6a3 3 0 0 1 0 6h-5a3 3 0 0 0 0 6h6" />
  </Svg>
);

export const Chart: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M8 40V8" />
    <path d="M8 40h32" />
    <rect x="14" y="27" width="6" height="13" {...fill(p.fillOpacity ?? 0.3)} />
    <rect x="14" y="27" width="6" height="13" />
    <rect x="23" y="20" width="6" height="20" {...fill(p.fillOpacity ?? 0.3)} />
    <rect x="23" y="20" width="6" height="20" />
    <rect x="32" y="13" width="6" height="27" {...fill(p.fillOpacity ?? 0.3)} />
    <rect x="32" y="13" width="6" height="27" />
  </Svg>
);

export const ICONS: Record<IconName, React.FC<IconProps>> = {
  wheat: Wheat,
  barn: Barn,
  tractor: Tractor,
  soil: Soil,
  ship: Ship,
  factory: Factory,
  flame: Flame,
  fertilizer: Fertilizer,
  sun: Sun,
  droplet: Droplet,
  cart: Cart,
  gear: Gear,
  satellite: Satellite,
  seed: Seed,
  recycle: Recycle,
  shelf: Shelf,
  coin: Coin,
  chart: Chart,
};

export const Icon: React.FC<IconProps & { name: IconName }> = ({
  name,
  ...rest
}) => {
  const Cmp = ICONS[name] ?? Wheat;
  return <Cmp {...rest} />;
};
