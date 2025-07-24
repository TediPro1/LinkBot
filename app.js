const express = require('express');
const fs = require('fs');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const path = require('path');

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

app.get('/linked_users.json', (req, res) => {
  const filePath = path.join(__dirname, LINKED_USERS_FILE); // Assumes LINKED_USERS_FILE is in the same dir as this script

  // Optional: Check if file exists, though if saveLinks() creates it, it should exist.
  // fs.existsSync(filePath) can be used here.

  // Check if file exists and is accessible
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`[HTTP GET] File not found or not accessible: ${filePath}`, err);
      return res.status(404).json({ error: 'Linked users file not found on server.' });
    }

    // Set content type to application/json
    res.setHeader('Content-Type', 'application/json');

    // Send the file
    res.sendFile(filePath, (fileErr) => {
      if (fileErr) {
        console.error(`[HTTP GET] Error sending file ${filePath}:`, fileErr);
        // Avoid sending another response if headers already sent
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Failed to send linked users file.' });
        }
      } else {
        console.log(`[HTTP GET] Sent ${LINKED_USERS_FILE} to a client.`);
      }
    });
  });
});

app.post('/link-player', async (req, res) => {
  // Assuming req.body is now correctly populated with mc_username and discord_id
  const { mc_username, discord_id } = req.body;

  if (!mc_username || !discord_id) {
    // This we are trying to fix with body parsing
    return res.status(400).json({ error: 'Missing mc_username or discord_id' });
  }

  try {
    // 1. Fetch the Guild
    console.log(`[LINK] Attempting to fetch guild: ${GUILD_ID}`);
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) {
      console.error(`[LINK] Failed to fetch guild with ID: ${GUILD_ID}`);
      return res.status(500).json({ error: 'Could not find configured guild on the bot.' });
    }
    console.log(`[LINK] Successfully fetched guild: ${guild.name}`);

    // 2. Fetch the Member
    console.log(`[LINK] Attempting to fetch member: ${discord_id} in guild ${guild.name}`);
    const member = await guild.members.fetch(discord_id); // This can throw an error if user not in guild
    if (!member) {
      // This case might not be hit if guild.members.fetch throws for unknown member
      console.error(`[LINK] Failed to fetch member with Discord ID: ${discord_id}`);
      return res.status(404).json({ error: 'Discord user not found in the guild.' });
    }
    console.log(`[LINK] Successfully fetched member: ${member.user.tag}`);

    // 3. Add the Role
    console.log(`[LINK] Attempting to add role: ${LINKED_ROLE_ID} to member ${member.user.tag}`);
    await member.roles.add(LINKED_ROLE_ID); // This can throw if role ID is invalid or bot lacks permissions
    console.log(`[LINK] Successfully added role ${LINKED_ROLE_ID} to ${member.user.tag}`);

    // 4. Update and Save Links
    linkedUsers.mcToDiscord[mc_username] = discord_id;
    linkedUsers.discordToMc[discord_id] = mc_username;
    saveLinks(); // Ensure this doesn't throw unhandled errors

    console.log(`[LINK] ${mc_username} ⇄ ${member.user.tag}`);
    res.json({ success: true, message: `Linked ${mc_username} to ${member.user.tag} and assigned role.` });

  } catch (err) {
    console.error(`[LINK] Error in /link-player for MC: ${mc_username}, Discord ID: ${discord_id}:`, err);
    // Specific error handling based on Discord.js error codes
    if (err.code === 10013) { // Unknown User
        return res.status(404).json({ error: `Discord user with ID ${discord_id} does not exist.` });
    } else if (err.code === 10007) { // Unknown Member
        return res.status(404).json({ error: `Discord user with ID ${discord_id} is not a member of the configured guild.` });
    } else if (err.code === 50013) { // Missing Permissions
        console.error(`[LINK] Missing permissions to add role ${LINKED_ROLE_ID}. Bot's highest role needs to be above this role, and bot needs 'Manage Roles' permission.`);
        return res.status(500).json({ error: 'Bot lacks permissions to assign the role.' });
    } else if (err.code === 50028 || err.message.includes('Invalid Form Body') && err.message.includes('roles')) { // Invalid Role
        console.error(`[LINK] The role ID ${LINKED_ROLE_ID} is invalid or does not exist.`);
        return res.status(500).json({ error: `The linked role ID (${LINKED_ROLE_ID}) is invalid.` });
    }
    res.status(500).json({ error: 'An internal error occurred while trying to link the player.', details: err.message });
  }
});

