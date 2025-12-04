import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { pollCommits } from "~/lib/github";
import { checkCredits, indexGithubRepo } from "~/lib/github-loader";
import { Octokit } from "octokit";

export const projectRouter = createTRPCRouter({

    createProject: protectedProcedure.input(z.object({
        name: z.string(),
        repoUrl: z.string(),
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
                    console.error("pollCommits failed", err);
                }
            })(),
            (async () => {
                try {
                    await indexGithubRepo(project.id, repoUrl, gitHubToken);
                } catch (err) {
                    console.error("indexGithubRepo failed", err);
                }
            })(),
        ]).catch((err) => console.error("Background tasks error", err));

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

        console.log(`polling commits for project ${projectId}`);

        pollCommits(projectId)
            .then(() => {
                console.log(`Successfully polled commits for project ${projectId}`);
            })
            .catch((error) => {
                console.error(`Error polling commits for project ${projectId}`, error);
            });

        return await ctx.db.commit.findMany({
            where: {projectId},
        });
    }),

    saveAnswer: protectedProcedure.input(z.object({
        projectId: z.string(),
        question: z.string(),
        answer: z.string(),
        filesRefrences:z.any()
    })).mutation(async ({ctx, input}) => {
        return await ctx.db.question.create({
            data:{
                answer: input.answer,
                filesRefrences:input.filesRefrences,
                projectId: input.projectId,
                question: input.question,
                userId: ctx.user.userId!,
            }
        })
    }),
    
    getQuestions: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).query(async ({ctx, input}) => {
        return await ctx.db.question.findMany({
            where: {projectId: input.projectId},
            include:{
                user: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }),

    uploadMeeting: protectedProcedure.input(z.object({
        projectId: z.string(),
        meetingUrl: z.string(),
        name: z.string(),
    })).mutation(async ({ctx, input}) => {
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
        return await ctx.db.meeting.delete({
            where: {id: input.meetingId},
        });
    }),

    getMeetingById: protectedProcedure.input(z.object({
        meetingId: z.string(),
    })).query(async ({ctx, input}) => {
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
      console.error("Error fetching repo files:", err?.response?.data || err);

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

    getBranches: protectedProcedure.input(z.object({
        projectId: z.string(),
    })).query(async ({ ctx, input }) => {
        const project = await ctx.db.project.findUnique({
            where: { id: input.projectId },
            select: { repoUrl: true, gitHubToken: true },
        })
        if (!project?.repoUrl) throw new Error("Repository URL not configured")
        const parts = project.repoUrl.split("/")
        const [owner, repo] = parts.slice(-2) as [string | undefined, string | undefined]
        if (!owner || !repo) throw new Error("Invalid repository URL")
        const octokit = new Octokit({ auth: project.gitHubToken || process.env.GITHUB_ACCESS_TOKEN })
        try {
            const { data } = await octokit.rest.repos.listBranches({ owner, repo })
            return data.map(b => b.name)
        } catch (err: any) {
            if (err?.status === 401) throw new Error("GitHub authentication failed")
            if (err?.status === 403) throw new Error("GitHub rate limit exceeded")
            throw new Error("Unable to fetch branches")
        }
    }),

    commitToRepo: protectedProcedure.input(z.object({
        projectId: z.string(),
        branch: z.string().min(1),
        message: z.string().min(1),
        files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
    })).mutation(async ({ ctx, input }) => {
        const project = await ctx.db.project.findUnique({
            where: { id: input.projectId },
            select: { repoUrl: true, gitHubToken: true },
        })
        if (!project?.repoUrl) throw new Error("Repository URL not configured")
        const token = project.gitHubToken || process.env.GITHUB_ACCESS_TOKEN
        if (!token) throw new Error("GitHub token not available")
        const parts = project.repoUrl.split("/")
        const [owner, repo] = parts.slice(-2) as [string | undefined, string | undefined]
        if (!owner || !repo) throw new Error("Invalid repository URL")
        const octokit = new Octokit({ auth: token })

        try {
            const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${input.branch}` })
            const baseCommitSha: string = ref.data.object.sha as string
            const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseCommitSha })
            const baseTreeSha: string = baseCommit.data.tree.sha as string

            const treeEntries = input.files.map((f) => ({
                path: f.path,
                mode: "100644" as const,
                type: "blob" as const,
                content: f.content,
            }))

            const newTree = await octokit.rest.git.createTree({ owner, repo, base_tree: baseTreeSha, tree: treeEntries })
            const newCommit = await octokit.rest.git.createCommit({ owner, repo, message: input.message, tree: newTree.data.sha as string, parents: [baseCommitSha] })
            await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${input.branch}`, sha: newCommit.data.sha as string })
            return { commitSha: newCommit.data.sha }
        } catch (err: any) {
            const status = err?.status
            if (status === 401) throw new Error("Authentication failed. Please reconnect GitHub.")
            if (status === 403) throw new Error("Insufficient permissions or rate limit exceeded.")
            if (status === 404) throw new Error("Branch not found.")
            throw new Error("Commit failed due to invalid data or network error.")
        }
    }),

});
