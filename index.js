const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// Configuration
const config = {
    supportChannelId: process.env.SUPPORT_CHANNEL_ID || '1375627137733890218',
    ticketNotificationsRoleId: process.env.TICKET_NOTIFICATIONS_ROLE_ID || '1375814168921247758',
    unclaimedCategoryId: process.env.UNCLAIMED_CATEGORY_ID || '1375637343540609034',
    claimedCategoryId: process.env.CLAIMED_CATEGORY_ID || '1378015775817732226',
    ticketCategoryId: process.env.TICKET_CATEGORY_ID || '1378026963658211389',
    adminRoleId: process.env.ADMIN_ROLE_ID || '1373074230752710706',
    manageRoleId: process.env.MANAGE_ROLE_ID || '1373074241737719950',
    transcriptChannelId: process.env.TRANSCRIPT_CHANNEL_ID || '1512906260394152117',
    transcriptBaseUrl: process.env.TRANSCRIPT_BASE_URL || 'https://00virtue.github.io/transcript-viewer',
    // .env'e STATS_BOARD_CHANNEL_ID ekle
    statsBoardChannelId: process.env.STATS_BOARD_CHANNEL_ID || ''
};

// Hazır mesaj şablonları
const messageTemplates = {
    done:        { message: 'Your ticket has been resolved. Thank you for contacting support!', description: 'Mark ticket as resolved and close' },
    pending:     { message: 'Your request is currently being reviewed. Please wait for further updates.', description: 'Inform user their request is being reviewed' },
    info:        { message: 'We need more information to proceed with your request. Please provide additional details.', description: 'Request more information from user' },
    waiting:     { message: 'Your ticket has been escalated to a senior team member for further review.', description: 'Notify user about escalation' },
    evidence:    { message: 'Please first upload your images/video evidence to YouTube, Streamable, or Gyazo. Afterwards, copy and paste the links of your uploaded evidence into a new ticket. If we need more information after that, we\'ll open a chat with you!', description: 'Ask user to upload evidence and open a new ticket with the links' },
    insufficient:{ message: 'Unfortunately, the evidence that you provided isn\'t sufficient enough to determine whether your opponent is cheating or not. If you have more clips then please create a new ticket and we\'ll rereview the report!', description: 'Tell user the provided evidence is not sufficient' },
    inactivity:  { message: 'Your ticket has been closed due to inactivity. If you still require help please make a new ticket.', description: 'Close ticket because of inactivity' }
};

// Store ticket info
const tickets = new Map();
let ticketCounter = 1;

// ═══════════════════════════════════════════════════════════════════════════════
//  STATS SİSTEMİ
// ═══════════════════════════════════════════════════════════════════════════════

// Her mod için { claimed, closed, username } tutar — 3 dönem ayrı ayrı
// allTime   → hiç sıfırlanmaz
// weekly    → Pazartesi 00:00'da sıfırlanır
// monthly   → Ayın 1'inde 00:00'da sıfırlanır

const statsStore = {
    allTime: new Map(),  // userId -> { claimed, closed, username }
    weekly:  new Map(),
    monthly: new Map()
};

// Stat board mesaj ID'leri (3 ayrı mesaj)
const statsMsgIds = {
    allTime: null,
    weekly:  null,
    monthly: null
};

function ensureStat(period, userId, username) {
    if (!statsStore[period].has(userId)) {
        statsStore[period].set(userId, { claimed: 0, closed: 0, username: username || userId });
    }
    const entry = statsStore[period].get(userId);
    if (username) entry.username = username;
    return entry;
}

function addStat(userId, username, field) {
    // field: 'claimed' veya 'closed'
    for (const period of ['allTime', 'weekly', 'monthly']) {
        ensureStat(period, userId, username)[field]++;
    }
}

function resetPeriod(period) {
    statsStore[period].clear();
    console.log(`[Stats] ${period} sıfırlandı.`);
}

// Dönem başlıkları
const periodTitles = {
    allTime: '🏆 All Time Leaderboard',
    weekly:  '📅 Weekly Leaderboard',
    monthly: '📆 Monthly Leaderboard'
};

