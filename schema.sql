-- Banco D1 "desafio-asfit" do Desafio do Engajamento.
-- Rodar uma vez: npx wrangler d1 execute desafio-asfit --remote --file schema.sql

-- Uma linha por @. Os totais (dias, extras, pontos...) são recalculados a cada aprovação,
-- para o ranking sair de uma leitura só, sem somar os posts de todo mundo.
CREATE TABLE IF NOT EXISTS participantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arroba TEXT NOT NULL UNIQUE,              -- sem @, minúsculo
  criado_em INTEGER NOT NULL,
  dias INTEGER NOT NULL DEFAULT 0,          -- dias diferentes com post aprovado
  dias_lista TEXT NOT NULL DEFAULT '',      -- esses dias, "2026-10-16,2026-10-17"
  extras INTEGER NOT NULL DEFAULT 0,        -- soma dos pontos extras
  pontos INTEGER NOT NULL DEFAULT 0,        -- dias + extras
  pendentes INTEGER NOT NULL DEFAULT 0,
  primeiro INTEGER NOT NULL DEFAULT 99999999999999, -- primeiro envio aprovado (desempate)
  bloqueada INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS participantes_ranking ON participantes (bloqueada, pontos DESC, dias DESC, primeiro);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participante_id INTEGER NOT NULL,
  link TEXT NOT NULL UNIQUE,                -- normalizado (https://www.instagram.com/reel/XXXX/)
  tipo TEXT NOT NULL,                       -- post, reels, story
  dia TEXT NOT NULL,                        -- AAAA-MM-DD, horário de Brasília
  status TEXT NOT NULL DEFAULT 'pendente',  -- pendente, aprovado, recusado
  enviado_em INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',              -- hash do IP, só para limitar envios
  revisado_em INTEGER,
  revisado_por TEXT,
  motivo TEXT
);
CREATE INDEX IF NOT EXISTS posts_status ON posts (status, enviado_em);
CREATE INDEX IF NOT EXISTS posts_participante ON posts (participante_id, status, dia);
CREATE INDEX IF NOT EXISTS posts_ip ON posts (ip, enviado_em);

CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participante_id INTEGER NOT NULL,
  pontos INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  por TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS extras_participante ON extras (participante_id);

-- Foto pronta do ranking e do mural. Apagada a cada mudança da equipe.
CREATE TABLE IF NOT EXISTS cache (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

-- Quem fez o quê no painel da equipe
CREATE TABLE IF NOT EXISTS acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  momento INTEGER NOT NULL,
  por TEXT NOT NULL,
  acao TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT ''
);

-- Senha errada no login da equipe (trava depois de 8 em 15 minutos)
CREATE TABLE IF NOT EXISTS tentativas (
  ip TEXT NOT NULL,
  momento INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tentativas_ip ON tentativas (ip, momento);
