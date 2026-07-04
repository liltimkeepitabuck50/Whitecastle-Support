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
const express = require('express');

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
// Stores
// =========================

const tickets = new Map();            // userId -> { channelId, initialMessage, messages: [], claimedBy, escalatedTo }
const pastTickets = new Map();        // userId -> [channelName]
const snippets = new Map();           // name -> content
const lastTextMessageByUser = new Map(); // staffId -> last non-command message

// =========================
// Helpers
// =========================

function getMainGuild() {
    return client.guilds.cache.get(process.env.GUILD_ID);
}

function getTicketByChannel(channelId) {
    for (const [userId, ticket] of tickets.entries()) {
        if (ticket.channelId === channelId) return { userId, ticket };
    }
    return null;
}

async function getMember(guild, userId) {
    try {
        return await guild.members.fetch(userId);
    } catch {
        return null;
    }
}

function formatTimestamp() {
    return new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function createSupportEmbed(member, content) {
    const rank = member?.roles?.highest?.name || 'No Rank';
    const ts = formatTimestamp();
    return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(member.user.username)
        .setDescription(content)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `${rank} | ${ts}` });
}

// =========================
// Ready
// =========================

client.once('ready', () => {
    console.log(`WhiteCastle Restaurant RBLX Support Bot is online as ${client.user.tag}`);
});

// =========================
/* Message Create */
// =========================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Track last non-command message for snippets (staff side)
    if (!message.content.startsWith('.') && message.content.trim().length > 0 && message.guild) {
        lastTextMessageByUser.set(message.author.id, message.content);
    }

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
        case 'help': return handleHelp(message);
        case 'reply': return handleReply(message, args);
        case 'claim': return handleClaim(message);
        case 'unclaim': return handleUnclaim(message);
        case 'close': return handleClose(message);
        case 'snippet': return handleSnippet(message, args);
        case 'escalate': return handleEscalate(message, args);
        default: break;
    }
});

// =========================
/* DM Handler */
// =========================

async function handleDM(message) {
    const userId = message.author.id;
    const content = message.content || '[No content]';

    try { await message.react('✅'); } catch {}

    let ticket = tickets.get(userId);

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
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('Press ✔️ to open a support ticket or ✖️ to cancel.\n\nWe will not tolerate harassment via our ticket systems. We reserve the right to block your access to WhiteCastle’s support.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

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

        const member = await getMember(guild, userId);
        if (!member) return;

        const embed = createSupportEmbed(member, content);
        await supportChannel.send({ embeds: [embed] });
    }
}

// =========================
/* Interaction Create */
// =========================

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const ticket = tickets.get(userId);
    if (!ticket) return;

    if (interaction.customId === 'ticket_cancel') {
        tickets.delete(userId);

        const cancelEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('Your ticket has been canceled.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        await interaction.update({
            embeds: [cancelEmbed],
            components: []
        });
        return;
    }

    if (interaction.customId === 'ticket_confirm') {
        const guild = getMainGuild();
        if (!guild) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Support server not found. Please try again later.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

            await interaction.update({
                embeds: [errorEmbed],
                components: []
            });
            return;
        }

        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;

        const member = await getMember(guild, userId);
        const rank = member?.roles?.highest?.name || 'No Rank';

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

        const history = pastTickets.get(userId) || [];
        const pastText = history.length
            ? `Past Tickets:\n${history.map(n => `- ${n}`).join('\n')}`
            : 'Past Tickets:\nNone';

        const infoEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle(user.username)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(ticket.initialMessage)
            .addFields(
                { name: 'User ID', value: `${user.id}`, inline: true },
                { name: 'History', value: pastText, inline: false }
            )
            .setFooter({ text: `${rank} | ${formatTimestamp()}` });

        await supportChannel.send({
            content: `<@&${process.env.SUPPORT_ROLE_ID}>`,
            embeds: [infoEmbed]
        });

        ticket.channelId = supportChannel.id;
        history.push(channelName);
        pastTickets.set(userId, history);

        const confirmEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('Your ticket has been created. A staff member will contact you shortly.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        await interaction.update({
            embeds: [confirmEmbed],
            components: []
        });
    }
});

