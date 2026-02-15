export const SHADOW_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.animate-scale-in {
  animation: scaleIn 0.15s ease-out forwards;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes scaleIn {
  0% { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.font-serif { font-family: "Noto Serif SC", serif; }
.font-semibold { font-weight: 600; }
.font-medium { font-weight: 500; }

.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }

.leading-relaxed { line-height: 1.625; }
.whitespace-pre-wrap { white-space: pre-wrap; }

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.flex { display: flex; }
.flex-1 { flex: 1 1 0%; }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-end { justify-content: flex-end; }

.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.mt-1 { margin-top: 0.25rem; }
.min-h-\\[80px\\] { min-height: 80px; }

.w-5 { width: 1.25rem; }
.w-7 { width: 1.75rem; }
.h-5 { height: 1.25rem; }
.h-7 { height: 1.75rem; }

.rounded { border-radius: 0.25rem; }
.rounded-md { border-radius: 0.375rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-full { border-radius: 9999px; }

.border { border-width: 1px; border-style: solid; }
.border-b { border-bottom-width: 1px; border-bottom-style: solid; }
.border-b-2 { border-bottom-width: 2px; border-bottom-style: solid; }
.border-t { border-top-width: 1px; border-top-style: solid; }

.border-neutral-100 { border-color: #F3F4F6; }
.border-neutral-200 { border-color: #E5E7EB; }
.border-brand-seal { border-color: #B22222; }

.bg-white { background-color: #FFFFFF; }
.bg-neutral-100 { background-color: #F3F4F6; }
.bg-red-50 { background-color: #FEF2F2; }
.bg-brand-seal { background-color: #B22222; }

.text-white { color: #FFFFFF; }
.text-neutral-400 { color: #9CA3AF; }
.text-neutral-500 { color: #6B7280; }
.text-neutral-600 { color: #4B5563; }
.text-neutral-700 { color: #374151; }
.text-neutral-800 { color: #1F2937; }
.text-neutral-900 { color: #111827; }
.text-brand-seal { color: #B22222; }
.text-red-600 { color: #DC2626; }

.shadow-card { box-shadow: 0 1px 2px rgba(17, 24, 39, 0.06), 0 1px 1px rgba(17, 24, 39, 0.04); }
.shadow-float { box-shadow: 0 8px 20px rgba(17, 24, 39, 0.08); }

.overflow-hidden { overflow: hidden; }
.text-center { text-align: center; }

.transition-all { transition: all 0.15s ease; }
.transition-colors { transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease; }

@keyframes breathing {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}
.animate-breathing { animation: breathing 1.2s ease-in-out infinite; }
.w-2 { width: 0.5rem; }
.h-2 { height: 0.5rem; }
.gap-1 { gap: 0.25rem; }
.space-y-2 > * + * { margin-top: 0.5rem; }
.text-center { text-align: center; }

hr { border: none; border-top: 1px solid #E5E7EB; margin: 0.75rem 0; }

.hover\\:opacity-90:hover { opacity: 0.9; }
.hover\\:shadow-float:hover { box-shadow: 0 8px 20px rgba(17, 24, 39, 0.08); }
.hover\\:border-brand-seal:hover { border-color: #B22222; }
.hover\\:text-neutral-600:hover { color: #4B5563; }
.hover\\:text-neutral-700:hover { color: #374151; }

/* Position */
.relative { position: relative; }
.absolute { position: absolute; }

/* Sizing */
.w-full { width: 100%; }
.w-6 { width: 1.5rem; }
.h-6 { height: 1.5rem; }
.w-1\\.5 { width: 0.375rem; }
.h-1\\.5 { height: 0.375rem; }

/* Flex */
.flex-shrink-0 { flex-shrink: 0; }
.gap-1\\.5 { gap: 0.375rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }

/* Spacing */
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }

/* Rounded */
.rounded-t-lg { border-top-left-radius: 0.5rem; border-top-right-radius: 0.5rem; }
.rounded-b-lg { border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem; }

/* Typography */
.font-bold { font-weight: 700; }
.text-\\[10px\\] { font-size: 10px; line-height: 14px; }
.text-left { text-align: left; }
.whitespace-nowrap { white-space: nowrap; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Background colors */
.bg-neutral-50 { background-color: #F9FAFB; }
.bg-neutral-200 { background-color: #E5E7EB; }
.bg-neutral-300 { background-color: #D1D5DB; }
.bg-neutral-800 { background-color: #1F2937; }
.bg-green-100 { background-color: #DCFCE7; }
.bg-green-500 { background-color: #22C55E; }
.bg-amber-100 { background-color: #FEF3C7; }
.bg-amber-400 { background-color: #FBBF24; }
.bg-orange-400 { background-color: #FB923C; }
.bg-red-100 { background-color: #FEE2E2; }
.bg-red-500 { background-color: #EF4444; }
.bg-brand-seal\\/10 { background-color: rgba(178, 34, 34, 0.1); }

/* Text colors */
.text-red-700 { color: #B91C1C; }
.text-amber-700 { color: #B45309; }
.text-green-700 { color: #15803D; }

/* Shadows */
.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); }

/* Tooltip positioning */
.bottom-full { bottom: 100%; }
.left-1\\/2 { left: 50%; }
.z-50 { z-index: 50; }
.opacity-0 { opacity: 0; }
.pointer-events-none { pointer-events: none; }

/* Overflow */
.overflow-y-auto { overflow-y: auto; }
.max-h-\\[120px\\] { max-height: 120px; }

/* Transitions */
.transition-transform { transition: transform 0.15s ease; }
.transition-opacity { transition: opacity 0.15s ease; }

/* Transforms */
.-translate-x-1\\/2 { transform: translateX(-50%); }
.rotate-180 { transform: rotate(180deg); }
.hover\\:scale-110:hover { transform: scale(1.1); }
.hover\\:-translate-y-0\\.5:hover { transform: translateY(-0.125rem); }
.hover\\:scale-110.hover\\:-translate-y-0\\.5:hover { transform: scale(1.1) translateY(-0.125rem); }
.active\\:scale-95:active { transform: scale(0.95) !important; }

/* States */
.disabled\\:opacity-50:disabled { opacity: 0.5; }
.group:hover .group-hover\\:opacity-100 { opacity: 1; }

/* Hover backgrounds/colors */
.hover\\:bg-white:hover { background-color: #FFFFFF; }
.hover\\:bg-neutral-100:hover { background-color: #F3F4F6; }
.hover\\:bg-neutral-300:hover { background-color: #D1D5DB; }
.hover\\:text-neutral-500:hover { color: #6B7280; }
.hover\\:shadow-md:hover { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); }

/* Dividers */
.divide-y > * + * { border-top-width: 1px; border-top-style: solid; }
.divide-neutral-100 > * + * { border-color: #F3F4F6; }
.space-y-1 > * + * { margin-top: 0.25rem; }

button { cursor: pointer; }
`;
