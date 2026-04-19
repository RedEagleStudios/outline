import type { EmailAddress } from "addressparser";
import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import Oy from "oy-vey";
import env from "@server/env";
import { InternalError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import { baseStyles } from "./templates/components/EmailLayout";

/**
 * Creates a nodemailer-compatible transport that sends emails via the Resend
 * HTTP API. Used when SMTP ports are blocked (e.g. Railway).
 *
 * @param apiKey - the Resend API key.
 * @returns a nodemailer transport object.
 */
function createResendTransport(apiKey: string) {
  return {
    name: "ResendHTTP",
    version: "1.0.0",
    send(
      mail: { data: Record<string, unknown> },
      callback: (err: Error | null, info?: { messageId: string }) => void
    ) {
      const data = mail.data as {
        from?: string | EmailAddress;
        to?: string;
        subject?: string;
        html?: string;
        text?: string;
        replyTo?: string;
        headers?: Record<string, string>;
      };

      const fromAddress =
        typeof data.from === "object" && data.from !== null
          ? (data.from as EmailAddress).address
          : data.from;

      const body = JSON.stringify({
        from: fromAddress,
        to: [data.to],
        subject: data.subject,
        html: data.html,
        text: data.text,
        reply_to: data.replyTo,
      });

      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      })
        .then(async (res) => {
          const json = (await res.json()) as {
            id?: string;
            message?: string;
          };
          if (!res.ok) {
            callback(
              new Error(
                `Resend API error ${res.status}: ${json.message ?? res.statusText}`
              )
            );
            return;
          }
          callback(null, { messageId: json.id ?? "" });
        })
        .catch((err: Error) => {
          callback(err);
        });
    },
  };
}

const useTestEmailService = env.isDevelopment && !env.SMTP_USERNAME;

type SendMailOptions = {
  to: string;
  from: EmailAddress;
  replyTo?: string;
  messageId?: string;
  references?: string[];
  subject: string;
  previewText?: string;
  text: string;
  component: JSX.Element;
  headCSS?: string;
  unsubscribeUrl?: string;
};

/**
 * Mailer class to send emails.
 */
@trace({
  serviceName: "mailer",
})
export class Mailer {
  transporter: Transporter | undefined;

  constructor() {
    if (env.RESEND_API_KEY) {
      this.transporter = nodemailer.createTransport(
        createResendTransport(env.RESEND_API_KEY) as unknown as SMTPTransport.Options
      );
      Logger.info("email", "Using Resend HTTP API transport");
    } else if (env.SMTP_HOST || env.SMTP_SERVICE) {
      this.transporter = nodemailer.createTransport(this.getOptions());
    }
    if (useTestEmailService) {
      Logger.info(
        "email",
        "SMTP_USERNAME not provided, generating test account…"
      );

      void this.getTestTransportOptions().then((options) => {
        if (!options) {
          Logger.info(
            "email",
            "Couldn't generate a test account with ethereal.email at this time – emails will not be sent."
          );
          return;
        }

        this.transporter = nodemailer.createTransport(options);
      });
    }
  }

  template = ({
    title,
    bodyContent,
    headCSS = "",
    bgColor = "#FFFFFF",
    lang,
    dir = "ltr" /* https://www.w3.org/TR/html4/struct/dirlang.html#blocklevel-bidi */,
  }: Oy.CustomTemplateRenderOptions) => {
    if (!title) {
      throw InternalError("`title` is a required option for `renderTemplate`");
    }
    if (!bodyContent) {
      throw InternalError(
        "`bodyContent` is a required option for `renderTemplate`"
      );
    }

    // the template below is a slightly modified form of https://github.com/revivek/oy/blob/master/src/utils/HTML4.js
    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
    <html
      ${lang ? 'lang="' + lang + '"' : ""}
      dir="${dir}"
      xmlns="http://www.w3.org/1999/xhtml"
      xmlns:v="urn:schemas-microsoft-com:vml"
      xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width"/>

        <title>${title}</title>

        <style type="text/css">
          ${headCSS}

          #__bodyTable__ {
            margin: 0;
            padding: 0;
            width: 100% !important;
          }
        </style>

