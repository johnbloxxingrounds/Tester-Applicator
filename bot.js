// bot.js
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");

// ========== CONFIG ==========
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;           // Your bot token
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;       // Your Apps Script Web App URL
const VOTE_CHANNEL_ID = "1476702659653275718";             // Discord channel ID for applications
const REQUIRED_VOTES = 5;                                   // Votes required to accept/deny
const POLL_INTERVAL = 15000;                                // Polling interval in ms
const BOT_SECRET = process.env.BOT_SECRET || "supersecret"; // Secret to authenticate Apps Script

// ========== STATE ==========
const voteTracker = new Map(); // Tracks votes per message

// ========== CLIENT ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ========== HELPERS ==========

// Extract the sheet row number from an embed footer
function extractRow(message) {
  const embed = message.embeds?.[0];
  if (!embed?.footer?.text) return null;
  const match = embed.footer.text.match(/Sheet Row #(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// Submit a decision (Accepted / Denied / Posted) back to Apps Script
async function submitDecision(row, decision, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET, row, decision })
    });
    const json = await res.json();
    console.log(`Row #${row} updated: ${decision}`, json);

    if (message && (decision === "Accepted" || decision === "Denied")) {
      const emoji = decision === "Accepted" ? "✅" : "❌";
      await message.reply(`${emoji} **${decision}** — Row #${row} updated.`);
    }
  } catch (err) {
    console.error("Failed to update sheet:", err);
  }
}

// Poll Apps Script for new applications
async function pollSheet() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: BOT_SECRET })
    });

    const data = await res.json();
    if (!data || !data.row) return; // No new submissions

    // Prepare fields for Discord embed
    const fields = data.fields.map(f => ({
      name: f.name,
      value: String(f.value || "N/A").substring(0, 1024),
      inline: !!f.inline
    }));

    const embed = new EmbedBuilder()
      .setTitle("📋 New Tester Application")
      .setColor(0x5865F2)
      .setFooter({ text: `Sheet Row #${data.row} • React below to vote` })
      .setTimestamp()
      .addFields(fields);

    const channel = await client.channels.fetch(VOTE_CHANNEL_ID);
    const msg = await channel.send({ embeds: [embed] });
    await msg.react("✅");
    await msg.react("❌");

    // Immediately mark the row as Posted
    await submitDecision(data.row, "Posted");
  } catch (err) {
    console.error("Polling error:", err);
  }
}

// ========== REACTION HANDLING ==========

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot || reaction.message.channelId !== VOTE_CHANNEL_ID) return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const message = reaction.message;
  const emoji = reaction.emoji.name;
  const messageId = message.id;
  const row = extractRow(message);
  if (!row) return;

  if (!voteTracker.has(messageId)) voteTracker.set(messageId, { approve: new Set(), deny: new Set(), row });

  const votes = voteTracker.get(messageId);
  if (emoji === "✅") { votes.deny.delete(user.id); votes.approve.add(user.id); }
  if (emoji === "❌") { votes.approve.delete(user.id); votes.deny.add(user.id); }

  console.log(`Row ${row} — Approve: ${votes.approve.size}, Deny: ${votes.deny.size}`);

  if (votes.approve.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Accepted", message);
  } else if (votes.deny.size >= REQUIRED_VOTES) {
    voteTracker.delete(messageId);
    await submitDecision(row, "Denied", message);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot || reaction.message.channelId !== VOTE_CHANNEL_ID) return;

  if (reaction.partial) await reaction.fetch();

  const votes = voteTracker.get(reaction.message.id);
  if (!votes) return;

  if (reaction.emoji.name === "✅") votes.approve.delete(user.id);
  if (reaction.emoji.name === "❌") votes.deny.delete(user.id);
});

// ========== BOT START ==========

client.once("ready", () => {
  console.log("Bot online as " + client.user.tag);
  setInterval(pollSheet, POLL_INTERVAL); // start polling every POLL_INTERVAL
});

client.login(DISCORD_TOKEN).catch(err => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
