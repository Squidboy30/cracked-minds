const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  check: {
    one_off:      process.env.STRIPE_PRICE_CHECK_SINGLE,
    subscription: process.env.STRIPE_PRICE_CHECK_PRO,
  },
  comply: {
    one_off:      process.env.STRIPE_PRICE_COMPLY_SINGLE,
    subscription: process.env.STRIPE_PRICE_COMPLY_PRO,
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const { product, reportType, companyNumber, companyName } = JSON.parse(event.body);

    const priceId = PRICES[product]?.[reportType];
    if (!priceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `No price found for product=${product} type=${reportType}` })
      };
    }

    const successBase = product === "comply"
      ? "https://crackedminds.co.uk/comply/index.html"
      : "https://crackedminds.co.uk/check/index.html";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: reportType === "subscription" ? "subscription" : "payment",
      success_url: `${successBase}?success=true&session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(companyNumber || "")}`,
      cancel_url: `${successBase}?ref=${encodeURIComponent(companyNumber || "")}`,
      metadata: {
        company_number: companyNumber || "",
        company_name:   companyName  || "",
        report_type:    reportType   || "one_off",
        product:        product      || "check"
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("Stripe error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
