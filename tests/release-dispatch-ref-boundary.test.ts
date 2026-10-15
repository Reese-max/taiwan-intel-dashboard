import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

// Offline workflow-contract evaluation only. These tests never dispatch an
// Action, load provider credentials or claim actual GitHub job execution.
// Read the actual checked-in YAML rather than a second copied implementation.
type Result = 'success' | 'failure' | 'skipped' | 'cancelled'
type Job = { needs?: string | string[]; if?: string }
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> }
type Context = { ref: string | undefined; eventName?: string; cancelled?: boolean }
const workflow = YAML.parse(readFileSync('.github/workflows/update-and-deploy.yml', 'utf8')) as Workflow
const privilegedJobs = ['operating-state', 'save-state', 'deploy'] as const
const pipelineJobs = ['operating-state', 'fetch', 'audit', 'build-approved', 'save-state', 'deploy', 'next-refresh'] as const

function dependencies(job: Job): string[] {
  if (job.needs === undefined) return []
  if (typeof job.needs === 'string') return [job.needs]
  if (Array.isArray(job.needs) && job.needs.every(name => typeof name === 'string')) return job.needs
  throw new Error('Unsupported needs shape')
}

function expression(condition: unknown): string | undefined {
  if (condition === undefined) return undefined
  if (typeof condition !== 'string') throw new Error('Unsupported job-if type')
  const match = /^\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/.exec(condition)
  if (!match) throw new Error('Unsupported job-if expression')
  return match[1].trim().replace(/\s+/g, ' ')
}

function eligible(job: Job, context: Context, results: Record<string, Result>): boolean {
  const needs = dependencies(job)
  for (const name of needs) if (!(name in results)) throw new Error(`Missing needs result: ${name}`)
  const allSuccess = !context.cancelled && needs.every(name => results[name] === 'success')
  const condition = expression(job.if)
  // Job conditions without a status function have the implicit success gate.
  if (condition === undefined) return allSuccess
  if (condition === "github.ref == 'refs/heads/main'") return allSuccess && context.ref === 'refs/heads/main'
  if (condition === "always() && !cancelled() && needs['operating-state'].result == 'success'") {
    if (!needs.includes('operating-state')) throw new Error('Refresh must actually depend on operating-state')
    return !context.cancelled && results['operating-state'] === 'success'
  }
  // Do not eval arbitrary expressions or silently accept a weakened policy.
  throw new Error(`Unsupported job-if expression: ${condition}`)
}

function evaluatePipeline(context: Context, injected: Partial<Record<string, Result>> = {}): Record<string, Result> {
  const eventName = context.eventName ?? 'workflow_dispatch'
  if (!Object.prototype.hasOwnProperty.call(workflow.on, eventName)) throw new Error(`Undeclared workflow event: ${eventName}`)
  const results: Record<string, Result> = {}
  const visiting = new Set<string>()
  const visit = (name: string): Result => {
    if (name in results) return results[name]
    const job = workflow.jobs[name]
    if (!job) throw new Error(`Unknown workflow job: ${name}`)
    if (visiting.has(name)) throw new Error('Cyclic workflow needs')
    visiting.add(name)
    for (const dependency of dependencies(job)) visit(dependency)
    const admitted = eligible(job, context, results)
    results[name] = admitted ? injected[name] ?? 'success' : 'skipped'
    visiting.delete(name)
    return results[name]
  }
  for (const name of pipelineJobs) visit(name)
  return results
}

describe('Issue42: formal data publication uses the complete main branch ref', () => {
  it.each(['schedule', 'push', 'workflow_dispatch'])('keeps lawful main %s eligible in the unchanged needs chain', eventName => {
    const results = evaluatePipeline({ ref: 'refs/heads/main', eventName })
    for (const name of pipelineJobs) expect(results[name], name).toBe('success')
  })

  it.each([
    ['feature branch', 'refs/heads/feature/issue-42'],
    ['production branch', 'refs/heads/production'],
    ['tag with main shortname', 'refs/tags/main'],
    ['ordinary release tag', 'refs/tags/release-test'],
    ['empty ref', ''],
    ['missing ref', undefined],
  ])('denies %s before fetch, state write, deploy and refresh relay', (_label, ref) => {
    const results = evaluatePipeline({ ref, eventName: 'workflow_dispatch' })
    for (const name of pipelineJobs) expect(results[name], name).toBe('skipped')
  })

  it('guards every privileged entry even if preceding dependency results are supplied as successful', () => {
    for (const name of privilegedJobs) {
      const job = workflow.jobs[name]
      expect(job).toBeDefined()
      const results = Object.fromEntries(dependencies(job).map(dependency => [dependency, 'success' as Result]))
      expect(eligible(job, { ref: 'refs/heads/feature/issue-42' }, results), name).toBe(false)
      expect(eligible(job, { ref: 'refs/tags/main' }, results), name).toBe(false)
      expect(eligible(job, { ref: 'refs/heads/main' }, results), name).toBe(true)
    }
  })

  it.each(['operating-state', 'fetch', 'audit', 'build-approved'])('retains the original fail-closed %s failure before state/deploy', failedJob => {
    const results = evaluatePipeline({ ref: 'refs/heads/main' }, { [failedJob]: 'failure' as const })
    expect(results['save-state']).toBe('skipped')
    expect(results.deploy).toBe('skipped')
    // Existing retry relay is eligible after a later failure only when the
    // operating-state guard itself succeeded; do not alter that recovery policy.
    expect(results['next-refresh']).toBe(failedJob === 'operating-state' ? 'skipped' : 'success')
  })

  it('retains save-state failure protection before deploy while the legitimate relay remains eligible', () => {
    const results = evaluatePipeline({ ref: 'refs/heads/main' }, { 'save-state': 'failure' })
    expect(results['save-state']).toBe('failure')
    expect(results.deploy).toBe('skipped')
    expect(results['next-refresh']).toBe('success')
  })

  it('refuses a cancelled context in the actual refresh condition and implicit success gates', () => {
    const results = evaluatePipeline({ ref: 'refs/heads/main', cancelled: true })
    for (const name of pipelineJobs) expect(results[name], name).toBe('skipped')
    const job = workflow.jobs['next-refresh']
    const successfulNeeds = Object.fromEntries(dependencies(job).map(name => [name, 'success' as Result]))
    expect(eligible(job, { ref: 'refs/heads/main', cancelled: true }, successfulNeeds)).toBe(false)
  })

  it.each([
    "${{ github.ref_name == 'main' }}",
    "${{ startsWith(github.ref, 'refs/heads/') }}",
    '${{ true }}',
    "${{ github.ref == 'refs/heads/main' || true }}",
    'true',
  ])('refuses unsupported or weaker job-if rather than assuming it is safe: %s', condition => {
    expect(() => eligible({ if: condition }, { ref: 'refs/heads/main' }, {})).toThrow('Unsupported job-if')
  })
})
