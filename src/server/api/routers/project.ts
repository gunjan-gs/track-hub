import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { pollCommits } from "~/lib/github";
import { checkCredits, indexGithubRepo } from "~/lib/github-loader";
import { logger } from "~/lib/logger";

export const projectRouter = createTRPCRouter({

    createProject: protectedProcedure.input(z.object({
        name: z.string().trim().min(1),
        repoUrl: z.string().url(),
        gitHubToken: z.string().optional(),
    })).mutation(async ({ctx, input}) => {

        const {name, repoUrl, gitHubToken}= input;

        const user = await ctx.db.user.findUnique({
            where:{
                id: ctx.user.userId!
            },
            select:{
                credits: true
            }
        })

        if(!user){
            throw new Error("User not found");
        }
        const currentCredit = user.credits || 0;
        const fileCount = await checkCredits(repoUrl, gitHubToken);
        if (fileCount > currentCredit) {
            throw new Error("Insufficient credits");
        }


        const project = await ctx.db.project.create({
            data: {
                name,
                repoUrl,
                gitHubToken,
                userToProjects:{
                    create:{
                        userId: ctx.user.userId!,
                    }
                }
            },
        });
        // Kick off background tasks but do not block or throw on failure
        Promise.allSettled([
            (async () => {
                try {
                    await pollCommits(project.id);
                } catch (err) {
                    logger.error("pollCommits failed", err);
                }
            })(),
            (async () => {
                try {
                    await indexGithubRepo(project.id, repoUrl, gitHubToken);
                } catch (err) {
                    logger.error("indexGithubRepo failed", err);
                }
            })(),
        ]).catch((err) => logger.error("Background tasks error", err));

        await ctx.db.user.update({where:{id: ctx.user.userId!}, data:{credits: { decrement: fileCount}}});
        return project;
    }),
    getProjects: protectedProcedure.query(async ({ctx}) => {
        return await ctx.db.project.findMany({
            where: {
                userToProjects: {some: {userId: ctx.user.userId!}},
                deletedAt: null,
            },
        });
    }),
    getCommits: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).query(async ({ctx, input}) => {
        const {projectId} = input;

        logger.info(`[Commits] polling for project ${projectId}`);

        pollCommits(projectId)
            .then(() => {
                logger.info(`[Commits] polled for project ${projectId}`);
            })
            .catch((error) => {
                logger.error(`[Commits] error for project ${projectId}`, error);
            });

        return await ctx.db.commit.findMany({
            where: {projectId},
        });
    }),

    saveAnswer: protectedProcedure
      .input(
        z.object({
          projectId: z.string(),
          question: z.string(),
          answer: z.string(),
          filesRefrences: z.any().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const isMember = await ctx.db.userToProject.findFirst({
            where: { userId: ctx.user.userId!, projectId: input.projectId },
          })
          if (!isMember) {
            logger.warn(
              `[QA] saveAnswer denied: user ${ctx.user.userId} not member of project ${input.projectId}`
            )
            throw new Error("Not authorized to save answers for this project")
          }

          const record = await ctx.db.question.create({
            data: {
              answer: input.answer,
              filesRefrences: input.filesRefrences ?? null,
              projectId: input.projectId,
              question: input.question,
              userId: ctx.user.userId!,
            },
          })
          logger.info(
            `[QA] saveAnswer success: question ${record.id} for project ${input.projectId}`
          )
          return record
        } catch (err) {
          logger.error("[QA] saveAnswer error", err)
          throw err
        }
      }),
    
    getQuestions: protectedProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ ctx, input }) => {
        try {
          const items = await ctx.db.question.findMany({
            where: { projectId: input.projectId },
            include: { user: true },
            orderBy: { createdAt: "desc" },
          })
          logger.info(
            `[QA] getQuestions fetched ${items.length} items for project ${input.projectId}`
          )
          return items
        } catch (err) {
          logger.error("[QA] getQuestions error", err)
          throw err
        }
      }),

    uploadMeeting: protectedProcedure.input(z.object({
        projectId: z.string(),
        meetingUrl: z.string().url(),
        name: z.string().trim().min(1),
    })).mutation(async ({ctx, input}) => {
        const isMember = await ctx.db.userToProject.findFirst({ where: { userId: ctx.user.userId!, projectId: input.projectId }})
        if (!isMember) throw new Error("Not authorized for this project")
        const meeting = await ctx.db.meeting.create({
            data:{
                meetingUrl: input.meetingUrl,
                name: input.name,
                projectId: input.projectId,
                status: 'PROCESSING',
            }
        })
        return meeting
    }),

    getMeetings: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).query(async ({ctx, input}) => {
        const isMember = await ctx.db.userToProject.findFirst({ where: { userId: ctx.user.userId!, projectId: input.projectId }})
        if (!isMember) throw new Error("Not authorized for this project")
        return await ctx.db.meeting.findMany({
            where: {projectId: input.projectId},
            include:{
                issues: true,
            }
        });
    }),
    
    deleteMeeting: protectedProcedure.input(z.object({
        meetingId: z.string(),
    })).mutation(async ({ctx, input}) => {
        const meeting = await ctx.db.meeting.findUnique({ where: { id: input.meetingId } })
        if (!meeting) throw new Error('Meeting not found')
        const isMember = await ctx.db.userToProject.findFirst({ where: { userId: ctx.user.userId!, projectId: meeting.projectId }})
        if (!isMember) throw new Error("Not authorized for this project")
        return await ctx.db.meeting.delete({
            where: {id: input.meetingId},
        });
    }),

    getMeetingById: protectedProcedure.input(z.object({
        meetingId: z.string(),
    })).query(async ({ctx, input}) => {
        const meeting = await ctx.db.meeting.findUnique({ where: { id: input.meetingId } })
        if (!meeting) throw new Error('Meeting not found')
        const isMember = await ctx.db.userToProject.findFirst({ where: { userId: ctx.user.userId!, projectId: meeting.projectId }})
        if (!isMember) throw new Error("Not authorized for this project")
        return await ctx.db.meeting.findUnique({
            where: {id: input.meetingId},
            include:{
                issues: true,
            }
        });
    }),

    deleteProject: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).mutation(async ({ctx, input}) => {
        const isMember = await ctx.db.userToProject.findFirst({ where: { userId: ctx.user.userId!, projectId: input.projectId }})
        if (!isMember) throw new Error("Not authorized for this project")
        return await ctx.db.project.delete({
            where: {id: input.projectId},
        });
    }),

    getTeamMembers: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).query(async ({ctx, input}) => {
        return await ctx.db.userToProject.findMany({
            where:{
                projectId: input.projectId
            },
            include:{
                user: true
            }
        })
    }),

    getMyCredits: protectedProcedure.query(async ({ctx}) => {
        return await ctx.db.user.findUnique({
            where: {
                id: ctx.user.userId!,
            },
            select:{
                credits: true
            }
        });
    }),

    checkCredits: protectedProcedure
  .input(
    z.object({
      githubUrl: z.string(),
      githubToken: z.string().optional(), // user token is optional
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Use user-provided token first, fallback to server token
    const token = input.githubToken || process.env.GITHUB_ACCESS_TOKEN ;
    if (!token) {
      throw new Error("No GitHub token provided or configured.");
    }

    let fileCount = 0;
    try {
      fileCount = await checkCredits(input.githubUrl, token);
    } catch (err: any) {
      logger.error("Error fetching repo files:", err?.response?.data || err);

      // Handle GitHub API errors gracefully
      if (err?.response?.status === 401) {
        throw new Error("Invalid GitHub token (401 Bad credentials).");
      }
      if (err?.response?.status === 403) {
        throw new Error("GitHub API rate limit exceeded. Please try again later.");
      }
      throw new Error("Unable to fetch repository files.");
    }

    const userCredits = await ctx.db.user.findUnique({
      where: { id: ctx.user.userId! },
      select: { credits: true },
    });

    return {
      fileCount,
      credits: userCredits?.credits || 0,
    };
  }),


    getPurchaseHistory: protectedProcedure.query(async ({ ctx }) => {
        return await ctx.db.stripeTransaction.findMany({
            where: { userId: ctx.user.userId! },
            orderBy: { createdAt: 'desc' },
        });
    }),

});