// 🎮 Player joins Minecraft
app.post('/player-join', async (req, res) => {
  const { mc_username } = req.body; // MODIFIED: Only expect mc_username from mod

  if (!mc_username) {
    console.log('[JOIN] Received /player-join without mc_username.');
    return res.status(400).json({ error: 'Missing mc_username' });
  }

  console.log(`[JOIN] Received /player-join for MC User: ${mc_username}`);
  let announcementMessage = `▶️ **${mc_username}** joined the server!`;
  const discord_id = linkedUsers.mcToDiscord[mc_username]; // Try to find linked Discord ID

  try {
    const channel = await client.channels.fetch(CHANNEL_ID); // Fetch channel first

    if (discord_id) {
      console.log(`[JOIN] ${mc_username} is linked to Discord ID: ${discord_id}. Attempting to manage roles and get display name.`);
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discord_id);

        if (member) {
          await member.roles.add(PLAYING_ROLE_ID);
          console.log(`[JOIN] Added PLAYING_ROLE_ID to ${member.user.tag} (${mc_username})`);
          // Update announcement message with Discord display name
          announcementMessage = `▶️ **${member.displayName}** (*${mc_username}*) joined the server!`;
        } else {
          console.log(`[JOIN] Could not fetch member for Discord ID: ${discord_id} (linked to ${mc_username}). Role not assigned.`);
        }
      } catch (memberError) {
        console.error(`[JOIN] Error managing roles or fetching member for ${mc_username} (Discord ID ${discord_id}):`, memberError.message);
        // Continue to send a basic join message even if role assignment fails
      }
    } else {
      console.log(`[JOIN] ${mc_username} is not linked to a Discord account. Sending generic join message.`);
    }

    // Send the announcement message (either generic or with Discord display name)
    if (channel) {
      await channel.send(announcementMessage);
      console.log(`[JOIN] Sent join announcement for ${mc_username} to Discord.`);
    } else {
      console.error(`[JOIN] Channel with ID ${CHANNEL_ID} not found. Cannot send announcement.`);
    }

    res.status(200).send('Join event processed.');
  } catch (err) {
    console.error('[JOIN] Outer error processing player-join for ' + mc_username + ':', err.message);
    res.status(500).send('Error processing join event.');
  }
});

// ❌ Player leaves Minecraft - REMAINS LARGELY THE SAME (as it already primarily used mc_username)
app.post('/player-leave', async (req, res) => {
  const { mc_username } = req.body;
  if (!mc_username) {
    console.log('[LEAVE] Received /player-leave without mc_username.');
    return res.status(400).json({ error: 'Missing mc_username' });
  }

  console.log(`[LEAVE] Received /player-leave for MC User: ${mc_username}`);
  const discord_id = linkedUsers.mcToDiscord[mc_username]; // Try to find linked Discord ID

  // Default announcement
  let announcementMessage = `⏹️ **${mc_username}** left the server.`;

  if (!discord_id) {
    console.log(`[LEAVE] ${mc_username} is not linked. Sending generic leave message.`);
    // Proceed to send the generic message
  }

  try {
    const channel = await client.channels.fetch(CHANNEL_ID); // Fetch channel

    if (discord_id) {
      console.log(`[LEAVE] ${mc_username} is linked to Discord ID: ${discord_id}. Attempting to manage roles and get display name.`);
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discord_id);

        if (member) {
          await member.roles.remove(PLAYING_ROLE_ID);
          console.log(`[LEAVE] Removed PLAYING_ROLE_ID from ${member.user.tag} (${mc_username})`);
          announcementMessage = `⏹️ **${member.displayName}** (*${mc_username}*) left the server.`;
        } else {
          console.log(`[LEAVE] Could not fetch member for Discord ID: ${discord_id} (linked to ${mc_username}). Role not removed (likely already gone or member left guild).`);
        }
      } catch (memberError) {
        console.error(`[LEAVE] Error managing roles or fetching member for ${mc_username} (Discord ID ${discord_id}):`, memberError.message);
        // Continue to send a leave message even if role removal fails
      }
    }

    // Send the announcement message
    if (channel) {
      await channel.send(announcementMessage);
      console.log(`[LEAVE] Sent leave announcement for ${mc_username} to Discord.`);
    } else {
      console.error(`[LEAVE] Channel with ID ${CHANNEL_ID} not found. Cannot send announcement.`);
    }
    res.status(200).send('Leave event processed.');
  } catch (err) {
    console.error('[LEAVE] Outer error processing player-leave for ' + mc_username + ':', err.message);
    res.status(500).send('Error processing leave event.');
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
  if (msg.channel.id !== CHANNEL_ID) return;

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
