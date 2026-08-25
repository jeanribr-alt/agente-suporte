# Agente de IA — Suporte Instagram/Messenger

## O que tem aqui
- `server.js` → webhook que recebe eventos do Meta e responde via Claude
- `prompt.js` → a "ficha de treinamento" do agente (edite à vontade)
- `.env.example` → variáveis que você precisa configurar

## Como colocar no ar (Railway — grátis pra começar)

1. Crie uma conta em **railway.app** (dá pra logar com GitHub)
2. Suba esses arquivos num repositório novo no GitHub
   (ou use o botão "Deploy from local folder" do Railway, se tiver)
3. No Railway: **New Project → Deploy from GitHub repo** → selecione o repositório
4. Vá em **Variables** e adicione as 3 variáveis do `.env.example`:
   - `VERIFY_TOKEN` (invente uma senha, ex: `agente2026xyz`)
   - `PAGE_ACCESS_TOKEN` (o token que você já gerou)
   - `ANTHROPIC_API_KEY` (pegue em console.anthropic.com → API Keys)
5. Railway vai gerar uma URL pública tipo `https://seuapp.up.railway.app`
6. Sua URL de webhook é: `https://seuapp.up.railway.app/webhook`

## Configurar o webhook no Meta

1. Volte em developers.facebook.com → seu app → tela "Configurar webhooks"
   (você já viu essa tela — item 3, mais abaixo de onde gerou o token)
2. **URL de callback**: cole `https://seuapp.up.railway.app/webhook`
3. **Verificar token**: cole o MESMO valor que você colocou em `VERIFY_TOKEN`
4. Clique em Verificar e salvar
5. Marque os campos de assinatura: `messages`, `comments`

## Editar o comportamento do agente

Abra `prompt.js` e preencha:
- Nome do produto/marca
- Preço e o que está incluso
- Regras específicas (reembolso, prazo, etc.)

Cada alteração exige um novo deploy (push no GitHub → Railway atualiza sozinho).

## Testando

Como você já é Testador do app, pode mandar uma DM ou comentar no seu
próprio post pra ver o agente respondendo, antes mesmo do App Review
ser aprovado.