const periodColors = {
    allTime: '#FFD700',
    weekly:  '#5865F2',
    monthly: '#57F287'
};

function buildEmbed(period) {
    const sorted = [...statsStore[period].entries()]
        .sort((a, b) => b[1].claimed - a[1].claimed);

    const rankPrefix = (i) => {
        if (i === 0) return '01.'
        if (i === 1) return '02.'
        if (i === 2) return '03.'
        return `${String(i + 1).padStart(2, '0')}.`
    }

    let leaderboard = '';
    if (sorted.length === 0) {
        leaderboard = 'No activity recorded yet.';
    } else {
        sorted.forEach(([userId, data], i) => {
            leaderboard += `\`${rankPrefix(i)}\` <@${userId}>\n`;
            leaderboard += `\u200b \u200b \u200b \u200b Claimed: \`${data.claimed}\` · Closed: \`${data.closed}\`\n`;
        });
    }

    const titles = {
        allTime: 'All Time',
        weekly:  'Weekly',
        monthly: 'Monthly'
    };

    const colors = {
        allTime: 0x2B2D31,
        weekly:  0x2B2D31,
        monthly: 0x2B2D31
    };

    const footers = {
        allTime: 'Lifetime statistics · Last updated',
        weekly:  'Resets every Monday · Last updated',
        monthly: 'Resets on the 1st of each month · Last updated'
    };

    return new EmbedBuilder()
        .setAuthor({ name: `Staff Leaderboard — ${titles[period]}` })
        .setDescription(leaderboard || 'No activity recorded yet.')
        .setColor(colors[period])
        .setFooter({ text: footers[period] })
        .setTimestamp();
}

function getNextMonday() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon ...
    const diff = (8 - day) % 7 || 7;
    const next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setHours(0, 0, 0, 0);
    return next;
}

async function updateStatsBoard() {
    if (!config.statsBoardChannelId) return;
    const channel = client.channels.cache.get(config.statsBoardChannelId);
    if (!channel) return;

    for (const period of ['allTime', 'weekly', 'monthly']) {
        const embed = buildEmbed(period);
        try {
            if (statsMsgIds[period]) {
                const existing = await channel.messages.fetch(statsMsgIds[period]).catch(() => null);
                if (existing) {
                    await existing.edit({ embeds: [embed] });
                    continue;
                }
            }
            // Mesaj yok veya silinmiş — yeni gönder
            const msg = await channel.send({ embeds: [embed] });
            statsMsgIds[period] = msg.id;
        } catch (err) {
            console.error(`[Stats] ${period} board güncellenemedi:`, err);
        }
    }
}

// ── Sıfırlama zamanlayıcıları ─────────────────────────────────────────────────
function scheduleResets() {
    checkAndReset(); // bot başladığında kontrol et
    // Her dakika kontrol et (saat başı da yeterli ama dakikalık daha güvenli)
    setInterval(checkAndReset, 60 * 1000);
}

let lastWeekReset  = null; // 'YYYY-WW' formatında
let lastMonthReset = null; // 'YYYY-MM' formatında

