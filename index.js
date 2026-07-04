// =========================
// WhiteCastle Restaurant RBLX Support Bot
// Discord.js v14 + Express keep-alive
// =========================

require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// =========================
// Simple in-memory stores
// =========================

const tickets = new Map();       // userId -> { channelId, initialMessage, messages: [], claimedBy, escalatedTo }
const pastTickets = new Map();   // userId -> [channelName]
const snippets = new Map();      // name -> content

// =========================
// Ready
// =========================

client.once('ready', () => {
    console.log(`WhiteCastle Restaurant RBLX Support Bot is online as ${client.user.tag}`);
});

// =========================
// Helper: get main guild
// =========================

function getMainGuild() {
    return client.guilds.cache.get(process.env.GUILD_ID);
}

// =========================
// Message Create
// =========================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // DM flow
    if (message.channel.type === 1) {
        await handleDM(message);
        return;
    }

    // Guild commands
    if (!message.content.startsWith('.')) return;

    const args = message.content.slice(1).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    switch (command) {
        case 'help':
            return handleHelp(message);
        case 'reply':
            return handleReply(message, args);
        case 'claim':
            return handleClaim(message);
        case 'unclaim':
            return handleUnclaim(message);
        case 'close':
            return handleClose(message);
        case 'snippet':
            return handleSnippet(message, args);
        case 'escalate':
            return handleEscalate(message, args);
        default:
            break;
    }
});

// =========================
// DM Handler
// =========================

async function handleDM(message) {
    const userId = message.author.id;
    const content = message.content || '[No content]';

    // react green
    try {
        await message.react('✅');
    } catch {}

    let ticket = tickets.get(userId);

    // if no ticket yet, ask to confirm
    if (!ticket) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_confirm')
                .setLabel('✔️ Confirm')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket_cancel')
                .setLabel('✖️ Cancel')
                .setStyle(ButtonStyle.Danger)
        );

        const starterEmbed = new EmbedBuilder()
            .setTitle('Open a Support Ticket?')
            .setColor(0x0000FF)
            .setDescription('Press ✔️ to open a ticket or ✖️ to cancel.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        const starterMsg = await message.channel.send({
            embeds: [starterEmbed],
            components: [row]
        });

        tickets.set(userId, {
            channelId: null,
            initialMessage: content,
            messages: [],
            claimedBy: null,
            escalatedTo: null,
            starterMessageId: starterMsg.id
        });

        return;
    }

    // if ticket exists and channel is set, relay DM to staff channel
    if (ticket.channelId) {
        const guild = getMainGuild();
        if (!guild) return;

        const supportChannel = guild.channels.cache.get(ticket.channelId);
        if (!supportChannel) return;

        ticket.messages.push({
            from: 'user',
            content,
            timestamp: Date.now()
        });

        const relayEmbed = new EmbedBuilder()
            .setTitle('New Message from User')
            .setColor(0x0000FF)
            .addFields(
                { name: 'User', value: `${message.author.username} (${message.author.id})`, inline: false },
                { name: 'Message', value: content, inline: false }
            )
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        await supportChannel.send({ embeds: [relayEmbed] });
    }
}

