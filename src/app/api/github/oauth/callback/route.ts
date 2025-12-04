import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const stateRaw = url.searchParams.get("state")
  const state = stateRaw ? JSON.parse(stateRaw) as { projectId?: string } : {}
  const projectId = state.projectId || ""

  if (!code || !projectId) {
    return NextResponse.json({ error: "Invalid OAuth callback" }, { status: 400 })
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "OAuth exchange failed" }, { status: 500 })
  }
  const tokenJson = await tokenRes.json() as { access_token?: string }
  const accessToken = tokenJson.access_token
  if (!accessToken) {
    return NextResponse.json({ error: "No access token returned" }, { status: 500 })
  }

  // Persist token on project
  try {
    const { db } = await import("~/server/db")
    await db.project.update({ where: { id: projectId }, data: { gitHubToken: accessToken } })
  } catch {
    return NextResponse.json({ error: "Failed to save token" }, { status: 500 })
  }

  const redirect = new URL("/github/commit", url.origin)
  return NextResponse.redirect(redirect)
}