function getWeekKey(date) {
    // ISO hafta: yıl + hafta numarası
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function checkAndReset() {
    const now = new Date();

    // Haftalık: Pazartesi 00:00 oldu mu?
    const weekKey = getWeekKey(now);
    if (lastWeekReset === null) {
        lastWeekReset = weekKey; // ilk çalışmada sadece kaydet, sıfırlama
    } else if (weekKey !== lastWeekReset) {
        lastWeekReset = weekKey;
        resetPeriod('weekly');
        await updateStatsBoard();
    }

    // Aylık: Ay değişti mi?
    const monthKey = getMonthKey(now);
    if (lastMonthReset === null) {
        lastMonthReset = monthKey;
    } else if (monthKey !== lastMonthReset) {
        lastMonthReset = monthKey;
        resetPeriod('monthly');
        await updateStatsBoard();
    }
}
// ─────────────────────────────────────────────────────────────────────────────

// Ticket questions configuration
const ticketQuestions = {
    match: [
        { key: 'username',  question: 'What is your NextGames username?',   required: true  },
        { key: 'matchLink', question: 'Please provide your match link.',     required: true  },
        { key: 'issue',     question: 'Please describe the issue.',          required: true  },
        { key: 'proof',     question: 'Please provide your evidence.',       required: true  }
    ],
    payment: [
        { key: 'username', question: 'What is your NextGames username?',    required: true  },
        { key: 'paypal',   question: 'PayPal Email / CashApp Tag.',         required: false },
        { key: 'issue',    question: 'Please describe the issue.',          required: true  }
    ],
    ban: [
        { key: 'username',     question: 'What is your NextGames username?',         required: true },
        { key: 'information',  question: 'Would you like to share any information?', required: true }
    ],
    other: [
        { key: 'username',  question: 'What is your NextGames username?',          required: true  },
        { key: 'problem',   question: 'Please describe your problem.',             required: true  },
        { key: 'evidence',  question: 'Please provide a link to your evidence.',   required: false }
    ]
};

client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    await sendSupportMessage();
    scheduleResets();
    await updateStatsBoard();
});

async function sendSupportMessage() {
    const channel = client.channels.cache.get(config.supportChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle('Open A Ticket')
        .setDescription('Select a button below to create a support ticket.')
        .setColor('#0266ff');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('match_issue').setLabel('Match Issue').setStyle(ButtonStyle.Danger).setEmoji('🎮'),
        new ButtonBuilder().setCustomId('payment_issue').setLabel('Payment Issue').setStyle(ButtonStyle.Success).setEmoji('💸'),
        new ButtonBuilder().setCustomId('ban_appeal').setLabel('Ban Appeal').setStyle(ButtonStyle.Primary).setEmoji('🔐'),
        new ButtonBuilder().setCustomId('other').setLabel('Other').setStyle(ButtonStyle.Secondary).setEmoji('📎')
    );

    await channel.send({ embeds: [embed], components: [row] });
}

client.on('interactionCreate', async (interaction) => {
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('ticket_modal_')) await handleTicketModalSubmit(interaction);
        return;
    }
    if (!interaction.isButton()) return;

    if (['match_issue', 'payment_issue', 'ban_appeal', 'other'].includes(interaction.customId)) {
        await handleTicketCreation(interaction);
    } else if (interaction.customId === 'confirm_response')          { await confirmResponse(interaction); }
      else if (interaction.customId === 'cancel_response')            { await cancelResponse(interaction); }
      else if (interaction.customId === 'confirm_ticket_conversion')  { await confirmTicketConversion(interaction); }
      else if (interaction.customId === 'cancel_ticket_conversion')   { await cancelTicketConversion(interaction); }
});

async function handleTicketCreation(interaction) {
    const ticketType = interaction.customId.replace('_issue', '').replace('_appeal', '').replace('_', '');
    await showTicketModal(interaction, ticketType);
}