// =========================
// Interaction Create (Buttons)
// =========================

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const userId = interaction.user.id;
    const ticket = tickets.get(userId);

    if (!ticket) return;

    if (customId === 'ticket_cancel') {
        tickets.delete(userId);
        await interaction.update({
            content: 'Your ticket has been canceled.',
            embeds: [],
            components: []
        });
        return;
    }

    if (customId === 'ticket_confirm') {
        const guild = getMainGuild();
        if (!guild) {
            await interaction.update({
                content: 'Support server not found. Please try again later.',
                embeds: [],
                components: []
            });
            return;
        }

        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;

        const channelName = `support-${user.username}`;
        const supportChannel = await guild.channels.create({
            name: channelName,
            type: 0,
            parent: process.env.SUPPORT_CATEGORY_ID,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: process.env.SUPPORT_ROLE_ID,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ]
        });

        // past tickets
        const history = pastTickets.get(userId) || [];
        const pastText = history.length
            ? `Past Tickets Created:\n${history.map(n => `- ${n}`).join('\n')}`
            : 'Past Tickets Created:\nNone';

        const infoEmbed = new EmbedBuilder()
            .setTitle('New Support Ticket')
            .setColor(0x0000FF)
            .addFields(
                { name: 'User', value: `${user.username}`, inline: true },
                { name: 'User ID', value: `${user.id}`, inline: true },
                { name: 'Initial Message', value: ticket.initialMessage, inline: false },
                { name: 'History', value: pastText, inline: false }
            )
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        await supportChannel.send({
            content: `<@&${process.env.SUPPORT_ROLE_ID}>`,
            embeds: [infoEmbed]
        });

        ticket.channelId = supportChannel.id;
        history.push(channelName);
        pastTickets.set(userId, history);

        await interaction.update({
            content: 'Your ticket has been created. A staff member will contact you shortly.',
            embeds: [],
            components: []
        });
    }
});

// =========================
/* Commands */
// =========================

async function handleHelp(message) {
    const helpEmbed = new EmbedBuilder()
        .setTitle('WhiteCastle Support Commands')
        .setColor(0x0000FF)
        .setDescription([
            '**.help** - Show this list',
            '**.reply <message>** - Reply to the ticket user',
            '**.claim** - Claim the ticket',
            '**.unclaim** - Unclaim the ticket',
            '**.close** - Close the ticket and generate transcript',
            '**.snippet add <name>** - Add a snippet (next message)',
            '**.snippet edit <name>** - Edit a snippet (next message)',
            '**.snippet remove <name>** - Remove a snippet',
            '**.snippet list** - List all snippets',
            '**.snippet <name>** - Send a snippet',
            '**.escalate ticket pr** - Escalate to PR',
            '**.escalate ticket staffing** - Escalate to Staffing'
        ].join('\n'))
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    await message.channel.send({ embeds: [helpEmbed] });
}

function getTicketByChannel(channelId) {
    for (const [userId, ticket] of tickets.entries()) {
        if (ticket.channelId === channelId) return { userId, ticket };
    }
    return null;
}

async function handleReply(message, args) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { userId, ticket } = data;
    const replyText = args.join(' ');
    if (!replyText) return;

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    ticket.messages.push({
        from: 'staff',
        content: replyText,
        timestamp: Date.now()
    });

    const staffEmbed = new EmbedBuilder()
        .setTitle('Reply Sent to User')
        .setColor(0x0000FF)
        .addFields(
            { name: 'Staff', value: `${message.author.username}`, inline: true },
            { name: 'Message', value: replyText, inline: false }
        )
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    await message.channel.send({ embeds: [staffEmbed] });

    const userEmbed = new EmbedBuilder()
        .setTitle('WhiteCastle Support Reply')
        .setColor(0x0000FF)
        .setDescription(replyText)
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    await user.send({ embeds: [userEmbed] }).catch(() => {});
}

async function handleClaim(message) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;
    ticket.claimedBy = message.author.id;

    const embed = new EmbedBuilder()
        .setTitle('Ticket Claimed')
        .setColor(0x00FF00)
        .setDescription(`This ticket has been claimed by ${message.author}.`)
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    await message.channel.send({ embeds: [embed] });
}

async function handleUnclaim(message) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;
    ticket.claimedBy = null;

    const embed = new EmbedBuilder()
        .setTitle('Ticket Unclaimed')
        .setColor(0xFFFF00)
        .setDescription('This ticket is now unclaimed.')
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    await message.channel.send({ embeds: [embed] });
}

