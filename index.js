import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Configure OpenAI (DeepSeek R1 Zero via OpenRouter)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Load from .env
  baseURL: 'https://openrouter.ai/api/v1',
});

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  let loadingMessage = null;

  try {
    // Read SQL query prompt from file
    const promptPath = path.join(process.cwd(), 'prompts', 'sqlQueryPrompt.txt');
    const query = await fs.readFile(promptPath, 'utf8');

    const cleanedContent = message.content.replace(/<@\d+>/g, "").trim();
    if (!cleanedContent) return;

    console.log("🔹 Question:", query + cleanedContent);

    try {
      // Send the initial loading message with retry logic
      for (let attempts = 0; attempts < 3; attempts++) {
        try {
          loadingMessage = await message.reply("💭 Thinking...");
          break; // Break out of the retry loop if successful
        } catch (replyError) {
          console.error(`❌ Error sending initial reply (attempt ${attempts + 1}/3):`, replyError);
          if (attempts === 2) { // If this was the last attempt
            console.error("❌ Failed to send initial reply after multiple attempts");
            return; // Exit the handler entirely
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      let content;
      let success = false;
      let retries = 0;
      const MAX_RETRIES = 3;

      // Retry mechanism: keep trying until the answer is valid or max retries reached
      while (!success && retries < MAX_RETRIES) {
        try {
          const completion = await openai.chat.completions.create({
            model: "google/gemma-3-27b-it:free",
            messages: [
              { role: "user", content: query + cleanedContent },
            ],
          });

          content = completion.choices[0].message.content;

          // Only try to edit if loadingMessage was successfully created
          if (loadingMessage) {
            await loadingMessage.edit(content);
          } else {
            // Fallback if we couldn't send the loading message
            await message.channel.send(content);
          }
          success = true;  // Exit loop if the response is successful
        } catch (error) {
          retries++;
          console.error(`❌ Error in OpenAI request, retry ${retries}/${MAX_RETRIES}:`, error);
          
          // Only try to edit if loadingMessage exists
          if (loadingMessage) {
            try {
              await loadingMessage.edit(`⚠️ Something went wrong, retrying (${retries}/${MAX_RETRIES})...`);
            } catch (editError) {
              console.error("❌ Failed to edit loading message:", editError);
            }
          }
          
          // Wait for a short time before retrying
          await new Promise(resolve => setTimeout(resolve, 3000 * retries)); // Increasing delay for each retry
        }
      }

      // Handle the case where all retries failed
      if (!success) {
        const errorMessage = "Sorry, I'm having trouble connecting to my services right now. Please try again later.";
        try {
          if (loadingMessage) {
            await loadingMessage.edit(errorMessage);
          } else {
            await message.channel.send(errorMessage);
          }
        } catch (finalError) {
          console.error("❌ Failed to send final error message:", finalError);
        }
      }
    } catch (error) {
      console.error("❌ Error in messageCreate handler:", error);
      try {
        // Check if we can reply directly to the original message as a fallback
        if (loadingMessage) {
          await loadingMessage.edit("⚠️ Something went wrong, but I'm still alive!");
        } else {
          await message.channel.send("⚠️ Something went wrong, but I'm still alive!");
        }
      } catch (err) {
        console.error("❌ Failed to send any error reply:", err);
      }
    }
  } catch (fileError) {
    console.error("❌ Error reading prompt file:", fileError);
    try {
      await message.reply("⚠️ Error loading SQL prompt file. Please contact the administrator.");
    } catch (replyError) {
      console.error("❌ Failed to send file error reply:", replyError);
    }
  }
});

// Handle unhandled promise rejections globally
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN); // Load from .env
