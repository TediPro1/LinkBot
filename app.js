const express = require('express');
const fs = require('fs');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
app.use(express.json());

// ENV VARIABLES
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || 'YOUR_GUILD_ID';
const LINKED_ROLE_ID = process.env.LINKED_ROLE_ID || 'YOUR_LINKED_ROLE_ID';
const PLAYING_ROLE_ID = process.env.PLAYING_ROLE_ID || 'YOUR_PLAYING_ROLE_ID';
const CHANNEL_ID = process.env.CHANNEL_ID || 'YOUR_CHANNEL_ID';
const PORT = process.env.PORT || 3000;
const MINECRAFT_ENDPOINT = process.env.MCPIPE;

// DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

// LINKED USER MAPS
const LINKED_USERS_FILE = 'linked_users.json';
let linkedUsers = {
  mcToDiscord: {},  // "Steve" -> "123456789012345678"
  discordToMc: {}   // "123456789012345678" -> "Steve"
};

function saveLinks() {
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linkedUsers, null, 2));
}

function loadLinks() {
  try {
    if (fs.existsSync(LINKED_USERS_FILE)) {
      const raw = fs.readFileSync(LINKED_USERS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);

      // Safeguard against malformed structure
      linkedUsers.mcToDiscord = parsed.mcToDiscord || {};
      linkedUsers.discordToMc = parsed.discordToMc || {};
    }
  } catch (err) {
    console.error('❌ Failed to load linked_users.json:', err);
  }
}
loadLinks();

// 🔗 Link a Minecraft user to Discord
app.post('/link-player', async (req, res) => {
  const { mc_username, discord_id } = req.body;
  if (!mc_username || !discord_id) {
    return res.status(400).json({ error: 'Missing mc_username or discord_id' });
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);

    await member.roles.add(LINKED_ROLE_ID);
    linkedUsers.mcToDiscord[mc_username] = discord_id;
    linkedUsers.discordToMc[discord_id] = mc_username;
    saveLinks();

    console.log(`[LINK] ${mc_username} ⇄ ${member.user.tag}`);
    res.json({ success: true });
  } catch (err) {
    console.error('link-player error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🎮 Player joins Minecraft
app.post('/player-join', async (req, res) => {
  const { mc_username, discord_id } = req.body;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);

    // Ensure user is linked
    if (!linkedUsers.mcToDiscord[mc_username]) {
      linkedUsers.mcToDiscord[mc_username] = discord_id;
      linkedUsers.discordToMc[discord_id] = mc_username;
      saveLinks();
    }

    await member.roles.add(PLAYING_ROLE_ID);

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`▶️ **${member.displayName}** (*${mc_username}*) joined the Minecraft server!`);

    res.sendStatus(200);
  } catch (err) {
    console.error('player-join error:', err);
    res.sendStatus(500);
  }
});

// ❌ Player leaves Minecraft
app.post('/player-leave', async (req, res) => {
  const { mc_username } = req.body;
  const discord_id = linkedUsers.mcToDiscord[mc_username];
  if (!discord_id) return res.sendStatus(404);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);

    await member.roles.remove(PLAYING_ROLE_ID);

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`⏹️ **${member.displayName}** (*${mc_username}*) left the Minecraft server.`);

    res.sendStatus(200);
  } catch (err) {
    console.error('player-leave error:', err);
    res.sendStatus(500);
  }
});

// 💬 Minecraft chat → Discord
app.post('/mc-chat', async (req, res) => {
  const { username, message } = req.body;
  let nameToShow = username;

  try {
    const discord_id = linkedUsers.mcToDiscord[username];
    if (discord_id) {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(discord_id);
      nameToShow = member.displayName || member.user.username;
    }
  } catch (err) {
    console.warn(`Could not fetch Discord name for ${username}`);
  }

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`<${nameToShow}> ${message}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('mc-chat error:', err);
    res.sendStatus(500);
  }
});

// 💬 Discord chat → Minecraft (bot should forward this to your Minecraft server via WebSocket or pipe)
client.on('messageCreate', async (msg) => {
  // Ignore bot messages
  if (msg.author.bot) return;

  // Only handle messages in the specified channel
  if (msg.channel.id !== DISCORD_CHANNEL_ID) return;

  // Only forward messages from users with the linked role
  if (!msg.member.roles.cache.has(LINKED_ROLE_ID)) return;

  // Get linked MC name if available
  const mcUsername = linkedUsers.discordToMc[msg.author.id] || msg.author.username;

  // Payload to send to Minecraft
  const payload = {
    discord_id: msg.author.id,
    message: `<${mcUsername}> ${msg.content}`
  };

  try {
    await axios.post(MINECRAFT_ENDPOINT, payload);
    console.log(`[Discord → Minecraft] ${payload.message}`);
  } catch (err) {
    console.error('❌ Failed to send message to Minecraft:', err.message);
  }
});

// ✅ Health check
app.get('/ping', (req, res) => res.send('pong'));

// 🟢 Start bot
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));
