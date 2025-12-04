"use client"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type ActivityType = "commit" | "question" | "meeting"

const STORAGE_KEY = (userId: string) => `track-hub:streak:${userId}`

type StreakData = {
  dates: string[]
}

function read(userId: string): StreakData {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY(userId)) : null
    if (!raw) return { dates: [] }
    const parsed = JSON.parse(raw) as StreakData
    return Array.isArray(parsed?.dates) ? parsed : { dates: [] }
  } catch {
    return { dates: [] }
  }
}

function write(userId: string, data: StreakData) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY(userId), JSON.stringify({ dates: Array.from(new Set(data.dates)).sort() }))
    }
  } catch {}
}

function todayStr() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10)
}

function dateStr(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().slice(0, 10)
}

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0
  const set = new Set(dates)
  let count = 0
  let cursor = new Date()
  while (set.has(dateStr(cursor))) {
    count++
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}

function shouldNotifyMilestone(streak: number) {
  return streak > 0 && [1, 7, 30, 100].includes(streak)
}

export function useStreak(userId: string | undefined) {
  const [data, setData] = useState<StreakData>({ dates: [] })
  const [lastLoggedType, setLastLoggedType] = useState<ActivityType | null>(null)

  useEffect(() => {
    if (!userId) return
    setData(read(userId))
  }, [userId])

  const streak = useMemo(() => calcStreak(data.dates), [data])
  const lastDate = useMemo(() => (data.dates.length ? data.dates[data.dates.length - 1] : undefined), [data])

  function logActivity(type: ActivityType) {
    if (!userId) return
    const today = todayStr()
    if (lastDate === today && lastLoggedType === type) return
    const next = { dates: Array.from(new Set([...data.dates, today])).sort() }
    write(userId, next)
    setData(next)
    setLastLoggedType(type)
    const newStreak = calcStreak(next.dates)
    if (shouldNotifyMilestone(newStreak)) {
      const label = newStreak === 1 ? "First day" : `${newStreak}-day streak`
      toast.success(`${label} unlocked`)
    }
  }

  return { streak, lastDate, logActivity }
}