        <!--[if gte mso 9]>
          <xml>
            <o:OfficeDocumentSettings>
              <o:AllowPNG/>
              <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
          </xml>
        <![endif]-->
      </head>
      <body bgcolor="${bgColor}" width="100%" style="-webkit-font-smoothing: antialiased; width:100% !important; background:${bgColor};-webkit-text-size-adjust:none; margin:0; padding:0; min-width:100%; direction: ${dir};">
        ${bodyContent}
      </body>
    </html>
  `;
  };

  /**
   *
   * @param data Email headers and body
   * @returns Message ID header from SMTP server
   */
  sendMail = async (data: SendMailOptions): Promise<void> => {
    const transporter = this.transporter;

    if (env.isDevelopment) {
      Logger.debug(
        "email",
        [
          `Sending email:`,
          ``,
          `--------------`,
          `From:      ${data.from.address}`,
          `To:        ${data.to}`,
          `Subject:   ${data.subject}`,
          `Preview:   ${data.previewText}`,
          `--------------`,
          ``,
          data.text,
        ].join("\n")
      );
    }
    if (!transporter) {
      Logger.warn("No mail transport available");
      return;
    }

    const html = Oy.renderTemplate(
      data.component,
      {
        title: data.subject,
        headCSS: [baseStyles, data.headCSS].join(" "),
      } as Oy.RenderOptions,
      this.template
    );

    try {
      Logger.info("email", `Sending email "${data.subject}" to ${data.to}`);

      const info = await transporter.sendMail({
        from: data.from,
        replyTo: data.replyTo ?? env.SMTP_REPLY_EMAIL ?? env.SMTP_FROM_EMAIL,
        to: data.to,
        messageId: data.messageId,
        references: data.references,
        inReplyTo: data.references?.at(-1),
        subject: data.subject,
        html,
        text: data.text,
        list: data.unsubscribeUrl
          ? {
              unsubscribe: {
                url: data.unsubscribeUrl,
                comment: "Unsubscribe from these emails",
              },
            }
          : undefined,
        attachments: env.isCloudHosted
          ? undefined
          : [
              {
                filename: "header-logo.png",
                path: process.cwd() + "/public/email/header-logo.png",
                cid: "header-image",
              },
            ],
      });

      if (useTestEmailService) {
        Logger.info(
          "email",
          `Preview Url: ${nodemailer.getTestMessageUrl(info)}`
        );
      }
    } catch (err) {
      Logger.error(`Error sending email to ${data.to}`, err);
      throw err; // Re-throw for queue to re-try
    }
  };

  private getOptions(): SMTPTransport.Options {
    // nodemailer will use the service config to determine host/port
    if (env.SMTP_SERVICE) {
      return {
        service: env.SMTP_SERVICE,
        auth: {
          user: env.SMTP_USERNAME,
          pass: env.SMTP_PASSWORD,
        },
      };
    }

    return {
      name: env.SMTP_NAME,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // If not explicitly configured we default to using TLS in production
      secure: env.SMTP_SECURE ?? env.isProduction,
      // Allow connections with no authentication if no username is provided
      auth: env.SMTP_USERNAME
        ? {
            user: env.SMTP_USERNAME,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
      // Disable STARTTLS entirely when SMTP_DISABLE_STARTTLS is set to true
      ignoreTLS: env.SMTP_DISABLE_STARTTLS,
      tls: env.SMTP_SECURE
        ? env.SMTP_TLS_CIPHERS
          ? {
              ciphers: env.SMTP_TLS_CIPHERS,
            }
          : undefined
        : {
            rejectUnauthorized: false,
          },
    };
  }

  private async getTestTransportOptions(): Promise<
    SMTPTransport.Options | undefined
  > {
    try {
      const testAccount = await nodemailer.createTestAccount();
      return {
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      };
    } catch (_err) {
      return undefined;
    }
  }
}

export default new Mailer();
