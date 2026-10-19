# Desafio do Engajamento ASFIT (desafio-asfit.pages.dev)

Página do desafio (16/10 a 11/11/2026) e painel da equipe. Copy em `../../copy/pagina-desafio-engajamento-asfit.md`.

- **Página:** https://desafio-asfit.pages.dev (contagem até 11/11 23h59, prêmios, como somar pontos, envio do link,
  ranking e mural).
- **Painel da equipe:** https://desafio-asfit.pages.dev/equipe (e-mail e senha). Aprova ou recusa os posts (story
  primeiro, porque some em 24 horas), muda o dia em que o post conta, dá pontos extras com motivo (e desfaz), tira
  alguém do ranking, mostra o histórico de quem fez o quê e baixa o ranking em CSV para escolher as ganhadoras.

## Publicar na Netlify (Pedro)

1. Na Netlify: Add new site > Import from Git > este repositório.
2. Não precisa de comando de build: o `netlify.toml` já manda publicar só a pasta `public`.
3. Depois de publicar, trocar no `public/index.html` o endereço do `og:url` pelo domínio novo (o `og:image` pode ficar
   como está).

A API e o banco continuam no Cloudflare, em desafio-asfit.pages.dev: a página hospedada na Netlify chama lá sozinha
(ranking, mural, busca e envio). Não precisa mexer em `functions/`, `schema.sql` nem `wrangler.jsonc`, que são o
servidor no Cloudflare. O painel da equipe continua em https://desafio-asfit.pages.dev/equipe: quem abrir `/equipe` na
Netlify é mandado para lá.

## Regra do ranking

Cada dia com pelo menos um post aprovado vale 1 ponto, mais os pontos extras da equipe. Desempate: mais dias com
post, depois quem teve o primeiro post aprovado mais cedo. O fogo aparece em quem postou todos os dias que já
acabaram (o dia de hoje só conta como falta amanhã). A página mostra as 100 primeiras; a busca pelo @ dá a posição
de qualquer uma.

## Como é feito

- Projeto Pages `desafio-asfit` com Functions (`functions/api/[[rota]].js`) e banco D1 `desafio-asfit`
  (`schema.sql`). As datas ficam no começo da API e no `CONFIG` do fim do `public/index.html`: mudar nos dois.
- Os totais de cada participante (dias, extras, pontos) são recalculados a cada aprovação. O ranking e a primeira
  página do mural ficam guardados na tabela `cache` e são apagados a cada mudança da equipe, então a página lê uma
  linha só do banco.
- Envio: aceita post, reels e story (inclusive o link com o @ no caminho e o link curto do "Compartilhar"). Story
  de outro perfil é recusado na hora. Limites: 40 envios por hora no mesmo IP e 8 links por @ no mesmo dia.
- Contas da equipe: segredo `ADMINS` (e-mail, nome, sal e hash PBKDF2, o mesmo esquema do calendário) e `SEGREDO`
  (assina o login; trocar desloga todo mundo). Senha nunca vai para arquivo. Para incluir alguém ou trocar senha,
  peça ao Claude: ele gera o JSON novo e roda `npx wrangler pages secret put ADMINS --project-name desafio-asfit`.
- `fonte/`: fotos originais dos kits e a arte da prévia do link (`previa-link.html`, 1200x630, vira
  `public/img/compartilhar-desafio.jpg`; ao trocar a arte, trocar também o nome do arquivo, porque o WhatsApp guarda
  a prévia antiga).

## Publicar

Copiar a pasta sem `fonte/` para o scratchpad e, dentro da cópia, rodar
`npx wrangler pages deploy --branch main --commit-dirty=true`. Banco novo: `npx wrangler d1 execute desafio-asfit
--remote --file schema.sql`.