// =========================
/* Commands */
// =========================

async function handleHelp(message) {
    const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('WhiteCastle Support Commands')
        .setDescription([
            '**.help** - Show this list',
            '**.reply <message>** - Reply to the ticket user (command message deleted, embed sent)',
            '**.claim** - Claim the ticket',
            '**.unclaim** - Unclaim the ticket',
            '**.close** - Close the ticket and generate transcript',
            '**.snippet add <name>** - Add a snippet using your last message',
            '**.snippet edit <name>** - Edit a snippet (next message)',
            '**.snippet remove <name>** - Remove a snippet',
            '**.snippet list** - List all snippets',
            '**.snippet <name>** - Send snippet to the user (DM)',
            '**.escalate ticket pr** - Escalate to PR',
            '**.escalate ticket staffing** - Escalate to Staffing'
        ].join('\n'))
        .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

    await message.channel.send({ embeds: [embed] });
}

async function handleReply(message, args) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { userId, ticket } = data;
    const replyText = args.join(' ');
    if (!replyText) return;

    const guild = getMainGuild();
    if (!guild) return;

    const member = await getMember(guild, userId);
    if (!member) return;

    ticket.messages.push({
        from: 'staff',
        content: replyText,
        timestamp: Date.now()
    });

    // Delete original command message
    try { await message.delete(); } catch {}

    // Embed to support channel
    const supportEmbed = createSupportEmbed(member, replyText);
    await message.channel.send({ embeds: [supportEmbed] });

    // Embed to user DM
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        const dmEmbed = createSupportEmbed(member, replyText);
        await user.send({ embeds: [dmEmbed] }).catch(() => {});
    }
}

async function handleClaim(message) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;
    ticket.claimedBy = message.author.id;

    const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('WhiteCastle Support')
        .setDescription(`This ticket has been claimed by ${message.author}.`)
        .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

    await message.channel.send({ embeds: [embed] });
}

async function handleUnclaim(message) {
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;
    ticket.claimedBy = null;

    const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('WhiteCastle Support')
        .setDescription('This ticket is now unclaimed.')
        .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

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
    const member = await getMember(guild, userId);

    const transcriptLines = ticket.messages.map(m => {
        const time = new Date(m.timestamp).toISOString();
        return `[${time}] ${m.from.toUpperCase()}: ${m.content}`;
    });

    const transcriptText = transcriptLines.length
        ? transcriptLines.join('\n')
        : 'No messages recorded in this ticket.';

    if (logChannel && member) {
        const logEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle(member.user.username)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User ID', value: `${userId}`, inline: true },
                { name: 'Transcript', value: `\`\`\`\n${transcriptText}\n\`\`\`` }
            )
            .setFooter({ text: `${member.roles.highest.name} | ${formatTimestamp()}` });

        await logChannel.send({ embeds: [logEmbed] });
    }

    const closeEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('WhiteCastle Support')
        .setDescription('This support ticket has been closed. Thank you for contacting WhiteCastle Restaurant RBLX Support.')
        .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

    if (user) {
        await user.send({ embeds: [closeEmbed] }).catch(() => {});
    }

    tickets.delete(userId);
    await message.channel.delete().catch(() => {});
}

// =========================
/* Snippets */
// =========================

