import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  // Endereço público do sistema (usado nos links dos e-mails)
  APP_URL: z.url().default('http://localhost:8080'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter pelo menos 32 caracteres'),
  SESSION_HOURS: z.coerce.number().positive().default(12),

  // postgres://usuario:senha@host:5432/banco  (testes usam pglite://memory)
  DATABASE_URL: z.string().min(1),

  STORAGE_DRIVER: z.enum(['minio', 'memory']).default('minio'),
  S3_ENDPOINT: z.string().default('localhost'),
  S3_PORT: z.coerce.number().int().default(9000),
  S3_USE_SSL: bool,
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_BUCKET: z.string().default('fotos'),

  MAIL_DRIVER: z.enum(['smtp', 'memory']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Controle de Validade <nao-responda@mercadinho.local>'),

  TZ_LOJA: z.string().default('America/Sao_Paulo'),
  TRUST_PROXY: bool,
  // A API serve as telas também (útil no `npm run dev`). No Docker quem serve é o nginx.
  SERVE_STATIC: bool,

  ADMIN_NAME: z.string().default('Administrador'),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuração inválida no .env:\n${issues}\nVeja o .env.example`);
}
const env = parsed.data;

export const config = {
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  appUrl: env.APP_URL.replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET,
  sessionHours: env.SESSION_HOURS,
  databaseUrl: env.DATABASE_URL,
  storage: {
    driver: env.STORAGE_DRIVER,
    endPoint: env.S3_ENDPOINT,
    port: env.S3_PORT,
    useSSL: env.S3_USE_SSL,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
  },
  mail: {
    driver: env.MAIL_DRIVER,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  },
  timeZone: env.TZ_LOJA,
  trustProxy: env.TRUST_PROXY,
  serveStatic: env.SERVE_STATIC,
  admin: { name: env.ADMIN_NAME, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
};
