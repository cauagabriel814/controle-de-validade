// Importe este arquivo PRIMEIRO em todo teste: define o ambiente antes de qualquer módulo ler a config.
// Postgres de verdade embutido em memória (PGlite), fotos em memória e e-mails guardados numa lista.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'pglite://memory';
process.env.STORAGE_DRIVER = 'memory';
process.env.MAIL_DRIVER = 'memory';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.APP_URL = 'http://localhost:8080';
process.env.TZ_LOJA = 'America/Sao_Paulo';
