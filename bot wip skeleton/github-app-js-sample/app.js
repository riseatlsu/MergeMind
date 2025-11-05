// server.mjs (or .js if your project uses "type": "module" in package.json)
import dotenv from 'dotenv'
import fs from 'fs'
import http from 'http'
import { Octokit, App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'
import OpenAI from 'openai' // official openai npm client

dotenv.config()

// Secret info from .env or public info
const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
const secret = process.env.WEBHOOK_SECRET
const enterpriseHostname = process.env.ENTERPRISE_HOSTNAME
const fallbackMessage = fs.readFileSync('./message.md', 'utf8')

// initialize OpenAI client (uses OPENAI_API_KEY from .env)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Constructed and configured app using Octokit package
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  },
  ...(enterpriseHostname && {
    Octokit: Octokit.defaults({
      baseUrl: `https://${enterpriseHostname}/api/v3`
    })
  })
})

// Debug sanity test for self authentication
const { data } = await app.octokit.request('/app')
app.octokit.log.debug(`Authenticated as '${data.name}'`)

/**
 * Generate a PR greeting message via OpenAI.
 * - Uses the PR title/body to craft a friendly intro.
 * - Introduces itself as "MergeMind assistant".
 * - Invites responses via PR comments.
 */
async function generatePRMessage({ prTitle, prBody, author, repoFullName, mergeStatus }) {
  // Compose prompt/messages for clarity
  const systemPrompt = `You are MergeMind, a GitHub assistant. When creating a comment for a newly opened pull request, introduce yourself clearly and concisely as "MergeMind assistant". 
Explain briefly what you can do and that the maintainers or PR author can respond by leaving comments. Keep it friendly and short (approx 4-8 sentences). Avoid adding code diffs or making commits — stick to an intro & guide for next steps.`;

  const userPrompt = `PR title: "${prTitle}"
PR author: ${author}
PR body: ${prBody ? prBody.slice(0, 2000) : "<no body provided>"}
Repository: ${repoFullName}
Merge Status: ${mergeStatus}

Write a short GitHub comment (markdown allowed) that:
 - Introduces itself as MergeMind assistant
 - Briefly says it can help review / answer questions and accept simple instructions in comments
 - Mentions it received this PR and will follow up in the thread
 - Keeps the tone friendly and professional.
 - Attempt to estimate the time in minutes it would take to resolve this pull request, 
   make sure that this part is a line away from the introduction.
Return only the comment text (no extra explanation).`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // pick a model available to you; change if needed
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 300,
      temperature: 0.6
    })

    // The official client returns choices; extract text
    const text = completion.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty completion from OpenAI')
    return text
  } catch (err) {
    console.error('OpenAI generation failed:', err?.message ?? err)
    console.log('Falling back to static message.md')
    return fallbackMessage
  }
}

// Subscribe to pull_request.opened
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
  const pr = payload.pull_request
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const repoFullName = payload.repository.full_name

  console.log(`Received a pull request event for #${pr.number} in ${repoFullName}`)

  // Checks the merge status for the pull request
  if (pr.mergeable === false || pr.mergeable_state === "dirty") {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pr.number,
        body: `Hey @${pr.user.login}, this pull request currently has **merge conflicts**.  
                Please resolve them before merging.`,
      });
    }

  // Build context for AI
  const context = {
    prTitle: pr.title || '',
    prBody: pr.body || '',
    author: pr.user?.login || 'unknown',
    repoFullName,
    number: pr.number || '',
    mergeStatus: pr.mergeable_state
  }

  // context for testing purposes
  console.log("✅ PR context captured:", context);

  // Generate message (or fallback)
  const body = await generatePRMessage(context)

  // Post the comment
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body
    })
    console.log(`Posted AI-generated comment to ${repoFullName}#${pr.number}`)
  } catch (error) {
    if (error.response) {
      console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
    } else {
      console.error(error)
    }
  }
})

app.webhooks.onError((error) => {
  if (error.name === 'AggregateError') {
    console.log(`Error processing request: ${error.event}`)
  } else {
    console.log(error)
  }
})

const port = process.env.PORT || 3000
const path = '/api/webhook'
const localWebhookUrl = `http://localhost:${port}${path}`

const middleware = createNodeMiddleware(app.webhooks, { path })

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`)
  console.log('Press Ctrl + C to quit.')
})
