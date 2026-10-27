import nodemailer from 'nodemailer'
import type { ServerConfig } from './config'
import { AppError } from './errors'

export async function sendPasswordReset(config: ServerConfig, email: string, url: string) {
  if (!config.smtp)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Parola yenileme e-postası için sunucuda SMTP ayarı yapılmalı.',
    )
  const smtp = config.smtp
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 15000,
    socketTimeout: 20000,
  })
  try {
    await transport.sendMail({
      from: smtp.from,
      to: email,
      subject: 'Pazarhub · Parolanızı yenileyin',
      text: `Parolanızı yenilemek için aşağıdaki bağlantıyı açın. Bağlantı bir saat geçerlidir.\n\n${url}\n\nBu isteği siz yapmadıysanız mevcut parolanız kullanılmaya devam eder.`,
    })
  } catch {
    throw new AppError(
      503,
      'EMAIL_UNAVAILABLE',
      'E-posta gönderilemedi. Biraz sonra tekrar deneyin.',
    )
  } finally {
    transport.close()
  }
}
