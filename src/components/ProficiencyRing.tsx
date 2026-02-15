import { PROFICIENCY_COLORS } from '../lib/constants';

type ProficiencyRingMode =
  | { mode?: 'level'; level: 0 | 1 | 2 | 3 | 4 | 5 }
  | { mode: 'percent'; percent: number; color?: string };

type ProficiencyRingProps = ProficiencyRingMode & {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  children?: React.ReactNode;
};

const sizeMap = {
  sm: { width: 24, stroke: 2.5, radius: 9, fontSize: 'text-[8px]' },
  md: { width: 32, stroke: 3, radius: 12, fontSize: 'text-xs' },
  lg: { width: 48, stroke: 4, radius: 18, fontSize: 'text-sm' },
  xl: { width: 72, stroke: 5, radius: 28, fontSize: 'text-lg' },
};

const getColor = (level: number): string => {
  if (level === 0) return PROFICIENCY_COLORS.neutral;
  if (level <= 1) return PROFICIENCY_COLORS.red;
  if (level <= 3) return PROFICIENCY_COLORS.amber;
  return PROFICIENCY_COLORS.green;
};

const getPercentColor = (percent: number, custom?: string): string => {
  if (custom) return custom;
  if (percent >= 100) return '#d4a017';
  if (percent >= 80) return PROFICIENCY_COLORS.green;
  if (percent >= 50) return PROFICIENCY_COLORS.amber;
  return PROFICIENCY_COLORS.red;
};

export function ProficiencyRing(props: ProficiencyRingProps) {
  const { size = 'md', className = '', children } = props;
  const { width, stroke, radius, fontSize } = sizeMap[size];
  const circumference = 2 * Math.PI * radius;

  const isPercent = 'mode' in props && props.mode === 'percent';
  const progress = isPercent
    ? Math.min(1, Math.max(0, (props as { percent: number }).percent / 100))
    : ('level' in props ? (props as { level: number }).level / 5 : 0);
  const dashoffset = circumference - progress * circumference;

  const color = isPercent
    ? getPercentColor((props as { percent: number }).percent, (props as { color?: string }).color)
    : getColor('level' in props ? (props as { level: number }).level : 0);

  const label = isPercent
    ? `${Math.round((props as { percent: number }).percent)}%`
    : String('level' in props ? (props as { level: number }).level : 0);

  const ariaValue = isPercent
    ? (props as { percent: number }).percent
    : ('level' in props ? (props as { level: number }).level : 0);
  const ariaMax = isPercent ? 100 : 5;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      role="progressbar"
      aria-valuenow={ariaValue}
      aria-valuemin={0}
      aria-valuemax={ariaMax}
      aria-label={isPercent ? `Coverage ${label}` : `Proficiency level ${label} of 5`}
    >
      <svg width={width} height={width} className="transform -rotate-90">
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="transparent"
          className="text-neutral-200 dark:text-neutral-800"
        />
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          className="transition-all duration-300"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      ) : (
        <span className={`absolute ${fontSize} font-medium`} style={{ color }}>{label}</span>
      )}
    </div>
  );
}
