const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { priceId, companyNumber, companyName, reportType } = JSON.parse(event.body);

    if (!priceId || !companyNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "priceId and companyNumber are required" })
      };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: reportType === "subscription" ? "subscription" : "payment",
      success_url: `https://check.crackedminds.co.uk/?success=true&session_id={CHECKOUT_SESSION_ID}&company=${encodeURIComponent(companyNumber)}`,
      cancel_url: `https://check.crackedminds.co.uk/?company=${encodeURIComponent(companyNumber)}`,
      metadata: {
        company_number: companyNumber,
        company_name: companyName || "",
        report_type: reportType || "one_off"
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("Stripe error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
