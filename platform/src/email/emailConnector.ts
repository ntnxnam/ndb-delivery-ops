/**
 * emailConnector — SMTP send via nodemailer.
 *
 * Templates, recipient parsing, and fallback host lists stay in the
 * Express emailService. This module owns the transport only (D3).
 */

import nodemailer from 'nodemailer';

export class EmailConnector {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(options: Record<string, unknown>) {
    this.transporter = nodemailer.createTransport(options);
  }

  async send(mailOptions: Record<string, unknown>): Promise<{
    messageId: string;
    accepted: string[];
    rejected: string[];
  }> {
    const info = await this.transporter.sendMail(mailOptions);
    return {
      messageId: String(info.messageId || ''),
      accepted: (info.accepted || []) as string[],
      rejected: (info.rejected || []) as string[],
    };
  }
}
