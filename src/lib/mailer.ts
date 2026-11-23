import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** E-mails "enviados" no modo memória (os testes leem daqui). */
export const sentMails: Mail[] = [];

const transport =
  config.mail.driver === 'smtp'
    ? nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      })
    : null;

export async function sendMail(mail: Mail): Promise<void> {
  if (!transport) {
    sentMails.push(mail);
    return;
  }
  await transport.sendMail({ from: config.mail.from, ...mail });
}

// ---- Modelos -----------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, paragraphs: string[], button: { label: string; url: string }, footer: string) {
  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f3f5f4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1c2420">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px">
        <tr><td>
          <p style="margin:0 0 24px;font-weight:700;color:#15803d;font-size:18px">Controle de Validade</p>
          <h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>
          ${paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`).join('')}
          <p style="margin:24px 0">
            <a href="${escapeHtml(button.url)}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a>
          </p>
          <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(footer)}<br>Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(button.url)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = [title, '', ...paragraphs, '', `${button.label}: ${button.url}`, '', footer].join('\n');
  return { html, text };
}

export function inviteMail(to: string, name: string, invitedBy: string, link: string): Mail {
  const firstName = name.split(' ')[0] ?? name;
  return {
    to,
    subject: 'Seu acesso ao Controle de Validade',
    ...layout(
      `Olá, ${firstName}!`,
      [
        `${invitedBy} criou um acesso para você no sistema de controle de validade do mercadinho.`,
        'Clique no botão abaixo para criar sua senha e entrar.',
      ],
      { label: 'Criar minha senha', url: link },
      'Este link vale por 72 horas e só pode ser usado uma vez.',
    ),
  };
}

export function resetMail(to: string, name: string, link: string): Mail {
  const firstName = name.split(' ')[0] ?? name;
  return {
    to,
    subject: 'Redefinição de senha: Controle de Validade',
    ...layout(
      `Olá, ${firstName}`,
      ['Recebemos um pedido para redefinir a sua senha.', 'Se foi você, clique no botão abaixo. Se não foi, ignore este e-mail: sua senha continua a mesma.'],
      { label: 'Redefinir senha', url: link },
      'Este link vale por 1 hora e só pode ser usado uma vez.',
    ),
  };
}
