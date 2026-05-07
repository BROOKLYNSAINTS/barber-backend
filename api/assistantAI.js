import OpenAI from "openai";
import { handleAction } from "./assistantActions.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function runAssistant(input) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are an AI receptionist for a barber shop."
      },
      {
        role: "user",
        content: input.message
      }
    ]
  });

  return {
    reply: completion.choices[0].message.content
  };

}