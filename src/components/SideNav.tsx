import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

export type CalendarDate = {
  date: string;
  memoCount: number;
};

type Props = {
  startDate: string;
  today: string;
  calendarDates: CalendarDate[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  open: boolean;
  onClose: () => void;
};

type MonthGroup = {
  monthKey: string;
  monthLabel: string;
  dates: string[];
};

type YearGroup = {
  year: string;
  months: MonthGroup[];
};

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function buildDateRange(startDate: string, today: string): string[] {
  const dates: string[] = [];
  let cur = new Date(`${today}T00:00:00`);
  const start = new Date(`${startDate}T00:00:00`);
  while (cur >= start) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() - 1);
  }
  return dates;
}

function formatDateLabel(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd} (${KO_DAYS[d.getDay()]})`;
}

function groupByYearMonth(dates: string[]): YearGroup[] {
  const byYear = new Map<string, Map<string, string[]>>();
  for (const date of dates) {
    const year = date.slice(0, 4);
    const month = date.slice(5, 7);
    if (!byYear.has(year)) byYear.set(year, new Map());
    const yearMap = byYear.get(year)!;
    if (!yearMap.has(month)) yearMap.set(month, []);
    yearMap.get(month)!.push(date);
  }

  return [...byYear.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, monthMap]) => ({
      year,
      months: [...monthMap.entries()]
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([month, groupedDates]) => ({
          monthKey: `${year}-${month}`,
          monthLabel: `${Number(month)}월`,
          dates: groupedDates,
        })),
    }));
}

export default function SideNav({ startDate, today, calendarDates, selectedDate, onSelectDate, open, onClose }: Props) {
  const memoMap = useMemo(() => new Map(calendarDates.map((d) => [d.date, d.memoCount])), [calendarDates]);
  const allDates = useMemo(() => buildDateRange(startDate, today), [startDate, today]);
  const grouped = useMemo(() => groupByYearMonth(allDates), [allDates]);
  const totalDays = allDates.length;
  const memoDays = allDates.filter((d) => (memoMap.get(d) ?? 0) > 0).length;
  const selectedYear = selectedDate.slice(0, 4);
  const selectedMonthKey = selectedDate.slice(0, 7);

  const [openYears, setOpenYears] = useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenYears((prev) => ({ ...prev, [selectedYear]: true }));
    setOpenMonths((prev) => ({ ...prev, [selectedMonthKey]: true }));
  }, [selectedYear, selectedMonthKey]);

  useEffect(() => {
    if (!open && window.innerWidth < 1024) return;
    const el = listRef.current?.querySelector(`[data-date="${selectedDate}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, selectedDate]);

  const toggleYear = (year: string) => {
    setOpenYears((prev) => ({ ...prev, [year]: !prev[year] }));
  };

  const toggleMonth = (monthKey: string) => {
    setOpenMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  };

  const handleSelect = (date: string) => {
    onSelectDate(date);
    onClose();
  };

  const inner = (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-50">
      <div className="mx-3 mt-3 shrink-0 rounded-2xl bg-white p-4 shadow-sm">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400">읽은 날</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tracking-tight text-zinc-800">{memoDays}</span>
          <span className="text-base font-medium text-zinc-400">/</span>
          <span className="text-xl font-semibold text-zinc-400">{totalDays}</span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">일 중 메모한 날</p>
      </div>

      <div ref={listRef} className="mt-1 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-1.5">
          {grouped.map((yearGroup) => {
            const yearOpen = openYears[yearGroup.year] ?? yearGroup.year === selectedYear;
            return (
              <div key={yearGroup.year} className="rounded-xl bg-white/60 p-1.5">
                <button
                  type="button"
                  onClick={() => toggleYear(yearGroup.year)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-zinc-100"
                >
                  <span className="text-xs font-semibold text-zinc-700">{yearGroup.year}년</span>
                  <i className={`ri-arrow-down-s-line text-base text-zinc-500 transition-transform ${yearOpen ? "rotate-0" : "-rotate-90"}`} />
                </button>
                <AnimatePresence initial={false}>
                  {yearOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pt-1">
                        {yearGroup.months.map((monthGroup) => {
                          const monthOpen = openMonths[monthGroup.monthKey] ?? monthGroup.monthKey === selectedMonthKey;
                          return (
                            <div key={monthGroup.monthKey} className="rounded-lg bg-zinc-50 p-1">
                              <button
                                type="button"
                                onClick={() => toggleMonth(monthGroup.monthKey)}
                                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-zinc-100"
                              >
                                <span className="text-xs font-medium text-zinc-600">{monthGroup.monthLabel}</span>
                                <i className={`ri-arrow-down-s-line text-sm text-zinc-500 transition-transform ${monthOpen ? "rotate-0" : "-rotate-90"}`} />
                              </button>
                              <AnimatePresence initial={false}>
                                {monthOpen && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                    className="overflow-hidden"
                                  >
                                    <div className="space-y-0.5 pt-1">
                                      {monthGroup.dates.map((date) => {
                                        const count = memoMap.get(date) ?? 0;
                                        const hasMemo = count > 0;
                                        const isToday = date === today;
                                        const isSelected = date === selectedDate;
                                        return (
                                          <button
                                            key={date}
                                            data-date={date}
                                            type="button"
                                            onClick={() => handleSelect(date)}
                                            className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition-colors ${
                                              isSelected
                                                ? "bg-zinc-900 text-white"
                                                : hasMemo
                                                  ? "bg-zinc-100 text-zinc-800 hover:bg-zinc-200/70"
                                                  : "text-zinc-600 hover:bg-zinc-100"
                                            }`}
                                          >
                                            <span className={`text-[11px] ${isSelected ? "text-white" : "text-inherit"}`}>
                                              {formatDateLabel(date)}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                              {isToday && (
                                                <span className={`rounded-full px-1 py-0.5 text-[9px] font-semibold ${isSelected ? "bg-zinc-700 text-zinc-100" : "bg-zinc-900 text-white"}`}>
                                                  오늘
                                                </span>
                                              )}
                                              <span className={`text-[11px] tabular-nums ${isSelected ? "text-zinc-300" : hasMemo ? "text-zinc-700" : "text-zinc-300"}`}>
                                                {hasMemo ? `${count}` : "·"}
                                              </span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 lg:flex">
        {inner}
      </aside>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <motion.div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <motion.aside
              className="absolute left-0 top-0 h-full w-[250px] overflow-hidden bg-white shadow-xl"
              initial={{ x: -28, opacity: 0.85 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -28, opacity: 0.85 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between px-4 pb-1 pt-4">
                <span className="text-sm font-semibold text-zinc-700">날짜 보기</span>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
                >
                  <i className="ri-close-line text-base" />
                </button>
              </div>
              {inner}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
