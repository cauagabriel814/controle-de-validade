CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  -- NULL até a pessoa aceitar o convite e criar a própria senha
  password_hash TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'funcionario')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Aumenta ao trocar senha/papel/desativar: invalida os tokens antigos
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- Links de convite e de redefinição de senha (guardamos só o hash)
CREATE TABLE user_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id);

CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  perishable BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX categories_name_uq ON categories (lower(name));

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  barcode     TEXT,
  unit        TEXT NOT NULL DEFAULT 'un',
  photo       TEXT,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Código de barras único só entre produtos ativos
CREATE UNIQUE INDEX products_barcode_uq ON products (barcode) WHERE active AND barcode IS NOT NULL;
CREATE INDEX products_name_idx ON products (lower(name));
CREATE INDEX products_category_idx ON products (category_id);

-- Lote: uma entrada do produto com a mesma validade
CREATE TABLE lots (
  id               SERIAL PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  initial_quantity NUMERIC(12, 3) NOT NULL CHECK (initial_quantity > 0),
  quantity         NUMERIC(12, 3) NOT NULL CHECK (quantity >= 0),
  expiry_date      DATE NOT NULL,
  cost_price       NUMERIC(12, 2),
  sale_price       NUMERIC(12, 2),
  promo_price      NUMERIC(12, 2),
  in_promo         BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_photo     TEXT,
  notes            TEXT,
  created_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lots_open_expiry_idx ON lots (expiry_date) WHERE quantity > 0;
CREATE INDEX lots_product_idx ON lots (product_id);

-- Saídas do lote. É daqui que sai o relatório de perdas.
CREATE TABLE movements (
  id          SERIAL PRIMARY KEY,
  lot_id      INTEGER NOT NULL REFERENCES lots (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('venda', 'perda', 'ajuste')),
  quantity    NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_value  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  in_promo    BOOLEAN NOT NULL DEFAULT FALSE,
  reason      TEXT,
  occurred_on DATE NOT NULL,
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movements_day_idx ON movements (occurred_on, type);
CREATE INDEX movements_lot_idx ON movements (lot_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

INSERT INTO categories (name, perishable) VALUES
  ('Frutas', TRUE),
  ('Verduras e legumes', TRUE),
  ('Laticínios', TRUE),
  ('Carnes e frios', TRUE),
  ('Padaria', TRUE),
  ('Bebidas', FALSE),
  ('Mercearia', FALSE),
  ('Enlatados e conservas', FALSE),
  ('Higiene', FALSE),
  ('Limpeza', FALSE);