async function showTicketModal(interaction, ticketType) {
    const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${ticketType}`)
        .setTitle(`Create A ${getTicketTypeTitle(ticketType)} Ticket`);

    ticketQuestions[ticketType].slice(0, 4).forEach((q, index) => {
        const textInput = new TextInputBuilder()
            .setCustomId(`question_${index}`)
            .setLabel(q.question + (q.required ? ' *' : ''))
            .setRequired(q.required)
            .setStyle(['issue', 'problem', 'information', 'proof'].includes(q.key)
                ? TextInputStyle.Paragraph : TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    });

    await interaction.showModal(modal);
}

async function handleTicketModalSubmit(interaction) {
    const ticketType = interaction.customId.replace('ticket_modal_', '');
    const questions  = ticketQuestions[ticketType];

    await interaction.deferReply({ flags: 64 });

    // Max 2 açık ticket kontrolü
    const openTickets = [...tickets.values()].filter(
        t => t.userId === interaction.user.id && t.type === ticketType
    );
    if (openTickets.length >= 2) {
        await interaction.editReply({
            content: `You already have **2 open ${getTicketTypeTitle(ticketType)}** tickets. Please wait for one to be resolved before opening a new one.`
        });
        return;
    }

    const answers = {};
    questions.forEach((q, index) => {
        if (index < 4) {
            try   { answers[q.key] = interaction.fields.getTextInputValue(`question_${index}`) || 'asd'; }
            catch { answers[q.key] = 'asd'; }
        }
    });

    await createTicketChannel(interaction.user, ticketType, answers);
    await interaction.editReply({ content: 'Your ticket has been successfully created! Please check your DMs.' });
}

async function createTicketChannel(user, ticketType, answers) {
    const guild        = client.guilds.cache.first();
    const ticketNumber = ticketCounter++;

    const channel = await guild.channels.create({
        name: `ticket-${ticketNumber}`,
        type: ChannelType.GuildText,
        parent: config.unclaimedCategoryId,
        permissionOverwrites: [
            { id: guild.roles.everyone,              deny:  [PermissionFlagsBits.ViewChannel] },
            { id: config.ticketNotificationsRoleId,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: config.adminRoleId,                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: config.manageRoleId,               allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
    });

    tickets.set(channel.id, {
        number: ticketNumber, userId: user.id, type: ticketType,
        answers, claimedBy: null, createdAt: new Date().toISOString()
    });

    const staffEmbed = new EmbedBuilder().setColor('#38B2AC').setTitle(getTicketTypeTitle(ticketType));
    ticketQuestions[ticketType].forEach(q => {
        staffEmbed.addFields({ name: getFieldName(q.question), value: answers[q.key] || 'asd', inline: false });
    });
    staffEmbed.setFooter({ text: `Created by ${user.username} - ${user.id}` });

    await channel.send({ content: `<@&${config.ticketNotificationsRoleId}>`, embeds: [staffEmbed] });
    await sendUserDMConfirmation(user, ticketNumber, ticketType, answers, ticketQuestions[ticketType]);
}

async function sendUserDMConfirmation(user, ticketNumber, ticketType, answers, questions) {
    try {
        const summaryEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${ticketNumber} has been created!`)
            .setDescription('Please be patient for a staff member to see it.')
            .setColor('#c9f3fa');
        const detailsEmbed = new EmbedBuilder().setTitle(getTicketTypeTitle(ticketType)).setColor('#0266ff');
        questions.forEach(q => detailsEmbed.addFields({ name: q.question, value: answers[q.key] || 'N/A', inline: false }));
        const dmChannel = await user.createDM();
        await dmChannel.send({ embeds: [summaryEmbed, detailsEmbed] });
    } catch (error) { console.error('Could not send DM to user:', error); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSCRIPT SİSTEMİ
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAllMessages(channel) {
    const allMessages = [];
    let lastId = null;
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;
        allMessages.push(...batch.values());
        lastId = batch.last().id;
        if (batch.size < 100) break;
    }
    return allMessages.reverse();
}

function serializeMessages(messages) {
    return messages.map(msg => ({
        id: msg.id, content: msg.content || '', createdTimestamp: msg.createdTimestamp,
        author: { id: msg.author.id, username: msg.author.username, bot: msg.author.bot },
        embeds: msg.embeds.map(e => ({
            title: e.title, description: e.description, color: e.color,
            fields: e.fields?.map(f => ({ name: f.name, value: f.value })) ?? [],
            footer: e.footer ? { text: e.footer.text } : null
        }))
    }));
}

async function uploadTranscript(json) {
    const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
            description: 'Ticket Transcript', public: true,
            files: { 'transcript.json': { content: json } }
        })
    });
    if (!res.ok) throw new Error(`GitHub Gist upload failed: ${res.status}`);
    const data = await res.json();
    return data.files['transcript.json'].raw_url;
}

