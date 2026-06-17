/*
  crackedminds — Cloudflare Worker
  Routes: /api/search, /api/fca-search, /api/create-checkout,
          /api/verify-payment, /api/send-report, /api/contact
*/

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...cors }
    });
    try {
      if (path === "/api/search" && request.method === "GET") return await handleSearch(request, env, cors);
      if (path === "/api/fca-search" && request.method === "GET") return await handleFCASearch(request, env, cors);
      if (path === "/api/create-checkout" && request.method === "POST") return await createCheckout(request, env, json);
      if (path === "/api/verify-payment" && request.method === "GET") return await verifyPayment(request, env, json);
      if (path === "/api/send-report" && request.method === "POST") return await sendReport(request, env, json);
      if (path === "/api/contact" && request.method === "POST") return await handleContact(request, env, cors);
      return new Response("Not found", { status: 404, headers: cors });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

async function handleSearch(request, env, cors) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return new Response(JSON.stringify({ items: [], total: 0 }), { headers: { "Content-Type": "application/json", ...cors } });
  const res = await fetch(
    `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`,
    { headers: { "Authorization": "Basic " + btoa(env.CH_API_KEY + ":") } }
  );
  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", ...cors } });
}

async function handleFCASearch(request, env, cors) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return new Response(JSON.stringify({ items: [], total: 0 }), { headers: { "Content-Type": "application/json", ...cors } });
  const res = await fetch(
    `https://register.fca.org.uk/services/V0.1/Firm/Search?q=${encodeURIComponent(q)}&type=firm`,
    { headers: { "X-AUTH-KEY": env.FCA_API_KEY, "X-AUTH-EMAIL": "hello@crackedminds.co.uk", "Accept": "application/json" } }
  );
  if (!res.ok) return new Response(JSON.stringify({ error: "FCA search failed", status: res.status }), { status: res.status, headers: { "Content-Type": "application/json", ...cors } });
  const data = await res.json();
  const items = (data.Data || []).map(i => ({
    name: i.Name || "", frn: String(i.FRN || ""), status: i.Status || "", type: i.Type || "",
    address: [i.Address1, i.Address2, i.Town, i.Postcode].filter(Boolean).join(", ")
  }));
  return new Response(JSON.stringify({ items, total: items.length }), { headers: { "Content-Type": "application/json", ...cors } });
}

function getPrice(product, reportType, env) {
  const prices = {
    check:  { one_off: env.STRIPE_PRICE_CHECK_SINGLE,  subscription: env.STRIPE_PRICE_CHECK_PRO },
    comply: { one_off: env.STRIPE_PRICE_COMPLY_SINGLE, subscription: env.STRIPE_PRICE_COMPLY_PRO }
  };
  return (prices[product] || prices.check)[reportType] || null;
}

