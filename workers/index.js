/**
 * Cracked Minds — Cloudflare Workers
 * Handles: Stripe checkout, payment verification, report email (Resend)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/api/create-checkout" && request.method === "POST") {
        return await handleCreateCheckout(request, env, corsHeaders);
      }
      if (path === "/api/verify-payment" && request.method === "GET") {
        return await handleVerifyPayment(request, env, corsHeaders);
      }
      if (path === "/api/send-report" && request.method === "POST") {
        return await handleSendReport(request, env, corsHeaders);
      }
      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  }
};

// ── Stripe price lookup ───────────────────────────────────────
function getPriceId(product, reportType, env) {
  const prices = {
    check: {
      one_off:      env.STRIPE_PRICE_CHECK_SINGLE,
      subscription: env.STRIPE_PRICE_CHECK_PRO,
    },
    comply: {
      one_off:      env.STRIPE_PRICE_COMPLY_SINGLE,
      subscription: env.STRIPE_PRICE_COMPLY_PRO,
    }
  };
  return prices[product]?.[reportType] || null;
}

// ── Create Stripe checkout session ───────────────────────────
async function handleCreateCheckout(request, env, corsHeaders) {
  const { product, reportType, companyNumber, companyName } = await request.json();

  const priceId = getPriceId(product, reportType, env);
  if (!priceId) {
    return new Response(
      JSON.stringify({ error: `No price for product=${product} type=${reportType}` }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const successBase = product === "comply"
    ? "https://crackedminds.co.uk/comply/index.html"
    : "https://crackedminds.co.uk/check/index.html";

  const body = new URLSearchParams({
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "mode": reportType === "subscription" ? "subscription" : "payment",
    "success_url": `${successBase}?success=true&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(companyNumber || "")}`,
    "cancel_url": `${successBase}?ref=${encodeURIComponent(companyNumber || "")}`,
    "metadata[company_number]": companyNumber || "",
    "metadata[company_name]": companyName || "",
    "metadata[report_type]": reportType || "one_off",
    "metadata[product]": product || "check",
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const session = await res.json();
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: session.error?.message || "Stripe error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  return new Response(
    JSON.stringify({ url: session.url }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ── Verify Stripe payment ─────────────────────────────────────
async function handleVerifyPayment(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "session_id required" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
  });

  const session = await res.json();
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: session.error?.message || "Stripe error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  return new Response(
    JSON.stringify({
      paid: session.payment_status === "paid" || session.status === "complete",
      company_number: session.metadata?.company_number || null,
      company_name:   session.metadata?.company_name   || null,
      report_type:    session.metadata?.report_type    || "one_off",
      product:        session.metadata?.product        || "check",
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ── Send report email via Resend ──────────────────────────────
async function handleSendReport(request, env, corsHeaders) {
  const { email, report, product } = await request.json();

  if (!email || !report) {
    return new Response(
      JSON.stringify({ error: "email and report required" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const html = buildEmailHtml(report, product);
  const companyName = report.company?.name || "Company";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Cracked Minds Check <reports@crackedminds.co.uk>",
      to: email,
      subject: `${companyName} — Due Diligence Report`,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: data.message || "Resend error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  return new Response(
    JSON.stringify({ sent: true }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ── Email HTML builder ────────────────────────────────────────
function buildEmailHtml(report, product) {
  const c = report.company;
  const risk = report.risk_assessment;
  const directors = (report.directors || []).filter(d => !d.resigned).slice(0, 8);
  const colour = risk.overall === "low" ? "#3B6D11" : risk.overall === "high" ? "#A32D2D" : "#854F0B";
  const bg     = risk.overall === "low" ? "#EAF3DE" : risk.overall === "high" ? "#FCEBEB" : "#FAEEDA";
  const productColour = product === "comply" ? "#185FA5" : "#0d9488";
  const productName   = product === "comply" ? "Comply" : "Check";

  const directorRows = directors.map(d =>
    `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${d.name}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;text-transform:capitalize">${d.role}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888">${d.appointed || "—"}</td>
    </tr>`
  ).join("");

  const flags = (risk.flags || []).map(f =>
    `<span style="display:inline-block;background:#FAEEDA;color:#854F0B;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${f}</span>`
  ).join("");

  const positives = (risk.positives || []).map(p =>
    `<span style="display:inline-block;background:#EAF3DE;color:#3B6D11;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${p}</span>`
  ).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f3;margin:0;padding:24px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">

  <div style="background:#0a0a08;padding:24px 32px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em">${productName} <span style="color:${productColour}">✦</span></div>
      <div style="color:#8a8880;font-size:13px;margin-top:2px">by Cracked Minds</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:40px;font-weight:700;color:${colour};line-height:1">${risk.score}</div>
      <div style="font-size:11px;color:#8a8880;text-transform:uppercase;letter-spacing:0.06em">${risk.overall} risk</div>
    </div>
  </div>

  <div style="padding:28px 32px">
    <div style="margin-bottom:24px">
      <div style="font-size:22px;font-weight:600;color:#111;margin-bottom:6px">${c.name}</div>
      <div style="font-size:13px;color:#888">
        Company No. ${c.number} &nbsp;·&nbsp;
        <span style="background:${bg};color:${colour};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500">${(c.status||"").toUpperCase()}</span>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
      <tr style="background:#f9f9f9">
        <td style="padding:9px 12px;color:#888">Type</td>
        <td style="padding:9px 12px">${c.type || "—"}</td>
        <td style="padding:9px 12px;color:#888">Incorporated</td>
        <td style="padding:9px 12px">${c.incorporated || "—"}</td>
      </tr>
      <tr>
        <td style="padding:9px 12px;color:#888">Address</td>
        <td colspan="3" style="padding:9px 12px">${c.address || "—"}</td>
      </tr>
      <tr style="background:#f9f9f9">
        <td style="padding:9px 12px;color:#888">Last accounts</td>
        <td style="padding:9px 12px">${report.filings?.latest_accounts_date || "—"}</td>
        <td style="padding:9px 12px;color:#888">Late filings</td>
        <td style="padding:9px 12px">${report.filings?.late_filings_count || 0}</td>
      </tr>
    </table>

    ${directors.length ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Active directors</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Name</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Role</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Appointed</th>
      </tr></thead>
      <tbody>${directorRows}</tbody>
    </table>` : ""}

    ${flags ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Risk flags</div>
    <div style="margin-bottom:18px">${flags}</div>` : ""}

    ${positives ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Positive indicators</div>
    <div style="margin-bottom:24px">${positives}</div>` : ""}

    <div style="background:#f9f9f9;border-radius:8px;padding:18px 20px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">AI recommendation</div>
      <div style="font-size:14px;color:#555;line-height:1.75">${risk.recommendation || ""}</div>
    </div>

    <div style="border-top:1px solid #f0f0f0;padding-top:16px;font-size:12px;color:#aaa">
      Data: Companies House (Crown copyright) · AI: Claude by Anthropic ·
      <a href="https://crackedminds.co.uk" style="color:#888;text-decoration:none">crackedminds.co.uk</a>
    </div>
  </div>
</div>
</body></html>`;
}