async function sendTranscript(channel, channelData, closedBy) {
    if (!config.transcriptChannelId) return;
    const transcriptChannel = client.channels.cache.get(config.transcriptChannelId);
    if (!transcriptChannel) return;

    try {
        const rawMessages  = await fetchAllMessages(channel);
        const serialized   = serializeMessages(rawMessages);

        let openerName = channelData.userId;
        try { const u = await client.users.fetch(channelData.userId); openerName = u.username; } catch (_) {}
        let claimedByName = 'Unclaimed';
        if (channelData.claimedBy) {
            try { const u = await client.users.fetch(channelData.claimedBy); claimedByName = u.username; } catch (_) {}
        }

        const transcriptData = {
            ticketNumber: channelData.number, channelName: channel.name, type: channelData.type,
            openerName, claimedByName, createdAt: channelData.createdAt ?? null,
            closedAt: new Date().toISOString(), messages: serialized
        };

        const rawUrl       = await uploadTranscript(JSON.stringify(transcriptData));
        const transcriptUrl = `${config.transcriptBaseUrl}?url=${encodeURIComponent(rawUrl)}`;

        const embed = new EmbedBuilder()
            .setTitle(`📋 Transcript — #${channel.name}`)
            .setColor('#5865F2')
            .addFields(
                { name: 'Ticket #',   value: String(channelData.number),          inline: true },
                { name: 'Type',       value: getTicketTypeTitle(channelData.type), inline: true },
                { name: 'Opened By',  value: openerName,                           inline: true },
                { name: 'Claimed By', value: claimedByName,                        inline: true },
                { name: 'Closed By',  value: closedBy ?? 'Unknown',                inline: true },
                { name: 'Messages',   value: String(serialized.length),            inline: true }
            )
            .setFooter({ text: `Closed at ${new Date().toLocaleString()}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('📄 View Transcript').setStyle(ButtonStyle.Link).setURL(transcriptUrl)
        );

        await transcriptChannel.send({ embeds: [embed], components: [row] });
    } catch (err) { console.error('[Transcript] Hata:', err); }
}

// ═══════════════════════════════════════════════════════════════════════════════

function getFieldName(question) {
    return question
        .replace('What is your NextGames username?',       'Username')
        .replace('Please provide your match link.',        'Match Link')
        .replace('Please describe the issue.',             'Issue')
        .replace('Please provide your evidence.',          'Proof')
        .replace('PayPal Email / CashApp Tag.',            'PayPal/CashApp')
        .replace('Would you like to share any information?','Information')
        .replace('Please describe your problem.',          'Problem')
        .replace('Please provide a link to your evidence.','Evidence');
}

function getTicketTypeTitle(type) {
    return { match: 'Match Issue', payment: 'Payment Issue', ban: 'Ban Appeal', other: 'General' }[type] || 'General';
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.content.startsWith('!')) { await handleStaffCommands(message); return; }
    if (message.content === '-close')    { await handleCloseCommand(message); return; }

    const channelData = tickets.get(message.channel.id);
    if (channelData && channelData.closingTimeout && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        clearTimeout(channelData.closingTimeout);
        delete channelData.closingTimeout;
        await message.channel.send('Channel deletion cancelled by moderator.');
    }
});

async function handleStaffCommands(message) {
    const member = message.member || await message.guild.members.fetch(message.author.id);
    const hasManagePermission = member.permissions.has(PermissionFlagsBits.ManageMessages);
    const hasStaffRole = member.roles.cache.has(config.adminRoleId) || member.roles.cache.has(config.manageRoleId);
    if (!hasManagePermission && !hasStaffRole) return;

    const args    = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'me':       await claimTicket(message); break;
        case 'assign':   await assignTicket(message, args); break;
        case 'admin':    await escalateToRole(message, 'admin'); break;
        case 'manage':   await escalateToRole(message, 'manage'); break;
        case 'ticket':   await convertToTicket(message); break;
        case 'r':        await respondToTicket(message, args, true); break;
        case 'u':        await respondToTicket(message, args, false); break;
        case 'commands': await showCommands(message); break;
    }
}

async function showCommands(message) {
    const embed = new EmbedBuilder()
        .setTitle('📝 Staff Commands & Templates')
        .setDescription('**Basic Commands:**\n`!me` - Claim ticket\n`!assign @user` - Assign ticket to user\n`!admin` - Escalate to admin\n`!manage` - Escalate to manager\n`!ticket` - Convert to ticket\n`-close` - Close ticket\n\n**Response Templates:**')
        .setColor('#0099ff');
    for (const [key, value] of Object.entries(messageTemplates)) {
        embed.addFields({ name: `!r ${key} / !u ${key}`, value: `${value.description}\n*Message:* "${value.message}"`, inline: false });
    }
    embed.addFields({ name: 'Custom Message', value: '`!r <message>` - Send message and close\n`!u <message>` - Send message without closing', inline: false });
    await message.reply({ embeds: [embed] });
}

async function claimTicket(message) {
    const channelData = tickets.get(message.channel.id);
    if (!channelData) return;
    if (channelData.claimedBy) { await message.reply('This ticket is already claimed!'); return; }

    channelData.claimedBy = message.author.id;
    await message.channel.setName(`t${channelData.number}–${message.author.username}`);
    await message.channel.setParent(config.claimedCategoryId, { lockPermissions: false });
    await message.channel.send(`<@${message.author.id}> is claimed the ticket.`);

    // ── Stat: claim ───────────────────────────────────────────────────────────
    addStat(message.author.id, message.author.username, 'claimed');
    await updateStatsBoard();
    // ─────────────────────────────────────────────────────────────────────────
}

async function assignTicket(message, args) {
    const channelData = tickets.get(message.channel.id);
    if (!channelData) return;
    const user = message.mentions.users.first();
    if (!user) { await message.reply('Please mention a user to assign this ticket to.'); return; }
    channelData.claimedBy = user.id;
    await message.channel.setName(`t${channelData.number}–${user.username}`);
    await message.reply(`Ticket assigned to ${user}!`);
}

async function escalateToRole(message, roleType) {
    const channelData = tickets.get(message.channel.id);
    if (!channelData) { await message.reply('This command must be used inside a ticket channel.'); return; }
    const roleId = roleType === 'admin' ? config.adminRoleId : config.manageRoleId;
    if (!roleId) { await message.reply('The role for this escalation is not configured.'); return; }
    await message.channel.setName(`t${channelData.number}-${roleType}`);
    await message.channel.send(`<@&${roleId}> This ticket needs ${roleType} attention!`);
}

async function convertToTicket(message) {
    if (message.channel.parentId === config.ticketCategoryId) { await message.reply('This is already an opened ticket!'); return; }
    const embed = new EmbedBuilder().setDescription('**Are you sure that you want to open this as a ticket?**').setColor('#00ff00');
    const row   = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_ticket_conversion').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('cancel_ticket_conversion').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );
    await message.reply({ embeds: [embed], components: [row] });
}

async function confirmTicketConversion(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const oldChannel     = interaction.channel;
    const oldChannelData = tickets.get(oldChannel.id);
    if (!oldChannelData) { await interaction.update({ content: 'Ticket bilgisi bulunamadı!', embeds: [], components: [] }); return; }

    const guild        = interaction.guild;
    const ticketNumber = ticketCounter++;
    const staff        = interaction.user;

    const newChannel = await guild.channels.create({
        name: `t${ticketNumber}–${staff.username}`, type: ChannelType.GuildText, parent: config.ticketCategoryId,
        permissionOverwrites: [
            { id: guild.roles.everyone,   deny:  [PermissionFlagsBits.ViewChannel] },
            { id: staff.id,               allow: [PermissionFlagsBits.ViewChannel] },
            { id: oldChannelData.userId,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
    });

    tickets.set(newChannel.id, {
        number: ticketNumber, claimedBy: staff.id, type: oldChannelData.type,
        userId: oldChannelData.userId, answers: oldChannelData.answers,
        createdAt: oldChannelData.createdAt ?? new Date().toISOString()
    });

    const staffEmbed = new EmbedBuilder().setColor('#38B2AC').setTitle(getTicketTypeTitle(oldChannelData.type));
    ticketQuestions[oldChannelData.type].forEach(q => {
        staffEmbed.addFields({ name: getFieldName(q.question), value: oldChannelData.answers[q.key] || 'N/A', inline: false });
    });
    const originalUser = await client.users.fetch(oldChannelData.userId);
    staffEmbed.setFooter({ text: `Created by ${originalUser.username} - ${originalUser.id}` });

    await newChannel.send({ embeds: [staffEmbed] });
    await newChannel.send(`Hey <@${originalUser.id}>! <@${staff.id}> decided to open your request as a ticket!`);
    try { await originalUser.send(`Your request was opened as a ticket! <#${newChannel.id}>`); } catch (_) {}

    await interaction.update({ content: 'Ticket converted successfully!', embeds: [], components: [] });

    tickets.delete(oldChannel.id);
    await sendTranscript(oldChannel, oldChannelData, staff.username);
    setTimeout(async () => { try { await oldChannel.delete(); } catch (_) {} }, 2000);
}

async function cancelTicketConversion(interaction) {
    await interaction.update({ content: 'Ticket conversion cancelled.', embeds: [], components: [] });
}

async function respondToTicket(message, args, shouldClose) {
    const channelData = tickets.get(message.channel.id);
    if (!channelData) return;
    if (args.length === 0) { await message.reply('Please provide a response message or template name.'); return; }

    const firstArg = args[0].toLowerCase();
    const response = messageTemplates[firstArg] ? messageTemplates[firstArg].message : args.join(' ');

    const embed = new EmbedBuilder()
        .setDescription(`**Response:** ${response}\n\n**Close ticket after sending?** ${shouldClose ? 'Yes' : 'No'}`)
        .setColor('#0099ff');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_response').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('cancel_response').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );
    const botMessage = await message.reply({ embeds: [embed], components: [row] });

    channelData.pendingResponse = {
        message: response, shouldClose,
        botMessageId: botMessage.id,
        staffUsername: message.author.username,
        staffId: message.author.id
    };
}

async function confirmResponse(interaction) {
    const channelData = tickets.get(interaction.channel.id);
    if (!channelData || !channelData.pendingResponse) return;
    const { message: responseMessage, shouldClose, staffUsername, staffId } = channelData.pendingResponse;

    try {
        const user = await client.users.fetch(channelData.userId);
        const dmEmbed = new EmbedBuilder()
            .setTitle(`Response for Ticket #${channelData.number}`)
            .setDescription(responseMessage)
            .setColor('#00ff00')
            .setFooter({ text: 'If you have any additional questions, please open another ticket.' });
        await (await user.createDM()).send({ embeds: [dmEmbed] });
    } catch (_) {}

    await interaction.update({ content: 'Response sent successfully!', embeds: [], components: [] });
    delete channelData.pendingResponse;

    if (shouldClose) startCloseCountdown(interaction.channel, staffUsername ?? interaction.user.username, staffId ?? interaction.user.id);
}

async function cancelResponse(interaction) {
    const channelData = tickets.get(interaction.channel.id);
    if (channelData) delete channelData.pendingResponse;
    await interaction.update({ content: 'Response cancelled.', embeds: [], components: [] });
}

async function handleCloseCommand(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    startCloseCountdown(message.channel, message.author.username, message.author.id);
}

function startCloseCountdown(channel, closedByUsername, closedById) {
    const channelData = tickets.get(channel.id);
    if (!channelData) return;

    const embed = new EmbedBuilder()
        .setDescription('**Deleting channel in 10 seconds**\nModerators can type anything to cancel')
        .setColor('#ff0000');

    channel.send({ embeds: [embed] }).then(() => {
        channelData.closingTimeout = setTimeout(async () => {
            try {
                await sendTranscript(channel, channelData, closedByUsername ?? 'Unknown');

                // ── Stat: closed ─────────────────────────────────────────────────────
                if (closedById) {
                    addStat(closedById, closedByUsername, 'closed');
                    await updateStatsBoard();
                }
                // ────────────────────────────────────────────────────────────────────

                tickets.delete(channel.id);
                await channel.delete();
            } catch (error) { console.error('Could not delete channel:', error); }
        }, 10000);
    });
}

client.login(process.env.BOT_TOKEN);