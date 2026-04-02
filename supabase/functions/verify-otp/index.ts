import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const VERIFY_SID   = 'VAf75762f84000201579fcef8a88c4ea82'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, code } = await req.json()
    if (!phone || !code) return new Response(JSON.stringify({ error: 'Phone and code required' }), { status: 400, headers: corsHeaders })

    // Verify code via Twilio Verify
    const body = new URLSearchParams({
      To: phone,
      Code: code,
    })

    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${VERIFY_SID}/VerificationChecks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )

    const data = await res.json()

    if (data.status === 'approved') {
      console.log(`✅ OTP verified for ${phone}`)
      return new Response(JSON.stringify({ success: true, status: 'approved' }), { headers: corsHeaders })
    }

    console.log(`❌ OTP rejected for ${phone}: ${data.status}`)
    return new Response(JSON.stringify({ success: false, status: data.status }), { status: 401, headers: corsHeaders })

  } catch (err) {
    console.error('❌ verify-otp error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
