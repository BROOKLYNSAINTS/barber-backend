// api/setup-cancel.js

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

        <title>Payment Setup Incomplete</title>

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

          h1 {
            font-size: 28px;
            margin-bottom: 16px;
          }

          p {
            font-size: 18px;
            line-height: 1.5;
            color: #555;
          }
        </style>
      </head>

      <body>
        <div class="container">

          <h1>Payment Setup Not Completed</h1>

          <p>
            Your payment method was not saved.
          </p>

          <p>
            You can return to the secure payment link in your text message
            and try again.
          </p>

          <p>
            No appointment has been booked yet.
          </p>

        </div>
      </body>
    </html>
  `);
}