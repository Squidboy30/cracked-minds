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
  const { product, reportType, companyNumber, companyName } = await request.json();
  const priceId = getPrice(product, reportType, env);
  if (!priceId) return json({ error: `No price for ${product}/${reportType}` }, 400);
  const knownBases = {
    check: "https://crackedminds.co.uk/check/index.html",
    comply: "https://crackedminds.co.uk/comply/index.html",
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
    "success_url": `${base}?success=true&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(companyNumber || "")}`,
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
  const html = body.html || (body.report ? `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap">${JSON.stringify(body.report, null, 2)}</pre>` : null);
  const subject = body.subject || `Your Cracked Minds ${body.product || "Check"} report`;
  if (!to || !html) return json({ error: "Missing required fields" }, 400);
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
