import { AUTOMATION_CATALOG, CUSTOM_RULE_ACTIONS } from '@cfe/business-rules';
import { Prisma } from '@cfe/database';
import type { WorkerContext } from '../context';

const catalog = new Map(AUTOMATION_CATALOG.map((a) => [a.key, a]));

export interface AutomationSubject {
  organizationId: string;
  subjectType: string;
  subjectId: string;
  input?: Prisma.InputJsonValue;
}

export type AutomationOutcome = { status: 'SUCCEEDED'; output?: Prisma.InputJsonValue } | { status: 'SKIPPED'; output: Prisma.InputJsonValue };

/**
 * Executes one built-in automation with an execution log entry.
 * Disabled (toggleable) rules are logged as SKIPPED; failures are logged and rethrown so
 * BullMQ applies the queue's retry policy.
 */
export async function runAutomation(
  ctx: WorkerContext,
  ruleKey: string,
  subject: AutomationSubject,
  fn: () => Promise<AutomationOutcome>,
): Promise<AutomationOutcome> {
  const def = catalog.get(ruleKey);
  if (!def) throw new Error(`Unknown automation "${ruleKey}"`);
  const rule = await ctx.prisma.automationRule.findUnique({
    where: { organizationId_key: { organizationId: subject.organizationId, key: ruleKey } },
  });
  if (!rule) throw new Error(`Automation "${ruleKey}" is not configured for organization ${subject.organizationId}`);

  const base = {
    organizationId: subject.organizationId, ruleId: rule.id, trigger: def.trigger, action: def.action, level: def.level,
    subjectType: subject.subjectType, subjectId: subject.subjectId, input: subject.input,
  };
  if (!rule.enabled && def.toggleable) {
    const output = { reason: 'Rule disabled' };
    await ctx.prisma.automationRun.create({ data: { ...base, status: 'SKIPPED', output, finishedAt: new Date() } });
    return { status: 'SKIPPED', output };
  }

  const run = await ctx.prisma.automationRun.create({ data: { ...base, status: 'RUNNING', attempts: 1, startedAt: new Date() } });
  try {
    const outcome = await fn();
    await ctx.prisma.automationRun.update({ where: { id: run.id }, data: { status: outcome.status, output: outcome.output, finishedAt: new Date() } });
    await fireCustomRules(ctx, subject.organizationId, def.trigger, subject);
    return outcome;
  } catch (err) {
    await ctx.prisma.automationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 2000), finishedAt: new Date() } });
    throw err;
  }
}

/** User-defined rules: on a trigger, notify admins or open a review task. Internal actions only. */
export async function fireCustomRules(ctx: WorkerContext, organizationId: string, trigger: string, subject: AutomationSubject) {
  const rules = await ctx.prisma.automationRule.findMany({
    where: { organizationId, trigger, enabled: true, key: { notIn: [...catalog.keys()] }, action: { in: [...CUSTOM_RULE_ACTIONS] } },
  });
  for (const rule of rules) {
    if (rule.action === 'notification.alert_admin') {
      await notify(ctx, organizationId, 'INFO', rule.name, `${trigger} on ${subject.subjectType} ${subject.subjectId}`);
    } else {
      await openReviewTask(ctx, organizationId, `custom:${rule.key}`, subject.subjectType, subject.subjectId, rule.name);
    }
    await ctx.prisma.automationRun.create({
      data: {
        organizationId, ruleId: rule.id, trigger, action: rule.action, level: 'AUTOMATIC', status: 'SUCCEEDED',
        subjectType: subject.subjectType, subjectId: subject.subjectId, startedAt: new Date(), finishedAt: new Date(),
      },
    });
  }
}

export async function notify(ctx: WorkerContext, organizationId: string, severity: 'INFO' | 'WARNING' | 'CRITICAL', title: string, body: string, link?: string) {
  await ctx.prisma.notification.create({ data: { organizationId, severity, title, body, link } });
}

/** Opens a review task unless an identical one is already open. */
export async function openReviewTask(
  ctx: WorkerContext,
  organizationId: string,
  kind: string,
  subjectType: string,
  subjectId: string,
  summary: string,
  details?: Prisma.InputJsonValue,
) {
  const existing = await ctx.prisma.reviewTask.findFirst({ where: { organizationId, kind, subjectType, subjectId, status: 'OPEN' } });
  if (existing) return existing;
  return ctx.prisma.reviewTask.create({ data: { organizationId, kind, subjectType, subjectId, summary, details } });
}
