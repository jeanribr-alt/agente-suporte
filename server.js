// ============================================
// AGENTE DE IA - SUPORTE INSTAGRAM/MESSENGER
// ============================================
// Recebe comentários e DMs via webhook do Meta,
// responde usando a API do Claude com contexto
// da conversa e instruções do system prompt.

const express = require("express");
const axios = require("axios");
const { SYSTEM_PROMPT, COMMENT_MODERATION_INSTRUCTIONS } = require("./prompt");

const app = express();
app.use(express.json());

// ---------- CONFIG (via variáveis de ambiente) ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // você escolhe essa string
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // token que você gerou (Instagram)
const PAGE_ACCESS_TOKEN_FB = process.env.PAGE_ACCESS_TOKEN_FB; // token da Página (Facebook)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE_URL = "https://graph.instagram.com"; // token IGAA exige esse domínio

// IDs da própria conta/página — usados pra NUNCA responder a si mesmo (evita loop infinito)
const OWN_IG_ID = "28657556597184544";
const OWN_PAGE_ID = "1229123500284213";

// Memória simples de conversa em RAM (troque por um banco depois, ex: Redis/Postgres)
const conversationHistory = {}; // { senderId: [ {role, content}, ... ] }

// Evita processar o mesmo comentário duas vezes (proteção extra contra reenvios do Meta)
const processedComments = new Set();

// ============================================
// 1. VERIFICAÇÃO DO WEBHOOK (GET)
// O Meta chama essa rota uma vez para confirmar
// que você é dono da URL.
// ============================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================
// 2. RECEBIMENTO DE EVENTOS (POST)
// Aqui chegam comentários e mensagens em tempo real.
// ============================================
app.post("/webhook", async (req, res) => {
  // Responde rápido pro Meta não reenviar o evento (timeout é ~20s)
  res.sendStatus(200);

  const body = req.body;

  try {
    if (body.object === "instagram" || body.object === "page") {
      for (const entry of body.entry || []) {
        // --- DMs (Messenger / Instagram Direct) ---
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.message && !event.message.is_echo) {
              await handleDirectMessage(event);
            }
          }
        }

        // --- Comentários (Instagram / Facebook) ---
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.field === "comments" || change.field === "feed") {
              await handleComment(change.value, body.object);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Erro processando evento:", err.message);
    if (err.response) {
      console.error("Detalhes do erro (Meta):", JSON.stringify(err.response.data));
    }
  }
});

// ============================================
// 3. LIDAR COM MENSAGEM DIRETA (DM)
// ============================================
async function handleDirectMessage(event) {
  const senderId = event.sender.id;
  const userText = event.message.text;
  if (!userText) return; // ignora imagem/áudio por enquanto

  const reply = await askClaude(senderId, userText, SYSTEM_PROMPT);

  // Espera 3 minutos antes de responder, pra parecer mais humano
  setTimeout(() => {
    sendDirectMessage(senderId, reply).catch((err) =>
      console.error("Erro enviando DM atrasada:", err.message)
    );
  }, 3 * 60 * 1000);
}

// ============================================
// 4. LIDAR COM COMENTÁRIO
// ============================================
async function handleComment(value, source) {
  // No Facebook, o campo "feed" cobre vários tipos de evento (posts, reações, etc.)
  // Só processamos quando for de fato um comentário sendo adicionado.
  if (source === "page" && (value.item !== "comment" || value.verb !== "add")) {
    return;
  }

  const commentId = value.comment_id || value.id;
  const commentText = value.message || value.text;
  const fromId = value.from?.id;
  const fromUsername = value.from?.username || value.from?.name;

  if (!commentText || !fromId || !commentId) return;

  // CRÍTICO: nunca processar comentário/resposta feito pelo próprio agente (evita loop infinito)
  if (fromId === OWN_IG_ID || fromId === OWN_PAGE_ID) {
    return;
  }

  // Evita reprocessar o mesmo comentário se o Meta reenviar o evento
  if (processedComments.has(commentId)) {
    return;
  }
  processedComments.add(commentId);

  const messageWithContext = fromUsername
    ? `[Comentário de @${fromUsername}]: ${commentText}`
    : commentText;

  const rawReply = await askClaude(
    `comment_${commentId}`,
    messageWithContext,
    SYSTEM_PROMPT + "\n" + COMMENT_MODERATION_INSTRUCTIONS
  );

  let decision;
  try {
    decision = JSON.parse(rawReply);
  } catch (e) {
    console.error("Não consegui interpretar a decisão da IA:", rawReply);
    return;
  }

  if (decision.action === "apagar") {
    // Apagar continua instantâneo — não precisa parecer humano nesse caso
    await deleteComment(commentId, source);
    console.log(`Comentário ${commentId} apagado (moderação).`);
  } else if (decision.action === "responder" && decision.message) {
    // Espera 3 minutos antes de responder, pra parecer mais humano
    setTimeout(() => {
      replyToComment(commentId, decision.message, source).catch((err) =>
        console.error("Erro respondendo comentário atrasado:", err.message)
      );
    }, 3 * 60 * 1000);
  }
}

// ============================================
// 5. CHAMAR A API DO CLAUDE
// ============================================
async function askClaude(conversationKey, userMessage, systemPrompt) {
  if (!conversationHistory[conversationKey]) {
    conversationHistory[conversationKey] = [];
  }
  const history = conversationHistory[conversationKey];

  history.push({ role: "user", content: userMessage });

  // Mantém só as últimas 10 mensagens pra não estourar tokens
  const trimmedHistory = history.slice(-10);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: systemPrompt,
      messages: trimmedHistory,
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );

  const reply = response.data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  history.push({ role: "assistant", content: reply });
  return reply;
}

// ============================================
// 6. ENVIAR RESPOSTA - DM
// ============================================
async function sendDirectMessage(recipientId, text) {
  await axios.post(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/me/messages`,
    {
      recipient: { id: recipientId },
      message: { text },
    },
    { params: { access_token: PAGE_ACCESS_TOKEN } }
  );
}

// ============================================
// 7. ENVIAR RESPOSTA - COMENTÁRIO
// ============================================
async function replyToComment(commentId, text, source) {
  const baseUrl = source === "page" ? "https://graph.facebook.com" : GRAPH_BASE_URL;
  const token = source === "page" ? PAGE_ACCESS_TOKEN_FB : PAGE_ACCESS_TOKEN;
  const endpointSuffix = source === "page" ? "comments" : "replies";

  await axios.post(
    `${baseUrl}/${GRAPH_API_VERSION}/${commentId}/${endpointSuffix}`,
    { message: text },
    { params: { access_token: token } }
  );
}

// ============================================
// 8. APAGAR COMENTÁRIO (moderação)
// ============================================
async function deleteComment(commentId, source) {
  const baseUrl = source === "page" ? "https://graph.facebook.com" : GRAPH_BASE_URL;
  const token = source === "page" ? PAGE_ACCESS_TOKEN_FB : PAGE_ACCESS_TOKEN;

  await axios.delete(`${baseUrl}/${GRAPH_API_VERSION}/${commentId}`, {
    params: { access_token: token },
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
