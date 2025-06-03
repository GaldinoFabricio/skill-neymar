import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json());

interface PaymentSession {
   id: string;
   stripe_session_id: string;
   status: "pending" | "completed" | "expired";
   hasSkill?: boolean;
   created_at: Date;
   completed_at?: Date;
   customer_email?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || "sua_chave_secreta_aqui";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const paymentSessions = new Map<string, PaymentSession>();

app.post("/create-checkout-session", async (req: Request, res: Response) => {
   try {
      // Gerar ID único para esta sessão
      const sessionUniqueId = uuidv4();

      const session = await stripe.checkout.sessions.create({
         line_items: [
            {
               price: "price_1QBb7AB3BGwI4SEkQnXMSlFf",
               quantity: 1,
            },
         ],
         mode: "payment",
         // ✅ NOVA URL: Redireciona para página de resultado dinâmica
         success_url: `${process.env.URL}/result?session_id={CHECKOUT_SESSION_ID}&unique_id=${sessionUniqueId}`,
         cancel_url: `${process.env.URL}/cancel.html`,
         customer_email: req.body.customer_email,
         metadata: {
            unique_id: sessionUniqueId,
            user_id: req.body.user_id || uuidv4(),
            product_type: "neymar_skill_check",
         },
      });

      // 💾 Salvar sessão no "banco de dados"
      const paymentSession: PaymentSession = {
         id: sessionUniqueId,
         stripe_session_id: session.id,
         status: "pending",
         created_at: new Date(),
         customer_email: req.body.customer_email,
      };

      paymentSessions.set(session.id, paymentSession);
      paymentSessions.set(sessionUniqueId, paymentSession); // Dupla indexação

      console.log("💳 Sessão de pagamento criada:", session.id);
      res.json({
         id: session.id,
         unique_id: sessionUniqueId,
      });
   } catch (error) {
      if (error instanceof Stripe.errors.StripeAPIError) {
         console.error("Stripe API Error:", error.message);
      } else {
         console.error("Other error:", error);
      }
      res.status(500).send("Erro ao criar sessão de pagamento");
   }
});

app.get("/result", async (req: Request, res: Response) => {
   const sessionId = req.query.session_id as string;
   const uniqueId = req.query.unique_id as string;

   if (!sessionId || !uniqueId) {
      res.status(400).send("Parâmetros obrigatórios ausentes");
      return;
   }

   // Buscar sessão
   const paymentSession = paymentSessions.get(sessionId);

   if (!paymentSession) {
      res.status(404).send("Sessão não encontrada");
      return;
   }

   // 🎨 Página HTML dinâmica que se atualiza automaticamente
   const html = `
   <!DOCTYPE html>
   <html lang="pt-BR">
   <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neymar Skill Check - Resultado</title>
      <style>
         body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
         }
         .container {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
         }
         .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
         }
         .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255,255,255,0.3);
            border-left: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
         }
         @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
         .result { display: none; }
         .skill-yes { color: #4CAF50; font-size: 2em; }
         .skill-no { color: #ff6b6b; font-size: 2em; }
         .error { color: #ff6b6b; }
         button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 25px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 20px;
         }
         button:hover { background: #45a049; }
      </style>
   </head>
   <body>
      <div class="container">
         <h1>⚽ Neymar Skill Check</h1>

         <div id="loading" class="loading">
            <div class="spinner"></div>
            <div>
               <h2>Processando seu pagamento...</h2>
               <p>Aguarde enquanto verificamos suas habilidades!</p>
               <small>Status: <span id="status">Verificando pagamento</span></small>
            </div>
         </div>

         <div id="result" class="result">
            <div id="skill-result"></div>
            <button onclick="window.location.href='/'">Tentar Novamente</button>
         </div>

         <div id="error" class="error" style="display: none;">
            <h2>❌ Ops! Algo deu errado</h2>
            <p id="error-message"></p>
            <button onclick="window.location.reload()">Tentar Novamente</button>
         </div>
      </div>

      <script>
         const sessionId = "${sessionId}";
         const uniqueId = "${uniqueId}";
         let attempts = 0;
         const maxAttempts = 60; // 2 minutos máximo

         async function checkPaymentStatus() {
            try {
               const response = await fetch(\`/api/payment-status/\${sessionId}\`);
               const data = await response.json();

               document.getElementById('status').textContent =
                  data.status === 'pending' ? 'Aguardando confirmação...' :
                  data.status === 'processing' ? 'Processando resultado...' :
                  data.status === 'completed' ? 'Concluído!' : data.status;

               if (data.status === 'completed') {
                  showResult(data);
               } else if (data.status === 'failed' || data.status === 'expired') {
                  showError('Pagamento não foi concluído. Tente novamente.');
               } else {
                  // Continuar verificando
                  attempts++;
                  if (attempts < maxAttempts) {
                     setTimeout(checkPaymentStatus, 2000); // Verificar a cada 2s
                  } else {
                     showError('Tempo limite excedido. Recarregue a página.');
                  }
               }
            } catch (error) {
               console.error('Erro ao verificar status:', error);
               attempts++;
               if (attempts < maxAttempts) {
                  setTimeout(checkPaymentStatus, 3000);
               } else {
                  showError('Erro de conexão. Recarregue a página.');
               }
            }
         }

         function showResult(data) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('result').style.display = 'block';

            const resultDiv = document.getElementById('skill-result');
            if (data.hasSkill) {
               resultDiv.innerHTML = \`
                  <div class="skill-yes">
                     <h2>🎉 PARABÉNS!</h2>
                     <p>⚽ Você tem a habilidade do Neymar!</p>
                     <p>🏆 Você é craque!</p>
                  </div>
               \`;
            } else {
               resultDiv.innerHTML = \`
                  <div class="skill-no">
                     <h2>😅 Não desta vez!</h2>
                     <p>⚽ Continue praticando!</p>
                     <p>💪 Todo craque começou assim!</p>
                  </div>
               \`;
            }
         }

         function showError(message) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'block';
            document.getElementById('error-message').textContent = message;
         }

         // Iniciar verificação imediatamente
         checkPaymentStatus();
      </script>
   </body>
   </html>
   `;

   res.send(html);
});

app.get(
   "/api/payment-status/:sessionId",
   async (req: Request, res: Response) => {
      const { sessionId } = req.params;

      const paymentSession = paymentSessions.get(sessionId);

      if (!paymentSession) {
         res.status(404).json({ error: "Session not found" });
         return;
      }

      // Se ainda está pending, verificar no Stripe também
      if (paymentSession.status === "pending") {
         try {
            const stripeSession = await stripe.checkout.sessions.retrieve(
               sessionId
            );
            if (
               stripeSession.payment_status === "paid" &&
               paymentSession.status === "pending"
            ) {
               // Webhook pode não ter chegado ainda, processar agora
               paymentSession.status = "processing";
               paymentSession.hasSkill = Math.random() > 0.5;
               setTimeout(() => {
                  paymentSession.status = "completed";
                  paymentSession.completed_at = new Date();
               }, 1000);
            }
         } catch (error) {
            console.error("Erro ao verificar no Stripe:", error);
         }
      }

      res.json({
         status: paymentSession.status,
         hasSkill: paymentSession.hasSkill,
         completed_at: paymentSession.completed_at,
      });
   }
);

app.get("/check-neymar-skill", async (req: Request, res: Response) => {
   const sessionId = req.query.session_id as string;

   if (!sessionId) {
      res.status(400).send("Session ID is required");
   }

   try {
      // 🚀 Primeiro verifica no nosso "banco" (atualizado via webhook)
      const paymentSession = paymentSessions.get(sessionId);

      if (!paymentSession) {
         res.status(404).json({ error: "Session not found" });
         return;
      }

      if (paymentSession.status !== "completed") {
         res.status(400).json({
            error: "Payment not completed yet",
            status: paymentSession.status,
         });
         return;
      }

      // ✅ Pagamento já confirmado via webhook!
      res.json({
         hasSkill: paymentSession.hasSkill,
         message:
            "Skill check realizado após confirmação automática do pagamento! 🎉",
      });
   } catch (error) {
      console.error("❌ Erro ao verificar skill:", error);
      res.status(500).json({ error: "Failed to validate payment" });
   }
});

app.post("/webhook/stripe", async (req: Request, res: Response) => {
   const sig = req.headers["stripe-signature"] as string;

   let event: Stripe.Event;

   try {
      // 🔐 Verificar assinatura do Stripe (SEGURANÇA)
      event = stripe.webhooks.constructEvent(
         req.body,
         sig,
         STRIPE_WEBHOOK_SECRET
      );
      console.log("🎯 Webhook válido recebido:", event.type);
   } catch (err) {
      console.log("❌ Webhook signature verification failed:", err);
      res.status(400).send(`Webhook Error: ${err}`);
      return;
   }

   // 📋 Processar diferentes tipos de eventos
   switch (event.type) {
      case "checkout.session.completed":
         await handleCheckoutCompleted(
            event.data.object as Stripe.Checkout.Session
         );
         break;

      case "checkout.session.expired":
         await handleCheckoutExpired(
            event.data.object as Stripe.Checkout.Session
         );
         break;

      case "payment_intent.succeeded":
         await handlePaymentSucceeded(
            event.data.object as Stripe.PaymentIntent
         );
         break;

      case "payment_intent.payment_failed":
         await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
         break;

      default:
         console.log(`⚠️ Evento não tratado: ${event.type}`);
   }

   // ✅ SEMPRE responder 200 OK
   res.json({ received: true });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
   console.log("✅ Checkout completado:", session.id);

   const paymentSession = paymentSessions.get(session.id);
   if (!paymentSession) {
      console.log("⚠️ Sessão não encontrada no banco local:", session.id);
      return;
   }

   // 🎯 Atualizar status e fazer o "skill check"
   paymentSession.status = "completed";
   paymentSession.completed_at = new Date();
   paymentSession.hasSkill = Math.random() > 0.5; // Sua lógica do Neymar skill

   console.log(
      `🏆 Neymar skill result para ${session.id}: ${
         paymentSession.hasSkill ? "TEM" : "NÃO TEM"
      } habilidade!`
   );

   // 🚀 Executar ações pós-pagamento
   await executePostPaymentActions(paymentSession, session);
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
   console.log("⏰ Checkout expirado:", session.id);

   const paymentSession = paymentSessions.get(session.id);
   if (paymentSession) {
      paymentSession.status = "expired";
   }
}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
   console.log("💰 Pagamento confirmado:", paymentIntent.id);
   // Lógica adicional se necessário
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
   console.log("💔 Pagamento falhou:", paymentIntent.id);
   // Lógica para pagamentos falhados
}

// ===============================================
// 🎬 AÇÕES PÓS-PAGAMENTO
// ===============================================

async function executePostPaymentActions(
   paymentSession: PaymentSession,
   stripeSession: Stripe.Checkout.Session
) {
   console.log(
      "🎉 Executando ações pós-pagamento para:",
      paymentSession.stripe_session_id
   );

   // 1. 📧 Enviar email com resultado
   await sendSkillResultEmail(paymentSession, stripeSession);

   // 2. 🔔 Notificar frontend em tempo real (se tiver WebSocket)
   await notifyFrontendRealTime(paymentSession);

   // 3. 📊 Registrar analytics/métricas
   await logAnalytics(paymentSession);

   // 4. 🎁 Se tem skill, liberar conteúdo especial
   if (paymentSession.hasSkill) {
      await unlockSpecialContent(paymentSession);
   }
}

async function sendSkillResultEmail(
   paymentSession: PaymentSession,
   stripeSession: Stripe.Checkout.Session
) {
   const email =
      stripeSession.customer_details?.email || paymentSession.customer_email;

   if (!email) return;

   console.log(`📧 Enviando resultado por email para: ${email}`);
   console.log(
      `🏆 Resultado: ${
         paymentSession.hasSkill
            ? "⚽ Você tem a habilidade do Neymar!"
            : "😅 Não desta vez, mas continue tentando!"
      }`
   );

   // Aqui você integraria com serviço de email (SendGrid, AWS SES, etc.)
   // await emailService.send({
   //    to: email,
   //    subject: 'Resultado do seu Neymar Skill Check!',
   //    template: 'skill-result',
   //    data: { hasSkill: paymentSession.hasSkill }
   // });
}

async function notifyFrontendRealTime(paymentSession: PaymentSession) {
   console.log(
      `🔔 Notificação em tempo real enviada para sessão: ${paymentSession.stripe_session_id}`
   );

   // Se você tiver WebSocket ou Server-Sent Events:
   // websocketServer.emit('payment-completed', {
   //    sessionId: paymentSession.stripe_session_id,
   //    hasSkill: paymentSession.hasSkill
   // });
}

async function logAnalytics(paymentSession: PaymentSession) {
   console.log(
      `📊 Analytics registrados para: ${paymentSession.stripe_session_id}`
   );

   // Integração com Google Analytics, Mixpanel, etc.
   // analytics.track('skill_check_completed', {
   //    session_id: paymentSession.stripe_session_id,
   //    has_skill: paymentSession.hasSkill,
   //    timestamp: paymentSession.completed_at
   // });
}

async function unlockSpecialContent(paymentSession: PaymentSession) {
   console.log(
      `🎁 Conteúdo especial liberado para: ${paymentSession.stripe_session_id}`
   );

   // Gerar token JWT com acesso especial, liberar downloads, etc.
   // const specialToken = jwt.sign(
   //    { hasNeymarSkill: true, sessionId: paymentSession.stripe_session_id },
   //    JWT_SECRET,
   //    { expiresIn: '30d' }
   // );
}

// ===============================================
// 🔍 NOVAS ROTAS ÚTEIS
// ===============================================

// Listar todas as sessões (para debug)
app.get("/admin/sessions", (req: Request, res: Response) => {
   const sessions = Array.from(paymentSessions.values());
   res.json({
      total: sessions.length,
      sessions: sessions,
   });
});

// Consultar sessão específica
app.get("/session/:sessionId", (req: Request, res: Response) => {
   const session = paymentSessions.get(req.params.sessionId);

   if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
   }

   res.json(session);
});

