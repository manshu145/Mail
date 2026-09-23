import { submitToMta, SmtpSubmissionUncertainError, SmtpResponseError } from "../../src/lib/smtp-submit";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns, contacts, messageEvents, messages, sendingAccounts, templates } from "../../src/db/schema";
import { providerCooldowns, sendingAccountWarmups, sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { signPublicToken } from "../../src/lib/public-tokens";
import { combinedAttachmentLimitError, loadCampaignAttachments, type CampaignAttachment } from "../../src/lib/campaign-attachments";
import { loadTemplateAttachments } from "../../src/lib/template-attachments";
import { buildMimeContent } from "../../src/lib/mime-email";
import { makeBounceAddress } from "../../src/lib/bounce-address";
import { injectPreheader } from "../../src/lib/email-preheader";
import { hasConfirmedConsent } from "../../src/lib/consent-policy";
import { getRuntimePolicy } from "../../src/lib/runtime-policy";
import { providerForEmail, SENDER_COOLDOWN_KEY, UPSTREAM_COOLDOWN_KEY } from "../../src/lib/provider";
import { readDeliverySettings, type DeliverySettings } from "../../src/lib/delivery-settings";
import { personalizeContactText, personalizeContactHtml } from "../../src/lib/personalization";
import { validationAllowsSend } from "../../src/lib/validation-policy";
import { buildBulkDeliverabilityHeaders } from "../../src/lib/deliverability-headers";

const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
const mtaHost = process.env.MTA_HOST || "mta";
const mtaPort = Math.max(1, Number(process.env.MTA_PORT || "10025"));
const smtpTimeoutMs = Math.max(3000, Number(process.env.MTA_SMTP_TIMEOUT_MS || "15000"));
const intervalMs = Math.max(1000, Number(process.env.TRANSPORT_WORKER_INTERVAL_MS || "3000"));
const claimBatch = Math.min(200, Math.max(1, Number(process.env.TRANSPORT_BATCH_SIZE || "50")));
const bounceSigningEnabled = Boolean(process.env.BOUNCE_SECRET?.trim());

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function personalize(value: string, contact: typeof contacts.$inferSelect) { return personalizeContactText(value, contact); }
function headerValue(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }
function retryDelaySeconds(attempt: number, settings: DeliverySettings) { return Math.min(settings.retryMaxSeconds, Math.max(settings.retryInitialSeconds, Math.round(settings.retryInitialSeconds * settings.retryBackoffMultiplier ** Math.max(0, attempt - 1)))); }
function ensureUnsubscribe(html: string, text: string, unsubscribeUrl: string) {
  let nextHtml = html;
  let nextText = text;
  if (!nextHtml.includes(unsubscribeUrl)) nextHtml += `<div style="margin-top:32px;padding-top:18px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center">You are receiving this email because you are subscribed to this sender.<br><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a></div>`;
  if (!nextText.includes(unsubscribeUrl)) nextText = `${nextText}${nextText ? "\n\n" : ""}Unsubscribe: ${unsubscribeUrl}`;
  return { html: nextHtml, text: nextText };
}
async function event(messageId:string,type:string,payload:Record<string,unknown>={}){await db.insert(messageEvents).values({messageId,type,payload}).catch((error)=>console.error("[transport-event]",error));}
async function heartbeat(meta: Record<string, unknown> = {}) { await db.insert(workerHeartbeats).values({ workerName: "transport", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } }); }

