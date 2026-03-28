import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM  = Deno.env.get('TWILIO_PHONE_NUMBER')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone } = await req.json()
    if (!phone) return new Response(JSON.stringify({ error: 'Phone required' }), { status: 400, headers: corsHeaders })

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    // Save to otp_codes via service role (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { error: dbErr } = await supabase
      .from('otp_codes')
      .upsert({ phone, code, expires_at: expiresAt, attempts: 0 })

    if (dbErr) throw new Error(`DB error: ${dbErr.message}`)

    // Send SMS via Twilio
    const body = new URLSearchParams({
      To: phone,
      From: TWILIO_FROM,
      Body: `Seu codigo LocateTool: ${code}\n\nValido por 5 minutos. Nao compartilhe.`,
    })

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )

    if (!twilioRes.ok) {
      const err = await twilioRes.json()
      throw new Error(`Twilio error: ${err.message}`)
    }

    console.log(`✅ OTP sent to ${phone}`)
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders })

  } catch (err) {
    console.error('❌ send-otp error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