async function handleSnippet(message, args) {
    const sub = args.shift()?.toLowerCase();
    if (!sub) return;

    // .snippet add <name>  → use last message from this staff user
    if (sub === 'add') {
        const name = args.shift();
        if (!name) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Provide a snippet name.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }

        const last = lastTextMessageByUser.get(message.author.id);
        if (!last) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('No previous message found. Send the snippet text first, then `.snippet add <name>`.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }

        snippets.set(name, last);

        const embed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('Snippet Added')
            .setDescription(last)
            .addFields({ name: 'Name', value: name, inline: true })
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        return message.channel.send({ embeds: [embed] });
    }

    // .snippet edit <name>  → next message
    if (sub === 'edit') {
        const name = args.shift();
        if (!name) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Provide a snippet name.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }
        if (!snippets.has(name)) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Snippet not found.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }

        const promptEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('Edit Snippet')
            .setDescription(`Send the new content for snippet **${name}** (next message).`)
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        await message.channel.send({ embeds: [promptEmbed] });

        const filter = m => m.author.id === message.author.id;
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(() => null);
        if (!collected || !collected.size) return;

        const content = collected.first().content;
        snippets.set(name, content);

        const doneEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('Snippet Updated')
            .setDescription(content)
            .addFields({ name: 'Name', value: name, inline: true })
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        return message.channel.send({ embeds: [doneEmbed] });
    }

    // .snippet remove <name>
    if (sub === 'remove') {
        const name = args.shift();
        if (!name) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Provide a snippet name.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }
        if (!snippets.has(name)) {
            const embed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('WhiteCastle Support')
                .setDescription('Snippet not found.')
                .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
            return message.channel.send({ embeds: [embed] });
        }

        snippets.delete(name);

        const embed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('Snippet Removed')
            .addFields({ name: 'Name', value: name, inline: true })
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        return message.channel.send({ embeds: [embed] });
    }

    // .snippet list
    if (sub === 'list') {
        const names = Array.from(snippets.keys());
        const embed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('Snippets')
            .setDescription(names.length ? names.join(', ') : 'No snippets created.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        return message.channel.send({ embeds: [embed] });
    }

    // .snippet <name> → send snippet to user (DM) and show embed in support channel
    const name = sub;
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { userId } = data;
    if (!snippets.has(name)) {
        const embed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('Snippet not found.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });
        return message.channel.send({ embeds: [embed] });
    }

    const content = snippets.get(name);
    const guild = getMainGuild();
    if (!guild) return;

    const member = await getMember(guild, userId);
    if (!member) return;

    const dmEmbed = createSupportEmbed(member, content);
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        await user.send({ embeds: [dmEmbed] }).catch(() => {});
    }

    const confirmEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(member.user.username)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setDescription(content)
        .addFields(
            { name: 'Snippet', value: name, inline: true },
            { name: 'Sent To', value: `<@${userId}>`, inline: true }
        )
        .setFooter({ text: `${member.roles.highest.name} | ${formatTimestamp()}` });

    return message.channel.send({ embeds: [confirmEmbed] });
}

// =========================
/* Escalation */
// =========================

async function handleEscalate(message, args) {
    const type = args.join(' ').toLowerCase();
    const data = getTicketByChannel(message.channel.id);
    if (!data) return;

    const { ticket } = data;

    if (type === 'ticket pr') {
        ticket.escalatedTo = 'PR';

        await message.channel.permissionOverwrites.edit(process.env.PR_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        const embed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('This ticket has been escalated to the PR team.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

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
            .setColor(0x2B2D31)
            .setTitle('WhiteCastle Support')
            .setDescription('This ticket has been escalated to the Staffing team.')
            .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

        await message.channel.send({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('WhiteCastle Support')
        .setDescription('Unknown escalation type. Use `.escalate ticket pr` or `.escalate ticket staffing`.')
        .setFooter({ text: `WhiteCastle Staff Team | ${formatTimestamp()}` });

    await message.channel.send({ embeds: [embed] });
}

// =========================
/* Login */
// =========================

client.login(process.env.TOKEN);

// =========================
/* Keep-alive server (Render) */
// =========================

const app = express();

app.get('/', (req, res) => res.send('WhiteCastle Restaurant RBLX Support Bot is alive'));

app.listen(process.env.PORT, () => {
    console.log(`Keep-alive server running on port ${process.env.PORT}`);
});
