const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function riskColour(level) {
  return level === "low" ? "#3B6D11" : level === "high" ? "#A32D2D" : "#854F0B";
}

function riskBg(level) {
  return level === "low" ? "#EAF3DE" : level === "high" ? "#FCEBEB" : "#FAEEDA";
}

function buildEmail(report, product) {
  const c = report.company;
  const risk = report.risk_assessment;
  const directors = (report.directors || []).filter(d => !d.resigned).slice(0, 6);
  const colour = riskColour(risk.overall);
  const bg = riskBg(risk.overall);
  const productName = product === "comply" ? "Comply" : "Check";
  const productColour = product === "comply" ? "#185FA5" : "#0d9488";

  const directorRows = directors.map(d =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${d.name}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;text-transform:capitalize">${d.role}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888">${d.appointed || "—"}</td></tr>`
  ).join("");

  const flags = (risk.flags || []).map(f =>
    `<span style="display:inline-block;background:#FAEEDA;color:#854F0B;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${f}</span>`
  ).join("");

  const positives = (risk.positives || []).map(p =>
    `<span style="display:inline-block;background:#EAF3DE;color:#3B6D11;font-size:12px;padding:3px 10px;border-radius:4px;margin:3px">${p}</span>`
  ).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f3;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <div style="background:#0a0a08;padding:24px 32px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em">${productName} <span style="color:${productColour}">✦</span></div>
      <div style="color:#8a8880;font-size:13px;margin-top:2px">by Cracked Minds</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:36px;font-weight:700;color:${colour};line-height:1">${risk.score}</div>
      <div style="font-size:11px;color:#8a8880;text-transform:uppercase;letter-spacing:0.06em">${risk.overall} risk</div>
    </div>
  </div>

  <div style="padding:24px 32px">

    <div style="margin-bottom:24px">
      <div style="font-size:22px;font-weight:600;color:#111;margin-bottom:4px">${c.name}</div>
      <div style="font-size:13px;color:#888">Company No. ${c.number} &nbsp;·&nbsp;
        <span style="background:${bg};color:${colour};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500">${c.status.toUpperCase()}</span>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#f9f9f9">
        <td style="padding:10px 12px;font-size:13px;color:#888;font-weight:500">Type</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right">${c.type || "—"}</td>
        <td style="padding:10px 12px;font-size:13px;color:#888;font-weight:500">Incorporated</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right">${c.incorporated || "—"}</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:13px;color:#888;font-weight:500">Address</td>
        <td colspan="3" style="padding:10px 12px;font-size:13px">${c.address || "—"}</td>
      </tr>
      <tr style="background:#f9f9f9">
        <td style="padding:10px 12px;font-size:13px;color:#888;font-weight:500">Last accounts</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right">${report.filings.latest_accounts_date || "—"}</td>
        <td style="padding:10px 12px;font-size:13px;color:#888;font-weight:500">Late filings</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right">${report.filings.late_filings_count || 0}</td>
      </tr>
    </table>

    ${directors.length ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Active directors</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Name</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Role</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Appointed</th>
      </tr></thead>
      <tbody>${directorRows}</tbody>
    </table>` : ""}

    ${flags ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Risk flags</div>
    <div style="margin-bottom:16px">${flags}</div>` : ""}

    ${positives ? `
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Positive indicators</div>
    <div style="margin-bottom:20px">${positives}</div>` : ""}

    <div style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">AI recommendation</div>
      <div style="font-size:14px;color:#555;line-height:1.75">${risk.recommendation || ""}</div>
    </div>

    <div style="border-top:1px solid #f0f0f0;padding-top:16px;font-size:12px;color:#aaa">
      Data sourced from Companies House (Crown copyright) · AI analysis by Claude (Anthropic) ·
      <a href="https://crackedminds.co.uk" style="color:#888;text-decoration:none">crackedminds.co.uk</a>
    </div>
  </div>
</div>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const { email, report, product } = JSON.parse(event.body);
    if (!email || !report) {
      return { statusCode: 400, body: JSON.stringify({ error: "email and report are required" }) };
    }

    const companyName = report.company?.name || "Company";
    const html = buildEmail(report, product || "check");
    const productName = product === "comply" ? "Comply" : "Check";

    await resend.emails.send({
      from: "Cracked Minds Check <reports@crackedminds.co.uk>",
      to: email,
      subject: `${companyName} — Due Diligence Report`,
      html
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent: true })
    };
  } catch (err) {
    console.error("Send report error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