app.get("/", (req: Request, res: Response) => {
   res.send(`
   <!DOCTYPE html>
   <html>
   <head>
      <title>Neymar Skill Check</title>
      <style>
         body { font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
         button { background: #4CAF50; color: white; border: none; padding: 15px 30px; border-radius: 25px; font-size: 16px; cursor: pointer; }
      </style>
   </head>
   <body>
      <h1>⚽ Teste sua habilidade como o Neymar!</h1>
      <p>Faça o pagamento e descubra se você tem o que é preciso!</p>
      <button onclick="createCheckout()">Fazer Teste - R$ 10,00</button>
      <script src="https://js.stripe.com/v3/"></script>
      <script>
         async function createCheckout() {
            const response = await fetch('/create-checkout-session', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ customer_email: 'teste@email.com' })
            });
            const pk_key = '${process.env.STRIPE_PUBLIC_KEY}';
            const stripe_pk = Stripe(pk_key);
            const { id } = await response.json();
            stripe_pk.redirectToCheckout({ sessionId: id });
            // Para redirecionar diretamente ao Stripe Checkout:
            //window.location.href = \`https://checkout.stripe.com/pay/\${id}\`;
         }
      </script>
   </body>
   </html>
   `);
});

app.listen(PORT, () => {
   console.log(
      `🚀 Server is running on ${process.env.URL || "http://localhost"}:${PORT}`
   );
   console.log(
      `🎯 Webhook endpoint: ${
         process.env.URL || "http://localhost:" + PORT
      }/webhook/stripe`
   );
   console.log("\n📋 CONFIGURAÇÃO NECESSÁRIA:");
   console.log("1. Configure o webhook no Stripe Dashboard");
   console.log("2. Adicione STRIPE_WEBHOOK_SECRET no .env");
   console.log("3. URL do webhook: /webhook/stripe");
   console.log("\n🎬 EVENTOS TRATADOS:");
   console.log("- checkout.session.completed");
   console.log("- checkout.session.expired");
   console.log("- payment_intent.succeeded");
   console.log("- payment_intent.payment_failed");
});
