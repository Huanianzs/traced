export const PROFICIENCY_COLORS = {
  neutral: '#a3a3a3',
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
} as const;

export const PROFICIENCY_BADGE_CLASSES = {
  red: 'bg-red-100 text-red-700',
  amber: 'bg-orange-100 text-orange-700',
  green: 'bg-green-100 text-green-700',
} as const;

export const PROFICIENCY_DOT_CLASSES = {
  red: 'bg-red-500',
  amber: 'bg-orange-400',
  green: 'bg-green-500',
} as const;

export const PROFICIENCY_TEXT_CLASSES = {
  red: 'bg-red-400',
  amber: 'bg-orange-400',
  green: 'bg-green-400',
} as const;

export const BUILTIN_WORDBANKS = [
  { wordbankId: 'wb_noise', code: 'noise', name: '噪声词 / Function Words' },
  { wordbankId: 'wb_daily', code: 'daily', name: '日常交流' },
  { wordbankId: 'wb_programming', code: 'programming', name: '编程词汇' },
  { wordbankId: 'wb_cet4', code: 'cet4', name: '四级词汇' },
  { wordbankId: 'wb_cet6', code: 'cet6', name: '六级词汇' },
  { wordbankId: 'wb_gaokao', code: 'gaokao', name: '高考词汇' },
  { wordbankId: 'wb_primary', code: 'primary', name: '小学词汇' },
  { wordbankId: 'wb_postgrad', code: 'postgrad', name: '考研词汇' },
  { wordbankId: 'wb_top10k', code: 'top10k', name: '词频前一万' },
] as const;
