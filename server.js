// ============================================
// AGENTE DE IA - SUPORTE INSTAGRAM/MESSENGER
// ============================================
// Recebe comentários e DMs via webhook do Meta,
// responde usando a API do Claude com contexto
// da conversa e instruções do system prompt.

const express = require("express");
const axios = require("axios");
const { SYSTEM_PROMPT } = require("./prompt");

const app = express();
app.use(express.json());

// ---------- CONFIG (via variáveis de ambiente) ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // você escolhe essa string
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // token que você gerou
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GRAPH_API_VERSION = "v21.0";

// Memória simples de conversa em RAM (troque por um banco depois, ex: Redis/Postgres)
const conversationHistory = {}; // { senderId: [ {role, content}, ... ] }

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
            if (change.field === "comments") {
              await handleComment(change.value);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Erro processando evento:", err.message);
  }
});

// ============================================
// 3. LIDAR COM MENSAGEM DIRETA (DM)
// ============================================
async function handleDirectMessage(event) {
  const senderId = event.sender.id;
  const userText = event.message.text;
  if (!userText) return; // ignora imagem/áudio por enquanto

  const reply = await askClaude(senderId, userText);
  await sendDirectMessage(senderId, reply);
}

// ============================================
// 4. LIDAR COM COMENTÁRIO
// ============================================
async function handleComment(value) {
  const commentId = value.id;
  const commentText = value.text;
  const fromId = value.from?.id;

  // Evita responder aos próprios comentários do agente
  if (!commentText || !fromId) return;

  const reply = await askClaude(`comment_${commentId}`, commentText);
  await replyToComment(commentId, reply);
}

// ============================================
// 5. CHAMAR A API DO CLAUDE
// ============================================
async function askClaude(conversationKey, userMessage) {
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
      system: SYSTEM_PROMPT,
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
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`,
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
async function replyToComment(commentId, text) {
  await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${commentId}/replies`,
    { message: text },
    { params: { access_token: PAGE_ACCESS_TOKEN } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
