// api/setup-success.js

export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>Payment Setup Complete</title>

        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            background: #f4f4f4;
            color: #222;
          }

          .container {
            max-width: 520px;
            margin: 80px auto;
            padding: 40px 28px;
            background: white;
            border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.08);
            text-align: center;
          }

          .check {
            font-size: 64px;
            margin-bottom: 20px;
          }

          h1 {
            font-size: 28px;
            margin-bottom: 16px;
          }

          p {
            font-size: 18px;
            line-height: 1.5;
            color: #555;
          }

          .small {
            margin-top: 30px;
            font-size: 14px;
            color: #777;
          }
        </style>
      </head>

      <body>
        <div class="container">

          <div class="check">✓</div>

          <h1>Payment Method Saved</h1>

          <p>
            Your payment method was successfully added to your account.
          </p>

          <p>
            You may now close this page.
          </p>

          <p>
            Once your account setup is complete, you can call the barber shop
            again to book your appointment.
          </p>

          <div class="small">
            Your card information is securely handled by Stripe.
          </div>

        </div>
      </body>
    </html>
  `);
}