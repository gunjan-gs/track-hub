import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCallerFactory, createTRPCRouter } from '~/server/api/trpc'
import { projectRouter } from '~/server/api/routers/project'

// Mock Clerk auth for protectedProcedure
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: 'user-1' }))
}))
vi.mock('~/server/db', () => ({ db: {} }))

const appRouter = createTRPCRouter({ project: projectRouter })
const createCaller = createCallerFactory(appRouter)

type Question = {
  id: string
  createdAt: Date
  updatedAt: Date
  question: string
  answer: string
  filesRefrences: any | null
  userId: string
  projectId: string
  user?: { imageUrl?: string | null; firstName?: string | null }
}

describe('QA router', () => {
  let questions: Question[]
  let memberships: Array<{ userId: string; projectId: string }>
  const headers = new Headers()

  beforeEach(() => {
    questions = []
    memberships = [{ userId: 'user-1', projectId: 'proj-1' }]
  })

  const ctx = {
    headers,
    db: {
      userToProject: {
        findFirst: async (opts: any) =>
          memberships.find(
            (m) => m.userId === opts.where.userId && m.projectId === opts.where.projectId
          ) || null,
      },
      question: {
        create: async ({ data }: { data: Question }) => {
          const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data as any
          const q: Question = {
            id: String(questions.length + 1),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...rest,
          }
          questions.push(q)
          return q
        },
        findMany: async (opts: any) => {
          const list = questions
            .filter((q) => q.projectId === opts.where.projectId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          if (opts.include?.user) {
            return list.map((q) => ({ ...q, user: { imageUrl: null, firstName: 'User' } }))
          }
          return list
        },
      },
    },
  }

  it('saves an answer and returns the record', async () => {
    const caller = createCaller(async () => ctx as any)
    const res = await caller.project.saveAnswer({
      projectId: 'proj-1',
      question: 'How to configure Tailwind?',
      answer: 'Update tailwind.config.ts',
      filesRefrences: [{ fileName: 'tailwind.config.ts' }],
    })
    expect(res.id).toBe('1')
    expect(res.projectId).toBe('proj-1')
    expect(res.userId).toBe('user-1')
  })

  it('prevents save when not a project member', async () => {
    memberships = []
    const caller = createCaller(async () => ctx as any)
    await expect(
      caller.project.saveAnswer({
        projectId: 'proj-1',
        question: 'Q',
        answer: 'A',
      })
    ).rejects.toThrow()
  })

  it('gets saved questions including user, sorted desc', async () => {
    const caller = createCaller(async () => ctx as any)
    await caller.project.saveAnswer({ projectId: 'proj-1', question: 'Q1', answer: 'A1' })
    await new Promise((r) => setTimeout(r, 5))
    await caller.project.saveAnswer({ projectId: 'proj-1', question: 'Q2', answer: 'A2' })

    const list = await caller.project.getQuestions({ projectId: 'proj-1' })
    expect(list.length).toBe(2)
    expect(list[0]!.question).toBe('Q2')
    expect(list[0]!.user).toBeTruthy()
  })
})
