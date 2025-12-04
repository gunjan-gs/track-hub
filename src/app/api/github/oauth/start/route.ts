import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const projectId = url.searchParams.get("projectId") || ""

  const clientId = process.env.GITHUB_CLIENT_ID
  const redirectUri = new URL("/api/github/oauth/callback", url.origin).toString()
  const authorize = new URL("https://github.com/login/oauth/authorize")
  authorize.searchParams.set("client_id", clientId || "")
  authorize.searchParams.set("redirect_uri", redirectUri)
  authorize.searchParams.set("scope", "repo")
  authorize.searchParams.set("state", JSON.stringify({ projectId }))

  return NextResponse.redirect(authorize)
}

