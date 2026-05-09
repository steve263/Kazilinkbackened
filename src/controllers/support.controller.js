const axios = require('axios');

const SYSTEM_PROMPT = `You are Kazi AI, the friendly customer support assistant for KaziShow — Kenya's all-in-one service marketplace. You help customers and service providers with questions about booking services, payments, accounts, disputes, and how the platform works.

Key facts about KaziShow:
- KaziShow connects customers with vetted local service providers across Kenya (plumbers, cleaners, electricians, tutors, salons, restaurants, mechanics, and more)
- Bookings are made through the app; customers pay via M-Pesa (Safaricom), card, or cash
- Providers are verified and rated by real customers
- Support hours: 8AM–8PM EAT (East Africa Time), Monday to Sunday
- WhatsApp Support Agent 1 — General Help: +254795542312
- WhatsApp Support Agent 2 — Payments & Disputes: +254731421635
- Email: support@kazishow.co.ke
- For urgent payment issues or disputes, always direct users to WhatsApp Agent 2 (+254731421635)

How to help:
- Booking issues: guide through the app booking flow, check booking status, advise on cancellations
- Payment issues: M-Pesa STK push, payment confirmation, refunds — direct payment disputes to WhatsApp K2
- Account issues: login, profile, verification, suspension appeals — direct to email for suspension appeals
- Provider issues: how to register, manage services, pricing, availability
- Trust & Safety: how to report a bad provider, fraud, dispute resolution

Tone: Friendly, concise, helpful. Occasionally use Swahili words (e.g., "Karibu!", "Asante sana", "Sawa!"). Keep answers short and practical. If you cannot resolve something, offer to connect to a human agent via WhatsApp.`;

async function aiChat(req, res) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: 'AI support temporarily unavailable. Please contact us on WhatsApp: +254795542312',
      });
    }

    // Take last 6 messages to stay within context limits
    const recent = messages.slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 1000),
    }));

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: recent,
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const reply =
      response.data?.content?.[0]?.text ||
      'I apologize, I could not generate a response. Please contact us on WhatsApp: +254795542312';

    res.json({ success: true, data: { reply } });
  } catch (err) {
    console.error('❌ AI chat error:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: 'AI support unavailable. Please contact us on WhatsApp: +254795542312 or +254731421635',
    });
  }
}

module.exports = { aiChat };
