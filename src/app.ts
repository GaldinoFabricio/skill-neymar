import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "sua_chave_secreta_aqui";

app.post("/create-checkout-session", async (req: Request, res: Response) => {
   try {
      const session = await stripe.checkout.sessions.create({
         line_items: [
            {
               price: "price_1QBb7AB3BGwI4SEkQnXMSlFf",
               quantity: 1,
            },
         ],
         mode: "payment",
         success_url: `${process.env.URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
         cancel_url: `${process.env.URL}/cancel.html`,
      });
      console.log(session);
      res.json({ id: session.id });
   } catch (error) {
      if (error instanceof Stripe.errors.StripeAPIError) {
         console.error("Stripe API Error:", error.message);
      } else {
         console.error("Other error:", error);
      }
      res.status(500).send("Erro ao criar sessão de pagamento");
   }
});

app.get("/check-neymar-skill", async (req: Request, res: Response) => {
   const sessionId = req.query.session_id;

   if (!sessionId) {
      res.status(400).send("Session ID is required");
   }

   try {
      const session = await stripe.checkout.sessions.retrieve(
         sessionId as string
      );

      if (session.payment_status != "paid") {
         res.status(400).json({ error: "Payment not completed" });
      }

      const hasSkill = Math.random() > 0.5;
      res.json({ hasSkill });
   } catch (error) {
      res.status(500).json({ error: "Failed to validate payment" });
   }
});

app.listen(PORT, () => {
   console.log(
      `Server is running on ${process.env.URL || "http://localhost"}:${PORT}`
   );
});
