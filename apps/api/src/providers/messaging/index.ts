import { env } from '../../config/env';
import { withTimeout } from '../../lib/async';
import { maskEmail, maskPhone } from '../../lib/crypto';
import { logger } from '../../lib/logger';

/* ================================ SMS ================================ */

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<{ providerRef: string | null }>;
}

/** Logs the message. Used in development so OTP flows work without credit. */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send(to: string, body: string): Promise<{ providerRef: string | null }> {
    logger.info({ to: maskPhone(to), body }, '[sms] would send');
    return { providerRef: null };
  }
}

/** Africa's Talking — the practical default for Kenyan traffic. */
class AfricasTalkingSmsProvider implements SmsProvider {
  readonly name = 'africastalking';

  async send(to: string, body: string): Promise<{ providerRef: string | null }> {
    if (!env.AT_API_KEY || !env.AT_USERNAME) {
      throw new Error('AT_API_KEY and AT_USERNAME are required for the africastalking SMS driver');
    }
    const params = new URLSearchParams({
      username: env.AT_USERNAME,
      to,
      message: body,
    });
    if (env.AT_SENDER_ID) params.set('from', env.AT_SENDER_ID);

    const response = await withTimeout(
      (signal) =>
        fetch('https://api.africastalking.com/version1/messaging', {
          method: 'POST',
          headers: {
            apiKey: env.AT_API_KEY!,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: params.toString(),
          signal,
        }),
      10_000,
      'SMS provider timed out',
    );

    if (!response.ok) {
      throw new Error(`Africa's Talking responded ${response.status}`);
    }
    const payload = (await response.json()) as {
      SMSMessageData?: { Recipients?: Array<{ messageId?: string; status?: string }> };
    };
    const recipient = payload.SMSMessageData?.Recipients?.[0];
    if (recipient?.status && recipient.status !== 'Success') {
      throw new Error(`Africa's Talking rejected the message: ${recipient.status}`);
    }
    return { providerRef: recipient?.messageId ?? null };
  }
}

class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  async send(to: string, body: string): Promise<{ providerRef: string | null }> {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
      throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
    }
    const credentials = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
      'base64',
    );
    const response = await withTimeout(
      (signal) =>
        fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: env.TWILIO_FROM!, Body: body }).toString(),
          signal,
        }),
      10_000,
      'SMS provider timed out',
    );
    if (!response.ok) throw new Error(`Twilio responded ${response.status}`);
    const payload = (await response.json()) as { sid?: string };
    return { providerRef: payload.sid ?? null };
  }
}

let smsProvider: SmsProvider | null = null;

export function sms(): SmsProvider {
  if (!smsProvider) {
    smsProvider =
      env.SMS_DRIVER === 'africastalking'
        ? new AfricasTalkingSmsProvider()
        : env.SMS_DRIVER === 'twilio'
          ? new TwilioSmsProvider()
          : new ConsoleSmsProvider();
    logger.info({ driver: smsProvider.name }, 'sms provider ready');
  }
  return smsProvider;
}

/* =============================== Email =============================== */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerRef: string | null }>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<{ providerRef: string | null }> {
    logger.info(
      { to: maskEmail(message.to), subject: message.subject, text: message.text },
      '[email] would send',
    );
    return { providerRef: null };
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  async send(message: EmailMessage): Promise<{ providerRef: string | null }> {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required for the resend email driver');
    const response = await withTimeout(
      (signal) =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal,
        }),
      10_000,
      'Email provider timed out',
    );
    if (!response.ok) throw new Error(`Resend responded ${response.status}`);
    const payload = (await response.json()) as { id?: string };
    return { providerRef: payload.id ?? null };
  }
}

/**
 * SMTP is declared but not wired: adding a transport dependency for it is not
 * worth it while Resend and the console driver cover both real and local use.
 * Selecting it fails loudly rather than silently dropping mail.
 */
class UnimplementedSmtpProvider implements EmailProvider {
  readonly name = 'smtp';

  async send(): Promise<{ providerRef: string | null }> {
    throw new Error(
      'EMAIL_DRIVER=smtp is not implemented. Use EMAIL_DRIVER=resend or console, or add an SMTP transport here.',
    );
  }
}

let emailProvider: EmailProvider | null = null;

export function email(): EmailProvider {
  if (!emailProvider) {
    emailProvider =
      env.EMAIL_DRIVER === 'resend'
        ? new ResendEmailProvider()
        : env.EMAIL_DRIVER === 'smtp'
          ? new UnimplementedSmtpProvider()
          : new ConsoleEmailProvider();
    logger.info({ driver: emailProvider.name }, 'email provider ready');
  }
  return emailProvider;
}