async function handleClose(message) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { userId, ticket } = data;
    const guild = getMainGuild();
    if (!guild) return;

    const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
    const user = await client.users.fetch(userId).catch(() => null);

    // build transcript
    const transcriptLines = ticket.messages.map(m => {
        const time = new Date(m.timestamp).toISOString();
        return `[${time}] ${m.from.toUpperCase()}: ${m.content}`;
    });

    const transcriptText = transcriptLines.length
        ? transcriptLines.join('\n')
        : 'No messages recorded in this ticket.';

    if (logChannel) {
        await logChannel.send({
            content: `Transcript for ${message.channel.name} (User: <@${userId}>):\n\`\`\`\n${transcriptText}\n\`\`\``
        });
    }

    const closeEmbed = new EmbedBuilder()
        .setTitle('Ticket Closed')
        .setColor(0x00FF00)
        .setDescription('This support ticket has been closed. Thank you for contacting WhiteCastle Restaurant RBLX Support.')
        .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

    if (user) {
        await user.send({ embeds: [closeEmbed] }).catch(() => {});
    }

    tickets.delete(userId);
    await message.channel.delete().catch(() => {});
}

// =========================
// Snippets
// =========================

async function handleSnippet(message, args) {
    const sub = args.shift()?.toLowerCase();

    if (!sub) return;

    if (sub === 'add') {
        const name = args.shift();
        if (!name) return message.channel.send('Provide a snippet name.');

        const filter = m => m.author.id === message.author.id;
        await message.channel.send(`Send the content for snippet **${name}** (next message).`);

        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(() => null);
        if (!collected || !collected.size) return;

        const content = collected.first().content;
        snippets.set(name, content);
        return message.channel.send(`Snippet **${name}** added.`);
    }

    if (sub === 'edit') {
        const name = args.shift();
        if (!name) return message.channel.send('Provide a snippet name.');
        if (!snippets.has(name)) return message.channel.send('Snippet not found.');

        const filter = m => m.author.id === message.author.id;
        await message.channel.send(`Send the new content for snippet **${name}** (next message).`);

        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(() => null);
        if (!collected || !collected.size) return;

        const content = collected.first().content;
        snippets.set(name, content);
        return message.channel.send(`Snippet **${name}** updated.`);
    }

    if (sub === 'remove') {
        const name = args.shift();
        if (!name) return message.channel.send('Provide a snippet name.');
        if (!snippets.has(name)) return message.channel.send('Snippet not found.');

        snippets.delete(name);
        return message.channel.send(`Snippet **${name}** removed.`);
    }

    if (sub === 'list') {
        if (!snippets.size) return message.channel.send('No snippets created.');
        const names = Array.from(snippets.keys()).join(', ');
        return message.channel.send(`Snippets: ${names}`);
    }

    // .snippet <name>
    const name = sub;
    if (!snippets.has(name)) return message.channel.send('Snippet not found.');
    const content = snippets.get(name);
    return message.channel.send(content);
}

// =========================
// Escalation
// =========================

async function handleEscalate(message, args) {
    const type = args.join(' ').toLowerCase();

    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;
    const guild = getMainGuild();
    if (!guild) return;

    if (type === 'ticket pr') {
        ticket.escalatedTo = 'PR';

        await message.channel.permissionOverwrites.edit(process.env.PR_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        const embed = new EmbedBuilder()
            .setTitle('Ticket Escalated to PR')
            .setColor(0xFF00FF)
            .setDescription('This ticket has been escalated to the PR team.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        await message.channel.send({ embeds: [embed] });
        return;
    }

    if (type === 'ticket staffing') {
        ticket.escalatedTo = 'Staffing';

        await message.channel.permissionOverwrites.edit(process.env.STAFFING_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        const embed = new EmbedBuilder()
            .setTitle('Ticket Escalated to Staffing')
            .setColor(0xFF8800)
            .setDescription('This ticket has been escalated to the Staffing team.')
            .setFooter({ text: 'WhiteCastle Staff Team | Use .help to see a list of commands.' });

        await message.channel.send({ embeds: [embed] });
        return;
    }

    await message.channel.send('Unknown escalation type. Use `.escalate ticket pr` or `.escalate ticket staffing`.');
}

// =========================
// Login
// =========================

client.login(process.env.TOKEN);

// =========================
// Keep-alive server (Render)
// =========================

const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('WhiteCastle Restaurant RBLX Support Bot is alive'));

app.listen(process.env.PORT, () => {
    console.log(`Keep-alive server running on port ${process.env.PORT}`);
});
