const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const { session_id } = event.queryStringParameters || {};

  if (!session_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "session_id is required" })
    };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paid: session.payment_status === "paid",
        company_number: session.metadata?.company_number || null,
        company_name: session.metadata?.company_name || null,
        report_type: session.metadata?.report_type || "one_off"
      })
    };
  } catch (err) {
    console.error("Stripe verify error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