async function createCheckout(request, env, json) {
  const { product, reportType, companyNumber, companyName, priceId: directPriceId } = await request.json();
  const priceId = directPriceId || getPrice(product, reportType, env);
  if (!priceId) return json({ error: `No price for ${product}/${reportType}` }, 400);
  const knownBases = {
    check: "https://crackedminds.co.uk/check/index.html",
    comply: "https://crackedminds.co.uk/comply/index.html",
    boltwork: "https://crackedminds.co.uk/boltwork/buy/index.html",
    "land-registry": "https://crackedminds.co.uk/land-registry/index.html",
    vat: "https://crackedminds.co.uk/vat/index.html",
    patent: "https://crackedminds.co.uk/patent/index.html",
    packages: "https://crackedminds.co.uk/packages/index.html",
    pubmed: "https://crackedminds.co.uk/pubmed/index.html",
    charity: "https://crackedminds.co.uk/charity/index.html",
    arxiv: "https://crackedminds.co.uk/arxiv/index.html"
  };
  const base = knownBases[product] || knownBases.check;
  const body = new URLSearchParams({
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "mode": reportType === "subscription" ? "subscription" : "payment",
    "success_url": product === "boltwork" ? `${base}?success=true&session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(companyName || "")}` : `${base}?success=true&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(companyNumber || "")}`,
    "cancel_url": `${base}?ref=${encodeURIComponent(companyNumber || "")}`,
    "metadata[company_number]": companyNumber || "",
    "metadata[company_name]": companyName || "",
    "metadata[report_type]": reportType || "one_off",
    "metadata[product]": product || "check"
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const session = await res.json();
  if (!res.ok) return json({ error: session.error?.message || "Stripe error" }, 500);
  return json({ url: session.url });
}

async function verifyPayment(request, env, json) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return json({ error: "Missing session_id" }, 400);
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  const session = await res.json();
  if (!res.ok) return json({ error: "Failed to verify session" }, 500);
  return json({
    paid: session.payment_status === "paid",
    status: session.payment_status,
    customer_email: session.customer_details?.email || "",
    metadata: session.metadata || {}
  });
}

async function sendReport(request, env, json) {
  const body = await request.json();
  const to = body.to || body.email;
  const r = body.report || {};
  const product = body.product || "check";
  if (!to) return json({ error: "Missing required fields" }, 400);

  // Build professional HTML email from report data
  const html = body.html || buildReportEmail(r, product);
  const companyName = r.company_name || r.name || "Report";
  const subject = body.subject || `Your Cracked Minds report — ${companyName}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "reports@crackedminds.co.uk", to: [to], subject, html })
  });
  if (!res.ok) {
    const err = await res.text();
    return json({ error: "Email failed", detail: err }, 500);
  }
  return json({ ok: true });
}

function buildReportEmail(r, product) {
  const c = r.company || r;
  const name = c.company_name || c.name || "Unknown Company";
  const number = c.company_number || c.number || "";
  const status = c.company_status || c.status || "";
  const incorporated = c.date_of_creation || c.incorporated || "";
  const address = c.registered_office_address
    ? [c.registered_office_address.address_line_1, c.registered_office_address.locality, c.registered_office_address.postal_code].filter(Boolean).join(", ")
    : c.address || "";

  const directors = (r.directors || []).slice(0, 10).map(d =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${d.name || d.officer_name || ""}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${d.officer_role || d.role || ""}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${d.appointed_on || d.appointed || ""}</td></tr>`
  ).join("") || `<tr><td colspan="3" style="padding:8px 12px;color:#6b7280">No director data available</td></tr>`;

  const pscs = (r.persons_with_significant_control || r.pscs || []).slice(0, 5).map(p =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${p.name || ""}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${(p.natures_of_control || []).join(", ") || p.control || ""}</td></tr>`
  ).join("") || `<tr><td colspan="2" style="padding:8px 12px;color:#6b7280">No PSC data available</td></tr>`;

  const aiRisk = r.ai_enrichment || r.enrichment || {};
  const riskNarrative = aiRisk.risk_narrative || aiRisk.narrative || "";
  const riskLevel = aiRisk.risk_level || aiRisk.risk || "";
  const riskColor = riskLevel === "HIGH" ? "#dc2626" : riskLevel === "MEDIUM" ? "#d97706" : "#16a34a";

  const charges = r.charges || [];
  const chargesHtml = charges.length
    ? charges.slice(0, 5).map(ch => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151">${ch.classification?.description || ch.type || "Charge"}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${ch.status || ""}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${ch.created_on || ch.date || ""}</td></tr>`).join("")
    : `<tr><td colspan="3" style="padding:8px 12px;color:#16a34a">No charges registered</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cracked Minds Report — ${name}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <!-- Header -->
  <tr><td style="background:#0a0a08;padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><span style="font-size:20px;font-weight:800;color:#ffffff;font-family:'Segoe UI',sans-serif">⚡ Cracked Minds</span></td>
      <td align="right"><span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em">Company Intelligence</span></td>
    </tr></table>
  </td></tr>

  <!-- Company header -->
  <tr><td style="padding:28px 32px;border-bottom:1px solid #e5e7eb">
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827">${name}</h1>
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:16px;font-size:13px;color:#6b7280">Company No: <strong style="color:#374151">${number}</strong></td>
      <td style="padding-right:16px;font-size:13px;color:#6b7280">Status: <strong style="color:${status === "active" ? "#16a34a" : "#dc2626"}">${status.toUpperCase()}</strong></td>
      <td style="font-size:13px;color:#6b7280">Incorporated: <strong style="color:#374151">${incorporated}</strong></td>
    </tr></table>
    ${address ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${address}</p>` : ""}
  </td></tr>

  ${riskNarrative ? `<!-- AI Risk Assessment -->
  <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;background:#fafafa">
    <h2 style="margin:0 0 12px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280">AI Risk Assessment</h2>
    ${riskLevel ? `<span style="display:inline-block;padding:4px 12px;background:${riskColor}1a;color:${riskColor};border-radius:4px;font-size:12px;font-weight:600;margin-bottom:12px">${riskLevel} RISK</span>` : ""}
    <p style="margin:0;font-size:14px;line-height:1.7;color:#374151">${riskNarrative}</p>
  </td></tr>` : ""}

  <!-- Key facts -->
  <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280">Company Details</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <tr style="background:#f9fafb"><td style="padding:10px 12px;font-size:13px;color:#6b7280;width:40%">Company type</td><td style="padding:10px 12px;font-size:13px;color:#374151">${c.type || c.company_type || "—"}</td></tr>
      <tr><td style="padding:10px 12px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">SIC codes</td><td style="padding:10px 12px;font-size:13px;color:#374151;border-top:1px solid #e5e7eb">${(c.sic_codes || []).join(", ") || "—"}</td></tr>
      <tr style="background:#f9fafb"><td style="padding:10px 12px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Accounts due</td><td style="padding:10px 12px;font-size:13px;color:#374151;border-top:1px solid #e5e7eb">${c.accounts?.next_due || c.accounts_due || "—"}</td></tr>
      <tr><td style="padding:10px 12px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Confirmation due</td><td style="padding:10px 12px;font-size:13px;color:#374151;border-top:1px solid #e5e7eb">${c.confirmation_statement?.next_due || c.confirmation_due || "—"}</td></tr>
    </table>
  </td></tr>

  <!-- Directors -->
  <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280">Directors</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Name</th><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Role</th><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Appointed</th></tr>
      ${directors}
    </table>
  </td></tr>

  <!-- PSC -->
  <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280">Persons with Significant Control</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Name</th><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Nature of Control</th></tr>
      ${pscs}
    </table>
  </td></tr>

  <!-- Charges -->
  <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
    <h2 style="margin:0 0 16px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280">Registered Charges</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Type</th><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Status</th><th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:500">Created</th></tr>
      ${chargesHtml}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 32px;background:#f9fafb">
    <p style="margin:0 0 8px;font-size:12px;color:#9ca3af">This report was generated by Cracked Minds using data from Companies House. Data is accurate as of the report generation date.</p>
    <p style="margin:0;font-size:12px;color:#9ca3af">© 2026 Cracked Minds Ltd · Manchester, UK · <a href="https://crackedminds.co.uk" style="color:#0d9488">crackedminds.co.uk</a></p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

async function handleContact(request, env, cors) {
  try {
    const { name, email, organisation, message } = await request.json();
    if (!name || !email || !message) return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "reports@crackedminds.co.uk",
        to: ["hello@crackedminds.co.uk"],
        reply_to: email,
        subject: `New enquiry from ${name}${organisation ? " at " + organisation : ""}`,
        html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>${organisation ? `<p><strong>Organisation:</strong> ${organisation}</p>` : ""}<p><strong>Message:</strong></p><p>${message.replace(/\n/g, "<br>")}</p>`
      })
    });
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: "Email failed", detail: err }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...cors } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
  }
}
