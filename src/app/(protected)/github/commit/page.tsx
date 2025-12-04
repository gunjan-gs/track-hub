"use client"
import React, { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import useProject from "~/hooks/use-project"
import { api } from "~/trpc/react"
import { toast } from "sonner"
import Link from "next/link"
import { useAuth } from "@clerk/nextjs"
import { useStreak } from "~/hooks/use-streak"

type LocalFile = { path: string; name: string; content: string }

const CommitPage = () => {
  const { project } = useProject()
  const { userId } = useAuth()
  const { logActivity } = useStreak(userId || undefined)
  const [branch, setBranch] = useState<string>("")
  const [message, setMessage] = useState("")
  const [files, setFiles] = useState<LocalFile[]>([])

  const branches = api.project.getBranches.useQuery({ projectId: project?.id || "" }, { enabled: !!project?.id })
  const commitMutation = api.project.commitToRepo.useMutation()

  useEffect(() => {
    if (!branches.data?.length) return
    setBranch((b) => b || branches.data[0]!)
  }, [branches.data])

  const isDisabled = useMemo(() => {
    return !project?.id || !branch || !message || files.length === 0 || commitMutation.isPending
  }, [project?.id, branch, message, files, commitMutation.isPending])

  async function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList?.length) return
    const next: LocalFile[] = []
    for (const f of Array.from(fileList)) {
      const text = await f.text()
      next.push({ path: f.name, name: f.name, content: text })
    }
    setFiles(next)
  }

  function updatePath(index: number, path: string) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, path } : f)))
  }

  async function onCommit() {
    if (!project?.id) return
    try {
      const res = await commitMutation.mutateAsync({
        projectId: project.id,
        branch,
        message,
        files: files.map((f) => ({ path: f.path, content: f.content })),
      })
      toast.success("Commit created successfully")
      logActivity("commit")
      setMessage("")
      setFiles([])
    } catch (err: any) {
      toast.error(err?.message || "Commit failed")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">GitHub Commit</h1>
        <Link href={`/api/github/oauth/start?projectId=${project?.id || ""}`} className="text-sm underline">
          Connect GitHub
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Commit Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm">Branch</label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.data?.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm">Commit message</label>
              <Input className="mt-1" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe your changes" />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm">Files</label>
            <Input type="file" multiple onChange={onFileSelect} />
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input className="sm:col-span-2" value={f.path} onChange={(e) => updatePath(i, e.target.value)} placeholder="Path in repo (e.g., src/index.ts)" />
                <Input readOnly value={f.name} />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button disabled={isDisabled} onClick={onCommit}>
              {commitMutation.isPending ? "Committing..." : "Commit"}
            </Button>
          </div>
          {commitMutation.isPending && <p className="text-xs text-muted-foreground">Processing… Avoid duplicate submissions.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

export default CommitPage

