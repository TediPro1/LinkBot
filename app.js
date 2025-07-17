const express = require('express');
const fs = require('fs');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
app.use(express.json());

// ENV VARIABLES
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || 'YOUR_GUILD_ID';
const LINKED_ROLE_ID = process.env.LINKED_ROLE_ID || 'YOUR_LINKED_ROLE_ID';
const PLAYING_ROLE_ID = process.env.PLAYING_ROLE_ID || 'YOUR_PLAYING_ROLE_ID';
const CHANNEL_ID = process.env.CHANNEL_ID || 'YOUR_CHANNEL_ID';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

const LINKED_USERS_FILE = 'linked_users.json';
let linkedUsers = {};

function saveLinks() {
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linkedUsers, null, 2));
}

function loadLinks() {
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linkedUsers = JSON.parse(fs.readFileSync(LINKED_USERS_FILE));
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
    linkedUsers[mc_username] = discord_id;
    saveLinks();

    console.log(`[LINK] ${mc_username} ⇄ ${discord_id}`);
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

    if (!linkedUsers[mc_username]) {
      linkedUsers[mc_username] = discord_id;
      saveLinks();
    }

    await member.roles.add(PLAYING_ROLE_ID);

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`▶️ **${mc_username}** joined the Minecraft server!`);

    res.sendStatus(200);
  } catch (err) {
    console.error('player-join error:', err);
    res.sendStatus(500);
  }
});

// ❌ Player leaves Minecraft
app.post('/player-leave', async (req, res) => {
  const { mc_username } = req.body;
  const discord_id = linkedUsers[mc_username];
  if (!discord_id) return res.sendStatus(404);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);

    await member.roles.remove(PLAYING_ROLE_ID);

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`⏹️ **${mc_username}** left the Minecraft server.`);

    res.sendStatus(200);
  } catch (err) {
    console.error('player-leave error:', err);
    res.sendStatus(500);
  }
});

// 💬 Minecraft chat relay
app.post('/mc-chat', async (req, res) => {
  const { username, message } = req.body;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(`<${username}> ${message}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('mc-chat error:', err);
    res.sendStatus(500);
  }
});

// ✅ Health check
app.get('/ping', (req, res) => res.send('pong'));

// 🟢 Start bot
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
app.listen(3000, () => console.log('🌐 Express server running on port 3000'));