async function rewriteLinks(html: string, messageId: string) {
  if (!appUrl) return html;
  let output = html;
  for (const match of [...html.matchAll(/href=(['"])(https?:\/\/[^'\"]+)\1/gi)]) {
    const target = match[2];
    if (target.startsWith(`${appUrl}/unsubscribe/`) || target.startsWith(`${appUrl}/tracking/`)) continue;
    const token = await signPublicToken({ messageId, url: target }, "30d");
    output = output.replace(match[0], `href=${match[1]}${appUrl}/tracking/click/${token}${match[1]}`);
  }
  return output;
}


function optionalMin(...values: number[]) {
  const finiteCaps = values.filter((value) => Number.isFinite(value) && value > 0);
  return finiteCaps.length ? Math.min(...finiteCaps) : 0;
}
function warmupLimit(warmup: typeof sendingAccountWarmups.$inferSelect | null, accountDaily: number) {
  if (!warmup?.enabled || !warmup.startedAt) return accountDaily;
  const days = Math.max(0, Math.floor((Date.now() - warmup.startedAt.getTime()) / 86400000));
  const calculated = Math.floor(warmup.dayOneLimit * Math.pow(1 + warmup.growthPercent / 100, days));
  return optionalMin(accountDaily, warmup.maxDailyLimit, Math.max(warmup.dayOneLimit, calculated));
}
async function accountWithinLimits(account: typeof sendingAccounts.$inferSelect, settings: DeliverySettings) {
  const [warmup] = await db.select().from(sendingAccountWarmups).where(eq(sendingAccountWarmups.sendingAccountId, account.id)).limit(1);
  const effectiveHourly = optionalMin(account.hourlyLimit, settings.maxRollingHour);
  const effectiveDaily = optionalMin(warmupLimit(warmup || null, account.dailyLimit), settings.maxRolling24h);
  const result = await db.execute(sql`select count(*) filter(where m.accepted_at >= now() - interval '1 hour')::int as hour_count,count(*) filter(where m.accepted_at >= now() - interval '24 hours')::int as day_count from messages m join campaigns c on c.id = m.campaign_id where c.sending_account_id = ${account.id}`);
  const row = (result.rows[0] || {}) as Record<string, unknown>;
  const hourCount = Number(row.hour_count || 0), dayCount = Number(row.day_count || 0);
  return { allowed: (effectiveHourly === 0 || hourCount < effectiveHourly) && (effectiveDaily === 0 || dayCount < effectiveDaily), effectiveHourly, effectiveDaily };
}

async function providerGate(accountId: string, recipientEmail: string, cooldownMinutes: number) {
  const provider = providerForEmail(recipientEmail);
  const active = await db.select().from(providerCooldowns).where(and(
    eq(providerCooldowns.sendingAccountId, accountId),
    eq(providerCooldowns.active, true),
  ));
  const cooldown = active.find((row) => row.provider === UPSTREAM_COOLDOWN_KEY)
    || active.find((row) => row.provider === SENDER_COOLDOWN_KEY)
    || active.find((row) => row.provider === provider);
  if (!cooldown) {
    return {
      allowed: true,
      provider,
      probe: false,
      retryAt: null as Date | null,
      cooldownKey: null as string | null,
      cooldownScope: null as "provider" | "sender" | "upstream" | null,
    };
  }

  const cooldownScope = cooldown.provider === UPSTREAM_COOLDOWN_KEY
    ? "upstream" as const
    : cooldown.provider === SENDER_COOLDOWN_KEY
      ? "sender" as const
      : "provider" as const;
  const cooldownKey = cooldown.provider;
  const now = new Date();
  if (cooldown.nextProbeAt && cooldown.nextProbeAt > now) {
    return { allowed: false, provider, probe: false, retryAt: cooldown.nextProbeAt, cooldownKey, cooldownScope };
  }

  const retryAt = new Date(Date.now() + cooldownMinutes * 60_000);
  const reserved = await pool.query<{ id: string }>(`
    update provider_cooldowns
    set last_probe_at=$2,next_probe_at=$3,updated_at=$2
    where id=$1 and active=true and (next_probe_at is null or next_probe_at <= $2)
    returning id
  `, [cooldown.id, now, retryAt]);
  if (!reserved.rowCount) {
    const [current] = await db.select().from(providerCooldowns).where(eq(providerCooldowns.id, cooldown.id)).limit(1);
    return { allowed: false, provider, probe: false, retryAt: current?.nextProbeAt || retryAt, cooldownKey, cooldownScope };
  }
  await pool.query(
    `insert into provider_cooldown_events(cooldown_id,sending_account_id,provider,event_type,reason,response,metadata) values($1,$2,$3,'probe_started',$4,$5,$6::jsonb)`,
    [cooldown.id, accountId, cooldownKey, cooldown.reason, cooldown.lastResponse, JSON.stringify({ nextProbeAt: retryAt.toISOString(), recipientEmail, scope: cooldownScope })],
  );
  return { allowed: true, provider, probe: true, retryAt, cooldownKey, cooldownScope };
}

async function releaseProviderCooldown(id: string, cooldownKey: string | null, retryAt: Date | null, cooldownMinutes: number) {
  const next = retryAt || new Date(Date.now() + cooldownMinutes * 60_000);
  const key = cooldownKey || "provider";
  await pool.query(`update messages set status='ready_for_transport',next_attempt_at=$2,last_error=$3,attempt_count=greatest(attempt_count-1,0) where id=$1 and status='sending'`, [id, next, `provider_cooldown:${key}`]);
  await event(id,"provider_cooldown",{cooldownKey:key,retryAt:next.toISOString()});
}

type Claimed = { id: string; attempt_count: number; recipient_email: string };
async function claimMessages(campaignBurstPerRound: number): Promise<Claimed[]> {
  const result = await pool.query<Claimed>(`
    with eligible as (
      select
        m.id,
        m.campaign_id,
        m.recipient_email,
        m.queued_at,
        coalesce(c.started_at,c.created_at) as campaign_started_at,
        row_number() over(partition by m.campaign_id order by m.queued_at asc,m.id asc) as campaign_rank
      from messages m
      join campaigns c on c.id=m.campaign_id
      where c.status='sending'
        and m.status in ('ready_for_transport','deferred')
        and (m.next_attempt_at is null or m.next_attempt_at <= now())
    ),
    picked as (
      select e.id
      from eligible e
      order by ((e.campaign_rank-1)/$2::int) asc,e.campaign_started_at asc,e.campaign_rank asc
      limit $1
    )
    update messages m
    set status='sending',last_attempt_at=now(),attempt_count=m.attempt_count+1,last_error=null
    from picked
    where m.id=picked.id
      and m.status in ('ready_for_transport','deferred')
      and (m.next_attempt_at is null or m.next_attempt_at <= now())
    returning m.id,m.attempt_count,m.recipient_email`, [claimBatch,campaignBurstPerRound]);
  const counts = new Map<string, number>();
  for (const row of result.rows) { const p = providerForEmail(row.recipient_email); counts.set(p, (counts.get(p) || 0) + 1); }
  return result.rows.sort((a,b) => (counts.get(providerForEmail(b.recipient_email)) || 0) - (counts.get(providerForEmail(a.recipient_email)) || 0));
}
async function markDeferred(id: string, attempt: number, error: unknown, settings: DeliverySettings) {
  const detail = error instanceof Error ? error.message.slice(0, 1000) : "mta_submission_error";
  if ((error instanceof SmtpResponseError && error.code >= 500) || attempt >= settings.retryMaxAttempts) {
    await pool.query(`update messages set status='failed',last_error=$2,next_attempt_at=null where id=$1 and status='sending'`, [id, detail]);
    await event(id,"transport_failed",{attempt,error:detail});
    return "failed" as const;
  }
  const delaySeconds = retryDelaySeconds(attempt, settings);
  await pool.query(`update messages set status='deferred',last_error=$2,next_attempt_at=now()+($3::int * interval '1 second') where id=$1 and status='sending'`, [id, detail, delaySeconds]);
  await event(id,"transport_deferred",{attempt,error:detail,retryInSeconds:delaySeconds});
  return "deferred" as const;
}
async function releaseThrottled(id: string) { await pool.query(`update messages set status='ready_for_transport',next_attempt_at=now()+interval '60 seconds',last_error='sending_account_rate_limited',attempt_count=greatest(attempt_count-1,0) where id=$1 and status='sending'`, [id]); await event(id,"transport_throttled",{retryInSeconds:60}); }
async function wakeOverdueCooldownMessages() {
  const overdue = await pool.query<{ sending_account_id: string; provider: string }>(`
    select sending_account_id,provider from provider_cooldowns
    where active=true and (next_probe_at is null or next_probe_at <= now())
    order by coalesce(next_probe_at,detected_at) asc limit 50
  `);
  let awakened = 0;
  for (const cooldown of overdue.rows) {
    const candidates = await pool.query<{ id: string; recipient_email: string; last_error: string | null }>(`
      select m.id::text,m.recipient_email,m.last_error
      from messages m join campaigns c on c.id=m.campaign_id
      where c.sending_account_id=$1 and c.status='sending' and m.status='ready_for_transport'
      order by m.queued_at asc limit 500
    `, [cooldown.sending_account_id]);
    const candidate = candidates.rows.find((row) =>
      cooldown.provider === UPSTREAM_COOLDOWN_KEY
      || cooldown.provider === SENDER_COOLDOWN_KEY
      || row.last_error === `provider_cooldown:${cooldown.provider}`
      || providerForEmail(row.recipient_email) === cooldown.provider
    );
    if (!candidate) continue;
    const updated = await pool.query(`update messages set next_attempt_at=now() where id=$1 and status='ready_for_transport'`, [candidate.id]);
    awakened += updated.rowCount || 0;
  }
  return awakened;
}
async function recoverStaleClaims() {
  const result=await pool.query<{id:string}>(`update messages set status='failed',next_attempt_at=null,last_error='transport_state_uncertain_after_worker_restart' where status='sending' and accepted_at is null and last_attempt_at is not null and last_attempt_at < now()-interval '10 minutes' returning id`);
  for(const row of result.rows) await event(row.id,"transport_recovery_failed",{reason:"stale_sending_claim"});
  return result.rowCount || 0;
}

async function runOnce() {
  if (!appUrl) throw new Error("APP_URL is required");
  // A worker can survive a transient exception while one or more DB claims remain
  // in `sending`. Recover them every cycle so they never stay stranded forever.
  // We fail uncertain claims instead of retrying automatically because the local
  // MTA may already have accepted them before the worker lost state; retrying
  // could create duplicate mail.
  const recoveredStale = await recoverStaleClaims();
  const overdueCooldownMessagesAwakened = await wakeOverdueCooldownMessages();
  if (!getRuntimePolicy().sendingEnabled) {
    await heartbeat({ state: "online", sendingEnabled: false, recoveredStale, overdueCooldownMessagesAwakened });
    return;
  }
  const settings = await readDeliverySettings();
  const delayMs = Math.max(Math.ceil(1000 / settings.maxPerSecond), settings.providerIntervalMs);
  const providerNextAt = new Map<string, number>();
  let globalNextAt = 0;
  const claimed = await claimMessages(settings.campaignBurstPerRound);
  let accepted = 0, deferred = 0, failed = 0, throttled = 0, providerHeld = 0, providerProbes = 0;
  const campaignAttachmentCache = new Map<string, CampaignAttachment[]>();
  const templateAttachmentCache = new Map<string, CampaignAttachment[]>();
  const bounceDomainCache = new Map<string, string | null>();

  for (const claim of claimed) {
    const [message] = await db.select().from(messages).where(eq(messages.id, claim.id)).limit(1);
    if (!message) continue;
    await event(message.id,"transport_attempt",{attempt:claim.attempt_count,mtaHost,mtaPort});

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, message.campaignId)).limit(1);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, message.contactId)).limit(1);
    if (campaign && campaign.status !== "sending") {
      await pool.query(`update messages set status=$2,last_error='campaign_not_sending',attempt_count=greatest(attempt_count-1,0),next_attempt_at=null where id=$1 and status='sending'`, [message.id, campaign.status === "cancelled" ? "cancelled" : "ready_for_transport"]);
      continue;
    }
    if (!campaign || !contact || !campaign.sendingAccountId || !campaign.templateId) {
      await pool.query(`update messages set status='failed',last_error='campaign_transport_configuration_incomplete',next_attempt_at=null where id=$1 and status='sending'`, [message.id]);
      await event(message.id,"transport_failed",{attempt:claim.attempt_count,error:"campaign_transport_configuration_incomplete"});
      failed++; continue;
    }

    const [account] = await db.select().from(sendingAccounts).where(eq(sendingAccounts.id, campaign.sendingAccountId)).limit(1);
    const [template] = await db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1);
    if (!account || account.status !== "active" || !template) {
      await pool.query(`update messages set status='failed',last_error='sending_account_or_template_unavailable',next_attempt_at=null where id=$1 and status='sending'`, [message.id]);
      await event(message.id,"transport_failed",{attempt:claim.attempt_count,error:"sending_account_or_template_unavailable"});
      failed++; continue;
    }

    // Check owner-configured sender/global capacity before reserving a cooldown
    // probe slot. Otherwise a rate-limited sender could consume the next probe
    // time without actually sending the probe.
    const limit = await accountWithinLimits(account, settings);
    if (!limit.allowed) { await releaseThrottled(message.id); throttled++; continue; }

    const provider = providerForEmail(contact.email);
    const waitMs = Math.max(0, (providerNextAt.get(provider) || 0) - Date.now(), globalNextAt - Date.now());
    if (waitMs) await sleep(waitMs);
    const gate = await providerGate(account.id, contact.email, settings.providerCooldownMinutes);
    if (!gate.allowed) { await releaseProviderCooldown(message.id, gate.cooldownKey, gate.retryAt, settings.providerCooldownMinutes); providerHeld++; continue; }
    if (gate.probe) { providerProbes++; await event(message.id,"provider_probe",{provider:gate.provider,cooldownKey:gate.cooldownKey,cooldownScope:gate.cooldownScope,retryAt:gate.retryAt?.toISOString()}); }

    let campaignAttachments = campaignAttachmentCache.get(campaign.id);
    if (!campaignAttachments) { campaignAttachments = await loadCampaignAttachments(campaign.id); campaignAttachmentCache.set(campaign.id, campaignAttachments); }
    let templateAttachments = templateAttachmentCache.get(template.id);
    if (!templateAttachments) { templateAttachments = await loadTemplateAttachments(template.id); templateAttachmentCache.set(template.id, templateAttachments); }
    const attachments = [...templateAttachments, ...campaignAttachments];
    const attachmentError = combinedAttachmentLimitError(attachments);
    if (attachmentError) {
      await pool.query(`update messages set status='failed',last_error=$2,next_attempt_at=null where id=$1 and status='sending'`, [message.id, attachmentError]);
      await event(message.id,"transport_failed",{attempt:claim.attempt_count,error:"combined_attachment_limit",detail:attachmentError});
      failed++; continue;
    }

    const unsubscribeToken = await signPublicToken({ email: contact.email, messageId: message.id }, "90d");
    const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;
    let html = personalizeContactHtml(template.htmlBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    let text = personalize(template.textBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    const preheader = personalize(campaign.preheader || "", contact);
    html = injectPreheader(html, preheader);
    ({ html, text } = ensureUnsubscribe(html, text, unsubscribeUrl));
    if (campaign.trackClicks) html = await rewriteLinks(html, message.id);
    if (campaign.trackOpens) {
      const token = await signPublicToken({ messageId: message.id }, "30d");
      html += `<img src="${appUrl}/tracking/open/${token}" width="1" height="1" alt="" style="display:none!important" />`;
    }

    const subject = headerValue(personalize(campaign.subject || template.subject || "", contact));
    const fromName = headerValue(account.fromName);
    const fromEmail = headerValue(account.fromEmail).toLowerCase();
    const replyTo = headerValue(account.replyTo || account.fromEmail);
    const recipient = headerValue(contact.email);
    const senderDomain = fromEmail.split("@")[1]?.toLowerCase() || "";
    let bounceDomain: string | null;
    if (bounceDomainCache.has(senderDomain)) {
      bounceDomain = bounceDomainCache.get(senderDomain) ?? null;
    } else {
      const [domainRow] = senderDomain
        ? await db.select({ bounceDomain: sendingDomains.bounceDomain }).from(sendingDomains).where(eq(sendingDomains.domain, senderDomain)).limit(1)
        : [];
      const dynamicDomain = domainRow?.bounceDomain?.trim().toLowerCase() || null;
      const legacyDomain = process.env.BOUNCE_DOMAIN?.trim().toLowerCase() || null;
      bounceDomain = dynamicDomain || legacyDomain;
      bounceDomainCache.set(senderDomain, bounceDomain);
    }
    const envelopeFrom = bounceSigningEnabled && bounceDomain ? makeBounceAddress(message.id, bounceDomain) : fromEmail;
    const mime = buildMimeContent({ text, html, boundarySeed: message.id.replaceAll("-", ""), attachments });
    const deliverabilityHeaders = buildBulkDeliverabilityHeaders({
      campaignId: campaign.id,
      sendingAccountId: account.id,
      listId: campaign.listId,
      senderDomain,
      unsubscribeUrl,
    });
    const raw = [
      `From: ${fromName} <${fromEmail}>`, `To: ${recipient}`, `Reply-To: ${replyTo}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${message.id}@${fromEmail.split("@")[1] || "neximail.local"}>`, `X-NexiMail-Message-ID: ${message.id}`, "MIME-Version: 1.0",
      ...deliverabilityHeaders, mime.contentTypeHeader, "", ...mime.bodyLines,
    ].join("\r\n");

    // Recheck after rendering: a queued contact may have unsubscribed or been
    // suppressed since the policy worker approved this message.
    const eligibility = await pool.query<{ status: string; contact_status: string; validation_status: string; email: string; consent_status: string; consent_source: string | null; suppressed: boolean }>(`
      select c.status, ct.status as contact_status, ct.validation_status, ct.email, ct.consent_status, ct.consent_source,
        exists(select 1 from suppressions s where s.normalized_email=ct.normalized_email) as suppressed
      from messages m join campaigns c on c.id=m.campaign_id join contacts ct on ct.id=m.contact_id
      where m.id=$1 and m.status='sending'`, [message.id]);
    const latest = eligibility.rows[0];
    if (!latest) continue;
    if (latest.status !== "sending") {
      await pool.query(`update messages set status=$2,last_error='campaign_not_sending',attempt_count=greatest(attempt_count-1,0),next_attempt_at=null where id=$1 and status='sending'`, [message.id, latest.status === "cancelled" ? "cancelled" : "ready_for_transport"]);
      continue;
    }
    if (latest.contact_status !== "active" || !validationAllowsSend(latest.email, latest.validation_status) || latest.suppressed || latest.email !== contact.email || !hasConfirmedConsent({ consentStatus: latest.consent_status, consentSource: latest.consent_source })) {
      await pool.query(`update messages set status='cancelled',last_error='recipient_no_longer_eligible',next_attempt_at=null where id=$1 and status='sending'`, [message.id]);
      await event(message.id, "transport_cancelled", { reason: "recipient_no_longer_eligible" });
      continue;
    }

    let mtaAccepted = false;
    try {
      const result = await submitToMta(raw, envelopeFrom, recipient, { host: mtaHost, port: mtaPort, timeoutMs: smtpTimeoutMs });
      mtaAccepted = true;
      if (!result.queueId) throw new SmtpSubmissionUncertainError("MTA accepted message without returning a queue id");
      await pool.query(`update messages set status='mta_accepted',accepted_at=now(),provider_message_id=$2,last_error=null,next_attempt_at=null where id=$1 and status='sending'`, [message.id, result.queueId]);
      await event(message.id,"mta_accepted",{attempt:claim.attempt_count,queueId:result.queueId,attachments:attachments.length,envelopeFrom,bounceTracking:Boolean(bounceSigningEnabled && bounceDomain),provider:gate.provider,providerProbe:gate.probe,cooldownKey:gate.cooldownKey,cooldownScope:gate.cooldownScope});
      accepted++;
    } catch (error) {
      if (mtaAccepted || error instanceof SmtpSubmissionUncertainError) {
        // Never resubmit mail which may already be in Postfix. Delivery events can
        // still reconcile its final outcome using X-NexiMail-Message-ID.
        await pool.query(`update messages set status='failed',next_attempt_at=null,last_error='transport_submission_uncertain' where id=$1 and status='sending'`, [message.id]);
        await event(message.id, "transport_submission_uncertain", { attempt: claim.attempt_count, error: error instanceof Error ? error.message.slice(0, 1000) : "unknown_error" });
        failed++;
        continue;
      }
      const state = await markDeferred(message.id, claim.attempt_count, error, settings);
      if (state === "deferred") deferred++; else failed++;
    }
    const sentAt = Date.now();
    providerNextAt.set(provider, sentAt + settings.providerIntervalMs);
    globalNextAt = sentAt + (1000 / settings.maxPerSecond);
  }

  await heartbeat({ state: "online", sendingEnabled: true, claimed: claimed.length, accepted, deferred, failed, throttled, providerHeld, providerProbes, recoveredStale, overdueCooldownMessagesAwakened, perSecond: settings.maxPerSecond, providerIntervalMs: settings.providerIntervalMs, pollIntervalMs: intervalMs, claimBatch, schedulingMode: "round_robin", campaignBurstPerRound: settings.campaignBurstPerRound, maxConcurrentCampaigns: settings.maxConcurrentCampaigns, maxAttempts: settings.retryMaxAttempts, retryInitialSeconds: settings.retryInitialSeconds, retryMaxSeconds: settings.retryMaxSeconds, retryBackoffMultiplier: settings.retryBackoffMultiplier, providerCooldownMinutes: settings.providerCooldownMinutes, mtaHost, mtaPort, bounceTracking: bounceSigningEnabled, source: "database_control_plane" });
}

async function main() {
  if (!appUrl) throw new Error("APP_URL is required");
  while (true) {
    try {
      // Serialize transport across replicas so account quotas and provider probes
      // cannot race. The dedicated session owns the lock until this batch settles.
      const lock = await pool.connect();
      try {
        const result = await lock.query("select pg_try_advisory_lock(734201, 1) as acquired");
        if (result.rows[0].acquired) {
          try { await runOnce(); } finally { await lock.query("select pg_advisory_unlock(734201, 1)"); }
        }
      } finally { lock.release(); }
    }
    catch (error) { console.error("[transport-worker]", error); await heartbeat({ state: "error", mtaHost, mtaPort, bounceTracking: bounceSigningEnabled }).catch(() => {}); }
    await sleep(intervalMs);
  }
}
main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
