/**
 * Cracked Minds - Cloudflare Worker
 * Routes: /api/create-checkout, /api/verify-payment, /api/send-report
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...cors }
      });

    try {
      if (path === "/api/create-checkout" && request.method === "POST") {
        return await createCheckout(request, env, json);
      }
      if (path === "/api/verify-payment" && request.method === "GET") {
        return await verifyPayment(request, env, json);
      }
      if (path === "/api/send-report" && request.method === "POST") {
        return await sendReport(request, env, json);
      }
      if (path === "/api/search" && request.method === "GET") {
        return await handleSearch(request, env, cors);
      }
      if (path === "/api/fca-search" && request.method === "GET") {
        return await handleFCASearch(request, env, cors);
      }
      return new Response("Not found", { status: 404, headers: cors });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// ── Companies House search proxy ─────────────────────────────
async function handleSearch(request, env, cors) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) {
    return new Response(JSON.stringify({ items: [], total: 0 }), {
      headers: { "Content-Type": "application/json", ...cors }
    });
  }

  const apiKey = env.CH_API_KEY;
  const auth = apiKey ? "Basic " + btoa(apiKey + ":") : "";

  const chUrl = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`;

  const res = await fetch(chUrl, {
    headers: {
      "Authorization": auth,
      "Accept": "application/json",
    }
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Search failed", status: res.status }), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...cors }
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify({
    items: (data.items || []).map(i => ({
      title: i.title || "",
      company_number: i.company_number || "",
      company_status: i.company_status || "",
      company_type: i.company_type || "",
      address_snippet: i.address_snippet || "",
      date_of_creation: i.date_of_creation || "",
    })),
    total: data.total_results || 0,
  }), {
    headers: { "Content-Type": "application/json", ...cors }
  });
}


// ── FCA Register search proxy ─────────────────────────────────
async function handleFCASearch(request, env, cors) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) {
    return new Response(JSON.stringify({ items: [], total: 0 }), {
      headers: { "Content-Type": "application/json", ...cors }
    });
  }

  const fcaUrl = `https://register.fca.org.uk/services/V0.1/Firm/Search?q=${encodeURIComponent(q)}&type=firm`;

  const res = await fetch(fcaUrl, {
    headers: {
      "X-AUTH-KEY": env.FCA_API_KEY,
      "X-AUTH-EMAIL": "hello@crackedminds.co.uk",
      "Accept": "application/json",
    }
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "FCA search failed", status: res.status }), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...cors }
    });
  }

  const data = await res.json();
  const results = data.Data || [];
  const items = results.map(i => ({
    name: i.Name || "",
    frn: String(i.FRN || ""),
    status: i.Status || "",
    type: i.Type || "",
    address: [i.Address1, i.Address2, i.Town, i.Postcode].filter(Boolean).join(", "),
  }));

  return new Response(JSON.stringify({ items, total: items.length }), {
    headers: { "Content-Type": "application/json", ...cors }
  });
}

// ── Stripe price lookup ───────────────────────────────────────
function getPrice(product, reportType, env) {
  const prices = {
    check:  { one_off: env.STRIPE_PRICE_CHECK_SINGLE,  subscription: env.STRIPE_PRICE_CHECK_PRO },
    comply: { one_off: env.STRIPE_PRICE_COMPLY_SINGLE, subscription: env.STRIPE_PRICE_COMPLY_PRO },
  };
  // All new products fall back to Check pricing until dedicated prices are set
  return (prices[product] || prices.check)[reportType] || null;
}

// ── Create Stripe checkout ────────────────────────────────────
async function createCheckout(request, env, json) {
  const { product, reportType, companyNumber, companyName } = await request.json();
  const priceId = getPrice(product, reportType, env);
  if (!priceId) return json({ error: `No price for ${product}/${reportType}` }, 400);

  const knownBases = {
    check:  "https://crackedminds.co.uk/check/index.html",
    comply: "https://crackedminds.co.uk/comply/index.html",
    "land-registry": "https://crackedminds.co.uk/land-registry/index.html",
    vat:      "https://crackedminds.co.uk/vat/index.html",
    patent:   "https://crackedminds.co.uk/patent/index.html",
    packages: "https://crackedminds.co.uk/packages/index.html",
    pubmed:   "https://crackedminds.co.uk/pubmed/index.html",
    charity:  "https://crackedminds.co.uk/charity/index.html",
    arxiv:    "https://crackedminds.co.uk/arxiv/index.html",
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
  if (!res.ok) return json({ error: session.error?.message || "Stripe error" }, 500);
  return json({ url: session.url });
}

// ── Verify payment ────────────────────────────────────────────
async function verifyPayment(request, env, json) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  const session = await res.json();
  if (!res.ok) return json({ error: session.error?.message }, 500);

  return json({
    paid: session.payment_status === "paid" || session.status === "complete",
    company_number: session.metadata?.company_number || null,
    company_name:   session.metadata?.company_name   || null,
    report_type:    session.metadata?.report_type    || "one_off",
    product:        session.metadata?.product        || "check",
  });
}

// ── Send report email via Resend ──────────────────────────────
async function sendReport(request, env, json) {
  const { email, report, product } = await request.json();
  if (!email || !report) return json({ error: "email and report required" }, 400);

  const html = buildEmail(report, product);
  const name = report.company?.name || "Company";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Cracked Minds Check <reports@crackedminds.co.uk>",
      to: email,
      subject: `${name} - Due Diligence Report`,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) return json({ error: data.message || "Resend error" }, 500);
  return json({ sent: true });
}

// ── Email HTML builder ────────────────────────────────────────
function buildEmail(report, product) {
  const c = report.company;
  const risk = report.risk_assessment;
  const directors = (report.directors || []).filter(d => !d.resigned).slice(0, 8);
  const pscs = report.persons_with_significant_control || [];
  const charges = (report.charges || []).filter(ch => ch.status === "outstanding");
  const colour = risk.overall === "low" ? "#3B6D11" : risk.overall === "high" ? "#A32D2D" : "#854F0B";
  const bg     = risk.overall === "low" ? "#EAF3DE" : risk.overall === "high" ? "#FCEBEB" : "#FAEEDA";
  const accent = product === "comply" ? "#185FA5" : "#0d9488";
  const productName = product === "comply" ? "Comply" : "Check";

  const dirRows = directors.map(d =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${d.name}</td>
     <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;text-transform:capitalize">${d.role}</td>
     <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888">${d.appointed || "?"}</td></tr>`
  ).join("");

  const pscRows = pscs.slice(0,3).map(p =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${p.name}</td>
     <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888">${(p.natures_of_control || []).map(n => n.replace(/-/g," ")).join(", ")}</td>
     <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888">${p.notified_on || "?"}</td></tr>`
  ).join("");

  const flags = (risk.flags || []).map(f =>
    `<span style="display:inline-block;background:#FAEEDA;color:#854F0B;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${f}</span>`
  ).join("");

  const positives = (risk.positives || []).map(p =>
    `<span style="display:inline-block;background:#EAF3DE;color:#3B6D11;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${p}</span>`
  ).join("");

  const biz = (c.nature_of_business || []).join(" &middot; ");
  const pdfUrl = report.accounts_summary?.pdf_url || report._meta?.accounts_pdf_url;
  const conf = c.confirmation_statement || {};

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f3;margin:0;padding:24px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#0a0a08;padding:24px 32px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em">${productName} <span style="color:${accent}">&#10022;</span></div>
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
      <div style="font-size:13px;color:#888">No. ${c.number} &middot; <span style="background:${bg};color:${colour};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500">${(c.status||"").toUpperCase()}</span> &middot; Inc. ${c.incorporated || "?"}</div>
      ${c.address ? `<div style="font-size:13px;color:#888;margin-top:4px">${c.address}</div>` : ""}
    </div>

    ${biz ? `<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Nature of business</div><div style="font-size:13px;color:#555">${biz}</div></div>` : ""}

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
      <tr style="background:#f9f9f9">
        <td style="padding:9px 12px;color:#888">Last accounts</td><td style="padding:9px 12px">${report.filings?.latest_accounts_date || "?"}</td>
        <td style="padding:9px 12px;color:#888">Accounts overdue</td><td style="padding:9px 12px;color:${report.filings?.accounts_overdue ? "#A32D2D" : "#3B6D11"}">${report.filings?.accounts_overdue ? "Yes" : "No"}</td>
      </tr>
      <tr>
        <td style="padding:9px 12px;color:#888">Conf. statement due</td><td style="padding:9px 12px">${conf.next_due || "?"}</td>
        <td style="padding:9px 12px;color:#888">Conf. overdue</td><td style="padding:9px 12px;color:${conf.overdue ? "#A32D2D" : "#3B6D11"}">${conf.overdue ? "Yes" : "No"}</td>
      </tr>
      <tr style="background:#f9f9f9">
        <td style="padding:9px 12px;color:#888">Late filings</td><td style="padding:9px 12px">${report.filings?.late_filings_count || 0}</td>
        <td style="padding:9px 12px;color:#888">Registered charges</td><td style="padding:9px 12px">${charges.length} outstanding</td>
      </tr>
    </table>

    ${pscs.length ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Persons with significant control</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Name</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Control</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Notified</th>
      </tr></thead>
      <tbody>${pscRows}</tbody>
    </table>` : ""}

    ${dirRows ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Active directors</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Name</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Role</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Appointed</th>
      </tr></thead>
      <tbody>${dirRows}</tbody>
    </table>` : ""}

    ${flags ? `<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Risk flags</div><div style="margin-bottom:16px">${flags}</div>` : ""}
    ${positives ? `<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Positive indicators</div><div style="margin-bottom:20px">${positives}</div>` : ""}

    <div style="background:#f9f9f9;border-radius:8px;padding:18px 20px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">AI recommendation</div>
      <div style="font-size:14px;color:#555;line-height:1.75">${risk.recommendation || ""}</div>
    </div>

    ${pdfUrl ? `<div style="margin-bottom:20px"><a href="${pdfUrl}" style="color:${accent};font-size:13px">Download filed accounts PDF &rarr;</a></div>` : ""}

    <div style="border-top:1px solid #f0f0f0;padding-top:16px;font-size:12px;color:#aaa">
      Companies House (Crown copyright) &middot; Claude by Anthropic &middot;
      <a href="https://crackedminds.co.uk" style="color:#888;text-decoration:none">crackedminds.co.uk</a>
    </div>
  </div>
</div>
</body></html>`;
}
