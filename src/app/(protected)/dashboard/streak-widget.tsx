"use client"
import { Flame } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { useAuth } from "@clerk/nextjs"
import { useStreak } from "~/hooks/use-streak"

const StreakWidget = () => {
  const { userId } = useAuth()
  const { streak } = useStreak(userId || undefined)

  return (
    <Card className="flex-1">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Flame className="text-orange-500" />
          Current Streak
        </CardTitle>
        <span className="text-xs text-muted-foreground">Daily activity</span>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold">{streak}</span>
          <span className="text-sm text-muted-foreground">day{streak === 1 ? "" : "s"}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default StreakWidget

