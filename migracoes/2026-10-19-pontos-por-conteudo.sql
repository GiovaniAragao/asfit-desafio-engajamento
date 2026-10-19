-- 19/10/2026: regra nova do desafio (pontos por tipo de conteúdo e missão dos 7 dias de stories).
-- Rodar uma vez no banco que já existia: npx wrangler d1 execute desafio-asfit --remote --file migracoes/2026-10-19-pontos-por-conteudo.sql
-- Banco novo não precisa: o schema.sql já vem com essas colunas.
ALTER TABLE participantes ADD COLUMN conteudos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN categoria TEXT;
ALTER TABLE posts ADD COLUMN pontos INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS participantes_ranking;
CREATE INDEX IF NOT EXISTS participantes_ranking ON participantes (bloqueada, pontos DESC, primeiro);
DELETE FROM cache;
